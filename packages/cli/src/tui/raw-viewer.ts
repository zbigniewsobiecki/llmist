/**
 * Full-screen raw request/response viewer for LLM calls and gadgets.
 *
 * Features:
 * - Scrollable content with arrow keys, PgUp/PgDn, Home/End
 * - Message formatting with role headers (LLM calls)
 * - JSON formatting for gadget parameters
 * - Escape or "q" to close
 */

import { Box, type Screen } from "@unblessed/node";
import type { LLMMessage } from "llmist";

export type RawViewerMode = "request" | "response";

interface RawViewerOptions {
  screen: Screen;
  mode: RawViewerMode;
  // For LLM calls
  request?: LLMMessage[];
  response?: string;
  iteration?: number;
  model?: string;
  // For gadgets
  gadgetName?: string;
  parameters?: Record<string, unknown>;
  result?: string;
  error?: string;
}

// ANSI color codes
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const WHITE = "\x1b[37m";
const BG_BLUE = "\x1b[44m";

/** Return type for showRawViewer */
export interface RawViewerHandle {
  /** Promise that resolves when the viewer is closed */
  closed: Promise<void>;
  /** Function to programmatically close the viewer */
  close: () => void;
}

/**
 * Shows a full-screen viewer for raw LLM request/response or gadget parameters/result.
 * Returns a handle with a promise and a close function.
 */
export function showRawViewer(options: RawViewerOptions): RawViewerHandle {
  let closeCallback: () => void = () => {};

  const closed = new Promise<void>((resolve) => {
    const {
      screen,
      mode,
      request,
      response,
      iteration,
      model,
      gadgetName,
      parameters,
      result,
      error,
    } = options;

    // Format content based on mode and node type
    let content: string;
    let title: string;

    // Determine if this is a gadget viewer (gadgetName is provided)
    const isGadget = gadgetName !== undefined;

    if (isGadget) {
      // Gadget viewer
      if (mode === "request") {
        title = ` Raw Parameters - ${gadgetName} `;
        if (!parameters || Object.keys(parameters).length === 0) {
          content = `${DIM}No parameters${RESET}`;
        } else {
          content = formatGadgetParameters(parameters);
        }
      } else {
        title = ` Raw Result - ${gadgetName} `;
        if (error) {
          content = `${RED}${BOLD}Error:${RESET}\n${error}`;
        } else if (!result) {
          content = `${DIM}No result data available${RESET}`;
        } else {
          content = formatGadgetResult(result);
        }
      }
    } else {
      // LLM call viewer
      if (mode === "request") {
        title = ` Raw Request - #${iteration} ${model} `;
        if (!request || request.length === 0) {
          content = `${DIM}No request data available${RESET}`;
        } else {
          content = formatMessages(request);
        }
      } else {
        title = ` Raw Response - #${iteration} ${model} `;
        if (!response) {
          content = `${DIM}No response data available${RESET}`;
        } else {
          content = response;
        }
      }
    }

    // Create full-screen modal
    const viewer = new Box({
      parent: screen,
      top: 0,
      left: 0,
      width: "100%",
      height: "100%-1", // Leave room for help bar
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: {
        ch: " ",
        style: { bg: "blue" },
      },
      border: { type: "line" },
      label: title,
      style: {
        fg: "white",
        bg: "black",
        border: { fg: "cyan" },
        label: { fg: "cyan", bold: true },
      },
      padding: { left: 1, right: 1 },
      content,
      tags: false, // We use ANSI codes directly
    });

    // Add help bar at the bottom
    const helpBar = new Box({
      parent: screen,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      content: `${DIM} [${WHITE}↑/↓/PgUp/PgDn${DIM}] Scroll  [${WHITE}Home/End${DIM}] Jump  [${WHITE}Escape/q${DIM}] Close${RESET}`,
      tags: false,
      style: { fg: "white", bg: "black" },
    });

    viewer.focus();

    // Handle close
    const close = () => {
      helpBar.destroy();
      viewer.destroy();
      screen.render();
      resolve();
    };

    // Expose close function for external use
    closeCallback = close;

    viewer.key(["escape", "q"], close);

    // Additional scroll shortcuts
    viewer.key(["home", "g"], () => {
      viewer.setScrollPerc?.(0);
      screen.render();
    });

    viewer.key(["end", "S-g"], () => {
      viewer.setScrollPerc?.(100);
      screen.render();
    });

    screen.render();
  });

  return { closed, close: closeCallback };
}

/**
 * Format LLM messages array for display.
 * Shows role headers and content with color coding.
 */
