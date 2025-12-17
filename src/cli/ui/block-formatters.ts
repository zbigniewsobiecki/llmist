/**
 * Block content formatters for interactive TUI blocks.
 *
 * Provides formatting for both collapsed (one-line) and expanded (multi-line)
 * views of LLM calls and gadget executions.
 *
 * @module
 */

import chalk from "chalk";
import type { LLMCallNode, GadgetNode } from "../tui/types.js";
import { formatTokens, formatCost } from "./formatters.js";

// ─────────────────────────────────────────────────────────────────────────────
// Box Drawing Characters
// ─────────────────────────────────────────────────────────────────────────────

const BOX = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  verticalRight: "├",
  verticalLeft: "┤",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Collapse/Expand Indicators
// ─────────────────────────────────────────────────────────────────────────────

/** Indicator for a collapsed block that can be expanded */
export const COLLAPSED_INDICATOR = "▶";
/** Indicator for an expanded block */
export const EXPANDED_INDICATOR = "▼";
/** Indicator for an in-progress item */
export const PROGRESS_INDICATOR = "⏵";
/** Indicator for a completed item */
export const COMPLETE_INDICATOR = "✓";
/** Indicator for an error */
export const ERROR_INDICATOR = "✗";

// ─────────────────────────────────────────────────────────────────────────────
// LLM Call Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a collapsed LLM call line.
 *
 * Format: `▶ #1 claude-sonnet-4 | ↑ 10.4k | ⟳ 3.0k | ↓ 49 | 24.8s | $0.0032 | STOP`
 */
export function formatLLMCallCollapsed(node: LLMCallNode, selected: boolean): string {
  const indicator = node.isComplete ? COMPLETE_INDICATOR : PROGRESS_INDICATOR;
  const indicatorColor = node.isComplete ? chalk.green : chalk.blue;

  const parts: string[] = [];

  // #N model
  const callNumber = chalk.cyan(`#${node.iteration}`);
  const model = chalk.magenta(node.model);
  parts.push(`${callNumber} ${model}`);

  if (node.details) {
    const d = node.details;

    // ↑ input tokens
    if (d.inputTokens && d.inputTokens > 0) {
      parts.push(chalk.dim("↑") + chalk.yellow(` ${formatTokens(d.inputTokens)}`));
    }

    // ⟳ cached tokens
    if (d.cachedInputTokens && d.cachedInputTokens > 0) {
      parts.push(chalk.dim("⟳") + chalk.blue(` ${formatTokens(d.cachedInputTokens)}`));
    }

    // ↓ output tokens
    if (d.outputTokens && d.outputTokens > 0) {
      parts.push(chalk.dim("↓") + chalk.green(` ${formatTokens(d.outputTokens)}`));
    }

    // Time
    if (d.elapsedSeconds !== undefined) {
      parts.push(chalk.dim(`${d.elapsedSeconds.toFixed(1)}s`));
    }

    // Cost
    if (d.cost !== undefined && d.cost > 0) {
      parts.push(chalk.cyan(`$${formatCost(d.cost)}`));
    }

    // Finish reason
    if (node.isComplete && d.finishReason) {
      const reason = d.finishReason.toUpperCase();
      if (reason === "STOP" || reason === "END_TURN") {
        parts.push(chalk.green(reason));
      } else {
        parts.push(chalk.yellow(reason));
      }
    }
  }

  const line = parts.join(chalk.dim(" | "));
  const prefix = indicatorColor(indicator);

  // Highlight selected line
  if (selected) {
    return chalk.bgBlue.white(`${prefix} ${line}`);
  }

  return `${prefix} ${line}`;
}

/**
 * Formats expanded LLM call details as multiple lines.
 *
 * Returns an array of lines to display below the collapsed header.
 */
