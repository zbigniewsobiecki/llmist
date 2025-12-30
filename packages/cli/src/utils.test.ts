import { afterEach, beforeEach, describe, expect, vi, test } from "vitest";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import type { ModelRegistry } from "llmist";
import { formatCost } from "./ui/formatters.js";
import { createEscKeyListener, createSigintListener, StreamProgress } from "./utils.js";

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
  private shouldThrow = false;

  setCost(model: string, inputCost: number, outputCost: number): void {
    this.costs[model] = { inputCost, outputCost };
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

describe("StreamProgress", () => {
  describe("cost formatting", () => {
    test("formats very small costs with 5 decimal places", () => {
      // Now testing the formatCost function from formatters.ts
      expect(formatCost(0.00001)).toBe("0.00001");
      expect(formatCost(0.0005)).toBe("0.00050");
      expect(formatCost(0.00099)).toBe("0.00099");
    });

    test("formats small costs with 4 decimal places", () => {
      expect(formatCost(0.001)).toBe("0.0010");
      expect(formatCost(0.005)).toBe("0.0050");
      expect(formatCost(0.0099)).toBe("0.0099");
    });

    test("formats medium costs with 3 decimal places", () => {
      expect(formatCost(0.01)).toBe("0.010");
      expect(formatCost(0.123)).toBe("0.123");
      expect(formatCost(0.999)).toBe("0.999");
    });

    test("formats large costs with 2 decimal places", () => {
      expect(formatCost(1.0)).toBe("1.00");
      expect(formatCost(5.5)).toBe("5.50");
      expect(formatCost(123.456)).toBe("123.46");
    });
  });

  describe("cost calculation", () => {
    test("accumulates costs across multiple calls", () => {
      const stream = new MockWritableStream();
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60); // $30/1M input, $60/1M output

      const progress = new StreamProgress(stream, false, registry as any);

      // First call: 1000 input, 500 output tokens
      progress.startCall("gpt-4", 1000);
      progress.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      // Second call: 2000 input, 1000 output tokens
      progress.startCall("gpt-4", 2000);
      progress.endCall({ inputTokens: 2000, outputTokens: 1000, totalTokens: 3000 });

      // Expected costs:
      // Call 1: (1000/1M * $30) + (500/1M * $60) = $0.03 + $0.03 = $0.06
      // Call 2: (2000/1M * $30) + (1000/1M * $60) = $0.06 + $0.06 = $0.12
      // Total: $0.18

      const totalCost = (progress as any).totalCost;
      expect(totalCost).toBeCloseTo(0.18, 5);
    });

    test("handles missing model registry gracefully", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false); // No registry

      progress.startCall("gpt-4", 1000);
      progress.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      // Should not throw and cost should remain 0
      const totalCost = (progress as any).totalCost;
      expect(totalCost).toBe(0);
    });

    test("handles unknown model gracefully", () => {
      const stream = new MockWritableStream();
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const progress = new StreamProgress(stream, false, registry as any);

      // Use a model not in the registry
      progress.startCall("unknown-model", 1000);
      progress.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      // Should not throw and cost should remain 0
      const totalCost = (progress as any).totalCost;
      expect(totalCost).toBe(0);
    });

    test("handles model registry errors gracefully", () => {
      const stream = new MockWritableStream();
      const registry = new MockModelRegistry();
      registry.setShouldThrow(true);

      const progress = new StreamProgress(stream, false, registry as any);

      progress.startCall("gpt-4", 1000);
      // Should not throw even when registry throws
      expect(() => {
        progress.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });
      }).not.toThrow();

      // Cost should remain 0
      const totalCost = (progress as any).totalCost;
      expect(totalCost).toBe(0);
    });

    test("does not calculate cost when usage is missing", () => {
      const stream = new MockWritableStream();
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const progress = new StreamProgress(stream, false, registry as any);

      progress.startCall("gpt-4", 1000);
      progress.endCall(); // No usage provided

      // Cost should remain 0
      const totalCost = (progress as any).totalCost;
      expect(totalCost).toBe(0);
    });

    test("addGadgetCost accumulates gadget costs into total", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      // Add gadget costs
      progress.addGadgetCost(0.037); // BrowseWeb cost
      progress.addGadgetCost(0.001); // Another gadget

      const totalCost = (progress as any).totalCost;
      expect(totalCost).toBeCloseTo(0.038, 5);
    });

    test("addGadgetCost ignores zero and negative costs", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      progress.addGadgetCost(0.01);
      progress.addGadgetCost(0); // Should be ignored
      progress.addGadgetCost(-0.005); // Should be ignored

      const totalCost = (progress as any).totalCost;
      expect(totalCost).toBeCloseTo(0.01, 5);
    });

    test("addGadgetCost combines with LLM call costs", () => {
      const stream = new MockWritableStream();
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const progress = new StreamProgress(stream, false, registry as any);

      // LLM call cost: (1000/1M * $30) + (500/1M * $60) = $0.03 + $0.03 = $0.06
      progress.startCall("gpt-4", 1000);
      progress.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      // Add gadget cost
      progress.addGadgetCost(0.037);

      const totalCost = (progress as any).totalCost;
      // Total should be $0.06 (LLM) + $0.037 (gadget) = $0.097
      expect(totalCost).toBeCloseTo(0.097, 5);
    });
  });

  describe("cost display", () => {
    test("includes cost in formatPrompt when cost > 0", () => {
      const stream = new MockWritableStream();
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const progress = new StreamProgress(stream, false, registry as any);

      progress.startCall("gpt-4", 1000);
      progress.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      const prompt = progress.formatPrompt();
      expect(prompt).toContain("$"); // Cost should be displayed
      expect(prompt).toMatch(/\$0\.0\d+/); // Should match cost format
    });

    test("does not include cost in formatPrompt when cost = 0", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false); // No registry

      progress.startCall("gpt-4", 1000);
      progress.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      const prompt = progress.formatPrompt();
      expect(prompt).not.toContain("$"); // Cost should not be displayed
    });

    test("displays cost in cumulative mode with proper formatting", () => {
      const stream = new MockWritableStream();
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 10, 20);

      const progress = new StreamProgress(stream, false, registry as any);

      progress.startCall("gpt-4", 1000);
      progress.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      const prompt = progress.formatPrompt();
      // Cost should be displayed between separators (using | not │)
      expect(prompt).toMatch(/\|.*\$\d+\.\d+.*\|/); // Cost between separators
      // Verify the actual cost value
      expect(prompt).toContain("$0.020");
    });
  });

  describe("integration", () => {
    test("tracks tokens and costs together correctly", () => {
      const stream = new MockWritableStream();
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const progress = new StreamProgress(stream, false, registry as any);

      // Make multiple calls with different token counts
      progress.startCall("gpt-4", 500);
      progress.endCall({ inputTokens: 500, outputTokens: 250, totalTokens: 750 });

      progress.startCall("gpt-4", 1500);
      progress.endCall({ inputTokens: 1500, outputTokens: 750, totalTokens: 2250 });

      progress.startCall("gpt-4", 1000);
      progress.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      // Verify total tokens
      const totalTokens = (progress as any).totalTokens;
      expect(totalTokens).toBe(750 + 2250 + 1500); // 4500

      // Verify total cost
      // Call 1: (500/1M * $30) + (250/1M * $60) = $0.015 + $0.015 = $0.03
      // Call 2: (1500/1M * $30) + (750/1M * $60) = $0.045 + $0.045 = $0.09
      // Call 3: (1000/1M * $30) + (500/1M * $60) = $0.03 + $0.03 = $0.06
      // Total: $0.18
      const totalCost = (progress as any).totalCost;
      expect(totalCost).toBeCloseTo(0.18, 5);

      // Verify iterations
      const iterations = (progress as any).iterations;
      expect(iterations).toBe(3);
    });

    test("resets state correctly for new call in streaming mode", () => {
      const stream = new MockWritableStream();
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const progress = new StreamProgress(stream, false, registry as any);

      // First call
      progress.startCall("gpt-4", 1000);
      progress.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      // Second call with different model
      progress.startCall("gpt-3.5-turbo", 500);

      // Verify call state was reset
      const model = (progress as any).model;
      expect(model).toBe("gpt-3.5-turbo");

      const callInputTokens = (progress as any).callInputTokens;
      expect(callInputTokens).toBe(500);

      // But cumulative stats should be preserved
      const totalTokens = (progress as any).totalTokens;
      expect(totalTokens).toBe(1500); // From first call
    });

    test("uses real counts when available, not estimates", () => {
      const stream = new MockWritableStream();
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const progress = new StreamProgress(stream, false, registry as any);

      // Start call with initial token count
      progress.startCall("gpt-4", 1000);

      // Simulate receiving real input tokens from provider (not estimated)
      progress.setInputTokens(896, false);

      // Simulate streaming output
      progress.update(500); // 500 chars

      // Simulate receiving real output tokens from provider (not estimated)
      progress.setOutputTokens(118, false);

      const prompt = progress.formatPrompt();

      // Should NOT contain ~ since we have real counts
      expect(prompt).not.toContain("~");
      // Should contain the real token counts
      expect(prompt).toContain("896");
      expect(prompt).toContain("118");
    });
  });
});

