/**
 * TUI input handler for AskUser prompts.
 *
 * Manages the input field lifecycle for user responses.
 * The input field is always visible but only active during prompts.
 */

import type { Box, KeyEvent, Screen, Text, Textbox } from "@unblessed/node";
import { openEditorSync } from "./editor.js";
import type { CtrlCCallback, PendingInput } from "./types.js";

/** Prompt indicator (2 chars) */
const PROMPT = "> ";

/**
 * Manages input field for AskUser responses.
 */
export class InputHandler {
  private inputBar: Textbox;
  private promptLabel: Text;
  private body: Box;
  private screen: Screen;
  private renderCallback: () => void;
  private renderNowCallback: () => void;

  /** Currently pending input request */
  private pendingInput: PendingInput | null = null;

  /** Whether we're waiting for REPL prompt (vs AskUser which should auto-focus) */
  private isPendingREPLPrompt = false;

  /** Whether input mode is currently active (focused, capturing keystrokes) */
  private isActive = false;

  /** Whether a bracketed paste is in progress */
  private isPasting = false;

  /** Buffer for accumulating bracketed paste content */
  private pasteBuffer = "";

  /** Flag to indicate content came from editor (skip paste detection on submit) */
  private fromEditor = false;

  /** Callback when Ctrl+C is pressed */
  private ctrlCCallback: CtrlCCallback | null = null;

  /** Callback when Ctrl+B is pressed (toggle focus mode) */
  private ctrlBCallback: (() => void) | null = null;

  /** Callback when Ctrl+K is pressed (toggle content filter mode) */
  private ctrlKCallback: (() => void) | null = null;

  /** Callback when Ctrl+I is pressed (scroll up) */
  private ctrlICallback: (() => void) | null = null;

  /** Callback when Ctrl+J is pressed (scroll down) */
  private ctrlJCallback: (() => void) | null = null;

  /** Callback when Ctrl+P is pressed (cycle profiles) */
  private ctrlPCallback: (() => void) | null = null;

  /** Callback when Arrow Up is pressed (scroll up in focused mode) */
  private arrowUpCallback: (() => void) | null = null;

  /** Callback when Arrow Down is pressed (scroll down in focused mode) */
  private arrowDownCallback: (() => void) | null = null;

  /** Callback for mid-session input (user submits while agent is running) */
  private midSessionHandler: ((message: string) => void) | null = null;

  /** Callback to check current focus mode (to avoid conflicts with browse mode) */
  private getFocusModeCallback: (() => "input" | "browse") | null = null;

  /** Callback to check current content filter mode */
  private getContentFilterModeCallback: (() => "full" | "focused") | null = null;

  /** Body height when input bar is visible */
  private bodyHeightWithInput: string;
  /** Body height when input bar is hidden (browse mode) */
  private bodyHeightWithoutInput: string;

