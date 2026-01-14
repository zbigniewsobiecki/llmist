/**
 * TUI status bar for displaying real-time metrics.
 *
 * Shows accumulated token counts, elapsed time, and cost.
 * Also displays currently active LLM calls and gadgets with a spinner.
 * Updates on LLM call lifecycle events.
 */

import type { Box } from "@unblessed/node";
import type { ExecutionEvent, ExecutionTree, NodeId, RateLimitStats } from "llmist";
import { formatCost, formatTokens } from "../ui/formatters.js";
import type { ContentFilterMode, FocusMode, TUIMetrics } from "./types.js";

/** Rough estimate: ~4 characters per token for English text */
const CHARS_PER_TOKEN = 4;

/** Braille spinner frames for smooth animation */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Spinner animation interval in ms (~12fps) */
const SPINNER_INTERVAL_MS = 80;

/**
 * Manages the status bar display and metrics tracking.
 */
export class StatusBar {
  private metrics: TUIMetrics;
  private statusBox: Box;
  private renderCallback: () => void;
  private renderNowCallback: () => void;

  /** Current call's streaming input tokens (estimate) */
  private streamingInputTokens = 0;
  /** Current call's streaming output tokens (estimate) */
  private streamingOutputTokens = 0;
  /** Whether we're currently streaming */
  private isStreaming = false;

  /** Active LLM calls: Map from label ("#1") to model name and start time */
  private activeLLMCalls = new Map<string, { model: string; startTime: number }>();

  /** Active gadgets (by name) */
  private activeGadgets = new Set<string>();

  /** Spinner frame index */
  private spinnerFrame = 0;

  /** Spinner animation interval */
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;

  /** Current focus mode */
  private focusMode: FocusMode = "browse";

  /** Current content filter mode */
  private contentFilterMode: ContentFilterMode = "full";

  /** Available agent profiles (from config) */
  private profiles: string[] = [];

  /** Currently selected profile index */
  private currentProfileIndex = 0;

  /** Selection debug info callback */
  private selectionDebugCallback:
    | (() => { index: number; total: number; nodeType?: string; nodeId?: string })
    | null = null;

  /** Track tree node IDs to display labels for LLM calls */
  private nodeIdToLabel = new Map<NodeId, string>();

  /** Track tree node IDs for gadgets */
  private nodeIdToGadgetName = new Map<NodeId, string>();

  /** Tree subscription unsubscribe function */
  private treeUnsubscribe: (() => void) | null = null;

  /** Rate limiting state */
  private rateLimitState: {
    isThrottling: boolean;
    delayMs: number;
    triggeredBy?: RateLimitStats["triggeredBy"];
  } | null = null;

  /** Retry state */
  private retryState: { attemptNumber: number; retriesLeft: number } | null = null;

  constructor(
    statusBox: Box,
    model: string,
    renderCallback: () => void,
    renderNowCallback?: () => void,
  ) {
    this.statusBox = statusBox;
    this.renderCallback = renderCallback;
    this.renderNowCallback = renderNowCallback ?? renderCallback;
    this.metrics = {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      cost: 0,
      startTime: Date.now(),
      iteration: 0,
      model,
    };

    // Initial render
    this.render();
  }

  /**
   * Called when a new LLM call starts.
   * @param model - Model name
   * @param estimatedInputTokens - Estimated input tokens for this call
   */
  startCall(model: string, estimatedInputTokens: number): void {
    this.metrics.model = model;
    this.metrics.iteration++;
    // Track streaming estimates separately
    this.streamingInputTokens = estimatedInputTokens;
    this.streamingOutputTokens = 0;
    this.isStreaming = true;
    this.render();
  }

  /**
   * Called during streaming to update output token estimate.
   * Uses immediate rendering for real-time feedback.
   * @param estimatedOutputTokens - Estimated output tokens so far
   */
  updateStreaming(estimatedOutputTokens: number): void {
    this.streamingOutputTokens = estimatedOutputTokens;
    this.render(true); // immediate render for streaming updates
  }

