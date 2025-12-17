/**
 * TUI Application - Main entry point for the blessed-based terminal interface.
 *
 * Provides a complete TUI experience with:
 * - Interactive selectable/expandable blocks for LLM calls and gadgets
 * - Always-visible input field for AskUser responses
 * - Status bar showing token counts, elapsed time, and cost
 * - Modal dialogs for gadget approval
 *
 * @example
 * ```typescript
 * import { TUIApp } from './tui/index.js';
 *
 * const tui = await TUIApp.create({ model: 'claude-sonnet-4' });
 *
 * // Handle events from agent
 * for await (const event of agent.run()) {
 *   tui.handleEvent(event);
 * }
 *
 * tui.destroy();
 * ```
 */

import type { Screen } from "@unblessed/node";
import type { ExecutionTree } from "../../core/execution-tree.js";
import type { StreamEvent, SubagentEvent } from "../../gadgets/types.js";
import type {
  TUIOptions,
  TUIScreenContext,
  TUIBlockLayout,
  ApprovalContext,
  ApprovalResponse,
  FocusMode,
} from "./types.js";
import { createScreen } from "./screen.js";
import { createBlockLayout, setupBlockNavigationKeys } from "./layout.js";
import { StatusBar } from "./status-bar.js";
import { InputHandler } from "./input-handler.js";
import { BlockRenderer } from "./block-renderer.js";
import { showApprovalDialog } from "./approval-dialog.js";
import { showRawViewer, type RawViewerMode } from "./raw-viewer.js";
import type { LLMCallDisplayInfo } from "../ui/formatters.js";
import type { LLMMessage } from "../../core/messages.js";

/** Window for double Ctrl+C detection (ms) */
const CTRL_C_WINDOW_MS = 1000;

/**
 * Main TUI application class with interactive selectable/expandable blocks.
 *
 * Renders LLM calls and gadgets as selectable Box widgets that users
 * can navigate with up/down arrows and expand to see details.
 */
export class TUIApp {
  private screenCtx: TUIScreenContext;
  private layout: TUIBlockLayout;
  private statusBar: StatusBar;
  private inputHandler: InputHandler;
  private blockRenderer: BlockRenderer;

  /** Abort controller for cancellation */
  private abortController: AbortController | null = null;

  /** Last Ctrl+C timestamp for double-press detection */
  private lastCtrlC = 0;

  /** Callback for quit events */
  private onQuitCallback: (() => void) | null = null;

  /** Callback for cancel events */
  private onCancelCallback: (() => void) | null = null;

  /** Track current LLM call ID for gadget parenting */
  private currentLLMCallId: string | null = null;

  /** Track current iteration number for status bar */
  private currentIteration = 0;

  /** Map gadget invocationId to block renderer's internal ID */
  private gadgetIdMap = new Map<string, string>();

  /** Map subagent LLM call key to block renderer's internal ID */
  private subagentLLMCallMap = new Map<string, string>();

  /** Current focus mode (browse = navigate blocks, input = type in input field) */
  private focusMode: FocusMode = "browse";

  /** Close function for currently open raw viewer (if any) */
  private closeRawViewer: (() => void) | null = null;

  private constructor(
    screenCtx: TUIScreenContext,
    layout: TUIBlockLayout,
    statusBar: StatusBar,
    inputHandler: InputHandler,
    blockRenderer: BlockRenderer,
  ) {
    this.screenCtx = screenCtx;
    this.layout = layout;
    this.statusBar = statusBar;
    this.inputHandler = inputHandler;
    this.blockRenderer = blockRenderer;
  }

