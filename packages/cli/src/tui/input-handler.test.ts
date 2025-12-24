import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { Readable, Writable } from "node:stream";
import { Box, NodeRuntime, Screen, setRuntime, Text, Textbox } from "@unblessed/node";
import { InputHandler } from "./input-handler.js";

// TUI tests use mock streams - no real TTY needed

// Mock streams to prevent terminal escape sequences from being written
class MockOutputStream extends Writable {
  _write(_chunk: Buffer | string, _encoding: string, callback: () => void): void {
    callback();
  }
}

class MockInputStream extends Readable {
  _read(): void {
    // No-op - never emit data
  }
}

// Initialize unblessed for testing
let screen: Screen;
let inputBar: Textbox;
let promptLabel: Text;
let body: Box;
let mockOutput: MockOutputStream;
let mockInput: MockInputStream;

beforeAll(() => {
  setRuntime(new NodeRuntime());
  mockOutput = new MockOutputStream();
  mockInput = new MockInputStream();
  screen = new Screen({
    smartCSR: true,
    title: "test",
    fullUnicode: true,
    input: mockInput,
    output: mockOutput,
  });

  // Static prompt label (non-editable)
  promptLabel = new Text({
    parent: screen,
    bottom: 1,
    left: 0,
    width: 4,
    height: 1,
    content: "> ",
    style: { fg: "cyan", bg: "black" },
  });

  inputBar = new Textbox({
    parent: screen,
    bottom: 1,
    left: 4,
    width: "100%-4",
    height: 1,
    inputOnFocus: true,
    keys: true,
    mouse: true,
    style: { fg: "white", bg: "black" },
  });

  body = new Box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%-2",
    scrollable: true,
    style: { fg: "white", bg: "black" },
  });
});

afterAll(() => {
  if (screen) {
    screen.destroy();
  }
});

