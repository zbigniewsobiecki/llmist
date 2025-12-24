/**
 * KeyboardManager - Centralized keyboard event dispatch.
 *
 * Maps key sequences to typed KeyAction objects and dispatches them
 * based on the current focus mode. This separates key binding logic
 * from the action handlers, making both easier to test.
 *
 * Key handling rules:
 * - Navigation keys (arrows, vim keys) only work in "browse" mode
 * - Ctrl+B/K/P work in both modes (forwarded from InputHandler when in input mode)
 * - PageUp/PageDown work in both modes
 */

import type { Screen } from "@unblessed/node";
import type { FocusMode } from "./types.js";

export type NavigationAction =
	| "select_next"
	| "select_previous"
	| "select_first"
	| "select_last"
	| "toggle_expand"
	| "collapse";

export type KeyAction =
	| { type: "ctrl_c" }
	| { type: "cancel" }
	| { type: "toggle_focus_mode" }
	| { type: "toggle_content_filter" }
	| { type: "cycle_profile" }
	| { type: "scroll_page"; direction: -1 | 1 }
	| { type: "navigation"; action: NavigationAction }
	| { type: "raw_viewer"; mode: "request" | "response" };

export interface KeyboardManagerConfig {
	screen: Screen;
	getFocusMode: () => FocusMode;
	isWaitingForREPLPrompt: () => boolean;
	hasPendingInput: () => boolean;
	isBlockExpanded: () => boolean;
	onAction: (action: KeyAction) => void;
}

export class KeyboardManager {
	private config: KeyboardManagerConfig;

	constructor(config: KeyboardManagerConfig) {
		this.config = config;
	}

	/**
	 * Set up all key bindings on the screen.
	 */
	setup(): void {
		const { screen, onAction } = this.config;

		// ESC to cancel (context-dependent)
		screen.key(["escape"], () => {
			if (this.config.hasPendingInput()) {
				// Don't cancel input - let user continue typing
				return;
			}

			if (this.config.getFocusMode() === "browse" && this.config.isBlockExpanded()) {
				// Let block navigation handle collapse
				onAction({ type: "navigation", action: "collapse" });
				return;
			}

			// Cancel current operation
			onAction({ type: "cancel" });
		});

		// Ctrl+C for quit (double-press detection handled by controller)
		screen.key(["C-c"], () => {
			onAction({ type: "ctrl_c" });
		});

		// Ctrl+B to toggle focus mode
		screen.key(["C-b"], () => {
			onAction({ type: "toggle_focus_mode" });
		});

		// Ctrl+K to toggle content filter mode
		screen.key(["C-k"], () => {
			onAction({ type: "toggle_content_filter" });
		});

		// Ctrl+P to cycle profiles (works in both modes)
		// Profile changes affect the next session, so it's safe to cycle anytime
		screen.key(["C-p"], () => {
			onAction({ type: "cycle_profile" });
		});

		// PageUp/PageDown for scrolling (works in both modes)
		// Also Ctrl+I/Ctrl+J for MacBook keyboards without dedicated Page keys
		screen.key(["pageup", "C-i"], () => {
			onAction({ type: "scroll_page", direction: -1 });
		});

		screen.key(["pagedown", "C-j"], () => {
			onAction({ type: "scroll_page", direction: 1 });
		});

		// Navigation keys (browse mode only)
		screen.key(["up", "k"], () => {
			if (this.config.getFocusMode() !== "browse") return;
			onAction({ type: "navigation", action: "select_previous" });
		});

		screen.key(["down", "j"], () => {
			if (this.config.getFocusMode() !== "browse") return;
			onAction({ type: "navigation", action: "select_next" });
		});

		screen.key(["enter", "space"], () => {
			if (this.config.getFocusMode() !== "browse") return;
			onAction({ type: "navigation", action: "toggle_expand" });
		});

		screen.key(["h"], () => {
			if (this.config.getFocusMode() !== "browse") return;
			onAction({ type: "navigation", action: "collapse" });
		});

		screen.key(["home", "g"], () => {
			if (this.config.getFocusMode() !== "browse") return;
			onAction({ type: "navigation", action: "select_first" });
		});

		screen.key(["end", "G"], () => {
			if (this.config.getFocusMode() !== "browse") return;
			onAction({ type: "navigation", action: "select_last" });
		});

		// Raw viewer keys (browse mode only)
		screen.key(["r"], () => {
			if (this.config.getFocusMode() !== "browse") return;
			onAction({ type: "raw_viewer", mode: "request" });
		});

		screen.key(["S-r"], () => {
			if (this.config.getFocusMode() !== "browse") return;
			onAction({ type: "raw_viewer", mode: "response" });
		});
	}

	/**
	 * Handle a key forwarded from InputHandler.
	 * Used for keys that need to work even when the input field is focused.
	 */
	handleForwardedKey(key: "C-c" | "C-b" | "C-k" | "C-i" | "C-j" | "C-p"): void {
		const { onAction } = this.config;

		switch (key) {
			case "C-c":
				onAction({ type: "ctrl_c" });
				break;
			case "C-b":
				onAction({ type: "toggle_focus_mode" });
				break;
			case "C-k":
				onAction({ type: "toggle_content_filter" });
				break;
			case "C-i":
				onAction({ type: "scroll_page", direction: -1 });
				break;
			case "C-j":
				onAction({ type: "scroll_page", direction: 1 });
				break;
			case "C-p":
				onAction({ type: "cycle_profile" });
				break;
		}
	}
}
