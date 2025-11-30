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
import { marked, type MarkedExtension } from "marked";
import { markedTerminal } from "marked-terminal";
import type { TokenUsage } from "../../core/options.js";

/**
 * Lazy-initialized flag for marked-terminal configuration.
 *
 * We defer `marked.use(markedTerminal())` until first render because:
 * - markedTerminal() captures chalk's color level at call time
 * - At module import time, TTY detection may not be complete
 * - Lazy init ensures colors work in interactive terminals
 */
let markedConfigured = false;

/**
 * Configure marked for terminal output (lazy initialization).
 *
 * Uses marked-terminal to convert markdown to ANSI-styled terminal output.
 * This enables rich formatting in TellUser messages and AskUser questions.
 *
 * We override marked-terminal's style functions with our own chalk instance
 * because marked-terminal bundles its own chalk that detects colors at module
 * load time. Bun's broken TTY detection causes that bundled chalk to detect
 * level 0 (no colors). See: https://github.com/oven-sh/bun/issues/1322
 *
 * By forcing `chalk.level = 3` on our imported chalk and passing custom style
 * functions, we ensure colors work regardless of TTY detection.
 *
 * Respects the NO_COLOR environment variable for accessibility.
 *
 * Note: Type assertion needed due to @types/marked-terminal lag behind the runtime API.
 */
function ensureMarkedConfigured(): void {
  if (!markedConfigured) {
    // Respect NO_COLOR env var, otherwise force truecolor (level 3)
    chalk.level = process.env.NO_COLOR ? 0 : 3;

    // Override marked-terminal's style functions with our chalk instance
    // to work around Bun's broken TTY detection
    marked.use(
      markedTerminal({
        // Text styling
        strong: chalk.bold,
        em: chalk.italic,
        del: chalk.dim.gray.strikethrough,

        // Code styling
        code: chalk.yellow,
        codespan: chalk.yellow,

        // Headings
        heading: chalk.green.bold,
        firstHeading: chalk.magenta.underline.bold,

        // Links
        link: chalk.blue,
        href: chalk.blue.underline,

        // Block elements
        blockquote: chalk.gray.italic,

        // List formatting - reduce indentation and add bullet styling
        tab: 2, // Reduce from default 4 to 2 spaces
        listitem: chalk.reset, // Keep items readable (no dim)
      }) as unknown as MarkedExtension,
    );
    markedConfigured = true;
  }
}

/**
 * Renders markdown text as styled terminal output.
 *
 * Converts markdown syntax to ANSI escape codes for terminal display:
 * - **bold** and *italic* text
 * - `inline code` and code blocks
 * - Lists (bulleted and numbered)
 * - Headers
 * - Links (clickable in supported terminals)
 *
 * @param text - Markdown text to render
 * @returns ANSI-styled string for terminal output
 *
 * @example
 * ```typescript
 * renderMarkdown("**Important:** Check the `config.json` file");
 * // Returns styled text with bold "Important:" and code-styled "config.json"
 * ```
 */
export function renderMarkdown(text: string): string {
  ensureMarkedConfigured();
  let rendered = marked.parse(text) as string;

  // Workaround for marked-terminal bug: inline markdown in list items
  // is not processed. Post-process to handle **bold** and *italic*.
  // See: https://github.com/mikaelbr/marked-terminal/issues
  rendered = rendered
    .replace(/\*\*(.+?)\*\*/g, (_, content) => chalk.bold(content))
    // Italic: require non-space after * to avoid matching bullet points (  * )
    .replace(/(?<!\*)\*(\S[^*]*)\*(?!\*)/g, (_, content) => chalk.italic(content));

  // Remove trailing newlines that marked adds
  return rendered.trimEnd();
}

/**
 * Creates a rainbow-colored horizontal line for visual emphasis.
 * Cycles through colors for each character segment.
 * Uses the full terminal width for a complete visual separator.
 *
 * @returns Rainbow-colored separator string spanning the terminal width
 */
function createRainbowSeparator(): string {
  const colors = [chalk.red, chalk.yellow, chalk.green, chalk.cyan, chalk.blue, chalk.magenta];
  const char = "─";
  // Use terminal width, fallback to 80 if not available (e.g., piped output)
  const width = process.stdout.columns || 80;
  let result = "";
  for (let i = 0; i < width; i++) {
    result += colors[i % colors.length](char);
  }
  return result;
}

