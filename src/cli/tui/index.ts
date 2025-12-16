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
import type { StreamEvent, SubagentEvent } from "../../gadgets/types.js";
import type {
  TUIOptions,
  TUIScreenContext,
  TUIBlockLayout,
  ApprovalContext,
  ApprovalResponse,
} from "./types.js";
import { createScreen } from "./screen.js";
import { createBlockLayout, setupBlockNavigationKeys } from "./layout.js";
import { StatusBar } from "./status-bar.js";
import { InputHandler } from "./input-handler.js";
import { BlockRenderer } from "./block-renderer.js";
import { showApprovalDialog } from "./approval-dialog.js";
import type { LLMCallDisplayInfo } from "../ui/formatters.js";

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

  /** Map gadget invocationId to block renderer's internal ID */
  private gadgetIdMap = new Map<string, string>();

  /** Map subagent LLM call key to block renderer's internal ID */
  private subagentLLMCallMap = new Map<string, string>();

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

    // Create input handler
    // Cast ScrollableBox to Box for InputHandler compatibility
    const inputHandler = new InputHandler(
      layout.inputBar,
      layout.body as unknown as import("@unblessed/node").Box,
      screen,
      () => screenCtx.requestRender(),
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

    // Set up block navigation keys
    setupBlockNavigationKeys(screen, {
      onSelectNext: () => blockRenderer.selectNext(),
      onSelectPrevious: () => blockRenderer.selectPrevious(),
      onToggleExpand: () => blockRenderer.toggleExpand(),
      onCollapse: () => blockRenderer.collapseOrDeselect(),
      onSelectFirst: () => blockRenderer.selectFirst(),
      onSelectLast: () => blockRenderer.selectLast(),
    });

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

  /**
   * Handle an agent stream event.
   * Converts events to interactive block operations.
   */
  handleEvent(event: StreamEvent): void {
    switch (event.type) {
      case "text":
        // Text flows as non-selectable content
        this.blockRenderer.addText(event.content);
        break;

      case "gadget_call": {
        // Create gadget block as child of current LLM call
        const gadgetId = this.blockRenderer.addGadget(
          event.call.invocationId,
          event.call.gadgetName,
          event.call.parameters,
        );
        this.gadgetIdMap.set(event.call.invocationId, gadgetId);
        break;
      }

      case "gadget_result":
        // Complete the gadget block
        this.blockRenderer.completeGadget(
          event.result.invocationId,
          event.result.result,
          event.result.error,
          event.result.executionTimeMs,
        );
        break;

      case "subagent_event":
        // Handle nested events within gadgets
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
        const llmCallId = this.blockRenderer.addLLMCall(
          info.iteration,
          info.model,
          parentGadgetId, // Parent is the gadget
        );
        // Track with unique key: gadgetInvocationId + iteration
        const key = `${subEvent.gadgetInvocationId}_${info.iteration}`;
        this.subagentLLMCallMap.set(key, llmCallId);
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
        }
        break;
      }

      case "gadget_call": {
        // Subagent gadget call - create as root-level block
        // (just like regular gadgets, but we could track parentage for context)
        const gadgetEvent = subEvent.event as { call?: { gadgetName: string; parameters: Record<string, unknown>; invocationId: string } };
        if (gadgetEvent.call) {
          const gadgetId = this.blockRenderer.addGadget(
            gadgetEvent.call.invocationId,
            gadgetEvent.call.gadgetName,
            gadgetEvent.call.parameters,
          );
          this.gadgetIdMap.set(gadgetEvent.call.invocationId, gadgetId);
        }
        break;
      }

      case "gadget_result": {
        const gadgetEvent = subEvent.event as { result?: { invocationId: string; gadgetName?: string; executionTimeMs?: number; error?: string; result?: string } };
        if (gadgetEvent.result) {
          this.blockRenderer.completeGadget(
            gadgetEvent.result.invocationId,
            gadgetEvent.result.result,
            gadgetEvent.result.error,
            gadgetEvent.result.executionTimeMs,
          );
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
  showLLMCallStart(iteration: number, model: string, estimatedInputTokens = 0): void {
    this.currentLLMCallId = this.blockRenderer.addLLMCall(iteration, model);
    this.statusBar.startCall(model, estimatedInputTokens);
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
  showLLMCallComplete(info: LLMCallDisplayInfo): void {
    if (this.currentLLMCallId) {
      this.blockRenderer.completeLLMCall(this.currentLLMCallId, {
        inputTokens: info.inputTokens,
        cachedInputTokens: info.cachedInputTokens,
        outputTokens: info.outputTokens,
        elapsedSeconds: info.elapsedSeconds,
        cost: info.cost,
        finishReason: info.finishReason ?? undefined,
        contextPercent: info.contextPercent ?? undefined,
      });
    }
    this.statusBar.endCall(
      info.inputTokens ?? 0,
      info.outputTokens ?? 0,
      info.cachedInputTokens ?? 0,
      info.cost ?? 0,
    );
  }

  /**
   * Request user input for AskUser gadget.
   */
  async waitForInput(question: string, gadgetName: string): Promise<string> {
    return this.inputHandler.waitForInput(question, gadgetName);
  }

  /**
   * Wait for user to enter a new prompt (REPL mode).
   * Used between agent runs to get the next user prompt.
   */
  async waitForPrompt(): Promise<string> {
    return this.inputHandler.waitForPrompt();
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
  }

  /**
   * Clean up and restore terminal.
   */
  destroy(): void {
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
