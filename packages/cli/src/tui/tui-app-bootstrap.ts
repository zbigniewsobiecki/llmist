import type { Box } from "@unblessed/node";
import { BlockRenderer } from "./block-renderer.js";
import { TUIController } from "./controller.js";
import { EventRouter } from "./event-router.js";
import { HintsBar } from "./hints-bar.js";
import { InputHandler } from "./input-handler.js";
import { KeyActionHandler } from "./key-action-handler.js";
import { KeyboardManager } from "./keymap.js";
import { createBlockLayout } from "./layout.js";
import { ModalManager } from "./modal-manager.js";
import { createScreen } from "./screen.js";
import { SessionManager } from "./session-manager.js";
import { StatusBar } from "./status-bar.js";
import { TreeSubscriptionManager } from "./tree-subscription-manager.js";
import { applyContentFilterMode, applyFocusMode } from "./tui-app-effects.js";
import type { TUIOptions, TUIScreenContext } from "./types.js";

export interface TUIAppDependencies {
  screenCtx: TUIScreenContext;
  statusBar: StatusBar;
  inputHandler: InputHandler;
  blockRenderer: BlockRenderer;
  controller: TUIController;
  modalManager: ModalManager;
  subscriptionManager: TreeSubscriptionManager;
  sessionManager: SessionManager;
  eventRouter: EventRouter;
}

/**
 * Build every internal dependency required by `TUIApp` and wire their interactions.
 *
 * Responsibility:
 * - construct concrete blessed-backed UI components
 * - connect controller callbacks to visual side effects
 * - register keyboard, scroll, and resize wiring
 * - leave the public `TUIApp` facade free to focus on delegation
 */
export function createTUIAppDependencies(options: TUIOptions): TUIAppDependencies {
  const screenCtx = createScreen({
    stdin: options.stdin,
    stdout: options.stdout,
    title: "llmist",
  });
  const { screen } = screenCtx;

  const showHints = options.showHints ?? true;
  const layout = createBlockLayout(screen, showHints);

  const hintsBar = createHintsBar(layout, screenCtx, showHints);
  const statusBar = createStatusBar(layout, options.model, screenCtx);
  const inputHandler = createInputHandler(layout, screenCtx, screen, showHints);
  const blockRenderer = createBlockRenderer(layout, screenCtx);
  wireHintsBar(blockRenderer, hintsBar);

  const controller = createController(
    layout,
    statusBar,
    inputHandler,
    screenCtx,
    blockRenderer,
    hintsBar,
  );
  const modalManager = new ModalManager();
  const keyActionHandler = new KeyActionHandler(
    controller,
    blockRenderer,
    statusBar,
    screenCtx,
    modalManager,
    layout,
  );
  const keyboardManager = new KeyboardManager({
    screen,
    getFocusMode: () => controller.getFocusMode(),
    getContentFilterMode: () => controller.getContentFilterMode(),
    isWaitingForREPLPrompt: () => inputHandler.isWaitingForREPLPrompt(),
    hasPendingInput: () => inputHandler.hasPendingInput(),
    isBlockExpanded: () => blockRenderer.getSelectedBlock()?.expanded ?? false,
    onAction: (action) => {
      keyActionHandler.handleKeyAction(action);
    },
  });

  const subscriptionManager = new TreeSubscriptionManager(blockRenderer, statusBar);
  const sessionManager = new SessionManager(blockRenderer, statusBar);
  const eventRouter = new EventRouter(blockRenderer);

  wireInputHandlers(inputHandler, keyboardManager, keyActionHandler, controller);
  wireScreenEvents(layout, screen, blockRenderer);
  keyboardManager.setup();

  applyFocusMode(controller.getFocusMode(), layout, statusBar, inputHandler, screenCtx);
  screenCtx.requestRender();

  return {
    screenCtx,
    statusBar,
    inputHandler,
    blockRenderer,
    controller,
    modalManager,
    subscriptionManager,
    sessionManager,
    eventRouter,
  };
}

/**
 * Create the optional hints bar.
 *
 * Responsibility:
 * - own the conditional creation rule for the hints widget
 * - keep the rest of the bootstrap logic free from null checks where possible
 */
function createHintsBar(
  layout: ReturnType<typeof createBlockLayout>,
  screenCtx: TUIScreenContext,
  showHints: boolean,
): HintsBar | null {
  if (!showHints || !layout.hintsBar) {
    return null;
  }

  return new HintsBar(layout.hintsBar, () => screenCtx.requestRender());
}

/**
 * Create the status bar with the render callbacks it needs.
 *
 * Responsibility:
 * - centralize status bar construction details
 * - document why it needs both deferred and immediate render pathways
 */
