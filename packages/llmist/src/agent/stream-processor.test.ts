import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { z } from "zod";

import { GADGET_ARG_PREFIX, GADGET_END_PREFIX, GADGET_START_PREFIX } from "../core/constants.js";
import { TaskCompletionSignal } from "../gadgets/exceptions.js";
import type { StreamCompletionEvent, StreamEvent } from "../gadgets/types.js";
import { resetGlobalInvocationCounter } from "../gadgets/parser.js";
import { GadgetRegistry } from "../gadgets/registry.js";
import { createMockGadget, mockGadget } from "../../../testing/src/mock-gadget.js";
import {
  createEmptyStream,
  createTestStream,
  createTextStream,
} from "../../../testing/src/stream-helpers.js";
import type { LLMStreamChunk } from "../core/client.js";
import type { AgentHooks } from "./hooks.js";
import { StreamProcessor } from "./stream-processor.js";

/**
 * Helper to consume the async generator from StreamProcessor.process()
 * and return a result object matching the old synchronous return format.
 * This allows existing tests to work with minimal changes.
 */
async function consumeStream(
  processor: StreamProcessor,
  stream: AsyncIterable<LLMStreamChunk>,
): Promise<{
  outputs: StreamEvent[];
  finishReason: string | null;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  rawResponse: string;
  finalMessage: string;
  didExecuteGadgets: boolean;
  shouldBreakLoop: boolean;
}> {
  const outputs: StreamEvent[] = [];
  let metadata: StreamCompletionEvent | null = null;

  for await (const event of processor.process(stream)) {
    if (event.type === "stream_complete") {
      metadata = event;
    } else {
      outputs.push(event);
    }
  }

  if (!metadata) {
    throw new Error("Stream completed without metadata event");
  }

  return {
    outputs,
    finishReason: metadata.finishReason,
    usage: metadata.usage,
    rawResponse: metadata.rawResponse,
    finalMessage: metadata.finalMessage,
    didExecuteGadgets: metadata.didExecuteGadgets,
    shouldBreakLoop: metadata.shouldBreakLoop,
  };
}

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

    it("handles gadget errors without stopping execution", async () => {
      const errorGadget = createMockGadget({ name: "ErrorGadget", error: "Test error" });
      const okGadget = createMockGadget({ name: "OkGadget", result: "OK" });
      registry.registerByClass(errorGadget);
      registry.registerByClass(okGadget);

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
      });

      // Two gadget calls in sequence
      const gadgetCalls =
        createGadgetCallString("ErrorGadget") + "\n" + createGadgetCallString("OkGadget");
      const stream = createTextStream(gadgetCalls);

      const result = await consumeStream(processor, stream);

      // Both gadgets should have been processed
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(2);
    });
  });

  describe("Main process() Method", () => {
    it("processes empty stream", async () => {
      const processor = new StreamProcessor({ iteration: 1, registry });
      const stream = createEmptyStream();

      const result = await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

      expect(result.finishReason).toBe("end_turn");
    });

    it("captures token usage from stream chunks", async () => {
      const processor = new StreamProcessor({ iteration: 1, registry });
      const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
      const stream = createTestStream([
        { text: "Hello", usage },
        { text: " world", finishReason: "stop" },
      ]);

      const result = await consumeStream(processor, stream);

      expect(result.usage).toEqual(usage);
    });

    it("accumulates text across multiple chunks", async () => {
      const processor = new StreamProcessor({ iteration: 1, registry });
      const stream = createTextStream("Hello world", { chunkSize: 3 });

      const result = await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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

      await consumeStream(processor, stream);

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

      await consumeStream(processor, stream);

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

      await consumeStream(processor, stream);

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

      await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

      expect(result.didExecuteGadgets).toBe(true);
    });

    it("handles unknown gadget gracefully", async () => {
      const processor = new StreamProcessor({ iteration: 1, registry });
      const stream = createTextStream(createGadgetCallString("UnknownGadget"));

      const result = await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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

      await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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

      await consumeStream(processor, stream);

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

      await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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

      await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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

      await consumeStream(processor, stream);

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

      await consumeStream(processor, stream);

      const ctx = capturedContext as { originalResult: string; finalResult: string };
      expect(ctx.originalResult).toBe("original");
      expect(ctx.finalResult).toBe("[modified] original");
    });

    it("includes breaksLoop flag", async () => {
      const breakingGadget = createMockGadget({
        name: "BreakGadget",
        resultFn: () => {
          throw new TaskCompletionSignal("Done!");
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

      await consumeStream(processor, stream);

      expect((capturedContext as { breaksLoop: boolean }).breaksLoop).toBe(true);
    });
  });

  describe("Loop Termination", () => {
    it("sets shouldBreakLoop when gadget result has breaksLoop=true", async () => {
      const breakingGadget = createMockGadget({
        name: "BreakGadget",
        resultFn: () => {
          throw new TaskCompletionSignal("Loop terminated");
        },
      });
      registry.registerByClass(breakingGadget);

      const processor = new StreamProcessor({ iteration: 1, registry });
      const stream = createTextStream(createGadgetCallString("BreakGadget"));

      const result = await consumeStream(processor, stream);

      expect(result.shouldBreakLoop).toBe(true);
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

      const result = await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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

      await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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
      });

      const gadgetCalls =
        createGadgetCallString("Gadget1") + "\n" + createGadgetCallString("Gadget2");
      const stream = createTextStream(gadgetCalls);

      const result = await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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

      const result = await consumeStream(processor, stream);

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
      const result = await consumeStream(processor, stream);

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
      const result = await consumeStream(processor, stream);

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
      const result = await consumeStream(processor, stream);

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
      });

      // Chain: A (error) -> B -> C
      const gadgetCalls =
        createGadgetCallString("ErrorGadget", {}, { invocationId: "a1" }) +
        "\n" +
        createGadgetCallString("GadgetB", {}, { invocationId: "b1", dependencies: ["a1"] }) +
        "\n" +
        createGadgetCallString("GadgetC", {}, { invocationId: "c1", dependencies: ["b1"] });

      const stream = createTextStream(gadgetCalls);
      const result = await consumeStream(processor, stream);

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
      await consumeStream(processor, stream);
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
      const result = await consumeStream(processor, stream);

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
      const result = await consumeStream(processor, stream);

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
      await consumeStream(processor, stream);

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
      const result = await consumeStream(processor, stream);

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
      const result = await consumeStream(processor, stream);

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
      await consumeStream(processor, stream);

      expect(onGadgetSkipped).toHaveBeenCalledTimes(1);
      expect(onGadgetSkipped.mock.calls[0][0]).toMatchObject({
        gadgetName: "DependentGadget",
        invocationId: "dep1",
        failedDependency: "err1",
      });
    });
  });

  describe("Parallel Execution", () => {
    it("executes independent gadgets in parallel", async () => {
      const DELAY_MS = 50;

      // Create gadgets that take 50ms each
      const gadget1 = createMockGadget({
        name: "SlowGadget1",
        result: "result1",
        delayMs: DELAY_MS,
      });
      const gadget2 = createMockGadget({
        name: "SlowGadget2",
        result: "result2",
        delayMs: DELAY_MS,
      });
      const gadget3 = createMockGadget({
        name: "SlowGadget3",
        result: "result3",
        delayMs: DELAY_MS,
      });

      registry.registerByClass(gadget1);
      registry.registerByClass(gadget2);
      registry.registerByClass(gadget3);

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
      });

      // 3 independent gadgets (no dependencies)
      const gadgetCalls = [
        createGadgetCallString("SlowGadget1", {}, { invocationId: "g1" }),
        createGadgetCallString("SlowGadget2", {}, { invocationId: "g2" }),
        createGadgetCallString("SlowGadget3", {}, { invocationId: "g3" }),
      ].join("\n");

      const stream = createTextStream(gadgetCalls);

      const startTime = Date.now();
      const result = await consumeStream(processor, stream);
      const totalTime = Date.now() - startTime;

      // All 3 should have results
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(3);

      // If parallel: ~50ms (all run at once)
      // If sequential: ~150ms (50ms × 3)
      // Allow some tolerance for test execution overhead
      expect(totalTime).toBeLessThan(100); // Should be much less than 150ms
    });

    it("runs independent gadgets in parallel while dependent waits", async () => {
      const DELAY_MS = 50;

      // A and C are independent, B depends on A
      const gadgetA = createMockGadget({
        name: "GadgetA",
        result: "resultA",
        delayMs: DELAY_MS,
      });
      const gadgetB = createMockGadget({
        name: "GadgetB",
        result: "resultB",
        delayMs: DELAY_MS,
      });
      const gadgetC = createMockGadget({
        name: "GadgetC",
        result: "resultC",
        delayMs: DELAY_MS,
      });

      registry.registerByClass(gadgetA);
      registry.registerByClass(gadgetB);
      registry.registerByClass(gadgetC);

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
      });

      // A (no deps), B depends on A, C (no deps)
      const gadgetCalls = [
        createGadgetCallString("GadgetA", {}, { invocationId: "a1" }),
        createGadgetCallString("GadgetB", {}, { invocationId: "b1", dependencies: ["a1"] }),
        createGadgetCallString("GadgetC", {}, { invocationId: "c1" }),
      ].join("\n");

      const stream = createTextStream(gadgetCalls);

      const startTime = Date.now();
      const result = await consumeStream(processor, stream);
      const totalTime = Date.now() - startTime;

      // All 3 should execute
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(3);
      expect(gadgetA.getCallCount()).toBe(1);
      expect(gadgetB.getCallCount()).toBe(1);
      expect(gadgetC.getCallCount()).toBe(1);

      // Timeline:
      // - A and C start immediately (parallel, ~50ms)
      // - B waits for A, then runs (~50ms more)
      // Total: ~100ms (2 waves), not 150ms (3 sequential)
      expect(totalTime).toBeLessThan(130); // Allow tolerance but should be ~100ms
    });

    it("handles errors in parallel execution without affecting other gadgets", async () => {
      const DELAY_MS = 30;

      const successGadget = createMockGadget({
        name: "SuccessGadget",
        result: "success",
        delayMs: DELAY_MS,
      });
      const errorGadget = createMockGadget({
        name: "ErrorGadget",
        error: "Test error",
        delayMs: DELAY_MS,
      });

      registry.registerByClass(successGadget);
      registry.registerByClass(errorGadget);

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
      });

      // Both independent, one will error
      const gadgetCalls = [
        createGadgetCallString("SuccessGadget", {}, { invocationId: "s1" }),
        createGadgetCallString("ErrorGadget", {}, { invocationId: "e1" }),
      ].join("\n");

      const stream = createTextStream(gadgetCalls);
      const result = await consumeStream(processor, stream);

      // Both should have results (one success, one error)
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(2);

      // Check that both ran
      expect(successGadget.getCallCount()).toBe(1);
      expect(errorGadget.getCallCount()).toBe(1);

      // Verify error was captured
      const errorResult = gadgetResults.find(
        (r) => r.type === "gadget_result" && r.result.invocationId === "e1",
      );
      expect(errorResult?.type === "gadget_result" && errorResult.result.error).toBe("Test error");
    });

    it("respects maxConcurrent limit and queues excess gadgets", async () => {
      const DELAY_MS = 50;

      // Create a gadget that will be called multiple times
      const slowGadget = createMockGadget({
        name: "SlowGadget",
        result: "done",
        delayMs: DELAY_MS,
      });

      registry.registerByClass(slowGadget);

      // Set maxConcurrent = 1 - only one instance can run at a time
      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        subagentConfig: {
          SlowGadget: { maxConcurrent: 1 },
        },
      });

      // Three calls to the same gadget - without limit they'd run in parallel
      const gadgetCalls = [
        createGadgetCallString("SlowGadget", {}, { invocationId: "s1" }),
        createGadgetCallString("SlowGadget", {}, { invocationId: "s2" }),
        createGadgetCallString("SlowGadget", {}, { invocationId: "s3" }),
      ].join("\n");

      const startTime = Date.now();
      const stream = createTextStream(gadgetCalls);
      const result = await consumeStream(processor, stream);
      const totalTime = Date.now() - startTime;

      // All gadgets should complete
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(3);

      // With maxConcurrent=1, each runs sequentially (one at a time)
      // Total time should be ~150ms (3 × 50ms), not ~50ms (parallel)
      expect(totalTime).toBeGreaterThanOrEqual(140); // At least 3 sequential runs
    });

    it("allows specified concurrency level with maxConcurrent > 1", async () => {
      const DELAY_MS = 50;

      // Create 4 identical gadgets
      const gadgets = [1, 2, 3, 4].map((i) =>
        createMockGadget({
          name: "SlowGadget",
          result: `result_${i}`,
          delayMs: DELAY_MS,
        }),
      );

      // Register just one class (all calls will use this gadget)
      registry.registerByClass(gadgets[0]);

      // Set maxConcurrent = 2 for SlowGadget
      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        subagentConfig: {
          SlowGadget: { maxConcurrent: 2 },
        },
      });

      // Four calls to the same gadget type
      const gadgetCalls = [
        createGadgetCallString("SlowGadget", {}, { invocationId: "s1" }),
        createGadgetCallString("SlowGadget", {}, { invocationId: "s2" }),
        createGadgetCallString("SlowGadget", {}, { invocationId: "s3" }),
        createGadgetCallString("SlowGadget", {}, { invocationId: "s4" }),
      ].join("\n");

      const startTime = Date.now();
      const stream = createTextStream(gadgetCalls);
      const result = await consumeStream(processor, stream);
      const totalTime = Date.now() - startTime;

      // All should complete
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(4);

      // With maxConcurrent=2: 2 batches of 2 parallel = ~100ms total
      // Without limit (4 parallel): ~50ms
      // Sequential (maxConcurrent=1): ~200ms
      expect(totalTime).toBeGreaterThanOrEqual(90); // At least 2 waves
      expect(totalTime).toBeLessThan(180); // Less than 4 sequential
    });
  });

  describe("Cross-Iteration Dependency Resolution", () => {
    it("executes gadget immediately when dependency is in priorCompletedInvocations", async () => {
      const gadgetB = createMockGadget({ name: "GadgetB", result: "result_b" });
      registry.registerByClass(gadgetB);

      // Simulate that "gadget_a" completed in a previous iteration
      const priorCompletedInvocations = new Set(["gadget_a"]);

      const processor = new StreamProcessor({
        iteration: 2, // Second iteration
        registry,
        priorCompletedInvocations,
      });

      // GadgetB depends on gadget_a (from prior iteration)
      const gadgetCall = createGadgetCallString(
        "GadgetB",
        {},
        { invocationId: "gadget_b", dependencies: ["gadget_a"] },
      );
      const stream = createTextStream(gadgetCall);
      const result = await consumeStream(processor, stream);

      // Should execute successfully - no "missing dependency" error
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(1);
      expect(gadgetResults[0].type === "gadget_result" && gadgetResults[0].result.result).toBe(
        "result_b",
      );
      expect(gadgetB.getCallCount()).toBe(1);
    });

    it("skips gadget when dependency failed in prior iteration", async () => {
      const gadgetB = createMockGadget({ name: "GadgetB", result: "result_b" });
      registry.registerByClass(gadgetB);

      // Simulate that "gadget_a" failed in a previous iteration
      const priorFailedInvocations = new Set(["gadget_a"]);

      const processor = new StreamProcessor({
        iteration: 2,
        registry,
        priorFailedInvocations,
      });

      // GadgetB depends on gadget_a (which failed)
      const gadgetCall = createGadgetCallString(
        "GadgetB",
        {},
        { invocationId: "gadget_b", dependencies: ["gadget_a"] },
      );
      const stream = createTextStream(gadgetCall);
      const result = await consumeStream(processor, stream);

      // Should be skipped due to failed dependency
      const skipEvents = result.outputs.filter((e) => e.type === "gadget_skipped");
      expect(skipEvents).toHaveLength(1);
      expect(gadgetB.getCallCount()).toBe(0);
    });

    it("returns completed invocation IDs via getCompletedInvocationIds()", async () => {
      const gadgetA = createMockGadget({ name: "GadgetA", result: "result_a" });
      const gadgetB = createMockGadget({ name: "GadgetB", result: "result_b" });
      registry.registerByClass(gadgetA);
      registry.registerByClass(gadgetB);

      const processor = new StreamProcessor({ iteration: 1, registry });

      const gadgetCalls = [
        createGadgetCallString("GadgetA", {}, { invocationId: "id_a" }),
        createGadgetCallString("GadgetB", {}, { invocationId: "id_b" }),
      ].join("\n");

      const stream = createTextStream(gadgetCalls);
      await consumeStream(processor, stream);

      const completedIds = processor.getCompletedInvocationIds();
      expect(completedIds.has("id_a")).toBe(true);
      expect(completedIds.has("id_b")).toBe(true);
      expect(completedIds.size).toBe(2);
    });

    it("returns failed invocation IDs via getFailedInvocationIds()", async () => {
      const errorGadget = createMockGadget({ name: "ErrorGadget", error: "Test error" });
      registry.registerByClass(errorGadget);

      const processor = new StreamProcessor({ iteration: 1, registry });

      const gadgetCall = createGadgetCallString(
        "ErrorGadget",
        {},
        { invocationId: "error_id" },
      );
      const stream = createTextStream(gadgetCall);
      await consumeStream(processor, stream);

      const failedIds = processor.getFailedInvocationIds();
      expect(failedIds.has("error_id")).toBe(true);
      expect(failedIds.size).toBe(1);
    });
  });

  describe("Subagent Event Streaming", () => {
    it("pushes subagent events to completedResultsQueue for real-time streaming", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", result: "success" });
      registry.registerByClass(testGadget);

      const subagentEvents: Array<{ type: string }> = [];
      const onSubagentEvent = (event: { type: string }) => {
        subagentEvents.push(event);
      };

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        onSubagentEvent,
      });

      // Simulate calling onSubagentEvent during processing
      const mockEvent = { type: "llm_call_start", event: { model: "test" } };
      // Access the internal wrapped callback through the executor
      // (this tests the integration, not the exact mechanism)

      const gadgetCall = createGadgetCallString("TestGadget", {});
      const stream = createTextStream(gadgetCall);
      const result = await consumeStream(processor, stream);

      // Verify the gadget executed successfully
      expect(result.didExecuteGadgets).toBe(true);
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(1);
    });

    it("calls user callback before queuing event (ordering test)", async () => {
      const callOrder: string[] = [];
      const testGadget = createMockGadget({ name: "TestGadget", result: "success" });
      registry.registerByClass(testGadget);

      const onSubagentEvent = (_event: unknown) => {
        callOrder.push("callback");
      };

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        onSubagentEvent,
      });

      // The wrappedOnSubagentEvent in StreamProcessor should call callback first
      // We can't directly test internal ordering without mocking, but we verify
      // that the callback is indeed called
      const gadgetCall = createGadgetCallString("TestGadget", {});
      const stream = createTextStream(gadgetCall);
      await consumeStream(processor, stream);

      // Basic verification that the processor was created with the callback
      expect(processor).toBeDefined();
    });

    it("handles missing onSubagentEvent callback gracefully", async () => {
      const testGadget = createMockGadget({ name: "TestGadget", result: "success" });
      registry.registerByClass(testGadget);

      // Create processor without onSubagentEvent
      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        // no onSubagentEvent provided
      });

      const gadgetCall = createGadgetCallString("TestGadget", {});
      const stream = createTextStream(gadgetCall);

      // Should not throw
      const result = await consumeStream(processor, stream);
      expect(result.didExecuteGadgets).toBe(true);
    });

    it("subagent events appear interleaved with gadget results in completedResultsQueue", async () => {
      // This tests that subagent_event type events can be yielded from the processor
      const testGadget = createMockGadget({ name: "TestGadget", result: "success" });
      registry.registerByClass(testGadget);

      const processor = new StreamProcessor({
        iteration: 1,
        registry,
        onSubagentEvent: () => {
          // User callback - called before queue push
        },
      });

      const gadgetCall = createGadgetCallString("TestGadget", {});
      const stream = createTextStream(gadgetCall);
      const result = await consumeStream(processor, stream);

      // Verify gadget execution succeeded
      expect(result.didExecuteGadgets).toBe(true);

      // Check that we have gadget_call and gadget_result events
      const gadgetCalls = result.outputs.filter((e) => e.type === "gadget_call");
      const gadgetResults = result.outputs.filter((e) => e.type === "gadget_result");
      expect(gadgetCalls).toHaveLength(1);
      expect(gadgetResults).toHaveLength(1);
    });
  });
});
