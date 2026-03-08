import { Writable } from "node:stream";
import type { ModelRegistry } from "llmist";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CallStatsTracker } from "./call-stats-tracker.js";
import { GadgetTracker } from "./gadget-tracker.js";
import { NestedOperationTracker } from "./nested-operation-tracker.js";
import { ProgressRenderer } from "./progress-renderer.js";

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
 * Create a renderer with all required dependencies.
 */
function createRenderer(
  stream: MockWritableStream,
  isTTY: boolean,
  options?: {
    registry?: ModelRegistry;
  },
): {
  renderer: ProgressRenderer;
  callStatsTracker: CallStatsTracker;
  gadgetTracker: GadgetTracker;
  nestedOperationTracker: NestedOperationTracker;
} {
  const callStatsTracker = new CallStatsTracker(options?.registry);
  const gadgetTracker = new GadgetTracker();
  const nestedOperationTracker = new NestedOperationTracker(options?.registry);
  const renderer = new ProgressRenderer(
    stream,
    isTTY,
    callStatsTracker,
    gadgetTracker,
    nestedOperationTracker,
  );
  return { renderer, callStatsTracker, gadgetTracker, nestedOperationTracker };
}

describe("ProgressRenderer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("start", () => {
    test("does not start when isTTY is false", () => {
      const stream = new MockWritableStream();
      const { renderer } = createRenderer(stream, false);

      vi.advanceTimersByTime(1000);
      renderer.start();
      vi.advanceTimersByTime(1000);

      // Non-TTY mode should not write anything
      expect(stream.output).toBe("");

      renderer.complete();
    });

    test("does not write immediately due to delay", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, true);

      callStatsTracker.startCall("gpt-4", 1000);
      renderer.start();

      // No output yet (within delay window)
      expect(stream.output).toBe("");

      renderer.complete();
    });

    test("writes output after spinner delay (500ms)", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, true);

      callStatsTracker.startCall("gpt-4", 1000);
      renderer.start();

      vi.advanceTimersByTime(500);
      vi.advanceTimersByTime(80); // One render interval

      expect(stream.output).not.toBe("");

      renderer.complete();
    });

    test("does not start twice when already running", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, true);

      callStatsTracker.startCall("gpt-4", 1000);
      renderer.start();
      renderer.start(); // Second start - should be ignored

      vi.advanceTimersByTime(600);
      vi.advanceTimersByTime(80);

      renderer.complete();
      // No assertion on output content, just verifying it doesn't error
    });
  });

  describe("pause", () => {
    test("does not throw when pausing before starting", () => {
      const stream = new MockWritableStream();
      const { renderer } = createRenderer(stream, true);
      expect(() => renderer.pause()).not.toThrow();
    });

    test("stops rendering after pause", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, true);

      callStatsTracker.startCall("gpt-4", 1000);
      renderer.start();

      vi.advanceTimersByTime(600);
      vi.advanceTimersByTime(80);

      const outputBeforePause = stream.output;
      renderer.pause();

      stream.clear();
      vi.advanceTimersByTime(500);

      // No new output after pause
      expect(stream.output).toBe("");
      expect(outputBeforePause).toBeDefined(); // Had output before pause
    });

    test("does nothing when not TTY", () => {
      const stream = new MockWritableStream();
      const { renderer } = createRenderer(stream, false);
      expect(() => renderer.pause()).not.toThrow();
    });
  });

  describe("complete", () => {
    test("completes without throwing", () => {
      const stream = new MockWritableStream();
      const { renderer } = createRenderer(stream, true);
      expect(() => renderer.complete()).not.toThrow();
    });

    test("is equivalent to pause", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, true);

      callStatsTracker.startCall("gpt-4", 1000);
      renderer.start();
      vi.advanceTimersByTime(600);
      vi.advanceTimersByTime(80);

      renderer.complete();
      stream.clear();
      vi.advanceTimersByTime(500);

      expect(stream.output).toBe("");
    });
  });

  describe("triggerRender", () => {
    test("does nothing when not running", () => {
      const stream = new MockWritableStream();
      const { renderer } = createRenderer(stream, true);

      renderer.triggerRender();
      expect(stream.output).toBe("");
    });

    test("does nothing in non-TTY mode", () => {
      const stream = new MockWritableStream();
      const { renderer } = createRenderer(stream, false);

      renderer.triggerRender();
      expect(stream.output).toBe("");
    });

    test("writes output when renderer is running in TTY mode", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, true);

      callStatsTracker.startCall("gpt-4", 1000);
      renderer.start();

      // Advance past the delay
      vi.advanceTimersByTime(600);
      vi.advanceTimersByTime(80);

      stream.clear();
      renderer.triggerRender();

      expect(stream.output).not.toBe("");

      renderer.complete();
    });
  });

  describe("clearAndReset", () => {
    test("does not throw when called before rendering", () => {
      const stream = new MockWritableStream();
      const { renderer } = createRenderer(stream, true);
      expect(() => renderer.clearAndReset()).not.toThrow();
    });

    test("does not throw in non-TTY mode", () => {
      const stream = new MockWritableStream();
      const { renderer } = createRenderer(stream, false);
      expect(() => renderer.clearAndReset()).not.toThrow();
    });
  });

  describe("formatStats", () => {
    test("returns formatted string with elapsed time", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, false);

      callStatsTracker.startCall("gpt-4", 1000);
      vi.advanceTimersByTime(5000);

      const stats = renderer.formatStats();
      expect(stats).toContain("5.0s");
    });

    test("includes input tokens when available", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, false);

      callStatsTracker.startCall("gpt-4", 1000);
      callStatsTracker.setInputTokens(1000, false);

      const stats = renderer.formatStats();
      expect(stats).toContain("↑");
      expect(stats).toContain("1.0k");
    });

    test("includes output tokens when available", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, false);

      callStatsTracker.startCall("gpt-4", 1000);
      callStatsTracker.setOutputTokens(500, false);

      const stats = renderer.formatStats();
      expect(stats).toContain("↓");
      expect(stats).toContain("500");
    });

    test("includes ~ prefix for estimated input tokens", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, false);

      callStatsTracker.startCall("gpt-4", 1000); // estimated by default
      callStatsTracker.setInputTokens(1000, true);

      const stats = renderer.formatStats();
      expect(stats).toContain("~");
    });

    test("does not include tokens when zero", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, false);

      callStatsTracker.startCall("gpt-4");

      const stats = renderer.formatStats();
      // Should just have elapsed time
      expect(stats).toContain("s");
      expect(stats).not.toContain("↑");
    });

    test("joins parts with | separator", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, false);

      callStatsTracker.startCall("gpt-4", 1000);
      callStatsTracker.setInputTokens(1000, false);
      callStatsTracker.setOutputTokens(500, false);

      const stats = renderer.formatStats();
      expect(stats).toContain(" | ");
    });
  });

  describe("formatPrompt", () => {
    test("returns prompt ending with > in streaming mode", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, false);

      callStatsTracker.startCall("gpt-4", 1000);
      const prompt = renderer.formatPrompt();
      expect(prompt).toContain(">");
    });

    test("returns prompt ending with > in cumulative mode", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, false);

      callStatsTracker.startCall("gpt-4", 1000);
      callStatsTracker.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      const prompt = renderer.formatPrompt();
      expect(prompt).toContain(">");
    });

    test("shows current call stats in streaming mode", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, false);

      callStatsTracker.startCall("gpt-4", 1000);
      callStatsTracker.setInputTokens(896, false);
      callStatsTracker.setOutputTokens(118, false);

      const prompt = renderer.formatPrompt();
      expect(prompt).toContain("896");
      expect(prompt).toContain("118");
    });

    test("does not show ~ for actual token counts in streaming mode", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, false);

      callStatsTracker.startCall("gpt-4", 1000);
      callStatsTracker.setInputTokens(896, false);
      callStatsTracker.setOutputTokens(118, false);

      const prompt = renderer.formatPrompt();
      expect(prompt).not.toContain("~");
    });

    test("shows ~ for estimated tokens in streaming mode", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, false);

      callStatsTracker.startCall("gpt-4", 1000); // estimated input
      // No explicit setInputTokens call - stays estimated

      const prompt = renderer.formatPrompt();
      expect(prompt).toContain("~");
    });

    test("shows cumulative stats in cumulative mode", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, false);

      callStatsTracker.startCall("gpt-4", 1000);
      callStatsTracker.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      const prompt = renderer.formatPrompt();
      // Should show total tokens and iteration count
      expect(prompt).toContain("1.5k"); // total tokens 1500
      expect(prompt).toContain("i1"); // 1 iteration
    });

    test("includes cost in cumulative mode when cost > 0", () => {
      const registry = new MockModelRegistry();
      registry.setCost("gpt-4", 30, 60);

      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, false, {
        registry: registry as unknown as ModelRegistry,
      });

      callStatsTracker.startCall("gpt-4", 1000);
      callStatsTracker.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      const prompt = renderer.formatPrompt();
      expect(prompt).toContain("$");
    });

    test("does not include cost in cumulative mode when cost is 0", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, false);

      callStatsTracker.startCall("gpt-4", 1000);
      callStatsTracker.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      const prompt = renderer.formatPrompt();
      expect(prompt).not.toContain("$");
    });

    test("shows elapsed seconds in cumulative mode", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, false);

      callStatsTracker.startCall("gpt-4", 1000);
      vi.advanceTimersByTime(5000);
      callStatsTracker.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      const prompt = renderer.formatPrompt();
      expect(prompt).toContain("5s");
    });
  });

  describe("rendering content", () => {
    test("renders streaming mode content with spinner", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, true);

      callStatsTracker.startCall("gpt-4", 1000);
      renderer.start();

      vi.advanceTimersByTime(600);
      vi.advanceTimersByTime(80);

      // Content should include spinner character and model info
      expect(stream.output).toContain("gpt-4");

      renderer.complete();
    });

    test("renders cumulative mode content without active streaming", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, true);

      callStatsTracker.startCall("gpt-4", 1000);
      callStatsTracker.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      renderer.start();
      vi.advanceTimersByTime(600);
      vi.advanceTimersByTime(80);

      expect(stream.output).toContain("gpt-4");

      renderer.complete();
    });
  });

  describe("multi-line rendering", () => {
    test("renders gadget info when gadgets are in flight", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker, gadgetTracker } = createRenderer(stream, true);

      callStatsTracker.startCall("gpt-4", 1000);
      gadgetTracker.addGadget("inv-1", "BrowseWeb", { url: "https://example.com" });

      renderer.start();
      vi.advanceTimersByTime(600);
      vi.advanceTimersByTime(80);

      expect(stream.output).toContain("BrowseWeb");

      renderer.complete();
    });

    test("does not render completed gadgets in the spinner area", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker, gadgetTracker } = createRenderer(stream, true);

      callStatsTracker.startCall("gpt-4", 1000);
      gadgetTracker.addGadget("inv-1", "CompletedGadget");
      gadgetTracker.completeGadget("inv-1");

      renderer.start();
      vi.advanceTimersByTime(600);
      vi.advanceTimersByTime(80);

      // Completed gadgets should NOT appear in the rendered output
      expect(stream.output).not.toContain("CompletedGadget");

      renderer.complete();
    });

    test("renders nested gadgets under parent", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker, gadgetTracker, nestedOperationTracker } = createRenderer(
        stream,
        true,
      );

      callStatsTracker.startCall("gpt-4", 1000);
      gadgetTracker.addGadget("parent-1", "BrowseWeb");
      nestedOperationTracker.addNestedGadget("nested-1", 1, "parent-1", "ReadFile");

      renderer.start();
      vi.advanceTimersByTime(600);
      vi.advanceTimersByTime(80);

      expect(stream.output).toContain("BrowseWeb");
      expect(stream.output).toContain("ReadFile");

      renderer.complete();
    });

    test("skips completed nested gadgets in the spinner area", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker, gadgetTracker, nestedOperationTracker } = createRenderer(
        stream,
        true,
      );

      callStatsTracker.startCall("gpt-4", 1000);
      gadgetTracker.addGadget("parent-1", "BrowseWeb");
      nestedOperationTracker.addNestedGadget("nested-1", 1, "parent-1", "CompletedNestedGadget");
      nestedOperationTracker.completeNestedGadget("nested-1");

      renderer.start();
      vi.advanceTimersByTime(600);
      vi.advanceTimersByTime(80);

      expect(stream.output).not.toContain("CompletedNestedGadget");

      renderer.complete();
    });
  });

  describe("non-TTY mode", () => {
    test("start does nothing in non-TTY mode", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, false);

      callStatsTracker.startCall("gpt-4", 1000);
      renderer.start();
      vi.advanceTimersByTime(1000);

      expect(stream.output).toBe("");

      renderer.complete();
    });

    test("formatStats still works in non-TTY mode", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, false);

      callStatsTracker.startCall("gpt-4", 1000);
      callStatsTracker.setInputTokens(1000, false);

      const stats = renderer.formatStats();
      expect(stats).toContain("↑");
    });

    test("formatPrompt still works in non-TTY mode", () => {
      const stream = new MockWritableStream();
      const { renderer, callStatsTracker } = createRenderer(stream, false);

      callStatsTracker.startCall("gpt-4", 1000);
      callStatsTracker.endCall({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

      const prompt = renderer.formatPrompt();
      expect(prompt).toContain(">");
    });
  });
});
