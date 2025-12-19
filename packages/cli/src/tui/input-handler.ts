/**
 * TUI input handler for AskUser prompts.
 *
 * Manages the input field lifecycle for user responses.
 * The input field is always visible but only active during prompts.
 */

import type { Screen, Textbox, Box } from "@unblessed/node";
import type { PendingInput, CtrlCCallback } from "./types.js";

/** Prompt indicator shown when input is idle */
const IDLE_PROMPT = "> ";

/** Prompt indicator shown when waiting for input */
const ACTIVE_PROMPT = ">>> ";

/** Prompt indicator for pending REPL input (not capturing keys yet) */
const PENDING_PROMPT = "> ";

/**
 * Manages input field for AskUser responses.
 */
export class InputHandler {
  private inputBar: Textbox;
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

  /** Callback for mid-session input (user submits while agent is running) */
  private midSessionHandler: ((message: string) => void) | null = null;

  constructor(
    inputBar: Textbox,
    body: Box,
    screen: Screen,
    renderCallback: () => void,
    renderNowCallback?: () => void,
  ) {
    this.inputBar = inputBar;
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

      // Show the question in the body area
      this.appendQuestionToBody(question);

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
   */
  activate(): void {
    this.isPendingREPLPrompt = false;
    this.inputBar.show();
    this.inputBar.setValue(ACTIVE_PROMPT);
    // Render immediately to ensure input bar is visible before focus
    this.renderNowCallback();
    // Then focus and start reading input
    this.inputBar.focus();
    this.inputBar.readInput();
  }

  /**
   * Deactivate input mode - hide input bar completely.
   * Called by TUIApp when switching to browse mode.
   */
  deactivate(): void {
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
    // Extract actual input (remove prompt prefix)
    const value = rawValue.startsWith(ACTIVE_PROMPT)
      ? rawValue.slice(ACTIVE_PROMPT.length).trim()
      : rawValue.startsWith(IDLE_PROMPT)
        ? rawValue.slice(IDLE_PROMPT.length).trim()
        : rawValue.trim();

    if (!value) {
      // Empty input - refocus for retry
      this.inputBar.focus();
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
      // Don't actually cancel - just reset focus
      // The pending input will continue to wait
      this.inputBar.focus();
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
    this.inputBar.setValue(IDLE_PROMPT);
    // Don't focus - let body handle scroll keys
    this.renderCallback();
  }

  /**
   * Set input to pending REPL prompt state.
   * Shows the prompt indicator but doesn't capture all keys.
   */
  private setPendingPrompt(): void {
    this.isPendingREPLPrompt = true;
    this.inputBar.setValue(PENDING_PROMPT);
    // Don't focus - let navigation keys work
    // User presses Enter to activate and start typing
    this.renderCallback();
  }

  /**
   * Set input to active state for user input.
   */
  private setActive(): void {
    this.isPendingREPLPrompt = false;
    this.inputBar.setValue(ACTIVE_PROMPT);
    this.inputBar.focus();
    this.inputBar.readInput();
    this.renderCallback();
  }

  /**
   * Append the question to the body content.
   */
  private appendQuestionToBody(question: string): void {
    const currentContent = this.body.getContent();
    const separator = "\n" + "─".repeat(40) + "\n";
    const formatted = `${separator}? ${question}${separator}`;

    this.body.setContent(currentContent + formatted);
    this.body.setScrollPerc?.(100);
    this.renderCallback();
  }
}