  /**
   * Create a new TUI application instance.
   */
  static async create(options: TUIOptions): Promise<TUIApp> {
    const screenCtx = createScreen({
      stdin: options.stdin,
      stdout: options.stdout,
      title: "llmist",
    });

    const { screen } = screenCtx;

    // Create block-based layout with ScrollableBox
    const layout = createBlockLayout(screen);

    // Create status bar with both debounced and immediate render callbacks
    const statusBar = new StatusBar(
      layout.statusBar,
      options.model,
      () => screenCtx.requestRender(),
      () => screenCtx.renderNow(),
    );

    // Create input handler with both debounced and immediate render callbacks
    // Cast ScrollableBox to Box for InputHandler compatibility
    const inputHandler = new InputHandler(
      layout.inputBar,
      layout.body as unknown as import("@unblessed/node").Box,
      screen,
      () => screenCtx.requestRender(),
      () => screenCtx.renderNow(),
    );

    // Create block renderer
    const blockRenderer = new BlockRenderer(
      layout.body,
      () => screenCtx.requestRender(),
    );

    const app = new TUIApp(screenCtx, layout, statusBar, inputHandler, blockRenderer);

    // Set up keyboard handlers
    app.setupKeyHandlers(screen);

    // Wire up Ctrl+C from input handler to same quit logic
    inputHandler.onCtrlC(() => app.handleCtrlC());

    // Wire up Ctrl+B from input handler to toggle focus mode
    inputHandler.onCtrlB(() => app.toggleFocusMode());

    // Set up block navigation keys (pass focus mode getter)
    setupBlockNavigationKeys(
      screen,
      {
        onSelectNext: () => blockRenderer.selectNext(),
        onSelectPrevious: () => blockRenderer.selectPrevious(),
        onToggleExpand: () => blockRenderer.toggleExpand(),
        onCollapse: () => blockRenderer.collapseOrDeselect(),
        onSelectFirst: () => blockRenderer.selectFirst(),
        onSelectLast: () => {
          blockRenderer.selectLast();
          blockRenderer.enableFollowMode(); // Re-enable follow mode when jumping to end
        },
        onShowRawRequest: () => app.showRawViewer("request"),
        onShowRawResponse: () => app.showRawViewer("response"),
      },
      () => app.focusMode,
    );

    // Wire scroll event to detect user scrolling (for smart follow mode)
    layout.body.on("scroll", () => {
      blockRenderer.handleUserScroll();
    });

    // Wire resize event to recalculate bottom alignment
    screen.on("resize", () => {
      blockRenderer.handleResize();
    });

    // Initialize in browse mode (input bar hidden)
    app.applyFocusMode();

    // Initial render
    screenCtx.requestRender();

    return app;
  }

  /**
   * Set up keyboard event handlers.
   */
  private setupKeyHandlers(screen: Screen): void {
    // ESC to cancel current operation
    screen.key(["escape"], () => {
      if (this.inputHandler.hasPendingInput()) {
        // Don't cancel input - let user continue typing
        return;
      }

      // Check if a block is selected and expanded
      const selected = this.blockRenderer.getSelectedBlock();
      if (selected?.expanded) {
        // Let the block navigation handler deal with collapse
        return;
      }

      // Cancel current operation (streaming, etc.)
      if (this.onCancelCallback) {
        this.onCancelCallback();
      }

      // Abort if controller exists
      if (this.abortController && !this.abortController.signal.aborted) {
        this.abortController.abort();
      }
    });

    // Ctrl+C for quit (double-press)
    screen.key(["C-c"], () => {
      this.handleCtrlC();
    });

    // Ctrl+B to toggle focus mode (browse <-> input)
    screen.key(["C-b"], () => {
      this.toggleFocusMode();
    });
  }

