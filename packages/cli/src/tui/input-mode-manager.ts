/**
 * InputModeManager - Pure state machine for focus mode and content filter mode.
 *
 * State Machine Rules:
 * - Focus mode: "browse" (navigate blocks) | "input" (type in input field)
 * - Content filter mode: "full" (show all) | "focused" (hide technical details)
 *
 * Constraints:
 * - "focused" content mode forces "input" focus mode (browse is blocked)
 * - toggleFocusMode() is a no-op in "focused" content mode
 *
 * The AskUser mode stack allows temporarily forcing input mode and restoring
 * the previous mode when the input is complete.
 */

import type { ContentFilterMode, FocusMode } from "./types.js";

export interface InputModeState {
	focusMode: FocusMode;
	contentFilterMode: ContentFilterMode;
}

export class InputModeManager {
	private focusMode: FocusMode = "browse";
	private contentFilterMode: ContentFilterMode = "full";
	private savedFocusMode: FocusMode | null = null;

	/**
	 * Get the current state.
	 */
	getState(): InputModeState {
		return {
			focusMode: this.focusMode,
			contentFilterMode: this.contentFilterMode,
		};
	}

	/**
	 * Get the current focus mode.
	 */
	getFocusMode(): FocusMode {
		return this.focusMode;
	}

	/**
	 * Get the current content filter mode.
	 */
	getContentFilterMode(): ContentFilterMode {
		return this.contentFilterMode;
	}

	/**
	 * Toggle between browse and input modes.
	 * No-op in focused content mode (browse not allowed).
	 *
	 * @returns true if the mode changed, false otherwise
	 */
	toggleFocusMode(): boolean {
		// In focused content mode, always stay in input mode
		if (this.contentFilterMode === "focused") {
			return false;
		}

		const newMode = this.focusMode === "browse" ? "input" : "browse";
		if (this.focusMode !== newMode) {
			this.focusMode = newMode;
			return true;
		}
		return false;
	}

	/**
	 * Set focus mode programmatically.
	 * Used by AskUser to force input mode.
	 * BROWSE mode is blocked in focused content mode.
	 *
	 * @returns true if the mode changed, false otherwise
	 */
	setFocusMode(mode: FocusMode): boolean {
		// In focused content mode, don't allow browse mode
		if (this.contentFilterMode === "focused" && mode === "browse") {
			return false;
		}

		if (this.focusMode !== mode) {
			this.focusMode = mode;
			return true;
		}
		return false;
	}

	/**
	 * Toggle content filter mode between full and focused.
	 * In focused mode, forces INPUT mode.
	 *
	 * @returns true (always changes)
	 */
	toggleContentFilterMode(): boolean {
		const newMode = this.contentFilterMode === "full" ? "focused" : "full";
		this.contentFilterMode = newMode;

		// In focused mode, force INPUT mode
		if (newMode === "focused") {
			this.focusMode = "input";
		}

		return true;
	}

	/**
	 * Push input mode onto the stack (for AskUser).
	 * Saves the current focus mode and forces input mode.
	 */
	pushInputMode(): void {
		this.savedFocusMode = this.focusMode;
		this.focusMode = "input";
	}

	/**
	 * Pop input mode from the stack (after AskUser completes).
	 * Restores the previously saved focus mode.
	 * If no saved mode, stays in current mode.
	 *
	 * Note: If content filter mode is "focused", browse mode is blocked,
	 * so we stay in input mode instead of restoring browse.
	 */
	popInputMode(): void {
		if (this.savedFocusMode !== null) {
			// Respect content filter constraints when restoring
			if (this.contentFilterMode === "focused" && this.savedFocusMode === "browse") {
				// Can't restore browse in focused mode, stay in input
				this.focusMode = "input";
			} else {
				this.focusMode = this.savedFocusMode;
			}
			this.savedFocusMode = null;
		}
	}

	/**
	 * Check if there's a saved focus mode (i.e., we're in a pushed state).
	 */
	hasSavedMode(): boolean {
		return this.savedFocusMode !== null;
	}
}
