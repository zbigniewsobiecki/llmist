import { describe, expect, test, beforeAll, afterAll, mock } from "bun:test";
import { Writable, Readable } from "node:stream";
import { setRuntime, NodeRuntime, Screen, Box } from "@unblessed/node";
import { StatusBar } from "./status-bar.js";
import { ExecutionTree } from "llmist";

// Skip TUI tests when not in a TTY (e.g., in CI/Turborepo)
// These tests require terminfo which may not be available in all environments
const isTTY = process.stdout.isTTY && process.stdin.isTTY;

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
let statusBox: Box;
let mockOutput: MockOutputStream;
let mockInput: MockInputStream;

beforeAll(() => {
  if (!isTTY) return;
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

  statusBox = new Box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: "100%",
    height: 1,
    tags: false,
    style: { fg: "white", bg: "black" },
  });
});

afterAll(() => {
  if (screen) {
    screen.destroy();
  }
});

describe.skipIf(!isTTY)("StatusBar", () => {
  describe("constructor", () => {
    test("initializes with provided model", () => {
      const renderCallback = mock(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      const metrics = bar.getMetrics();
      expect(metrics.model).toBe("test-model");
    });

    test("initializes with zero metrics", () => {
      const renderCallback = mock(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      const metrics = bar.getMetrics();
      expect(metrics.inputTokens).toBe(0);
      expect(metrics.outputTokens).toBe(0);
      expect(metrics.cachedTokens).toBe(0);
      expect(metrics.cost).toBe(0);
      expect(metrics.iteration).toBe(0);
    });

    test("sets start time", () => {
      const renderCallback = mock(() => {});
      const before = Date.now();
      const bar = new StatusBar(statusBox, "test-model", renderCallback);
      const after = Date.now();

      const metrics = bar.getMetrics();
      expect(metrics.startTime).toBeGreaterThanOrEqual(before);
      expect(metrics.startTime).toBeLessThanOrEqual(after);
    });

    test("calls render callback on init", () => {
      const renderCallback = mock(() => {});
      new StatusBar(statusBox, "test-model", renderCallback);

      expect(renderCallback).toHaveBeenCalled();
    });
  });

  describe("focus mode", () => {
    test("defaults to browse mode", () => {
      const renderCallback = mock(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      expect(bar.getFocusMode()).toBe("browse");
    });

    test("setFocusMode updates the mode", () => {
      const renderCallback = mock(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.setFocusMode("input");
      expect(bar.getFocusMode()).toBe("input");

      bar.setFocusMode("browse");
      expect(bar.getFocusMode()).toBe("browse");
    });

    test("setFocusMode uses immediate render", () => {
      const renderCallback = mock(() => {});
      const renderNowCallback = mock(() => {});
      const bar = new StatusBar(
        statusBox,
        "test-model",
        renderCallback,
        renderNowCallback,
      );

      // Clear initial call counts
      renderNowCallback.mockClear();

      bar.setFocusMode("input");
      expect(renderNowCallback).toHaveBeenCalled();
    });

    test("browse mode shows BROWSE indicator", () => {
      const renderCallback = mock(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.setFocusMode("browse");

      const content = statusBox.getContent();
      expect(content).toContain("BROWSE");
    });

    test("input mode shows INPUT indicator", () => {
      const renderCallback = mock(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.setFocusMode("input");

      const content = statusBox.getContent();
      expect(content).toContain("INPUT");
    });
  });

  describe("call lifecycle", () => {
    test("startCall increments iteration", () => {
      const renderCallback = mock(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      expect(bar.getMetrics().iteration).toBe(0);

      bar.startCall("new-model", 100);
      expect(bar.getMetrics().iteration).toBe(1);

      bar.startCall("new-model", 200);
      expect(bar.getMetrics().iteration).toBe(2);
    });

    test("startCall updates model", () => {
      const renderCallback = mock(() => {});
      const bar = new StatusBar(statusBox, "old-model", renderCallback);

      bar.startCall("new-model", 100);
      expect(bar.getMetrics().model).toBe("new-model");
    });

    test("endCall accumulates tokens and cost", () => {
      const renderCallback = mock(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.endCall(100, 50, 20, 0.01);

      const metrics = bar.getMetrics();
      expect(metrics.inputTokens).toBe(100);
      expect(metrics.outputTokens).toBe(50);
      expect(metrics.cachedTokens).toBe(20);
      expect(metrics.cost).toBe(0.01);
    });

    test("multiple endCalls accumulate metrics", () => {
      const renderCallback = mock(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.endCall(100, 50, 10, 0.01);
      bar.endCall(200, 100, 30, 0.02);

      const metrics = bar.getMetrics();
      expect(metrics.inputTokens).toBe(300);
      expect(metrics.outputTokens).toBe(150);
      expect(metrics.cachedTokens).toBe(40);
      expect(metrics.cost).toBe(0.03);
    });
  });

  describe("streaming updates", () => {
    test("updateStreaming uses immediate render", () => {
      const renderCallback = mock(() => {});
      const renderNowCallback = mock(() => {});
      const bar = new StatusBar(
        statusBox,
        "test-model",
        renderCallback,
        renderNowCallback,
      );

      // Clear initial call
      renderNowCallback.mockClear();

      bar.updateStreaming(100);
      expect(renderNowCallback).toHaveBeenCalled();
    });
  });

  describe("gadget cost tracking", () => {
    test("addGadgetCost adds to total cost", () => {
      const renderCallback = mock(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.addGadgetCost(0.05);
      expect(bar.getMetrics().cost).toBe(0.05);

      bar.addGadgetCost(0.03);
      expect(bar.getMetrics().cost).toBe(0.08);
    });

    test("addGadgetCost ignores zero or negative costs", () => {
      const renderCallback = mock(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.addGadgetCost(0);
      expect(bar.getMetrics().cost).toBe(0);

      bar.addGadgetCost(-1);
      expect(bar.getMetrics().cost).toBe(0);
    });
  });

  describe("activity tracking", () => {
    test("startLLMCall adds to active calls", () => {
      const renderCallback = mock(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.startLLMCall("#1", "claude-sonnet");

      const content = statusBox.getContent();
      expect(content).toContain("#1");
    });

    test("endLLMCall removes from active calls", () => {
      const renderCallback = mock(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.startLLMCall("#1", "claude-sonnet");
      bar.endLLMCall("#1");

      const content = statusBox.getContent();
      // After ending, the label should no longer appear in activity section
      // (the status bar still shows other info)
      expect(content).not.toContain("sonnet");
    });

    test("startGadget adds to active gadgets", () => {
      const renderCallback = mock(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.startGadget("ReadFile");

      const content = statusBox.getContent();
      expect(content).toContain("ReadFile");
    });

    test("endGadget removes from active gadgets", () => {
      const renderCallback = mock(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.startGadget("ReadFile");
      bar.endGadget("ReadFile");

      const content = statusBox.getContent();
      expect(content).not.toContain("ReadFile");
    });

    test("clearActivity removes all activity", () => {
      const renderCallback = mock(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.startLLMCall("#1", "claude");
      bar.startGadget("WriteFile");

      let content = statusBox.getContent();
      expect(content).toContain("#1");
      expect(content).toContain("WriteFile");

      bar.clearActivity();

      content = statusBox.getContent();
      expect(content).not.toContain("#1");
      expect(content).not.toContain("WriteFile");
    });
  });

  describe("getElapsedSeconds", () => {
    test("returns elapsed time in seconds", async () => {
      const renderCallback = mock(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      const elapsed = bar.getElapsedSeconds();
      expect(elapsed).toBeGreaterThanOrEqual(0.04);
      expect(elapsed).toBeLessThan(1);
    });
  });

  describe("estimateTokens", () => {
    test("estimates ~4 chars per token", () => {
      // "hello world" = 11 chars -> ~3 tokens
      expect(StatusBar.estimateTokens("hello world")).toBe(3);

      // 100 chars -> 25 tokens
      expect(StatusBar.estimateTokens("a".repeat(100))).toBe(25);
    });

    test("rounds up", () => {
      // 5 chars -> ceil(5/4) = 2 tokens
      expect(StatusBar.estimateTokens("hello")).toBe(2);
    });

    test("handles empty string", () => {
      expect(StatusBar.estimateTokens("")).toBe(0);
    });
  });

  describe("subscribeToTree", () => {
    test("clears all activity state when subscribing to new tree", () => {
      const renderCallback = mock(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      // Add some activity
      bar.startLLMCall("#1", "claude");
      bar.startGadget("ReadFile");

      // Verify activity is present
      let content = statusBox.getContent();
      expect(content).toContain("ReadFile");

      // Subscribe to a new tree - should clear stale activity
      const tree = new ExecutionTree();
      bar.subscribeToTree(tree);

      // Verify activity is cleared
      content = statusBox.getContent();
      expect(content).not.toContain("#1");
      expect(content).not.toContain("ReadFile");
    });

    test("previous tree subscription is unsubscribed when subscribing to new tree", () => {
      const renderCallback = mock(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      const tree1 = new ExecutionTree();
      const tree2 = new ExecutionTree();

      // Subscribe to first tree
      bar.subscribeToTree(tree1);

      // Add LLM call via first tree - should be tracked
      tree1.addLLMCall({ iteration: 0, model: "sonnet" });
      let content = statusBox.getContent();
      expect(content).toContain("#1"); // 0-indexed becomes #1 display

      // Subscribe to second tree - clears activity and unsubscribes from first
      bar.subscribeToTree(tree2);

      // Add to first tree - should NOT be tracked anymore
      tree1.addLLMCall({ iteration: 1, model: "haiku" });
      content = statusBox.getContent();
      expect(content).not.toContain("#2");

      // Add to second tree - should be tracked
      tree2.addLLMCall({ iteration: 0, model: "opus" });
      content = statusBox.getContent();
      expect(content).toContain("#1");
    });

    test("subscribeToTree returns unsubscribe function", () => {
      const renderCallback = mock(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      const tree = new ExecutionTree();
      const unsubscribe = bar.subscribeToTree(tree);

      // Should be a function
      expect(typeof unsubscribe).toBe("function");

      // Add LLM call while subscribed
      tree.addLLMCall({ iteration: 0, model: "test" });
      let content = statusBox.getContent();
      expect(content).toContain("#1");

      // Clear and unsubscribe
      bar.clearActivity();
      unsubscribe();

      // Add another LLM call after unsubscribe - should NOT be tracked
      tree.addLLMCall({ iteration: 1, model: "test" });
      content = statusBox.getContent();
      expect(content).not.toContain("#2");
    });
  });
});
