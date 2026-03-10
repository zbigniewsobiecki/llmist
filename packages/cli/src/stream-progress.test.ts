import { Writable } from "node:stream";
import type { ModelRegistry } from "llmist";
import { describe, expect, test } from "vitest";
import { StreamProgress } from "./stream-progress.js";

/**
 * Mock writable stream that captures output for testing.
 */
class MockWritableStream extends Writable {
  public output = "";

  _write(chunk: Buffer | string, _encoding: string, callback: () => void): void {
    this.output += chunk.toString();
    callback();
  }

  clear(): void {
    this.output = "";
  }
}

/**
 * Mock model registry for testing cost calculations.
 */
class MockModelRegistry implements Partial<ModelRegistry> {
  private costs: Record<string, { inputCost: number; outputCost: number }> = {};
  private contextWindows: Record<string, number> = {};

  setCost(model: string, inputCost: number, outputCost: number): void {
    this.costs[model] = { inputCost, outputCost };
  }

  setContextWindow(model: string, contextWindow: number): void {
    this.contextWindows[model] = contextWindow;
  }

  estimateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): { inputCost: number; outputCost: number; totalCost: number } | undefined {
    const costs = this.costs[model];
    if (!costs) return undefined;
    const inputCost = (inputTokens / 1_000_000) * costs.inputCost;
    const outputCost = (outputTokens / 1_000_000) * costs.outputCost;
    return { inputCost, outputCost, totalCost: inputCost + outputCost };
  }

  getModelLimits(model: string): { contextWindow: number } | undefined {
    const contextWindow = this.contextWindows[model];
    if (!contextWindow) return undefined;
    return { contextWindow };
  }
}

/**
 * Creates a StreamProgress with a mock stream for testing.
 */
function createProgress(isTTY = false, registry?: ModelRegistry): StreamProgress {
  const stream = new MockWritableStream();
  return new StreamProgress(stream, isTTY, registry);
}

