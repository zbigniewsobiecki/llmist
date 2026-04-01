/**
 * BlockContentFormatter - Pure formatting functions for block content.
 *
 * Extracted from BlockRenderer to separate content formatting from rendering logic.
 * All functions are stateless/pure — no side effects, no UI references.
 *
 * Complements the existing block-formatters.ts which handles LLM/gadget-specific
 * formatting. This module handles the higher-level formatting dispatch and
 * node-type-specific rendering logic.
 *
 * @module
 */

import {
  formatGadgetCollapsed,
  formatGadgetExpanded,
  formatLLMCallCollapsed,
  formatLLMCallExpanded,
  getContinuationIndent,
  getIndent,
} from "../ui/block-formatters.js";
import { formatUserMessage, renderMarkdown } from "../ui/formatters.js";
import type {
  BlockNode,
  ContentFilterMode,
  GadgetNode,
  SystemMessageNode,
  ThinkingNode,
} from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Block Content Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format block content based on node type and state.
 *
 * Dispatches to the appropriate formatter based on the node type.
 *
 * @param node - The node to format
 * @param selected - Whether this block is currently selected
 * @param expanded - Whether this block is currently expanded
 * @returns Formatted string content for the block's Box widget
 */
export function formatBlockContent(node: BlockNode, selected: boolean, expanded: boolean): string {
  const indent = getIndent(node.depth);

  switch (node.type) {
    case "llm_call": {
      const collapsed = formatLLMCallCollapsed(node, selected);
      if (!expanded) {
        return indent + collapsed;
      }
      const expandedLines = formatLLMCallExpanded(node);
      const contIndent = getContinuationIndent(node.depth);
      return [indent + collapsed, ...expandedLines.map((line) => contIndent + line)].join("\n");
    }

    case "gadget": {
      const collapsed = formatGadgetCollapsed(node, selected);
      if (!expanded) {
        return indent + collapsed;
      }
      const expandedLines = formatGadgetExpanded(node);
      const contIndent = getContinuationIndent(node.depth);
      return [indent + collapsed, ...expandedLines.map((line) => contIndent + line)].join("\n");
    }

    case "text": {
      // User messages (id starts with "user_") are formatted specially
      if (node.id.startsWith("user_")) {
        return formatUserMessage(node.content);
      }
      // Regular text content - abbreviate when collapsed, full when expanded
      const fullContent = renderMarkdown(node.content);
      if (expanded) {
        return `\n${fullContent}\n`;
      }
      return abbreviateToLines(fullContent, 2, selected);
    }

    case "thinking": {
      return formatThinkingContent(node, indent, expanded);
    }

    case "system_message": {
      const icon = getSystemMessageIcon(node.category);
      const color = getSystemMessageColor(node.category);
      const RESET = "\x1b[0m";
      return `${indent}${color}${icon} ${node.message}${RESET}`;
    }
  }
}

/**
 * Format thinking block content.
 */