  /**
   * Called when an LLM call completes.
   * Replaces streaming estimates with actual values.
   */
  endCall(inputTokens: number, outputTokens: number, cachedTokens: number, cost: number): void {
    // Add actual values to accumulated totals
    this.metrics.inputTokens += inputTokens;
    this.metrics.outputTokens += outputTokens;
    this.metrics.cachedTokens += cachedTokens;
    this.metrics.cost += cost;
    // Clear streaming state
    this.streamingInputTokens = 0;
    this.streamingOutputTokens = 0;
    this.isStreaming = false;
    this.render();
  }

  /**
   * Add cost from gadget execution (e.g., subagent costs).
   */
  addGadgetCost(cost: number): void {
    if (cost > 0) {
      this.metrics.cost += cost;
      this.render();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Activity Tracking (for real-time display of what's running)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Track an LLM call as active.
   * @param label - Display label like "#1" or "#1.1"
   * @param model - Full model name like "gemini:gemini-2.5-flash"
   */
  startLLMCall(label: string, model: string): void {
    this.activeLLMCalls.set(label, { model, startTime: Date.now() });
    this.startSpinner();
    this.render();
  }

  /**
   * Mark an LLM call as complete.
   * @param label - Display label like "#1" or "#1.1"
   */
  endLLMCall(label: string): void {
    this.activeLLMCalls.delete(label);
    this.maybeStopSpinner();
    this.render();
  }

  /**
   * Get the start time of the earliest running LLM call.
   * Used to show elapsed time since the first call started (for concurrent subagents).
   * @returns Start time in ms, or null if no LLM calls are active
   */
  private getEarliestLLMCallStartTime(): number | null {
    if (this.activeLLMCalls.size === 0) return null;

    let earliest = Infinity;
    for (const { startTime } of this.activeLLMCalls.values()) {
      if (startTime < earliest) earliest = startTime;
    }
    return earliest;
  }

  /**
   * Track a gadget as active.
   * @param name - Gadget name like "ReadFile" or "BrowseWeb"
   */
  startGadget(name: string): void {
    this.activeGadgets.add(name);
    this.startSpinner();
    this.render();
  }

  /**
   * Mark a gadget as complete.
   * @param name - Gadget name
   */
  endGadget(name: string): void {
    this.activeGadgets.delete(name);
    this.maybeStopSpinner();
    this.render();
  }

  /**
   * Start the spinner animation if not already running.
   */
  private startSpinner(): void {
    if (this.spinnerInterval) return;
    this.spinnerInterval = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      this.render(true); // immediate render for smooth animation
    }, SPINNER_INTERVAL_MS);
  }

  /**
   * Stop the spinner if no activity is in progress.
   */
  private maybeStopSpinner(): void {
    if (this.activeLLMCalls.size === 0 && this.activeGadgets.size === 0) {
      this.stopSpinner();
    }
  }

  /**
   * Force stop the spinner animation.
   */
  private stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
  }

  /**
   * Clear all activity tracking and stop spinner.
   * Call this when the agent loop completes or between REPL iterations.
   */
  clearActivity(): void {
    this.activeLLMCalls.clear();
    this.activeGadgets.clear();
    this.nodeIdToLabel.clear();
    this.nodeIdToGadgetName.clear();
    this.stopSpinner();
    this.render();
  }

  /**
   * Show rate limiting throttle indicator.
   * @param delayMs - Delay in milliseconds before next request
   * @param triggeredBy - Which limit(s) triggered the throttle
   */
  showThrottling(delayMs: number, triggeredBy?: RateLimitStats["triggeredBy"]): void {
    this.rateLimitState = { isThrottling: true, delayMs, triggeredBy };
    this.render(true);
  }

  /**
   * Clear rate limiting throttle indicator.
   */
  clearThrottling(): void {
    this.rateLimitState = null;
    this.render(true);
  }

  /**
   * Show retry attempt indicator.
   * @param attemptNumber - Current attempt number (1-based)
   * @param retriesLeft - Number of retries remaining after this attempt
   */
  showRetry(attemptNumber: number, retriesLeft: number): void {
    this.retryState = { attemptNumber, retriesLeft };
    this.render(true);
  }

