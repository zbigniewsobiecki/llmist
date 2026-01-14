/**
 * TUI layout widget creation.
 *
 * Creates and configures the TUI widgets:
 * - Body: ScrollableBox for interactive block widgets
 * - InputBar: Input field (visible in input mode, hidden in browse mode)
 * - StatusBar: Metrics display (tokens, time, cost)
 * - HintsBar: Keyboard shortcuts hints (optional)
 */

import { Box, type Screen, ScrollableBox, Text, Textbox } from "@unblessed/node";
import type { TUIBlockLayout } from "./types.js";

/**
 * Creates the TUI layout with ScrollableBox for interactive blocks.
 *
 * Layout structure (from bottom, with hints enabled):
 * - Hints bar: 1 line at very bottom (optional)
 * - Status bar: 1 line above hints
 * - Input bar: 1 line above status
 * - Body: Remaining space (ScrollableBox with Box children)
 *
 * @param screen - The blessed Screen instance
 * @param showHints - Whether to show keyboard shortcuts hints bar (default: true)
 * @returns Layout object containing all widgets
 */
export function createBlockLayout(screen: Screen, showHints = true): TUIBlockLayout {
  // Calculate bottom positions based on hints bar visibility
  // With hints: body=100%-3, input=2, status=1, hints=0
  // Without hints: body=100%-2, input=1, status=0
  const inputBottom = showHints ? 2 : 1;
  const statusBottom = showHints ? 1 : 0;
  const bodyHeight = showHints ? "100%-3" : "100%-2";

  // Main scrollable container for block widgets
  // Uses ScrollableBox to support Box children (not just text)
  // Height adjusts based on hints bar and dynamically for input bar visibility
  const body = new ScrollableBox({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: bodyHeight,
    // Scrolling configuration
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    keys: false, // We handle keys ourselves for block selection
    scrollbar: {
      ch: " ",
      style: {
        bg: "blue",
      },
    },
    // Don't use blessed tags - we pass ANSI directly from chalk
    tags: false,
    // Style
    style: {
      fg: "white",
      bg: "black",
    },
  });

  // Static prompt label (non-editable)
  // This widget displays "> " when input is available
  const promptLabel = new Text({
    parent: screen,
    bottom: inputBottom,
    left: 0,
    width: 2, // "> " = 2 chars
    height: 1,
    content: "> ",
    style: {
      fg: "cyan",
      bg: "black",
    },
  });

  // Input bar - simple single-line input
  // Enter submits, Ctrl+S opens $EDITOR for multiline
  // Note: Don't use inputOnFocus - we explicitly call readInput() in InputHandler
  const inputBar = new Textbox({
    parent: screen,
    bottom: inputBottom,
    left: 2, // Position after prompt label ("> " = 2 chars)
    width: "100%-2",
    height: 1,
    keys: true,
    mouse: true,
    style: {
      fg: "white",
      bg: "black",
    },
  });

  // Status bar - metrics display
  // Uses ANSI codes for color formatting (tags: false)
  const statusBar = new Box({
    parent: screen,
    bottom: statusBottom,
    left: 0,
    width: "100%",
    height: 1,
    tags: false,
    style: {
      fg: "white",
      bg: "black",
    },
  });

  // Hints bar - keyboard shortcuts (optional)
  // Shows contextual hints based on current mode
  const hintsBar = showHints
    ? new Box({
        parent: screen,
        bottom: 0,
        left: 0,
        width: "100%",
        height: 1,
        tags: false,
        style: {
          fg: "white",
          bg: "black",
        },
      })
    : null;

  return { body, promptLabel, inputBar, statusBar, hintsBar };
}
