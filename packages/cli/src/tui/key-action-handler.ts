import type { BlockRenderer } from "./block-renderer.js";
import type { TUIController } from "./controller.js";
import type { KeyAction } from "./keymap.js";
import type { ModalManager } from "./modal-manager.js";
import { createRawViewerData, isRawViewerNode } from "./raw-viewer-data.js";
import type { StatusBar } from "./status-bar.js";
import type { TUIBlockLayout, TUIScreenContext } from "./types.js";

/**
 * KeyActionHandler - Extracts keyboard action logic from TUIApp.
 *
 * This class handles the mapping between high-level KeyAction types
 * and their side effects on the TUI application state and UI.
 */
export class KeyActionHandler {
  constructor(
    private controller: TUIController,
    private blockRenderer: BlockRenderer,
    private statusBar: StatusBar,
    private screenCtx: TUIScreenContext,
    private modalManager: ModalManager,
    private layout: TUIBlockLayout,
  ) {}

  /**
   * Handle high-level keyboard actions from KeyboardManager or InputHandler.
   */
  handleKeyAction(action: KeyAction): void {
    switch (action.type) {
      case "ctrl_c": {
        const result = this.controller.handleCtrlC();
        if (result === "show_hint") {
          this.blockRenderer.addText("\n[Press Ctrl+C again to quit]\n");
        } else if (result === "quit") {
          // Controller's onQuit callback handles cleanup
          // But we also need to exit
          process.exit(130);
        }
        break;
      }

      case "cancel":
        this.controller.triggerCancel();
        this.controller.abort();
        break;

      case "toggle_focus_mode":
        this.controller.toggleFocusMode();
        break;

      case "toggle_content_filter":
        this.controller.toggleContentFilterMode();
        break;

      case "toggle_mouse":
        this.controller.toggleMouse();
        break;

      case "cycle_profile":
        this.statusBar.cycleProfile();
        break;

      case "scroll_page": {
        const body = this.layout.body;
        if (!body.scroll) return;
        const containerHeight = body.height as number;
        const scrollAmount = Math.max(1, containerHeight - 2);
        if (action.direction < 0) {
          body.scroll(-scrollAmount);
        } else {
          body.scroll(scrollAmount);
        }
        this.blockRenderer.handleUserScroll();
        this.screenCtx.renderNow();
        break;
      }

      case "scroll_line": {
        const body = this.layout.body;
        if (!body.scroll) return;
        body.scroll(action.direction);
        this.blockRenderer.handleUserScroll();
        this.screenCtx.renderNow();
        break;
      }

      case "navigation":
        switch (action.action) {
          case "select_next":
            this.blockRenderer.selectNext();
            break;
          case "select_previous":
            this.blockRenderer.selectPrevious();
            break;
          case "select_first":
            this.blockRenderer.selectFirst();
            break;
          case "select_last":
            this.blockRenderer.selectLast();
            this.blockRenderer.enableFollowMode();
            break;
          case "toggle_expand":
            this.blockRenderer.toggleExpand();
            break;
          case "collapse":
            this.blockRenderer.collapseOrDeselect();
            break;
        }
        this.screenCtx.renderNow();
        break;

      case "raw_viewer":
        // This is handled asynchronously, but we don't await here
        // The modal manager handles the lifecycle
        void (async () => {
          const selected = this.blockRenderer.getSelectedBlock();
          if (!selected) return;
          if (!isRawViewerNode(selected.node)) return;

          await this.modalManager.showRawViewer(
            this.screenCtx.screen,
            createRawViewerData(selected.node, action.mode),
          );
        })();
        break;
    }
  }
}