  /**
   * Clear retry attempt indicator.
   */
  clearRetry(): void {
    this.retryState = null;
    this.render(true);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Tree Subscription (for tree-only block creation)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Subscribe to ExecutionTree events for automatic activity tracking.
   * This enables tree-only block creation where the tree is the single
   * source of truth for LLM calls and gadgets.
   *
   * @param tree - The ExecutionTree to subscribe to
   * @returns Unsubscribe function
   */
  subscribeToTree(tree: ExecutionTree): () => void {
    // Unsubscribe from any previous tree
    if (this.treeUnsubscribe) {
      this.treeUnsubscribe();
    }

    // Clear ALL previous state (activity tracking + node mappings)
    // This prevents stale LLM/gadget activity from previous tree subscriptions
    // Critical for REPL mode where trees are replaced per iteration
    this.activeLLMCalls.clear();
    this.activeGadgets.clear();
    this.nodeIdToLabel.clear();
    this.nodeIdToGadgetName.clear();
    this.maybeStopSpinner();
    this.render();

    this.treeUnsubscribe = tree.onAll((event: ExecutionEvent) => {
      this.handleTreeEvent(event);
    });

    return () => {
      if (this.treeUnsubscribe) {
        this.treeUnsubscribe();
        this.treeUnsubscribe = null;
      }
    };
  }

  /**
   * Handle an ExecutionTree event for activity tracking.
   */
  private handleTreeEvent(event: ExecutionEvent): void {
    switch (event.type) {
      case "llm_call_start": {
        // Create label like "#1" for root calls, "#1.1" for nested
        const label =
          event.depth === 0 ? `#${event.iteration + 1}` : `#${event.iteration + 1}.${event.depth}`;
        this.nodeIdToLabel.set(event.nodeId, label);
        this.startLLMCall(label, event.model);
        break;
      }

      case "llm_response_end": {
        // LLM finished generating tokens (before gadgets complete)
        // Remove from active LLM calls to stop the timer
        const label = this.nodeIdToLabel.get(event.nodeId);
        if (label) {
          this.activeLLMCalls.delete(label);
          this.maybeStopSpinner();
          this.render();
        }
        break;
      }

      case "llm_call_complete": {
        const label = this.nodeIdToLabel.get(event.nodeId);
        if (label) {
          this.endLLMCall(label);
          // Accumulate token/cost metrics from tree event (includes nested calls)
          if (event.usage || event.cost) {
            this.endCall(
              event.usage?.inputTokens ?? 0,
              event.usage?.outputTokens ?? 0,
              event.usage?.cachedInputTokens ?? 0,
              event.cost ?? 0,
            );
          }
          this.nodeIdToLabel.delete(event.nodeId);
        }
        break;
      }

      case "llm_call_error": {
        const label = this.nodeIdToLabel.get(event.nodeId);
        if (label) {
          this.endLLMCall(label);
          this.nodeIdToLabel.delete(event.nodeId);
        }
        break;
      }

      case "gadget_call": {
        this.nodeIdToGadgetName.set(event.nodeId, event.name);
        this.startGadget(event.name);
        break;
      }

      case "gadget_complete": {
        const name = this.nodeIdToGadgetName.get(event.nodeId);
        if (name) {
          this.endGadget(name);
          if (event.cost) {
            this.addGadgetCost(event.cost);
          }
          this.nodeIdToGadgetName.delete(event.nodeId);
        }
        break;
      }

      case "gadget_error":
      case "gadget_skipped": {
        const name = this.nodeIdToGadgetName.get(event.nodeId);
        if (name) {
          this.endGadget(name);
          this.nodeIdToGadgetName.delete(event.nodeId);
        }
        break;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Focus Mode
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Set the current focus mode (called by TUIApp).
   * Updates the status bar to show the mode indicator.
   * Uses immediate render to ensure the mode is visible before input focus changes.
   */
  setFocusMode(mode: FocusMode): void {
    this.focusMode = mode;
    this.render(true); // immediate render for mode changes
  }

  /**
   * Get the current focus mode.
   */
  getFocusMode(): FocusMode {
    return this.focusMode;
  }

  /**
   * Set the content filter mode (full or focused).
   * In focused mode, displays "FOCUSED" with dark blue background.
   */
  setContentFilterMode(mode: ContentFilterMode): void {
    this.contentFilterMode = mode;
    this.render(true); // immediate render for mode changes
  }

  /**
   * Get the current content filter mode.
   */
  getContentFilterMode(): ContentFilterMode {
    return this.contentFilterMode;
  }

  /**
   * Set a callback to get selection debug info from BlockRenderer.
   */
  setSelectionDebugCallback(
    callback: () => { index: number; total: number; nodeType?: string; nodeId?: string },
  ): void {
    this.selectionDebugCallback = callback;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Profile Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Set available profiles for cycling.
   * @param profiles - Available profile names
   * @param initialProfile - Optional profile to select initially (defaults to first)
   */
  setProfiles(profiles: string[], initialProfile?: string): void {
    this.profiles = profiles;
    const index = initialProfile ? profiles.indexOf(initialProfile) : 0;
    this.currentProfileIndex = index >= 0 ? index : 0;
    this.render();
  }

  /**
   * Cycle to the next profile (Ctrl+P).
   */
  cycleProfile(): void {
    if (this.profiles.length > 1) {
      this.currentProfileIndex = (this.currentProfileIndex + 1) % this.profiles.length;
      this.render(true);
    }
  }

  /**
   * Get the currently selected profile name.
   */
  getCurrentProfile(): string | null {
    return this.profiles[this.currentProfileIndex] ?? null;
  }

  /**
   * Shorten model name for display.
   * "gemini:gemini-2.5-flash" → "2.5-flash"
   */
  private shortenModelName(model: string): string {
    // Remove provider prefix
    const withoutProvider = model.includes(":") ? model.split(":")[1] : model;
    // Shorten common patterns
    return withoutProvider
      .replace("claude-", "")
      .replace("gemini-", "")
      .replace("gpt-", "")
      .replace("-latest", "");
  }

  /**
   * Get current metrics for external use.
   */
  getMetrics(): Readonly<TUIMetrics> {
    return { ...this.metrics };
  }

  /**
   * Get elapsed time in seconds.
   */
  getElapsedSeconds(): number {
    return (Date.now() - this.metrics.startTime) / 1000;
  }

  /**
   * Render the status bar content.
   * @param immediate - If true, render immediately without debouncing
   */
  private render(immediate = false): void {
    // ANSI color codes
    const YELLOW = "\x1b[33m";
    const GREEN = "\x1b[32m";
    const BLUE = "\x1b[34m";
    const CYAN = "\x1b[36m";
    const MAGENTA = "\x1b[35m";
    const GRAY = "\x1b[90m";
    const RESET = "\x1b[0m";
    const BG_BLUE = "\x1b[44m";
    const WHITE = "\x1b[37m";

    // Calculate display values: accumulated + current streaming
    const displayInputTokens = this.metrics.inputTokens + this.streamingInputTokens;
    const displayOutputTokens = this.metrics.outputTokens + this.streamingOutputTokens;

    // Build status line using ANSI codes
    // Order: mode indicator, stable metrics (tokens, time, cost), then dynamic activity (LLM calls, gadgets)
    const parts: string[] = [];

    // Mode indicator - only show BROWSE badge (input mode is the default, no badge needed)
    // Also skip in focused content mode - hints bar shows exit hint there
    if (this.focusMode === "browse" && this.contentFilterMode !== "focused") {
      parts.push(`${BG_BLUE}${WHITE} BROWSE ${RESET}`);
    }

    // Profile indicator (if profiles are set)
    if (this.profiles.length > 0) {
      const profile = this.profiles[this.currentProfileIndex];
      const display = profile.length > 12 ? `${profile.slice(0, 11)}…` : profile;
      parts.push(`${YELLOW}${display}${RESET}`);
    }

    // Input tokens (yellow) - only show if > 0
    if (displayInputTokens > 0) {
      const inputPrefix = this.isStreaming && this.streamingInputTokens > 0 ? "~" : "";
      parts.push(`${YELLOW}↑${inputPrefix}${formatTokens(displayInputTokens)}${RESET}`);
    }

    // Cached tokens (blue) - only show if present
    if (this.metrics.cachedTokens > 0) {
      parts.push(`${BLUE}⤿${formatTokens(this.metrics.cachedTokens)}${RESET}`);
    }

    // Output tokens (green) - only show if > 0
    if (displayOutputTokens > 0) {
      const outputPrefix = this.isStreaming ? "~" : "";
      parts.push(`${GREEN}↓${outputPrefix}${formatTokens(displayOutputTokens)}${RESET}`);
    }

    // Elapsed time (gray) - only show when LLM call is active
    // Shows time since earliest running call (for concurrent subagents)
    const earliestStart = this.getEarliestLLMCallStartTime();
    if (earliestStart !== null) {
      const elapsedSeconds = (Date.now() - earliestStart) / 1000;
      // Show integer for whole seconds, one decimal otherwise
      const timeStr =
        elapsedSeconds % 1 === 0 ? `${elapsedSeconds}s` : `${elapsedSeconds.toFixed(1)}s`;
      parts.push(`${GRAY}${timeStr}${RESET}`);
    }

    // Cost (cyan) - only show if > 0
    if (this.metrics.cost > 0) {
      parts.push(`${CYAN}$${formatCost(this.metrics.cost)}${RESET}`);
    }

    // Selection debug info (if callback is set)
    if (this.selectionDebugCallback) {
      const debug = this.selectionDebugCallback();
      const debugStr = `sel:${debug.index}/${debug.total}`;
      const typeStr = debug.nodeType ? ` [${debug.nodeType}]` : "";
      parts.push(`${GRAY}${debugStr}${typeStr}${RESET}`);
    }

    // Rate limit throttling indicator (high priority - show before activity)
    if (this.rateLimitState?.isThrottling) {
      const { triggeredBy } = this.rateLimitState;
      if (triggeredBy?.daily) {
        // Daily limit shows a more descriptive message instead of countdown
        parts.push(`${YELLOW}⏸ Daily limit, resets midnight UTC${RESET}`);
      } else {
        // RPM/TPM show countdown with optional reason
        const seconds = Math.ceil(this.rateLimitState.delayMs / 1000);
        const reason = triggeredBy?.rpm ? " (RPM)" : triggeredBy?.tpm ? " (TPM)" : "";
        parts.push(`${YELLOW}⏸ Throttled ${seconds}s${reason}${RESET}`);
      }
    }

    // Retry attempt indicator (high priority - show before activity)
    if (this.retryState) {
      const { attemptNumber, retriesLeft } = this.retryState;
      const totalAttempts = attemptNumber + retriesLeft;
      parts.push(`${BLUE}🔄 Retry ${attemptNumber}/${totalAttempts}${RESET}`);
    }

    // Activity section at the end (if anything is running)
    if (this.activeLLMCalls.size > 0 || this.activeGadgets.size > 0) {
      const spinner = SPINNER_FRAMES[this.spinnerFrame];

      // Show active LLM calls with model names, grouped by model
      if (this.activeLLMCalls.size > 0) {
        const byModel = new Map<string, string[]>();
        for (const [label, { model }] of this.activeLLMCalls) {
          const shortModel = this.shortenModelName(model);
          if (!byModel.has(shortModel)) byModel.set(shortModel, []);
          byModel.get(shortModel)?.push(label);
        }

        const llmParts: string[] = [];
        for (const [model, labels] of byModel) {
          llmParts.push(`${model} ${labels.join(", ")}`);
        }
        parts.push(`${spinner} ${MAGENTA}${llmParts.join(" | ")}${RESET}`);
      }

      // Show active gadgets (limit to 3, show +N for more)
      if (this.activeGadgets.size > 0) {
        const gadgetList = [...this.activeGadgets].slice(0, 3).join(", ");
        const more = this.activeGadgets.size > 3 ? ` +${this.activeGadgets.size - 3}` : "";
        parts.push(`${CYAN}⏵ ${gadgetList}${more}${RESET}`);
      }
    }

    this.statusBox.setContent(parts.join(" "));

    // Use immediate render for streaming updates, debounced for others
    if (immediate) {
      this.renderNowCallback();
    } else {
      this.renderCallback();
    }
  }

  /**
   * Estimate tokens from text length.
   * @param text - Text to estimate tokens for
   * @returns Estimated token count
   */
  static estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }
}
