import chalk from "chalk";
import { InvalidArgumentError } from "commander";
import type { ModelRegistry, TokenUsage } from "llmist";
import { FALLBACK_CHARS_PER_TOKEN, formatLLMError } from "llmist";
import type { CLIEnvironment, TTYAwareStream } from "./environment.js";

/**
 * Options for creating a numeric value parser.
 */
export interface NumericParserOptions {
  label: string;
  integer?: boolean;
  min?: number;
  max?: number;
}

/**
 * Creates a parser function for numeric command-line options with validation.
 * Validates that values are numbers, optionally integers, and within min/max bounds.
 *
 * @param options - Parser configuration (label, integer, min, max)
 * @returns Parser function that validates and returns the numeric value
 * @throws InvalidArgumentError if validation fails
 */
export function createNumericParser({
  label,
  integer = false,
  min,
  max,
}: NumericParserOptions): (value: string) => number {
  return (value: string) => {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      throw new InvalidArgumentError(`${label} must be a number.`);
    }

    if (integer && !Number.isInteger(parsed)) {
      throw new InvalidArgumentError(`${label} must be an integer.`);
    }

    if (min !== undefined && parsed < min) {
      throw new InvalidArgumentError(`${label} must be greater than or equal to ${min}.`);
    }

    if (max !== undefined && parsed > max) {
      throw new InvalidArgumentError(`${label} must be less than or equal to ${max}.`);
    }

    return parsed;
  };
}

/**
 * Helper class for writing text to a stream while tracking newline state.
 * Ensures output ends with a newline for proper terminal formatting.
 */
export class StreamPrinter {
  private endedWithNewline = true;

  constructor(private readonly target: NodeJS.WritableStream) {}

  /**
   * Writes text to the target stream and tracks newline state.
   *
   * @param text - Text to write
   */
  write(text: string): void {
    if (!text) {
      return;
    }
    this.target.write(text);
    this.endedWithNewline = text.endsWith("\n");
  }

  /**
   * Ensures output ends with a newline by writing one if needed.
   */
  ensureNewline(): void {
    if (!this.endedWithNewline) {
      this.target.write("\n");
      this.endedWithNewline = true;
    }
  }
}

/**
 * Checks if a stream is a TTY (terminal) for interactive input.
 *
 * @param stream - Stream to check
 * @returns True if stream is a TTY
 */
export function isInteractive(stream: TTYAwareStream): boolean {
  return Boolean(stream.isTTY);
}

/** ESC key byte code */
const ESC_KEY = 0x1b;

/**
 * Timeout in milliseconds to distinguish standalone ESC key from escape sequences.
 *
 * When a user presses the ESC key alone, only byte 0x1B is sent. However, arrow keys
 * and other special keys send escape sequences that START with 0x1B followed by
 * additional bytes (e.g., `ESC[A` for up arrow, `ESC[B` for down arrow).
 *
 * These additional bytes typically arrive within 10-20ms on most terminals and SSH
 * connections. The 50ms timeout provides a safe buffer to detect escape sequences
 * while keeping the standalone ESC key responsive to user input.
 *
 * If no additional bytes arrive within this window after an initial ESC byte,
 * we treat it as a standalone ESC key press.
 */
const ESC_TIMEOUT_MS = 50;
const CTRL_C = 0x03; // ETX - End of Text (Ctrl+C in raw mode)

/**
 * Creates a keyboard listener for ESC key and Ctrl+C detection in TTY mode.
 *
 * Uses a timeout to distinguish standalone ESC from escape sequences (like arrow keys).
 * Arrow keys start with ESC byte (0x1B) followed by additional bytes, so we wait briefly
 * to see if more bytes arrive before triggering the callback.
 *
 * When stdin is in raw mode, Ctrl+C is received as byte 0x03 instead of generating
 * a SIGINT signal. This function handles Ctrl+C explicitly via the onCtrlC callback.
 *
 * @param stdin - The stdin stream (must be TTY with setRawMode support)
 * @param onEsc - Callback when ESC is pressed
 * @param onCtrlC - Optional callback when Ctrl+C is pressed in raw mode
 * @returns Cleanup function to restore normal mode, or null if not supported
 */
export function createEscKeyListener(
  stdin: NodeJS.ReadStream,
  onEsc: () => void,
  onCtrlC?: () => void,
): (() => void) | null {
  // Check both isTTY and setRawMode availability (mock streams may have isTTY but no setRawMode)
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return null;
  }

  let escTimeout: NodeJS.Timeout | null = null;

  const handleData = (data: Buffer) => {
    // Handle Ctrl+C in raw mode (since SIGINT won't be generated)
    if (data[0] === CTRL_C && onCtrlC) {
      // Clear any pending ESC timeout before handling Ctrl+C
      if (escTimeout) {
        clearTimeout(escTimeout);
        escTimeout = null;
      }
      onCtrlC();
      return;
    }

    if (data[0] === ESC_KEY) {
      if (data.length === 1) {
        // Could be standalone ESC or start of sequence - use timeout
        escTimeout = setTimeout(() => {
          onEsc();
        }, ESC_TIMEOUT_MS);
      } else {
        // Part of escape sequence (arrow key, etc.) - clear any pending timeout
        if (escTimeout) {
          clearTimeout(escTimeout);
          escTimeout = null;
        }
      }
    } else {
      // Other key - clear any pending ESC timeout
      if (escTimeout) {
        clearTimeout(escTimeout);
        escTimeout = null;
      }
    }
  };

  // Enable raw mode to get individual keystrokes
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on("data", handleData);

  // Return cleanup function
  return () => {
    if (escTimeout) {
      clearTimeout(escTimeout);
    }
    stdin.removeListener("data", handleData);
    stdin.setRawMode(false);
    stdin.pause();
  };
}