export function formatLLMCallExpanded(node: LLMCallNode): string[] {
  const lines: string[] = [];
  const indent = "  ";
  const d = node.details;

  if (!d) {
    lines.push(`${indent}${chalk.dim("No details available")}`);
    return lines;
  }

  // Calculate box width
  const width = Math.min(60, (process.stdout.columns || 80) - 4);
  const headerLine = `${BOX.topLeft}${BOX.horizontal} Details ${BOX.horizontal.repeat(width - 11)}`;

  lines.push(`${indent}${chalk.dim(headerLine)}`);

  // Model
  lines.push(`${indent}${chalk.dim(BOX.vertical)} Model:   ${chalk.magenta(node.model)}`);

  // Input tokens with cache breakdown
  if (d.inputTokens !== undefined) {
    let inputLine = `${indent}${chalk.dim(BOX.vertical)} Input:   ${chalk.yellow(formatTokens(d.inputTokens))} tokens`;
    if (d.cachedInputTokens && d.cachedInputTokens > 0) {
      const cachePercent = ((d.cachedInputTokens / d.inputTokens) * 100).toFixed(1);
      inputLine += chalk.blue(` (${formatTokens(d.cachedInputTokens)} cached, ${cachePercent}%)`);
    }
    lines.push(inputLine);
  }

  // Output tokens
  if (d.outputTokens !== undefined) {
    lines.push(`${indent}${chalk.dim(BOX.vertical)} Output:  ${chalk.green(formatTokens(d.outputTokens))} tokens`);
  }

  // Context usage
  if (d.contextPercent !== undefined) {
    let contextColor = chalk.green;
    if (d.contextPercent >= 80) contextColor = chalk.red;
    else if (d.contextPercent >= 50) contextColor = chalk.yellow;
    lines.push(`${indent}${chalk.dim(BOX.vertical)} Context: ${contextColor(`${Math.round(d.contextPercent)}%`)}`);
  }

  // Time with tokens/second calculation
  if (d.elapsedSeconds !== undefined) {
    let timeLine = `${indent}${chalk.dim(BOX.vertical)} Time:    ${chalk.dim(`${d.elapsedSeconds.toFixed(1)}s`)}`;
    if (d.outputTokens && d.elapsedSeconds > 0) {
      const tokensPerSec = Math.round(d.outputTokens / d.elapsedSeconds);
      timeLine += chalk.dim(` (${tokensPerSec} tok/s)`);
    }
    lines.push(timeLine);
  }

  // Cost with breakdown
  if (d.cost !== undefined && d.cost > 0) {
    lines.push(`${indent}${chalk.dim(BOX.vertical)} Cost:    ${chalk.cyan(`$${formatCost(d.cost)}`)}`);
  }

  // Finish reason
  if (d.finishReason) {
    const reason = d.finishReason.toUpperCase();
    const reasonColor = reason === "STOP" || reason === "END_TURN" ? chalk.green : chalk.yellow;
    lines.push(`${indent}${chalk.dim(BOX.vertical)} Finish:  ${reasonColor(reason)}`);
  }

  // Close box
  lines.push(`${indent}${chalk.dim(BOX.bottomLeft + BOX.horizontal.repeat(width - 1))}`);

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gadget Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a collapsed gadget line.
 *
 * Format: `✓ Navigate(url=https://...) 1.2s | ↑ 5k ⤿ 2k ↓ 1k | $0.01`
 */
export function formatGadgetCollapsed(node: GadgetNode, selected: boolean): string {
  let indicator: string;
  let indicatorColor: typeof chalk;

  if (node.error) {
    indicator = ERROR_INDICATOR;
    indicatorColor = chalk.red;
  } else if (node.isComplete) {
    indicator = COMPLETE_INDICATOR;
    indicatorColor = chalk.green;
  } else {
    indicator = PROGRESS_INDICATOR;
    indicatorColor = chalk.blue;
  }

  const gadgetLabel = chalk.magenta.bold(node.name);

  // Format parameters inline (use available terminal width)
  let paramsStr = "";
  if (node.parameters && Object.keys(node.parameters).length > 0) {
    const termWidth = process.stdout.columns || 120;
    const maxParamLen = Math.max(60, termWidth - 40); // Leave room for indicator, name, time
    const entries = Object.entries(node.parameters).slice(0, 4);
    const formatted = entries.map(([key, value]) => {
      const strValue = typeof value === "string" ? value : JSON.stringify(value);
      const truncated = strValue.length > maxParamLen ? strValue.slice(0, maxParamLen - 3) + "..." : strValue;
      return `${chalk.dim(key)}=${chalk.cyan(truncated)}`;
    });
    paramsStr = `${chalk.dim("(")}${formatted.join(chalk.dim(", "))}${chalk.dim(")")}`;
  }

  // Error preview
  let errorStr = "";
  if (node.error) {
    const truncated = node.error.length > 40 ? node.error.slice(0, 37) + "..." : node.error;
    errorStr = ` ${chalk.red("error:")} ${truncated}`;
  }

  // Build metrics array
  const metrics: string[] = [];

  // Duration
  if (node.executionTimeMs !== undefined) {
    const time = node.executionTimeMs >= 1000
      ? `${(node.executionTimeMs / 1000).toFixed(1)}s`
      : `${Math.round(node.executionTimeMs)}ms`;
    metrics.push(time);
  }

  // Subagent token stats (if any LLM calls were made)
  if (node.subagentStats && node.subagentStats.llmCallCount > 0) {
    const { inputTokens, cachedTokens, outputTokens } = node.subagentStats;
    const tokenParts: string[] = [];
    tokenParts.push(chalk.dim("↑") + chalk.yellow(` ${formatTokens(inputTokens)}`));
    if (cachedTokens > 0) {
      tokenParts.push(chalk.dim("⤿") + chalk.blue(` ${formatTokens(cachedTokens)}`));
    }
    tokenParts.push(chalk.dim("↓") + chalk.green(` ${formatTokens(outputTokens)}`));
    metrics.push(tokenParts.join(" "));
  } else if (node.resultTokens && node.resultTokens > 0) {
    // Simple gadget - just show output tokens
    metrics.push(chalk.dim("↓") + chalk.green(` ${formatTokens(node.resultTokens)}`));
  }

  // Cost
  if (node.cost && node.cost > 0) {
    metrics.push(chalk.cyan(`$${formatCost(node.cost)}`));
  }

  // Join metrics with separator
  const metricsStr = metrics.length > 0 ? ` ${chalk.dim(metrics.join(" | "))}` : "";

  const line = `${indicatorColor(indicator)} ${gadgetLabel}${paramsStr}${errorStr}${metricsStr}`;

  // Highlight selected line
  if (selected) {
    return chalk.bgBlue.white(line);
  }

  return line;
}

/**
 * Formats expanded gadget details as multiple lines.
 *
 * Returns an array of lines to display below the collapsed header.
 */
export function formatGadgetExpanded(node: GadgetNode): string[] {
  const lines: string[] = [];
  const indent = "  ";
  const termWidth = process.stdout.columns || 120;
  const width = Math.max(60, termWidth - 8); // Use most of terminal width

  // Parameters section
  if (node.parameters && Object.keys(node.parameters).length > 0) {
    const headerLine = `${BOX.topLeft}${BOX.horizontal} Parameters ${BOX.horizontal.repeat(width - 14)}`;
    lines.push(`${indent}${chalk.dim(headerLine)}`);

    for (const [key, value] of Object.entries(node.parameters)) {
      const strValue = typeof value === "string" ? value : JSON.stringify(value, null, 2);
      // Handle multi-line values
      const valueLines = strValue.split("\n");
      const maxValueLen = width - 10; // Leave room for indent and key
      if (valueLines.length === 1) {
        const truncated = strValue.length > maxValueLen ? strValue.slice(0, maxValueLen - 3) + "..." : strValue;
        lines.push(`${indent}${chalk.dim(BOX.vertical)} ${chalk.dim(key)}: ${chalk.cyan(truncated)}`);
      } else {
        lines.push(`${indent}${chalk.dim(BOX.vertical)} ${chalk.dim(key)}:`);
        for (const line of valueLines.slice(0, 5)) {
          lines.push(`${indent}${chalk.dim(BOX.vertical)}   ${chalk.cyan(line)}`);
        }
        if (valueLines.length > 5) {
          lines.push(`${indent}${chalk.dim(BOX.vertical)}   ${chalk.dim(`... (${valueLines.length - 5} more lines)`)}`);
        }
      }
    }
    lines.push(`${indent}${chalk.dim(BOX.bottomLeft + BOX.horizontal.repeat(width - 1))}`);
  }

  // Result section
  if (node.result || node.error) {
    const headerText = node.error ? " Error " : " Result ";
    const headerLine = `${BOX.topLeft}${BOX.horizontal}${headerText}${BOX.horizontal.repeat(width - headerText.length - 2)}`;
    lines.push(`${indent}${chalk.dim(headerLine)}`);

    const content = node.error || node.result || "";
    const contentLines = content.split("\n");
    const maxLines = 10;
    const displayLines = contentLines.slice(0, maxLines);

    for (const line of displayLines) {
      const truncated = line.length > width - 4 ? line.slice(0, width - 7) + "..." : line;
      const color = node.error ? chalk.red : chalk.white;
      lines.push(`${indent}${chalk.dim(BOX.vertical)} ${color(truncated)}`);
    }

    if (contentLines.length > maxLines) {
      lines.push(`${indent}${chalk.dim(BOX.vertical)} ${chalk.dim(`... (${contentLines.length - maxLines} more lines)`)}`);
    }

    // Execution time
    if (node.executionTimeMs !== undefined) {
      const time = node.executionTimeMs >= 1000
        ? `${(node.executionTimeMs / 1000).toFixed(1)}s`
        : `${Math.round(node.executionTimeMs)}ms`;
      lines.push(`${indent}${chalk.dim(BOX.vertical)} Time: ${chalk.dim(time)}`);
    }

    lines.push(`${indent}${chalk.dim(BOX.bottomLeft + BOX.horizontal.repeat(width - 1))}`);
  }

  // Subagent activity section
  if (node.children.length > 0) {
    const headerLine = `${BOX.topLeft}${BOX.horizontal} Subagent Activity ${BOX.horizontal.repeat(width - 21)}`;
    lines.push(`${indent}${chalk.dim(headerLine)}`);
    lines.push(`${indent}${chalk.dim(BOX.vertical)} ${chalk.dim(`${node.children.length} nested calls (expand children to see details)`)}`);
    lines.push(`${indent}${chalk.dim(BOX.bottomLeft + BOX.horizontal.repeat(width - 1))}`);
  }

  // Metrics section - show if any metrics are available
  if (node.executionTimeMs !== undefined || node.cost || node.resultTokens || node.subagentStats) {
    const metricsHeaderLine = `${BOX.topLeft}${BOX.horizontal} Metrics ${BOX.horizontal.repeat(width - 11)}`;
    lines.push(`${indent}${chalk.dim(metricsHeaderLine)}`);

    // Duration
    if (node.executionTimeMs !== undefined) {
      const time = node.executionTimeMs >= 1000
        ? `${(node.executionTimeMs / 1000).toFixed(1)}s`
        : `${Math.round(node.executionTimeMs)}ms`;
      lines.push(`${indent}${chalk.dim(BOX.vertical)} Duration: ${chalk.dim(time)}`);
    }

    // Output tokens (estimated from result)
    if (node.resultTokens && node.resultTokens > 0) {
      lines.push(`${indent}${chalk.dim(BOX.vertical)} Output:   ${chalk.green(`~${formatTokens(node.resultTokens)}`)} tokens`);
    }

    // Cost
    if (node.cost && node.cost > 0) {
      lines.push(`${indent}${chalk.dim(BOX.vertical)} Cost:     ${chalk.cyan(`$${formatCost(node.cost)}`)}`);
    }

    // Subagent stats (aggregated from child LLM calls)
    if (node.subagentStats && node.subagentStats.llmCallCount > 0) {
      const s = node.subagentStats;
      const tokenParts: string[] = [];
      tokenParts.push(chalk.dim("↑") + chalk.yellow(` ${formatTokens(s.inputTokens)}`));
      if (s.cachedTokens > 0) {
        tokenParts.push(chalk.dim("⤿") + chalk.blue(` ${formatTokens(s.cachedTokens)}`));
      }
      tokenParts.push(chalk.dim("↓") + chalk.green(` ${formatTokens(s.outputTokens)}`));
      const tokenStr = tokenParts.join(" ");
      lines.push(`${indent}${chalk.dim(BOX.vertical)} LLM calls: ${s.llmCallCount} (${tokenStr})`);
    }

    lines.push(`${indent}${chalk.dim(BOX.bottomLeft + BOX.horizontal.repeat(width - 1))}`);
  }

  if (lines.length === 0) {
    lines.push(`${indent}${chalk.dim("No details available")}`);
  }

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Indentation Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates indentation string based on tree depth.
 * Uses tree-style prefixes for visual hierarchy.
 */
export function getIndent(depth: number, isLast = false): string {
  if (depth === 0) return "";

  const baseIndent = "  ".repeat(depth - 1);
  const connector = isLast ? "└─ " : "├─ ";
  return baseIndent + connector;
}

/**
 * Creates continuation indent for expanded content.
 */
export function getContinuationIndent(depth: number): string {
  if (depth === 0) return "";
  return "  ".repeat(depth) + "  ";
}