/**
 * Renders markdown with colorful rainbow horizontal line separators above and below.
 * Use this for prominent markdown content that should stand out visually.
 *
 * @param text - Markdown text to render
 * @returns Rendered markdown with rainbow separators
 *
 * @example
 * ```typescript
 * renderMarkdownWithSeparators("**Hello** world!");
 * // Returns rainbow line + styled markdown + rainbow line
 * ```
 */
export function renderMarkdownWithSeparators(text: string): string {
  const rendered = renderMarkdown(text);
  const separator = createRainbowSeparator();
  return `\n${separator}\n${rendered}\n${separator}\n`;
}

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
    parts.push(chalk.dim("↑") + chalk.yellow(` ${formatTokens(inputTokens)}`));
    // Show cached tokens if present (indicates prompt caching hit - 0.1x cost)
    if (cachedInputTokens && cachedInputTokens > 0) {
      parts.push(chalk.dim("⟳") + chalk.blue(` ${formatTokens(cachedInputTokens)}`));
    }
    // Show cache creation tokens if present (Anthropic cache writes - 1.25x cost)
    if (cacheCreationInputTokens && cacheCreationInputTokens > 0) {
      parts.push(chalk.dim("✎") + chalk.magenta(` ${formatTokens(cacheCreationInputTokens)}`));
    }
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
 * Metadata for generating overall execution summaries.
 *
 * Used for the final accumulated summary at the end of agent execution.
 */
export interface OverallSummaryMetadata {
  /** Total tokens across all calls */
  totalTokens?: number;

  /** Number of agent iterations (LLM calls) */
  iterations?: number;

  /** Total elapsed time in seconds */
  elapsedSeconds?: number;

  /** Total cost in USD */
  cost?: number;
}

/**
 * Renders overall accumulated execution summary as a distinct styled line.
 *
 * This is displayed at the end of agent execution to show total metrics.
 * Uses a "total:" prefix to distinguish from per-call summaries.
 *
 * **Format:** `total: 3.5k | #2 | 19s | $0.0021`
 *
 * @param metadata - Overall summary metadata
 * @returns Formatted summary string, or null if no fields are populated
 *
 * @example
 * ```typescript
 * renderOverallSummary({
 *   totalTokens: 3500,
 *   iterations: 2,
 *   elapsedSeconds: 19,
 *   cost: 0.0021
 * });
 * // Output: "total: 3.5k | #2 | 19s | $0.0021"
 * ```
 */
export function renderOverallSummary(metadata: OverallSummaryMetadata): string | null {
  const parts: string[] = [];

  // Total tokens - primary metric for overall summary
  if (metadata.totalTokens !== undefined && metadata.totalTokens > 0) {
    parts.push(chalk.dim("total:") + chalk.magenta(` ${formatTokens(metadata.totalTokens)}`));
  }

  // Iteration count (#N)
  if (metadata.iterations !== undefined && metadata.iterations > 0) {
    parts.push(chalk.cyan(`#${metadata.iterations}`));
  }

  // Total elapsed time
  if (metadata.elapsedSeconds !== undefined && metadata.elapsedSeconds > 0) {
    parts.push(chalk.dim(`${metadata.elapsedSeconds}s`));
  }

  // Total cost
  if (metadata.cost !== undefined && metadata.cost > 0) {
    parts.push(chalk.cyan(`$${formatCost(metadata.cost)}`));
  }

  if (parts.length === 0) {
    return null;
  }

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

  /** Parameters passed to the gadget */
  parameters?: Record<string, unknown>;

  /** Token count for output (calculated via provider API) */
  tokenCount?: number;
}