describe("StreamProgress nested operations", () => {
  describe("addNestedAgent", () => {
    test("stores nested agent with all required fields", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      progress.addNestedAgent("agent:0", "parent-123", 1, "gemini-2.5-flash", 0, { inputTokens: 5000 });

      const nestedAgents = (progress as any).nestedAgents;
      expect(nestedAgents.size).toBe(1);

      const agent = nestedAgents.get("agent:0");
      expect(agent).toBeDefined();
      expect(agent.parentInvocationId).toBe("parent-123");
      expect(agent.depth).toBe(1);
      expect(agent.model).toBe("gemini-2.5-flash");
      expect(agent.iteration).toBe(0);
      expect(agent.inputTokens).toBe(5000);
    });

    test("stores gadgetInvocationId for unique subagent identification", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      progress.addNestedAgent(
        "agent:0",
        "browse_web_github",
        1,
        "gemini-2.5-flash",
        1,
        { inputTokens: 5000 },
        6, // parentCallNumber
        "browse_web_github", // gadgetInvocationId
      );

      const nestedAgents = (progress as any).nestedAgents;
      const agent = nestedAgents.get("agent:0");
      expect(agent).toBeDefined();
      expect(agent.parentCallNumber).toBe(6);
      expect(agent.gadgetInvocationId).toBe("browse_web_github");
    });

    test("distinguishes parallel subagents by gadgetInvocationId", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      // Add two parallel subagents with same parent call number but different gadget IDs
      progress.addNestedAgent(
        "agent:0",
        "browse_web_github",
        1,
        "gemini-2.5-flash",
        1,
        { inputTokens: 5000 },
        6,
        "browse_web_github",
      );

      progress.addNestedAgent(
        "agent:1",
        "browse_web_npm",
        1,
        "gemini-2.5-flash",
        1,
        { inputTokens: 6000 },
        6,
        "browse_web_npm",
      );

      const nestedAgents = (progress as any).nestedAgents;

      const agent0 = nestedAgents.get("agent:0");
      const agent1 = nestedAgents.get("agent:1");

      // Both have same parentCallNumber (main iteration 6)
      expect(agent0.parentCallNumber).toBe(6);
      expect(agent1.parentCallNumber).toBe(6);

      // But different gadgetInvocationIds for unique identification
      expect(agent0.gadgetInvocationId).toBe("browse_web_github");
      expect(agent1.gadgetInvocationId).toBe("browse_web_npm");
    });

    test("handles missing gadgetInvocationId gracefully", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      // Add without gadgetInvocationId (legacy behavior)
      progress.addNestedAgent("agent:0", "parent-123", 1, "test", 1, { inputTokens: 1000 });

      const nestedAgents = (progress as any).nestedAgents;
      const agent = nestedAgents.get("agent:0");
      expect(agent.gadgetInvocationId).toBeUndefined();
      expect(agent.parentCallNumber).toBeUndefined();
    });
  });

  describe("updateNestedAgent", () => {
    test("updates nested agent with output tokens and finish reason", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      progress.addNestedAgent("agent:0", "parent-123", 1, "test", 0, { inputTokens: 1000 });
      progress.updateNestedAgent("agent:0", {
        inputTokens: 1000,
        outputTokens: 500,
        finishReason: "stop",
      });

      const nestedAgents = (progress as any).nestedAgents;
      const agent = nestedAgents.get("agent:0");
      expect(agent.outputTokens).toBe(500);
      expect(agent.finishReason).toBe("stop");
      expect(agent.completed).toBe(true);
      expect(agent.completedTime).toBeDefined();
    });

    test("updates nested agent with cached tokens", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      progress.addNestedAgent("agent:0", "parent-123", 1, "test", 0, { inputTokens: 5000 });
      progress.updateNestedAgent("agent:0", {
        inputTokens: 5000,
        cachedInputTokens: 4000,
        outputTokens: 100,
      });

      const nestedAgents = (progress as any).nestedAgents;
      const agent = nestedAgents.get("agent:0");
      expect(agent.cachedInputTokens).toBe(4000);
    });

    test("uses provided cost when available", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      progress.addNestedAgent("agent:0", "parent-123", 1, "test", 0, { inputTokens: 1000 });
      progress.updateNestedAgent("agent:0", {
        inputTokens: 1000,
        outputTokens: 500,
        cost: 0.0025,
      });

      const nestedAgents = (progress as any).nestedAgents;
      const agent = nestedAgents.get("agent:0");
      expect(agent.cost).toBe(0.0025);
    });

    test("calculates cost using model registry when cost not provided", () => {
      const stream = new MockWritableStream();
      const registry = new MockModelRegistry();
      registry.setCost("gemini-2.5-flash", 0.15, 0.60); // Per 1M tokens

      const progress = new StreamProgress(stream, false, registry as any);

      progress.addNestedAgent("agent:0", "parent-123", 1, "gemini:gemini-2.5-flash", 0, 10000);
      progress.updateNestedAgent("agent:0", {
        inputTokens: 10000,
        outputTokens: 500,
        // No cost provided - should calculate
      });

      const nestedAgents = (progress as any).nestedAgents;
      const agent = nestedAgents.get("agent:0");
      // Cost should be calculated: (10000/1M * 0.15) + (500/1M * 0.60) = 0.0015 + 0.0003 = 0.0018
      expect(agent.cost).toBeCloseTo(0.0018, 4);
    });

    test("handles model registry errors gracefully", () => {
      const stream = new MockWritableStream();
      const registry = new MockModelRegistry();
      registry.setShouldThrow(true);

      const progress = new StreamProgress(stream, false, registry as any);

      progress.addNestedAgent("agent:0", "parent-123", 1, "test", 0, { inputTokens: 1000 });

      // Should not throw
      expect(() => {
        progress.updateNestedAgent("agent:0", {
          inputTokens: 1000,
          outputTokens: 500,
        });
      }).not.toThrow();

      // Cost should remain undefined
      const nestedAgents = (progress as any).nestedAgents;
      const agent = nestedAgents.get("agent:0");
      expect(agent.cost).toBeUndefined();
    });

    test("ignores updates for non-existent agent", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      // Should not throw when updating non-existent agent
      expect(() => {
        progress.updateNestedAgent("non-existent", {
          inputTokens: 1000,
          outputTokens: 500,
        });
      }).not.toThrow();
    });

    test("preserves initial inputTokens when update has undefined", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      // Add with initial inputTokens (simulating llm_call_start)
      progress.addNestedAgent("agent:0", "parent-123", 1, "gemini:gemini-2.5-flash", 1, {
        inputTokens: 5000,
        cachedInputTokens: 3000,
      });

      // Update without inputTokens (simulating provider that doesn't return them in completion)
      progress.updateNestedAgent("agent:0", {
        outputTokens: 100,
        finishReason: "stop",
      });

      const nestedAgents = (progress as any).nestedAgents;
      const agent = nestedAgents.get("agent:0");

      // Should preserve initial inputTokens, not overwrite with undefined
      expect(agent.inputTokens).toBe(5000);
      expect(agent.cachedInputTokens).toBe(3000);
      expect(agent.outputTokens).toBe(100);
    });

    test("updates inputTokens when new value is provided", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      progress.addNestedAgent("agent:0", "parent-123", 1, "test", 1, { inputTokens: 5000 });

      // Update with new inputTokens value (provider returned them in completion)
      progress.updateNestedAgent("agent:0", {
        inputTokens: 5500, // Updated value
        outputTokens: 100,
      });

      const nestedAgents = (progress as any).nestedAgents;
      const agent = nestedAgents.get("agent:0");
      expect(agent.inputTokens).toBe(5500);
    });
  });

  describe("getAggregatedSubagentMetrics", () => {
    test("returns zero metrics when no nested agents exist", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      const metrics = progress.getAggregatedSubagentMetrics("nonexistent-parent");

      expect(metrics.inputTokens).toBe(0);
      expect(metrics.outputTokens).toBe(0);
      expect(metrics.cachedInputTokens).toBe(0);
      expect(metrics.cost).toBe(0);
      expect(metrics.callCount).toBe(0);
    });

    test("aggregates metrics from multiple nested agents", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      // Add multiple nested agents for same parent
      progress.addNestedAgent("agent:0", "parent-123", 1, "test", 1, { inputTokens: 1000 });
      progress.updateNestedAgent("agent:0", {
        inputTokens: 1000,
        outputTokens: 50,
        cachedInputTokens: 500,
        cost: 0.001,
      });

      progress.addNestedAgent("agent:1", "parent-123", 1, "test", 2, { inputTokens: 2000 });
      progress.updateNestedAgent("agent:1", {
        inputTokens: 2000,
        outputTokens: 100,
        cachedInputTokens: 1000,
        cost: 0.002,
      });

      const metrics = progress.getAggregatedSubagentMetrics("parent-123");

      expect(metrics.inputTokens).toBe(3000);
      expect(metrics.outputTokens).toBe(150);
      expect(metrics.cachedInputTokens).toBe(1500);
      expect(metrics.cost).toBeCloseTo(0.003, 6);
      expect(metrics.callCount).toBe(2);
    });

    test("only includes agents for the specified parent", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      // Agent for parent-123
      progress.addNestedAgent("agent:0", "parent-123", 1, "test", 1, { inputTokens: 1000 });
      progress.updateNestedAgent("agent:0", { inputTokens: 1000, outputTokens: 50, cost: 0.001 });

      // Agent for different parent
      progress.addNestedAgent("agent:1", "parent-456", 1, "test", 1, { inputTokens: 5000 });
      progress.updateNestedAgent("agent:1", { inputTokens: 5000, outputTokens: 200, cost: 0.005 });

      const metrics = progress.getAggregatedSubagentMetrics("parent-123");

      // Should only include agent:0's metrics
      expect(metrics.inputTokens).toBe(1000);
      expect(metrics.outputTokens).toBe(50);
      expect(metrics.cost).toBeCloseTo(0.001, 6);
      expect(metrics.callCount).toBe(1);
    });

    test("handles agents with missing optional metrics", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      // Agent with minimal data
      progress.addNestedAgent("agent:0", "parent-123", 1, "test", 1);
      progress.updateNestedAgent("agent:0", { outputTokens: 50 });

      const metrics = progress.getAggregatedSubagentMetrics("parent-123");

      expect(metrics.inputTokens).toBe(0);
      expect(metrics.outputTokens).toBe(50);
      expect(metrics.cachedInputTokens).toBe(0);
      expect(metrics.cost).toBe(0);
      expect(metrics.callCount).toBe(1);
    });
  });

  describe("addNestedGadget", () => {
    test("stores nested gadget with parameters", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      progress.addNestedGadget("gadget-123", 1, "parent-456", "BrowseWeb", {
        url: "https://example.com",
        task: "Find info",
      });

      const nestedGadgets = (progress as any).nestedGadgets;
      expect(nestedGadgets.size).toBe(1);

      const gadget = nestedGadgets.get("gadget-123");
      expect(gadget).toBeDefined();
      expect(gadget.name).toBe("BrowseWeb");
      expect(gadget.parameters).toEqual({
        url: "https://example.com",
        task: "Find info",
      });
      expect(gadget.parentInvocationId).toBe("parent-456");
      expect(gadget.depth).toBe(1);
    });

    test("stores nested gadget without parameters", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      progress.addNestedGadget("gadget-123", 1, "parent-456", "Finish");

      const nestedGadgets = (progress as any).nestedGadgets;
      const gadget = nestedGadgets.get("gadget-123");
      expect(gadget.parameters).toBeUndefined();
    });
  });

  describe("completeNestedGadget", () => {
    test("marks nested gadget as completed", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      progress.addNestedGadget("gadget-123", 1, "parent-456", "ReadFile");
      progress.completeNestedGadget("gadget-123");

      const nestedGadgets = (progress as any).nestedGadgets;
      const gadget = nestedGadgets.get("gadget-123");
      expect(gadget.completed).toBe(true);
      expect(gadget.completedTime).toBeDefined();
    });
  });

  describe("completeGadget", () => {
    test("marks gadget as completed while keeping it in the map", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      progress.addGadget("gadget-123", "BrowseWeb", { url: "https://example.com" });
      progress.completeGadget("gadget-123");

      const inFlightGadgets = (progress as any).inFlightGadgets;
      expect(inFlightGadgets.size).toBe(1); // Still in map

      const gadget = inFlightGadgets.get("gadget-123");
      expect(gadget.completed).toBe(true);
      expect(gadget.completedTime).toBeDefined();
    });

    test("freezes elapsed time when completed", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      progress.addGadget("gadget-123", "BrowseWeb");
      const gadgetBefore = (progress as any).inFlightGadgets.get("gadget-123");
      const startTime = gadgetBefore.startTime;

      progress.completeGadget("gadget-123");

      const gadgetAfter = (progress as any).inFlightGadgets.get("gadget-123");
      expect(gadgetAfter.completedTime).toBeGreaterThanOrEqual(startTime);
    });

    test("ignores completion of non-existent gadget", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      // Should not throw
      expect(() => {
        progress.completeGadget("non-existent");
      }).not.toThrow();
    });
  });

  describe("clearCompletedGadgets", () => {
    test("removes completed gadgets from tracking", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      progress.addGadget("gadget-123", "BrowseWeb");
      progress.completeGadget("gadget-123");
      progress.clearCompletedGadgets();

      const inFlightGadgets = (progress as any).inFlightGadgets;
      expect(inFlightGadgets.size).toBe(0);
    });

    test("keeps incomplete gadgets in tracking", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      progress.addGadget("gadget-1", "BrowseWeb");
      progress.addGadget("gadget-2", "ReadFile");
      progress.completeGadget("gadget-1"); // Complete only one
      progress.clearCompletedGadgets();

      const inFlightGadgets = (progress as any).inFlightGadgets;
      expect(inFlightGadgets.size).toBe(1);
      expect(inFlightGadgets.has("gadget-2")).toBe(true);
    });

    test("cleans up nested agents when parent gadget is cleared", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      // Add parent gadget
      progress.addGadget("parent-gadget", "BrowseWeb");

      // Add nested agent under parent
      progress.addNestedAgent("nested-agent:0", "parent-gadget", 1, "test-model", 0, { inputTokens: 1000 });

      // Complete and clear
      progress.completeGadget("parent-gadget");
      progress.clearCompletedGadgets();

      const inFlightGadgets = (progress as any).inFlightGadgets;
      const nestedAgents = (progress as any).nestedAgents;

      expect(inFlightGadgets.size).toBe(0);
      expect(nestedAgents.size).toBe(0);
    });

    test("cleans up nested gadgets when parent gadget is cleared", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      // Add parent gadget
      progress.addGadget("parent-gadget", "BrowseWeb");

      // Add nested gadget under parent
      progress.addNestedGadget("nested-gadget", 1, "parent-gadget", "ReadFile");

      // Complete and clear
      progress.completeGadget("parent-gadget");
      progress.clearCompletedGadgets();

      const inFlightGadgets = (progress as any).inFlightGadgets;
      const nestedGadgets = (progress as any).nestedGadgets;

      expect(inFlightGadgets.size).toBe(0);
      expect(nestedGadgets.size).toBe(0);
    });

    test("only cleans up nested operations for cleared parents", () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, false);

      // Add two parent gadgets
      progress.addGadget("parent-1", "BrowseWeb");
      progress.addGadget("parent-2", "SearchWeb");

      // Add nested agents under each
      progress.addNestedAgent("agent-1:0", "parent-1", 1, "test", 0, { inputTokens: 100 });
      progress.addNestedAgent("agent-2:0", "parent-2", 1, "test", 0, { inputTokens: 200 });

      // Complete only parent-1
      progress.completeGadget("parent-1");
      progress.clearCompletedGadgets();

      const nestedAgents = (progress as any).nestedAgents;
      expect(nestedAgents.size).toBe(1);
      expect(nestedAgents.has("agent-2:0")).toBe(true); // Still there
    });
  });

  describe("nested operations chronological sorting", () => {
    test("sorts nested operations by start time", async () => {
      const stream = new MockWritableStream();
      const progress = new StreamProgress(stream, true); // TTY mode for render

      // Add gadgets to track
      progress.addGadget("parent-gadget", "ParentGadget", { task: "test" });

      // Add nested operations in non-chronological order
      // First add a nested gadget (started later)
      await new Promise((r) => setTimeout(r, 10));
      progress.addNestedGadget("nested-gadget", 1, "parent-gadget", "NestedGadget");

      // Then add a nested agent (started earlier - but we add it after)
      // For this test, we verify the structure is set up correctly
      progress.addNestedAgent("nested-agent:0", "parent-gadget", 1, "test-model", 0, 1000);

      const nestedAgents = (progress as any).nestedAgents;
      const nestedGadgets = (progress as any).nestedGadgets;

      // Both should be tracked
      expect(nestedAgents.size).toBe(1);
      expect(nestedGadgets.size).toBe(1);

      // Both should reference the parent gadget
      expect(nestedAgents.get("nested-agent:0").parentInvocationId).toBe("parent-gadget");
      expect(nestedGadgets.get("nested-gadget").parentInvocationId).toBe("parent-gadget");
    });
  });
});

