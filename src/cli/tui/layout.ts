/**
 * TUI layout widget creation.
 *
 * Creates and configures the three main TUI widgets:
 * - Body: ScrollableBox for interactive block widgets
 * - InputBar: Always-visible input field at the bottom
 * - StatusBar: Metrics display (tokens, time, cost)
 */

import { Box, ScrollableBox, Textbox, type Screen } from "@unblessed/node";
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

  // Input bar - always visible at bottom - 1
  // Shows "> " prompt indicator even when idle
  const inputBar = new Textbox({
    parent: screen,
    bottom: 1,
    left: 0,
    width: "100%",
    height: 1,
    inputOnFocus: true,
    keys: true,
    mouse: true,
    style: {
      fg: "white",
      bg: "black",
    },
  });

  // Pre-fill with prompt indicator
  inputBar.setValue("> ");

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

  return { body, inputBar, statusBar };
}

/**
 * Sets up keyboard navigation for block selection in the TUI.
 *
 * Provides navigation between selectable blocks (LLM calls, gadgets)
 * and expand/collapse functionality for viewing details.
 *
 * @param screen - The blessed Screen instance
 * @param callbacks - Object with navigation callback functions
 */
export function setupBlockNavigationKeys(
  screen: Screen,
  callbacks: {
    onSelectNext: () => void;
    onSelectPrevious: () => void;
    onToggleExpand: () => void;
    onCollapse: () => void;
    onSelectFirst: () => void;
    onSelectLast: () => void;
  },
): void {
  // Navigation: up/down or vim keys
  screen.key(["up", "k"], () => {
    callbacks.onSelectPrevious();
    screen.render();
  });

  screen.key(["down", "j"], () => {
    callbacks.onSelectNext();
    screen.render();
  });

  // Expand/collapse with Enter or Space
  screen.key(["enter", "space"], () => {
    callbacks.onToggleExpand();
    screen.render();
  });

  // Collapse with Escape or h (vim-style left)
  screen.key(["escape", "h"], () => {
    callbacks.onCollapse();
    screen.render();
  });

  // Jump to first/last
  screen.key(["home", "g"], () => {
    callbacks.onSelectFirst();
    screen.render();
  });

  screen.key(["end", "G"], () => {
    callbacks.onSelectLast();
    screen.render();
  });
}
