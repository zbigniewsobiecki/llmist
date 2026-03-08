import type { ModelRegistry } from "llmist";
import { describe, expect, test } from "vitest";
import { CallStatsTracker } from "./call-stats-tracker.js";

/**
 * Mock model registry for testing cost and context calculations.
 */
class MockModelRegistry implements Partial<ModelRegistry> {
  private costs: Record<string, { inputCost: number; outputCost: number }> = {};
  private contextWindows: Record<string, number> = {};
  private shouldThrow = false;

  setCost(model: string, inputCost: number, outputCost: number): void {
    this.costs[model] = { inputCost, outputCost };
  }

  setContextWindow(model: string, contextWindow: number): void {
    this.contextWindows[model] = contextWindow;
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

  getModelLimits(model: string): { contextWindow: number } | undefined {
    const contextWindow = this.contextWindows[model];
    if (!contextWindow) return undefined;
    return { contextWindow };
  }
}

describe("CallStatsTracker", () => {
  describe("initial state", () => {
    test("starts in cumulative mode", () => {
      const tracker = new CallStatsTracker();
      expect(tracker.mode).toBe("cumulative");
    });

    test("starts with zero cumulative stats", () => {
      const tracker = new CallStatsTracker();
      expect(tracker.totalTokens).toBe(0);
      expect(tracker.totalCost).toBe(0);
      expect(tracker.iterations).toBe(0);
      expect(tracker.currentIteration).toBe(0);
    });

    test("starts with empty model", () => {
      const tracker = new CallStatsTracker();
      expect(tracker.model).toBe("");
    });
  });

  describe("startCall", () => {
    test("switches to streaming mode", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4", 1000);
      expect(tracker.mode).toBe("streaming");
    });

    test("sets model name", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("claude-sonnet-4-5", 500);
      expect(tracker.model).toBe("claude-sonnet-4-5");
    });

    test("sets estimated input tokens", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4", 1500);
      expect(tracker.callInputTokens).toBe(1500);
      expect(tracker.callInputTokensEstimated).toBe(true);
    });

    test("sets input tokens to 0 when not provided", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4");
      expect(tracker.callInputTokens).toBe(0);
    });

