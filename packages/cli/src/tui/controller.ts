/**
 * TUIController - Composes state managers and handles callbacks.
 *
 * This is the main orchestration layer for TUI state, composing:
 * - InputModeManager: focus mode and content filter mode state machines
 * - AbortManager: abort controller lifecycle
 *
 * Also handles:
 * - Ctrl+C double-press detection for quit
 * - Callback management (onQuit, onCancel, onMidSessionInput, etc.)
 *
 * The controller is a pure state manager with no blessed dependencies,
 * making it fully testable without a terminal.
 */

import type { ContentFilterMode, FocusMode } from "./types.js";
import { AbortManager } from "./abort-manager.js";
import { InputModeManager } from "./input-mode-manager.js";

/** Window for double Ctrl+C detection (ms) */
const CTRL_C_WINDOW_MS = 1000;

export interface TUIControllerCallbacks {
	onQuit?: () => void;
	onCancel?: () => void;
	onMidSessionInput?: (message: string) => void;
	onFocusModeChange?: (mode: FocusMode) => void;
	onContentFilterModeChange?: (mode: ContentFilterMode) => void;
}

export class TUIController {
	private modeManager: InputModeManager;
	private abortManager: AbortManager;
	private callbacks: TUIControllerCallbacks;
	private lastCtrlCTime = 0;

	constructor(callbacks?: TUIControllerCallbacks) {
		this.modeManager = new InputModeManager();
		this.abortManager = new AbortManager();
		this.callbacks = callbacks ?? {};
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// State Queries
	// ─────────────────────────────────────────────────────────────────────────────

	getFocusMode(): FocusMode {
		return this.modeManager.getFocusMode();
	}

	getContentFilterMode(): ContentFilterMode {
		return this.modeManager.getContentFilterMode();
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// State Transitions
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Toggle between browse and input modes.
	 * @returns true if the mode changed
	 */
	toggleFocusMode(): boolean {
		const changed = this.modeManager.toggleFocusMode();
		if (changed) {
			this.callbacks.onFocusModeChange?.(this.modeManager.getFocusMode());
		}
		return changed;
	}

	/**
	 * Set focus mode programmatically.
	 * @returns true if the mode changed
	 */
	setFocusMode(mode: FocusMode): boolean {
		const changed = this.modeManager.setFocusMode(mode);
		if (changed) {
			this.callbacks.onFocusModeChange?.(mode);
		}
		return changed;
	}

	/**
	 * Toggle content filter mode.
	 * @returns true (always changes)
	 */
	toggleContentFilterMode(): boolean {
		const changed = this.modeManager.toggleContentFilterMode();
		if (changed) {
			// Content filter change may also change focus mode (focused forces input)
			this.callbacks.onContentFilterModeChange?.(this.modeManager.getContentFilterMode());
			// Also fire focus mode change since focused mode forces input
			if (this.modeManager.getContentFilterMode() === "focused") {
				this.callbacks.onFocusModeChange?.("input");
			}
		}
		return changed;
	}

	/**
	 * Push input mode onto the stack (for AskUser).
	 */
	pushInputMode(): void {
		const before = this.modeManager.getFocusMode();
		this.modeManager.pushInputMode();
		const after = this.modeManager.getFocusMode();
		if (before !== after) {
			this.callbacks.onFocusModeChange?.(after);
		}
	}

	/**
	 * Pop input mode from the stack (after AskUser completes).
	 */
	popInputMode(): void {
		const before = this.modeManager.getFocusMode();
		this.modeManager.popInputMode();
		const after = this.modeManager.getFocusMode();
		if (before !== after) {
			this.callbacks.onFocusModeChange?.(after);
		}
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Ctrl+C Handling
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Handle Ctrl+C keypress.
	 * @returns "show_hint" for first press, "quit" for second press within window
	 */
	handleCtrlC(): "show_hint" | "quit" {
		const now = Date.now();

		if (now - this.lastCtrlCTime < CTRL_C_WINDOW_MS) {
			// Second press within window - trigger quit
			this.callbacks.onQuit?.();
			return "quit";
		}

		// First press - record time
		this.lastCtrlCTime = now;
		return "show_hint";
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Abort Management (delegated to AbortManager)
	// ─────────────────────────────────────────────────────────────────────────────

	getAbortSignal(): AbortSignal {
		return this.abortManager.getSignal();
	}

	resetAbort(): void {
		this.abortManager.reset();
	}

	abort(): void {
		this.abortManager.abort();
	}

	isAborted(): boolean {
		return this.abortManager.isAborted();
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Callback Registration
	// ─────────────────────────────────────────────────────────────────────────────

	onQuit(callback: () => void): this {
		this.callbacks.onQuit = callback;
		return this;
	}

	onCancel(callback: () => void): this {
		this.callbacks.onCancel = callback;
		return this;
	}

	onMidSessionInput(callback: (message: string) => void): this {
		this.callbacks.onMidSessionInput = callback;
		return this;
	}

	/**
	 * Trigger the cancel callback.
	 * Called when ESC is pressed in appropriate context.
	 */
	triggerCancel(): void {
		this.callbacks.onCancel?.();
	}

	/**
	 * Trigger the mid-session input callback.
	 * Called when user submits input during a running session.
	 */
	triggerMidSessionInput(message: string): void {
		this.callbacks.onMidSessionInput?.(message);
	}
}