describe("StreamProgress", () => {
  describe("startCall", () => {
    test("creates a new call operation by delegating to callStatsTracker", () => {
      const progress = createProgress();
      // startCall should not throw
      expect(() => progress.startCall("gpt-4", 1000)).not.toThrow();
    });

    test("tracks elapsed time after startCall", async () => {
      const progress = createProgress();
      progress.startCall("gpt-4", 1000);
      await new Promise((r) => setTimeout(r, 50));
      expect(progress.getTotalElapsedSeconds()).toBeGreaterThanOrEqual(0);
    });

    test("startCall with model updates call elapsed time tracking", async () => {
      const progress = createProgress();
      progress.startCall("claude-sonnet", 500);
      await new Promise((r) => setTimeout(r, 100));
      const elapsed = progress.getCallElapsedSeconds();
      expect(elapsed).toBeGreaterThanOrEqual(0);
    });

    test("multiple startCall calls track separate iterations", () => {
      const progress = createProgress();
      progress.startCall("gpt-4", 1000);
      progress.endCall();
      progress.startCall("gpt-4", 2000);
      progress.endCall();
      // After 2 calls, total cost starts as 0 (no registry)
      expect(progress.getTotalCost()).toBe(0);
    });
  });

  describe("endCall", () => {
    test("completes call operation without throwing", () => {
      const progress = createProgress();
      progress.startCall("gpt-4", 1000);
      expect(() => progress.endCall()).not.toThrow();
    });

    test("endCall with usage updates total cost via registry", () => {
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60); // $30/1M input, $60/1M output
      const progress = createProgress(false, registry as unknown as ModelRegistry);

      progress.startCall("gpt-4", 1000);
      progress.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      // (1000/1M * $30) + (500/1M * $60) = $0.03 + $0.03 = $0.06
      expect(progress.getTotalCost()).toBeCloseTo(0.06, 5);
    });

    test("endCall without usage does not accumulate cost", () => {
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);
      const progress = createProgress(false, registry as unknown as ModelRegistry);

      progress.startCall("gpt-4", 1000);
      progress.endCall(); // No usage

      expect(progress.getTotalCost()).toBe(0);
    });

    test("getTotalCost returns 0 when no registry provided", () => {
      const progress = createProgress();
      progress.startCall("gpt-4", 1000);
      progress.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });
      expect(progress.getTotalCost()).toBe(0);
    });
  });

  describe("gadget tracking delegation", () => {
    test("delegates addGadget to gadgetTracker", () => {
      const progress = createProgress();
      progress.addGadget("inv-1", "BrowseWeb", { url: "https://example.com" });
      const gadget = progress.getGadget("inv-1");
      expect(gadget).toBeDefined();
      expect(gadget?.name).toBe("BrowseWeb");
    });

    test("delegates getGadget to gadgetTracker", () => {
      const progress = createProgress();
      progress.addGadget("inv-2", "ReadFile");
      expect(progress.getGadget("inv-2")).toBeDefined();
    });

    test("delegates removeGadget to gadgetTracker", () => {
      const progress = createProgress();
      progress.addGadget("inv-1", "BrowseWeb");
      progress.removeGadget("inv-1");
      expect(progress.getGadget("inv-1")).toBeUndefined();
    });

    test("hasInFlightGadgets returns false when no gadgets", () => {
      const progress = createProgress();
      expect(progress.hasInFlightGadgets()).toBe(false);
    });

    test("hasInFlightGadgets returns true after addGadget", () => {
      const progress = createProgress();
      progress.addGadget("inv-1", "BrowseWeb");
      expect(progress.hasInFlightGadgets()).toBe(true);
    });

    test("hasInFlightGadgets returns false after removeGadget", () => {
      const progress = createProgress();
      progress.addGadget("inv-1", "BrowseWeb");
      progress.removeGadget("inv-1");
      expect(progress.hasInFlightGadgets()).toBe(false);
    });

    test("completeGadget marks gadget as completed", () => {
      const progress = createProgress();
      progress.addGadget("inv-1", "BrowseWeb");
      progress.completeGadget("inv-1");
      const gadget = progress.getGadget("inv-1");
      expect(gadget?.completed).toBe(true);
    });

    test("clearCompletedGadgets removes completed gadgets", () => {
      const progress = createProgress();
      progress.addGadget("inv-1", "BrowseWeb");
      progress.completeGadget("inv-1");
      progress.clearCompletedGadgets();
      expect(progress.getGadget("inv-1")).toBeUndefined();
      expect(progress.hasInFlightGadgets()).toBe(false);
    });
  });

  describe("nested operation tracking delegation", () => {
    test("delegates addNestedAgent to nestedOperationTracker", () => {
      const progress = createProgress();
      progress.addNestedAgent("agent:0", "parent-123", 1, "gpt-4", 1, { inputTokens: 5000 });
      const agent = progress.getNestedAgent("agent:0");
      expect(agent).toBeDefined();
      expect(agent?.model).toBe("gpt-4");
    });

    test("delegates updateNestedAgent to nestedOperationTracker", () => {
      const progress = createProgress();
      progress.addNestedAgent("agent:0", "parent-123", 1, "gpt-4", 1, { inputTokens: 5000 });
      progress.updateNestedAgent("agent:0", { outputTokens: 500, finishReason: "stop" });
      const agent = progress.getNestedAgent("agent:0");
      expect(agent?.outputTokens).toBe(500);
      expect(agent?.finishReason).toBe("stop");
    });

    test("delegates removeNestedAgent to nestedOperationTracker", () => {
      const progress = createProgress();
      progress.addNestedAgent("agent:0", "parent-123", 1, "gpt-4", 1);
      progress.removeNestedAgent("agent:0");
      expect(progress.getNestedAgent("agent:0")).toBeUndefined();
    });

    test("delegates addNestedGadget to nestedOperationTracker", () => {
      const progress = createProgress();
      progress.addNestedGadget("gadget-1", 1, "parent-123", "ReadFile", { path: "/tmp/test" });
      const gadget = progress.getNestedGadget("gadget-1");
      expect(gadget).toBeDefined();
      expect(gadget?.name).toBe("ReadFile");
    });

    test("delegates removeNestedGadget to nestedOperationTracker", () => {
      const progress = createProgress();
      progress.addNestedGadget("gadget-1", 1, "parent-123", "ReadFile");
      progress.removeNestedGadget("gadget-1");
      expect(progress.getNestedGadget("gadget-1")).toBeUndefined();
    });

    test("delegates completeNestedGadget to nestedOperationTracker", () => {
      const progress = createProgress();
      progress.addNestedGadget("gadget-1", 1, "parent-123", "ReadFile");
      progress.completeNestedGadget("gadget-1");
      const gadget = progress.getNestedGadget("gadget-1");
      expect(gadget?.completed).toBe(true);
    });

    test("getAggregatedSubagentMetrics returns zero metrics when no agents", () => {
      const progress = createProgress();
      const metrics = progress.getAggregatedSubagentMetrics("parent-123");
      expect(metrics.inputTokens).toBe(0);
      expect(metrics.outputTokens).toBe(0);
      expect(metrics.callCount).toBe(0);
    });

    test("getAggregatedSubagentMetrics aggregates nested agent metrics", () => {
      const progress = createProgress();
      progress.addNestedAgent("agent:0", "parent-123", 1, "gpt-4", 1, { inputTokens: 1000 });
      progress.updateNestedAgent("agent:0", { inputTokens: 1000, outputTokens: 50, cost: 0.001 });
      progress.addNestedAgent("agent:1", "parent-123", 1, "gpt-4", 2, { inputTokens: 2000 });
      progress.updateNestedAgent("agent:1", { inputTokens: 2000, outputTokens: 100, cost: 0.002 });

      const metrics = progress.getAggregatedSubagentMetrics("parent-123");
      expect(metrics.inputTokens).toBe(3000);
      expect(metrics.outputTokens).toBe(150);
      expect(metrics.callCount).toBe(2);
    });
  });

  describe("nested operations", () => {
    test("handles nested agents at different depths", () => {
      const progress = createProgress();
      // Depth 1 nested agent
      progress.addNestedAgent("agent:d1", "parent-root", 1, "gpt-4", 1, { inputTokens: 1000 });
      // Depth 2 nested agent
      progress.addNestedAgent("agent:d2", "agent:d1", 2, "gpt-4-mini", 1, { inputTokens: 500 });

      expect(progress.getNestedAgent("agent:d1")).toBeDefined();
      expect(progress.getNestedAgent("agent:d2")).toBeDefined();
      expect(progress.getNestedAgent("agent:d1")?.depth).toBe(1);
      expect(progress.getNestedAgent("agent:d2")?.depth).toBe(2);
    });

    test("clearCompletedGadgets clears nested agents via nestedOperationTracker", () => {
      const progress = createProgress();
      // Add a gadget and nested agent connected via invocation ID
      progress.addGadget("inv-1", "BrowseWeb");
      progress.addNestedAgent("agent:0", "inv-1", 1, "gpt-4", 1);

      // Complete and clear gadget - should also clear related nested agents
      progress.completeGadget("inv-1");
      progress.clearCompletedGadgets();

      expect(progress.getGadget("inv-1")).toBeUndefined();
      expect(progress.getNestedAgent("agent:0")).toBeUndefined();
    });

    test("nested gadgets can be added under nested agents", () => {
      const progress = createProgress();
      progress.addNestedAgent("agent:0", "parent-root", 1, "gpt-4", 1);
      progress.addNestedGadget("gadget-nested", 2, "agent:0", "WriteFile");

      expect(progress.getNestedGadget("gadget-nested")).toBeDefined();
      expect(progress.getNestedGadget("gadget-nested")?.parentInvocationId).toBe("agent:0");
    });
  });

  describe("multiple parallel sub-trackers", () => {
    test("tracks multiple parallel gadgets independently", () => {
      const progress = createProgress();
      progress.addGadget("gadget-a", "ReadFile", { path: "/a.txt" });
      progress.addGadget("gadget-b", "WriteFile", { path: "/b.txt" });
      progress.addGadget("gadget-c", "BrowseWeb", { url: "https://example.com" });

      expect(progress.hasInFlightGadgets()).toBe(true);
      expect(progress.getGadget("gadget-a")).toBeDefined();
      expect(progress.getGadget("gadget-b")).toBeDefined();
      expect(progress.getGadget("gadget-c")).toBeDefined();
    });

    test("tracks multiple parallel nested agents independently", () => {
      const progress = createProgress();
      progress.addNestedAgent("agent:0", "parent", 1, "gpt-4", 1, { inputTokens: 1000 });
      progress.addNestedAgent("agent:1", "parent", 1, "claude-3", 1, { inputTokens: 2000 });
      progress.addNestedAgent("agent:2", "parent", 1, "gemini-pro", 1, { inputTokens: 3000 });

      expect(progress.getNestedAgent("agent:0")).toBeDefined();
      expect(progress.getNestedAgent("agent:1")).toBeDefined();
      expect(progress.getNestedAgent("agent:2")).toBeDefined();

      const metrics = progress.getAggregatedSubagentMetrics("parent");
      expect(metrics.callCount).toBe(3);
    });

    test("parallel gadgets can be completed independently", () => {
      const progress = createProgress();
      progress.addGadget("gadget-a", "ReadFile");
      progress.addGadget("gadget-b", "WriteFile");

      // Complete only gadget-a
      progress.completeGadget("gadget-a");
      progress.clearCompletedGadgets();

      // gadget-b should still be in flight
      expect(progress.hasInFlightGadgets()).toBe(true);
      expect(progress.getGadget("gadget-b")).toBeDefined();
      expect(progress.getGadget("gadget-a")).toBeUndefined();
    });

    test("parallel nested agents track separately across different parents", () => {
      const progress = createProgress();
      progress.addNestedAgent("agent:0", "parent-A", 1, "gpt-4", 1, { inputTokens: 1000 });
      progress.addNestedAgent("agent:1", "parent-B", 1, "gpt-4", 1, { inputTokens: 5000 });

      const metricsA = progress.getAggregatedSubagentMetrics("parent-A");
      const metricsB = progress.getAggregatedSubagentMetrics("parent-B");

      expect(metricsA.inputTokens).toBe(1000);
      expect(metricsA.callCount).toBe(1);
      expect(metricsB.inputTokens).toBe(5000);
      expect(metricsB.callCount).toBe(1);
    });
  });

  describe("cost and stats tracking", () => {
    test("addGadgetCost accumulates cost via callStatsTracker", () => {
      const progress = createProgress();
      progress.addGadgetCost(0.05);
      expect(progress.getTotalCost()).toBeCloseTo(0.05, 5);
    });

    test("setInputTokens delegates to callStatsTracker", () => {
      const progress = createProgress();
      progress.startCall("gpt-4", 500);
      // Should not throw
      expect(() => progress.setInputTokens(1000, false)).not.toThrow();
    });

    test("setOutputTokens delegates to callStatsTracker", () => {
      const progress = createProgress();
      progress.startCall("gpt-4", 500);
      expect(() => progress.setOutputTokens(200, false)).not.toThrow();
    });

    test("setCachedTokens delegates to callStatsTracker", () => {
      const progress = createProgress();
      progress.startCall("gpt-4", 5000);
      expect(() => progress.setCachedTokens(4000, 100)).not.toThrow();
    });

    test("setReasoningTokens delegates to callStatsTracker", () => {
      const progress = createProgress();
      progress.startCall("gpt-4", 5000);
      expect(() => progress.setReasoningTokens(150)).not.toThrow();
    });

    test("update sets call output chars", () => {
      const progress = createProgress();
      // update() internally sets callStatsTracker.callOutputChars
      expect(() => progress.update(1500)).not.toThrow();
    });
  });

  describe("renderer delegation", () => {
    test("start() does not throw", () => {
      const progress = createProgress();
      expect(() => progress.start()).not.toThrow();
    });

    test("pause() does not throw", () => {
      const progress = createProgress();
      expect(() => progress.pause()).not.toThrow();
    });

    test("complete() does not throw", () => {
      const progress = createProgress();
      expect(() => progress.complete()).not.toThrow();
    });

    test("clearAndReset() does not throw", () => {
      const progress = createProgress();
      expect(() => progress.clearAndReset()).not.toThrow();
    });

    test("formatStats() returns a string", () => {
      const progress = createProgress();
      expect(typeof progress.formatStats()).toBe("string");
    });

    test("formatPrompt() returns a string", () => {
      const progress = createProgress();
      expect(typeof progress.formatPrompt()).toBe("string");
    });
  });

  describe("non-TTY behavior", () => {
    test("does not write to stream when isTTY is false", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);
      progress.startCall("gpt-4", 1000);
      progress.endCall();
      // No output should be written for non-TTY
      expect(stream.output).toBe("");
    });
  });
});
