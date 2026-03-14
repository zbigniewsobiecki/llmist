import type { BlockRenderer } from "./block-renderer.js";
import type { InputHandler } from "./input-handler.js";
import type { StatusBar } from "./status-bar.js";
import type { ContentFilterMode, FocusMode, TUIBlockLayout, TUIScreenContext } from "./types.js";

/**
 * Apply focus mode changes across the widgets that participate in keyboard ownership.
 *
 * Responsibility:
 * - keep the status bar in sync with the active focus mode
 * - move focus between the input textbox and the scrollable body
 * - force an immediate render because focus changes must be visible right away
 */
export function applyFocusMode(
  mode: FocusMode,
  layout: TUIBlockLayout,
  statusBar: StatusBar,
  inputHandler: InputHandler,
  screenCtx: TUIScreenContext,
): void {
  statusBar.setFocusMode(mode);

  if (mode === "input") {
    inputHandler.activate();
  } else {
    inputHandler.deactivate();
    // Blessed textboxes keep consuming keys until focus moves elsewhere.
    layout.body.focus();
  }

  screenCtx.renderNow();
}

/**
 * Apply content filtering to the widgets that expose the current visibility mode.
 *
 * Responsibility:
 * - update rendered block visibility rules
 * - update the status bar indicator
 * - force an immediate render so the filtered view stays coherent
 */
export function applyContentFilterMode(
  mode: ContentFilterMode,
  blockRenderer: BlockRenderer,
  statusBar: StatusBar,
  screenCtx: TUIScreenContext,
): void {
  blockRenderer.setContentFilterMode(mode);
  statusBar.setContentFilterMode(mode);
  screenCtx.renderNow();
}