/**
 * Timeout window for detecting double Ctrl+C press (in milliseconds).
 *
 * When no operation is active, pressing Ctrl+C once shows a hint message.
 * If a second Ctrl+C is pressed within this window, the CLI exits gracefully.
 * This pattern is familiar from many CLI tools (npm, vim, etc.).
 */
const SIGINT_DOUBLE_PRESS_MS = 1000;

/**
 * Creates a SIGINT (Ctrl+C) listener with double-press detection.
 *
 * Behavior:
 * - If an operation is active: cancels the operation via `onCancel`
 * - If no operation active and first press: shows hint message
 * - If no operation active and second press within 1 second: calls `onQuit`
 *
 * @param onCancel - Callback when Ctrl+C pressed during an active operation
 * @param onQuit - Callback when double Ctrl+C pressed (quit CLI)
 * @param isOperationActive - Function that returns true if an operation is in progress
 * @param stderr - Stream to write hint messages to (defaults to process.stderr)
 * @returns Cleanup function to remove the listener
 *
 * @example
 * ```typescript
 * const cleanup = createSigintListener(
 *   () => abortController.abort(),
 *   () => process.exit(0),
 *   () => isStreaming,
 * );
 *
 * // When done:
 * cleanup();
 * ```
 */
export function createSigintListener(
  onCancel: () => void,
  onQuit: () => void,
  isOperationActive: () => boolean,
  stderr: NodeJS.WritableStream = process.stderr,
): () => void {
  let lastSigintTime = 0;

  const handler = () => {
    const now = Date.now();

    if (isOperationActive()) {
      // Cancel the current operation
      onCancel();
      // Set timer to now so that a second Ctrl+C within 1 second will trigger quit
      lastSigintTime = now;
      return;
    }

    // Check for double-press
    if (now - lastSigintTime < SIGINT_DOUBLE_PRESS_MS) {
      onQuit();
      return;
    }

    // First press when no operation is active
    lastSigintTime = now;
    stderr.write(chalk.dim("\n[Press Ctrl+C again to quit]\n"));
  };

  process.on("SIGINT", handler);

  return () => {
    process.removeListener("SIGINT", handler);
  };
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_DELAY_MS = 500; // Don't show spinner for fast responses

type ProgressMode = "streaming" | "cumulative";

// Import formatters from centralized formatting module
// This showcases llmist's clean code organization
import { formatCost, formatGadgetLine, formatLLMCallLine, formatTokens } from "./ui/formatters.js";

/**
 * Progress indicator shown while waiting for LLM response.
 * Two modes:
 * - streaming: Shows current LLM call stats (out/in tokens, call time)
 * - cumulative: Shows total stats across all calls (total tokens, iterations, total time)
 * Only displays on TTY (interactive terminal), silent when piped.
 */
export class StreamProgress {
  // Animation state
  private frameIndex = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private delayTimeout: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private hasRendered = false;
  private lastRenderLineCount = 0; // Track lines rendered for multi-line clearing

  // Current call stats (streaming mode)
  private mode: ProgressMode = "cumulative";
  private model = "";
  private callStartTime = Date.now();
  private callInputTokens = 0;
  private callInputTokensEstimated = true;
  private callOutputTokens = 0;
  private callOutputTokensEstimated = true;
  private callOutputChars = 0;
  private isStreaming = false;
  // Cache token tracking for live cost estimation during streaming
  private callCachedInputTokens = 0;
  private callCacheCreationInputTokens = 0;
  // Reasoning token tracking for live cost estimation during streaming
  private callReasoningTokens = 0;

  // Cumulative stats (cumulative mode)
  private totalStartTime = Date.now();
  private totalTokens = 0;
  private totalCost = 0;
  private iterations = 0;
  private currentIteration = 0;

  // In-flight gadget tracking for concurrent status display
  private inFlightGadgets: Map<
    string,
    {
      name: string;
      params?: Record<string, unknown>;
      startTime: number;
      completed?: boolean;
      completedTime?: number;
    }
  > = new Map();

  // Nested agent tracking for hierarchical subagent display
  private nestedAgents: Map<
    string,
    {
      parentInvocationId: string;
      depth: number;
      model: string;
      iteration: number;
      /** Parent call number for hierarchical display (e.g., #1.2) */
      parentCallNumber?: number;
      /** Gadget invocation ID for unique subagent identification (e.g., #6.browse_web_1.2) */
      gadgetInvocationId?: string;
      startTime: number;
      inputTokens?: number;
      outputTokens?: number;
      // First-class subagent metrics (cached tokens, cost, finish reason)
      cachedInputTokens?: number;
      cacheCreationInputTokens?: number;
      reasoningTokens?: number;
      finishReason?: string;
      cost?: number;
      completed?: boolean;
      completedTime?: number;
    }
  > = new Map();

  // Nested gadget tracking for hierarchical subagent display
  private nestedGadgets: Map<
    string,
    {
      depth: number;
      parentInvocationId: string;
      name: string;
      parameters?: Record<string, unknown>;
      startTime: number;
      completed?: boolean;
      completedTime?: number;
    }
  > = new Map();

  constructor(
    private readonly target: NodeJS.WritableStream,
    private readonly isTTY: boolean,
    private readonly modelRegistry?: ModelRegistry,
  ) {}

  /**
   * Add a gadget to the in-flight tracking (called when gadget_call event received).
   * Triggers re-render to show the gadget in the status display.
   */
  addGadget(invocationId: string, name: string, params?: Record<string, unknown>): void {
    this.inFlightGadgets.set(invocationId, { name, params, startTime: Date.now() });
    // Re-render immediately to show the new gadget
    if (this.isRunning && this.isTTY) {
      this.render();
    }
  }

  /**
   * Remove a gadget from in-flight tracking (called when gadget_result event received).
   * Triggers re-render to update the status display.
   */
  removeGadget(invocationId: string): void {
    this.inFlightGadgets.delete(invocationId);
    // Re-render immediately to remove the gadget from display
    if (this.isRunning && this.isTTY) {
      this.render();
    }
  }

  /**
   * Check if there are any gadgets currently in flight.
   */
  hasInFlightGadgets(): boolean {
    return this.inFlightGadgets.size > 0;
  }

  /**
   * Get a gadget by ID (for accessing name, params, etc.).
   */
  getGadget(invocationId: string) {
    return this.inFlightGadgets.get(invocationId);
  }

  /**
   * Mark a gadget as completed (keeps it visible with ✓ indicator).
   * Records completion time to freeze the elapsed timer.
   * The gadget and its nested operations remain visible until clearCompletedGadgets() is called.
   */
  completeGadget(invocationId: string): void {
    const gadget = this.inFlightGadgets.get(invocationId);
    if (gadget) {
      gadget.completed = true;
      gadget.completedTime = Date.now();
      if (this.isRunning && this.isTTY) {
        this.render();
      }
    }
  }

  /**
   * Clear all completed gadgets from the display.
   * Called when new text output arrives to clean up the finished gadget section.
   */
  clearCompletedGadgets(): void {
    for (const [id, gadget] of this.inFlightGadgets) {
      if (gadget.completed) {
        this.inFlightGadgets.delete(id);
        // Also clean up nested operations for this gadget
        for (const [nestedId, nested] of this.nestedAgents) {
          if (nested.parentInvocationId === id) {
            this.nestedAgents.delete(nestedId);
          }
        }
        for (const [nestedId, nested] of this.nestedGadgets) {
          if (nested.parentInvocationId === id) {
            this.nestedGadgets.delete(nestedId);
          }
        }
      }
    }
    if (this.isRunning && this.isTTY) {
      this.render();
    }
  }

  /**
   * Add a nested agent LLM call (called when nested llm_call_start event received).
   * Used to display hierarchical progress for subagent gadgets.
   * @param parentCallNumber - Top-level call number for hierarchical display (e.g., #1.2)
   * @param gadgetInvocationId - Gadget invocation ID for unique subagent identification
   */
  addNestedAgent(
    id: string,
    parentInvocationId: string,
    depth: number,
    model: string,
    iteration: number,
    info?: {
      inputTokens?: number;
      cachedInputTokens?: number;
    },
    parentCallNumber?: number,
    gadgetInvocationId?: string,
  ): void {
    this.nestedAgents.set(id, {
      parentInvocationId,
      depth,
      model,
      iteration,
      parentCallNumber,
      gadgetInvocationId,
      startTime: Date.now(),
      inputTokens: info?.inputTokens,
      cachedInputTokens: info?.cachedInputTokens,
    });
    if (this.isRunning && this.isTTY) {
      this.render();
    }
  }

  /**
   * Update a nested agent with completion info (called when nested llm_call_end event received).
   * Records completion time to freeze the elapsed timer.
   * @param info - Full LLM call info including tokens, cache details, and cost
   */
  updateNestedAgent(
    id: string,
    info: {
      inputTokens?: number;
      outputTokens?: number;
      cachedInputTokens?: number;
      cacheCreationInputTokens?: number;
      reasoningTokens?: number;
      finishReason?: string;
      cost?: number;
    },
  ): void {
    const agent = this.nestedAgents.get(id);
    if (agent) {
      // Only update if new value is defined - preserve initial values from addNestedAgent()
      if (info.inputTokens !== undefined) agent.inputTokens = info.inputTokens;
      if (info.outputTokens !== undefined) agent.outputTokens = info.outputTokens;
      if (info.cachedInputTokens !== undefined) agent.cachedInputTokens = info.cachedInputTokens;
      if (info.cacheCreationInputTokens !== undefined)
        agent.cacheCreationInputTokens = info.cacheCreationInputTokens;
      if (info.reasoningTokens !== undefined) agent.reasoningTokens = info.reasoningTokens;
      if (info.finishReason !== undefined) agent.finishReason = info.finishReason;

      // Calculate cost if not provided and we have model registry
      if (info.cost !== undefined) {
        agent.cost = info.cost;
      } else if (this.modelRegistry && agent.model && agent.outputTokens) {
        // Calculate cost using model registry (first-class subagent metric)
        // Use agent.* values which include preserved initial values from addNestedAgent()
        try {
          const modelName = agent.model.includes(":") ? agent.model.split(":")[1] : agent.model;
          const costResult = this.modelRegistry.estimateCost(
            modelName,
            agent.inputTokens ?? 0,
            agent.outputTokens,
            agent.cachedInputTokens,
            agent.cacheCreationInputTokens,
            agent.reasoningTokens,
          );
          agent.cost = costResult?.totalCost;
        } catch {
          // Ignore cost calculation errors
        }
      }

      agent.completed = true;
      agent.completedTime = Date.now();
      if (this.isRunning && this.isTTY) {
        this.render();
      }
    }
  }

  /**
   * Remove a nested agent (called when the nested LLM call completes).
   */
  removeNestedAgent(id: string): void {
    this.nestedAgents.delete(id);
    if (this.isRunning && this.isTTY) {
      this.render();
    }
  }

  /**
   * Get a nested agent by ID (for accessing startTime, etc.).
   */
  getNestedAgent(id: string) {
    return this.nestedAgents.get(id);
  }

  /**
   * Get aggregated metrics from all nested agents for a parent gadget.
   * Used to show total token counts and cost for subagent gadgets like BrowseWeb.
   */
  getAggregatedSubagentMetrics(parentInvocationId: string): {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cost: number;
    callCount: number;
  } {
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;
    let cost = 0;
    let callCount = 0;

    for (const [, nested] of this.nestedAgents) {
      if (nested.parentInvocationId === parentInvocationId) {
        inputTokens += nested.inputTokens ?? 0;
        outputTokens += nested.outputTokens ?? 0;
        cachedInputTokens += nested.cachedInputTokens ?? 0;
        cost += nested.cost ?? 0;
        callCount++;
      }
    }

    return { inputTokens, outputTokens, cachedInputTokens, cost, callCount };
  }

  /**
   * Add a nested gadget call (called when nested gadget_call event received).
   */
  addNestedGadget(
    id: string,
    depth: number,
    parentInvocationId: string,
    name: string,
    parameters?: Record<string, unknown>,
  ): void {
    this.nestedGadgets.set(id, {
      depth,
      parentInvocationId,
      name,
      parameters,
      startTime: Date.now(),
    });
    if (this.isRunning && this.isTTY) {
      this.render();
    }
  }

  /**
   * Remove a nested gadget (called when nested gadget_result event received).
   */
  removeNestedGadget(id: string): void {
    this.nestedGadgets.delete(id);
    if (this.isRunning && this.isTTY) {
      this.render();
    }
  }

  /**
   * Get a nested gadget by ID (for accessing startTime, name, etc.).
   */
  getNestedGadget(id: string) {
    return this.nestedGadgets.get(id);
  }

  /**
   * Mark a nested gadget as completed (keeps it visible with ✓ indicator).
   * Records completion time to freeze the elapsed timer.
   */
  completeNestedGadget(id: string): void {
    const gadget = this.nestedGadgets.get(id);
    if (gadget) {
      gadget.completed = true;
      gadget.completedTime = Date.now();
      if (this.isRunning && this.isTTY) {
        this.render();
      }
    }
  }

  /**
   * Starts a new LLM call. Switches to streaming mode.
   * @param model - Model name being used
   * @param estimatedInputTokens - Initial input token count. Should come from
   *   client.countTokens() for accuracy (provider-specific counting), not
   *   character-based estimation. Will be updated with provider-returned counts
   *   via setInputTokens() during streaming if available.
   */
  startCall(model: string, estimatedInputTokens?: number): void {
    this.mode = "streaming";
    this.model = model;
    this.callStartTime = Date.now();
    this.currentIteration++;
    this.callInputTokens = estimatedInputTokens ?? 0;
    this.callInputTokensEstimated = true;
    this.callOutputTokens = 0;
    this.callOutputTokensEstimated = true;
    this.callOutputChars = 0;
    this.isStreaming = false;
    // Reset cache and reasoning tracking for new call
    this.callCachedInputTokens = 0;
    this.callCacheCreationInputTokens = 0;
    this.callReasoningTokens = 0;
    this.start();
  }

  /**
   * Ends the current LLM call. Updates cumulative stats and switches to cumulative mode.
   * @param usage - Final token usage from the call (including cached tokens if available)
   */
  endCall(usage?: TokenUsage): void {
    this.iterations++;
    if (usage) {
      this.totalTokens += usage.totalTokens;

      // Calculate and accumulate cost if model registry is available
      if (this.modelRegistry && this.model) {
        try {
          // Strip provider prefix if present (e.g., "openai:gpt-5-nano" -> "gpt-5-nano")
          const modelName = this.model.includes(":") ? this.model.split(":")[1] : this.model;

          const cost = this.modelRegistry.estimateCost(
            modelName,
            usage.inputTokens,
            usage.outputTokens,
            usage.cachedInputTokens ?? 0,
            usage.cacheCreationInputTokens ?? 0,
            usage.reasoningTokens ?? 0,
          );
          if (cost) {
            this.totalCost += cost.totalCost;
          }
        } catch {
          // Ignore errors (e.g., unknown model) - just don't add to cost
        }
      }
    }
    this.pause();
    this.mode = "cumulative";
  }

  /**
   * Adds gadget execution cost to the total.
   * Called when gadgets complete to include their costs (direct + subagent) in the total.
   */
  addGadgetCost(cost: number): void {
    if (cost > 0) {
      this.totalCost += cost;
    }
  }

  /**
   * Sets the input token count for current call (from stream metadata).
   * @param tokens - Token count from provider or client.countTokens()
   * @param estimated - If true, this is a fallback estimate (character-based).
   *   If false, this is an accurate count from the provider API or client.countTokens().
   *   Display shows ~ prefix only when estimated=true.
   */
  setInputTokens(tokens: number, estimated = false): void {
    // Don't overwrite actual count with a new estimate
    if (estimated && !this.callInputTokensEstimated) {
      return;
    }
    this.callInputTokens = tokens;
    this.callInputTokensEstimated = estimated;
  }

  /**
   * Sets the output token count for current call (from stream metadata).
   * @param tokens - Token count from provider streaming response
   * @param estimated - If true, this is a fallback estimate (character-based).
   *   If false, this is an accurate count from the provider's streaming metadata.
   *   Display shows ~ prefix only when estimated=true.
   */
  setOutputTokens(tokens: number, estimated = false): void {
    // Don't overwrite actual count with a new estimate
    if (estimated && !this.callOutputTokensEstimated) {
      return;
    }
    this.callOutputTokens = tokens;
    this.callOutputTokensEstimated = estimated;
  }

  /**
   * Sets cached token counts for the current call (from stream metadata).
   * Used for live cost estimation during streaming.
   * @param cachedInputTokens - Number of tokens read from cache (cheaper)
   * @param cacheCreationInputTokens - Number of tokens written to cache (more expensive)
   */
  setCachedTokens(cachedInputTokens: number, cacheCreationInputTokens: number): void {
    this.callCachedInputTokens = cachedInputTokens;
    this.callCacheCreationInputTokens = cacheCreationInputTokens;
  }

  /**
   * Sets reasoning token count for the current call (from stream metadata).
   * Used for live cost estimation during streaming.
   * @param reasoningTokens - Number of reasoning/thinking tokens (subset of outputTokens)
   */
  setReasoningTokens(reasoningTokens: number): void {
    this.callReasoningTokens = reasoningTokens;
  }

  /**
   * Get total elapsed time in seconds since the first call started.
   * @returns Elapsed time in seconds with 1 decimal place
   */
  getTotalElapsedSeconds(): number {
    if (this.totalStartTime === 0) return 0;
    return Number(((Date.now() - this.totalStartTime) / 1000).toFixed(1));
  }

  /**
   * Get elapsed time in seconds for the current call.
   * @returns Elapsed time in seconds with 1 decimal place
   */
  getCallElapsedSeconds(): number {
    return Number(((Date.now() - this.callStartTime) / 1000).toFixed(1));
  }

  /**
   * Starts the progress indicator animation after a brief delay.
   */
  start(): void {
    if (!this.isTTY || this.isRunning) return;
    this.isRunning = true;

    // Delay showing spinner to avoid flicker for fast responses
    this.delayTimeout = setTimeout(() => {
      if (this.isRunning) {
        this.interval = setInterval(() => this.render(), 80);
        this.render();
      }
    }, SPINNER_DELAY_MS);
  }

  /**
   * Updates output character count for current call and marks streaming as active.
   * @param totalChars - Total accumulated character count
   */
  update(totalChars: number): void {
    this.callOutputChars = totalChars;
    this.isStreaming = true;
  }

  private render(): void {
    // Clear previous multi-line render before drawing new content
    this.clearRenderedLines();

    const spinner = SPINNER_FRAMES[this.frameIndex++ % SPINNER_FRAMES.length];
    const lines: string[] = [];

    // Collect actively streaming nested agents (to show at bottom, not in hierarchy)
    const activeNestedStreams: Array<{
      depth: number;
      iteration: number;
      parentCallNumber?: number;
      gadgetInvocationId?: string;
      model: string;
      inputTokens?: number;
      cachedInputTokens?: number;
      outputTokens?: number;
      cost?: number;
      startTime: number;
      parentGadgetName: string; // For prefixing nested operation lines
    }> = [];

    // In-flight gadgets - ONLY show gadgets that are still running
    // Completed gadgets are printed inline when they finish (via completeGadget)
    if (this.isTTY) {
      for (const [gadgetId, gadget] of this.inFlightGadgets) {
        // Skip completed gadgets - they were already printed inline
        if (gadget.completed) {
          continue;
        }
        const elapsedSeconds = (Date.now() - gadget.startTime) / 1000;

        // Get aggregated subagent metrics for realtime display
        const subagentMetrics = this.getAggregatedSubagentMetrics(gadgetId);

        // Use shared formatGadgetLine for consistent formatting with parameters
        // Pass maxWidth adjusted for 2-space indent
        const termWidth = process.stdout.columns ?? 80;
        const gadgetIndent = "  ";
        const line = formatGadgetLine(
          {
            name: gadget.name,
            parameters: gadget.params,
            elapsedSeconds,
            isComplete: false, // We only show running gadgets here
            // Pass realtime subagent metrics
            subagentInputTokens: subagentMetrics.inputTokens,
            subagentOutputTokens: subagentMetrics.outputTokens,
            subagentCachedTokens: subagentMetrics.cachedInputTokens,
            subagentCost: subagentMetrics.cost,
          },
          termWidth - gadgetIndent.length,
        );
        // Add indent to EACH line of multi-line output
        const gadgetLine = line
          .split("\n")
          .map((l) => gadgetIndent + l)
          .join("\n");
        lines.push(gadgetLine);

        // Build unified timeline of nested operations sorted by startTime
        // This fixes the display ordering bug where agents were grouped above gadgets
        const nestedOps: Array<{
          type: "agent" | "gadget";
          startTime: number;
          depth: number;
          // Agent-specific fields
          iteration?: number;
          parentCallNumber?: number;
          gadgetInvocationId?: string;
          model?: string;
          inputTokens?: number;
          cachedInputTokens?: number;
          outputTokens?: number;
          cost?: number;
          finishReason?: string;
          completed?: boolean;
          completedTime?: number;
          // Gadget-specific fields
          id?: string; // For metrics aggregation
          name?: string;
          parameters?: Record<string, unknown>;
        }> = [];

        // Collect nested agents for this parent
        for (const [_agentId, nested] of this.nestedAgents) {
          if (nested.parentInvocationId === gadgetId) {
            nestedOps.push({
              type: "agent",
              startTime: nested.startTime,
              depth: nested.depth,
              iteration: nested.iteration,
              parentCallNumber: nested.parentCallNumber,
              gadgetInvocationId: nested.gadgetInvocationId,
              model: nested.model,
              inputTokens: nested.inputTokens,
              cachedInputTokens: nested.cachedInputTokens,
              outputTokens: nested.outputTokens,
              cost: nested.cost,
              finishReason: nested.finishReason,
              completed: nested.completed,
              completedTime: nested.completedTime,
            });

            // Collect actively streaming agents for bottom section
            if (!nested.completed) {
              activeNestedStreams.push({
                depth: nested.depth,
                iteration: nested.iteration,
                parentCallNumber: nested.parentCallNumber,
                gadgetInvocationId: nested.gadgetInvocationId,
                model: nested.model,
                inputTokens: nested.inputTokens,
                cachedInputTokens: nested.cachedInputTokens,
                outputTokens: nested.outputTokens,
                cost: nested.cost,
                startTime: nested.startTime,
                parentGadgetName: gadget.name, // Track parent for prefixing
              });
            }
          }
        }

        // Collect nested gadgets for this parent
        for (const [nestedId, nestedGadget] of this.nestedGadgets) {
          if (nestedGadget.parentInvocationId === gadgetId) {
            nestedOps.push({
              type: "gadget",
              id: nestedId, // Preserve ID for metrics aggregation
              startTime: nestedGadget.startTime,
              depth: nestedGadget.depth,
              name: nestedGadget.name,
              parameters: nestedGadget.parameters,
              completed: nestedGadget.completed,
              completedTime: nestedGadget.completedTime,
            });
          }
        }

        // Sort by startTime for chronological display
        nestedOps.sort((a, b) => a.startTime - b.startTime);

        // Render in chronological order using shared formatting functions
        // Nested operations are indented under parent gadget (which has 2-space indent)
        // So base indent is 4 spaces, plus 2 more for each depth level
        // SKIP completed ops (printed inline) and streaming agents (shown at bottom)
        for (const op of nestedOps) {
          // Skip ALL completed operations - they were printed inline when they finished
          if (op.completed) {
            continue;
          }

          // Skip in-progress agents - they're shown in active streams section at bottom
          if (op.type === "agent") {
            continue;
          }

          // Only in-progress GADGETS reach here - render them
          const indent = "  ".repeat(op.depth + 2);
          const elapsedSeconds = (Date.now() - op.startTime) / 1000;

          // Get aggregated subagent metrics (for nested gadgets that run LLM calls)
          const nestedMetrics = op.id
            ? this.getAggregatedSubagentMetrics(op.id)
            : { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cost: 0, callCount: 0 };

          // Use shared formatGadgetLine for consistent formatting
          // Pass maxWidth adjusted for indent to prevent line overflow
          const termWidth = process.stdout.columns ?? 80;
          // Parent gadget prefix for nested operations
          const parentPrefix = `${chalk.dim(`${gadget.name}:`)} `;
          const line = formatGadgetLine(
            {
              name: op.name ?? "",
              parameters: op.parameters,
              elapsedSeconds,
              isComplete: false, // Only in-progress gadgets reach here
              // Pass realtime subagent metrics
              subagentInputTokens: nestedMetrics.inputTokens,
              subagentOutputTokens: nestedMetrics.outputTokens,
              subagentCachedTokens: nestedMetrics.cachedInputTokens,
              subagentCost: nestedMetrics.cost,
            },
            termWidth - indent.length - parentPrefix.length,
          );
          // Add indent and parent prefix to EACH line of multi-line output
          const indentedLine = line
            .split("\n")
            .map((l) => indent + parentPrefix + l)
            .join("\n");
          lines.push(indentedLine);
        }
      }
    }

    // ACTIVE STREAMS SECTION: Show all actively streaming LLM calls at bottom
    // Ordered from innermost (top) to outermost (bottom) - like a call stack
    // This shows nested streams first, then the main agent line below them

    // Nested active streams FIRST (they are "inside" the main agent context)
    for (const stream of activeNestedStreams) {
      // Use depth-based indent to align with completed nested agents in hierarchy
      const indent = "  ".repeat(stream.depth + 2);
      // Parent gadget prefix for nested operations
      const parentPrefix = `${chalk.dim(`${stream.parentGadgetName}:`)} `;
      const elapsedSeconds = (Date.now() - stream.startTime) / 1000;
      const line = formatLLMCallLine({
        iteration: stream.iteration,
        parentCallNumber: stream.parentCallNumber,
        gadgetInvocationId: stream.gadgetInvocationId,
        model: stream.model,
        inputTokens: stream.inputTokens,
        cachedInputTokens: stream.cachedInputTokens,
        outputTokens: stream.outputTokens,
        elapsedSeconds,
        cost: stream.cost,
        isStreaming: true,
        spinner,
      });
      lines.push(`${indent}${parentPrefix}${line}`);
    }

    // Main progress line LAST (it's the outer/root context)
    if (this.mode === "streaming") {
      lines.push(this.formatStreamingLine(spinner));
    } else {
      lines.push(this.formatCumulativeLine(spinner));
    }

    // Write all lines and track count for clearing
    const output = lines.join("\n");
    // Count actual terminal lines (some elements may contain \n for multi-line gadgets)
    this.lastRenderLineCount = (output.match(/\n/g) || []).length + 1;
    // Use \r to return to start of first line, then join with newlines
    // Each line ends implicitly, cursor stays at end of last line
    this.target.write("\r" + output);
    this.hasRendered = true;
  }

  /**
   * Clears the previously rendered lines (for multi-line status display).
   */
  private clearRenderedLines(): void {
    if (!this.hasRendered || this.lastRenderLineCount === 0) return;

    // First, clear the current line
    this.target.write("\r\x1b[K");

    // Then move up and clear each additional line
    for (let i = 1; i < this.lastRenderLineCount; i++) {
      // Move up one line and clear it
      this.target.write("\x1b[1A\x1b[K");
    }

    // Return cursor to start
    this.target.write("\r");
  }

  /**
   * Clear rendered lines and reset counter.
   * Call this before printing static output that should remain visible
   * above the render zone (e.g., opening/closing lines for nested operations).
   */
  clearAndReset(): void {
    if (this.isTTY) {
      this.clearRenderedLines();
    }
    this.lastRenderLineCount = 0;
    this.hasRendered = false;
  }

  /**
   * Format the streaming mode progress line (returns string, doesn't write).
   * Uses the shared formatLLMCallLine() function for consistent formatting
   * between main agent and nested subagent displays.
   */
  private formatStreamingLine(spinner: string): string {
    // Output tokens: use actual if available, otherwise estimate from chars
    const outTokens = this.callOutputTokensEstimated
      ? Math.round(this.callOutputChars / FALLBACK_CHARS_PER_TOKEN)
      : this.callOutputTokens;

    // Use shared formatting function for consistent display
    return formatLLMCallLine({
      iteration: this.currentIteration,
      model: this.model ?? "",
      inputTokens: this.callInputTokens,
      cachedInputTokens: this.callCachedInputTokens,
      outputTokens: outTokens,
      elapsedSeconds: (Date.now() - this.callStartTime) / 1000,
      cost: this.calculateCurrentCallCost(outTokens),
      isStreaming: true,
      spinner,
      contextPercent: this.getContextUsagePercent(),
      estimated: {
        input: this.callInputTokensEstimated,
        output: this.callOutputTokensEstimated,
      },
    });
  }

  /**
   * Calculates live cost estimate for the current streaming call.
   * Uses current input/output tokens and cached token counts.
   */
  private calculateCurrentCallCost(outputTokens: number): number {
    if (!this.modelRegistry || !this.model) return 0;

    try {
      // Strip provider prefix if present (e.g., "anthropic:claude-sonnet-4-5" -> "claude-sonnet-4-5")
      const modelName = this.model.includes(":") ? this.model.split(":")[1] : this.model;

      const cost = this.modelRegistry.estimateCost(
        modelName,
        this.callInputTokens,
        outputTokens,
        this.callCachedInputTokens,
        this.callCacheCreationInputTokens,
        this.callReasoningTokens,
      );

      return cost?.totalCost ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Calculates context window usage percentage.
   * Returns null if model is unknown or context window unavailable.
   */
  private getContextUsagePercent(): number | null {
    if (!this.modelRegistry || !this.model || this.callInputTokens === 0) {
      return null;
    }

    // Strip provider prefix if present (e.g., "anthropic:claude-sonnet-4-5" -> "claude-sonnet-4-5")
    const modelName = this.model.includes(":") ? this.model.split(":")[1] : this.model;

    const limits = this.modelRegistry.getModelLimits(modelName);
    if (!limits?.contextWindow) {
      return null;
    }

    return (this.callInputTokens / limits.contextWindow) * 100;
  }

  /**
   * Format the cumulative mode progress line (returns string, doesn't write).
   */
  private formatCumulativeLine(spinner: string): string {
    const elapsed = ((Date.now() - this.totalStartTime) / 1000).toFixed(1);

    // Build status parts: model, total tokens, iterations, cost, total time
    const parts: string[] = [];
    if (this.model) {
      parts.push(chalk.cyan(this.model));
    }
    if (this.totalTokens > 0) {
      parts.push(chalk.dim("total:") + chalk.magenta(` ${this.totalTokens}`));
    }
    if (this.iterations > 0) {
      parts.push(chalk.dim("iter:") + chalk.blue(` ${this.iterations}`));
    }
    if (this.totalCost > 0) {
      parts.push(chalk.dim("cost:") + chalk.cyan(` $${formatCost(this.totalCost)}`));
    }
    parts.push(chalk.dim(`${elapsed}s`));

    return `${parts.join(chalk.dim(" | "))} ${chalk.cyan(spinner)}`;
  }

  /**
   * Pauses the progress indicator and clears all rendered lines.
   * Can be resumed with start().
   */
  pause(): void {
    if (!this.isTTY || !this.isRunning) return;

    if (this.delayTimeout) {
      clearTimeout(this.delayTimeout);
      this.delayTimeout = null;
    }
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;

    // Clear all rendered lines (multi-line status display)
    this.clearRenderedLines();
    this.hasRendered = false;
    this.lastRenderLineCount = 0;
  }

  /**
   * Completes the progress indicator and clears the line.
   */
  complete(): void {
    this.pause();
  }

  /**
   * Returns the total accumulated cost across all calls.
   */
  getTotalCost(): number {
    return this.totalCost;
  }

  /**
   * Returns a formatted stats string for cancellation messages.
   * Format: "↑ 1.2k | ↓ 300 | 5.0s"
   */
  formatStats(): string {
    const parts: string[] = [];
    const elapsed = ((Date.now() - this.callStartTime) / 1000).toFixed(1);

    // Output tokens: use actual if available, otherwise estimate from chars
    const outTokens = this.callOutputTokensEstimated
      ? Math.round(this.callOutputChars / FALLBACK_CHARS_PER_TOKEN)
      : this.callOutputTokens;

    if (this.callInputTokens > 0) {
      const prefix = this.callInputTokensEstimated ? "~" : "";
      parts.push(`↑ ${prefix}${formatTokens(this.callInputTokens)}`);
    }

    if (outTokens > 0) {
      const prefix = this.callOutputTokensEstimated ? "~" : "";
      parts.push(`↓ ${prefix}${formatTokens(outTokens)}`);
    }

    parts.push(`${elapsed}s`);

    return parts.join(" | ");
  }

  /**
   * Returns a formatted prompt string with stats (like bash PS1).
   * Shows current call stats during streaming, cumulative stats otherwise.
   * Format: "out: 1.2k │ in: ~300 │ 5s > " or "3.6k │ i2 │ 34s > "
   */
  formatPrompt(): string {
    const parts: string[] = [];

    if (this.mode === "streaming") {
      // During a call: show current call stats
      const elapsed = Math.round((Date.now() - this.callStartTime) / 1000);

      // Output tokens: use actual if available, otherwise estimate from chars
      const outTokens = this.callOutputTokensEstimated
        ? Math.round(this.callOutputChars / FALLBACK_CHARS_PER_TOKEN)
        : this.callOutputTokens;
      const outEstimated = this.callOutputTokensEstimated;

      if (this.callInputTokens > 0) {
        const prefix = this.callInputTokensEstimated ? "~" : "";
        parts.push(
          chalk.dim("↑") + chalk.yellow(` ${prefix}${formatTokens(this.callInputTokens)}`),
        );
      }
      if (outTokens > 0) {
        const prefix = outEstimated ? "~" : "";
        parts.push(chalk.dim("↓") + chalk.green(` ${prefix}${formatTokens(outTokens)}`));
      }
      parts.push(chalk.dim(`${elapsed}s`));
    } else {
      // Between calls: show cumulative stats
      const elapsed = Math.round((Date.now() - this.totalStartTime) / 1000);

      if (this.totalTokens > 0) {
        parts.push(chalk.magenta(formatTokens(this.totalTokens)));
      }
      if (this.iterations > 0) {
        parts.push(chalk.blue(`i${this.iterations}`));
      }
      if (this.totalCost > 0) {
        parts.push(chalk.cyan(`$${formatCost(this.totalCost)}`));
      }
      parts.push(chalk.dim(`${elapsed}s`));
    }

    return `${parts.join(chalk.dim(" | "))} ${chalk.green(">")} `;
  }
}

/**
 * Reads all data from a readable stream into a string.
 *
 * @param stream - Stream to read from
 * @returns Complete stream contents as string
 */
async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    if (typeof chunk === "string") {
      chunks.push(chunk);
    } else {
      chunks.push(chunk.toString("utf8"));
    }
  }
  return chunks.join("");
}

/**
 * Normalizes a prompt by trimming whitespace.
 *
 * @param value - Prompt to normalize
 * @returns Trimmed prompt
 */
function normalizePrompt(value: string): string {
  return value.trim();
}

/**
 * Resolves the user prompt from either command-line argument or stdin.
 * Priority: 1) promptArg if provided, 2) stdin if piped, 3) error if neither.
 *
 * @param promptArg - Optional prompt from command-line argument
 * @param env - CLI environment for accessing stdin
 * @returns Resolved and normalized prompt
 * @throws Error if no prompt available or stdin is empty
 */
export async function resolvePrompt(
  promptArg: string | undefined,
  env: CLIEnvironment,
): Promise<string> {
  if (promptArg?.trim()) {
    return normalizePrompt(promptArg);
  }

  if (isInteractive(env.stdin)) {
    throw new Error("Prompt is required. Provide an argument or pipe content via stdin.");
  }

  const pipedInput = normalizePrompt(await readStream(env.stdin));
  if (!pipedInput) {
    throw new Error("Received empty stdin payload. Provide a prompt to continue.");
  }

  return pipedInput;
}

// Re-export summary rendering from formatters module
// This maintains backward compatibility while organizing code better
export { renderSummary, type SummaryMetadata } from "./ui/formatters.js";

/**
 * Executes a CLI action with error handling.
 * Catches errors, writes to stderr, and sets exit code 1 on failure.
 *
 * @param action - Async action to execute
 * @param env - CLI environment for error output and exit code
 */
export async function executeAction(
  action: () => Promise<void>,
  env: CLIEnvironment,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    // Format error message - formatLLMError handles LLM API errors gracefully
    // and falls through to original message for other error types
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = error instanceof Error ? formatLLMError(error) : rawMessage;
    env.stderr.write(`${chalk.red.bold("Error:")} ${message}\n`);
    env.setExitCode(1);
  }
}
