/**
 * TUI approval dialog for gadget execution approvals.
 *
 * Shows a modal popup for dangerous gadgets (WriteFile, RunCommand, etc.)
 * that require user confirmation before execution.
 */

import { Box, type Screen } from "@unblessed/node";
import type { ApprovalResponse, ApprovalContext } from "./types.js";

/** Maximum lines to show in preview */
const MAX_PREVIEW_LINES = 10;

/** Maximum width for parameter values */
const MAX_PARAM_VALUE_LENGTH = 60;

/**
 * Shows an approval dialog and waits for user response.
 *
 * @param screen - The blessed Screen instance
 * @param context - Approval context (gadget name, parameters, preview)
 * @returns Promise resolving to user's response
 */
export function showApprovalDialog(
  screen: Screen,
  context: ApprovalContext,
): Promise<ApprovalResponse> {
  return new Promise((resolve) => {
    // Build dialog content
    const content = buildDialogContent(context);

    // Create modal dialog box
    const dialog = new Box({
      parent: screen,
      top: "center",
      left: "center",
      width: "70%",
      height: "shrink",
      // Content
      content,
      tags: true,
      // Visual style
      border: {
        type: "line",
      },
      style: {
        fg: "white",
        bg: "black",
        border: {
          fg: "yellow",
        },
      },
      // Padding inside border
      padding: {
        left: 1,
        right: 1,
        top: 0,
        bottom: 0,
      },
      // Ensure it's on top
      // Note: blessed doesn't have zIndex, but later-added elements render on top
    });

    // Focus the dialog to capture key events
    dialog.focus();

    // Handle key presses
    const handleKey = (ch: string, key: { name: string }) => {
      let response: ApprovalResponse | null = null;

      switch (key.name) {
        case "y":
          response = "yes";
          break;
        case "n":
          response = "no";
          break;
        case "a":
          response = "always";
          break;
        case "d":
          response = "deny";
          break;
        case "escape":
          response = "cancel";
          break;
      }

      if (response) {
        // Clean up
        dialog.destroy();
        screen.render();

        // Resolve with response
        resolve(response);
      }
    };

    dialog.on("keypress", handleKey);
    screen.render();
  });
}

/**
 * Build the dialog content string.
 */
function buildDialogContent(context: ApprovalContext): string {
  const lines: string[] = [];

  // Title
  lines.push(`{bold}{yellow-fg}Approve ${context.gadgetName}?{/}`);
  lines.push("");

  // Parameters
  if (Object.keys(context.parameters).length > 0) {
    lines.push("{bold}Parameters:{/}");
    for (const [key, value] of Object.entries(context.parameters)) {
      const valueStr = formatParamValue(value);
      lines.push(`  {cyan-fg}${key}{/}: ${valueStr}`);
    }
    lines.push("");
  }

  // Preview (if available)
  if (context.preview) {
    lines.push("{bold}Preview:{/}");
    const previewLines = context.preview.split("\n").slice(0, MAX_PREVIEW_LINES);
    for (const line of previewLines) {
      lines.push(`  {gray-fg}${escapeContent(line)}{/}`);
    }
    if (context.preview.split("\n").length > MAX_PREVIEW_LINES) {
      lines.push("  {gray-fg}...{/}");
    }
    lines.push("");
  }

  // Options
  lines.push("{bold}Options:{/}");
  lines.push("  {green-fg}[y]{/}es     - Execute this time");
  lines.push("  {red-fg}[n]{/}o      - Skip this time");
  lines.push("  {blue-fg}[a]{/}lways  - Always allow this gadget");
  lines.push("  {magenta-fg}[d]{/}eny    - Always deny this gadget");
  lines.push("  {gray-fg}[ESC]{/}    - Cancel");

  return lines.join("\n");
}

/**
 * Format a parameter value for display.
 */
function formatParamValue(value: unknown): string {
  let str: string;

  if (typeof value === "string") {
    str = value;
  } else if (value === null || value === undefined) {
    str = String(value);
  } else {
    str = JSON.stringify(value);
  }

  // Truncate if too long
  if (str.length > MAX_PARAM_VALUE_LENGTH) {
    str = str.slice(0, MAX_PARAM_VALUE_LENGTH - 1) + "…";
  }

  // Escape blessed tags
  return escapeContent(str);
}

/**
 * Escape content for blessed tags.
 */
function escapeContent(str: string): string {
  // Escape curly braces that could be interpreted as blessed tags
  return str.replace(/\{/g, "{{").replace(/\}/g, "}}");
}