function createStatusBar(
  layout: ReturnType<typeof createBlockLayout>,
  model: string,
  screenCtx: TUIScreenContext,
): StatusBar {
  return new StatusBar(
    layout.statusBar,
    model,
    () => screenCtx.requestRender(),
    () => screenCtx.renderNow(),
  );
}

/**
 * Create the input handler and provide the widgets it coordinates.
 *
 * Responsibility:
 * - isolate the awkward blessed type bridge for `layout.body`
 * - keep textbox/render callback setup out of the facade
 */
function createInputHandler(
  layout: ReturnType<typeof createBlockLayout>,
  screenCtx: TUIScreenContext,
  screen: TUIScreenContext["screen"],
  showHints: boolean,
): InputHandler {
  return new InputHandler(
    layout.inputBar,
    layout.promptLabel,
    layout.body as unknown as Box,
    screen,
    () => screenCtx.requestRender(),
    () => screenCtx.renderNow(),
    showHints,
  );
}

/**
 * Create the block renderer.
 *
 * Responsibility:
 * - centralize renderer construction so streaming render policy stays consistent
 */
function createBlockRenderer(
  layout: ReturnType<typeof createBlockLayout>,
  screenCtx: TUIScreenContext,
): BlockRenderer {
  return new BlockRenderer(
    layout.body,
    () => screenCtx.requestRender(),
    () => screenCtx.renderNow(),
  );
}

/**
 * Connect block content changes to the optional hints bar.
 *
 * Responsibility:
 * - own the "has content" propagation rule in one place
 */
function wireHintsBar(blockRenderer: BlockRenderer, hintsBar: HintsBar | null): void {
  if (!hintsBar) {
    return;
  }

  blockRenderer.onHasContentChange((hasContent) => {
    hintsBar.setHasContent(hasContent);
  });
}

/**
 * Create the controller and map controller state transitions to visual updates.
 *
 * Responsibility:
 * - define which helper owns focus-mode side effects
 * - define which helper owns content-filter side effects
 */
function createController(
  layout: ReturnType<typeof createBlockLayout>,
  statusBar: StatusBar,
  inputHandler: InputHandler,
  screenCtx: TUIScreenContext,
  blockRenderer: BlockRenderer,
  hintsBar: HintsBar | null,
): TUIController {
  return new TUIController({
    onFocusModeChange: (mode) => {
      applyFocusMode(mode, layout, statusBar, inputHandler, screenCtx);
      hintsBar?.setFocusMode(mode);
    },
    onContentFilterModeChange: (mode) => {
      applyContentFilterMode(mode, blockRenderer, statusBar, screenCtx);
      hintsBar?.setContentFilterMode(mode);
    },
  });
}

/**
 * Connect input-originated key events to the keyboard action system.
 *
 * Responsibility:
 * - translate textbox key callbacks into the same action path used by global keys
 * - keep focus-mode/content-filter callbacks colocated with the input handler setup
 */
function wireInputHandlers(
  inputHandler: InputHandler,
  keyboardManager: KeyboardManager,
  keyActionHandler: KeyActionHandler,
  controller: TUIController,
): void {
  inputHandler.onCtrlC(() => keyboardManager.handleForwardedKey("C-c"));
  inputHandler.onCtrlB(() => keyboardManager.handleForwardedKey("C-b"));
  inputHandler.onCtrlK(() => keyboardManager.handleForwardedKey("C-k"));
  inputHandler.onCtrlI(() => keyboardManager.handleForwardedKey("C-i"));
  inputHandler.onCtrlJ(() => keyboardManager.handleForwardedKey("C-j"));
  inputHandler.onCtrlP(() => keyboardManager.handleForwardedKey("C-p"));

  inputHandler.onArrowUp(() => {
    keyActionHandler.handleKeyAction({ type: "scroll_line", direction: -1 });
  });
  inputHandler.onArrowDown(() => {
    keyActionHandler.handleKeyAction({ type: "scroll_line", direction: 1 });
  });

  inputHandler.setGetFocusMode(() => controller.getFocusMode());
  inputHandler.setGetContentFilterMode(() => controller.getContentFilterMode());
}

/**
 * Connect low-level blessed events that are not part of the keyboard manager.
 *
 * Responsibility:
 * - keep scroll-follow behavior consistent when users scroll manually
 * - recalculate block layout on terminal resize
 */
function wireScreenEvents(
  layout: ReturnType<typeof createBlockLayout>,
  screen: TUIScreenContext["screen"],
  blockRenderer: BlockRenderer,
): void {
  layout.body.on("scroll", () => {
    blockRenderer.handleUserScroll();
  });

  screen.on("resize", () => {
    blockRenderer.handleResize();
  });
}