  constructor(
    inputBar: Textbox,
    promptLabel: Text,
    body: Box,
    screen: Screen,
    renderCallback: () => void,
    renderNowCallback?: () => void,
    hasHints = true,
  ) {
    this.inputBar = inputBar;
    this.promptLabel = promptLabel;
    this.body = body;
    this.screen = screen;
    this.renderCallback = renderCallback;
    this.renderNowCallback = renderNowCallback ?? renderCallback;

    // Calculate body heights based on layout configuration
    // With hints: input=100%-3, browse=100%-2 (status + hints visible)
    // Without hints: input=100%-2, browse=100%-1 (just status visible)
    this.bodyHeightWithInput = hasHints ? "100%-3" : "100%-2";
    this.bodyHeightWithoutInput = hasHints ? "100%-2" : "100%-1";

    // Simple single-line input:
    // - Enter submits (Textbox default behavior)
    // - Ctrl+S opens $EDITOR for multiline editing
    // - Paste with newlines opens $EDITOR (via bracketed paste mode)

    // Handle submit (Enter key) - Textbox fires this on Enter
    this.inputBar.on("submit", (value: string) => {
      this.handleSubmit(value);
    });

    // Bracketed paste detection - terminal sends escape sequences around pasted content
    // Start: \x1b[200~  End: \x1b[201~
    // This is enabled in screen.ts via \x1b[?2004h
    this.setupBracketedPasteHandler();

    // Handle cancel (ESC while focused)
    this.inputBar.on("cancel", () => {
      this.handleCancel();
    });

    // Handle Ctrl+C on the input bar - propagate to callback
    // This ensures Ctrl+C works even when textbox has focus
    this.inputBar.key(["C-c"], () => {
      if (this.ctrlCCallback) {
        this.ctrlCCallback();
      }
    });

    // Handle Ctrl+B on the input bar - toggle focus mode
    // This ensures Ctrl+B works to switch between input and browse modes
    this.inputBar.key(["C-b"], () => {
      if (this.ctrlBCallback) {
        this.ctrlBCallback();
      }
    });

    // Handle Ctrl+K on the input bar - toggle content filter mode
    // This ensures Ctrl+K works to toggle focused/full mode when inputBar has focus
    this.inputBar.key(["C-k"], () => {
      if (this.ctrlKCallback) {
        this.ctrlKCallback();
      }
    });

    // Handle Ctrl+I on the input bar - scroll up
    // This ensures Ctrl+I works for scrolling when inputBar has focus
    this.inputBar.key(["C-i"], () => {
      if (this.ctrlICallback) {
        this.ctrlICallback();
      }
    });

    // Handle Ctrl+J on the input bar - scroll down
    // This ensures Ctrl+J works for scrolling when inputBar has focus
    this.inputBar.key(["C-j"], () => {
      if (this.ctrlJCallback) {
        this.ctrlJCallback();
      }
    });

    // Handle Ctrl+P on the input bar - cycle profiles
    // This ensures Ctrl+P works for profile cycling when inputBar has focus
    this.inputBar.key(["C-p"], () => {
      if (this.ctrlPCallback) {
        this.ctrlPCallback();
      }
    });

    // Handle Arrow Up on the input bar - scroll up in focused mode
    // In focused mode, we want arrows to scroll; in full mode, they move cursor
    this.inputBar.key(["up"], () => {
      if (this.getContentFilterModeCallback?.() === "focused" && this.arrowUpCallback) {
        this.arrowUpCallback();
      }
      // Otherwise, let the default textbox behavior handle cursor movement
    });

    // Handle Arrow Down on the input bar - scroll down in focused mode
    this.inputBar.key(["down"], () => {
      if (this.getContentFilterModeCallback?.() === "focused" && this.arrowDownCallback) {
        this.arrowDownCallback();
      }
      // Otherwise, let the default textbox behavior handle cursor movement
    });

    // Handle Ctrl+S on the input bar - open $EDITOR for multiline input
    this.inputBar.key(["C-s"], () => {
      const currentValue = this.inputBar.getValue();
      this.openEditorForInput(currentValue);
    });

    // Screen-level Enter key to activate pending REPL prompt
    // This allows navigation to work when not actively typing
    // Skip if in browse mode (Enter is used for toggling block expansion there)
    this.screen.key(["enter"], () => {
      if (this.isPendingREPLPrompt) {
        // Don't activate in browse mode - Enter toggles block expansion there
        if (this.getFocusModeCallback?.() === "browse") {
          return;
        }
        this.activatePendingPrompt();
      }
    });

    // Show idle prompt
    this.setIdle();
  }

  /**
   * Set callback for Ctrl+C events.
   */
  onCtrlC(callback: CtrlCCallback): void {
    this.ctrlCCallback = callback;
  }

  /**
   * Set callback for Ctrl+B events (toggle focus mode).
   */
  onCtrlB(callback: () => void): void {
    this.ctrlBCallback = callback;
  }

  /**
   * Set callback for Ctrl+K events (toggle content filter mode).
   */
  onCtrlK(callback: () => void): void {
    this.ctrlKCallback = callback;
  }

  /**
   * Set callback for Ctrl+I events (scroll up).
   */
  onCtrlI(callback: () => void): void {
    this.ctrlICallback = callback;
  }

