import { Readable, Writable } from "node:stream";
import { type Box, NodeRuntime, Screen, setRuntime } from "@unblessed/node";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { showApprovalDialog } from "./approval-dialog.js";
import type { ApprovalContext } from "./types.js";

// TUI tests use mock streams - no real TTY needed

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

let screen: Screen;
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
});

afterAll(() => {
  if (screen) {
    screen.destroy();
  }
});

/**
 * Helper: call showApprovalDialog and capture the dialog Box synchronously.
 * The Promise constructor runs synchronously, so the Box is added to
 * screen.children before showApprovalDialog returns.
 */
function createDialog(context: ApprovalContext): { promise: Promise<string>; dialog: Box } {
  const beforeCount = (screen as unknown as { children: unknown[] }).children.length;
  const promise = showApprovalDialog(screen, context);
  const dialog = (screen as unknown as { children: Box[] }).children[beforeCount];
  return { promise, dialog };
}

const minimalContext: ApprovalContext = {
  gadgetName: "WriteFile",
  parameters: {},
};

describe("showApprovalDialog", () => {
  describe("keypress responses", () => {
    test("resolves with 'yes' when y is pressed", async () => {
      const { promise, dialog } = createDialog(minimalContext);
      dialog.emit("keypress", "y", { name: "y" });
      expect(await promise).toBe("yes");
    });

    test("resolves with 'no' when n is pressed", async () => {
      const { promise, dialog } = createDialog(minimalContext);
      dialog.emit("keypress", "n", { name: "n" });
      expect(await promise).toBe("no");
    });

    test("resolves with 'always' when a is pressed", async () => {
      const { promise, dialog } = createDialog(minimalContext);
      dialog.emit("keypress", "a", { name: "a" });
      expect(await promise).toBe("always");
    });

    test("resolves with 'deny' when d is pressed", async () => {
      const { promise, dialog } = createDialog(minimalContext);
      dialog.emit("keypress", "d", { name: "d" });
      expect(await promise).toBe("deny");
    });

    test("resolves with 'cancel' when escape is pressed", async () => {
      const { promise, dialog } = createDialog(minimalContext);
      dialog.emit("keypress", "", { name: "escape" });
      expect(await promise).toBe("cancel");
    });

    test("unknown keys do not resolve the dialog", async () => {
      const { promise, dialog } = createDialog(minimalContext);
      dialog.emit("keypress", "x", { name: "x" });
      dialog.emit("keypress", "z", { name: "z" });

      let resolved = false;
      promise.then(() => {
        resolved = true;
      });

      // Flush microtasks without resolving
      await Promise.resolve();
      expect(resolved).toBe(false);

      // Clean up
      dialog.emit("keypress", "n", { name: "n" });
      await promise;
    });
  });

  describe("dialog content (buildDialogContent)", () => {
    test("includes gadget name in title", async () => {
      const context: ApprovalContext = { gadgetName: "RunCommand", parameters: {} };
      const { promise, dialog } = createDialog(context);
      expect(dialog.getContent()).toContain("RunCommand");
      dialog.emit("keypress", "n", { name: "n" });
      await promise;
    });

    test("shows Parameters section when parameters are provided", async () => {
      const context: ApprovalContext = {
        gadgetName: "WriteFile",
        parameters: { path: "/tmp/test.txt", content: "hello" },
      };
      const { promise, dialog } = createDialog(context);
      const content = dialog.getContent();
      expect(content).toContain("Parameters:");
      expect(content).toContain("path");
      expect(content).toContain("content");
      dialog.emit("keypress", "n", { name: "n" });
      await promise;
    });

    test("omits Parameters section when parameters object is empty", async () => {
      const context: ApprovalContext = { gadgetName: "TestGadget", parameters: {} };
      const { promise, dialog } = createDialog(context);
      expect(dialog.getContent()).not.toContain("Parameters:");
      dialog.emit("keypress", "n", { name: "n" });
      await promise;
    });

    test("shows Preview section when preview is provided", async () => {
      const context: ApprovalContext = {
        gadgetName: "WriteFile",
        parameters: {},
        preview: "line1\nline2\nline3",
      };
      const { promise, dialog } = createDialog(context);
      const content = dialog.getContent();
      expect(content).toContain("Preview:");
      expect(content).toContain("line1");
      dialog.emit("keypress", "n", { name: "n" });
      await promise;
    });

    test("omits Preview section when no preview given", async () => {
      const context: ApprovalContext = { gadgetName: "TestGadget", parameters: {} };
      const { promise, dialog } = createDialog(context);
      expect(dialog.getContent()).not.toContain("Preview:");
      dialog.emit("keypress", "n", { name: "n" });
      await promise;
    });

    test("truncates preview to first 10 lines", async () => {
      const lines = Array.from({ length: 15 }, (_, i) => `line${i + 1}`).join("\n");
      const context: ApprovalContext = { gadgetName: "WriteFile", parameters: {}, preview: lines };
      const { promise, dialog } = createDialog(context);
      const content = dialog.getContent();
      expect(content).toContain("line10");
      expect(content).not.toContain("line11");
      expect(content).toContain("...");
      dialog.emit("keypress", "n", { name: "n" });
      await promise;
    });

    test("does not show ellipsis when preview is exactly 10 lines", async () => {
      const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n");
      const context: ApprovalContext = { gadgetName: "WriteFile", parameters: {}, preview: lines };
      const { promise, dialog } = createDialog(context);
      const content = dialog.getContent();
      expect(content).toContain("line10");
      expect(content).not.toContain("...");
      dialog.emit("keypress", "n", { name: "n" });
      await promise;
    });

    test("shows all keyboard options in dialog", async () => {
      const { promise, dialog } = createDialog(minimalContext);
      const content = dialog.getContent();
      expect(content).toContain("[y]");
      expect(content).toContain("[n]");
      expect(content).toContain("[a]");
      expect(content).toContain("[d]");
      expect(content).toContain("[ESC]");
      dialog.emit("keypress", "n", { name: "n" });
      await promise;
    });
  });

  describe("parameter formatting (formatParamValue)", () => {
    test("formats string values as-is", async () => {
      const context: ApprovalContext = {
        gadgetName: "TestGadget",
        parameters: { name: "hello" },
      };
      const { promise, dialog } = createDialog(context);
      expect(dialog.getContent()).toContain("hello");
      dialog.emit("keypress", "n", { name: "n" });
      await promise;
    });

    test("formats null as 'null'", async () => {
      const context: ApprovalContext = {
        gadgetName: "TestGadget",
        parameters: { nullParam: null },
      };
      const { promise, dialog } = createDialog(context);
      expect(dialog.getContent()).toContain("null");
      dialog.emit("keypress", "n", { name: "n" });
      await promise;
    });

    test("formats objects as JSON", async () => {
      const context: ApprovalContext = {
        gadgetName: "TestGadget",
        parameters: { config: { key: "value" } },
      };
      const { promise, dialog } = createDialog(context);
      expect(dialog.getContent()).toContain('{"key":"value"}');
      dialog.emit("keypress", "n", { name: "n" });
      await promise;
    });

    test("truncates values longer than 60 characters with ellipsis", async () => {
      const longValue = "a".repeat(70);
      const context: ApprovalContext = {
        gadgetName: "TestGadget",
        parameters: { longParam: longValue },
      };
      const { promise, dialog } = createDialog(context);
      const content = dialog.getContent();
      expect(content).toContain("…");
      expect(content).not.toContain(longValue);
      dialog.emit("keypress", "n", { name: "n" });
      await promise;
    });

    test("does not truncate values of exactly 60 characters", async () => {
      const exactValue = "b".repeat(60);
      const context: ApprovalContext = {
        gadgetName: "TestGadget",
        parameters: { exactParam: exactValue },
      };
      const { promise, dialog } = createDialog(context);
      const content = dialog.getContent();
      expect(content).not.toContain("…");
      dialog.emit("keypress", "n", { name: "n" });
      await promise;
    });
  });

  describe("content escaping (escapeContent)", () => {
    test("escapes curly braces in parameter values", async () => {
      const context: ApprovalContext = {
        gadgetName: "TestGadget",
        parameters: { param: "{value}" },
      };
      const { promise, dialog } = createDialog(context);
      // Curly braces are doubled for blessed tag escaping
      expect(dialog.getContent()).toContain("{{value}}");
      dialog.emit("keypress", "n", { name: "n" });
      await promise;
    });

    test("escapes curly braces in preview content", async () => {
      const context: ApprovalContext = {
        gadgetName: "TestGadget",
        parameters: {},
        preview: "const x = {key: 'val'};",
      };
      const { promise, dialog } = createDialog(context);
      expect(dialog.getContent()).toContain("{{key: 'val'}}");
      dialog.emit("keypress", "n", { name: "n" });
      await promise;
    });
  });
});
