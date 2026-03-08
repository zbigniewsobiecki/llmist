import chalk from "chalk";
import { FALLBACK_CHARS_PER_TOKEN } from "llmist";
import { formatCost, formatGadgetLine, formatLLMCallLine, formatTokens } from "../ui/formatters.js";
import type { CallStatsTracker } from "./call-stats-tracker.js";
import type { GadgetTracker } from "./gadget-tracker.js";
import type { NestedOperationTracker } from "./nested-operation-tracker.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_DELAY_MS = 500; // Don't show spinner for fast responses

/**
 * Manages animation state and all terminal rendering logic for StreamProgress.
 * Reads state via accessor methods from the tracker classes (GadgetTracker,
 * NestedOperationTracker, CallStatsTracker) and delegates rendering to this class.
 *
 * Single responsibility: animation state + rendering logic only.
 */
export class ProgressRenderer {
  // Animation state
  private frameIndex = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private delayTimeout: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private hasRendered = false;
  private lastRenderLineCount = 0; // Track lines rendered for multi-line clearing

  constructor(
    private readonly target: NodeJS.WritableStream,
    private readonly isTTY: boolean,
    private readonly callStatsTracker: CallStatsTracker,
    private readonly gadgetTracker: GadgetTracker,
    private readonly nestedOperationTracker: NestedOperationTracker,
  ) {}

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
   * Triggers an immediate re-render if the progress indicator is running.
   */
  triggerRender(): void {
    if (this.isRunning && this.isTTY) {
      this.render();
    }
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

  render(): void {
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
      for (const [gadgetId, gadget] of this.gadgetTracker.getMap()) {
        // Skip completed gadgets - they were already printed inline
        if (gadget.completed) {
          continue;
        }
        const elapsedSeconds = (Date.now() - gadget.startTime) / 1000;

        // Get aggregated subagent metrics for realtime display
        const subagentMetrics = this.nestedOperationTracker.getAggregatedSubagentMetrics(gadgetId);

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
            ? this.nestedOperationTracker.getAggregatedSubagentMetrics(op.id)
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
    if (this.callStatsTracker.mode === "streaming") {
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
   * Format the streaming mode progress line (returns string, doesn't write).
   * Uses the shared formatLLMCallLine() function for consistent formatting
   * between main agent and nested subagent displays.
   */
  formatStreamingLine(spinner: string): string {
    // Output tokens: use actual if available, otherwise estimate from chars
    const outTokens = this.callStatsTracker.callOutputTokensEstimated
      ? Math.round(this.callStatsTracker.callOutputChars / FALLBACK_CHARS_PER_TOKEN)
      : this.callStatsTracker.callOutputTokens;

    // Use shared formatting function for consistent display
    return formatLLMCallLine({
      iteration: this.callStatsTracker.currentIteration,
      model: this.callStatsTracker.model ?? "",
      inputTokens: this.callStatsTracker.callInputTokens,
      cachedInputTokens: this.callStatsTracker.callCachedInputTokens,
      outputTokens: outTokens,
      elapsedSeconds: (Date.now() - this.callStatsTracker.callStartTime) / 1000,
      cost: this.callStatsTracker.calculateCurrentCallCost(outTokens),
      isStreaming: true,
      spinner,
      contextPercent: this.callStatsTracker.getContextUsagePercent(),
      estimated: {
        input: this.callStatsTracker.callInputTokensEstimated,
        output: this.callStatsTracker.callOutputTokensEstimated,
      },
    });
  }

  /**
   * Format the cumulative mode progress line (returns string, doesn't write).
   */
  formatCumulativeLine(spinner: string): string {
    const elapsed = ((Date.now() - this.callStatsTracker.totalStartTime) / 1000).toFixed(1);

    // Build status parts: model, total tokens, iterations, cost, total time
    const parts: string[] = [];
    if (this.callStatsTracker.model) {
      parts.push(chalk.cyan(this.callStatsTracker.model));
    }
    if (this.callStatsTracker.totalTokens > 0) {
      parts.push(chalk.dim("total:") + chalk.magenta(` ${this.callStatsTracker.totalTokens}`));
    }
    if (this.callStatsTracker.iterations > 0) {
      parts.push(chalk.dim("iter:") + chalk.blue(` ${this.callStatsTracker.iterations}`));
    }
    if (this.callStatsTracker.totalCost > 0) {
      parts.push(
        chalk.dim("cost:") + chalk.cyan(` $${formatCost(this.callStatsTracker.totalCost)}`),
      );
    }
    parts.push(chalk.dim(`${elapsed}s`));

    return `${parts.join(chalk.dim(" | "))} ${chalk.cyan(spinner)}`;
  }

  /**
   * Returns a formatted stats string for cancellation messages.
   * Format: "↑ 1.2k | ↓ 300 | 5.0s"
   */
  formatStats(): string {
    const parts: string[] = [];
    const elapsed = ((Date.now() - this.callStatsTracker.callStartTime) / 1000).toFixed(1);

    // Output tokens: use actual if available, otherwise estimate from chars
    const outTokens = this.callStatsTracker.callOutputTokensEstimated
      ? Math.round(this.callStatsTracker.callOutputChars / FALLBACK_CHARS_PER_TOKEN)
      : this.callStatsTracker.callOutputTokens;

    if (this.callStatsTracker.callInputTokens > 0) {
      const prefix = this.callStatsTracker.callInputTokensEstimated ? "~" : "";
      parts.push(`↑ ${prefix}${formatTokens(this.callStatsTracker.callInputTokens)}`);
    }

    if (outTokens > 0) {
      const prefix = this.callStatsTracker.callOutputTokensEstimated ? "~" : "";
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

    if (this.callStatsTracker.mode === "streaming") {
      // During a call: show current call stats
      const elapsed = Math.round((Date.now() - this.callStatsTracker.callStartTime) / 1000);

      // Output tokens: use actual if available, otherwise estimate from chars
      const outTokens = this.callStatsTracker.callOutputTokensEstimated
        ? Math.round(this.callStatsTracker.callOutputChars / FALLBACK_CHARS_PER_TOKEN)
        : this.callStatsTracker.callOutputTokens;
      const outEstimated = this.callStatsTracker.callOutputTokensEstimated;

      if (this.callStatsTracker.callInputTokens > 0) {
        const prefix = this.callStatsTracker.callInputTokensEstimated ? "~" : "";
        parts.push(
          chalk.dim("↑") +
            chalk.yellow(` ${prefix}${formatTokens(this.callStatsTracker.callInputTokens)}`),
        );
      }
      if (outTokens > 0) {
        const prefix = outEstimated ? "~" : "";
        parts.push(chalk.dim("↓") + chalk.green(` ${prefix}${formatTokens(outTokens)}`));
      }
      parts.push(chalk.dim(`${elapsed}s`));
    } else {
      // Between calls: show cumulative stats
      const elapsed = Math.round((Date.now() - this.callStatsTracker.totalStartTime) / 1000);

      if (this.callStatsTracker.totalTokens > 0) {
        parts.push(chalk.magenta(formatTokens(this.callStatsTracker.totalTokens)));
      }
      if (this.callStatsTracker.iterations > 0) {
        parts.push(chalk.blue(`i${this.callStatsTracker.iterations}`));
      }
      if (this.callStatsTracker.totalCost > 0) {
        parts.push(chalk.cyan(`$${formatCost(this.callStatsTracker.totalCost)}`));
      }
      parts.push(chalk.dim(`${elapsed}s`));
    }

    return `${parts.join(chalk.dim(" | "))} ${chalk.green(">")} `;
  }
}