    test("resets call-level output state for new call", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4", 1000);
      tracker.setOutputTokens(500, false);
      tracker.startCall("gpt-4", 2000);

      expect(tracker.callOutputTokens).toBe(0);
      expect(tracker.callOutputTokensEstimated).toBe(true);
      expect(tracker.callOutputChars).toBe(0);
    });

    test("resets cache and reasoning tokens for new call", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4", 1000);
      tracker.setCachedTokens(500, 100);
      tracker.setReasoningTokens(50);
      tracker.startCall("gpt-4", 2000);

      expect(tracker.callCachedInputTokens).toBe(0);
      expect(tracker.callCacheCreationInputTokens).toBe(0);
      expect(tracker.callReasoningTokens).toBe(0);
    });

    test("increments currentIteration on each call", () => {
      const tracker = new CallStatsTracker();
      expect(tracker.currentIteration).toBe(0);
      tracker.startCall("gpt-4", 1000);
      expect(tracker.currentIteration).toBe(1);
      tracker.endCall();
      tracker.startCall("gpt-4", 1000);
      expect(tracker.currentIteration).toBe(2);
    });

    test("preserves cumulative stats from previous calls", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4", 1000);
      tracker.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      tracker.startCall("gpt-4", 2000);

      // Cumulative stats preserved
      expect(tracker.totalTokens).toBe(1500);
      expect(tracker.iterations).toBe(1);
    });

    test("records callStartTime close to now", () => {
      const before = Date.now();
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4", 1000);
      const after = Date.now();

      expect(tracker.callStartTime).toBeGreaterThanOrEqual(before);
      expect(tracker.callStartTime).toBeLessThanOrEqual(after);
    });
  });

  describe("endCall", () => {
    test("switches back to cumulative mode", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4", 1000);
      tracker.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });
      expect(tracker.mode).toBe("cumulative");
    });

    test("increments iterations", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4", 1000);
      tracker.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });
      expect(tracker.iterations).toBe(1);

      tracker.startCall("gpt-4", 500);
      tracker.endCall({ inputTokens: 500, outputTokens: 200, totalTokens: 700 });
      expect(tracker.iterations).toBe(2);
    });

    test("accumulates totalTokens across calls", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4", 1000);
      tracker.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      tracker.startCall("gpt-4", 2000);
      tracker.endCall({ inputTokens: 2000, outputTokens: 1000, totalTokens: 3000 });

      expect(tracker.totalTokens).toBe(4500);
    });

    test("calculates and accumulates cost using model registry", () => {
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60); // $30/1M input, $60/1M output

      const tracker = new CallStatsTracker(registry as unknown as ModelRegistry);
      tracker.startCall("gpt-4", 1000);
      tracker.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      // (1000/1M * $30) + (500/1M * $60) = $0.03 + $0.03 = $0.06
      expect(tracker.totalCost).toBeCloseTo(0.06, 5);
    });

    test("accumulates costs across multiple calls", () => {
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const tracker = new CallStatsTracker(registry as unknown as ModelRegistry);

      tracker.startCall("gpt-4", 1000);
      tracker.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      tracker.startCall("gpt-4", 2000);
      tracker.endCall({ inputTokens: 2000, outputTokens: 1000, totalTokens: 3000 });

      // Call 1: $0.06, Call 2: $0.12, Total: $0.18
      expect(tracker.totalCost).toBeCloseTo(0.18, 5);
    });

    test("strips provider prefix for cost calculation", () => {
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const tracker = new CallStatsTracker(registry as unknown as ModelRegistry);
      tracker.startCall("openai:gpt-4", 1000);
      tracker.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      // Should recognize "gpt-4" after stripping "openai:" prefix
      expect(tracker.totalCost).toBeCloseTo(0.06, 5);
    });

    test("does not calculate cost when usage is missing", () => {
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const tracker = new CallStatsTracker(registry as unknown as ModelRegistry);
      tracker.startCall("gpt-4", 1000);
      tracker.endCall(); // No usage

      expect(tracker.totalCost).toBe(0);
    });

    test("handles missing model registry gracefully", () => {
      const tracker = new CallStatsTracker(); // No registry
      tracker.startCall("gpt-4", 1000);

      expect(() => {
        tracker.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });
      }).not.toThrow();

      expect(tracker.totalCost).toBe(0);
    });

    test("handles unknown model gracefully", () => {
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const tracker = new CallStatsTracker(registry as unknown as ModelRegistry);
      tracker.startCall("unknown-model", 1000);
      tracker.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      expect(tracker.totalCost).toBe(0);
    });

    test("handles model registry errors gracefully", () => {
      const registry = new MockModelRegistry();
      registry.setShouldThrow(true);

      const tracker = new CallStatsTracker(registry as unknown as ModelRegistry);
      tracker.startCall("gpt-4", 1000);

      expect(() => {
        tracker.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });
      }).not.toThrow();

      expect(tracker.totalCost).toBe(0);
    });
  });

  describe("addGadgetCost", () => {
    test("adds positive cost to total", () => {
      const tracker = new CallStatsTracker();
      tracker.addGadgetCost(0.037);
      expect(tracker.totalCost).toBeCloseTo(0.037, 5);
    });

    test("accumulates gadget costs", () => {
      const tracker = new CallStatsTracker();
      tracker.addGadgetCost(0.037);
      tracker.addGadgetCost(0.001);
      expect(tracker.totalCost).toBeCloseTo(0.038, 5);
    });

    test("ignores zero cost", () => {
      const tracker = new CallStatsTracker();
      tracker.addGadgetCost(0.01);
      tracker.addGadgetCost(0);
      expect(tracker.totalCost).toBeCloseTo(0.01, 5);
    });

    test("ignores negative cost", () => {
      const tracker = new CallStatsTracker();
      tracker.addGadgetCost(0.01);
      tracker.addGadgetCost(-0.005);
      expect(tracker.totalCost).toBeCloseTo(0.01, 5);
    });

    test("combines with LLM call costs", () => {
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const tracker = new CallStatsTracker(registry as unknown as ModelRegistry);
      tracker.startCall("gpt-4", 1000);
      tracker.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });
      // LLM cost: $0.06

      tracker.addGadgetCost(0.037);
      // Total: $0.06 + $0.037 = $0.097
      expect(tracker.totalCost).toBeCloseTo(0.097, 5);
    });
  });

  describe("setInputTokens", () => {
    test("sets input token count with estimated=false", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4", 500);
      tracker.setInputTokens(896, false);

      expect(tracker.callInputTokens).toBe(896);
      expect(tracker.callInputTokensEstimated).toBe(false);
    });

    test("sets input token count with estimated=true", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4");
      tracker.setInputTokens(900, true);

      expect(tracker.callInputTokens).toBe(900);
      expect(tracker.callInputTokensEstimated).toBe(true);
    });

    test("defaults estimated to false when not provided", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4");
      tracker.setInputTokens(800);

      expect(tracker.callInputTokensEstimated).toBe(false);
    });

    test("does not overwrite actual count with a new estimate", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4");
      tracker.setInputTokens(896, false); // actual count
      tracker.setInputTokens(1000, true); // estimate attempt - should be ignored

      expect(tracker.callInputTokens).toBe(896);
      expect(tracker.callInputTokensEstimated).toBe(false);
    });

    test("allows overwriting estimate with actual count", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4", 1000); // estimated
      tracker.setInputTokens(896, false); // actual

      expect(tracker.callInputTokens).toBe(896);
      expect(tracker.callInputTokensEstimated).toBe(false);
    });

    test("allows overwriting estimate with new estimate", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4", 1000); // estimated
      tracker.setInputTokens(1100, true); // new estimate

      expect(tracker.callInputTokens).toBe(1100);
    });
  });

  describe("setOutputTokens", () => {
    test("sets output token count with estimated=false", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4");
      tracker.setOutputTokens(118, false);

      expect(tracker.callOutputTokens).toBe(118);
      expect(tracker.callOutputTokensEstimated).toBe(false);
    });

    test("does not overwrite actual count with a new estimate", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4");
      tracker.setOutputTokens(118, false); // actual
      tracker.setOutputTokens(200, true); // estimate - should be ignored

      expect(tracker.callOutputTokens).toBe(118);
      expect(tracker.callOutputTokensEstimated).toBe(false);
    });

    test("defaults estimated to false when not provided", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4");
      tracker.setOutputTokens(200);

      expect(tracker.callOutputTokensEstimated).toBe(false);
    });
  });

  describe("setCachedTokens", () => {
    test("sets cached and cache creation token counts", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("claude-sonnet", 5000);
      tracker.setCachedTokens(4000, 200);

      expect(tracker.callCachedInputTokens).toBe(4000);
      expect(tracker.callCacheCreationInputTokens).toBe(200);
    });

    test("resets to zero on new call", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("claude-sonnet", 5000);
      tracker.setCachedTokens(4000, 200);
      tracker.endCall();
      tracker.startCall("claude-sonnet", 5000);

      expect(tracker.callCachedInputTokens).toBe(0);
      expect(tracker.callCacheCreationInputTokens).toBe(0);
    });
  });

  describe("setReasoningTokens", () => {
    test("sets reasoning token count", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("claude-sonnet", 1000);
      tracker.setReasoningTokens(150);

      expect(tracker.callReasoningTokens).toBe(150);
    });

    test("resets to zero on new call", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("claude-sonnet", 1000);
      tracker.setReasoningTokens(150);
      tracker.endCall();
      tracker.startCall("claude-sonnet", 1000);

      expect(tracker.callReasoningTokens).toBe(0);
    });
  });

  describe("getTotalElapsedSeconds", () => {
    test("returns elapsed time > 0 after some time", async () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4");
      await new Promise((r) => setTimeout(r, 200));
      const elapsed = tracker.getTotalElapsedSeconds();
      expect(elapsed).toBeGreaterThan(0);
    });

    test("returns 0 when totalStartTime is 0", () => {
      const tracker = new CallStatsTracker();
      tracker.totalStartTime = 0;
      expect(tracker.getTotalElapsedSeconds()).toBe(0);
    });

    test("returns value with 1 decimal place precision", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4");
      const elapsed = tracker.getTotalElapsedSeconds();
      // Should have at most 1 decimal place
      expect(String(elapsed)).toMatch(/^\d+(\.\d)?$/);
    });
  });

  describe("getCallElapsedSeconds", () => {
    test("returns elapsed time > 0 after some time", async () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4");
      await new Promise((r) => setTimeout(r, 200));
      const elapsed = tracker.getCallElapsedSeconds();
      expect(elapsed).toBeGreaterThan(0);
    });

    test("returns value with 1 decimal place precision", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4");
      const elapsed = tracker.getCallElapsedSeconds();
      expect(String(elapsed)).toMatch(/^\d+(\.\d)?$/);
    });
  });

  describe("calculateCurrentCallCost", () => {
    test("returns 0 when no model registry", () => {
      const tracker = new CallStatsTracker(); // No registry
      tracker.startCall("gpt-4", 1000);
      expect(tracker.calculateCurrentCallCost(500)).toBe(0);
    });

    test("returns 0 when no model set", () => {
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const tracker = new CallStatsTracker(registry as unknown as ModelRegistry);
      // Don't call startCall, model is ""
      expect(tracker.calculateCurrentCallCost(500)).toBe(0);
    });

    test("calculates cost for current call", () => {
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60); // $30/1M input, $60/1M output

      const tracker = new CallStatsTracker(registry as unknown as ModelRegistry);
      tracker.startCall("gpt-4", 1000);
      tracker.setInputTokens(1000, false);

      const cost = tracker.calculateCurrentCallCost(500);
      // (1000/1M * $30) + (500/1M * $60) = $0.03 + $0.03 = $0.06
      expect(cost).toBeCloseTo(0.06, 5);
    });

    test("strips provider prefix for cost calculation", () => {
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const tracker = new CallStatsTracker(registry as unknown as ModelRegistry);
      tracker.startCall("openai:gpt-4", 1000);
      tracker.setInputTokens(1000, false);

      const cost = tracker.calculateCurrentCallCost(500);
      expect(cost).toBeCloseTo(0.06, 5);
    });

    test("handles model registry errors gracefully", () => {
      const registry = new MockModelRegistry();
      registry.setShouldThrow(true);

      const tracker = new CallStatsTracker(registry as unknown as ModelRegistry);
      tracker.startCall("gpt-4", 1000);

      expect(() => tracker.calculateCurrentCallCost(500)).not.toThrow();
      expect(tracker.calculateCurrentCallCost(500)).toBe(0);
    });

    test("includes cache tokens in cost calculation", () => {
      const registry = new MockModelRegistry();
      registry.setCost("claude-sonnet", 3, 15); // $3/1M input, $15/1M output

      const tracker = new CallStatsTracker(registry as unknown as ModelRegistry);
      tracker.startCall("claude-sonnet", 5000);
      tracker.setInputTokens(5000, false);
      tracker.setCachedTokens(4000, 200);

      // Should pass cached tokens to estimateCost
      const cost = tracker.calculateCurrentCallCost(100);
      expect(cost).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getContextUsagePercent", () => {
    test("returns null when no model registry", () => {
      const tracker = new CallStatsTracker(); // No registry
      tracker.startCall("gpt-4", 5000);
      expect(tracker.getContextUsagePercent()).toBeNull();
    });

    test("returns null when no model set", () => {
      const registry = new MockModelRegistry();
      registry.setContextWindow("gpt-4", 128000);

      const tracker = new CallStatsTracker(registry as unknown as ModelRegistry);
      // Don't call startCall
      expect(tracker.getContextUsagePercent()).toBeNull();
    });

    test("returns null when no input tokens", () => {
      const registry = new MockModelRegistry();
      registry.setContextWindow("gpt-4", 128000);

      const tracker = new CallStatsTracker(registry as unknown as ModelRegistry);
      tracker.startCall("gpt-4"); // No estimated tokens
      expect(tracker.getContextUsagePercent()).toBeNull();
    });

    test("returns null when model limits not found", () => {
      const registry = new MockModelRegistry();
      // No context window configured for gpt-4

      const tracker = new CallStatsTracker(registry as unknown as ModelRegistry);
      tracker.startCall("gpt-4", 5000);
      expect(tracker.getContextUsagePercent()).toBeNull();
    });

    test("calculates context usage percentage correctly", () => {
      const registry = new MockModelRegistry();
      registry.setContextWindow("gpt-4", 100000);

      const tracker = new CallStatsTracker(registry as unknown as ModelRegistry);
      tracker.startCall("gpt-4", 25000);

      const percent = tracker.getContextUsagePercent();
      expect(percent).toBeCloseTo(25, 1); // 25000/100000 * 100 = 25%
    });

    test("strips provider prefix for model lookup", () => {
      const registry = new MockModelRegistry();
      registry.setContextWindow("gpt-4", 128000);

      const tracker = new CallStatsTracker(registry as unknown as ModelRegistry);
      tracker.startCall("openai:gpt-4", 64000);

      const percent = tracker.getContextUsagePercent();
      expect(percent).toBeCloseTo(50, 1); // 64000/128000 * 100 = 50%
    });
  });

  describe("cost calculation edge cases", () => {
    test("handles zero input and output tokens", () => {
      const tracker = new CallStatsTracker();
      tracker.startCall("gpt-4");
      tracker.endCall({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });

      expect(tracker.totalTokens).toBe(0);
      expect(tracker.totalCost).toBe(0);
    });

    test("tracks iteration count through multiple calls", () => {
      const tracker = new CallStatsTracker();

      for (let i = 0; i < 5; i++) {
        tracker.startCall("gpt-4", 1000);
        tracker.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });
      }

      expect(tracker.iterations).toBe(5);
      expect(tracker.currentIteration).toBe(5);
      expect(tracker.totalTokens).toBe(7500);
    });
  });
});
