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
 *
 * **Architecture:**
 * This file is the primary entry point. Focused sub-modules handle:
 * - `markdown-renderer.ts` — markdown rendering, rainbow separators, user messages
 * - `metric-formatters.ts` — token counts, costs, provider prefix stripping
 * - `call-number.ts` — hierarchical call number formatting (#N, #N.gadgetId.M)
 * - `format-time.ts` — execution time formatting (ms/s)
 */

import chalk from "chalk";
import type { StoredMedia, TokenUsage } from "llmist";
import { format } from "llmist";
import { formatCallNumber } from "./call-number.js";
import { formatExecutionTime } from "./format-time.js";

// Re-export markdown rendering utilities so importers don't need to know the internal structure
export {
  formatUserMessage,
  renderMarkdown,
  renderMarkdownWithSeparators,
} from "./markdown-renderer.js";
// Re-export metric formatting utilities for backwards compatibility
export {
  formatCost,
  formatTokens,
  formatTokensLong,
  stripProviderPrefix,
} from "./metric-formatters.js";

import { getCustomPreview } from "./gadget-previews.js";
import { renderMarkdownWithSeparators } from "./markdown-renderer.js";
// Import for internal use (formatters.ts needs these to format LLM/gadget lines)
import { formatTokens } from "./metric-formatters.js";
import {
  buildTokenMetrics,
  costPart,
  finishReasonPart,
  joinParts,
  timePart,
} from "./metric-parts.js";

/**
 * Display information for formatting an LLM call progress line.
 *
 * Used by both main agent display and nested subagent display.
 * This enables consistent formatting across all LLM call displays.
 */
export interface LLMCallDisplayInfo {
  /** Iteration number (0-indexed for subagents, 1-indexed for main) */
  iteration: number;
  /** Parent call number for hierarchical display (e.g., parent=1, iteration=2 → #1.2) */
  parentCallNumber?: number;
  /** Gadget invocation ID for unique subagent identification (e.g., #6.browse_web_1.2) */
  gadgetInvocationId?: string;
  /** Model name/ID */
  model: string;
  /** Input tokens sent to LLM */
  inputTokens?: number;
  /** Cached input tokens (prompt cache hit) */
  cachedInputTokens?: number;
  /** Output tokens received from LLM */
  outputTokens?: number;
  /** Elapsed time in seconds */
  elapsedSeconds: number;
  /** Cost in USD */
  cost?: number;
  /** Finish reason (null/undefined while streaming, string when done) */
  finishReason?: string | null;
  /** Whether the call is still streaming */
  isStreaming?: boolean;
  /** Spinner character for streaming display */
  spinner?: string;
  /** Context window usage percentage (optional, main agent only) */
  contextPercent?: number | null;
  /** Token estimation flags (when counts are estimated, not exact) */
  estimated?: { input?: boolean; output?: boolean };
}

/**
 * Formats an LLM call progress line for display.
 *
 * This is the **shared formatting function** used by both main agent and
 * nested subagent displays. Using a single function eliminates code
 * duplication and ensures consistent formatting.
 *
 * **Format:** `#N model | %ctx | ↑ input | ⟳ cached | ↓ output | time | $cost | status`
 *
 * **Color scheme:**
 * - Cyan: Iteration number, cost, spinner
 * - Magenta: Model name
 * - Yellow: Input tokens
 * - Blue: Cached tokens
 * - Green: Output tokens, success checkmark
 *
 * @param info - Display information for the LLM call
 * @returns Formatted progress line string
 *
 * @example
 * ```typescript
 * // Streaming call
 * formatLLMCallLine({
 *   iteration: 1,
 *   model: "claude-sonnet-4-20250514",
 *   inputTokens: 10400,
 *   outputTokens: 49,
 *   elapsedSeconds: 24.8,
 *   cost: 0.0032,
 *   isStreaming: true,
 *   spinner: "⠧",
 *   contextPercent: 1,
 * });
 * // Output: "#1 claude-sonnet-4-20250514 | 1% | ↑ 10.4k | ↓ 49 | 24.8s | $0.0032 | ⠧"
 *
 * // Completed call
 * formatLLMCallLine({
 *   iteration: 0,
 *   model: "gemini-2.5-flash",
 *   inputTokens: 5200,
 *   cachedInputTokens: 3000,
 *   outputTokens: 36,
 *   elapsedSeconds: 3.7,
 *   cost: 0.00009,
 *   finishReason: "stop",
 * });
 * // Output: "#0 gemini-2.5-flash | ↑ 5.2k | ⟳ 3.0k | ↓ 36 | 3.7s | $0.00009 | ✓"
 * ```
 */
export function formatLLMCallLine(info: LLMCallDisplayInfo): string {
  const parts: string[] = [];

  // #N or #N.gadgetId.M model (iteration number + model name) - combined as one unit
  // Hierarchical format: parent.gadgetId.child (e.g., #1.browse_web_1.2 for 2nd call of gadget browse_web_1 in parent #1)
  const callNumber = formatCallNumber(
    info.iteration,
    info.parentCallNumber,
    info.gadgetInvocationId,
  );
  parts.push(`${chalk.cyan(callNumber)} ${chalk.magenta(info.model)}`);

  // Context usage percentage (color-coded by usage level, main agent only)
  if (info.contextPercent !== undefined && info.contextPercent !== null) {
    const formatted = `${Math.round(info.contextPercent)}%`;
    if (info.contextPercent >= 80) {
      parts.push(chalk.red(formatted)); // Danger zone
    } else if (info.contextPercent >= 50) {
      parts.push(chalk.yellow(formatted)); // Warning zone
    } else {
      parts.push(chalk.green(formatted)); // Safe zone
    }
  }

  // Token metrics (input, cached, output) via shared metric-parts
  parts.push(
    ...buildTokenMetrics({
      input: info.inputTokens,
      cached: info.cachedInputTokens,
      estimated: info.estimated,
    }),
  );

  // ↓ output tokens — always shown when streaming to display live count (even at 0)
  if ((info.outputTokens !== undefined && info.outputTokens > 0) || info.isStreaming) {
    const prefix = info.estimated?.output ? "~" : "";
    parts.push(chalk.dim("↓") + chalk.green(` ${prefix}${formatTokens(info.outputTokens ?? 0)}`));
  }

  // Time
  parts.push(timePart(info.elapsedSeconds));

  // Cost
  if (info.cost !== undefined && info.cost > 0) {
    parts.push(costPart(info.cost));
  }

  // Finish reason at the END when completed (not streaming)
  if (!info.isStreaming && info.finishReason !== undefined) {
    const reason = info.finishReason || "stop";
    parts.push(finishReasonPart(reason));
  }

  const line = joinParts(parts);

  // Prepend spinner when streaming, ✓ when completed
  if (info.isStreaming && info.spinner) {
    return `${chalk.cyan(info.spinner)} ${line}`;
  }

  // Completed calls get ✓ prefix like gadgets
  if (!info.isStreaming) {
    return `${chalk.green("✓")} ${line}`;
  }

  return line;
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

  /** Model name/ID being used */
  model?: string;

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
 * // Full summary with all fields (including cached tokens)
 * renderSummary({
 *   iterations: 3,
 *   usage: { inputTokens: 896, outputTokens: 11500, totalTokens: 12396, cachedInputTokens: 500 },
 *   elapsedSeconds: 9,
 *   cost: 0.0123,
 *   finishReason: "stop"
 * });
 * // Output: "#3 | ↑ 896 | ⟳ 500 | ↓ 11.5k | 9s | $0.0123 | stop"
 *
 * // Partial summary (only tokens, no cache hit)
 * renderSummary({
 *   usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700 }
 * });
 * // Output: "↑ 500 | ↓ 200"
 * ```
 */
export function renderSummary(metadata: SummaryMetadata): string | null {
  const parts: string[] = [];

  // Iteration number and model (#N modelname) - shown first for context
  if (metadata.iterations !== undefined) {
    const iterPart = chalk.cyan(`#${metadata.iterations}`);
    if (metadata.model) {
      parts.push(`${iterPart} ${chalk.magenta(metadata.model)}`);
    } else {
      parts.push(iterPart);
    }
  } else if (metadata.model) {
    // Model without iteration number
    parts.push(chalk.magenta(metadata.model));
  }

  // Token usage (↑ input │ ⟳ cached │ ✎ cache-write │ ↓ output) - core metrics
  if (metadata.usage) {
    const { inputTokens, outputTokens, cachedInputTokens, cacheCreationInputTokens } =
      metadata.usage;
    parts.push(
      ...buildTokenMetrics({
        input: inputTokens,
        cached: cachedInputTokens,
        cacheCreation: cacheCreationInputTokens,
        output: outputTokens,
      }),
    );
  }

  // Elapsed time - performance metric
  if (metadata.elapsedSeconds !== undefined && metadata.elapsedSeconds > 0) {
    parts.push(timePart(metadata.elapsedSeconds));
  }

  // Cost - financial tracking (showcases ModelRegistry integration)
  if (metadata.cost !== undefined && metadata.cost > 0) {
    parts.push(costPart(metadata.cost));
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
  return joinParts(parts);
}

