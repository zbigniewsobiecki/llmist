import type { BlockRenderer } from "./block-renderer.js";
import type { HintsBar } from "./hints-bar.js";
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

/**
 * Apply mouse capture mode to the screen and relevant widgets.
 *
 * Responsibility:
 * - enable/disable terminal mouse reporting at the program level
 * - sync the mouse property on the body and inputBar widgets
 * - update the status bar and hints bar so users can see the current mode
 * - force an immediate render so indicators update without delay
 *
 * When disabled (default): native text selection works in the terminal emulator.
 * When enabled: mouse scrolling and clicking work in the TUI.
 */
export function applyMouseMode(
  enabled: boolean,
  layout: TUIBlockLayout,
  statusBar: StatusBar,
  hintsBar: HintsBar | null,
  screenCtx: TUIScreenContext,
): void {
  if (enabled) {
    screenCtx.screen.program.enableMouse();
  } else {
    screenCtx.screen.program.disableMouse();
  }

  // Sync widget-level mouse property so blessed handles events correctly
  // biome-ignore lint/suspicious/noExplicitAny: blessed widget properties are not fully typed
  (layout.body as any).mouse = enabled;
  // biome-ignore lint/suspicious/noExplicitAny: blessed widget properties are not fully typed
  (layout.inputBar as any).mouse = enabled;

  statusBar.setMouseEnabled(enabled);
  hintsBar?.setMouseEnabled(enabled);

  screenCtx.renderNow();
}