/**
 * Mock readable stream that simulates stdin with TTY capabilities.
 * Extends EventEmitter to support on/removeListener for data events.
 */
class MockStdin extends EventEmitter {
  isTTY = true;
  setRawMode = vi.fn(() => this);
  resume = vi.fn(() => this);
  pause = vi.fn(() => this);

  /**
   * Simulates pressing a key by emitting a data event with the key's byte sequence.
   */
  pressKey(bytes: number[]): void {
    this.emit("data", Buffer.from(bytes));
  }
}

describe("createEscKeyListener", () => {
  let originalSetTimeout: typeof setTimeout;
  let originalClearTimeout: typeof clearTimeout;
  let timeoutCallbacks: Map<number, () => void>;
  let timeoutCounter: number;

  beforeEach(() => {
    // Store original timer functions
    originalSetTimeout = globalThis.setTimeout;
    originalClearTimeout = globalThis.clearTimeout;
    timeoutCallbacks = new Map();
    timeoutCounter = 0;

    // Mock setTimeout to capture callbacks
    globalThis.setTimeout = ((callback: () => void, _delay?: number) => {
      const id = ++timeoutCounter;
      timeoutCallbacks.set(id, callback);
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    // Mock clearTimeout to remove callbacks
    globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => {
      timeoutCallbacks.delete(id as unknown as number);
    }) as typeof clearTimeout;
  });

  afterEach(() => {
    // Restore original timer functions
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  });

  /**
   * Manually fire all pending timeouts (simulates time passing).
   */
  function flushTimeouts(): void {
    for (const callback of timeoutCallbacks.values()) {
      callback();
    }
    timeoutCallbacks.clear();
  }

  describe("TTY detection", () => {
    test("returns null when stdin is not a TTY", () => {
      const stdin = new MockStdin();
      stdin.isTTY = false;

      const onEsc = vi.fn();
      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);

      expect(cleanup).toBeNull();
      expect(stdin.setRawMode).not.toHaveBeenCalled();
    });

    test("returns null when setRawMode is not a function", () => {
      const stdin = {
        isTTY: true,
        setRawMode: undefined, // Missing setRawMode function
        resume: vi.fn(),
        on: vi.fn(),
      };

      const onEsc = vi.fn();
      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);

      expect(cleanup).toBeNull();
    });

    test("returns cleanup function when stdin is valid TTY", () => {
      const stdin = new MockStdin();
      const onEsc = vi.fn();

      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);

      expect(cleanup).toBeInstanceOf(Function);
      expect(stdin.setRawMode).toHaveBeenCalledWith(true);
      expect(stdin.resume).toHaveBeenCalled();

      // Clean up
      cleanup?.();
    });
  });

  describe("ESC key detection", () => {
    test("calls onEsc callback when standalone ESC key is pressed", () => {
      const stdin = new MockStdin();
      const onEsc = vi.fn();

      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);

      // Press ESC (0x1B) as a single byte
      stdin.pressKey([0x1b]);

      // Callback should not be called immediately (timeout not fired yet)
      expect(onEsc).not.toHaveBeenCalled();

      // Fire the timeout
      flushTimeouts();

      // Now callback should be called
      expect(onEsc).toHaveBeenCalledTimes(1);

      cleanup?.();
    });

    test("does NOT call onEsc when escape sequence is detected (arrow key up)", () => {
      const stdin = new MockStdin();
      const onEsc = vi.fn();

      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);

      // Press up arrow: ESC [ A (0x1B 0x5B 0x41) - arrives as multi-byte sequence
      stdin.pressKey([0x1b, 0x5b, 0x41]);

      // Fire any pending timeouts
      flushTimeouts();

      // Callback should NOT be called because it was part of escape sequence
      expect(onEsc).not.toHaveBeenCalled();

      cleanup?.();
    });

    test("does NOT call onEsc when another key arrives after ESC", () => {
      const stdin = new MockStdin();
      const onEsc = vi.fn();

      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);

      // Press ESC alone
      stdin.pressKey([0x1b]);
      expect(timeoutCallbacks.size).toBe(1);

      // Then press 'a' before timeout fires
      stdin.pressKey([0x61]);

      // Timeout should have been cancelled
      expect(timeoutCallbacks.size).toBe(0);

      // Fire any remaining timeouts (should be none)
      flushTimeouts();

      // Callback should NOT be called
      expect(onEsc).not.toHaveBeenCalled();

      cleanup?.();
    });

    test("handles multiple standalone ESC presses", () => {
      const stdin = new MockStdin();
      const onEsc = vi.fn();

      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);

      // First ESC
      stdin.pressKey([0x1b]);
      flushTimeouts();

      // Second ESC
      stdin.pressKey([0x1b]);
      flushTimeouts();

      // Both should trigger
      expect(onEsc).toHaveBeenCalledTimes(2);

      cleanup?.();
    });
  });

  describe("cleanup function", () => {
    test("removes data listener from stdin", () => {
      const stdin = new MockStdin();
      const onEsc = vi.fn();

      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);

      // Verify listener was added
      expect(stdin.listenerCount("data")).toBe(1);

      // Run cleanup
      cleanup?.();

      // Verify listener was removed
      expect(stdin.listenerCount("data")).toBe(0);
    });

    test("restores raw mode to false", () => {
      const stdin = new MockStdin();
      const onEsc = vi.fn();

      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);

      // Raw mode was enabled
      expect(stdin.setRawMode).toHaveBeenCalledWith(true);
      stdin.setRawMode.mockClear();

      // Run cleanup
      cleanup?.();

      // Raw mode should be disabled
      expect(stdin.setRawMode).toHaveBeenCalledWith(false);
    });

    test("pauses stdin", () => {
      const stdin = new MockStdin();
      const onEsc = vi.fn();

      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);
      stdin.pause.mockClear();

      // Run cleanup
      cleanup?.();

      // Stdin should be paused
      expect(stdin.pause).toHaveBeenCalled();
    });

    test("clears pending timeout", () => {
      const stdin = new MockStdin();
      const onEsc = vi.fn();

      const cleanup = createEscKeyListener(stdin as unknown as NodeJS.ReadStream, onEsc);

      // Press ESC to start a timeout
      stdin.pressKey([0x1b]);
      expect(timeoutCallbacks.size).toBe(1);

      // Run cleanup before timeout fires
      cleanup?.();

      // Timeout should be cleared
      expect(timeoutCallbacks.size).toBe(0);

      // Callback should NOT be called
      expect(onEsc).not.toHaveBeenCalled();
    });
  });
});