  /**
   * Set callback for Ctrl+J events (scroll down).
   */
  onCtrlJ(callback: () => void): void {
    this.ctrlJCallback = callback;
  }

  /**
   * Set callback for Ctrl+P events (cycle profiles).
   */
  onCtrlP(callback: () => void): void {
    this.ctrlPCallback = callback;
  }

  /**
   * Set callback for Arrow Up events (scroll up in focused mode).
   */
  onArrowUp(callback: () => void): void {
    this.arrowUpCallback = callback;
  }

  /**
   * Set callback for Arrow Down events (scroll down in focused mode).
   */
  onArrowDown(callback: () => void): void {
    this.arrowDownCallback = callback;
  }

  /**
   * Set callback to check content filter mode.
   * Used to determine if arrow keys should scroll (focused mode)
   * or move cursor (full mode).
   */
  setGetContentFilterMode(callback: () => "full" | "focused"): void {
    this.getContentFilterModeCallback = callback;
  }

  /**
   * Set handler for mid-session input.
   * Called when user submits input while an agent session is running
   * (not during an AskUser prompt or REPL prompt wait).
   *
   * @param handler - Function to call with the user's message
   */
  setMidSessionHandler(handler: (message: string) => void): void {
    this.midSessionHandler = handler;
  }

  /**
   * Set callback to check focus mode.
   * Used to avoid activating REPL prompt when in browse mode
   * (where Enter is used for toggling block expansion).
   */
  setGetFocusMode(callback: () => "input" | "browse"): void {
    this.getFocusModeCallback = callback;
  }

