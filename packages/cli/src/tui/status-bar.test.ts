import { Readable, Writable } from "node:stream";
import { Box, NodeRuntime, Screen, setRuntime } from "@unblessed/node";
import { ExecutionTree } from "llmist";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { StatusBar } from "./status-bar.js";

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
let statusBox: Box;
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

describe("StatusBar", () => {
  describe("constructor", () => {
    test("initializes with provided model", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      const metrics = bar.getMetrics();
      expect(metrics.model).toBe("test-model");
    });

    test("initializes with zero metrics", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      const metrics = bar.getMetrics();
      expect(metrics.inputTokens).toBe(0);
      expect(metrics.outputTokens).toBe(0);
      expect(metrics.cachedTokens).toBe(0);
      expect(metrics.cost).toBe(0);
      expect(metrics.iteration).toBe(0);
    });

    test("sets start time", () => {
      const renderCallback = vi.fn(() => {});
      const before = Date.now();
      const bar = new StatusBar(statusBox, "test-model", renderCallback);
      const after = Date.now();

      const metrics = bar.getMetrics();
      expect(metrics.startTime).toBeGreaterThanOrEqual(before);
      expect(metrics.startTime).toBeLessThanOrEqual(after);
    });

    test("calls render callback on init", () => {
      const renderCallback = vi.fn(() => {});
      new StatusBar(statusBox, "test-model", renderCallback);

      expect(renderCallback).toHaveBeenCalled();
    });
  });

  describe("focus mode", () => {
    test("defaults to browse mode", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      expect(bar.getFocusMode()).toBe("browse");
    });

    test("setFocusMode updates the mode", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.setFocusMode("input");
      expect(bar.getFocusMode()).toBe("input");

      bar.setFocusMode("browse");
      expect(bar.getFocusMode()).toBe("browse");
    });

    test("setFocusMode uses immediate render", () => {
      const renderCallback = vi.fn(() => {});
      const renderNowCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback, renderNowCallback);

      // Clear initial call counts
      renderNowCallback.mockClear();

      bar.setFocusMode("input");
      expect(renderNowCallback).toHaveBeenCalled();
    });

    test("browse mode shows BROWSE indicator", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.setFocusMode("browse");

      const content = statusBox.getContent();
      expect(content).toContain("BROWSE");
    });

    test("input mode shows no indicator (default state)", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.setFocusMode("input");

      // Input mode is the default - no badge shown
      const content = statusBox.getContent();
      expect(content).not.toContain("INPUT");
      expect(content).not.toContain("BROWSE");
    });
  });

  describe("call lifecycle", () => {
    test("startCall increments iteration", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      expect(bar.getMetrics().iteration).toBe(0);

      bar.startCall("new-model", 100);
      expect(bar.getMetrics().iteration).toBe(1);

      bar.startCall("new-model", 200);
      expect(bar.getMetrics().iteration).toBe(2);
    });

    test("startCall updates model", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "old-model", renderCallback);

      bar.startCall("new-model", 100);
      expect(bar.getMetrics().model).toBe("new-model");
    });

    test("endCall accumulates tokens and cost", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.endCall(100, 50, 20, 0.01);

      const metrics = bar.getMetrics();
      expect(metrics.inputTokens).toBe(100);
      expect(metrics.outputTokens).toBe(50);
      expect(metrics.cachedTokens).toBe(20);
      expect(metrics.cost).toBe(0.01);
    });

    test("multiple endCalls accumulate metrics", () => {
      const renderCallback = vi.fn(() => {});
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
      const renderCallback = vi.fn(() => {});
      const renderNowCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback, renderNowCallback);

      // Clear initial call
      renderNowCallback.mockClear();

      bar.updateStreaming(100);
      expect(renderNowCallback).toHaveBeenCalled();
    });
  });

  describe("gadget cost tracking", () => {
    test("addGadgetCost adds to total cost", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.addGadgetCost(0.05);
      expect(bar.getMetrics().cost).toBe(0.05);

      bar.addGadgetCost(0.03);
      expect(bar.getMetrics().cost).toBe(0.08);
    });

    test("addGadgetCost ignores zero or negative costs", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.addGadgetCost(0);
      expect(bar.getMetrics().cost).toBe(0);

      bar.addGadgetCost(-1);
      expect(bar.getMetrics().cost).toBe(0);
    });
  });

  describe("activity tracking", () => {
    test("startLLMCall adds to active calls", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.startLLMCall("#1", "claude-sonnet");

      const content = statusBox.getContent();
      expect(content).toContain("#1");
    });

    test("endLLMCall removes from active calls", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.startLLMCall("#1", "claude-sonnet");
      bar.endLLMCall("#1");

      const content = statusBox.getContent();
      // After ending, the label should no longer appear in activity section
      // (the status bar still shows other info)
      expect(content).not.toContain("sonnet");
    });

    test("startGadget adds to active gadgets", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.startGadget("ReadFile");

      const content = statusBox.getContent();
      expect(content).toContain("ReadFile");
    });

    test("endGadget removes from active gadgets", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.startGadget("ReadFile");
      bar.endGadget("ReadFile");

      const content = statusBox.getContent();
      expect(content).not.toContain("ReadFile");
    });

    test("clearActivity removes all activity", () => {
      const renderCallback = vi.fn(() => {});
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
      const renderCallback = vi.fn(() => {});
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

  describe("setProfiles", () => {
    test("selects first profile when initialProfile is undefined", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.setProfiles(["agent", "news", "code"]);

      expect(bar.getCurrentProfile()).toBe("agent");
    });

    test("selects correct profile when initialProfile matches", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.setProfiles(["agent", "news", "code"], "news");

      expect(bar.getCurrentProfile()).toBe("news");
    });

    test("selects first profile when initialProfile does not match any", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.setProfiles(["agent", "news", "code"], "nonexistent");

      expect(bar.getCurrentProfile()).toBe("agent");
    });

    test("displays current profile in status bar", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.setProfiles(["agent", "news", "code"], "code");

      const content = statusBox.getContent();
      expect(content).toContain("code");
    });

    test("cycles to next profile with cycleProfile", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.setProfiles(["agent", "news", "code"], "agent");
      expect(bar.getCurrentProfile()).toBe("agent");

      bar.cycleProfile();
      expect(bar.getCurrentProfile()).toBe("news");

      bar.cycleProfile();
      expect(bar.getCurrentProfile()).toBe("code");

      bar.cycleProfile();
      expect(bar.getCurrentProfile()).toBe("agent"); // wraps around
    });
  });

  describe("subscribeToTree", () => {
    test("clears all activity state when subscribing to new tree", () => {
      const renderCallback = vi.fn(() => {});
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
      const renderCallback = vi.fn(() => {});
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
      const renderCallback = vi.fn(() => {});
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

  describe("content filter mode", () => {
    test("defaults to full mode", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      expect(bar.getContentFilterMode()).toBe("full");
    });

    test("setContentFilterMode updates the mode", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.setContentFilterMode("focused");
      expect(bar.getContentFilterMode()).toBe("focused");

      bar.setContentFilterMode("full");
      expect(bar.getContentFilterMode()).toBe("full");
    });

    test("setContentFilterMode uses immediate render", () => {
      const renderCallback = vi.fn(() => {});
      const renderNowCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback, renderNowCallback);

      renderNowCallback.mockClear();
      bar.setContentFilterMode("focused");

      expect(renderNowCallback).toHaveBeenCalled();
    });

    test("focused content mode hides BROWSE badge even in browse focus mode", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      // Set browse focus mode but focused content mode
      bar.setFocusMode("browse");
      bar.setContentFilterMode("focused");

      const content = statusBox.getContent();
      expect(content).not.toContain("BROWSE");
    });

    test("browse mode shows BROWSE badge when content filter is full", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.setFocusMode("browse");
      bar.setContentFilterMode("full");

      const content = statusBox.getContent();
      expect(content).toContain("BROWSE");
    });
  });

  describe("streaming token display", () => {
    test("shows tilde prefix on input tokens during streaming", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      // startCall sets isStreaming=true and streamingInputTokens
      bar.startCall("test-model", 500);

      const content = statusBox.getContent();
      // Input tokens with streaming prefix ~
      expect(content).toContain("~500");
    });

    test("shows tilde prefix on output tokens during streaming", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.startCall("test-model", 100);
      bar.updateStreaming(200);

      const content = statusBox.getContent();
      // Output tokens during streaming have ~ prefix
      expect(content).toContain("~200");
    });

    test("no tilde prefix after call ends", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.startCall("test-model", 100);
      bar.endCall(100, 50, 0, 0.001);

      const content = statusBox.getContent();
      expect(content).not.toContain("~100");
      expect(content).not.toContain("~50");
    });
  });

  describe("reasoning tokens display", () => {
    test("shows reasoning tokens when present", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      // endCall with reasoningTokens parameter
      bar.endCall(100, 50, 0, 0.001, 30);

      const content = statusBox.getContent();
      expect(content).toContain("30");
    });

    test("does not show reasoning tokens section when zero", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.endCall(100, 50, 0, 0.001, 0);

      const content = statusBox.getContent();
      // 💭 emoji is only shown when reasoning tokens > 0
      expect(content).not.toContain("💭");
    });

    test("accumulates reasoning tokens across calls", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.endCall(100, 50, 0, 0.001, 20);
      bar.endCall(100, 50, 0, 0.001, 15);

      expect(bar.getMetrics().reasoningTokens ?? 0).toBe(35);
    });
  });

  describe("rate limiting display", () => {
    test("showThrottling displays daily limit message", () => {
      const renderCallback = vi.fn(() => {});
      const renderNowCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback, renderNowCallback);

      bar.showThrottling(86400000, { daily: true });

      const content = statusBox.getContent();
      expect(content).toContain("Daily limit");
      expect(content).toContain("midnight UTC");
    });

    test("showThrottling displays RPM countdown with reason", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.showThrottling(5000, { rpm: true });

      const content = statusBox.getContent();
      expect(content).toContain("Throttled 5s");
      expect(content).toContain("(RPM)");
    });

    test("showThrottling displays TPM countdown with reason", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.showThrottling(3000, { tpm: true });

      const content = statusBox.getContent();
      expect(content).toContain("Throttled 3s");
      expect(content).toContain("(TPM)");
    });

    test("showThrottling with no specific reason shows no reason suffix", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.showThrottling(2000);

      const content = statusBox.getContent();
      expect(content).toContain("Throttled 2s");
      expect(content).not.toContain("(RPM)");
      expect(content).not.toContain("(TPM)");
    });

    test("clearThrottling removes throttle indicator", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.showThrottling(5000, { rpm: true });
      bar.clearThrottling();

      const content = statusBox.getContent();
      expect(content).not.toContain("Throttled");
    });

    test("showThrottling uses immediate render", () => {
      const renderCallback = vi.fn(() => {});
      const renderNowCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback, renderNowCallback);

      renderNowCallback.mockClear();
      bar.showThrottling(5000);

      expect(renderNowCallback).toHaveBeenCalled();
    });
  });

  describe("retry display", () => {
    test("showRetry displays attempt number and total", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.showRetry(2, 1); // attempt 2, 1 retry left → total = 3

      const content = statusBox.getContent();
      expect(content).toContain("Retry 2/3");
    });

    test("clearRetry removes retry indicator", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.showRetry(1, 2);
      bar.clearRetry();

      const content = statusBox.getContent();
      expect(content).not.toContain("Retry");
    });

    test("showRetry uses immediate render", () => {
      const renderCallback = vi.fn(() => {});
      const renderNowCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback, renderNowCallback);

      renderNowCallback.mockClear();
      bar.showRetry(1, 2);

      expect(renderNowCallback).toHaveBeenCalled();
    });
  });

  describe("multiple gadgets truncation", () => {
    test("shows up to 3 gadgets inline", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.startGadget("ReadFile");
      bar.startGadget("WriteFile");
      bar.startGadget("BrowseWeb");

      const content = statusBox.getContent();
      expect(content).toContain("ReadFile");
      expect(content).toContain("WriteFile");
      expect(content).toContain("BrowseWeb");
      expect(content).not.toContain("+");

      bar.clearActivity();
    });

    test("shows +N for gadgets beyond 3", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.startGadget("ReadFile");
      bar.startGadget("WriteFile");
      bar.startGadget("BrowseWeb");
      bar.startGadget("RunCommand");

      const content = statusBox.getContent();
      expect(content).toContain("+1");

      bar.clearActivity();
    });

    test("shows correct +N count for many gadgets", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.startGadget("Gadget1");
      bar.startGadget("Gadget2");
      bar.startGadget("Gadget3");
      bar.startGadget("Gadget4");
      bar.startGadget("Gadget5");

      const content = statusBox.getContent();
      expect(content).toContain("+2");

      bar.clearActivity();
    });
  });

  describe("profile display truncation", () => {
    test("truncates profiles longer than 12 chars with ellipsis", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.setProfiles(["a-very-long-profile-name"]);

      const content = statusBox.getContent();
      // Should be truncated to 11 chars + ellipsis
      expect(content).toContain("a-very-long…");
      expect(content).not.toContain("a-very-long-profile-name");
    });

    test("does not truncate profiles 12 chars or shorter", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.setProfiles(["twelve-chars"]); // exactly 12 chars

      const content = statusBox.getContent();
      expect(content).toContain("twelve-chars");
      expect(content).not.toContain("…");
    });
  });

  describe("selection debug callback", () => {
    test("setSelectionDebugCallback shows debug info in status bar", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.setSelectionDebugCallback(() => ({
        index: 2,
        total: 10,
      }));

      // Trigger a render
      bar.startCall("test-model", 0);

      const content = statusBox.getContent();
      expect(content).toContain("sel:2/10");
    });

    test("setSelectionDebugCallback shows node type when provided", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.setSelectionDebugCallback(() => ({
        index: 0,
        total: 5,
        nodeType: "llm_call",
      }));

      bar.startCall("test-model", 0);

      const content = statusBox.getContent();
      expect(content).toContain("[llm_call]");
    });

    test("setSelectionDebugCallback shows no node type when not provided", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.setSelectionDebugCallback(() => ({
        index: 1,
        total: 3,
      }));

      bar.startCall("test-model", 0);

      const content = statusBox.getContent();
      expect(content).toContain("sel:1/3");
      // No node type bracket suffix after the debug string
      expect(content).not.toMatch(/sel:1\/3 \[/);
    });
  });

  describe("cost display", () => {
    test("shows cost with correct precision for small values", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.endCall(100, 50, 0, 0.00012);

      const content = statusBox.getContent();
      // formatCost(0.00012) = "0.00012" (5 decimal places for < 0.001)
      expect(content).toContain("0.00012");
    });

    test("shows cost with correct precision for medium values", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.endCall(100, 50, 0, 0.123);

      const content = statusBox.getContent();
      // formatCost(0.123) = "0.123" (3 decimal places for < 1)
      expect(content).toContain("0.123");
    });

    test("shows cost with 2 decimal places for values >= 1", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.endCall(100, 50, 0, 1.5);

      const content = statusBox.getContent();
      // formatCost(1.5) = "1.50"
      expect(content).toContain("1.50");
    });

    test("does not show cost section when cost is zero", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      // No calls made, cost stays at 0
      const content = statusBox.getContent();
      expect(content).not.toContain("$");
    });
  });

  describe("multiple LLM calls grouped by model", () => {
    test("groups multiple calls by model in activity section", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      // Start two LLM calls with the same model
      bar.startLLMCall("#1", "anthropic:claude-sonnet-4-5");
      bar.startLLMCall("#2", "anthropic:claude-sonnet-4-5");

      const content = statusBox.getContent();
      // Both labels should appear
      expect(content).toContain("#1");
      expect(content).toContain("#2");

      bar.clearActivity();
    });

    test("shows multiple model types separately in activity section", () => {
      const renderCallback = vi.fn(() => {});
      const bar = new StatusBar(statusBox, "test-model", renderCallback);

      bar.startLLMCall("#1", "anthropic:claude-sonnet-4-5");
      bar.startLLMCall("#2", "gemini:gemini-2.5-flash");

      const content = statusBox.getContent();
      // Both shortened model names should appear
      expect(content).toContain("sonnet-4-5");
      expect(content).toContain("2.5-flash");

      bar.clearActivity();
    });
  });
});