/**
 * Aggregated metrics from subagent LLM calls.
 *
 * These metrics are collected from all nested LLM calls that occur during
 * gadget execution (e.g., BrowseWeb spawns multiple LLM calls internally).
 */
export interface SubagentMetrics {
  /** Total input tokens across all subagent calls */
  inputTokens: number;
  /** Total output tokens across all subagent calls */
  outputTokens: number;
  /** Total cached input tokens across all subagent calls */
  cachedInputTokens: number;
  /** Total cost in USD across all subagent calls */
  cost: number;
  /** Number of LLM calls made by the subagent */
  callCount: number;
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

  /** Parameters passed to the gadget */
  parameters?: Record<string, unknown>;

  /** Token count for output (calculated via provider API) */
  tokenCount?: number;

  /** Media outputs (images, audio, etc.) produced by the gadget */
  media?: StoredMedia[];

  /** Aggregated metrics from subagent LLM calls (if gadget spawned a subagent) */
  subagentMetrics?: SubagentMetrics;
}

/**
 * Gets the raw string value for a parameter (without truncation or colors).
 */
function getRawValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * Truncates a string to maxLen characters with ellipsis if needed.
 * The ellipsis is included in the maxLen budget (result is always <= maxLen chars).
 * @internal Exported for testing
 */
