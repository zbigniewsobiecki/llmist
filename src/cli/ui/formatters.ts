/**
 * CLI output formatting utilities.
 *
 * This module provides formatting functions for displaying metrics, summaries,
 * and gadget results in a clean, consistent format across the llmist CLI.
 *
 * **Design principles:**
 * - Consistent formatting across all commands (agent, complete, models)
 * - Human-readable output with appropriate precision
 * - Color-coded for visual clarity (using chalk)
 * - Compact format optimized for terminal display
 *
 * **SHOWCASE:** Demonstrates how to build a polished CLI on top of llmist's core.
 */

import chalk from "chalk";
import type { TokenUsage } from "../../core/options.js";

/**
 * Formats token count with 'k' suffix for thousands.
 *
 * Uses compact notation to save terminal space while maintaining readability.
 * Numbers below 1000 are shown as-is, larger numbers use 'k' suffix with one decimal.
 *
 * @param tokens - Number of tokens
 * @returns Formatted string (e.g., "896" or "11.5k")
 *
 * @example
 * ```typescript
 * formatTokens(896)    // "896"
 * formatTokens(11500)  // "11.5k"
 * formatTokens(1234)   // "1.2k"
 * ```
 */
export function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`;
}

/**
 * Formats cost with appropriate precision based on magnitude.
 *
 * Uses variable precision to balance readability and accuracy:
 * - Very small costs (<$0.001): 5 decimal places to show meaningful value
 * - Small costs (<$0.01): 4 decimal places for precision
 * - Medium costs (<$1): 3 decimal places for clarity
 * - Larger costs (≥$1): 2 decimal places (standard currency format)
 *
 * @param cost - Cost in USD
 * @returns Formatted cost string without currency symbol (e.g., "0.0123")
 *
 * @example
 * ```typescript
 * formatCost(0.00012)  // "0.00012"
 * formatCost(0.0056)   // "0.0056"
 * formatCost(0.123)    // "0.123"
 * formatCost(1.5)      // "1.50"
 * ```
 */
export function formatCost(cost: number): string {
  if (cost < 0.001) {
    return cost.toFixed(5);
  }
  if (cost < 0.01) {
    return cost.toFixed(4);
  }
  if (cost < 1) {
    return cost.toFixed(3);
  }
  return cost.toFixed(2);
}

/**
 * Metadata for generating execution summaries.
 *
 * Contains optional metrics collected during agent/LLM execution.
 * All fields are optional to allow partial summaries when data isn't available.
 */
export interface SummaryMetadata {
  /** LLM finish reason (e.g., "stop", "length", "tool_calls") */
  finishReason?: string | null;

  /** Token usage statistics from LLM provider */
  usage?: TokenUsage;

  /** Number of agent iterations (LLM calls) */
  iterations?: number;

  /** Total cost in USD (calculated via ModelRegistry) */
  cost?: number;

  /** Elapsed time in seconds */
  elapsedSeconds?: number;
}

/**
 * Renders execution metadata as a compact, color-coded summary line.
 *
 * Formats agent/LLM execution metrics in a consistent format used across CLI commands.
 * Only includes fields that have values, making the output clean and concise.
 *
 * **Format:** `#N | ↑ input │ ↓ output │ time | cost | finish`
 *
 * **Color scheme:**
 * - Cyan: Iteration number and cost (highlights key metrics)
 * - Yellow: Input tokens (shows what you sent)
 * - Green: Output tokens (shows what you received)
 * - Dim: Separators and finish reason (de-emphasize metadata)
 *
 * @param metadata - Summary metadata to format
 * @returns Formatted summary string, or null if no fields are populated
 *
 * @example
 * ```typescript
 * // Full summary with all fields
 * renderSummary({
 *   iterations: 3,
 *   usage: { inputTokens: 896, outputTokens: 11500, totalTokens: 12396 },
 *   elapsedSeconds: 9,
 *   cost: 0.0123,
 *   finishReason: "stop"
 * });
 * // Output: "#3 | ↑ 896 │ ↓ 11.5k │ 9s | $0.0123 | stop"
 *
 * // Partial summary (only tokens)
 * renderSummary({
 *   usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700 }
 * });
 * // Output: "↑ 500 │ ↓ 200"
 * ```
 */