function formatMessages(messages: LLMMessage[]): string {
  const lines: string[] = [];
  const separator = "─".repeat(78);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const roleColor = getRoleColor(msg.role);
    const roleName = msg.role.toUpperCase();

    // Message header
    lines.push(`${DIM}${separator}${RESET}`);
    lines.push(
      `${roleColor}${BOLD}[${roleName}]${RESET} ${DIM}Message ${i + 1} of ${messages.length}${RESET}`,
    );
    lines.push(`${DIM}${separator}${RESET}`);
    lines.push("");

    // Message content
    const contentLines = formatMessageContent(msg.content);
    lines.push(...contentLines);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format message content (handles string and multimodal content).
 */
function formatMessageContent(content: string | unknown[]): string[] {
  if (typeof content === "string") {
    return content.split("\n");
  }

  if (!Array.isArray(content)) {
    return [JSON.stringify(content, null, 2)];
  }

  const lines: string[] = [];

  for (const part of content) {
    if (typeof part === "string") {
      lines.push(...part.split("\n"));
    } else if (isTextPart(part)) {
      lines.push(...part.text.split("\n"));
    } else if (isImagePart(part)) {
      const mediaType = part.source?.media_type || "unknown";
      lines.push(`${DIM}[Image: ${mediaType}]${RESET}`);
    } else if (isAudioPart(part)) {
      const mediaType = part.source?.media_type || "unknown";
      lines.push(`${DIM}[Audio: ${mediaType}]${RESET}`);
    } else if (isToolUsePart(part)) {
      lines.push(`${YELLOW}${BOLD}[Tool Use: ${part.name}]${RESET}`);
      lines.push(`${DIM}ID: ${part.id}${RESET}`);
      lines.push(`${DIM}Input:${RESET}`);
      const inputStr = JSON.stringify(part.input, null, 2);
      lines.push(...inputStr.split("\n").map((l) => `  ${l}`));
    } else if (isToolResultPart(part)) {
      lines.push(`${CYAN}${BOLD}[Tool Result]${RESET}`);
      lines.push(`${DIM}Tool Use ID: ${part.tool_use_id}${RESET}`);
      if (typeof part.content === "string") {
        lines.push(...part.content.split("\n"));
      } else {
        lines.push(JSON.stringify(part.content, null, 2));
      }
    } else {
      // Unknown part type - show as JSON
      const partType = (part as { type?: string }).type || "unknown";
      lines.push(`${DIM}[${partType}]${RESET}`);
      lines.push(JSON.stringify(part, null, 2));
    }
  }

  return lines;
}

/**
 * Get ANSI color code for a message role.
 */
function getRoleColor(role: string): string {
  switch (role) {
    case "system":
      return MAGENTA;
    case "user":
      return GREEN;
    case "assistant":
      return CYAN;
    default:
      return WHITE;
  }
}

// Type guards for content parts
function isTextPart(part: unknown): part is { type: "text"; text: string } {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as { type?: string }).type === "text" &&
    typeof (part as { text?: unknown }).text === "string"
  );
}

function isImagePart(part: unknown): part is { type: "image"; source?: { media_type?: string } } {
  return typeof part === "object" && part !== null && (part as { type?: string }).type === "image";
}

function isAudioPart(part: unknown): part is { type: "audio"; source?: { media_type?: string } } {
  return typeof part === "object" && part !== null && (part as { type?: string }).type === "audio";
}

function isToolUsePart(
  part: unknown,
): part is { type: "tool_use"; id: string; name: string; input: unknown } {
  return (
    typeof part === "object" && part !== null && (part as { type?: string }).type === "tool_use"
  );
}

function isToolResultPart(
  part: unknown,
): part is { type: "tool_result"; tool_use_id: string; content: unknown } {
  return (
    typeof part === "object" && part !== null && (part as { type?: string }).type === "tool_result"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gadget Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format gadget parameters as pretty-printed JSON with syntax highlighting.
 */
function formatGadgetParameters(params: Record<string, unknown>): string {
  const lines: string[] = [];
  const separator = "─".repeat(78);

  lines.push(`${DIM}${separator}${RESET}`);
  lines.push(`${CYAN}${BOLD}Parameters${RESET}`);
  lines.push(`${DIM}${separator}${RESET}`);
  lines.push("");

  // Pretty-print the parameters with syntax highlighting
  const json = JSON.stringify(params, null, 2);
  const highlighted = highlightJson(json);
  lines.push(highlighted);

  return lines.join("\n");
}

/**
 * Format gadget result for display.
 * Attempts JSON parsing for pretty-printing if the result looks like JSON.
 */
function formatGadgetResult(result: string): string {
  const lines: string[] = [];
  const separator = "─".repeat(78);

  lines.push(`${DIM}${separator}${RESET}`);
  lines.push(`${GREEN}${BOLD}Result${RESET}`);
  lines.push(`${DIM}${separator}${RESET}`);
  lines.push("");

  // Try to parse as JSON for pretty-printing
  const trimmed = result.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      const json = JSON.stringify(parsed, null, 2);
      lines.push(highlightJson(json));
      return lines.join("\n");
    } catch {
      // Not valid JSON, display as plain text
    }
  }

  // Display as plain text
  lines.push(result);
  return lines.join("\n");
}

/**
 * Add basic syntax highlighting to JSON string.
 */
function highlightJson(json: string): string {
  // Highlight keys (strings followed by :)
  let result = json.replace(/"([^"]+)":/g, `${CYAN}"$1"${RESET}:`);
  // Highlight string values
  result = result.replace(/: "([^"]*)"/g, `: ${GREEN}"$1"${RESET}`);
  // Highlight numbers
  result = result.replace(/: (-?\d+\.?\d*)/g, `: ${YELLOW}$1${RESET}`);
  // Highlight booleans and null
  result = result.replace(/: (true|false|null)/g, `: ${MAGENTA}$1${RESET}`);
  return result;
}