export function truncateValue(str: string, maxLen: number): string {
  if (maxLen <= 0) return "";
  if (str.length <= maxLen) return str;
  // Account for ellipsis taking 1 char of the budget
  return `${str.slice(0, maxLen - 1)}…`;
}

/**
 * Formats parameters as a compact inline string with color-coded keys and values.
 * Expands to fit available terminal width when maxWidth is provided.
 *
 * @param params - Parameter key-value pairs
 * @param maxWidth - Optional maximum width for the entire parameters string (excluding parentheses)
 * @returns Formatted string with dim keys and cyan values, e.g., "path=., recursive=true"
 */
export function formatParametersInline(
  params: Record<string, unknown> | undefined,
  maxWidth?: number,
): string {
  if (!params || Object.keys(params).length === 0) {
    return "";
  }

  const entries = Object.entries(params);
  const defaultLimit = 30;

  // Get raw values for each entry
  const rawValues = entries.map(([, value]) => getRawValue(value));

  // Calculate overhead: "key=" for each entry, ", " between entries
  const overhead = entries.reduce((sum, [key], i) => {
    return sum + key.length + 1 + (i > 0 ? 2 : 0); // "key=" + ", " separator
  }, 0);

  // Determine limits for each value
  let limits: number[];

  if (maxWidth && maxWidth > overhead) {
    const availableForValues = maxWidth - overhead;
    const totalRawLength = rawValues.reduce((sum, v) => sum + v.length, 0);

    if (totalRawLength <= availableForValues) {
      // Everything fits - no truncation needed
      limits = rawValues.map(() => Infinity);
    } else {
      // Distribute space proportionally, with minimum of 10 chars per value
      const minPerValue = 10;
      const minTotal = entries.length * minPerValue;

      if (availableForValues <= minTotal) {
        // Very tight - give each value equal minimum space
        limits = rawValues.map(() => Math.max(1, Math.floor(availableForValues / entries.length)));
      } else {
        // Proportional distribution
        limits = rawValues.map((v) => {
          const proportion = v.length / totalRawLength;
          return Math.max(minPerValue, Math.floor(proportion * availableForValues));
        });

        // CRITICAL: Ensure total limits don't exceed budget
        // The minPerValue floor can cause sum of limits to exceed availableForValues
        const totalLimits = limits.reduce((sum, l) => sum + l, 0);
        if (totalLimits > availableForValues) {
          // Scale down proportionally to fit within budget
          const scale = availableForValues / totalLimits;
          limits = limits.map((l) => Math.max(1, Math.floor(l * scale)));
        }
      }
    }
  } else {
    // No maxWidth or too small - use default limit
    limits = rawValues.map(() => defaultLimit);
  }

  // Format each entry with its limit
  return entries
    .map(([key, _], i) => {
      const formatted = truncateValue(rawValues[i], limits[i]);
      return `${chalk.dim(key)}${chalk.dim("=")}${chalk.cyan(formatted)}`;
    })
    .join(chalk.dim(", "));
}