export function renderSummary(metadata: SummaryMetadata): string | null {
  const parts: string[] = [];

  // Iteration number (#N) - shown first for context
  if (metadata.iterations !== undefined) {
    parts.push(chalk.cyan(`#${metadata.iterations}`));
  }

  // Token usage (↑ input │ ↓ output) - core metrics
  if (metadata.usage) {
    const { inputTokens, outputTokens } = metadata.usage;
    parts.push(chalk.dim("↑") + chalk.yellow(` ${formatTokens(inputTokens)}`));
    parts.push(chalk.dim("↓") + chalk.green(` ${formatTokens(outputTokens)}`));
  }

  // Elapsed time - performance metric
  if (metadata.elapsedSeconds !== undefined && metadata.elapsedSeconds > 0) {
    parts.push(chalk.dim(`${metadata.elapsedSeconds}s`));
  }

  // Cost - financial tracking (showcases ModelRegistry integration)
  if (metadata.cost !== undefined && metadata.cost > 0) {
    parts.push(chalk.cyan(`$${formatCost(metadata.cost)}`));
  }

  // Finish reason - completion status (shown last for context)
  if (metadata.finishReason) {
    parts.push(chalk.dim(metadata.finishReason));
  }

  // Return null if no fields populated (cleaner than empty string)
  if (parts.length === 0) {
    return null;
  }

  // Join with " | " separator for visual clarity
  return parts.join(chalk.dim(" | "));
}

/**
 * Gadget execution result for formatting.
 *
 * Contains metadata about a single gadget invocation during agent execution.
 */
export interface GadgetResult {
  /** Name of the gadget that was executed */
  gadgetName: string;

  /** Execution time in milliseconds */
  executionTimeMs: number;

  /** Error message if gadget failed */
  error?: string;

  /** Result value from successful gadget execution */
  result?: string;

  /** Whether this gadget execution ended the agent loop */
  breaksLoop?: boolean;
}

/**
 * Formats a gadget execution result for stderr output with color-coded status.
 *
 * Provides visual feedback for gadget execution during agent runs. Different
 * icons and colors indicate success, error, or completion states.
 *
 * **Format:**
 * - Success: `✓ GadgetName → result 123ms`
 * - Error: `✗ GadgetName error: message 123ms`
 * - Completion: `⏹ GadgetName finished: result 123ms`
 *
 * **Special handling:**
 * - TellUser gadget shows full result (user-facing messages)
 * - Other gadgets truncate long results to 80 chars (keep output clean)
 *
 * @param result - Gadget execution result with timing and output info
 * @returns Formatted summary string with ANSI colors
 *
 * @example
 * ```typescript
 * // Successful gadget execution
 * formatGadgetSummary({
 *   gadgetName: "Calculator",
 *   executionTimeMs: 45,
 *   result: "345"
 * });
 * // Output: "✓ Calculator → 345 45ms" (with colors)
 *
 * // Error case
 * formatGadgetSummary({
 *   gadgetName: "Database",
 *   executionTimeMs: 123,
 *   error: "Connection timeout"
 * });
 * // Output: "✗ Database error: Connection timeout 123ms" (with red colors)
 *
 * // Loop-breaking gadget (TellUser with done=true)
 * formatGadgetSummary({
 *   gadgetName: "TellUser",
 *   executionTimeMs: 12,
 *   result: "Task completed successfully!",
 *   breaksLoop: true
 * });
 * // Output: "⏹ TellUser finished: Task completed successfully! 12ms" (with yellow)
 * ```
 */
export function formatGadgetSummary(result: GadgetResult): string {
  // Format gadget name and execution time
  const gadgetLabel = chalk.magenta.bold(result.gadgetName);
  const timeLabel = chalk.dim(`${Math.round(result.executionTimeMs)}ms`);

  // Error case - show error message in red
  if (result.error) {
    return `${chalk.red("✗")} ${gadgetLabel} ${chalk.red("error:")} ${result.error} ${timeLabel}`;
  }

  // Loop-breaking case - indicate completion in yellow
  if (result.breaksLoop) {
    return `${chalk.yellow("⏹")} ${gadgetLabel} ${chalk.yellow("finished:")} ${result.result} ${timeLabel}`;
  }

  // Success case - format result with optional truncation
  const maxLen = 80;
  const shouldTruncate = result.gadgetName !== "TellUser";
  const resultText = result.result
    ? shouldTruncate && result.result.length > maxLen
      ? `${result.result.slice(0, maxLen)}...`
      : result.result
    : "";

  return `${chalk.green("✓")} ${gadgetLabel} ${chalk.dim("→")} ${resultText} ${timeLabel}`;
}