  /**
   * Handle Ctrl+C keypress (double-press to quit).
   * This is public so it can be called from InputHandler.
   */
  handleCtrlC(): void {
    const now = Date.now();

    if (now - this.lastCtrlC < CTRL_C_WINDOW_MS) {
      // Second press within window - quit
      if (this.onQuitCallback) {
        this.onQuitCallback();
      }
      this.destroy();
      process.exit(130);
    } else {
      // First press - show hint and record time
      this.lastCtrlC = now;
      this.showHint("Press Ctrl+C again to quit");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Focus Mode Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Toggle between browse and input modes.
   * Called by Tab key handler.
   */
  toggleFocusMode(): void {
    this.focusMode = this.focusMode === "browse" ? "input" : "browse";
    this.applyFocusMode();
  }

  /**
   * Set focus mode programmatically.
   * Used by AskUser to force input mode.
   */
  setFocusMode(mode: FocusMode): void {
    if (this.focusMode !== mode) {
      this.focusMode = mode;
      this.applyFocusMode();
    }
  }

  /**
   * Apply current focus mode to UI components.
   * - Browse mode: Hide input bar, body takes full space minus status bar
   * - Input mode: Show input bar, body shrinks to make room
   */
  private applyFocusMode(): void {
    // Update status bar FIRST (before input gets focus, which may affect event processing)
    this.statusBar.setFocusMode(this.focusMode);

    // Update layout
    if (this.focusMode === "input") {
      // Input mode: show input bar, body height = 100%-2
      this.layout.body.height = "100%-2";
    } else {
      // Browse mode: hide input bar, body height = 100%-1
      this.layout.body.height = "100%-1";
    }

    // Render the layout changes
    this.screenCtx.renderNow();

    // Now activate/deactivate input handler (this changes focus)
    if (this.focusMode === "input") {
      this.inputHandler.activate();
    } else {
      this.inputHandler.deactivate();
    }
  }

  /**
   * Handle an agent stream event.
   * Converts events to interactive block operations.
   *
   * When tree subscription is active, only handles text events.
   * Gadgets and subagent events are handled automatically by tree.
   */
  handleEvent(event: StreamEvent): void {
    switch (event.type) {
      case "text":
        // Text flows as non-selectable content (tree doesn't track text)
        this.blockRenderer.addText(event.content);
        break;

      case "gadget_call": {
        // Tree handles gadget creation when subscribed
        if (this.blockRenderer.isTreeSubscribed()) break;

        // Legacy path: create gadget block as child of current LLM call
        const gadgetId = this.blockRenderer.addGadget(
          event.call.invocationId,
          event.call.gadgetName,
          event.call.parameters,
        );
        this.gadgetIdMap.set(event.call.invocationId, gadgetId);
        // Track in status bar
        this.statusBar.startGadget(event.call.gadgetName);
        break;
      }

      case "gadget_result":
        // Tree handles gadget completion when subscribed
        if (this.blockRenderer.isTreeSubscribed()) break;

        // Legacy path: complete the gadget block
        this.blockRenderer.completeGadget(
          event.result.invocationId,
          event.result.result,
          event.result.error,
          event.result.executionTimeMs,
          event.result.cost,
        );
        // Remove from status bar
        this.statusBar.endGadget(event.result.gadgetName);
        break;

      case "subagent_event":
        // Tree handles nested events automatically via parent-child relationships
        if (this.blockRenderer.isTreeSubscribed()) break;

        // Legacy path: handle nested events within gadgets
        this.handleSubagentEvent(event.subagentEvent);
        break;

      case "stream_complete":
        // Nothing special needed for blocks
        break;

      case "human_input_required":
        // Handled by InputHandler, not here
        break;

      default:
        // Other events (gadget_skipped, compaction, etc.)
        break;
    }
  }

  /**
   * Handle subagent events (nested LLM calls and gadgets within gadgets).
   */
  private handleSubagentEvent(subEvent: SubagentEvent): void {
    // Find the parent gadget block
    const parentGadgetId = this.gadgetIdMap.get(subEvent.gadgetInvocationId);
    if (!parentGadgetId) return;

    switch (subEvent.type) {
      case "llm_call_start": {
        // Create nested LLM call as child of the gadget
        const info = subEvent.event as import("../../gadgets/types.js").LLMCallInfo;
        // Unique key: gadgetInvocationId + iteration (uses raw iteration for tracking)
        const key = `${subEvent.gadgetInvocationId}_${info.iteration}`;

        // Deduplicate: skip if we already have this subagent LLM call
        if (this.subagentLLMCallMap.has(key)) {
          break;
        }

        const llmCallId = this.blockRenderer.addLLMCall(
          info.iteration + 1, // Display as 1-indexed (consistent with main agent)
          info.model,
          parentGadgetId, // Parent is the gadget
        );
        this.subagentLLMCallMap.set(key, llmCallId);
        // Track in status bar with subagent label
        const subLabel = `#${this.currentIteration}.${info.iteration + 1}`;
        this.statusBar.startLLMCall(subLabel, info.model);
        break;
      }

      case "llm_call_end": {
        const info = subEvent.event as import("../../gadgets/types.js").LLMCallInfo;
        const key = `${subEvent.gadgetInvocationId}_${info.iteration}`;
        const llmCallId = this.subagentLLMCallMap.get(key);
        if (llmCallId) {
          this.blockRenderer.completeLLMCall(llmCallId, {
            inputTokens: info.usage?.inputTokens ?? info.inputTokens,
            cachedInputTokens: info.usage?.cachedInputTokens,
            outputTokens: info.usage?.outputTokens ?? info.outputTokens,
            elapsedSeconds: info.elapsedMs ? info.elapsedMs / 1000 : undefined,
            cost: info.cost,
            finishReason: info.finishReason ?? undefined,
          });
          // Remove from status bar
          const subLabel = `#${this.currentIteration}.${info.iteration + 1}`;
          this.statusBar.endLLMCall(subLabel);
          // Accumulate subagent LLM call cost in status bar
          if (info.cost && info.cost > 0) {
            this.statusBar.addGadgetCost(info.cost);
          }
        }
        break;
      }

      case "gadget_call": {
        // Subagent gadget call - create as child of the subagent's LLM call
        const gadgetEvent = subEvent.event as { call?: { gadgetName: string; parameters: Record<string, unknown>; invocationId: string } };
        if (gadgetEvent.call) {
          // Deduplicate: skip if we already have this gadget
          if (this.gadgetIdMap.has(gadgetEvent.call.invocationId)) {
            break;
          }

          // Set correct LLM call context for parenting
          // Use the iteration from subagent event to find the correct subagent LLM call
          if (subEvent.iteration !== undefined) {
            const key = `${subEvent.gadgetInvocationId}_${subEvent.iteration}`;
            const subagentLLMCallId = this.subagentLLMCallMap.get(key);
            if (subagentLLMCallId) {
              this.blockRenderer.setCurrentLLMCall(subagentLLMCallId);
            }
          }

          const gadgetId = this.blockRenderer.addGadget(
            gadgetEvent.call.invocationId,
            gadgetEvent.call.gadgetName,
            gadgetEvent.call.parameters,
          );
          this.gadgetIdMap.set(gadgetEvent.call.invocationId, gadgetId);
          // Track in status bar
          this.statusBar.startGadget(gadgetEvent.call.gadgetName);
        }
        break;
      }

      case "gadget_result": {
        const gadgetEvent = subEvent.event as { result?: { invocationId: string; gadgetName?: string; executionTimeMs?: number; error?: string; result?: string; cost?: number } };
        if (gadgetEvent.result) {
          this.blockRenderer.completeGadget(
            gadgetEvent.result.invocationId,
            gadgetEvent.result.result,
            gadgetEvent.result.error,
            gadgetEvent.result.executionTimeMs,
            gadgetEvent.result.cost,
          );
          // Remove from status bar
          if (gadgetEvent.result.gadgetName) {
            this.statusBar.endGadget(gadgetEvent.result.gadgetName);
          }
          // Track subagent gadget cost
          if (gadgetEvent.result.cost && gadgetEvent.result.cost > 0) {
            this.statusBar.addGadgetCost(gadgetEvent.result.cost);
          }
        }
        break;
      }
    }
  }

  /**
   * Show an LLM call starting.
   * @param iteration - Current iteration number
   * @param model - Model name
   * @param estimatedInputTokens - Estimated input tokens for real-time display
   */
  showLLMCallStart(iteration: number, _model: string, _estimatedInputTokens = 0): void {
    // Tree subscription handles block creation and activity tracking via handleTreeEvent
    // We only track IDs for raw response attachment in raw viewer
    this.currentIteration = iteration;
    this.currentLLMCallId = this.blockRenderer.getCurrentLLMCallId();
  }

  /**
   * Update streaming token estimates (call during streaming).
   * @param estimatedOutputTokens - Estimated output tokens so far
   */
  updateStreamingTokens(estimatedOutputTokens: number): void {
    this.statusBar.updateStreaming(estimatedOutputTokens);
  }

  /**
   * Show an LLM call completion.
   */
  showLLMCallComplete(info: LLMCallDisplayInfo & { rawResponse?: string }): void {
    // Skip when tree subscription is active - tree handles raw data correctly
    // using proper block IDs. Hook-based path uses stale currentLLMCallId.
    if (this.blockRenderer.isTreeSubscribed()) return;

    if (this.currentLLMCallId && info.rawResponse) {
      this.blockRenderer.setLLMCallResponse(this.currentLLMCallId, info.rawResponse);
    }
  }

  /**
   * Store raw request messages for the current LLM call.
   * Called from onLLMCallReady hook after controller modifications.
   */
  setLLMCallRequest(messages: LLMMessage[]): void {
    // Skip when tree subscription is active - tree handles raw data correctly
    // using proper block IDs. Hook-based path uses stale currentLLMCallId.
    if (this.blockRenderer.isTreeSubscribed()) return;

    if (this.currentLLMCallId) {
      this.blockRenderer.setLLMCallRequest(this.currentLLMCallId, messages);
    }
  }

  /**
   * Show raw request or response viewer for selected LLM call or gadget.
   * Only works in browse mode when an LLM call or gadget is selected.
   * If a viewer is already open, closes it first (single-instance modal).
   *
   * For LLM calls: shows raw request messages / raw response text
   * For gadgets: shows raw parameters / raw result
   */
  async showRawViewer(mode: RawViewerMode): Promise<void> {
    if (this.focusMode !== "browse") return;

    const selected = this.blockRenderer.getSelectedBlock();
    if (!selected) return;

    // Close any existing viewer first (single-instance modal pattern)
    if (this.closeRawViewer) {
      this.closeRawViewer();
      this.closeRawViewer = null;
    }

    let handle: import("./raw-viewer.js").RawViewerHandle;

    if (selected.node.type === "llm_call") {
      // LLM call viewer
      const node = selected.node as import("./types.js").LLMCallNode;
      handle = showRawViewer({
        screen: this.screenCtx.screen,
        mode,
        request: node.rawRequest,
        response: node.rawResponse,
        iteration: node.iteration,
        model: node.model,
      });
    } else if (selected.node.type === "gadget") {
      // Gadget viewer
      const node = selected.node as import("./types.js").GadgetNode;
      handle = showRawViewer({
        screen: this.screenCtx.screen,
        mode,
        gadgetName: node.name,
        parameters: node.parameters,
        result: node.result,
        error: node.error,
      });
    } else {
      // Unsupported node type
      return;
    }

    // Store close function for potential replacement
    this.closeRawViewer = handle.close;

    // Wait for viewer to close and clear the reference
    await handle.closed;
    this.closeRawViewer = null;
  }

  /**
   * Request user input for AskUser gadget.
   * Auto-activates input mode and restores browse mode after.
   */
  async waitForInput(question: string, gadgetName: string): Promise<string> {
    // Force input mode for AskUser
    const previousMode = this.focusMode;
    this.setFocusMode("input");

    try {
      const result = await this.inputHandler.waitForInput(question, gadgetName);
      return result;
    } finally {
      // Restore previous mode after input
      this.setFocusMode(previousMode);
    }
  }

  /**
   * Wait for user to enter a new prompt (REPL mode).
   * Used between agent runs to get the next user prompt.
   * Stays in current mode (browse) - user can Tab to input or Enter to start typing.
   */
  async waitForPrompt(): Promise<string> {
    // Don't force input mode - let user review output in browse mode first
    // User can press Tab to switch to input mode, or Enter to start typing
    const result = await this.inputHandler.waitForPrompt();
    // Return to browse mode after prompt is entered (in case user was in input mode)
    this.setFocusMode("browse");
    return result;
  }

  /**
   * Show approval dialog for gadget execution.
   */
  async showApproval(context: ApprovalContext): Promise<ApprovalResponse> {
    return showApprovalDialog(this.screenCtx.screen, context);
  }

  /**
   * Add cost from gadget execution.
   */
  addGadgetCost(cost: number): void {
    this.statusBar.addGadgetCost(cost);
  }

  /** Unsubscribe function for tree subscription */
  private treeUnsubscribe: (() => void) | null = null;

  /**
   * Subscribe to an ExecutionTree for automatic block updates.
   *
   * When subscribed, blocks for LLM calls and gadgets are automatically
   * created and updated based on tree events. This eliminates the need
   * to manually handle subagent events via handleEvent().
   *
   * The subscription is automatically cleaned up when destroy() is called.
   *
   * @param tree - The ExecutionTree from agent.getTree()
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * const agent = builder.ask("Hello");
   * tui.subscribeToTree(agent.getTree());
   *
   * for await (const event of agent.run()) {
   *   // LLM/gadget blocks are auto-managed via tree subscription
   *   // Only handle text events manually
   *   if (event.type === "text") {
   *     tui.handleEvent(event);
   *   }
   * }
   * ```
   */
  subscribeToTree(tree: ExecutionTree): () => void {
    // Unsubscribe from previous tree
    if (this.treeUnsubscribe) {
      this.treeUnsubscribe();
    }

    // Subscribe block renderer to tree (for block creation)
    const unsubBlock = this.blockRenderer.subscribeToTree(tree);

    // Subscribe status bar to tree (for activity tracking)
    const unsubStatus = this.statusBar.subscribeToTree(tree);

    // Combined unsubscribe
    this.treeUnsubscribe = () => {
      unsubBlock();
      unsubStatus();
    };

    return () => {
      if (this.treeUnsubscribe) {
        this.treeUnsubscribe();
        this.treeUnsubscribe = null;
      }
    };
  }

  /**
   * Get the abort signal for cancellation support.
   */
  getAbortSignal(): AbortSignal {
    if (!this.abortController) {
      this.abortController = new AbortController();
    }
    return this.abortController.signal;
  }

  /**
   * Reset the abort controller for a new agent run.
   * Called at the start of each REPL iteration.
   */
  resetAbort(): void {
    this.abortController = new AbortController();
  }

  /**
   * Check if aborted.
   */
  isAborted(): boolean {
    return this.abortController?.signal.aborted ?? false;
  }

  /**
   * Set callback for quit events.
   */
  onQuit(callback: () => void): void {
    this.onQuitCallback = callback;
  }

  /**
   * Set callback for cancel events (ESC).
   */
  onCancel(callback: () => void): void {
    this.onCancelCallback = callback;
  }

  /**
   * Show a temporary hint in the body.
   */
  private showHint(message: string): void {
    this.blockRenderer.addText(`\n[${message}]\n`);
  }

  /**
   * Get current metrics from status bar.
   */
  getMetrics() {
    return this.statusBar.getMetrics();
  }

  /**
   * Get elapsed session time in seconds.
   */
  getElapsedSeconds(): number {
    return this.statusBar.getElapsedSeconds();
  }

  /**
   * Flush any buffered text (no-op for block-based rendering).
   */
  flushText(): void {
    // Block-based rendering doesn't buffer text
    // Also clear activity tracking when agent run completes
    this.statusBar.clearActivity();
  }

  /**
   * Clean up and restore terminal.
   */
  destroy(): void {
    // Unsubscribe from tree events
    if (this.treeUnsubscribe) {
      this.treeUnsubscribe();
      this.treeUnsubscribe = null;
    }

    // Cancel any pending input
    this.inputHandler.cancelPending();

    // Destroy screen (restores terminal)
    this.screenCtx.destroy();
  }
}

// Re-export types for convenience
export type { TUIOptions, ApprovalContext, ApprovalResponse } from "./types.js";

// Re-export utilities
export { StatusBar } from "./status-bar.js";
