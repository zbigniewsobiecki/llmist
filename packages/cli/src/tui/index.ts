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

import type { ExecutionTree, StreamEvent } from "llmist";
import { BlockRenderer } from "./block-renderer.js";
import { TUIController } from "./controller.js";
import { InputHandler } from "./input-handler.js";
import { KeyboardManager, type KeyAction } from "./keymap.js";
import { createBlockLayout } from "./layout.js";
import { ModalManager } from "./modal-manager.js";
import { createScreen } from "./screen.js";
import { StatusBar } from "./status-bar.js";
import type {
	ApprovalContext,
	ApprovalResponse,
	ContentFilterMode,
	FocusMode,
	GadgetNode,
	LLMCallNode,
	TUIBlockLayout,
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

	/** Unsubscribe function for tree subscription */
	private treeUnsubscribe: (() => void) | null = null;

	private constructor(
		screenCtx: TUIScreenContext,
		statusBar: StatusBar,
		inputHandler: InputHandler,
		blockRenderer: BlockRenderer,
		controller: TUIController,
		modalManager: ModalManager,
	) {
		this.screenCtx = screenCtx;
		this.statusBar = statusBar;
		this.inputHandler = inputHandler;
		this.blockRenderer = blockRenderer;
		this.controller = controller;
		this.modalManager = modalManager;
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

		// Create controller with state change callbacks
		const controller = new TUIController({
			onFocusModeChange: (mode) => {
				applyFocusMode(mode, layout, statusBar, inputHandler, screenCtx);
			},
			onContentFilterModeChange: (mode) => {
				applyContentFilterMode(mode, blockRenderer, statusBar, screenCtx);
			},
		});

		// Create modal manager
		const modalManager = new ModalManager();

		// Create keyboard manager
		const keyboardManager = new KeyboardManager({
			screen,
			getFocusMode: () => controller.getFocusMode(),
			isWaitingForREPLPrompt: () => inputHandler.isWaitingForREPLPrompt(),
			hasPendingInput: () => inputHandler.hasPendingInput(),
			isBlockExpanded: () => blockRenderer.getSelectedBlock()?.expanded ?? false,
			onAction: (action) => {
				handleKeyAction(
					action,
					controller,
					blockRenderer,
					statusBar,
					screenCtx,
					modalManager,
					layout,
				);
			},
		});

		const app = new TUIApp(
			screenCtx,
			statusBar,
			inputHandler,
			blockRenderer,
			controller,
			modalManager,
		);

		// Set up keyboard handlers
		keyboardManager.setup();

		// Wire up Ctrl+C/B/K/I/J/P from input handler to keyboard manager
		inputHandler.onCtrlC(() => keyboardManager.handleForwardedKey("C-c"));
		inputHandler.onCtrlB(() => keyboardManager.handleForwardedKey("C-b"));
		inputHandler.onCtrlK(() => keyboardManager.handleForwardedKey("C-k"));
		inputHandler.onCtrlI(() => keyboardManager.handleForwardedKey("C-i"));
		inputHandler.onCtrlJ(() => keyboardManager.handleForwardedKey("C-j"));
		inputHandler.onCtrlP(() => keyboardManager.handleForwardedKey("C-p"));

		// Wire scroll event to detect user scrolling (for smart follow mode)
		layout.body.on("scroll", () => {
			blockRenderer.handleUserScroll();
		});

		// Wire resize event to recalculate bottom alignment
		screen.on("resize", () => {
			blockRenderer.handleResize();
		});

		// Initialize in browse mode (input bar hidden)
		applyFocusMode(controller.getFocusMode(), layout, statusBar, inputHandler, screenCtx);

		// Initial render
		screenCtx.requestRender();

		return app;
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
		if (event.type === "text") {
			// Text is append-only content not tracked by the tree
			this.blockRenderer.addText(event.content);
		}
		// All other events (gadget_call, gadget_result, subagent_event, etc.)
		// are handled automatically by tree subscription in subscribeToTree()
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
		if (!selected) return;

		if (selected.node.type === "llm_call") {
			const node = selected.node as LLMCallNode;
			await this.modalManager.showRawViewer(this.screenCtx.screen, {
				mode,
				request: node.rawRequest,
				response: node.rawResponse,
				iteration: node.iteration,
				model: node.model,
			});
		} else if (selected.node.type === "gadget") {
			const node = selected.node as GadgetNode;
			await this.modalManager.showRawViewer(this.screenCtx.screen, {
				mode,
				gadgetName: node.name,
				parameters: node.parameters,
				result: node.result,
				error: node.error,
			});
		}
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
	 * Stays in current mode (browse) - user can Tab to input or Enter to start typing.
	 * After the prompt is submitted, focus mode switches to BROWSE.
	 */
	async waitForPrompt(): Promise<string> {
		// Don't force input mode - let user review output in browse mode first
		const result = await this.inputHandler.waitForPrompt();
		// Return to browse mode after prompt is entered
		this.controller.setFocusMode("browse");
		return result;
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
		if (this.treeUnsubscribe) {
			this.treeUnsubscribe();
			this.treeUnsubscribe = null;
		}

		// Close any open modals
		this.modalManager.closeAll();

		// Cancel any pending input
		this.inputHandler.cancelPending();

		// Destroy screen (restores terminal)
		this.screenCtx.destroy();
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply focus mode changes to UI components.
 */
function applyFocusMode(
	mode: FocusMode,
	layout: TUIBlockLayout,
	statusBar: StatusBar,
	inputHandler: InputHandler,
	screenCtx: TUIScreenContext,
): void {
	// Update status bar FIRST
	statusBar.setFocusMode(mode);

	// Update layout
	if (mode === "input") {
		layout.body.height = "100%-2";
	} else {
		layout.body.height = "100%-1";
	}

	// Render the layout changes
	screenCtx.renderNow();

	// Activate/deactivate input handler
	if (mode === "input") {
		inputHandler.activate();
	} else {
		inputHandler.deactivate();
	}
}

/**
 * Apply content filter mode changes to UI components.
 */
function applyContentFilterMode(
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
 * Handle keyboard actions from KeyboardManager.
 */
function handleKeyAction(
	action: KeyAction,
	controller: TUIController,
	blockRenderer: BlockRenderer,
	statusBar: StatusBar,
	screenCtx: TUIScreenContext,
	modalManager: ModalManager,
	layout: TUIBlockLayout,
): void {
	switch (action.type) {
		case "ctrl_c": {
			const result = controller.handleCtrlC();
			if (result === "show_hint") {
				blockRenderer.addText("\n[Press Ctrl+C again to quit]\n");
			} else if (result === "quit") {
				// Controller's onQuit callback handles cleanup
				// But we also need to exit
				process.exit(130);
			}
			break;
		}

		case "cancel":
			controller.triggerCancel();
			controller.abort();
			break;

		case "toggle_focus_mode":
			controller.toggleFocusMode();
			break;

		case "toggle_content_filter":
			controller.toggleContentFilterMode();
			break;

		case "cycle_profile":
			statusBar.cycleProfile();
			break;

		case "scroll_page": {
			const body = layout.body;
			if (!body.scroll) return;
			const containerHeight = body.height as number;
			const scrollAmount = Math.max(1, containerHeight - 2);
			if (action.direction < 0) {
				body.scroll(-scrollAmount);
			} else {
				body.scroll(scrollAmount);
			}
			blockRenderer.handleUserScroll();
			screenCtx.renderNow();
			break;
		}

		case "navigation":
			switch (action.action) {
				case "select_next":
					blockRenderer.selectNext();
					break;
				case "select_previous":
					blockRenderer.selectPrevious();
					break;
				case "select_first":
					blockRenderer.selectFirst();
					break;
				case "select_last":
					blockRenderer.selectLast();
					blockRenderer.enableFollowMode();
					break;
				case "toggle_expand":
					blockRenderer.toggleExpand();
					break;
				case "collapse":
					blockRenderer.collapseOrDeselect();
					break;
			}
			screenCtx.renderNow();
			break;

		case "raw_viewer":
			// This is handled asynchronously, but we don't await here
			// The modal manager handles the lifecycle
			void (async () => {
				const selected = blockRenderer.getSelectedBlock();
				if (!selected) return;

				if (selected.node.type === "llm_call") {
					const node = selected.node as LLMCallNode;
					await modalManager.showRawViewer(screenCtx.screen, {
						mode: action.mode,
						request: node.rawRequest,
						response: node.rawResponse,
						iteration: node.iteration,
						model: node.model,
					});
				} else if (selected.node.type === "gadget") {
					const node = selected.node as GadgetNode;
					await modalManager.showRawViewer(screenCtx.screen, {
						mode: action.mode,
						gadgetName: node.name,
						parameters: node.parameters,
						result: node.result,
						error: node.error,
					});
				}
			})();
			break;
	}
}

// Re-export utilities
export { StatusBar } from "./status-bar.js";
// Re-export types for convenience
export type { ApprovalContext, ApprovalResponse, TUIOptions } from "./types.js";