function formatThinkingContent(node: ThinkingNode, indent: string, expanded: boolean): string {
  const DIM = "\x1b[2m";
  const RED_DIM = "\x1b[2;31m";
  const RESET = "\x1b[0m";
  const contIndent = getContinuationIndent(node.depth);

  if (node.thinkingType === "redacted") {
    return `${indent}${RED_DIM}🔒 [Redacted thinking block]${RESET}`;
  }

  if (!expanded) {
    const firstLine = node.content.split("\n")[0]?.slice(0, 60) ?? "";
    const suffix = node.isComplete ? "" : "...";
    return `${indent}${DIM}💭 Thinking${suffix} ${firstLine}${RESET}`;
  }

  // Expanded: show full thinking content in dim styling
  const tokenInfo = node.isComplete ? ` (${Math.ceil(node.content.length / 4)} tokens est.)` : "";
  const header = `${indent}${DIM}▼ 💭 Thinking${tokenInfo}${RESET}`;
  const contentLines = node.content.split("\n").map((line) => `${contIndent}${DIM}${line}${RESET}`);
  return [header, ...contentLines].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// System Message Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get icon for system message category.
 */
export function getSystemMessageIcon(category: SystemMessageNode["category"]): string {
  switch (category) {
    case "throttle":
      return "⏸";
    case "retry":
      return "🔄";
    case "info":
      return "ℹ️";
    case "warning":
      return "⚠️";
    case "error":
      return "❌";
  }
}

/**
 * Get ANSI color code for system message category.
 */
export function getSystemMessageColor(category: SystemMessageNode["category"]): string {
  const YELLOW = "\x1b[33m";
  const BLUE = "\x1b[34m";
  const GRAY = "\x1b[90m";
  const RED = "\x1b[31m";

  switch (category) {
    case "throttle":
      return YELLOW;
    case "retry":
      return BLUE;
    case "info":
      return GRAY;
    case "warning":
      return YELLOW;
    case "error":
      return RED;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Text Abbreviation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Abbreviate text content to a maximum number of lines.
 * Shows truncation indicator if content exceeds limit.
 *
 * @param text - The text to abbreviate
 * @param maxLines - Maximum number of lines to show
 * @param selected - Whether this block is selected (for indicator styling)
 * @returns Abbreviated text with truncation indicator if needed
 */
export function abbreviateToLines(text: string, maxLines: number, selected: boolean): string {
  // Split text into lines, filtering out empty lines at start
  const lines = text.split("\n");

  // Find first non-empty line
  let startIndex = 0;
  while (startIndex < lines.length && lines[startIndex].trim() === "") {
    startIndex++;
  }

  // Get content lines (skip leading empty lines)
  const contentLines = lines.slice(startIndex);

  if (contentLines.length <= maxLines) {
    // Content fits, return with leading newline for visual separation
    return `\n${contentLines.join("\n")}`;
  }

  // Need to truncate - take first maxLines and add indicator
  const truncatedLines = contentLines.slice(0, maxLines);
  const indicator = selected ? "▶ ..." : "  ...";

  return `\n${truncatedLines.join("\n")}\n${indicator}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Focused Mode Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a node is visible in the current content filter mode.
 *
 * In focused mode, we keep only user-facing content visible:
 * plain text plus TellUser/AskUser/Finish gadget output.
 */
export function isNodeVisibleInFilterMode(
  node: BlockNode,
  contentFilterMode: ContentFilterMode,
): boolean {
  if (contentFilterMode === "full") {
    return true;
  }

  switch (node.type) {
    case "text":
      return true;
    case "gadget":
      return shouldRenderAsText(node, contentFilterMode);
    default:
      return false;
  }
}

/**
 * Check if a gadget should render as plain text in focused mode.
 * TellUser, AskUser, and Finish render as text for a chat-like experience.
 */
export function shouldRenderAsText(node: BlockNode, contentFilterMode: ContentFilterMode): boolean {
  if (contentFilterMode !== "focused") return false;
  if (node.type !== "gadget") return false;

  const name = (node as GadgetNode).name;
  return name === "TellUser" || name === "AskUser" || name === "Finish";
}

/**
 * Format a gadget as plain text (for focused mode: TellUser/AskUser/Finish).
 * Returns the formatted content string, or empty string if nothing to show.
 */
export function formatGadgetAsText(node: GadgetNode): string {
  if (node.name === "TellUser") {
    const message = node.parameters?.message;
    if (typeof message === "string") {
      return `\n${renderMarkdown(message)}\n`;
    }
  } else if (node.name === "AskUser") {
    const question = node.parameters?.question;
    if (typeof question === "string") {
      return `\n? ${question}\n`;
    }
  } else if (node.name === "Finish") {
    const message = node.parameters?.message;
    if (typeof message === "string" && message.trim()) {
      return `\n\x1b[32m✓\x1b[0m ${renderMarkdown(message)}\n`;
    }
  }
  return "";
}
