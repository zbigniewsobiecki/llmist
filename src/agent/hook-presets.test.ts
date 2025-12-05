import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HookPresets } from "./hook-presets.js";
import type {
  ObserveGadgetCompleteContext,
  ObserveGadgetStartContext,
  ObserveLLMCallCompleteContext,
  ObserveLLMCallErrorContext,
  ObserveLLMCallStartContext,
} from "./hooks.js";

describe("HookPresets", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("logging preset", () => {
    it("logs LLM call start and complete", async () => {
      const hooks = HookPresets.logging();

      const startCtx: ObserveLLMCallStartContext = {
        iteration: 1,
        messages: [],
        options: { model: "gpt-4o" },
      };

      await hooks.observers?.onLLMCallStart?.(startCtx);

      expect(consoleLogSpy).toHaveBeenCalledWith("[LLM] Starting call (iteration 1)");

      const completeCtx: ObserveLLMCallCompleteContext = {
        iteration: 1,
        messages: [],
        options: { model: "gpt-4o" },
        response: { role: "assistant", content: "test" },
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finalMessage: "Response text",
      };

      await hooks.observers?.onLLMCallComplete?.(completeCtx);

      expect(consoleLogSpy).toHaveBeenCalledWith("[LLM] Completed (tokens: 15)");
    });

    it("logs with verbose details when enabled", async () => {
      const hooks = HookPresets.logging({ verbose: true });

      const completeCtx: ObserveLLMCallCompleteContext = {
        iteration: 1,
        messages: [],
        options: { model: "gpt-4o" },
        response: { role: "assistant", content: "test" },
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finalMessage: "The answer is 42",
      };

      await hooks.observers?.onLLMCallComplete?.(completeCtx);

      expect(consoleLogSpy).toHaveBeenCalledWith("[LLM] Response: The answer is 42");
    });

    it("logs gadget execution start and complete", async () => {
      const hooks = HookPresets.logging();

      const startCtx: ObserveGadgetStartContext = {
        gadgetName: "Calculator",
        parameters: { a: 5, b: 3 },
      };

      await hooks.observers?.onGadgetExecutionStart?.(startCtx);

      expect(consoleLogSpy).toHaveBeenCalledWith("[GADGET] Executing Calculator");

      const completeCtx: ObserveGadgetCompleteContext = {
        gadgetName: "Calculator",
        parameters: { a: 5, b: 3 },
        finalResult: "8",
      };

      await hooks.observers?.onGadgetExecutionComplete?.(completeCtx);

      expect(consoleLogSpy).toHaveBeenCalledWith("[GADGET] Completed Calculator");
    });

    it("logs gadget parameters and results with verbose mode", async () => {
      const hooks = HookPresets.logging({ verbose: true });

      const startCtx: ObserveGadgetStartContext = {
        gadgetName: "Calculator",
        parameters: { a: 5, b: 3 },
      };

      await hooks.observers?.onGadgetExecutionStart?.(startCtx);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        "[GADGET] Parameters:",
        JSON.stringify({ a: 5, b: 3 }, null, 2),
      );

      const completeCtx: ObserveGadgetCompleteContext = {
        gadgetName: "Calculator",
        parameters: { a: 5, b: 3 },
        finalResult: "8",
      };

      await hooks.observers?.onGadgetExecutionComplete?.(completeCtx);

      expect(consoleLogSpy).toHaveBeenCalledWith("[GADGET] Result: 8");
    });

    it("logs gadget errors in verbose mode", async () => {
      const hooks = HookPresets.logging({ verbose: true });

      const completeCtx: ObserveGadgetCompleteContext = {
        gadgetName: "Calculator",
        parameters: { a: 5, b: 0 },
        error: "Division by zero",
      };

      await hooks.observers?.onGadgetExecutionComplete?.(completeCtx);

      expect(consoleLogSpy).toHaveBeenCalledWith("[GADGET] Result: Division by zero");
    });

    it("handles unknown tokens gracefully", async () => {
      const hooks = HookPresets.logging();

      const completeCtx: ObserveLLMCallCompleteContext = {
        iteration: 1,
        messages: [],
        options: { model: "gpt-4o" },
        response: { role: "assistant", content: "test" },
        finalMessage: "Response",
      };

      await hooks.observers?.onLLMCallComplete?.(completeCtx);

      expect(consoleLogSpy).toHaveBeenCalledWith("[LLM] Completed (tokens: unknown)");
    });
  });

  describe("timing preset", () => {
    it("measures LLM call duration", async () => {
      const hooks = HookPresets.timing();

      const startCtx: ObserveLLMCallStartContext = {
        iteration: 1,
        messages: [],
        options: { model: "gpt-4o" },
      };

      await hooks.observers?.onLLMCallStart?.(startCtx);

      // Small delay to ensure some time passes
      await new Promise((resolve) => setTimeout(resolve, 10));

      const completeCtx: ObserveLLMCallCompleteContext = {
        iteration: 1,
        messages: [],
        options: { model: "gpt-4o" },
        response: { role: "assistant", content: "test" },
        finalMessage: "Response",
      };

      await hooks.observers?.onLLMCallComplete?.(completeCtx);

      // Just verify that timing was logged (not the exact value)
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("⏱️  LLM call took"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("ms"));
    });

    it("measures gadget execution duration", async () => {
      const hooks = HookPresets.timing();

      // Create context that will be shared between start and complete
      // (simulating how the actual hook system works)
      const ctx: any = {
        gadgetName: "Calculator",
        parameters: { a: 5, b: 3 },
      };

      await hooks.observers?.onGadgetExecutionStart?.(ctx);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Use the same context object so the timing key is preserved
      ctx.finalResult = "8";
      await hooks.observers?.onGadgetExecutionComplete?.(ctx);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("⏱️  Gadget Calculator took"),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("ms"));
    });

    it("handles multiple concurrent operations", async () => {
      const hooks = HookPresets.timing();

      // Create contexts that will be shared
      const ctx1: any = {
        gadgetName: "Op1",
        parameters: {},
      };
      const ctx2: any = {
        gadgetName: "Op2",
        parameters: {},
      };

      await hooks.observers?.onGadgetExecutionStart?.(ctx1);
      await hooks.observers?.onGadgetExecutionStart?.(ctx2);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Complete using same context objects
      ctx1.finalResult = "done";
      await hooks.observers?.onGadgetExecutionComplete?.(ctx1);

      ctx2.finalResult = "done";
      await hooks.observers?.onGadgetExecutionComplete?.(ctx2);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("⏱️  Gadget Op1 took"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("⏱️  Gadget Op2 took"));
    });
  });

  describe("tokenTracking preset", () => {
    it("tracks cumulative token usage", async () => {
      const hooks = HookPresets.tokenTracking();

      const ctx1: ObserveLLMCallCompleteContext = {
        iteration: 1,
        messages: [],
        options: { model: "gpt-4o" },
        response: { role: "assistant", content: "test" },
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finalMessage: "Response 1",
      };

      await hooks.observers?.onLLMCallComplete?.(ctx1);

      expect(consoleLogSpy).toHaveBeenCalledWith("📊 Tokens this call: 15");
      expect(consoleLogSpy).toHaveBeenCalledWith("📊 Total tokens: 15 (across 1 calls)");

      const ctx2: ObserveLLMCallCompleteContext = {
        iteration: 2,
        messages: [],
        options: { model: "gpt-4o" },
        response: { role: "assistant", content: "test" },
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        finalMessage: "Response 2",
      };

      await hooks.observers?.onLLMCallComplete?.(ctx2);

      expect(consoleLogSpy).toHaveBeenCalledWith("📊 Tokens this call: 30");
      expect(consoleLogSpy).toHaveBeenCalledWith("📊 Total tokens: 45 (across 2 calls)");
    });

    it("handles missing usage data", async () => {
      const hooks = HookPresets.tokenTracking();

      const ctx: ObserveLLMCallCompleteContext = {
        iteration: 1,
        messages: [],
        options: { model: "gpt-4o" },
        response: { role: "assistant", content: "test" },
        finalMessage: "Response",
      };

      await hooks.observers?.onLLMCallComplete?.(ctx);

      // Should not log anything when usage is missing
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe("errorLogging preset", () => {
    it("logs LLM errors with details", async () => {
      const hooks = HookPresets.errorLogging();

      const ctx: ObserveLLMCallErrorContext = {
        iteration: 1,
        messages: [],
        options: { model: "gpt-4o" },
        error: new Error("API rate limit exceeded"),
        recovered: false,
      };

      await hooks.observers?.onLLMCallError?.(ctx);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "❌ LLM Error (iteration 1):",
        "API rate limit exceeded",
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith("   Model: gpt-4o");
      expect(consoleErrorSpy).toHaveBeenCalledWith("   Recovered: false");
    });

    it("logs recovered errors", async () => {
      const hooks = HookPresets.errorLogging();

      const ctx: ObserveLLMCallErrorContext = {
        iteration: 2,
        messages: [],
        options: { model: "gpt-5-nano" },
        error: new Error("Temporary failure"),
        recovered: true,
      };

      await hooks.observers?.onLLMCallError?.(ctx);

      expect(consoleErrorSpy).toHaveBeenCalledWith("   Recovered: true");
    });

    it("logs gadget errors with parameters", async () => {
      const hooks = HookPresets.errorLogging();

      const ctx: ObserveGadgetCompleteContext = {
        gadgetName: "Calculator",
        parameters: { a: 10, b: 0 },
        error: "Division by zero",
      };

      await hooks.observers?.onGadgetExecutionComplete?.(ctx);

      expect(consoleErrorSpy).toHaveBeenCalledWith("❌ Gadget Error: Calculator");
      expect(consoleErrorSpy).toHaveBeenCalledWith("   Error: Division by zero");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "   Parameters:",
        JSON.stringify({ a: 10, b: 0 }, null, 2),
      );
    });

    it("does not log for successful gadget executions", async () => {
      const hooks = HookPresets.errorLogging();

      const ctx: ObserveGadgetCompleteContext = {
        gadgetName: "Calculator",
        parameters: { a: 5, b: 3 },
        finalResult: "8",
      };

      await hooks.observers?.onGadgetExecutionComplete?.(ctx);

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe("silent preset", () => {
    it("returns empty hook configuration", () => {
      const hooks = HookPresets.silent();

      expect(hooks).toEqual({});
    });
  });

  describe("merge", () => {
    it("merges multiple hook configurations", () => {
      const hooks1 = {
        observers: {
          onLLMCallStart: vi.fn(),
        },
      };

      const hooks2 = {
        observers: {
          onLLMCallComplete: vi.fn(),
        },
      };

      const merged = HookPresets.merge(hooks1, hooks2);

      expect(merged.observers).toHaveProperty("onLLMCallStart");
      expect(merged.observers).toHaveProperty("onLLMCallComplete");
    });

    it("composes hooks for same event (all handlers run)", async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const hooks1 = {
        observers: {
          onLLMCallStart: handler1,
        },
      };

      const hooks2 = {
        observers: {
          onLLMCallStart: handler2,
        },
      };

      const merged = HookPresets.merge(hooks1, hooks2);

      // Call the merged handler
      const ctx: ObserveLLMCallStartContext = {
        iteration: 1,
        messages: [],
        options: { model: "gpt-4o" },
      };

      await merged.observers?.onLLMCallStart?.(ctx);

      // Both handlers should have been called
      expect(handler1).toHaveBeenCalledWith(ctx);
      expect(handler2).toHaveBeenCalledWith(ctx);
    });

    it("merges interceptors and controllers", () => {
      const hooks1 = {
        interceptors: {
          beforeLLMCall: vi.fn(),
        },
      };

      const hooks2 = {
        controllers: {
          shouldContinue: vi.fn(),
        },
      };

      const merged = HookPresets.merge(hooks1, hooks2);

      expect(merged.interceptors).toHaveProperty("beforeLLMCall");
      expect(merged.controllers).toHaveProperty("shouldContinue");
    });

    it("handles empty hook sets", () => {
      const merged = HookPresets.merge({}, {}, {});

      expect(merged).toHaveProperty("observers");
      expect(merged).toHaveProperty("interceptors");
      expect(merged).toHaveProperty("controllers");
    });

    it("handles single hook set", () => {
      const hooks = {
        observers: {
          onLLMCallStart: vi.fn(),
        },
      };

      const merged = HookPresets.merge(hooks);

      expect(merged.observers).toHaveProperty("onLLMCallStart");
    });

    it("preserves all hooks when no overlaps", () => {
      const hooks1 = {
        observers: {
          onLLMCallStart: vi.fn(),
        },
      };

      const hooks2 = {
        observers: {
          onGadgetExecutionStart: vi.fn(),
        },
      };

      const hooks3 = {
        observers: {
          onLLMCallComplete: vi.fn(),
        },
      };

      const merged = HookPresets.merge(hooks1, hooks2, hooks3);

      expect(Object.keys(merged.observers ?? {})).toHaveLength(3);
    });
  });

  describe("progressTracking preset", () => {
    it("tracks gadget costs in totalCost", async () => {
      let lastStats: any = null;
      const hooks = HookPresets.progressTracking({
        onProgress: (stats) => {
          lastStats = stats;
        },
      });

      // Simulate gadget execution with cost
      const gadgetCtx: ObserveGadgetCompleteContext = {
        iteration: 1,
        gadgetName: "PaidAPI",
        invocationId: "test-1",
        parameters: { query: "test" },
        finalResult: "result",
        executionTimeMs: 100,
        cost: 0.001, // $0.001
      };

      await hooks.observers?.onGadgetExecutionComplete?.(gadgetCtx);

      // Simulate LLM call complete (which triggers onProgress)
      const llmCtx: ObserveLLMCallCompleteContext = {
        iteration: 1,
        messages: [],
        options: { model: "gpt-4o" },
        response: { role: "assistant", content: "test" },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        finalMessage: "Response",
      };

      await hooks.observers?.onLLMCallStart?.({ iteration: 1, messages: [], options: { model: "gpt-4o" } });
      await hooks.observers?.onLLMCallComplete?.(llmCtx);

      // Should include gadget cost in totalCost
      expect(lastStats).not.toBeNull();
      expect(lastStats.totalCost).toBeGreaterThanOrEqual(0.001);
    });

    it("accumulates multiple gadget costs", async () => {
      let lastStats: any = null;
      const hooks = HookPresets.progressTracking({
        onProgress: (stats) => {
          lastStats = stats;
        },
      });

      // Simulate multiple gadget executions with costs
      await hooks.observers?.onGadgetExecutionComplete?.({
        iteration: 1,
        gadgetName: "Gadget1",
        invocationId: "test-1",
        parameters: {},
        finalResult: "result",
        executionTimeMs: 50,
        cost: 0.001, // $0.001
      } as ObserveGadgetCompleteContext);

      await hooks.observers?.onGadgetExecutionComplete?.({
        iteration: 1,
        gadgetName: "Gadget2",
        invocationId: "test-2",
        parameters: {},
        finalResult: "result",
        executionTimeMs: 50,
        cost: 0.002, // $0.002
      } as ObserveGadgetCompleteContext);

      // Trigger progress callback via LLM call
      await hooks.observers?.onLLMCallStart?.({ iteration: 1, messages: [], options: { model: "gpt-4o" } });
      await hooks.observers?.onLLMCallComplete?.({
        iteration: 1,
        messages: [],
        options: { model: "gpt-4o" },
        response: { role: "assistant", content: "test" },
        finalMessage: "Response",
      } as ObserveLLMCallCompleteContext);

      // Total gadget cost should be $0.003
      expect(lastStats).not.toBeNull();
      expect(lastStats.totalCost).toBeGreaterThanOrEqual(0.003);
    });

    it("handles gadgets with zero or undefined cost", async () => {
      let lastStats: any = null;
      const hooks = HookPresets.progressTracking({
        onProgress: (stats) => {
          lastStats = stats;
        },
      });

      // Gadget with no cost (free)
      await hooks.observers?.onGadgetExecutionComplete?.({
        iteration: 1,
        gadgetName: "FreeGadget",
        invocationId: "test-1",
        parameters: {},
        finalResult: "result",
        executionTimeMs: 50,
      } as ObserveGadgetCompleteContext);

      // Gadget with explicit zero cost
      await hooks.observers?.onGadgetExecutionComplete?.({
        iteration: 1,
        gadgetName: "AlsoFree",
        invocationId: "test-2",
        parameters: {},
        finalResult: "result",
        executionTimeMs: 50,
        cost: 0,
      } as ObserveGadgetCompleteContext);

      // Gadget with actual cost
      await hooks.observers?.onGadgetExecutionComplete?.({
        iteration: 1,
        gadgetName: "Paid",
        invocationId: "test-3",
        parameters: {},
        finalResult: "result",
        executionTimeMs: 50,
        cost: 0.005,
      } as ObserveGadgetCompleteContext);

      // Trigger progress callback
      await hooks.observers?.onLLMCallStart?.({ iteration: 1, messages: [], options: { model: "gpt-4o" } });
      await hooks.observers?.onLLMCallComplete?.({
        iteration: 1,
        messages: [],
        options: { model: "gpt-4o" },
        response: { role: "assistant", content: "test" },
        finalMessage: "Response",
      } as ObserveLLMCallCompleteContext);

      // Only the paid gadget's cost should be counted
      expect(lastStats).not.toBeNull();
      expect(lastStats.totalCost).toBeGreaterThanOrEqual(0.005);
    });
  });

  describe("monitoring preset", () => {
    it("combines logging, timing, token tracking, and error logging", () => {
      const hooks = HookPresets.monitoring();

      expect(hooks.observers).toHaveProperty("onLLMCallStart");
      expect(hooks.observers).toHaveProperty("onLLMCallComplete");
      expect(hooks.observers).toHaveProperty("onLLMCallError");
      expect(hooks.observers).toHaveProperty("onGadgetExecutionStart");
      expect(hooks.observers).toHaveProperty("onGadgetExecutionComplete");
    });

    it("passes options to logging preset", () => {
      const hooks = HookPresets.monitoring({ verbose: true });

      // The monitoring preset should include all the combined hooks
      expect(hooks.observers).toBeTruthy();
    });

    it("provides comprehensive monitoring in integration", async () => {
      const hooks = HookPresets.monitoring({ verbose: true });

      // Use shared context for timing to work correctly
      const llmCtx: any = {
        iteration: 1,
        messages: [],
        options: { model: "gpt-4o" },
      };

      // Call start first
      await hooks.observers?.onLLMCallStart?.(llmCtx);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Then call complete with same context
      llmCtx.response = { role: "assistant", content: "test" };
      llmCtx.usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
      llmCtx.finalMessage = "Test response";

      await hooks.observers?.onLLMCallComplete?.(llmCtx);

      // Should log from all composed presets (logging, timing, tokenTracking)
      expect(consoleLogSpy).toHaveBeenCalledWith("[LLM] Completed (tokens: 15)");
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("⏱️  LLM call took"));
      expect(consoleLogSpy).toHaveBeenCalledWith("📊 Tokens this call: 15");
    });
  });
});
