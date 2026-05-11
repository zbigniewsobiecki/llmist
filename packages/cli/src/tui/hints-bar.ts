/**
 * TUI hints bar for contextual keyboard shortcut suggestions.
 *
 * Displays relevant keyboard shortcuts based on current mode:
 * - INPUT mode: multiline editing, browse toggle, focused mode
 * - BROWSE mode: navigation keys, expand, mode toggles
 * - FOCUSED mode: how to exit focused view
 */

import type { Box } from "@unblessed/node";
import type { ContentFilterMode, FocusMode } from "./types.js";

// ANSI color codes
const GRAY = "\x1b[90m";
const RESET = "\x1b[0m";

/**
 * Manages the hints bar that shows contextual keyboard shortcuts.
 */
export class HintsBar {
  private hintsBox: Box;
  private renderCallback: () => void;

  private focusMode: FocusMode = "browse";
  private contentFilterMode: ContentFilterMode = "full";
  private hasContent = false;
  /** Whether terminal mouse capture is currently enabled */
  private mouseEnabled = false;

  constructor(hintsBox: Box, renderCallback: () => void) {
    this.hintsBox = hintsBox;
    this.renderCallback = renderCallback;

    // Initial render
    this.render();
  }

  /**
   * Update focus mode and re-render hints.
   */
  setFocusMode(mode: FocusMode): void {
    if (this.focusMode !== mode) {
      this.focusMode = mode;
      this.render();
    }
  }

  /**
   * Update content filter mode and re-render hints.
   */
  setContentFilterMode(mode: ContentFilterMode): void {
    if (this.contentFilterMode !== mode) {
      this.contentFilterMode = mode;
      this.render();
    }
  }

  /**
   * Update whether there's content to browse.
   * Affects whether ^B browse hint is shown in input mode.
   */
  setHasContent(has: boolean): void {
    if (this.hasContent !== has) {
      this.hasContent = has;
      this.render();
    }
  }

  /**
   * Update mouse capture enabled state and re-render hints.
   * When disabled (default): shows "^Y mouse" hint to enable mouse scrolling.
   * When enabled: shows "^Y select" hint to switch back to text selection.
   */
  setMouseEnabled(enabled: boolean): void {
    if (this.mouseEnabled !== enabled) {
      this.mouseEnabled = enabled;
      this.render();
    }
  }

  /**
   * Get current focus mode.
   */
  getFocusMode(): FocusMode {
    return this.focusMode;
  }

  /**
   * Get current content filter mode.
   */
  getContentFilterMode(): ContentFilterMode {
    return this.contentFilterMode;
  }

  /**
   * Render hints based on current state.
   */
  private render(): void {
    const hints: string[] = [];

    if (this.contentFilterMode === "focused") {
      // Focused content mode - show how to exit
      hints.push("^K exit focused mode");
    } else if (this.focusMode === "input") {
      // Input mode - show editing and mode switch hints
      hints.push("^S multiline");
      if (this.hasContent) {
        hints.push("^B browse");
      }
      hints.push("^K focused");
    } else {
      // Browse mode - show navigation hints
      hints.push("j/k nav");
      hints.push("Enter expand");
      hints.push("^B input");
      hints.push("^K focused");
    }

    // Mouse toggle hint - shown in all modes to make the feature discoverable.
    // Default state (disabled) shows how to enable mouse scrolling.
    // Enabled state shows how to switch back to text selection mode.
    hints.push(this.mouseEnabled ? "^Y select" : "^Y mouse");

    this.hintsBox.setContent(`${GRAY}${hints.join("  ")}${RESET}`);
    this.renderCallback();
  }
}
