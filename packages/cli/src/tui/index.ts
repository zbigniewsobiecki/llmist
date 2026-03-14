/**
 * TUI Application - Main entry point for the blessed-based terminal interface.
 *
 * TUIApp is a thin facade that orchestrates the following components:
 * - TUIController: Pure state management (focus mode, abort control, callbacks)
 * - KeyboardManager: Centralized keyboard event dispatch
 * - ModalManager: Modal lifecycle (raw viewer, approval dialogs)
 * - BlockRenderer: Interactive block rendering
 * - StatusBar: Metrics display
 * - InputHandler: Input field management
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

import type { ExecutionTree, RateLimitStats, StreamEvent } from "llmist";
import type { BlockRenderer } from "./block-renderer.js";
import type { TUIController } from "./controller.js";
import type { EventRouter } from "./event-router.js";
import type { InputHandler } from "./input-handler.js";
import type { ModalManager } from "./modal-manager.js";
import { createRawViewerData, isRawViewerNode } from "./raw-viewer-data.js";
import type { SessionManager } from "./session-manager.js";
import type { StatusBar } from "./status-bar.js";
import type { TreeSubscriptionManager } from "./tree-subscription-manager.js";
import { createTUIAppDependencies } from "./tui-app-bootstrap.js";
import type {
  ApprovalContext,
  ApprovalResponse,
  FocusMode,
  TUIOptions,
  TUIScreenContext,
} from "./types.js";

/**
 * Main TUI application class with interactive selectable/expandable blocks.
 *
 * Renders LLM calls and gadgets as selectable Box widgets that users
 * can navigate with up/down arrows and expand to see details.
 */
export class TUIApp {
  private screenCtx: TUIScreenContext;
  private statusBar: StatusBar;
  private inputHandler: InputHandler;
  private blockRenderer: BlockRenderer;

  // New extracted components
  private controller: TUIController;
  private modalManager: ModalManager;
  private subscriptionManager: TreeSubscriptionManager;
  private sessionManager: SessionManager;
  private eventRouter: EventRouter;

  private constructor(
    screenCtx: TUIScreenContext,
    statusBar: StatusBar,
    inputHandler: InputHandler,
    blockRenderer: BlockRenderer,
    controller: TUIController,
    modalManager: ModalManager,
    subscriptionManager: TreeSubscriptionManager,
    sessionManager: SessionManager,
    eventRouter: EventRouter,
  ) {
    this.screenCtx = screenCtx;
    this.statusBar = statusBar;
    this.inputHandler = inputHandler;
    this.blockRenderer = blockRenderer;
    this.controller = controller;
    this.modalManager = modalManager;
    this.subscriptionManager = subscriptionManager;
    this.sessionManager = sessionManager;
    this.eventRouter = eventRouter;
  }

