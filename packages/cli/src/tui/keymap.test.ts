import { describe, expect, test, vi } from "vitest";
import { type KeyAction, KeyboardManager } from "./keymap.js";
import type { ContentFilterMode, FocusMode } from "./types.js";

/**
 * Creates a minimal mock screen that captures key handlers.
 */
function createMockScreen() {
  const handlers = new Map<string, () => void>();

  return {
    key: (keys: string[], handler: () => void) => {
      for (const key of keys) {
        handlers.set(key, handler);
      }
    },
    simulateKey: (key: string) => {
      handlers.get(key)?.();
    },
    render: () => {},
  };
}

interface MockConfig {
  focusMode?: FocusMode;
  contentFilterMode?: ContentFilterMode;
  isWaitingForREPLPrompt?: boolean;
  hasPendingInput?: boolean;
  isBlockExpanded?: boolean;
}

function createKeyboardManager(
  screen: ReturnType<typeof createMockScreen>,
  onAction: (action: KeyAction) => void,
  config: MockConfig = {},
) {
  const manager = new KeyboardManager({
    screen: screen as any,
    getFocusMode: () => config.focusMode ?? "browse",
    getContentFilterMode: () => config.contentFilterMode ?? "full",
    isWaitingForREPLPrompt: () => config.isWaitingForREPLPrompt ?? false,
    hasPendingInput: () => config.hasPendingInput ?? false,
    isBlockExpanded: () => config.isBlockExpanded ?? false,
    onAction,
  });
  manager.setup();
  return manager;
}