  /**
   * Request user input with a question.
   *
   * @param question - The question to display
   * @param gadgetName - Name of the gadget requesting input
   * @returns Promise that resolves with user's response
   */
  async waitForInput(question: string, gadgetName: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.pendingInput = {
        question,
        gadgetName,
        resolve,
        reject,
      };

      // Question is rendered via block tree system (AskUser gadget block)
      // No need to inject directly - this ensures chronological ordering

      // Activate input mode
      this.setActive();
    });
  }

  /**
   * Wait for user to enter a new prompt (REPL mode).
   *
   * Unlike waitForInput, this doesn't auto-focus so navigation keys still work.
   * Press Enter to start typing a new prompt.
   *
   * @returns Promise that resolves with user's prompt
   */
  async waitForPrompt(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.pendingInput = {
        question: "",
        gadgetName: "prompt",
        resolve,
        reject,
      };

      // Set to pending state - show prompt but don't capture all keys
      // This allows block navigation to work while waiting for user to start typing
      this.setPendingPrompt();
    });
  }

  /**
   * Activate a pending REPL prompt (called when user presses Enter).
   */
  activatePendingPrompt(): void {
    if (this.isPendingREPLPrompt && this.pendingInput) {
      this.isPendingREPLPrompt = false;
      this.setActive();
    }
  }

  /**
   * Check if there's a pending input request.
   */
  hasPendingInput(): boolean {
    return this.pendingInput !== null;
  }

  /**
   * Check if we're waiting for a REPL prompt.
   * Used by TUIApp to determine if Ctrl+P (profile cycling) should be active.
   */
  isWaitingForREPLPrompt(): boolean {
    return this.isPendingREPLPrompt;
  }

  /**
   * Cancel any pending input request.
   */
  cancelPending(): void {
    if (this.pendingInput) {
      this.pendingInput.reject(new Error("Input cancelled"));
      this.pendingInput = null;
      this.setIdle();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Focus Mode API (controlled by TUIApp)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Activate input mode - focus input bar and capture keyboard.
   * Called by TUIApp when switching to input mode.
   * Shows input bar with active prompt (">>>") and starts capturing keystrokes.
   */
  activate(): void {
    this.isPendingREPLPrompt = false;
    this.isActive = true;
    // Show input bar and adjust body height
    this.promptLabel.show();
    this.inputBar.show();
    this.body.height = this.bodyHeightWithInput;
    this.setPrompt(PROMPT);
    // Render immediately to ensure layout update is visible before focus
    this.renderNowCallback();
    // Only call readInput() - it handles focusing internally
    this.inputBar.readInput();
  }

  /** Flag to prevent handleCancel from re-entering during deactivation */
  private isDeactivating = false;

  /**
   * Deactivate input mode - hide input bar completely.
   * Called by TUIApp when switching to browse mode.
   * Input bar is hidden to give more space to content.
   */
  deactivate(): void {
    this.isPendingREPLPrompt = false;
    this.isActive = false;

    // Cancel any active input session to clean up blessed's internal state
    // This prevents listener accumulation when switching modes
    this.isDeactivating = true;
    this.inputBar.cancel();
    this.isDeactivating = false;

    // Hide input bar and reclaim that row for content
    this.promptLabel.hide();
    this.inputBar.hide();
    this.body.height = this.bodyHeightWithoutInput;
    this.renderNowCallback();
  }

  /**
   * Check if input mode is active (focused, capturing keystrokes).
   */
  isInputActive(): boolean {
    return this.isActive;
  }

  /**
   * Handle input submission.
   */
  private handleSubmit(rawValue: string): void {
    // Skip if a bracketed paste is in progress (submit fired mid-paste)
    if (this.isPasting) {
      return;
    }

    // Clear editor flag
    if (this.fromEditor) {
      this.fromEditor = false;
    }

    // Value no longer contains prompt - just trim whitespace
    const value = rawValue.trim();

    if (!value) {
      // Empty input - readInput for retry (no separate focus call needed)
      this.inputBar.readInput();
      return;
    }

    if (this.pendingInput) {
      // Resolve the pending promise
      const { resolve } = this.pendingInput;
      this.pendingInput = null;

      // Reset to idle state
      this.setIdle();

      // Resolve with the user's input
      resolve(value);
    } else if (this.midSessionHandler) {
      // Mid-session input - inject into running agent
      this.midSessionHandler(value);
      this.setIdle();
    } else {
      // No pending input and no mid-session handler - just reset
      this.setIdle();
    }
  }

  /**
   * Handle input cancellation (ESC key).
   */
  private handleCancel(): void {
    // Skip if we're in the process of deactivating (switching to browse mode)
    if (this.isDeactivating) {
      return;
    }

    if (this.pendingInput) {
      // Don't actually cancel - just re-enter input mode
      // The pending input will continue to wait
      this.inputBar.readInput();
    } else {
      this.setIdle();
    }
  }

  /**
   * Set up bracketed paste mode detection.
   *
   * Terminal emulators that support bracketed paste send:
   * - \x1b[200~ before pasted content
   * - \x1b[201~ after pasted content
   *
   * This allows reliable detection of paste vs typed input.
   */
  private setupBracketedPasteHandler(): void {
    const PASTE_START = "\x1b[200~";
    const PASTE_END = "\x1b[201~";

    // Listen to raw input data from the terminal
    this.screen.program.input.on("data", (data: Buffer) => {
      const str = data.toString();

      // Check for paste start marker
      if (str.includes(PASTE_START)) {
        this.isPasting = true;
        this.pasteBuffer = "";

        // Extract content after the start marker
        const startIdx = str.indexOf(PASTE_START) + PASTE_START.length;
        const afterStart = str.slice(startIdx);

        // Check if end marker is also in this chunk
        if (afterStart.includes(PASTE_END)) {
          const endIdx = afterStart.indexOf(PASTE_END);
          this.pasteBuffer = afterStart.slice(0, endIdx);
          this.isPasting = false;
          this.handlePaste(this.pasteBuffer);
          this.pasteBuffer = "";
        } else {
          this.pasteBuffer = afterStart;
        }
        return;
      }

      // Check for paste end marker (in subsequent chunk)
      if (this.isPasting && str.includes(PASTE_END)) {
        const endIdx = str.indexOf(PASTE_END);
        this.pasteBuffer += str.slice(0, endIdx);
        this.isPasting = false;
        this.handlePaste(this.pasteBuffer);
        this.pasteBuffer = "";
        return;
      }

      // Accumulate content while pasting
      if (this.isPasting) {
        this.pasteBuffer += str;
      }
    });
  }

  /**
   * Handle completed paste content.
   *
   * If content contains newlines, opens $EDITOR for multiline editing.
   * Otherwise, inserts directly into the input bar.
   */
  private handlePaste(content: string): void {
    if (!content) return;

    // If content has newlines, open editor for multiline editing
    if (content.includes("\n")) {
      const currentValue = this.inputBar.getValue();
      this.openEditorForInput(currentValue + content);
    } else {
      // Single-line paste - append to current input
      const currentValue = this.inputBar.getValue();
      this.inputBar.setValue(currentValue + content);
      // Re-focus input to continue editing
      this.inputBar.readInput();
    }
  }

  /**
   * Set prompt text and dynamically adjust layout.
   * Idle prompt "> " uses 2 chars, active prompt ">>> " uses 4 chars.
   */
  private setPrompt(prompt: string): void {
    const width = prompt.length;
    this.promptLabel.width = width;
    this.promptLabel.setContent(prompt);
    this.inputBar.left = width;
    this.inputBar.width = `100%-${width}`;
  }

  /**
   * Set input to idle state.
   */
  private setIdle(): void {
    this.isPendingREPLPrompt = false;
    this.isActive = false;
    this.setPrompt(PROMPT);
    this.inputBar.setValue("");
    this.renderCallback();
    // Don't focus - let body handle scroll keys
  }

  /**
   * Enter the pending REPL prompt state without blocking.
   * This enables Ctrl+P profile cycling while waiting for user input.
   * Call this early during startup so the REPL is in waiting mode immediately.
   */
  startWaitingForPrompt(): void {
    this.setPendingPrompt();
  }

  /**
   * Set input to pending REPL prompt state.
   * Shows the prompt indicator but doesn't capture all keys.
   */
  private setPendingPrompt(): void {
    this.isPendingREPLPrompt = true;
    this.setPrompt(PROMPT);
    this.inputBar.setValue("");
    this.renderCallback();
    // Don't focus - let navigation keys work
    // User presses Enter to activate and start typing
  }

  /**
   * Set input to active state for user input.
   */
  private setActive(): void {
    this.isPendingREPLPrompt = false;
    this.isActive = true;
    // Ensure input bar is visible (may be hidden in browse mode)
    this.promptLabel.show();
    this.inputBar.show();
    this.body.height = this.bodyHeightWithInput;
    this.setPrompt(PROMPT);
    this.inputBar.setValue("");
    // Render immediately to ensure input bar is visible before focus
    this.renderNowCallback();
    // Only call readInput() - it handles focusing internally
    // Calling both focus() and readInput() can cause double character echo
    this.inputBar.readInput();
  }

  /**
   * Open $EDITOR for multiline input.
   * Called when user presses Ctrl+S or pastes multiline content.
   */
  private openEditorForInput(initialContent: string): void {
    // Fully reset terminal before spawning editor
    // This is critical - blessed must release all terminal control
    this.screen.program.clear();
    this.screen.program.disableMouse();
    this.screen.program.showCursor();
    this.screen.program.normalBuffer();

    // Synchronously spawn editor - this blocks the event loop completely
    // preventing blessed from interfering with terminal control
    const result = openEditorSync(initialContent);

    // Restore blessed terminal control
    this.screen.program.alternateBuffer();
    this.screen.program.hideCursor();
    this.screen.program.enableMouse();

    // Force full screen redraw
    this.screen.alloc();
    this.screen.render();

    // Clear any paste state
    this.isPasting = false;
    this.pasteBuffer = "";

    // Use setImmediate to let any stray terminal input drain
    // before processing the editor result (prevents ghost keypresses)
    setImmediate(() => {
      if (result) {
        // Mark that content came from editor to prevent paste detection loop
        this.fromEditor = true;
        // User saved content - submit it
        this.handleSubmit(result);
      } else {
        // User cancelled - restore input and continue editing
        this.inputBar.setValue(initialContent);
        this.inputBar.readInput();
      }
    });
  }
}