/**
 * Display information for formatting a gadget call progress line.
 *
 * Used by both main gadget display and nested subagent gadget display.
 * This enables consistent formatting across all gadget displays.
 */
export interface GadgetDisplayInfo {
  /** Gadget name */
  name: string;
  /** Parameters passed to the gadget */
  parameters?: Record<string, unknown>;
  /** Elapsed time in seconds */
  elapsedSeconds: number;
  /** Whether the gadget has completed */
  isComplete: boolean;
  /** Token count from output (if available) */
  tokenCount?: number;
  /** Output size in bytes (fallback if tokenCount unavailable) */
  outputBytes?: number;
  /** Error message if gadget failed */
  error?: string;
  /** Whether the gadget breaks the loop (uses ⏹ icon) */
  breaksLoop?: boolean;

  // Realtime subagent metrics (for gadgets that run LLM calls internally)
  /** Aggregated input tokens from nested LLM calls */
  subagentInputTokens?: number;
  /** Aggregated output tokens from nested LLM calls */
  subagentOutputTokens?: number;
  /** Aggregated cached tokens from nested LLM calls */
  subagentCachedTokens?: number;
  /** Aggregated cost from nested LLM calls */
  subagentCost?: number;
}

/**
 * Formats a gadget call progress line for display.
 *
 * This is the **shared formatting function** used by both main gadget display
 * and nested subagent gadget display. Using a single function eliminates code
 * duplication and ensures consistent formatting.
 *
 * **Format (in-progress):** `⏵ GadgetName(params)` (no time - time shown on result)
 * **Format (completed - 2 lines):**
 *   Line 1: `→ GadgetName(params)` (call indicator)
 *   Line 2: `  ✓ GadgetName output time` (result indicator)
 * **Format (error):** `✗ GadgetName(params) error: msg time`
 *
 * @param info - Display information for the gadget call
 * @param maxWidth - Maximum width for parameter truncation (optional)
 * @returns Formatted progress line string
 *
 * @example
 * ```typescript
 * // In-progress call (no time shown)
 * formatGadgetLine({
 *   name: "Navigate",
 *   parameters: { url: "https://example.com" },
 *   elapsedSeconds: 2.5,
 *   isComplete: false,
 * });
 * // Output: "⏵ Navigate(url=https://example.com)"
 *
 * // Completed call (time on result line)
 * formatGadgetLine({
 *   name: "GetPageContent",
 *   parameters: { selector: "article" },
 *   elapsedSeconds: 1.2,
 *   isComplete: true,
 *   tokenCount: 248,
 * });
 * // Output: "→ GetPageContent(selector=article)\n  ✓ GetPageContent ↓ 248 1.2s"
 * ```
 */