describe("KeyboardManager", () => {
  describe("Ctrl+C handling", () => {
    test("dispatches ctrl_c action", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction);

      screen.simulateKey("C-c");

      expect(onAction).toHaveBeenCalledWith({ type: "ctrl_c" });
    });
  });

  describe("focus mode toggle", () => {
    test("Ctrl+B dispatches toggle_focus_mode", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction);

      screen.simulateKey("C-b");

      expect(onAction).toHaveBeenCalledWith({ type: "toggle_focus_mode" });
    });
  });

  describe("content filter toggle", () => {
    test("Ctrl+K dispatches toggle_content_filter", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction);

      screen.simulateKey("C-k");

      expect(onAction).toHaveBeenCalledWith({ type: "toggle_content_filter" });
    });
  });

  describe("profile cycling", () => {
    test("Ctrl+P always dispatches cycle_profile", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction);

      screen.simulateKey("C-p");

      expect(onAction).toHaveBeenCalledWith({ type: "cycle_profile" });
    });
  });

  describe("page scrolling", () => {
    test("PageUp dispatches scroll_page with direction -1", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction);

      screen.simulateKey("pageup");

      expect(onAction).toHaveBeenCalledWith({ type: "scroll_page", direction: -1 });
    });

    test("PageDown dispatches scroll_page with direction 1", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction);

      screen.simulateKey("pagedown");

      expect(onAction).toHaveBeenCalledWith({ type: "scroll_page", direction: 1 });
    });

    test("Ctrl+I dispatches scroll_page with direction -1", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction);

      screen.simulateKey("C-i");

      expect(onAction).toHaveBeenCalledWith({ type: "scroll_page", direction: -1 });
    });

    test("Ctrl+J dispatches scroll_page with direction 1", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction);

      screen.simulateKey("C-j");

      expect(onAction).toHaveBeenCalledWith({ type: "scroll_page", direction: 1 });
    });

    test("scroll works in input mode too", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction, { focusMode: "input" });

      screen.simulateKey("pageup");

      expect(onAction).toHaveBeenCalledWith({ type: "scroll_page", direction: -1 });
    });

    test("Ctrl+I/J scroll works in input mode", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction, { focusMode: "input" });

      screen.simulateKey("C-i");
      expect(onAction).toHaveBeenCalledWith({ type: "scroll_page", direction: -1 });

      onAction.mockClear();
      screen.simulateKey("C-j");
      expect(onAction).toHaveBeenCalledWith({ type: "scroll_page", direction: 1 });
    });
  });

  describe("line scrolling in focused mode", () => {
    test("up/k dispatches scroll_line with direction -1 in focused content mode", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction, { contentFilterMode: "focused" });

      screen.simulateKey("up");

      expect(onAction).toHaveBeenCalledWith({ type: "scroll_line", direction: -1 });
    });

    test("down/j dispatches scroll_line with direction 1 in focused content mode", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction, { contentFilterMode: "focused" });

      screen.simulateKey("down");

      expect(onAction).toHaveBeenCalledWith({ type: "scroll_line", direction: 1 });
    });

    test("k dispatches scroll_line in focused content mode", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction, { contentFilterMode: "focused" });

      screen.simulateKey("k");

      expect(onAction).toHaveBeenCalledWith({ type: "scroll_line", direction: -1 });
    });

    test("j dispatches scroll_line in focused content mode", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction, { contentFilterMode: "focused" });

      screen.simulateKey("j");

      expect(onAction).toHaveBeenCalledWith({ type: "scroll_line", direction: 1 });
    });

    test("line scrolling takes precedence over navigation in focused mode", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      // Even if focus mode is "browse", focused content mode triggers scroll_line
      createKeyboardManager(screen, onAction, {
        focusMode: "browse",
        contentFilterMode: "focused",
      });

      screen.simulateKey("up");

      expect(onAction).toHaveBeenCalledWith({ type: "scroll_line", direction: -1 });
      expect(onAction).not.toHaveBeenCalledWith({
        type: "navigation",
        action: "select_previous",
      });
    });
  });

  describe("navigation keys", () => {
    test("up/k dispatches select_previous in browse mode", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction, { focusMode: "browse" });

      screen.simulateKey("up");

      expect(onAction).toHaveBeenCalledWith({
        type: "navigation",
        action: "select_previous",
      });
    });

    test("down/j dispatches select_next in browse mode", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction, { focusMode: "browse" });

      screen.simulateKey("down");

      expect(onAction).toHaveBeenCalledWith({
        type: "navigation",
        action: "select_next",
      });
    });

    test("navigation keys are blocked in input mode", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction, { focusMode: "input" });

      screen.simulateKey("up");
      screen.simulateKey("down");
      screen.simulateKey("j");
      screen.simulateKey("k");

      expect(onAction).not.toHaveBeenCalled();
    });

    test("enter/space dispatches toggle_expand in browse mode", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction, { focusMode: "browse" });

      screen.simulateKey("enter");

      expect(onAction).toHaveBeenCalledWith({
        type: "navigation",
        action: "toggle_expand",
      });
    });

    test("h dispatches collapse in browse mode", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction, { focusMode: "browse" });

      screen.simulateKey("h");

      expect(onAction).toHaveBeenCalledWith({
        type: "navigation",
        action: "collapse",
      });
    });

    test("home/g dispatches select_first in browse mode", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction, { focusMode: "browse" });

      screen.simulateKey("home");

      expect(onAction).toHaveBeenCalledWith({
        type: "navigation",
        action: "select_first",
      });
    });

    test("end/G dispatches select_last in browse mode", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction, { focusMode: "browse" });

      screen.simulateKey("end");

      expect(onAction).toHaveBeenCalledWith({
        type: "navigation",
        action: "select_last",
      });
    });
  });

  describe("raw viewer keys", () => {
    test("r dispatches raw_viewer request in browse mode", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction, { focusMode: "browse" });

      screen.simulateKey("r");

      expect(onAction).toHaveBeenCalledWith({
        type: "raw_viewer",
        mode: "request",
      });
    });

    test("S-r dispatches raw_viewer response in browse mode", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction, { focusMode: "browse" });

      screen.simulateKey("S-r");

      expect(onAction).toHaveBeenCalledWith({
        type: "raw_viewer",
        mode: "response",
      });
    });

    test("raw viewer keys are blocked in input mode", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction, { focusMode: "input" });

      screen.simulateKey("r");
      screen.simulateKey("S-r");

      expect(onAction).not.toHaveBeenCalled();
    });
  });

  describe("escape handling", () => {
    test("escape dispatches cancel when not in pending input", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction, { hasPendingInput: false });

      screen.simulateKey("escape");

      expect(onAction).toHaveBeenCalledWith({ type: "cancel" });
    });

    test("escape is blocked when pending input", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction, { hasPendingInput: true });

      screen.simulateKey("escape");

      expect(onAction).not.toHaveBeenCalled();
    });

    test("escape dispatches collapse when block is expanded", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      createKeyboardManager(screen, onAction, {
        focusMode: "browse",
        isBlockExpanded: true,
      });

      screen.simulateKey("escape");

      expect(onAction).toHaveBeenCalledWith({
        type: "navigation",
        action: "collapse",
      });
    });
  });

  describe("forwarded keys from InputHandler", () => {
    test("handleForwardedKey C-c dispatches ctrl_c", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      const manager = createKeyboardManager(screen, onAction);

      manager.handleForwardedKey("C-c");

      expect(onAction).toHaveBeenCalledWith({ type: "ctrl_c" });
    });

    test("handleForwardedKey C-b dispatches toggle_focus_mode", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      const manager = createKeyboardManager(screen, onAction);

      manager.handleForwardedKey("C-b");

      expect(onAction).toHaveBeenCalledWith({ type: "toggle_focus_mode" });
    });

    test("handleForwardedKey C-k dispatches toggle_content_filter", () => {
      const onAction = vi.fn(() => {});
      const screen = createMockScreen();
      const manager = createKeyboardManager(screen, onAction);

      manager.handleForwardedKey("C-k");

      expect(onAction).toHaveBeenCalledWith({ type: "toggle_content_filter" });
    });
  });
});
