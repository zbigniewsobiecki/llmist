import type { ModelRegistry } from "llmist";
import { describe, expect, test } from "vitest";
import { NestedOperationTracker } from "./nested-operation-tracker.js";

/**
 * Mock model registry for testing cost calculations.
 */
class MockModelRegistry implements Partial<ModelRegistry> {
  private costs: Record<string, { inputCost: number; outputCost: number }> = {};
  private limits: Record<string, { contextWindow: number }> = {};
  private shouldThrow = false;

  setCost(model: string, inputCost: number, outputCost: number): void {
    this.costs[model] = { inputCost, outputCost };
  }

  setContextWindow(model: string, contextWindow: number): void {
    this.limits[model] = { contextWindow };
  }

  setShouldThrow(shouldThrow: boolean): void {
    this.shouldThrow = shouldThrow;
  }

  estimateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): { inputCost: number; outputCost: number; totalCost: number } | undefined {
    if (this.shouldThrow) {
      throw new Error("Model not found");
    }

    const costs = this.costs[model];
    if (!costs) {
      return undefined;
    }

    const inputCost = (inputTokens / 1_000_000) * costs.inputCost;
    const outputCost = (outputTokens / 1_000_000) * costs.outputCost;
    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
    };
  }
}

describe("NestedOperationTracker", () => {
  describe("addNestedAgent", () => {
    test("stores a nested agent with all required fields", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedAgent("agent:0", "parent-123", 1, "gemini-2.5-flash", 2, {
        inputTokens: 5000,
      });

      const agents = tracker.getNestedAgentsMap();
      expect(agents.size).toBe(1);

      const agent = agents.get("agent:0");
      expect(agent).toBeDefined();
      expect(agent?.parentInvocationId).toBe("parent-123");
      expect(agent?.depth).toBe(1);
      expect(agent?.model).toBe("gemini-2.5-flash");
      expect(agent?.iteration).toBe(2);
      expect(agent?.inputTokens).toBe(5000);
    });

    test("records startTime close to now", () => {
      const before = Date.now();
      const tracker = new NestedOperationTracker();
      tracker.addNestedAgent("agent:0", "parent-123", 1, "test-model", 1);
      const after = Date.now();

      const agent = tracker.getNestedAgentsMap().get("agent:0");
      expect(agent?.startTime).toBeGreaterThanOrEqual(before);
      expect(agent?.startTime).toBeLessThanOrEqual(after);
    });

    test("stores optional parentCallNumber and gadgetInvocationId", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedAgent(
        "agent:0",
        "browse_web_github",
        1,
        "gemini-2.5-flash",
        1,
        { inputTokens: 5000 },
        6, // parentCallNumber
        "browse_web_github", // gadgetInvocationId
      );

      const agent = tracker.getNestedAgentsMap().get("agent:0");
      expect(agent?.parentCallNumber).toBe(6);
      expect(agent?.gadgetInvocationId).toBe("browse_web_github");
    });

    test("stores cachedInputTokens from info", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedAgent("agent:0", "parent-123", 1, "test", 1, {
        inputTokens: 10000,
        cachedInputTokens: 8000,
      });

      const agent = tracker.getNestedAgentsMap().get("agent:0");
      expect(agent?.inputTokens).toBe(10000);
      expect(agent?.cachedInputTokens).toBe(8000);
    });

    test("handles missing optional info", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedAgent("agent:0", "parent-123", 1, "test", 1);

      const agent = tracker.getNestedAgentsMap().get("agent:0");
      expect(agent?.inputTokens).toBeUndefined();
      expect(agent?.cachedInputTokens).toBeUndefined();
      expect(agent?.parentCallNumber).toBeUndefined();
      expect(agent?.gadgetInvocationId).toBeUndefined();
    });

    test("adds multiple nested agents with different IDs", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedAgent("agent:0", "parent-1", 1, "model-a", 1);
      tracker.addNestedAgent("agent:1", "parent-1", 1, "model-b", 2);
      tracker.addNestedAgent("agent:2", "parent-2", 1, "model-c", 1);

      expect(tracker.getNestedAgentsMap().size).toBe(3);
    });
  });

  describe("updateNestedAgent", () => {
    test("updates output tokens and marks agent as completed", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedAgent("agent:0", "parent-123", 1, "test", 1, { inputTokens: 1000 });

      const before = Date.now();
      tracker.updateNestedAgent("agent:0", { outputTokens: 500, finishReason: "stop" });
      const after = Date.now();

      const agent = tracker.getNestedAgentsMap().get("agent:0");
      expect(agent?.outputTokens).toBe(500);
      expect(agent?.finishReason).toBe("stop");
      expect(agent?.completed).toBe(true);
      expect(agent?.completedTime).toBeGreaterThanOrEqual(before);
      expect(agent?.completedTime).toBeLessThanOrEqual(after);
    });

    test("updates all provided token fields", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedAgent("agent:0", "parent-123", 1, "test", 1, { inputTokens: 1000 });
      tracker.updateNestedAgent("agent:0", {
        inputTokens: 1500,
        outputTokens: 300,
        cachedInputTokens: 1000,
        cacheCreationInputTokens: 200,
        reasoningTokens: 50,
      });

      const agent = tracker.getNestedAgentsMap().get("agent:0");
      expect(agent?.inputTokens).toBe(1500);
      expect(agent?.outputTokens).toBe(300);
      expect(agent?.cachedInputTokens).toBe(1000);
      expect(agent?.cacheCreationInputTokens).toBe(200);
      expect(agent?.reasoningTokens).toBe(50);
    });

    test("preserves initial inputTokens when update has undefined inputTokens", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedAgent("agent:0", "parent-123", 1, "test", 1, {
        inputTokens: 5000,
        cachedInputTokens: 3000,
      });

      // Update without inputTokens (provider doesn't return them in completion)
      tracker.updateNestedAgent("agent:0", { outputTokens: 100, finishReason: "stop" });

      const agent = tracker.getNestedAgentsMap().get("agent:0");
      expect(agent?.inputTokens).toBe(5000);
      expect(agent?.cachedInputTokens).toBe(3000);
      expect(agent?.outputTokens).toBe(100);
    });

    test("updates inputTokens when new value is provided", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedAgent("agent:0", "parent-123", 1, "test", 1, { inputTokens: 5000 });

      tracker.updateNestedAgent("agent:0", { inputTokens: 5500, outputTokens: 100 });

      const agent = tracker.getNestedAgentsMap().get("agent:0");
      expect(agent?.inputTokens).toBe(5500);
    });

    test("uses provided cost directly when available", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedAgent("agent:0", "parent-123", 1, "test", 1, { inputTokens: 1000 });
      tracker.updateNestedAgent("agent:0", { inputTokens: 1000, outputTokens: 500, cost: 0.0025 });

      const agent = tracker.getNestedAgentsMap().get("agent:0");
      expect(agent?.cost).toBe(0.0025);
    });

    test("calculates cost using model registry when cost not provided", () => {
      const registry = new MockModelRegistry();
      registry.setCost("gemini-2.5-flash", 0.15, 0.6); // Per 1M tokens

      const tracker = new NestedOperationTracker(registry as unknown as ModelRegistry);
      tracker.addNestedAgent("agent:0", "parent-123", 1, "gemini:gemini-2.5-flash", 1, {
        inputTokens: 10000,
      });
      tracker.updateNestedAgent("agent:0", { inputTokens: 10000, outputTokens: 500 });

      const agent = tracker.getNestedAgentsMap().get("agent:0");
      // Cost: (10000/1M * 0.15) + (500/1M * 0.60) = 0.0015 + 0.0003 = 0.0018
      expect(agent?.cost).toBeCloseTo(0.0018, 4);
    });

    test("skips cost calculation when no outputTokens", () => {
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const tracker = new NestedOperationTracker(registry as unknown as ModelRegistry);
      tracker.addNestedAgent("agent:0", "parent-123", 1, "gpt-4", 1, { inputTokens: 1000 });
      tracker.updateNestedAgent("agent:0", { finishReason: "stop" }); // No output tokens

      const agent = tracker.getNestedAgentsMap().get("agent:0");
      expect(agent?.cost).toBeUndefined();
    });

    test("handles model registry errors gracefully", () => {
      const registry = new MockModelRegistry();
      registry.setShouldThrow(true);

      const tracker = new NestedOperationTracker(registry as unknown as ModelRegistry);
      tracker.addNestedAgent("agent:0", "parent-123", 1, "test", 1, { inputTokens: 1000 });

      expect(() => {
        tracker.updateNestedAgent("agent:0", { inputTokens: 1000, outputTokens: 500 });
      }).not.toThrow();

      const agent = tracker.getNestedAgentsMap().get("agent:0");
      expect(agent?.cost).toBeUndefined();
    });

    test("does nothing when updating non-existent agent", () => {
      const tracker = new NestedOperationTracker();

      expect(() => {
        tracker.updateNestedAgent("non-existent", { inputTokens: 1000, outputTokens: 500 });
      }).not.toThrow();
    });
  });

  describe("removeNestedAgent", () => {
    test("removes an existing nested agent", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedAgent("agent:0", "parent-123", 1, "test", 1);
      tracker.removeNestedAgent("agent:0");

      expect(tracker.getNestedAgentsMap().size).toBe(0);
    });

    test("does not throw when removing non-existent agent", () => {
      const tracker = new NestedOperationTracker();
      expect(() => tracker.removeNestedAgent("non-existent")).not.toThrow();
    });

    test("removes only the specified agent", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedAgent("agent:0", "parent-123", 1, "test", 1);
      tracker.addNestedAgent("agent:1", "parent-123", 1, "test", 2);
      tracker.removeNestedAgent("agent:0");

      expect(tracker.getNestedAgentsMap().size).toBe(1);
      expect(tracker.getNestedAgentsMap().has("agent:1")).toBe(true);
    });
  });

  describe("getNestedAgent", () => {
    test("returns the agent for a known ID", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedAgent("agent:0", "parent-123", 1, "test-model", 1);

      const agent = tracker.getNestedAgent("agent:0");
      expect(agent).toBeDefined();
      expect(agent?.model).toBe("test-model");
    });

    test("returns undefined for unknown ID", () => {
      const tracker = new NestedOperationTracker();
      expect(tracker.getNestedAgent("non-existent")).toBeUndefined();
    });
  });

  describe("getAggregatedSubagentMetrics", () => {
    test("returns zero metrics when no nested agents exist", () => {
      const tracker = new NestedOperationTracker();
      const metrics = tracker.getAggregatedSubagentMetrics("parent-123");

      expect(metrics.inputTokens).toBe(0);
      expect(metrics.outputTokens).toBe(0);
      expect(metrics.cachedInputTokens).toBe(0);
      expect(metrics.cost).toBe(0);
      expect(metrics.callCount).toBe(0);
    });

    test("aggregates metrics from multiple nested agents for same parent", () => {
      const tracker = new NestedOperationTracker();

      tracker.addNestedAgent("agent:0", "parent-123", 1, "test", 1, { inputTokens: 1000 });
      tracker.updateNestedAgent("agent:0", {
        inputTokens: 1000,
        outputTokens: 50,
        cachedInputTokens: 500,
        cost: 0.001,
      });

      tracker.addNestedAgent("agent:1", "parent-123", 1, "test", 2, { inputTokens: 2000 });
      tracker.updateNestedAgent("agent:1", {
        inputTokens: 2000,
        outputTokens: 100,
        cachedInputTokens: 1000,
        cost: 0.002,
      });

      const metrics = tracker.getAggregatedSubagentMetrics("parent-123");

      expect(metrics.inputTokens).toBe(3000);
      expect(metrics.outputTokens).toBe(150);
      expect(metrics.cachedInputTokens).toBe(1500);
      expect(metrics.cost).toBeCloseTo(0.003, 6);
      expect(metrics.callCount).toBe(2);
    });

    test("only includes agents for the specified parent", () => {
      const tracker = new NestedOperationTracker();

      tracker.addNestedAgent("agent:0", "parent-123", 1, "test", 1, { inputTokens: 1000 });
      tracker.updateNestedAgent("agent:0", { inputTokens: 1000, outputTokens: 50, cost: 0.001 });

      tracker.addNestedAgent("agent:1", "parent-456", 1, "test", 1, { inputTokens: 5000 });
      tracker.updateNestedAgent("agent:1", { inputTokens: 5000, outputTokens: 200, cost: 0.005 });

      const metrics = tracker.getAggregatedSubagentMetrics("parent-123");

      expect(metrics.inputTokens).toBe(1000);
      expect(metrics.outputTokens).toBe(50);
      expect(metrics.cost).toBeCloseTo(0.001, 6);
      expect(metrics.callCount).toBe(1);
    });

    test("handles agents with missing optional token fields", () => {
      const tracker = new NestedOperationTracker();

      tracker.addNestedAgent("agent:0", "parent-123", 1, "test", 1);
      tracker.updateNestedAgent("agent:0", { outputTokens: 50 });

      const metrics = tracker.getAggregatedSubagentMetrics("parent-123");

      expect(metrics.inputTokens).toBe(0);
      expect(metrics.outputTokens).toBe(50);
      expect(metrics.cachedInputTokens).toBe(0);
      expect(metrics.cost).toBe(0);
      expect(metrics.callCount).toBe(1);
    });

    test("includes in-progress (non-completed) agents in aggregation", () => {
      const tracker = new NestedOperationTracker();

      // Add agent but don't update (still in progress)
      tracker.addNestedAgent("agent:0", "parent-123", 1, "test", 1, { inputTokens: 3000 });

      const metrics = tracker.getAggregatedSubagentMetrics("parent-123");
      expect(metrics.inputTokens).toBe(3000);
      expect(metrics.callCount).toBe(1);
    });
  });

  describe("clearByParentInvocationId", () => {
    test("removes all nested agents with matching parent ID", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedAgent("agent:0", "parent-123", 1, "test", 1);
      tracker.addNestedAgent("agent:1", "parent-123", 1, "test", 2);
      tracker.addNestedAgent("agent:2", "parent-456", 1, "test", 1);

      tracker.clearByParentInvocationId("parent-123");

      expect(tracker.getNestedAgentsMap().size).toBe(1);
      expect(tracker.getNestedAgentsMap().has("agent:2")).toBe(true);
    });

    test("removes all nested gadgets with matching parent ID", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedGadget("gadget-1", 1, "parent-123", "ReadFile");
      tracker.addNestedGadget("gadget-2", 1, "parent-123", "WriteFile");
      tracker.addNestedGadget("gadget-3", 1, "parent-456", "OtherGadget");

      tracker.clearByParentInvocationId("parent-123");

      expect(tracker.getNestedGadgetsMap().size).toBe(1);
      expect(tracker.getNestedGadgetsMap().has("gadget-3")).toBe(true);
    });

    test("clears both nested agents and gadgets for matching parent", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedAgent("agent:0", "parent-123", 1, "test", 1);
      tracker.addNestedGadget("gadget-1", 1, "parent-123", "ReadFile");

      tracker.clearByParentInvocationId("parent-123");

      expect(tracker.getNestedAgentsMap().size).toBe(0);
      expect(tracker.getNestedGadgetsMap().size).toBe(0);
    });

    test("does nothing when no matching parent exists", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedAgent("agent:0", "parent-123", 1, "test", 1);
      tracker.addNestedGadget("gadget-1", 1, "parent-123", "ReadFile");

      expect(() => tracker.clearByParentInvocationId("non-existent")).not.toThrow();

      expect(tracker.getNestedAgentsMap().size).toBe(1);
      expect(tracker.getNestedGadgetsMap().size).toBe(1);
    });
  });

  // ===== Nested Gadgets =====

  describe("addNestedGadget", () => {
    test("stores a nested gadget with all fields", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedGadget("gadget-123", 1, "parent-456", "BrowseWeb", {
        url: "https://example.com",
        task: "Find info",
      });

      const gadgets = tracker.getNestedGadgetsMap();
      expect(gadgets.size).toBe(1);

      const gadget = gadgets.get("gadget-123");
      expect(gadget).toBeDefined();
      expect(gadget?.name).toBe("BrowseWeb");
      expect(gadget?.parameters).toEqual({ url: "https://example.com", task: "Find info" });
      expect(gadget?.parentInvocationId).toBe("parent-456");
      expect(gadget?.depth).toBe(1);
      expect(gadget?.completed).toBeUndefined();
    });

    test("records startTime close to now", () => {
      const before = Date.now();
      const tracker = new NestedOperationTracker();
      tracker.addNestedGadget("gadget-123", 1, "parent-456", "ReadFile");
      const after = Date.now();

      const gadget = tracker.getNestedGadgetsMap().get("gadget-123");
      expect(gadget?.startTime).toBeGreaterThanOrEqual(before);
      expect(gadget?.startTime).toBeLessThanOrEqual(after);
    });

    test("stores a nested gadget without parameters", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedGadget("gadget-123", 1, "parent-456", "Finish");

      const gadget = tracker.getNestedGadgetsMap().get("gadget-123");
      expect(gadget?.parameters).toBeUndefined();
    });

    test("adds multiple nested gadgets", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedGadget("gadget-1", 1, "parent-1", "ReadFile");
      tracker.addNestedGadget("gadget-2", 1, "parent-1", "WriteFile");
      tracker.addNestedGadget("gadget-3", 2, "parent-1", "BrowseWeb");

      expect(tracker.getNestedGadgetsMap().size).toBe(3);
    });
  });

  describe("removeNestedGadget", () => {
    test("removes an existing nested gadget", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedGadget("gadget-123", 1, "parent-456", "ReadFile");
      tracker.removeNestedGadget("gadget-123");

      expect(tracker.getNestedGadgetsMap().size).toBe(0);
    });

    test("does not throw when removing non-existent gadget", () => {
      const tracker = new NestedOperationTracker();
      expect(() => tracker.removeNestedGadget("non-existent")).not.toThrow();
    });

    test("removes only the specified gadget", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedGadget("gadget-1", 1, "parent-1", "ReadFile");
      tracker.addNestedGadget("gadget-2", 1, "parent-1", "WriteFile");
      tracker.removeNestedGadget("gadget-1");

      expect(tracker.getNestedGadgetsMap().size).toBe(1);
      expect(tracker.getNestedGadgetsMap().has("gadget-2")).toBe(true);
    });
  });

  describe("getNestedGadget", () => {
    test("returns the gadget for a known ID", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedGadget("gadget-123", 1, "parent-456", "BrowseWeb");

      const gadget = tracker.getNestedGadget("gadget-123");
      expect(gadget).toBeDefined();
      expect(gadget?.name).toBe("BrowseWeb");
    });

    test("returns undefined for unknown ID", () => {
      const tracker = new NestedOperationTracker();
      expect(tracker.getNestedGadget("non-existent")).toBeUndefined();
    });
  });

  describe("completeNestedGadget", () => {
    test("marks nested gadget as completed with completedTime", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedGadget("gadget-123", 1, "parent-456", "ReadFile");

      const before = Date.now();
      tracker.completeNestedGadget("gadget-123");
      const after = Date.now();

      const gadget = tracker.getNestedGadgetsMap().get("gadget-123");
      expect(gadget?.completed).toBe(true);
      expect(gadget?.completedTime).toBeGreaterThanOrEqual(before);
      expect(gadget?.completedTime).toBeLessThanOrEqual(after);
    });

    test("keeps the gadget in the map after completion", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedGadget("gadget-123", 1, "parent-456", "ReadFile");
      tracker.completeNestedGadget("gadget-123");

      expect(tracker.getNestedGadgetsMap().size).toBe(1);
      expect(tracker.getNestedGadgetsMap().has("gadget-123")).toBe(true);
    });

    test("does not throw when completing non-existent gadget", () => {
      const tracker = new NestedOperationTracker();
      expect(() => tracker.completeNestedGadget("non-existent")).not.toThrow();
    });

    test("completedTime >= startTime", () => {
      const tracker = new NestedOperationTracker();
      tracker.addNestedGadget("gadget-123", 1, "parent-456", "ReadFile");

      const startTime = tracker.getNestedGadgetsMap().get("gadget-123")?.startTime ?? 0;
      tracker.completeNestedGadget("gadget-123");

      const gadget = tracker.getNestedGadgetsMap().get("gadget-123");
      expect(gadget?.completedTime).toBeGreaterThanOrEqual(startTime);
    });
  });

  describe("concurrent operations", () => {
    test("supports multiple agents and gadgets simultaneously", () => {
      const tracker = new NestedOperationTracker();

      // Add multiple concurrent nested operations
      tracker.addNestedAgent("agent:0", "parent-1", 1, "model-a", 1, { inputTokens: 1000 });
      tracker.addNestedAgent("agent:1", "parent-1", 1, "model-b", 2, { inputTokens: 2000 });
      tracker.addNestedGadget("gadget-1", 2, "parent-1", "ReadFile");
      tracker.addNestedGadget("gadget-2", 2, "parent-1", "WriteFile");

      expect(tracker.getNestedAgentsMap().size).toBe(2);
      expect(tracker.getNestedGadgetsMap().size).toBe(2);
    });

    test("can complete and remove agents independently", () => {
      const tracker = new NestedOperationTracker();

      tracker.addNestedAgent("agent:0", "parent-1", 1, "model-a", 1, { inputTokens: 1000 });
      tracker.addNestedAgent("agent:1", "parent-1", 1, "model-b", 2, { inputTokens: 2000 });

      // Complete first, remove second
      tracker.updateNestedAgent("agent:0", { outputTokens: 100 });
      tracker.removeNestedAgent("agent:1");

      expect(tracker.getNestedAgentsMap().size).toBe(1);
      expect(tracker.getNestedAgentsMap().has("agent:0")).toBe(true);
      expect(tracker.getNestedAgentsMap().get("agent:0")?.completed).toBe(true);
    });

    test("getAggregatedSubagentMetrics handles mixed in-progress and completed agents", () => {
      const tracker = new NestedOperationTracker();

      // First agent: completed
      tracker.addNestedAgent("agent:0", "parent-1", 1, "test", 1, { inputTokens: 1000 });
      tracker.updateNestedAgent("agent:0", { outputTokens: 50, cost: 0.001 });

      // Second agent: still in progress
      tracker.addNestedAgent("agent:1", "parent-1", 1, "test", 2, { inputTokens: 2000 });

      const metrics = tracker.getAggregatedSubagentMetrics("parent-1");
      expect(metrics.callCount).toBe(2);
      expect(metrics.inputTokens).toBe(3000);
      expect(metrics.outputTokens).toBe(50);
      expect(metrics.cost).toBeCloseTo(0.001, 6);
    });
  });

  describe("empty state", () => {
    test("starts with no agents or gadgets", () => {
      const tracker = new NestedOperationTracker();
      expect(tracker.getNestedAgentsMap().size).toBe(0);
      expect(tracker.getNestedGadgetsMap().size).toBe(0);
    });

    test("getAggregatedSubagentMetrics returns zeros for empty tracker", () => {
      const tracker = new NestedOperationTracker();
      const metrics = tracker.getAggregatedSubagentMetrics("any-parent");

      expect(metrics.inputTokens).toBe(0);
      expect(metrics.outputTokens).toBe(0);
      expect(metrics.cachedInputTokens).toBe(0);
      expect(metrics.cost).toBe(0);
      expect(metrics.callCount).toBe(0);
    });
  });
});
