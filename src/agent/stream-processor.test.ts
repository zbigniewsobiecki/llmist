import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { z } from "zod";

import { GADGET_ARG_PREFIX, GADGET_END_PREFIX, GADGET_START_PREFIX } from "../core/constants.js";
import { BreakLoopException } from "../gadgets/exceptions.js";
import { resetGlobalInvocationCounter } from "../gadgets/parser.js";
import { GadgetRegistry } from "../gadgets/registry.js";
import { createMockGadget, mockGadget } from "../testing/mock-gadget.js";
import {
  createEmptyStream,
  createTestStream,
  createTextStream,
} from "../testing/stream-helpers.js";
import type { AgentHooks } from "./hooks.js";
import { StreamProcessor } from "./stream-processor.js";

// Helper to create a gadget call string
// Supports optional invocation ID and dependencies via the new syntax:
// - gadgetName → auto ID, no deps
// - gadgetName:id → explicit ID, no deps
// - gadgetName:id:dep1,dep2 → explicit ID with deps
function createGadgetCallString(
  gadgetName: string,
  params: Record<string, string> = {},
  options?: { invocationId?: string; dependencies?: string[] },
): string {
  let header = gadgetName;
  if (options?.invocationId) {
    header += `:${options.invocationId}`;
    if (options.dependencies && options.dependencies.length > 0) {
      header += `:${options.dependencies.join(",")}`;
    }
  }
  let result = `${GADGET_START_PREFIX}${header}\n`;
  for (const [key, value] of Object.entries(params)) {
    result += `${GADGET_ARG_PREFIX}${key}\n${value}\n`;
  }
  result += GADGET_END_PREFIX;
  return result;
}

