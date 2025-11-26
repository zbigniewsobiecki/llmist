import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import type { ModelRegistry } from "../core/model-registry.js";
import { StreamProgress } from "./utils.js";
import { formatCost } from "./ui/formatters.js";

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
  ):
    | { inputCost: number; outputCost: number; totalCost: number }
    | undefined {
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
