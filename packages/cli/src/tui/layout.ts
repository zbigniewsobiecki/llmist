/**
 * TUI layout widget creation.
 *
 * Creates and configures the three main TUI widgets:
 * - Body: ScrollableBox for interactive block widgets
 * - InputBar: Always-visible input field at the bottom
 * - StatusBar: Metrics display (tokens, time, cost)
 */

import { Box, type Screen, ScrollableBox, Text, Textbox } from "@unblessed/node";
import type { TUIBlockLayout } from "./types.js";

/**
 * Creates the TUI layout with ScrollableBox for interactive blocks.
 *
 * Layout structure (from bottom):
 * - Status bar: 1 line at very bottom
 * - Input bar: 1 line above status
 * - Body: Remaining space (ScrollableBox with Box children)
 *
 * @param screen - The blessed Screen instance
 * @returns Layout object containing all widgets
 */
export function createBlockLayout(screen: Screen): TUIBlockLayout {
  // Main scrollable container for block widgets
  // Uses ScrollableBox to support Box children (not just text)
  const body = new ScrollableBox({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%-2",
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
  // This widget displays "> " or ">>> " and cannot be modified by the user
  const promptLabel = new Text({
    parent: screen,
    bottom: 1,
    left: 0,
    width: 4, // ">>> " = 4 chars (max prompt width)
    height: 1,
    content: "> ",
    style: {
      fg: "cyan",
      bg: "black",
    },
  });

  // Input bar - editable textbox positioned after the prompt label
  // Value contains ONLY user input, no prompt prefix
  // Note: Don't use inputOnFocus - we explicitly call readInput() in InputHandler
  // Using both causes double character echo
  const inputBar = new Textbox({
    parent: screen,
    bottom: 1,
    left: 4, // Position after prompt label
    width: "100%-4",
    height: 1,
    keys: true,
    mouse: true,
    style: {
      fg: "white",
      bg: "black",
    },
  });

  // Status bar at very bottom
  // Uses ANSI codes for color formatting (tags: false)
  const statusBar = new Box({
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
  });

  return { body, promptLabel, inputBar, statusBar };
}
