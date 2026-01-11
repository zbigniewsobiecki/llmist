import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TUIController } from "./controller.js";

describe("TUIController", () => {
  describe("initial state", () => {
    test("starts in browse mode", () => {
      const controller = new TUIController();
      expect(controller.getFocusMode()).toBe("browse");
    });

    test("starts in full content filter mode", () => {
      const controller = new TUIController();
      expect(controller.getContentFilterMode()).toBe("full");
    });

    test("starts not aborted", () => {
      const controller = new TUIController();
      expect(controller.isAborted()).toBe(false);
    });
  });

  describe("focus mode transitions", () => {
    test("toggleFocusMode switches browse <-> input", () => {
      const controller = new TUIController();
      expect(controller.getFocusMode()).toBe("browse");

      controller.toggleFocusMode();
      expect(controller.getFocusMode()).toBe("input");

      controller.toggleFocusMode();
      expect(controller.getFocusMode()).toBe("browse");
    });

    test("toggleFocusMode fires callback", () => {
      const callback = vi.fn(() => {});
      const controller = new TUIController({
        onFocusModeChange: callback,
      });

      controller.toggleFocusMode();

      expect(callback).toHaveBeenCalledWith("input");
    });

    test("setFocusMode fires callback on change", () => {
      const callback = vi.fn(() => {});
      const controller = new TUIController({
        onFocusModeChange: callback,
      });

      controller.setFocusMode("input");

      expect(callback).toHaveBeenCalledWith("input");
    });

    test("setFocusMode does not fire callback when unchanged", () => {
      const callback = vi.fn(() => {});
      const controller = new TUIController({
        onFocusModeChange: callback,
      });

      controller.setFocusMode("browse"); // Already in browse

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("content filter mode transitions", () => {
    test("toggleContentFilterMode fires callback", () => {
      const callback = vi.fn(() => {});
      const controller = new TUIController({
        onContentFilterModeChange: callback,
      });

      controller.toggleContentFilterMode();

      expect(callback).toHaveBeenCalledWith("focused");
    });

    test("focused mode also fires focus mode callback", () => {
      const focusCallback = vi.fn(() => {});
      const controller = new TUIController({
        onFocusModeChange: focusCallback,
      });

      controller.toggleContentFilterMode();

      expect(focusCallback).toHaveBeenCalledWith("input");
    });
  });

  describe("AskUser mode stack", () => {
    test("pushInputMode fires callback when mode changes", () => {
      const callback = vi.fn(() => {});
      const controller = new TUIController({
        onFocusModeChange: callback,
      });
      expect(controller.getFocusMode()).toBe("browse");

      controller.pushInputMode();

      expect(callback).toHaveBeenCalledWith("input");
    });

    test("popInputMode fires callback when restoring browse", () => {
      const callback = vi.fn(() => {});
      const controller = new TUIController({
        onFocusModeChange: callback,
      });

      controller.pushInputMode();
      callback.mockClear();

      controller.popInputMode();

      expect(callback).toHaveBeenCalledWith("browse");
    });

    test("pushInputMode from input does not fire callback", () => {
      const callback = vi.fn(() => {});
      const controller = new TUIController({
        onFocusModeChange: callback,
      });

      controller.setFocusMode("input");
      callback.mockClear();

      controller.pushInputMode();

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("Ctrl+C handling", () => {
    test("first press returns show_hint", () => {
      const controller = new TUIController();
      expect(controller.handleCtrlC()).toBe("show_hint");
    });

    test("double press within window returns quit", () => {
      const controller = new TUIController();

      controller.handleCtrlC(); // first
      expect(controller.handleCtrlC()).toBe("quit"); // second (immediate)
    });

    test("double press triggers onQuit callback", () => {
      const onQuit = vi.fn(() => {});
      const controller = new TUIController({ onQuit });

      controller.handleCtrlC();
      controller.handleCtrlC();

      expect(onQuit).toHaveBeenCalledTimes(1);
    });

    test("first press does not trigger onQuit callback", () => {
      const onQuit = vi.fn(() => {});
      const controller = new TUIController({ onQuit });

      controller.handleCtrlC();

      expect(onQuit).not.toHaveBeenCalled();
    });

    test("double press outside window returns show_hint", async () => {
      const controller = new TUIController();

      controller.handleCtrlC();

      // Wait for window to expire (1s + buffer)
      await new Promise((r) => setTimeout(r, 1100));

      expect(controller.handleCtrlC()).toBe("show_hint");
    });
  });

  describe("abort management", () => {
    test("delegates getAbortSignal to AbortManager", () => {
      const controller = new TUIController();
      const signal = controller.getAbortSignal();

      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
    });

    test("delegates abort to AbortManager", () => {
      const controller = new TUIController();
      const signal = controller.getAbortSignal();

      controller.abort();

      expect(signal.aborted).toBe(true);
      expect(controller.isAborted()).toBe(true);
    });

    test("delegates resetAbort to AbortManager", () => {
      const controller = new TUIController();
      controller.getAbortSignal();
      controller.abort();

      controller.resetAbort();

      expect(controller.isAborted()).toBe(false);
    });
  });

  describe("callback registration", () => {
    test("onQuit returns this for chaining", () => {
      const controller = new TUIController();
      const result = controller.onQuit(() => {});

      expect(result).toBe(controller);
    });

    test("onCancel returns this for chaining", () => {
      const controller = new TUIController();
      const result = controller.onCancel(() => {});

      expect(result).toBe(controller);
    });

    test("onMidSessionInput returns this for chaining", () => {
      const controller = new TUIController();
      const result = controller.onMidSessionInput(() => {});

      expect(result).toBe(controller);
    });

    test("triggerCancel calls onCancel callback", () => {
      const onCancel = vi.fn(() => {});
      const controller = new TUIController();
      controller.onCancel(onCancel);

      controller.triggerCancel();

      expect(onCancel).toHaveBeenCalled();
    });

    test("triggerMidSessionInput calls callback with message", () => {
      const callback = vi.fn(() => {});
      const controller = new TUIController();
      controller.onMidSessionInput(callback);

      controller.triggerMidSessionInput("hello world");

      expect(callback).toHaveBeenCalledWith("hello world");
    });
  });
});