export function formatGadgetLine(info: GadgetDisplayInfo, maxWidth?: number): string {
  // Get terminal width if not specified
  const terminalWidth = maxWidth ?? process.stdout.columns ?? 80;

  const gadgetLabel = chalk.magenta.bold(info.name);
  const timeStr = `${info.elapsedSeconds.toFixed(1)}s`;
  const timeLabel = chalk.dim(timeStr);

  // Calculate fixed parts length for parameter truncation
  // Icon may be 2 columns wide in some terminals (Unicode width varies)
  const fixedLength = 3 + info.name.length + 2 + 1 + timeStr.length;
  const availableForParams = Math.max(40, terminalWidth - fixedLength - 3); // -3 safety margin

  // Format parameters inline with truncation
  const paramsStr = formatParametersInline(info.parameters, availableForParams);
  const paramsLabel = paramsStr ? `${chalk.dim("(")}${paramsStr}${chalk.dim(")")}` : "";

  // Error case
  if (info.error) {
    const errorMsg = info.error.length > 50 ? `${info.error.slice(0, 50)}…` : info.error;
    return `${chalk.red("✗")} ${gadgetLabel}${paramsLabel} ${chalk.red("error:")} ${errorMsg} ${timeLabel}`;
  }

  // In-progress case - show elapsed time and any accumulated subagent metrics
  // NO parameters here - they were already shown on the opening line (→ GadgetName(params))
  // This keeps the refreshing line compact and focused on changing metrics
  if (!info.isComplete) {
    const parts: string[] = [];

    // Add subagent metrics if present (for gadgets that run LLM calls internally)
    parts.push(
      ...buildTokenMetrics({
        input: info.subagentInputTokens,
        output: info.subagentOutputTokens,
      }),
    );
    if (info.subagentCost && info.subagentCost > 0) {
      parts.push(costPart(info.subagentCost));
    }

    // Always show elapsed time
    parts.push(timePart(info.elapsedSeconds));

    const metricsStr = parts.length > 0 ? ` ${joinParts(parts)}` : "";
    return `${chalk.blue("⏵")} ${gadgetLabel}${metricsStr}`;
  }

  // Completed case - 2-line format for consistency with formatGadgetSummary
  // Line 1: icon + name + params (START info)
  // Line 2: name reference + output + time (END info)
  let outputLabel: string;
  if (info.tokenCount !== undefined && info.tokenCount > 0) {
    // Use same format as LLM calls: "↓ 1.2k" with dim arrow and green number
    outputLabel = chalk.dim("↓") + chalk.green(` ${formatTokens(info.tokenCount)} `);
  } else if (info.outputBytes !== undefined && info.outputBytes > 0) {
    outputLabel = `${chalk.green(format.bytes(info.outputBytes))} `;
  } else {
    outputLabel = ""; // No output to show
  }

  // Line 1: → (call indicator), Line 2: ✓/⏹ (result indicator)
  const resultIcon = info.breaksLoop ? chalk.yellow("⏹") : chalk.green("✓");
  const nameRef = chalk.magenta(info.name); // Not bold - line 2 is for reference, not emphasis

  const line1 = `${chalk.dim("→")} ${gadgetLabel}${paramsLabel}`;

  // Line 2: ensure it fits within terminal width
  // Fixed parts: "  ✓ " + name + " " + output + " " + time
  const line2Prefix = `  ${resultIcon} ${nameRef} ${outputLabel}`;
  const line2 = `${line2Prefix}${timeLabel}`;

  return `${line1}\n${line2}`;
}

/**
 * Truncates output text for preview display.
 * Normalizes whitespace (collapses newlines/tabs to single spaces) and truncates with ellipsis.
 *
 * @param output - The output text to truncate
 * @param maxWidth - Maximum character width for the preview
 * @returns Truncated string with ellipsis if needed
 */
function truncateOutputPreview(output: string, maxWidth: number): string {
  // Normalize whitespace (collapse newlines/tabs to single spaces)
  const normalized = output.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxWidth) return normalized;
  return `${normalized.slice(0, maxWidth - 1)}…`;
}

/**
 * Get icon for media kind.
 *
 * @param kind - Media kind (image, audio, video, file)
 * @returns Emoji icon for the media kind
 */
function getMediaIcon(kind: string): string {
  switch (kind) {
    case "image":
      return "📷";
    case "audio":
      return "🔊";
    case "video":
      return "🎬";
    case "file":
      return "📄";
    default:
      return "📎";
  }
}

/**
 * Formats a single media output for CLI display.
 *
 * Format: `[📷 media_a1b2c3 image/png 256KB] → /path/to/file.png`
 *
 * @param media - Stored media information
 * @returns Formatted media line with icon, ID, MIME type, size, and path
 */
function formatMediaLine(media: StoredMedia): string {
  const icon = getMediaIcon(media.kind);
  const id = chalk.cyan(media.id);
  const mimeType = chalk.dim(media.mimeType);
  const size = chalk.yellow(format.bytes(media.sizeBytes));
  const path = chalk.dim(media.path);

  return `${chalk.dim("[")}${icon} ${id} ${mimeType} ${size}${chalk.dim("]")} ${chalk.dim("→")} ${path}`;
}

