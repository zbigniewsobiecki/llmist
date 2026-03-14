import type { BlockRenderer } from "./block-renderer.js";
import type { StatusBar } from "./status-bar.js";

/**
 * Manages session-level UI transitions and cleanup.
 * Groups session-related BlockRenderer and StatusBar resets.
 */
export class SessionManager {
  constructor(
    private blockRenderer: BlockRenderer,
    private statusBar: StatusBar,
  ) {}

  /**
   * Start a new session. Called at the start of each REPL turn.
   */
  startNewSession(): void {
    this.blockRenderer.startNewSession();
  }

  /**
   * Clear blocks from the previous session only.
   * Keeps current content visible during the session.
   */
  clearPreviousSession(): void {
    this.blockRenderer.clearPreviousSession();
  }

  /**
   * Clear all blocks and reset BlockRenderer state.
   * Prevents memory leaks between iterations.
   */
  clearAllBlocks(): void {
    this.blockRenderer.clear();
  }

  /**
   * Clear status bar activity state.
   */
  clearStatusBar(): void {
    this.statusBar.clearActivity();
  }

  /**
   * Full cleanup between REPL iterations.
   */
  resetAll(): void {
    this.clearAllBlocks();
    this.clearStatusBar();
  }
}
