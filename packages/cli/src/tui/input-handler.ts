/**
 * TUI input handler for AskUser prompts.
 *
 * Manages the input field lifecycle for user responses.
 * The input field is always visible but only active during prompts.
 */

import type { Box, Screen, Text, Textbox } from "@unblessed/node";
import type { CtrlCCallback, PendingInput } from "./types.js";

/** Prompt indicator shown when input is idle */
const IDLE_PROMPT = "> ";

/** Prompt indicator shown when waiting for input */
const ACTIVE_PROMPT = ">>> ";

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

  /** Callback for mid-session input (user submits while agent is running) */
  private midSessionHandler: ((message: string) => void) | null = null;

  constructor(
    inputBar: Textbox,
    promptLabel: Text,
    body: Box,
    screen: Screen,
    renderCallback: () => void,
    renderNowCallback?: () => void,
  ) {
    this.inputBar = inputBar;
    this.promptLabel = promptLabel;
    this.body = body;
    this.screen = screen;
    this.renderCallback = renderCallback;
    this.renderNowCallback = renderNowCallback ?? renderCallback;

    // Set up input submission handler
    this.inputBar.on("submit", (value: string) => {
      this.handleSubmit(value);
    });

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
    // This ensures Ctrl+B works to exit input mode back to browse mode
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

    // Screen-level Enter key to activate pending REPL prompt
    // This allows navigation to work when not actively typing
    this.screen.key(["enter"], () => {
      if (this.isPendingREPLPrompt) {
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
   * Activate input mode - show input bar and capture keyboard.
   * Called by TUIApp when switching to input mode.
   * Preserves current prompt indicator and input text.
   */
  activate(): void {
    this.isPendingREPLPrompt = false;
    this.promptLabel.show();
    this.inputBar.show();
    // Render immediately to ensure input bar is visible before focus
    this.renderNowCallback();
    // Only call readInput() - it handles focusing internally
    this.inputBar.readInput();
  }

  /**
   * Deactivate input mode - hide input bar completely.
   * Called by TUIApp when switching to browse mode.
   */
  deactivate(): void {
    this.promptLabel.hide();
    this.inputBar.hide();
    this.isPendingREPLPrompt = false;
    this.renderNowCallback();
  }

  /**
   * Check if input mode is active (input bar visible and focused).
   */
  isInputActive(): boolean {
    return this.inputBar.visible !== false;
  }

  /**
   * Handle input submission.
   */
  private handleSubmit(rawValue: string): void {
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
    if (this.pendingInput) {
      // Don't actually cancel - just re-enter input mode
      // The pending input will continue to wait
      this.inputBar.readInput();
    } else {
      this.setIdle();
    }
  }

  /**
   * Set input to idle state.
   */
  private setIdle(): void {
    this.isPendingREPLPrompt = false;
    this.promptLabel.setContent(IDLE_PROMPT);
    this.inputBar.setValue("");
    // Don't focus - let body handle scroll keys
    this.renderCallback();
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
    this.promptLabel.setContent(IDLE_PROMPT);
    this.inputBar.setValue("");
    // Don't focus - let navigation keys work
    // User presses Enter to activate and start typing
    this.renderCallback();
  }

  /**
   * Set input to active state for user input.
   */
  private setActive(): void {
    this.isPendingREPLPrompt = false;
    this.promptLabel.setContent(ACTIVE_PROMPT);
    this.inputBar.setValue("");
    // Only call readInput() - it handles focusing internally
    // Calling both focus() and readInput() can cause double character echo
    this.inputBar.readInput();
    this.renderCallback();
  }
}
