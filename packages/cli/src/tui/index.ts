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
import type { ExecutionTree, StreamEvent } from "llmist";
import { showApprovalDialog } from "./approval-dialog.js";
import { BlockRenderer } from "./block-renderer.js";
import { InputHandler } from "./input-handler.js";
import { createBlockLayout, setupBlockNavigationKeys } from "./layout.js";
import { type RawViewerMode, showRawViewer } from "./raw-viewer.js";
import { createScreen } from "./screen.js";
import { StatusBar } from "./status-bar.js";
import type {
  ApprovalContext,
  ApprovalResponse,
  ContentFilterMode,
  FocusMode,
  TUIBlockLayout,
  TUIOptions,
  TUIScreenContext,
} from "./types.js";

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

  /** Callback for mid-session input (REPL mode: inject user message during running session) */
  private onMidSessionInputCallback: ((message: string) => void) | null = null;

  /** Track current iteration number for status bar */
  private currentIteration = 0;

  /** Current focus mode (browse = navigate blocks, input = type in input field) */
  private focusMode: FocusMode = "browse";

  /** Content filter mode (full = show all, focused = hide technical details) */
  private contentFilterMode: ContentFilterMode = "full";

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
      layout.promptLabel,
      layout.body as unknown as import("@unblessed/node").Box,
      screen,
      () => screenCtx.requestRender(),
      () => screenCtx.renderNow(),
    );

    // Create block renderer with both debounced and immediate render callbacks
    const blockRenderer = new BlockRenderer(
      layout.body,
      () => screenCtx.requestRender(),
      () => screenCtx.renderNow(),
    );

    const app = new TUIApp(screenCtx, layout, statusBar, inputHandler, blockRenderer);

    // Set up keyboard handlers
    app.setupKeyHandlers(screen);

    // Wire up Ctrl+C from input handler to same quit logic
    inputHandler.onCtrlC(() => app.handleCtrlC());

    // Wire up Ctrl+B from input handler to toggle focus mode
    inputHandler.onCtrlB(() => app.toggleFocusMode());

    // Wire up Ctrl+K from input handler to toggle content filter mode
    inputHandler.onCtrlK(() => app.toggleContentFilterMode());

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

    // Ctrl+P to cycle through profiles (only when waiting for REPL prompt)
    screen.key(["C-p"], () => {
      if (this.inputHandler.isWaitingForREPLPrompt()) {
        this.statusBar.cycleProfile();
      }
    });

    // Ctrl+K to toggle content filter mode (focused view)
    screen.key(["C-k"], () => {
      this.toggleContentFilterMode();
    });

    // Page Up/Down for scrolling (works in both browse and input modes)
    // This enables scrolling in focused mode where block navigation is disabled
    screen.key(["pageup"], () => {
      this.scrollPage(-1);
    });

    screen.key(["pagedown"], () => {
      this.scrollPage(1);
    });
  }

  /**
   * Scroll the body by a page (for PageUp/PageDown keys).
   * Works in both browse and input modes.
   *
   * @param direction - -1 for page up, 1 for page down
   */
  private scrollPage(direction: number): void {
    const body = this.layout.body;
    if (!body.scroll) return; // Guard for scroll method availability

    const containerHeight = body.height as number;
    const scrollAmount = Math.max(1, containerHeight - 2); // Leave 2 lines of context

    if (direction < 0) {
      // Page up
      body.scroll(-scrollAmount);
    } else {
      // Page down
      body.scroll(scrollAmount);
    }
    this.blockRenderer.handleUserScroll();
    this.screenCtx.renderNow();
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
   * No-op in focused content mode (browse not allowed).
   */
  toggleFocusMode(): void {
    // In focused content mode, always stay in input mode
    if (this.contentFilterMode === "focused") return;

    this.focusMode = this.focusMode === "browse" ? "input" : "browse";
    this.applyFocusMode();
  }

  /**
   * Set focus mode programmatically.
   * Used by AskUser to force input mode.
   * BROWSE mode is ignored in focused content mode.
   */
  setFocusMode(mode: FocusMode): void {
    // In focused content mode, don't allow browse mode
    if (this.contentFilterMode === "focused" && mode === "browse") {
      return;
    }

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
   * Toggle content filter mode between full and focused.
   * In focused mode:
   * - Only text and user-facing gadgets (TellUser, AskUser) are visible
   * - LLM call blocks and most gadgets are hidden
   * - Forces INPUT mode (no BROWSE allowed)
   * - Status bar shows FOCUSED instead of BROWSE/INPUT
   */
  toggleContentFilterMode(): void {
    this.contentFilterMode = this.contentFilterMode === "full" ? "focused" : "full";

    // In focused mode, force INPUT mode FIRST (before rebuilding blocks)
    // This ensures the body height is correct when calculating block positions
    if (this.contentFilterMode === "focused") {
      this.setFocusMode("input");
    }

    // Update components - blocks will be rebuilt with correct body height
    this.blockRenderer.setContentFilterMode(this.contentFilterMode);
    this.statusBar.setContentFilterMode(this.contentFilterMode);

    this.screenCtx.renderNow();
  }

  /**
   * Handle an agent stream event.
   *
   * Only handles text events - gadgets and LLM calls are managed
   * automatically by ExecutionTree subscription via subscribeToTree().
   */
  handleEvent(event: StreamEvent): void {
    if (event.type === "text") {
      // Text is append-only content not tracked by the tree
      this.blockRenderer.addText(event.content);
    }
    // All other events (gadget_call, gadget_result, subagent_event, etc.)
    // are handled automatically by tree subscription in subscribeToTree()
  }

  /**
   * Show an LLM call starting.
   * Only tracks iteration for status bar label formatting.
   * Block creation is handled automatically by ExecutionTree subscription.
   *
   * @param iteration - Current iteration number (1-indexed)
   */
  showLLMCallStart(iteration: number): void {
    this.currentIteration = iteration;
  }

  /**
   * Update streaming token estimates (call during streaming).
   * @param estimatedOutputTokens - Estimated output tokens so far
   */
  updateStreamingTokens(estimatedOutputTokens: number): void {
    this.statusBar.updateStreaming(estimatedOutputTokens);
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
  /**
   * Wait for user to enter a prompt.
   *
   * After the prompt is submitted, focus mode switches to BROWSE so the user
   * can see the agent's response. For mid-session input while the agent is
   * running, users can press Enter or Tab to switch back to INPUT mode.
   *
   * Note: For initial startup without a CLI prompt, call setFocusMode("input")
   * BEFORE this method so users can immediately start typing.
   */
  async waitForPrompt(): Promise<string> {
    // Don't force input mode - let user review output in browse mode first
    // User can press Tab to switch to input mode, or Enter to start typing
    const result = await this.inputHandler.waitForPrompt();
    // Return to browse mode after prompt is entered (so user can see agent output)
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
   * Set callback for mid-session input.
   * Called when user submits input during a running session (not during AskUser prompts).
   * Used by REPL mode to inject user messages into the agent's conversation.
   *
   * @param callback - Function to call with the user's message
   */
  onMidSessionInput(callback: (message: string) => void): void {
    this.onMidSessionInputCallback = callback;
    // Wire up to input handler
    this.inputHandler.setMidSessionHandler(callback);
  }

  /**
   * Display a user message in the TUI.
   *
   * Used for REPL mode to echo user input before the agent processes it.
   * Shows immediately with a distinct icon (👤) to differentiate from LLM responses.
   *
   * @param message - The user's message text
   */
  showUserMessage(message: string): void {
    this.blockRenderer.addUserMessage(message);
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Profile Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Set available profiles for cycling.
   * Profiles appear next to BROWSE/INPUT in the status bar.
   * Users can cycle through profiles with Ctrl+P when a session ends.
   *
   * @param profiles - Array of profile names from config
   */
  setProfiles(profiles: string[]): void {
    this.statusBar.setProfiles(profiles);
  }

  /**
   * Get the currently selected profile name.
   * Used by agent-command to apply profile-specific settings.
   *
   * @returns Current profile name, or null if no profiles are set
   */
  getCurrentProfile(): string | null {
    return this.statusBar.getCurrentProfile();
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

// Re-export utilities
export { StatusBar } from "./status-bar.js";
// Re-export types for convenience
export type { ApprovalContext, ApprovalResponse, TUIOptions } from "./types.js";