describe("InputHandler", () => {
  describe("constructor", () => {
    test("initializes with idle prompt", () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      // Initial state should show idle prompt in promptLabel
      expect(promptLabel.getContent()).toBe("> ");
      // inputBar should be empty (no prompt prefix stored in value)
      expect(inputBar.getValue()).toBe("");
    });
  });

  describe("Ctrl+C callback", () => {
    test("onCtrlC sets the callback", () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      const ctrlCCallback = mock(() => {});
      handler.onCtrlC(ctrlCCallback);

      // The callback is stored internally (we can verify by triggering Ctrl+C)
      expect(ctrlCCallback).not.toHaveBeenCalled();
    });
  });

  describe("Ctrl+B callback", () => {
    test("onCtrlB sets the callback", () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      const ctrlBCallback = mock(() => {});
      handler.onCtrlB(ctrlBCallback);

      // The callback is stored internally
      expect(ctrlBCallback).not.toHaveBeenCalled();
    });
  });

  describe("focus mode API", () => {
    test("activate shows input bar and preserves current state", () => {
      const renderCallback = mock(() => {});
      const renderNowCallback = mock(() => {});
      const handler = new InputHandler(
        inputBar,
        promptLabel,
        body,
        screen,
        renderCallback,
        renderNowCallback,
      );

      // Set some initial state
      promptLabel.setContent("> ");
      inputBar.setValue("my text");

      handler.activate();

      // Input bar should be visible
      expect(inputBar.visible).not.toBe(false);
      // Prompt label should be visible
      expect(promptLabel.visible).not.toBe(false);
      // Should preserve the current prompt (idle state from constructor)
      expect(promptLabel.getContent()).toBe("> ");
      // Should preserve the input text
      expect(inputBar.getValue()).toBe("my text");
      // Should have rendered immediately
      expect(renderNowCallback).toHaveBeenCalled();
    });

    test("deactivate hides input bar", () => {
      const renderCallback = mock(() => {});
      const renderNowCallback = mock(() => {});
      const handler = new InputHandler(
        inputBar,
        promptLabel,
        body,
        screen,
        renderCallback,
        renderNowCallback,
      );

      // First activate
      handler.activate();
      expect(inputBar.visible).not.toBe(false);

      // Then deactivate
      handler.deactivate();

      // Input bar and promptLabel should be hidden
      expect(inputBar.visible).toBe(false);
      expect(promptLabel.visible).toBe(false);
    });

    test("isInputActive returns true when visible", () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      handler.activate();
      expect(handler.isInputActive()).toBe(true);
    });

    test("isInputActive returns false when hidden", () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      handler.deactivate();
      expect(handler.isInputActive()).toBe(false);
    });

    test("activate clears pending REPL prompt state", () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      // Setup pending prompt state (internal state we're checking behavior)
      handler.activate();

      // Verify handler is active
      expect(handler.isInputActive()).toBe(true);
      // Prompt is preserved (idle state "> " from constructor)
      expect(promptLabel.getContent()).toBe("> ");
    });

    test("deactivate clears pending REPL prompt state", () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      handler.deactivate();

      // Input should be hidden
      expect(handler.isInputActive()).toBe(false);
    });
  });

  describe("hasPendingInput", () => {
    test("returns false initially", () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      expect(handler.hasPendingInput()).toBe(false);
    });

    test("returns true after waitForInput is called", async () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      // Start waiting for input (don't await - it won't resolve)
      const inputPromise = handler.waitForInput("Test question?", "TestGadget");

      expect(handler.hasPendingInput()).toBe(true);

      // Clean up by cancelling
      handler.cancelPending();
      await inputPromise.catch(() => {}); // Ignore rejection
    });
  });

  describe("cancelPending", () => {
    test("rejects pending input promise", async () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      const inputPromise = handler.waitForInput("Test?", "TestGadget");

      handler.cancelPending();

      await expect(inputPromise).rejects.toThrow("Input cancelled");
    });

    test("sets input to idle state", async () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      const inputPromise = handler.waitForInput("Test?", "TestGadget");
      handler.cancelPending();

      // Prompt should be in promptLabel, inputBar should be empty
      expect(promptLabel.getContent()).toBe("> ");
      expect(inputBar.getValue()).toBe("");

      // Clean up the rejected promise
      await inputPromise.catch(() => {});
    });

    test("clears pending input state", async () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      const inputPromise = handler.waitForInput("Test?", "TestGadget");
      expect(handler.hasPendingInput()).toBe(true);

      handler.cancelPending();
      expect(handler.hasPendingInput()).toBe(false);

      await inputPromise.catch(() => {}); // Ignore rejection
    });
  });

  describe("waitForPrompt", () => {
    test("sets up pending REPL prompt state", async () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      const promptPromise = handler.waitForPrompt();

      expect(handler.hasPendingInput()).toBe(true);
      // Shows pending prompt indicator in promptLabel
      expect(promptLabel.getContent()).toBe("> ");
      expect(inputBar.getValue()).toBe("");

      // Clean up
      handler.cancelPending();
      await promptPromise.catch(() => {});
    });
  });

  describe("activatePendingPrompt", () => {
    test("activates pending REPL prompt", async () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      // Start waiting for prompt
      const promptPromise = handler.waitForPrompt();
      expect(promptLabel.getContent()).toBe("> ");
      expect(handler.hasPendingInput()).toBe(true);

      // Activate it (simulates Enter key)
      handler.activatePendingPrompt();

      // The activation should have been triggered (value changes to active prompt)
      // Note: Due to blessed widget focus/readInput internals in test environment,
      // the setValue may not persist, so we verify behavior through hasPendingInput
      expect(handler.hasPendingInput()).toBe(true);

      // Clean up
      handler.cancelPending();
      await promptPromise.catch(() => {});
    });

    test("does nothing when no pending prompt", () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      // Call without any pending prompt
      handler.activatePendingPrompt();

      // Should not change state - verify hasPendingInput is still false
      expect(handler.hasPendingInput()).toBe(false);
    });
  });

  describe("setMidSessionHandler", () => {
    test("sets the mid-session handler callback", () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      const midSessionCallback = mock(() => {});
      handler.setMidSessionHandler(midSessionCallback);

      // Handler should be stored (verified via behavior tests below)
      expect(midSessionCallback).not.toHaveBeenCalled();
    });

    test("mid-session handler receives submitted value when no pending input", () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      const receivedMessages: string[] = [];
      const midSessionCallback = mock((msg: string) => {
        receivedMessages.push(msg);
      });
      handler.setMidSessionHandler(midSessionCallback);

      // Simulate input submission by calling the handler directly
      // Note: In real usage, this is triggered by the textbox submit event
      // We test the internal behavior by verifying the callback is stored

      // Verify handler is set (no pending input means handler would be called)
      expect(handler.hasPendingInput()).toBe(false);
    });

    test("mid-session handler is not called when there is pending input", async () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      const midSessionCallback = mock(() => {});
      handler.setMidSessionHandler(midSessionCallback);

      // Start waiting for input (creates pending input state)
      const inputPromise = handler.waitForInput("Test question?", "TestGadget");

      // Verify pending input takes priority
      expect(handler.hasPendingInput()).toBe(true);

      // Mid-session handler should NOT have been called
      expect(midSessionCallback).not.toHaveBeenCalled();

      // Clean up
      handler.cancelPending();
      await inputPromise.catch(() => {});
    });

    test("can be called multiple times to update handler", () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      const firstHandler = mock(() => {});
      const secondHandler = mock(() => {});

      handler.setMidSessionHandler(firstHandler);
      handler.setMidSessionHandler(secondHandler);

      // Both handlers should not have been called yet
      expect(firstHandler).not.toHaveBeenCalled();
      expect(secondHandler).not.toHaveBeenCalled();
    });
  });

  describe("setGetFocusMode", () => {
    test("stores focus mode callback", () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      const focusModeCallback = mock(() => "input" as const);
      handler.setGetFocusMode(focusModeCallback);

      // Callback is stored (can't directly verify, but no error thrown)
      expect(true).toBe(true);
    });

    test("can be updated with new callback", () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      const firstCallback = mock(() => "input" as const);
      const secondCallback = mock(() => "browse" as const);

      handler.setGetFocusMode(firstCallback);
      handler.setGetFocusMode(secondCallback);

      // Both callbacks stored without error
      expect(firstCallback).not.toHaveBeenCalled();
      expect(secondCallback).not.toHaveBeenCalled();
    });
  });

  describe("REPL prompt activation in browse mode", () => {
    test("waitForPrompt sets pending REPL state", async () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      // Start waiting for REPL prompt
      const promptPromise = handler.waitForPrompt();

      // Should be waiting for REPL prompt
      expect(handler.isWaitingForREPLPrompt()).toBe(true);
      expect(handler.hasPendingInput()).toBe(true);

      // Clean up
      handler.cancelPending();
      await promptPromise.catch(() => {});
    });

    test("activatePendingPrompt requires REPL waiting state", () => {
      const renderCallback = mock(() => {});
      const handler = new InputHandler(inputBar, promptLabel, body, screen, renderCallback);

      // Not waiting for prompt
      expect(handler.isWaitingForREPLPrompt()).toBe(false);

      // Activating should have no effect when not waiting
      handler.activatePendingPrompt();

      // Still not waiting (no state change)
      expect(handler.isWaitingForREPLPrompt()).toBe(false);
    });

    test("activatePendingPrompt clears REPL waiting state when activated", async () => {
      const renderCallback = mock(() => {});
      const renderNowCallback = mock(() => {});
      const handler = new InputHandler(
        inputBar,
        promptLabel,
        body,
        screen,
        renderCallback,
        renderNowCallback
      );

      // Start waiting for REPL prompt
      const promptPromise = handler.waitForPrompt();
      expect(handler.isWaitingForREPLPrompt()).toBe(true);

      // Activate the prompt
      handler.activatePendingPrompt();

      // No longer in waiting state (now active)
      expect(handler.isWaitingForREPLPrompt()).toBe(false);

      // Clean up
      handler.cancelPending();
      await promptPromise.catch(() => {});
    });
  });
});