  /**
   * Create a new TUI application instance.
   */
  static async create(options: TUIOptions): Promise<TUIApp> {
    const dependencies = createTUIAppDependencies(options);
    return new TUIApp(
      dependencies.screenCtx,
      dependencies.statusBar,
      dependencies.inputHandler,
      dependencies.blockRenderer,
      dependencies.controller,
      dependencies.modalManager,
      dependencies.subscriptionManager,
      dependencies.sessionManager,
      dependencies.eventRouter,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Focus Mode Management (delegated to controller)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Toggle between browse and input modes.
   * No-op in focused content mode (browse not allowed).
   */
  toggleFocusMode(): void {
    this.controller.toggleFocusMode();
  }

  /**
   * Set focus mode programmatically.
   * Used by AskUser to force input mode.
   * BROWSE mode is ignored in focused content mode.
   */
  setFocusMode(mode: FocusMode): void {
    this.controller.setFocusMode(mode);
  }

  /**
   * Toggle content filter mode between full and focused.
   */
  toggleContentFilterMode(): void {
    this.controller.toggleContentFilterMode();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Event Handling
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Handle an agent stream event.
   *
   * Only handles text events - gadgets and LLM calls are managed
   * automatically by ExecutionTree subscription via subscribeToTree().
   */
  handleEvent(event: StreamEvent): void {
    this.eventRouter.handleEvent(event);
  }

  /**
   * Show an LLM call starting.
   * Block creation is handled automatically by ExecutionTree subscription.
   * This method is kept for API compatibility but is now a no-op.
   */
  showLLMCallStart(_iteration: number): void {
    // Block creation is now handled via tree subscription
  }

  /**
   * Update streaming token estimates (call during streaming).
   */
  updateStreamingTokens(estimatedOutputTokens: number): void {
    this.statusBar.updateStreaming(estimatedOutputTokens);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Modal Management (delegated to ModalManager)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Show raw request or response viewer for selected LLM call or gadget.
   * Only works in browse mode when an LLM call or gadget is selected.
   */
  async showRawViewer(mode: "request" | "response"): Promise<void> {
    if (this.controller.getFocusMode() !== "browse") return;

    const selected = this.blockRenderer.getSelectedBlock();
    if (!selected || !isRawViewerNode(selected.node)) return;

    await this.modalManager.showRawViewer(
      this.screenCtx.screen,
      createRawViewerData(selected.node, mode),
    );
  }

  /**
   * Show approval dialog for gadget execution.
   */
  async showApproval(context: ApprovalContext): Promise<ApprovalResponse> {
    return this.modalManager.showApproval(this.screenCtx.screen, context);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Input Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Request user input for AskUser gadget.
   * Auto-activates input mode and restores browse mode after.
   */
  async waitForInput(question: string, gadgetName: string): Promise<string> {
    // Push input mode (saves current and forces input)
    this.controller.pushInputMode();

    try {
      const result = await this.inputHandler.waitForInput(question, gadgetName);
      return result;
    } finally {
      // Pop input mode (restores previous)
      this.controller.popInputMode();
    }
  }

  /**
   * Wait for user to enter a new prompt (REPL mode).
   * Stays in input mode after submission - user can watch output and type next message.
   * User can Ctrl+B to browse if they want to navigate blocks.
   */
  async waitForPrompt(): Promise<string> {
    return this.inputHandler.waitForPrompt();
  }

  /**
   * Enter the pending REPL prompt state without blocking.
   * This enables Ctrl+P profile cycling while waiting for user input.
   * Call this early during startup so the REPL is in waiting mode immediately.
   */
  startWaitingForPrompt(): void {
    this.inputHandler.startWaitingForPrompt();
  }

  /**
   * Set callback for mid-session input.
   * Called when user submits input during a running session.
   */
  onMidSessionInput(callback: (message: string) => void): void {
    this.controller.onMidSessionInput(callback);
    this.inputHandler.setMidSessionHandler(callback);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Tree Subscription
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Subscribe to an ExecutionTree for automatic block updates.
   */
  subscribeToTree(tree: ExecutionTree): () => void {
    return this.subscriptionManager.subscribe(tree);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Memory Cleanup (REPL mode)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Clear all blocks and reset BlockRenderer state.
   * CRITICAL for REPL mode to prevent memory leaks between iterations.
   *
   * Call this after each agent run completes (after unsubscribing from tree).
   */
  clearBlockRenderer(): void {
    this.sessionManager.clearAllBlocks();
  }

  /**
   * Clear status bar activity state.
   * Called between REPL turns to prevent stale state.
   */
  clearStatusBar(): void {
    this.sessionManager.clearStatusBar();
  }

  /**
   * Start a new session. Called at the start of each REPL turn.
   * Increments the session counter so new blocks get the new sessionId.
   */
  startNewSession(): void {
    this.sessionManager.startNewSession();
  }

  /**
   * Clear blocks from the previous session only.
   * Called when the current session finishes, keeping its content visible.
   * The previous session's content was kept visible during this session for context.
   */
  clearPreviousSession(): void {
    this.sessionManager.clearPreviousSession();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Abort Control (delegated to controller)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get the abort signal for cancellation support.
   */
  getAbortSignal(): AbortSignal {
    return this.controller.getAbortSignal();
  }

  /**
   * Reset the abort controller for a new agent run.
   */
  resetAbort(): void {
    this.controller.resetAbort();
  }

  /**
   * Check if aborted.
   */
  isAborted(): boolean {
    return this.controller.isAborted();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Callbacks
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Set callback for quit events.
   */
  onQuit(callback: () => void): void {
    this.controller.onQuit(callback);
  }

  /**
   * Set callback for cancel events (ESC).
   */
  onCancel(callback: () => void): void {
    this.controller.onCancel(callback);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Content Display
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Display a user message in the TUI (REPL mode).
   */
  showUserMessage(message: string): void {
    this.blockRenderer.addUserMessage(message);
  }

  /**
   * Add cost from gadget execution.
   */
  addGadgetCost(cost: number): void {
    this.statusBar.addGadgetCost(cost);
  }

  /**
   * Flush any buffered text (clears activity tracking).
   */
  flushText(): void {
    this.statusBar.clearActivity();
  }

  /**
   * Show rate limiting throttle indicator in status bar.
   * @param delayMs - Delay in milliseconds before next request
   * @param triggeredBy - Which limit(s) triggered the throttle
   */
  showThrottling(delayMs: number, triggeredBy?: RateLimitStats["triggeredBy"]): void {
    this.statusBar.showThrottling(delayMs, triggeredBy);
  }

  /**
   * Clear rate limiting throttle indicator from status bar.
   */
  clearThrottling(): void {
    this.statusBar.clearThrottling();
  }

  /**
   * Show retry attempt indicator in status bar.
   * @param attemptNumber - Current attempt number (1-based)
   * @param retriesLeft - Number of retries remaining after this attempt
   */
  showRetry(attemptNumber: number, retriesLeft: number): void {
    this.statusBar.showRetry(attemptNumber, retriesLeft);
  }

  /**
   * Clear retry attempt indicator from status bar.
   */
  clearRetry(): void {
    this.statusBar.clearRetry();
  }

  /**
   * Add a system message to the conversation (for rate limiting, retry notifications, etc.).
   * @param message - The system message text
   * @param category - Message category for styling
   * @returns The block ID
   */
  addSystemMessage(
    message: string,
    category: "throttle" | "retry" | "info" | "warning" | "error",
  ): string {
    return this.blockRenderer.addSystemMessage(message, category);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Profile Management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Set available profiles for cycling.
   * @param profiles - Available profile names
   * @param initialProfile - Optional profile to select initially (defaults to first)
   */
  setProfiles(profiles: string[], initialProfile?: string): void {
    this.statusBar.setProfiles(profiles, initialProfile);
  }

  /**
   * Get the currently selected profile name.
   */
  getCurrentProfile(): string | null {
    return this.statusBar.getCurrentProfile();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Metrics
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get elapsed session time in seconds.
   */
  getElapsedSeconds(): number {
    return this.statusBar.getElapsedSeconds();
  }

  /**
   * Get current metrics from status bar.
   */
  getMetrics() {
    return this.statusBar.getMetrics();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Clean up and restore terminal.
   */
  destroy(): void {
    // Unsubscribe from tree events
    this.subscriptionManager.unsubscribe();

    // Close any open modals
    this.modalManager.closeAll();

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