/**
 * Formats a gadget execution result as a compact one-liner for stderr output.
 *
 * Provides visual feedback for gadget execution during agent runs. Different
 * icons and colors indicate success, error, or completion states.
 *
 * **Format:**
 * - Success: `✓ GadgetName(param=value, ...) → 248 tokens 123ms`
 * - Error: `✗ GadgetName(param=value) error: message 123ms`
 * - Completion: `⏹ GadgetName(param=value) → 2.5k tokens 123ms`
 *
 * **Design:**
 * - All parameters shown inline (truncated if too long)
 * - Output shown as token count (via provider API) or bytes as fallback
 * - Execution time always shown at the end
 *
 * @param result - Gadget execution result with timing and output info
 * @returns Formatted one-liner string with ANSI colors
 *
 * @example
 * ```typescript
 * // Successful gadget execution with token count
 * formatGadgetSummary({
 *   gadgetName: "ListDirectory",
 *   executionTimeMs: 4,
 *   parameters: { path: ".", recursive: true },
 *   result: "Type | Name | Size...",
 *   tokenCount: 248
 * });
 * // Output: "✓ ListDirectory(path=., recursive=true) → 248 tokens 4ms"
 *
 * // Error case
 * formatGadgetSummary({
 *   gadgetName: "ReadFile",
 *   executionTimeMs: 2,
 *   parameters: { path: "/missing.txt" },
 *   error: "File not found"
 * });
 * // Output: "✗ ReadFile(path=/missing.txt) error: File not found 2ms"
 * ```
 */
/**
 * Formats parameters as a compact inline string with color-coded keys and values.
 *
 * @param params - Parameter key-value pairs
 * @returns Formatted string with dim keys and cyan values, e.g., "path=., recursive=true"
 */
function formatParametersInline(params: Record<string, unknown> | undefined): string {
  if (!params || Object.keys(params).length === 0) {
    return "";
  }

  return Object.entries(params)
    .map(([key, value]) => {
      // Format value compactly
      let formatted: string;
      if (typeof value === "string") {
        // Truncate long strings
        formatted = value.length > 30 ? `${value.slice(0, 30)}…` : value;
      } else if (typeof value === "boolean" || typeof value === "number") {
        formatted = String(value);
      } else {
        // For arrays/objects, show compact JSON
        const json = JSON.stringify(value);
        formatted = json.length > 30 ? `${json.slice(0, 30)}…` : json;
      }
      // Color: dim key, = sign, cyan value
      return `${chalk.dim(key)}${chalk.dim("=")}${chalk.cyan(formatted)}`;
    })
    .join(chalk.dim(", "));
}

/**
 * Formats byte count in human-readable form.
 *
 * @param bytes - Number of bytes
 * @returns Formatted string like "245 bytes" or "1.2 KB"
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} bytes`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatGadgetSummary(result: GadgetResult): string {
  // Format gadget name and execution time
  const gadgetLabel = chalk.magenta.bold(result.gadgetName);
  const timeLabel = chalk.dim(`${Math.round(result.executionTimeMs)}ms`);

  // Format parameters inline (parentheses are dim, content is color-coded)
  const paramsStr = formatParametersInline(result.parameters);
  const paramsLabel = paramsStr ? `${chalk.dim("(")}${paramsStr}${chalk.dim(")")}` : "";

  // Error case - show error message in red (one-liner)
  if (result.error) {
    const errorMsg = result.error.length > 50 ? `${result.error.slice(0, 50)}…` : result.error;
    return `${chalk.red("✗")} ${gadgetLabel}${paramsLabel} ${chalk.red("error:")} ${errorMsg} ${timeLabel}`;
  }

  // Format output size: prefer token count if available, fallback to bytes
  let outputLabel: string;
  if (result.tokenCount !== undefined && result.tokenCount > 0) {
    outputLabel = chalk.green(`${formatTokens(result.tokenCount)} tokens`);
  } else if (result.result) {
    const outputBytes = Buffer.byteLength(result.result, "utf-8");
    outputLabel = outputBytes > 0 ? chalk.green(formatBytes(outputBytes)) : chalk.dim("no output");
  } else {
    outputLabel = chalk.dim("no output");
  }

  // Build the summary line
  const icon = result.breaksLoop ? chalk.yellow("⏹") : chalk.green("✓");
  const summaryLine = `${icon} ${gadgetLabel}${paramsLabel} ${chalk.dim("→")} ${outputLabel} ${timeLabel}`;

  // TellUser gadget: display full message content below the summary (with markdown and separators)
  if (result.gadgetName === "TellUser" && result.parameters?.message) {
    const message = String(result.parameters.message);
    const rendered = renderMarkdownWithSeparators(message);
    return `${summaryLine}\n${rendered}`;
  }

  return summaryLine;
}
