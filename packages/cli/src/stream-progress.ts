import chalk from "chalk";
import type { ModelRegistry, TokenUsage } from "llmist";
import { FALLBACK_CHARS_PER_TOKEN } from "llmist";
import { CallStatsTracker } from "./progress/call-stats-tracker.js";
import { GadgetTracker } from "./progress/gadget-tracker.js";
import { NestedOperationTracker } from "./progress/nested-operation-tracker.js";
import { formatCost, formatGadgetLine, formatLLMCallLine, formatTokens } from "./ui/formatters.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_DELAY_MS = 500; // Don't show spinner for fast responses

export type ProgressMode = "streaming" | "cumulative";

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

  // LLM call stats tracker (single responsibility for all call metrics)
  private callStatsTracker: CallStatsTracker;

  // In-flight gadget tracking for concurrent status display
  private gadgetTracker = new GadgetTracker();

  // Nested agent + gadget tracking for hierarchical subagent display
  private nestedOperationTracker: NestedOperationTracker;

  constructor(
    private readonly target: NodeJS.WritableStream,
    private readonly isTTY: boolean,
    modelRegistry?: ModelRegistry,
  ) {
    this.callStatsTracker = new CallStatsTracker(modelRegistry);
    this.nestedOperationTracker = new NestedOperationTracker(modelRegistry);
  }

  // ===== Delegating accessors for test compatibility =====
  // Tests access these via (progress as any).fieldName

  private get mode(): ProgressMode {
    return this.callStatsTracker.mode;
  }

  private get model(): string {
    return this.callStatsTracker.model;
  }

  private get callStartTime(): number {
    return this.callStatsTracker.callStartTime;
  }

  private get callInputTokens(): number {
    return this.callStatsTracker.callInputTokens;
  }

  private get callInputTokensEstimated(): boolean {
    return this.callStatsTracker.callInputTokensEstimated;
  }

  private get callOutputTokens(): number {
    return this.callStatsTracker.callOutputTokens;
  }

  private get callOutputTokensEstimated(): boolean {
    return this.callStatsTracker.callOutputTokensEstimated;
  }

  private get callOutputChars(): number {
    return this.callStatsTracker.callOutputChars;
  }

  private set callOutputChars(value: number) {
    this.callStatsTracker.callOutputChars = value;
  }

  private get totalStartTime(): number {
    return this.callStatsTracker.totalStartTime;
  }

  private get totalTokens(): number {
    return this.callStatsTracker.totalTokens;
  }

  private get totalCost(): number {
    return this.callStatsTracker.totalCost;
  }

  private get iterations(): number {
    return this.callStatsTracker.iterations;
  }

  private get currentIteration(): number {
    return this.callStatsTracker.currentIteration;
  }

  // ===== End delegating accessors =====

  /**
   * Expose the underlying in-flight gadgets map for compatibility.
   * @internal Used by tests and render logic to access gadget state directly.
   */
  private get inFlightGadgets() {
    return this.gadgetTracker.getMap();
  }

  /**
   * Add a gadget to the in-flight tracking (called when gadget_call event received).
   * Triggers re-render to show the gadget in the status display.
   */
  addGadget(invocationId: string, name: string, params?: Record<string, unknown>): void {
    this.gadgetTracker.addGadget(invocationId, name, params);
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
    this.gadgetTracker.removeGadget(invocationId);
    // Re-render immediately to remove the gadget from display
    if (this.isRunning && this.isTTY) {
      this.render();
    }
  }

  /**
   * Check if there are any gadgets currently in flight.
   */
  hasInFlightGadgets(): boolean {
    return this.gadgetTracker.hasInFlightGadgets();
  }

  /**
   * Get a gadget by ID (for accessing name, params, etc.).
   */
  getGadget(invocationId: string) {
    return this.gadgetTracker.getGadget(invocationId);
  }

  /**
   * Mark a gadget as completed (keeps it visible with ✓ indicator).
   * Records completion time to freeze the elapsed timer.
   * The gadget and its nested operations remain visible until clearCompletedGadgets() is called.
   */
  completeGadget(invocationId: string): void {
    const found = this.gadgetTracker.completeGadget(invocationId);
    if (found && this.isRunning && this.isTTY) {
      this.render();
    }
  }

  /**
   * Clear all completed gadgets from the display.
   * Called when new text output arrives to clean up the finished gadget section.
   */
  clearCompletedGadgets(): void {
    const clearedIds = this.gadgetTracker.clearCompletedGadgets();
    // Also clean up nested operations for each cleared gadget
    for (const id of clearedIds) {
      this.nestedOperationTracker.clearByParentInvocationId(id);
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
    this.nestedOperationTracker.addNestedAgent(
      id,
      parentInvocationId,
      depth,
      model,
      iteration,
      info,
      parentCallNumber,
      gadgetInvocationId,
    );
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
    const hadAgent = this.nestedOperationTracker.getNestedAgent(id) !== undefined;
    this.nestedOperationTracker.updateNestedAgent(id, info);
    if (hadAgent && this.isRunning && this.isTTY) {
      this.render();
    }
  }

  /**
   * Remove a nested agent (called when the nested LLM call completes).
   */
  removeNestedAgent(id: string): void {
    this.nestedOperationTracker.removeNestedAgent(id);
    if (this.isRunning && this.isTTY) {
      this.render();
    }
  }

  /**
   * Get a nested agent by ID (for accessing startTime, etc.).
   */
  getNestedAgent(id: string) {
    return this.nestedOperationTracker.getNestedAgent(id);
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
    return this.nestedOperationTracker.getAggregatedSubagentMetrics(parentInvocationId);
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
    this.nestedOperationTracker.addNestedGadget(id, depth, parentInvocationId, name, parameters);
    if (this.isRunning && this.isTTY) {
      this.render();
    }
  }

  /**
   * Remove a nested gadget (called when nested gadget_result event received).
   */
  removeNestedGadget(id: string): void {
    this.nestedOperationTracker.removeNestedGadget(id);
    if (this.isRunning && this.isTTY) {
      this.render();
    }
  }

  /**
   * Get a nested gadget by ID (for accessing startTime, name, etc.).
   */
  getNestedGadget(id: string) {
    return this.nestedOperationTracker.getNestedGadget(id);
  }

  /**
   * Mark a nested gadget as completed (keeps it visible with ✓ indicator).
   * Records completion time to freeze the elapsed timer.
   */
  completeNestedGadget(id: string): void {
    const hadGadget = this.nestedOperationTracker.getNestedGadget(id) !== undefined;
    this.nestedOperationTracker.completeNestedGadget(id);
    if (hadGadget && this.isRunning && this.isTTY) {
      this.render();
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
    this.callStatsTracker.startCall(model, estimatedInputTokens);
    this.start();
  }

  /**
   * Ends the current LLM call. Updates cumulative stats and switches to cumulative mode.
   * @param usage - Final token usage from the call (including cached tokens if available)
   */
  endCall(usage?: TokenUsage): void {
    this.callStatsTracker.endCall(usage);
    this.pause();
  }

  /**
   * Adds gadget execution cost to the total.
   * Called when gadgets complete to include their costs (direct + subagent) in the total.
   */
  addGadgetCost(cost: number): void {
    this.callStatsTracker.addGadgetCost(cost);
  }

  /**
   * Sets the input token count for current call (from stream metadata).
   * @param tokens - Token count from provider or client.countTokens()
   * @param estimated - If true, this is a fallback estimate (character-based).
   *   If false, this is an accurate count from the provider API or client.countTokens().
   *   Display shows ~ prefix only when estimated=true.
   */
  setInputTokens(tokens: number, estimated = false): void {
    this.callStatsTracker.setInputTokens(tokens, estimated);
  }

  /**
   * Sets the output token count for current call (from stream metadata).
   * @param tokens - Token count from provider streaming response
   * @param estimated - If true, this is a fallback estimate (character-based).
   *   If false, this is an accurate count from the provider's streaming metadata.
   *   Display shows ~ prefix only when estimated=true.
   */
  setOutputTokens(tokens: number, estimated = false): void {
    this.callStatsTracker.setOutputTokens(tokens, estimated);
  }

  /**
   * Sets cached token counts for the current call (from stream metadata).
   * Used for live cost estimation during streaming.
   * @param cachedInputTokens - Number of tokens read from cache (cheaper)
   * @param cacheCreationInputTokens - Number of tokens written to cache (more expensive)
   */
  setCachedTokens(cachedInputTokens: number, cacheCreationInputTokens: number): void {
    this.callStatsTracker.setCachedTokens(cachedInputTokens, cacheCreationInputTokens);
  }

  /**
   * Sets reasoning token count for the current call (from stream metadata).
   * Used for live cost estimation during streaming.
   * @param reasoningTokens - Number of reasoning/thinking tokens (subset of outputTokens)
   */
  setReasoningTokens(reasoningTokens: number): void {
    this.callStatsTracker.setReasoningTokens(reasoningTokens);
  }

  /**
   * Get total elapsed time in seconds since the first call started.
   * @returns Elapsed time in seconds with 1 decimal place
   */
  getTotalElapsedSeconds(): number {
    return this.callStatsTracker.getTotalElapsedSeconds();
  }

  /**
   * Get elapsed time in seconds for the current call.
   * @returns Elapsed time in seconds with 1 decimal place
   */
  getCallElapsedSeconds(): number {
    return this.callStatsTracker.getCallElapsedSeconds();
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
    this.callStatsTracker.callOutputChars = totalChars;
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
        for (const [_agentId, nested] of this.nestedOperationTracker.getNestedAgentsMap()) {
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
        for (const [nestedId, nestedGadget] of this.nestedOperationTracker.getNestedGadgetsMap()) {
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
    this.target.write(`\r${output}`);
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
      cachedInputTokens: this.callStatsTracker.callCachedInputTokens,
      outputTokens: outTokens,
      elapsedSeconds: (Date.now() - this.callStartTime) / 1000,
      cost: this.callStatsTracker.calculateCurrentCallCost(outTokens),
      isStreaming: true,
      spinner,
      contextPercent: this.callStatsTracker.getContextUsagePercent(),
      estimated: {
        input: this.callInputTokensEstimated,
        output: this.callOutputTokensEstimated,
      },
    });
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
    return this.callStatsTracker.totalCost;
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