export function formatGadgetSummary(result: GadgetResult): string {
  // Get terminal width (default to 80 if not available)
  const terminalWidth = process.stdout.columns || 80;

  const timeStr = formatExecutionTime(result.executionTimeMs);
  const timeLabel = chalk.dim(timeStr);

  // Note: Opening line (→ GadgetName(params)) is now printed separately on gadget_call
  // This function only returns the RESULT line

  // Result line: name reference + output metrics + time + preview
  const nameRef = chalk.magenta(result.gadgetName); // Not bold - result line is for reference, not emphasis

  // Calculate output metrics (tokens or bytes)
  // Use same format as LLM calls: "↓ 1.2k" with dim arrow and green number
  // Skip if we have subagent metrics - those provide comprehensive token info
  const hasSubagentMetrics = result.subagentMetrics && result.subagentMetrics.callCount > 0;
  let outputLabel: string;
  let outputStrRaw: string; // For preview width calculation (without ANSI codes)
  if (!hasSubagentMetrics && result.tokenCount !== undefined && result.tokenCount > 0) {
    const tokenStr = formatTokens(result.tokenCount);
    outputLabel = chalk.dim("↓") + chalk.green(` ${tokenStr} `);
    outputStrRaw = `↓ ${tokenStr} `;
  } else if (!hasSubagentMetrics && result.result) {
    const outputBytes = Buffer.byteLength(result.result, "utf-8");
    if (outputBytes > 0) {
      const bytesStr = format.bytes(outputBytes);
      outputLabel = `${chalk.green(bytesStr)} `;
      outputStrRaw = `${bytesStr} `;
    } else {
      outputLabel = "";
      outputStrRaw = "";
    }
  } else {
    outputLabel = "";
    outputStrRaw = "";
  }

  // Error case: show error message with ✗ (opening line was already printed on gadget_call)
  if (result.error) {
    const errorMsg = result.error.length > 50 ? `${result.error.slice(0, 50)}…` : result.error;
    return `${chalk.red("✗")} ${nameRef} ${chalk.red("error:")} ${errorMsg} ${timeLabel}`;
  }

  // Result icon: ✓ for success, ⏹ for loop-breaking
  const resultIcon = result.breaksLoop ? chalk.yellow("⏹") : chalk.green("✓");

  // Build result line with output preview
  // Calculate available width for preview (~60% of terminal)
  const previewWidth = Math.floor(terminalWidth * 0.6);
  // Account for prefix: "✓ " + name + " " + output + time + ": "
  const prefixLength = 2 + result.gadgetName.length + 1 + outputStrRaw.length + timeStr.length + 2;
  const availablePreview = Math.max(20, previewWidth - prefixLength);

  // Custom previews for specific gadgets (delegated to gadget-previews module)
  const customPreview = getCustomPreview(
    result.gadgetName,
    result.parameters,
    result.result,
    availablePreview,
  );

  // Build subagent metrics string if this gadget spawned a subagent
  // Format: "↑ input | ⟳ cached | ↓ output | $cost"
  let subagentMetricsStr = "";
  if (result.subagentMetrics && result.subagentMetrics.callCount > 0) {
    const m = result.subagentMetrics;
    const subParts: string[] = [
      ...buildTokenMetrics({
        input: m.inputTokens,
        cached: m.cachedInputTokens,
        output: m.outputTokens,
      }),
    ];

    if (m.cost > 0) {
      subParts.push(costPart(m.cost));
    }

    if (subParts.length > 0) {
      subagentMetricsStr = joinParts(subParts) + chalk.dim(" | ");
    }
  }

  // Build result line (opening line is now printed separately on gadget_call)
  let resultLine: string;
  const previewContent =
    customPreview ??
    (result.result?.trim() ? truncateOutputPreview(result.result, availablePreview) : null);
  if (previewContent) {
    resultLine = `${resultIcon} ${nameRef} ${outputLabel}${subagentMetricsStr}${timeLabel}${chalk.dim(":")} ${chalk.dim(previewContent)}`;
  } else {
    // No output content
    resultLine = `${resultIcon} ${nameRef} ${outputLabel}${subagentMetricsStr}${timeLabel}`;
  }

  let output = resultLine;

  // Add media lines if present (images, audio, etc.)
  if (result.media && result.media.length > 0) {
    const mediaLines = result.media.map(formatMediaLine);
    output += `\n${mediaLines.join("\n")}`;
  }

  // TellUser gadget: display full message content below (with markdown and separators)
  if (result.gadgetName === "TellUser" && result.parameters?.message) {
    const message = String(result.parameters.message);
    const rendered = renderMarkdownWithSeparators(message);
    return `${output}\n${rendered}`;
  }

  return output;
}