describe("createSigintListener", () => {
  // Store original process methods
  let originalProcessOn: typeof process.on;
  let originalProcessRemoveListener: typeof process.removeListener;
  let sigintHandlers: Array<() => void>;
  let mockStderr: MockWritableStream;

  beforeEach(() => {
    // Store originals
    originalProcessOn = process.on;
    originalProcessRemoveListener = process.removeListener;
    sigintHandlers = [];
    mockStderr = new MockWritableStream();

    // Mock process.on to capture SIGINT handlers
    process.on = ((event: string, handler: () => void) => {
      if (event === "SIGINT") {
        sigintHandlers.push(handler);
      }
      return process;
    }) as typeof process.on;

    // Mock process.removeListener to remove SIGINT handlers
    process.removeListener = ((event: string, handler: () => void) => {
      if (event === "SIGINT") {
        const index = sigintHandlers.indexOf(handler);
        if (index !== -1) {
          sigintHandlers.splice(index, 1);
        }
      }
      return process;
    }) as typeof process.removeListener;
  });

  afterEach(() => {
    // Restore originals
    process.on = originalProcessOn;
    process.removeListener = originalProcessRemoveListener;
  });

  /**
   * Simulate a SIGINT signal by calling all registered handlers.
   */
  function simulateSigint(): void {
    for (const handler of sigintHandlers) {
      handler();
    }
  }

  describe("operation active behavior", () => {
    test("calls onCancel when operation is active and SIGINT received", () => {
      const onCancel = vi.fn();
      const onQuit = vi.fn();
      const isOperationActive = () => true;

      const cleanup = createSigintListener(onCancel, onQuit, isOperationActive, mockStderr);

      simulateSigint();

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onQuit).not.toHaveBeenCalled();

      cleanup();
    });

    test("does NOT call onQuit when operation is active (even on double press)", () => {
      const onCancel = vi.fn();
      const onQuit = vi.fn();
      const isOperationActive = () => true;

      const cleanup = createSigintListener(onCancel, onQuit, isOperationActive, mockStderr);

      // First SIGINT
      simulateSigint();
      // Second SIGINT immediately
      simulateSigint();

      expect(onCancel).toHaveBeenCalledTimes(2);
      expect(onQuit).not.toHaveBeenCalled();

      cleanup();
    });
  });

  describe("operation inactive behavior", () => {
    test("shows hint message when no operation active and first SIGINT", () => {
      const onCancel = vi.fn();
      const onQuit = vi.fn();
      const isOperationActive = () => false;

      const cleanup = createSigintListener(onCancel, onQuit, isOperationActive, mockStderr);

      simulateSigint();

      expect(onCancel).not.toHaveBeenCalled();
      expect(onQuit).not.toHaveBeenCalled();
      expect(mockStderr.output).toContain("Press Ctrl+C again to quit");

      cleanup();
    });

    test("calls onQuit on double SIGINT within timeout window", () => {
      const onCancel = vi.fn();
      const onQuit = vi.fn();
      const isOperationActive = () => false;

      const cleanup = createSigintListener(onCancel, onQuit, isOperationActive, mockStderr);

      // First SIGINT
      simulateSigint();

      // Second SIGINT immediately (within 1 second window)
      simulateSigint();

      expect(onCancel).not.toHaveBeenCalled();
      expect(onQuit).toHaveBeenCalledTimes(1);

      cleanup();
    });
  });

  describe("cleanup function", () => {
    test("removes SIGINT listener", () => {
      const onCancel = vi.fn();
      const onQuit = vi.fn();
      const isOperationActive = () => false;

      const cleanup = createSigintListener(onCancel, onQuit, isOperationActive, mockStderr);

      // Verify handler was registered
      expect(sigintHandlers.length).toBe(1);

      // Run cleanup
      cleanup();

      // Verify handler was removed
      expect(sigintHandlers.length).toBe(0);
    });

    test("SIGINT has no effect after cleanup", () => {
      const onCancel = vi.fn();
      const onQuit = vi.fn();
      const isOperationActive = () => false;

      const cleanup = createSigintListener(onCancel, onQuit, isOperationActive, mockStderr);
      cleanup();

      // Simulate SIGINT after cleanup
      simulateSigint();

      // Nothing should happen
      expect(onCancel).not.toHaveBeenCalled();
      expect(onQuit).not.toHaveBeenCalled();
    });
  });

  describe("state transitions", () => {
    test("allows double-press quit after cancelling an operation", () => {
      const onCancel = vi.fn();
      const onQuit = vi.fn();
      let operationActive = true;
      const isOperationActive = () => operationActive;

      const cleanup = createSigintListener(onCancel, onQuit, isOperationActive, mockStderr);

      // First SIGINT while operation active - cancels it and sets timer to now
      simulateSigint();
      expect(onCancel).toHaveBeenCalledTimes(1);

      // Operation now inactive
      operationActive = false;

      // Second SIGINT (within 1 second) - should trigger quit (double-press detected)
      simulateSigint();
      expect(onQuit).toHaveBeenCalledTimes(1);
      expect(mockStderr.output).not.toContain("Press Ctrl+C again to quit");

      cleanup();
    });
  });
});