describe("StreamProcessor", () => {
  let registry: GadgetRegistry;

  beforeEach(() => {
    registry = new GadgetRegistry();
    resetGlobalInvocationCounter();
  });

  afterEach(() => {
    registry.clear();
  });

  describe("Constructor & Configuration", () => {
    it("creates with minimal options", () => {
      const processor = new StreamProcessor({ iteration: 1, registry });

      expect(processor).toBeDefined();
    });

    it("creates with custom prefixes", () => {
      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        gadgetStartPrefix: "<<<START:",
        gadgetEndPrefix: "<<<END",
        gadgetArgPrefix: "<<<ARG:",
      });

      expect(processor).toBeDefined();
    });

    it("creates with hooks", () => {
      const hooks: AgentHooks = {
        observers: { onStreamChunk: () => {} },
        interceptors: { interceptRawChunk: (c) => c },
        controllers: { beforeGadgetExecution: async () => ({ action: "proceed" }) },
      };

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks,
      });

      expect(processor).toBeDefined();
    });

    it("creates with stopOnGadgetError=true (default)", async () => {
      const errorGadget = createMockGadget({ name: "ErrorGadget", error: "Test error" });
      registry.registerByClass(errorGadget);

      const processor = new StreamProcessor({ iteration: 1, registry });
      const gadgetCall = createGadgetCallString("ErrorGadget");
      const stream = createTextStream(gadgetCall);

      const result = await processor.process(stream);

      // Should have gadget_call and gadget_result with error
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(1);
      expect(
        gadgetResults[0].type === "gadget_result" && gadgetResults[0].result.error,
      ).toBeDefined();
    });

    it("creates with stopOnGadgetError=false", async () => {
      const errorGadget = createMockGadget({ name: "ErrorGadget", error: "Test error" });
      const okGadget = createMockGadget({ name: "OkGadget", result: "OK" });
      registry.registerByClass(errorGadget);
      registry.registerByClass(okGadget);

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        stopOnGadgetError: false,
      });

      // Two gadget calls in sequence
      const gadgetCalls =
        createGadgetCallString("ErrorGadget") + "\n" + createGadgetCallString("OkGadget");
      const stream = createTextStream(gadgetCalls);

      const result = await processor.process(stream);

      // Both gadgets should have been processed
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(2);
    });

    it("creates with custom shouldContinueAfterError callback", async () => {
      const errorGadget = createMockGadget({ name: "RecoverableError", error: "recoverable" });
      const okGadget = createMockGadget({ name: "AfterError", result: "OK" });
      registry.registerByClass(errorGadget);
      registry.registerByClass(okGadget);

      const shouldContinue = mock((ctx: { error: string }) => ctx.error.includes("recoverable"));

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        shouldContinueAfterError: shouldContinue,
      });

      const gadgetCalls =
        createGadgetCallString("RecoverableError") + "\n" + createGadgetCallString("AfterError");
      const stream = createTextStream(gadgetCalls);

      const result = await processor.process(stream);

      expect(shouldContinue).toHaveBeenCalled();
      // Should continue because error is "recoverable"
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(2);
    });
  });

  describe("Main process() Method", () => {
    it("processes empty stream", async () => {
      const processor = new StreamProcessor({ iteration: 1, registry });
      const stream = createEmptyStream();

      const result = await processor.process(stream);

      expect(result.outputs).toHaveLength(0);
      expect(result.didExecuteGadgets).toBe(false);
      expect(result.shouldBreakLoop).toBe(false);
      expect(result.finishReason).toBeNull();
      expect(result.rawResponse).toBe("");
      expect(result.finalMessage).toBe("");
    });

    it("processes stream with only text", async () => {
      const processor = new StreamProcessor({ iteration: 1, registry });
      const stream = createTextStream("Hello, world!");

      const result = await processor.process(stream);

      const textEvents = result.outputs.filter((e) => e.type === "text");
      expect(textEvents).toHaveLength(1);
      expect(textEvents[0].type === "text" && textEvents[0].content).toBe("Hello, world!");
      expect(result.didExecuteGadgets).toBe(false);
      expect(result.rawResponse).toBe("Hello, world!");
    });

    it("captures finishReason from stream chunks", async () => {
      const processor = new StreamProcessor({ iteration: 1, registry });
      const stream = createTestStream([
        { text: "Hello" },
        { text: " world", finishReason: "end_turn" },
      ]);

      const result = await processor.process(stream);

      expect(result.finishReason).toBe("end_turn");
    });

    it("captures token usage from stream chunks", async () => {
      const processor = new StreamProcessor({ iteration: 1, registry });
      const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
      const stream = createTestStream([
        { text: "Hello", usage },
        { text: " world", finishReason: "stop" },
      ]);

      const result = await processor.process(stream);

      expect(result.usage).toEqual(usage);
    });

    it("accumulates text across multiple chunks", async () => {
      const processor = new StreamProcessor({ iteration: 1, registry });
      const stream = createTextStream("Hello world", { chunkSize: 3 });

      const result = await processor.process(stream);

      expect(result.rawResponse).toBe("Hello world");
    });

    it("returns rawResponse before interceptors", async () => {
      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: {
          interceptors: {
            interceptAssistantMessage: (msg) => msg.toUpperCase(),
          },
        },
      });
      const stream = createTextStream("hello world");

      const result = await processor.process(stream);

      expect(result.rawResponse).toBe("hello world");
      expect(result.finalMessage).toBe("HELLO WORLD");
    });
  });

  describe("Interceptor: interceptRawChunk", () => {
    it("transforms chunk when interceptor provided", async () => {
      const interceptRawChunk = mock((chunk: string) => chunk.toUpperCase());

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { interceptors: { interceptRawChunk } },
      });
      const stream = createTextStream("hello");

      const result = await processor.process(stream);

      expect(interceptRawChunk).toHaveBeenCalledWith("hello", expect.any(Object));
      expect(result.rawResponse).toBe("HELLO");
    });

    it("suppresses chunk when interceptor returns null", async () => {
      const interceptRawChunk = mock(() => null);

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { interceptors: { interceptRawChunk } },
      });
      const stream = createTextStream("hello");

      const result = await processor.process(stream);

      expect(result.rawResponse).toBe("");
      expect(result.outputs).toHaveLength(0);
    });

    it("provides correct context", async () => {
      let capturedContext: unknown;
      const interceptRawChunk = mock((chunk: string, ctx: unknown) => {
        capturedContext = ctx;
        return chunk;
      });

      const processor = new StreamProcessor({
        iteration: 5,
        registry,
        hooks: { interceptors: { interceptRawChunk } },
      });
      const stream = createTextStream("test");

      await processor.process(stream);

      expect(capturedContext).toMatchObject({
        iteration: 5,
        accumulatedText: "",
      });
      expect((capturedContext as { logger: unknown }).logger).toBeDefined();
    });
  });

  describe("Observer: onStreamChunk", () => {
    it("calls observer for text chunks", async () => {
      const onStreamChunk = mock(async () => {});

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { observers: { onStreamChunk } },
      });
      const stream = createTextStream("hello", { chunkSize: 2 });

      await processor.process(stream);

      expect(onStreamChunk).toHaveBeenCalled();
    });

    it("calls observer for usage updates even without text", async () => {
      const onStreamChunk = mock(async () => {});

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { observers: { onStreamChunk } },
      });
      const stream = createTestStream([
        { text: "" },
        { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      ]);

      await processor.process(stream);

      expect(onStreamChunk).toHaveBeenCalled();
    });

    it("provides correct context to observer", async () => {
      let capturedContext: unknown;
      const onStreamChunk = mock(async (ctx: unknown) => {
        capturedContext = ctx;
      });

      const processor = new StreamProcessor({
        iteration: 3,
        registry,
        hooks: { observers: { onStreamChunk } },
      });
      const stream = createTextStream("test");

      await processor.process(stream);

      expect(capturedContext).toMatchObject({
        iteration: 3,
        rawChunk: "test",
      });
    });

    it("continues processing if observer throws", async () => {
      const onStreamChunk = mock(async () => {
        throw new Error("Observer error");
      });

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { observers: { onStreamChunk } },
      });
      const stream = createTextStream("hello world");

      const result = await processor.process(stream);

      // Should still process successfully
      expect(result.rawResponse).toBe("hello world");
    });
  });

  describe("Gadget Call Processing", () => {
    it("emits gadget_call event when gadget parsed", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", result: "done" });
      registry.registerByClass(testGadget);

      const processor = new StreamProcessor({ iteration: 1, registry });
      const stream = createTextStream(createGadgetCallString("TestGadget"));

      const result = await processor.process(stream);

      const gadgetCalls = result.outputs.filter((e) => e.type === "gadget_call");
      expect(gadgetCalls).toHaveLength(1);
      expect(gadgetCalls[0].type === "gadget_call" && gadgetCalls[0].call.gadgetName).toBe(
        "TestGadget",
      );
    });

    it("emits gadget_result event after execution", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", result: "test result" });
      registry.registerByClass(testGadget);

      const processor = new StreamProcessor({ iteration: 1, registry });
      const stream = createTextStream(createGadgetCallString("TestGadget"));

      const result = await processor.process(stream);

      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(1);
      expect(gadgetResults[0].type === "gadget_result" && gadgetResults[0].result.result).toBe(
        "test result",
      );
    });

    it("sets didExecuteGadgets=true when gadget executed", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", result: "done" });
      registry.registerByClass(testGadget);

      const processor = new StreamProcessor({ iteration: 1, registry });
      const stream = createTextStream(createGadgetCallString("TestGadget"));

      const result = await processor.process(stream);

      expect(result.didExecuteGadgets).toBe(true);
    });

    it("handles unknown gadget gracefully", async () => {
      const processor = new StreamProcessor({ iteration: 1, registry });
      const stream = createTextStream(createGadgetCallString("UnknownGadget"));

      const result = await processor.process(stream);

      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(1);
      expect(gadgetResults[0].type === "gadget_result" && gadgetResults[0].result.error).toContain(
        "not found",
      );
    });
  });

  describe("Interceptor: interceptGadgetParameters", () => {
    it("transforms parameters before execution", async () => {
      const testGadget = createMockGadget({
        name: "EchoGadget",
        schema: z.object({ message: z.string() }),
        resultFn: (p) => `Echo: ${p.message}`,
      });
      registry.registerByClass(testGadget);

      const interceptGadgetParameters = mock((params: Record<string, unknown>) => ({
        ...params,
        message: "intercepted",
      }));

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { interceptors: { interceptGadgetParameters } },
      });

      const gadgetCall = createGadgetCallString("EchoGadget", { message: "original" });
      const stream = createTextStream(gadgetCall);

      const result = await processor.process(stream);

      expect(interceptGadgetParameters).toHaveBeenCalled();
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults[0].type === "gadget_result" && gadgetResults[0].result.result).toBe(
        "Echo: intercepted",
      );
    });

    it("provides correct context", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", result: "done" });
      registry.registerByClass(testGadget);

      let capturedContext: unknown;
      const interceptGadgetParameters = mock((params: Record<string, unknown>, ctx: unknown) => {
        capturedContext = ctx;
        return params;
      });

      const processor = new StreamProcessor({
        iteration: 7,
        registry,
        hooks: { interceptors: { interceptGadgetParameters } },
      });
      const stream = createTextStream(createGadgetCallString("TestGadget"));

      await processor.process(stream);

      expect(capturedContext).toMatchObject({
        iteration: 7,
        gadgetName: "TestGadget",
      });
      expect((capturedContext as { invocationId: string }).invocationId).toBeDefined();
    });
  });

  describe("Controller: beforeGadgetExecution", () => {
    it("proceeds with execution when action='proceed'", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", result: "executed" });
      registry.registerByClass(testGadget);

      const beforeGadgetExecution = mock(async () => ({ action: "proceed" as const }));

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { controllers: { beforeGadgetExecution } },
      });
      const stream = createTextStream(createGadgetCallString("TestGadget"));

      const result = await processor.process(stream);

      expect(beforeGadgetExecution).toHaveBeenCalled();
      expect(testGadget.getCallCount()).toBe(1);
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults[0].type === "gadget_result" && gadgetResults[0].result.result).toBe(
        "executed",
      );
    });

    it("skips execution when action='skip'", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", result: "executed" });
      registry.registerByClass(testGadget);

      const beforeGadgetExecution = mock(async () => ({
        action: "skip" as const,
        syntheticResult: "skipped by controller",
      }));

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { controllers: { beforeGadgetExecution } },
      });
      const stream = createTextStream(createGadgetCallString("TestGadget"));

      const result = await processor.process(stream);

      expect(testGadget.getCallCount()).toBe(0);
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults[0].type === "gadget_result" && gadgetResults[0].result.result).toBe(
        "skipped by controller",
      );
    });

    it("sets executionTimeMs=0 for skipped gadgets", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", result: "executed", delayMs: 100 });
      registry.registerByClass(testGadget);

      const beforeGadgetExecution = mock(async () => ({
        action: "skip" as const,
        syntheticResult: "skipped",
      }));

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { controllers: { beforeGadgetExecution } },
      });
      const stream = createTextStream(createGadgetCallString("TestGadget"));

      const result = await processor.process(stream);

      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(
        gadgetResults[0].type === "gadget_result" && gadgetResults[0].result.executionTimeMs,
      ).toBe(0);
    });

    it("uses provided syntheticResult when skipping", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", result: "executed" });
      registry.registerByClass(testGadget);

      const beforeGadgetExecution = mock(async () => ({
        action: "skip" as const,
        syntheticResult: "Custom skip message",
      }));

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { controllers: { beforeGadgetExecution } },
      });
      const stream = createTextStream(createGadgetCallString("TestGadget"));

      const result = await processor.process(stream);

      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults[0].type === "gadget_result" && gadgetResults[0].result.result).toBe(
        "Custom skip message",
      );
    });
  });

  describe("Observer: onGadgetExecutionStart", () => {
    it("calls observer before execution", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", result: "done" });
      registry.registerByClass(testGadget);

      let startObserverCalled = false;
      const onGadgetExecutionStart = mock(async () => {
        startObserverCalled = true;
        expect(testGadget.getCallCount()).toBe(0); // Not executed yet
      });

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { observers: { onGadgetExecutionStart } },
      });
      const stream = createTextStream(createGadgetCallString("TestGadget"));

      await processor.process(stream);

      expect(startObserverCalled).toBe(true);
      expect(testGadget.getCallCount()).toBe(1);
    });

    it("provides correct context", async () => {
      const testGadget = createMockGadget({
        name: "TestGadget",
        schema: z.object({ value: z.string() }),
        result: "done",
      });
      registry.registerByClass(testGadget);

      let capturedContext: unknown;
      const onGadgetExecutionStart = mock(async (ctx: unknown) => {
        capturedContext = ctx;
      });

      const processor = new StreamProcessor({
        iteration: 4,
        registry,
        hooks: { observers: { onGadgetExecutionStart } },
      });
      const stream = createTextStream(createGadgetCallString("TestGadget", { value: "test" }));

      await processor.process(stream);

      expect(capturedContext).toMatchObject({
        iteration: 4,
        gadgetName: "TestGadget",
        parameters: { value: "test" },
      });
    });

    it("handles observer errors gracefully", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", result: "done" });
      registry.registerByClass(testGadget);

      const onGadgetExecutionStart = mock(async () => {
        throw new Error("Observer error");
      });

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { observers: { onGadgetExecutionStart } },
      });
      const stream = createTextStream(createGadgetCallString("TestGadget"));

      const result = await processor.process(stream);

      // Execution should still complete
      expect(testGadget.getCallCount()).toBe(1);
      expect(result.didExecuteGadgets).toBe(true);
    });
  });

  describe("Interceptor: interceptGadgetResult", () => {
    it("transforms result after execution", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", result: "original" });
      registry.registerByClass(testGadget);

      const interceptGadgetResult = mock((result: string) => `[modified] ${result}`);

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { interceptors: { interceptGadgetResult } },
      });
      const stream = createTextStream(createGadgetCallString("TestGadget"));

      const result = await processor.process(stream);

      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults[0].type === "gadget_result" && gadgetResults[0].result.result).toBe(
        "[modified] original",
      );
    });

    it("provides execution time in context", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", result: "done", delayMs: 10 });
      registry.registerByClass(testGadget);

      let capturedContext: unknown;
      const interceptGadgetResult = mock((result: string, ctx: unknown) => {
        capturedContext = ctx;
        return result;
      });

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { interceptors: { interceptGadgetResult } },
      });
      const stream = createTextStream(createGadgetCallString("TestGadget"));

      await processor.process(stream);

      expect(
        (capturedContext as { executionTimeMs: number }).executionTimeMs,
      ).toBeGreaterThanOrEqual(10);
    });
  });

  describe("Controller: afterGadgetExecution", () => {
    it("continues normally when action='continue'", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", result: "original" });
      registry.registerByClass(testGadget);

      const afterGadgetExecution = mock(async () => ({ action: "continue" as const }));

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { controllers: { afterGadgetExecution } },
      });
      const stream = createTextStream(createGadgetCallString("TestGadget"));

      const result = await processor.process(stream);

      expect(afterGadgetExecution).toHaveBeenCalled();
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults[0].type === "gadget_result" && gadgetResults[0].result.result).toBe(
        "original",
      );
    });

    it("recovers from error when action='recover'", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", error: "Original error" });
      registry.registerByClass(testGadget);

      const afterGadgetExecution = mock(async (ctx: { error?: string }) => {
        if (ctx.error) {
          return { action: "recover" as const, fallbackResult: "recovered successfully" };
        }
        return { action: "continue" as const };
      });

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { controllers: { afterGadgetExecution } },
      });
      const stream = createTextStream(createGadgetCallString("TestGadget"));

      const result = await processor.process(stream);

      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(
        gadgetResults[0].type === "gadget_result" && gadgetResults[0].result.error,
      ).toBeUndefined();
      expect(gadgetResults[0].type === "gadget_result" && gadgetResults[0].result.result).toBe(
        "recovered successfully",
      );
    });

    it("clears error when recovering", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", error: "Original error" });
      registry.registerByClass(testGadget);

      const afterGadgetExecution = mock(async () => ({
        action: "recover" as const,
        fallbackResult: "fallback",
      }));

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { controllers: { afterGadgetExecution } },
      });
      const stream = createTextStream(createGadgetCallString("TestGadget"));

      const result = await processor.process(stream);

      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(
        gadgetResults[0].type === "gadget_result" && gadgetResults[0].result.error,
      ).toBeUndefined();
    });
  });

  describe("Observer: onGadgetExecutionComplete", () => {
    it("calls observer after execution", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", result: "done" });
      registry.registerByClass(testGadget);

      const onGadgetExecutionComplete = mock(async () => {});

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { observers: { onGadgetExecutionComplete } },
      });
      const stream = createTextStream(createGadgetCallString("TestGadget"));

      await processor.process(stream);

      expect(onGadgetExecutionComplete).toHaveBeenCalled();
    });

    it("provides both originalResult and finalResult", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", result: "original" });
      registry.registerByClass(testGadget);

      let capturedContext: unknown;
      const onGadgetExecutionComplete = mock(async (ctx: unknown) => {
        capturedContext = ctx;
      });

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: {
          observers: { onGadgetExecutionComplete },
          interceptors: {
            interceptGadgetResult: (r) => `[modified] ${r}`,
          },
        },
      });
      const stream = createTextStream(createGadgetCallString("TestGadget"));

      await processor.process(stream);

      const ctx = capturedContext as { originalResult: string; finalResult: string };
      expect(ctx.originalResult).toBe("original");
      expect(ctx.finalResult).toBe("[modified] original");
    });

    it("includes breaksLoop flag", async () => {
      const breakingGadget = createMockGadget({
        name: "BreakGadget",
        resultFn: () => {
          throw new BreakLoopException("Done!");
        },
      });
      registry.registerByClass(breakingGadget);

      let capturedContext: unknown;
      const onGadgetExecutionComplete = mock(async (ctx: unknown) => {
        capturedContext = ctx;
      });

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { observers: { onGadgetExecutionComplete } },
      });
      const stream = createTextStream(createGadgetCallString("BreakGadget"));

      await processor.process(stream);

      expect((capturedContext as { breaksLoop: boolean }).breaksLoop).toBe(true);
    });
  });

  describe("Loop Termination", () => {
    it("sets shouldBreakLoop when gadget result has breaksLoop=true", async () => {
      const breakingGadget = createMockGadget({
        name: "BreakGadget",
        resultFn: () => {
          throw new BreakLoopException("Loop terminated");
        },
      });
      registry.registerByClass(breakingGadget);

      const processor = new StreamProcessor({ iteration: 1, registry });
      const stream = createTextStream(createGadgetCallString("BreakGadget"));

      const result = await processor.process(stream);

      expect(result.shouldBreakLoop).toBe(true);
    });

    it("stops processing subsequent gadgets when shouldStopExecution", async () => {
      const errorGadget = createMockGadget({ name: "ErrorGadget", error: "Stop!" });
      const afterGadget = createMockGadget({ name: "AfterGadget", result: "should not run" });
      registry.registerByClass(errorGadget);
      registry.registerByClass(afterGadget);

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        stopOnGadgetError: true,
      });

      const gadgetCalls =
        createGadgetCallString("ErrorGadget") + "\n" + createGadgetCallString("AfterGadget");
      const stream = createTextStream(gadgetCalls);

      const result = await processor.process(stream);

      // Only one gadget result (ErrorGadget)
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(1);
      expect(afterGadget.getCallCount()).toBe(0);
    });
  });

  describe("Interceptor: interceptTextChunk", () => {
    it("transforms text chunk", async () => {
      const interceptTextChunk = mock((chunk: string) => chunk.toUpperCase());

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { interceptors: { interceptTextChunk } },
      });
      const stream = createTextStream("hello");

      const result = await processor.process(stream);

      const textEvents = result.outputs.filter((e) => e.type === "text");
      expect(textEvents[0].type === "text" && textEvents[0].content).toBe("HELLO");
    });

    it("suppresses text chunk when returns null", async () => {
      const interceptTextChunk = mock(() => null);

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { interceptors: { interceptTextChunk } },
      });
      const stream = createTextStream("hello");

      const result = await processor.process(stream);

      const textEvents = result.outputs.filter((e) => e.type === "text");
      expect(textEvents).toHaveLength(0);
      // Raw response still captures the original
      expect(result.rawResponse).toBe("hello");
    });
  });

  describe("Interceptor: interceptAssistantMessage", () => {
    it("transforms final message", async () => {
      const interceptAssistantMessage = mock((msg: string) => `[TRANSFORMED] ${msg}`);

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        hooks: { interceptors: { interceptAssistantMessage } },
      });
      const stream = createTextStream("hello world");

      const result = await processor.process(stream);

      expect(interceptAssistantMessage).toHaveBeenCalledWith("hello world", expect.any(Object));
      expect(result.finalMessage).toBe("[TRANSFORMED] hello world");
      expect(result.rawResponse).toBe("hello world");
    });

    it("provides correct context", async () => {
      let capturedContext: unknown;
      const interceptAssistantMessage = mock((msg: string, ctx: unknown) => {
        capturedContext = ctx;
        return msg;
      });

      const processor = new StreamProcessor({
        iteration: 9,
        registry,
        hooks: { interceptors: { interceptAssistantMessage } },
      });
      const stream = createTextStream("test message");

      await processor.process(stream);

      expect(capturedContext).toMatchObject({
        iteration: 9,
        rawResponse: "test message",
      });
    });
  });

  describe("Error Type Classification", () => {
    it("classifies validation errors correctly", async () => {
      const testGadget = createMockGadget({
        name: "ValidatedGadget",
        schema: z.object({ required: z.string() }),
        result: "done",
      });
      registry.registerByClass(testGadget);

      const processor = new StreamProcessor({ iteration: 1, registry });
      // Missing required parameter
      const stream = createTextStream(createGadgetCallString("ValidatedGadget"));

      const result = await processor.process(stream);

      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults[0].type === "gadget_result" && gadgetResults[0].result.error).toContain(
        "Invalid parameters",
      );
    });
  });

  describe("Multiple Gadget Execution", () => {
    it("processes multiple gadgets in sequence", async () => {
      const gadget1 = createMockGadget({ name: "Gadget1", result: "result1" });
      const gadget2 = createMockGadget({ name: "Gadget2", result: "result2" });
      registry.registerByClass(gadget1);
      registry.registerByClass(gadget2);

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        stopOnGadgetError: false,
      });

      const gadgetCalls =
        createGadgetCallString("Gadget1") + "\n" + createGadgetCallString("Gadget2");
      const stream = createTextStream(gadgetCalls);

      const result = await processor.process(stream);

      expect(gadget1.getCallCount()).toBe(1);
      expect(gadget2.getCallCount()).toBe(1);
      expect(result.didExecuteGadgets).toBe(true);

      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(2);
    });

    it("handles mixed text and gadget content", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", result: "gadget result" });
      registry.registerByClass(testGadget);

      const processor = new StreamProcessor({ iteration: 1, registry });
      const content = `Some text before\n${createGadgetCallString("TestGadget")}\nSome text after`;
      const stream = createTextStream(content);

      const result = await processor.process(stream);

      const textEvents = result.outputs.filter((e) => e.type === "text");
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");

      expect(textEvents.length).toBeGreaterThan(0);
      expect(gadgetResults).toHaveLength(1);
    });
  });

  describe("Custom Prefixes", () => {
    it("works with custom gadget prefixes", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", result: "custom prefix result" });
      registry.registerByClass(testGadget);

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        gadgetStartPrefix: "<<<TOOL:",
        gadgetEndPrefix: "<<<END",
        gadgetArgPrefix: "<<<PARAM:",
      });

      const customGadgetCall = `<<<TOOL:TestGadget
<<<PARAM:name
test value
<<<END`;
      const stream = createTextStream(customGadgetCall);

      const result = await processor.process(stream);

      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(1);
      expect(gadgetResults[0].type === "gadget_result" && gadgetResults[0].result.result).toBe(
        "custom prefix result",
      );
    });
  });

  describe("Gadget Dependencies", () => {
    it("executes gadget without dependencies immediately", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", result: "immediate" });
      registry.registerByClass(testGadget);

      const processor = new StreamProcessor({ iteration: 1, registry });
      const gadgetCall = createGadgetCallString(
        "TestGadget",
        { name: "test" },
        { invocationId: "g1" },
      );
      const stream = createTextStream(gadgetCall);

      const result = await processor.process(stream);

      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(1);
      expect(
        gadgetResults[0].type === "gadget_result" && gadgetResults[0].result.invocationId,
      ).toBe("g1");
    });

    it("executes dependent gadget after dependency completes", async () => {
      const executionOrder: string[] = [];
      const gadgetA = createMockGadget({
        name: "GadgetA",
        resultFn: async () => {
          executionOrder.push("A");
          return "result_a";
        },
      });
      const gadgetB = createMockGadget({
        name: "GadgetB",
        resultFn: async () => {
          executionOrder.push("B");
          return "result_b";
        },
      });
      registry.registerByClass(gadgetA);
      registry.registerByClass(gadgetB);

      const processor = new StreamProcessor({ iteration: 1, registry });

      // B depends on A, but A comes first in stream
      const gadgetCalls =
        createGadgetCallString("GadgetA", {}, { invocationId: "a1" }) +
        "\n" +
        createGadgetCallString("GadgetB", {}, { invocationId: "b1", dependencies: ["a1"] });

      const stream = createTextStream(gadgetCalls);
      const result = await processor.process(stream);

      // Both should execute
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(2);

      // A should execute before B
      expect(executionOrder).toEqual(["A", "B"]);
    });

    it("defers execution when dependency not yet complete", async () => {
      const executionOrder: string[] = [];
      const gadgetA = createMockGadget({
        name: "GadgetA",
        resultFn: async () => {
          executionOrder.push("A");
          return "result_a";
        },
      });
      const gadgetB = createMockGadget({
        name: "GadgetB",
        resultFn: async () => {
          executionOrder.push("B");
          return "result_b";
        },
      });
      registry.registerByClass(gadgetA);
      registry.registerByClass(gadgetB);

      const processor = new StreamProcessor({ iteration: 1, registry });

      // B is declared first but depends on A which comes second
      const gadgetCalls =
        createGadgetCallString("GadgetB", {}, { invocationId: "b1", dependencies: ["a1"] }) +
        "\n" +
        createGadgetCallString("GadgetA", {}, { invocationId: "a1" });

      const stream = createTextStream(gadgetCalls);
      const result = await processor.process(stream);

      // Both should execute, but A runs first (dependency)
      expect(executionOrder).toEqual(["A", "B"]);

      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(2);
    });

    it("skips gadget when dependency fails", async () => {
      const errorGadget = createMockGadget({ name: "ErrorGadget", error: "Dependency failed" });
      const dependentGadget = createMockGadget({
        name: "DependentGadget",
        result: "should_not_run",
      });
      registry.registerByClass(errorGadget);
      registry.registerByClass(dependentGadget);

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        stopOnGadgetError: false, // Don't stop so we can test skip behavior
      });

      const gadgetCalls =
        createGadgetCallString("ErrorGadget", {}, { invocationId: "err1" }) +
        "\n" +
        createGadgetCallString(
          "DependentGadget",
          {},
          { invocationId: "dep1", dependencies: ["err1"] },
        );

      const stream = createTextStream(gadgetCalls);
      const result = await processor.process(stream);

      // Should have one gadget_result (error) and one gadget_skipped
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      const skippedEvents = result.outputs.filter((e) => e.type === "gadget_skipped");

      expect(gadgetResults).toHaveLength(1);
      expect(skippedEvents).toHaveLength(1);

      if (skippedEvents[0].type === "gadget_skipped") {
        expect(skippedEvents[0].gadgetName).toBe("DependentGadget");
        expect(skippedEvents[0].failedDependency).toBe("err1");
      }
    });

    it("propagates failure to transitive dependents", async () => {
      const errorGadget = createMockGadget({ name: "ErrorGadget", error: "Root failure" });
      const gadgetB = createMockGadget({ name: "GadgetB", result: "b" });
      const gadgetC = createMockGadget({ name: "GadgetC", result: "c" });
      registry.registerByClass(errorGadget);
      registry.registerByClass(gadgetB);
      registry.registerByClass(gadgetC);

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        stopOnGadgetError: false,
      });

      // Chain: A (error) -> B -> C
      const gadgetCalls =
        createGadgetCallString("ErrorGadget", {}, { invocationId: "a1" }) +
        "\n" +
        createGadgetCallString("GadgetB", {}, { invocationId: "b1", dependencies: ["a1"] }) +
        "\n" +
        createGadgetCallString("GadgetC", {}, { invocationId: "c1", dependencies: ["b1"] });

      const stream = createTextStream(gadgetCalls);
      const result = await processor.process(stream);

      // A executes with error, B and C are skipped
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      const skippedEvents = result.outputs.filter((e) => e.type === "gadget_skipped");

      expect(gadgetResults).toHaveLength(1); // Just A
      expect(skippedEvents).toHaveLength(2); // B and C skipped
    });

    it("executes pending gadgets in parallel when their dependencies complete", async () => {
      const startTimes: Record<string, number> = {};
      const endTimes: Record<string, number> = {};

      const createDelayedGadget = (name: string, delayMs: number) =>
        createMockGadget({
          name,
          resultFn: async () => {
            startTimes[name] = Date.now();
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            endTimes[name] = Date.now();
            return `${name}_result`;
          },
        });

      // Root gadget is fast
      const root = createMockGadget({ name: "Root", result: "root_result" });
      // B and C are slow and both depend on Root
      const gadgetB = createDelayedGadget("GadgetB", 50);
      const gadgetC = createDelayedGadget("GadgetC", 50);
      registry.registerByClass(root);
      registry.registerByClass(gadgetB);
      registry.registerByClass(gadgetC);

      const processor = new StreamProcessor({ iteration: 1, registry });

      // B and C both depend on Root - they should execute in parallel after Root completes
      const gadgetCalls = [
        createGadgetCallString("GadgetB", {}, { invocationId: "b1", dependencies: ["root1"] }),
        createGadgetCallString("GadgetC", {}, { invocationId: "c1", dependencies: ["root1"] }),
        createGadgetCallString("Root", {}, { invocationId: "root1" }),
      ].join("\n");

      const stream = createTextStream(gadgetCalls);

      const startTime = Date.now();
      await processor.process(stream);
      const totalTime = Date.now() - startTime;

      // B and C should run in parallel after Root (~50ms each but parallel, not ~100ms sequential)
      // Allow tolerance for test execution overhead
      expect(totalTime).toBeLessThan(90);
    });

    it("handles diamond dependency pattern correctly", async () => {
      const executionOrder: string[] = [];
      const createTrackingGadget = (name: string) =>
        createMockGadget({
          name,
          resultFn: async () => {
            executionOrder.push(name);
            return `${name}_result`;
          },
        });

      registry.registerByClass(createTrackingGadget("A"));
      registry.registerByClass(createTrackingGadget("B"));
      registry.registerByClass(createTrackingGadget("C"));
      registry.registerByClass(createTrackingGadget("D"));

      const processor = new StreamProcessor({ iteration: 1, registry });

      // Diamond: A -> B, A -> C, B -> D, C -> D
      const gadgetCalls = [
        createGadgetCallString("A", {}, { invocationId: "a1" }),
        createGadgetCallString("B", {}, { invocationId: "b1", dependencies: ["a1"] }),
        createGadgetCallString("C", {}, { invocationId: "c1", dependencies: ["a1"] }),
        createGadgetCallString("D", {}, { invocationId: "d1", dependencies: ["b1", "c1"] }),
      ].join("\n");

      const stream = createTextStream(gadgetCalls);
      const result = await processor.process(stream);

      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(4);

      // A must execute first
      expect(executionOrder[0]).toBe("A");
      // D must execute last
      expect(executionOrder[3]).toBe("D");
      // B and C can be in either order (parallel)
      expect(executionOrder.slice(1, 3).sort()).toEqual(["B", "C"]);
    });

    it("handles missing dependency reference gracefully", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", result: "test" });
      registry.registerByClass(testGadget);

      const processor = new StreamProcessor({ iteration: 1, registry });

      // Reference a non-existent dependency
      const gadgetCall = createGadgetCallString(
        "TestGadget",
        {},
        {
          invocationId: "t1",
          dependencies: ["nonexistent"],
        },
      );

      const stream = createTextStream(gadgetCall);
      const result = await processor.process(stream);

      // Should be skipped due to unresolvable dependency
      const skippedEvents = result.outputs.filter((e) => e.type === "gadget_skipped");
      expect(skippedEvents).toHaveLength(1);
      if (skippedEvents[0].type === "gadget_skipped") {
        expect(skippedEvents[0].failedDependencyError).toContain("never executed");
      }
    });

    it("calls onDependencySkipped controller", async () => {
      const errorGadget = createMockGadget({ name: "ErrorGadget", error: "Test error" });
      const dependentGadget = createMockGadget({
        name: "DependentGadget",
        result: "should_not_run",
      });
      registry.registerByClass(errorGadget);
      registry.registerByClass(dependentGadget);

      const onDependencySkipped = mock(async () => ({ action: "skip" as const }));

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        stopOnGadgetError: false,
        hooks: {
          controllers: { onDependencySkipped },
        },
      });

      const gadgetCalls =
        createGadgetCallString("ErrorGadget", {}, { invocationId: "err1" }) +
        "\n" +
        createGadgetCallString(
          "DependentGadget",
          {},
          { invocationId: "dep1", dependencies: ["err1"] },
        );

      const stream = createTextStream(gadgetCalls);
      await processor.process(stream);

      expect(onDependencySkipped).toHaveBeenCalledTimes(1);
      expect(onDependencySkipped.mock.calls[0][0]).toMatchObject({
        gadgetName: "DependentGadget",
        invocationId: "dep1",
        failedDependency: "err1",
      });
    });

    it("controller can override skip with execute_anyway", async () => {
      const errorGadget = createMockGadget({ name: "ErrorGadget", error: "Test error" });
      const dependentGadget = createMockGadget({
        name: "DependentGadget",
        result: "executed_anyway",
      });
      registry.registerByClass(errorGadget);
      registry.registerByClass(dependentGadget);

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        stopOnGadgetError: false,
        hooks: {
          controllers: {
            onDependencySkipped: async () => ({ action: "execute_anyway" }),
          },
        },
      });

      const gadgetCalls =
        createGadgetCallString("ErrorGadget", {}, { invocationId: "err1" }) +
        "\n" +
        createGadgetCallString(
          "DependentGadget",
          {},
          { invocationId: "dep1", dependencies: ["err1"] },
        );

      const stream = createTextStream(gadgetCalls);
      const result = await processor.process(stream);

      // Both should have results (no skip)
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(2);

      const dependentResult = gadgetResults.find(
        (e) => e.type === "gadget_result" && e.result.invocationId === "dep1",
      );
      expect(dependentResult?.type === "gadget_result" && dependentResult.result.result).toBe(
        "executed_anyway",
      );
    });

    it("controller can provide fallback result", async () => {
      const errorGadget = createMockGadget({ name: "ErrorGadget", error: "Test error" });
      const dependentGadget = createMockGadget({
        name: "DependentGadget",
        result: "should_not_run",
      });
      registry.registerByClass(errorGadget);
      registry.registerByClass(dependentGadget);

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        stopOnGadgetError: false,
        hooks: {
          controllers: {
            onDependencySkipped: async () => ({
              action: "use_fallback",
              fallbackResult: "fallback_value",
            }),
          },
        },
      });

      const gadgetCalls =
        createGadgetCallString("ErrorGadget", {}, { invocationId: "err1" }) +
        "\n" +
        createGadgetCallString(
          "DependentGadget",
          {},
          { invocationId: "dep1", dependencies: ["err1"] },
        );

      const stream = createTextStream(gadgetCalls);
      const result = await processor.process(stream);

      // Both should have results
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(2);

      const dependentResult = gadgetResults.find(
        (e) => e.type === "gadget_result" && e.result.invocationId === "dep1",
      );
      expect(dependentResult?.type === "gadget_result" && dependentResult.result.result).toBe(
        "fallback_value",
      );
    });

    it("calls onGadgetSkipped observer", async () => {
      const errorGadget = createMockGadget({ name: "ErrorGadget", error: "Test error" });
      const dependentGadget = createMockGadget({
        name: "DependentGadget",
        result: "should_not_run",
      });
      registry.registerByClass(errorGadget);
      registry.registerByClass(dependentGadget);

      const onGadgetSkipped = mock(() => {});

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        stopOnGadgetError: false,
        hooks: {
          observers: { onGadgetSkipped },
        },
      });

      const gadgetCalls =
        createGadgetCallString("ErrorGadget", {}, { invocationId: "err1" }) +
        "\n" +
        createGadgetCallString(
          "DependentGadget",
          {},
          { invocationId: "dep1", dependencies: ["err1"] },
        );

      const stream = createTextStream(gadgetCalls);
      await processor.process(stream);

      expect(onGadgetSkipped).toHaveBeenCalledTimes(1);
      expect(onGadgetSkipped.mock.calls[0][0]).toMatchObject({
        gadgetName: "DependentGadget",
        invocationId: "dep1",
        failedDependency: "err1",
      });
    });
  });
});
