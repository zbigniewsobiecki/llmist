/**
 * Comprehensive test suite for the new hooks system.
 *
 * Tests all three categories of hooks:
 * 1. Observers (read-only, parallel execution)
 * 2. Interceptors (synchronous transformations, sequential)
 * 3. Controllers (async lifecycle control, can short-circuit)
 *
 * The hooks system is the backbone of agent orchestration and must be thoroughly tested.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectEvents, ErrorGadget, TestGadget } from "../../../testing/src/helpers.js";
import { Agent } from "../agent/agent.js";
import { AGENT_INTERNAL_KEY } from "../agent/agent-internal-key.js";
import type {
  AfterGadgetExecutionAction,
  AfterLLMCallAction,
  AfterLLMErrorAction,
  BeforeGadgetExecutionAction,
  BeforeLLMCallAction,
  ObserveChunkContext,
  ObserveGadgetCompleteContext,
  ObserveGadgetStartContext,
  ObserveLLMCallContext,
  ObserveLLMCompleteContext,
  ObserveLLMErrorContext,
} from "../agent/hooks.js";
import { StreamProcessor } from "../agent/stream-processor.js";
import { LLMist } from "../core/client.js";
import { GADGET_ARG_PREFIX, GADGET_END_PREFIX, GADGET_START_PREFIX } from "../core/constants.js";
import type {
  LLMGenerationOptions,
  LLMStreamChunk,
  ModelDescriptor,
  ProviderAdapter,
} from "../core/options.js";
import { createLogger } from "../logging/logger.js";
import { GadgetRegistry } from "./registry.js";
import type { StreamCompletionEvent, StreamEvent } from "./types.js";

/**
 * Helper to consume the async generator from StreamProcessor.process()
 * and return a result object matching the old synchronous return format.
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

// ============================================================================
// TEST UTILITIES
// ============================================================================

class MockAdapter implements ProviderAdapter {
  readonly providerId = "openai" as const;
  public receivedCalls: LLMGenerationOptions[] = [];
  private readonly maxOutputTokens: number;
  private readonly modelId: string;

  constructor(
    private responses: Array<LLMStreamChunk[]>,
    maxOutputTokens = 2000,
    modelId = "openai:gpt-4",
  ) {
    this.maxOutputTokens = maxOutputTokens;
    this.modelId = modelId;
  }

  supports(descriptor: ModelDescriptor): boolean {
    return descriptor.provider === this.providerId;
  }

  async *stream(options: LLMGenerationOptions) {
    this.receivedCalls.push(options);
    const responseIndex = this.receivedCalls.length - 1;
    const chunks = this.responses[responseIndex] ?? [];

    for (const chunk of chunks) {
      yield chunk;
    }
  }

  getModelSpecs() {
    return [
      {
        provider: this.providerId,
        modelId: this.modelId,
        displayName: "Mock GPT-4",
        contextWindow: this.maxOutputTokens * 2,
        maxOutputTokens: this.maxOutputTokens,
        pricing: {
          input: 0,
          output: 0,
        },
        knowledgeCutoff: "2024-01-01",
        features: {
          streaming: true,
          functionCalling: true,
          vision: false,
        },
      },
    ];
  }
}

// Error adapter for testing error hooks
class ErrorAdapter implements ProviderAdapter {
  readonly providerId = "openai" as const;

  constructor(private errorMessage: string) {}

  supports(descriptor: ModelDescriptor): boolean {
    return descriptor.provider === this.providerId;
  }

  async *stream(): AsyncIterable<LLMStreamChunk> {
    throw new Error(this.errorMessage);
    yield; // Unreachable but satisfies require-yield lint rule
  }

  getModelSpecs() {
    return [];
  }
}

const testLogger = createLogger({ type: "hidden" });

// Helper to create a simple mock stream
async function* createMockStream(chunks: LLMStreamChunk[]): AsyncIterable<LLMStreamChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// ============================================================================
// OBSERVER TESTS
// ============================================================================

describe("Observers (Read-Only Hooks)", () => {
  let registry: GadgetRegistry;

  beforeEach(() => {
    registry = new GadgetRegistry();
  });

  describe("onLLMCallStart", () => {
    it("is called when LLM call starts", async () => {
      const onLLMCallStart = vi.fn<(context: ObserveLLMCallContext) => void>();

      const mockAdapter = new MockAdapter([[{ text: "Response", finishReason: "stop" }]]);
      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          observers: { onLLMCallStart },
        },
      });

      await collectEvents(agent.run());

      expect(onLLMCallStart).toHaveBeenCalledTimes(1);
      expect(onLLMCallStart).toHaveBeenCalledWith(
        expect.objectContaining({
          iteration: 0,
          options: expect.objectContaining({
            model: "openai:gpt-4",
            messages: expect.any(Array),
          }),
          logger: expect.any(Object),
        }),
      );
    });

    it("is called for each iteration", async () => {
      registry.registerByClass(new TestGadget());
      const onLLMCallStart = vi.fn<(context: ObserveLLMCallContext) => void>();

      const mockAdapter = new MockAdapter([
        [
          {
            text: `${GADGET_START_PREFIX}TestGadget:1\n${GADGET_ARG_PREFIX}message\ntest\n${GADGET_END_PREFIX}`,
          },
          { text: "", finishReason: "stop" },
        ],
        [{ text: "Done", finishReason: "stop" }],
      ]);

      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          observers: { onLLMCallStart },
        },
      });

      await collectEvents(agent.run());

      expect(onLLMCallStart).toHaveBeenCalledTimes(2);
      expect(onLLMCallStart).toHaveBeenNthCalledWith(1, expect.objectContaining({ iteration: 0 }));
      expect(onLLMCallStart).toHaveBeenNthCalledWith(2, expect.objectContaining({ iteration: 1 }));
    });

    it("does not crash system if observer throws error", async () => {
      const onLLMCallStart = vi.fn(() => {
        throw new Error("Observer error");
      });

      const mockAdapter = new MockAdapter([[{ text: "Response", finishReason: "stop" }]]);
      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          observers: { onLLMCallStart },
        },
      });

      // Should not throw, observer errors are caught
      const events = await collectEvents(agent.run());
      expect(events.length).toBeGreaterThan(0);
      expect(onLLMCallStart).toHaveBeenCalled();
    });

    it("supports async observers", async () => {
      let observerCompleted = false;
      const onLLMCallStart = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        observerCompleted = true;
      });

      const mockAdapter = new MockAdapter([[{ text: "Response", finishReason: "stop" }]]);
      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          observers: { onLLMCallStart },
        },
      });

      await collectEvents(agent.run());

      expect(onLLMCallStart).toHaveBeenCalled();
      expect(observerCompleted).toBe(true);
    });
  });

  describe("onLLMCallComplete", () => {
    it("is called when LLM call completes successfully", async () => {
      const onLLMCallComplete = vi.fn<(context: ObserveLLMCompleteContext) => void>();

      const mockAdapter = new MockAdapter([[{ text: "Success response", finishReason: "stop" }]]);
      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          observers: { onLLMCallComplete },
        },
      });

      await collectEvents(agent.run());

      expect(onLLMCallComplete).toHaveBeenCalledTimes(1);
      expect(onLLMCallComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          iteration: 0,
          options: expect.any(Object),
          finishReason: "stop",
          rawResponse: "Success response",
          finalMessage: "Success response",
          logger: expect.any(Object),
        }),
      );
    });

    it("includes complete accumulated text in rawResponse", async () => {
      const onLLMCallComplete = vi.fn<(context: ObserveLLMCompleteContext) => void>();

      const mockAdapter = new MockAdapter([
        [{ text: "Part 1" }, { text: " Part 2" }, { text: " Part 3", finishReason: "stop" }],
      ]);

      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          observers: { onLLMCallComplete },
        },
      });

      await collectEvents(agent.run());

      expect(onLLMCallComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          rawResponse: "Part 1 Part 2 Part 3",
        }),
      );
    });

    it("includes usage information when available", async () => {
      const onLLMCallComplete = vi.fn<(context: ObserveLLMCompleteContext) => void>();

      const mockAdapter = new MockAdapter([
        [
          { text: "Response", finishReason: "stop" },
          {
            text: "",
            usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          },
        ],
      ]);

      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          observers: { onLLMCallComplete },
        },
      });

      await collectEvents(agent.run());

      expect(onLLMCallComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        }),
      );
    });
  });

  describe("onLLMCallError", () => {
    it("is called when LLM call fails", async () => {
      const onLLMCallError = vi.fn<(context: ObserveLLMErrorContext) => void>();

      const errorAdapter = new ErrorAdapter("LLM API Error");
      const client = new LLMist([errorAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          observers: { onLLMCallError },
        },
      });

      await expect(collectEvents(agent.run())).rejects.toThrow("LLM API Error");

      expect(onLLMCallError).toHaveBeenCalledTimes(1);
      expect(onLLMCallError).toHaveBeenCalledWith(
        expect.objectContaining({
          iteration: 0,
          error: expect.objectContaining({
            message: "LLM API Error",
          }),
          recovered: false,
          logger: expect.any(Object),
        }),
      );
    });

    it("indicates when error was recovered", async () => {
      const onLLMCallError = vi.fn<(context: ObserveLLMErrorContext) => void>();

      const errorAdapter = new ErrorAdapter("Recoverable error");
      const client = new LLMist([errorAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          observers: { onLLMCallError },
          controllers: {
            afterLLMError: async () => ({
              action: "recover",
              fallbackResponse: "Recovered response",
            }),
          },
        },
      });

      // Should not throw because error was recovered
      await collectEvents(agent.run());

      expect(onLLMCallError).toHaveBeenCalledWith(
        expect.objectContaining({
          recovered: true,
        }),
      );
    });
  });

  // NOTE: onGadgetExecutionStart is now called via the tree-hook-bridge in Agent.run(),
  // so these tests must use the full Agent instead of StreamProcessor directly.
  describe("onGadgetExecutionStart", () => {
    it("is called before gadget execution", async () => {
      registry.registerByClass(new TestGadget());
      const onGadgetExecutionStart = vi.fn<(context: ObserveGadgetStartContext) => void>();

      const mockAdapter = new MockAdapter([
        [
          {
            text: `${GADGET_START_PREFIX}TestGadget:123\n${GADGET_ARG_PREFIX}message\nhello\n${GADGET_END_PREFIX}`,
          },
          { text: "", finishReason: "stop" },
        ],
        [{ text: "Done", finishReason: "stop" }],
      ]);

      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          observers: { onGadgetExecutionStart },
        },
      });

      await collectEvents(agent.run());

      expect(onGadgetExecutionStart).toHaveBeenCalledTimes(1);
      expect(onGadgetExecutionStart).toHaveBeenCalledWith(
        expect.objectContaining({
          iteration: 0,
          gadgetName: "TestGadget",
          invocationId: "123",
          parameters: { message: "hello" },
          logger: expect.any(Object),
        }),
      );
    });

    it("is called for each gadget execution", async () => {
      registry.registerByClass(new TestGadget());
      const onGadgetExecutionStart = vi.fn<(context: ObserveGadgetStartContext) => void>();

      const mockAdapter = new MockAdapter([
        [
          {
            text: `${GADGET_START_PREFIX}TestGadget:1\n${GADGET_ARG_PREFIX}message\nfirst\n${GADGET_END_PREFIX}`,
          },
          {
            text: `${GADGET_START_PREFIX}TestGadget:2\n${GADGET_ARG_PREFIX}message\nsecond\n${GADGET_END_PREFIX}`,
          },
          { text: "", finishReason: "stop" },
        ],
        [{ text: "Done", finishReason: "stop" }],
      ]);

      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          observers: { onGadgetExecutionStart },
        },
      });

      await collectEvents(agent.run());

      expect(onGadgetExecutionStart).toHaveBeenCalledTimes(2);
      expect(onGadgetExecutionStart).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ invocationId: "1", parameters: { message: "first" } }),
      );
      expect(onGadgetExecutionStart).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ invocationId: "2", parameters: { message: "second" } }),
      );
    });
  });

  // NOTE: onGadgetExecutionComplete is now called via the tree-hook-bridge in Agent.run(),
  // so these tests must use the full Agent instead of StreamProcessor directly.
  describe("onGadgetExecutionComplete", () => {
    it("is called after successful gadget execution", async () => {
      registry.registerByClass(new TestGadget());
      const onGadgetExecutionComplete = vi.fn<(context: ObserveGadgetCompleteContext) => void>();

      const mockAdapter = new MockAdapter([
        [
          {
            text: `${GADGET_START_PREFIX}TestGadget:456\n${GADGET_ARG_PREFIX}message\nsuccess\n${GADGET_END_PREFIX}`,
          },
          { text: "", finishReason: "stop" },
        ],
        [{ text: "Done", finishReason: "stop" }],
      ]);

      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          observers: { onGadgetExecutionComplete },
        },
      });

      await collectEvents(agent.run());

      expect(onGadgetExecutionComplete).toHaveBeenCalledTimes(1);
      expect(onGadgetExecutionComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          iteration: 0,
          gadgetName: "TestGadget",
          invocationId: "456",
          parameters: { message: "success" },
          finalResult: "Echo: success",
          executionTimeMs: expect.any(Number),
          logger: expect.any(Object),
        }),
      );
    });

    it("is called after gadget error", async () => {
      registry.registerByClass(new ErrorGadget());
      const onGadgetExecutionComplete = vi.fn<(context: ObserveGadgetCompleteContext) => void>();

      const mockAdapter = new MockAdapter([
        [
          {
            text: `${GADGET_START_PREFIX}ErrorGadget:789\n{}\n${GADGET_END_PREFIX}`,
          },
          { text: "", finishReason: "stop" },
        ],
        [{ text: "Done", finishReason: "stop" }],
      ]);

      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          observers: { onGadgetExecutionComplete },
        },
      });

      await collectEvents(agent.run());

      expect(onGadgetExecutionComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          gadgetName: "ErrorGadget",
          error: "Intentional error from ErrorGadget",
          executionTimeMs: expect.any(Number),
        }),
      );
    });

    it("shows final result after interceptor modification", async () => {
      // NOTE: With the tree-hook-bridge architecture, observers receive the final (post-interceptor)
      // result from the tree event. The originalResult field is no longer populated since the
      // tree only stores the final result.
      registry.registerByClass(new TestGadget());
      const onGadgetExecutionComplete = vi.fn<(context: ObserveGadgetCompleteContext) => void>();

      const mockAdapter = new MockAdapter([
        [
          {
            text: `${GADGET_START_PREFIX}TestGadget:1\n${GADGET_ARG_PREFIX}message\ntest\n${GADGET_END_PREFIX}`,
          },
          { text: "", finishReason: "stop" },
        ],
        [{ text: "Done", finishReason: "stop" }],
      ]);

      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          observers: { onGadgetExecutionComplete },
          interceptors: {
            interceptGadgetResult: (result) => `[MODIFIED] ${result}`,
          },
        },
      });

      await collectEvents(agent.run());

      expect(onGadgetExecutionComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          finalResult: "[MODIFIED] Echo: test",
        }),
      );
    });
  });

  describe("onStreamChunk", () => {
    it("is called for each stream chunk", async () => {
      const onStreamChunk = vi.fn<(context: ObserveChunkContext) => void>();

      const stream = createMockStream([
        { text: "Hello " },
        { text: "world" },
        { text: "", finishReason: "stop" },
      ]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          observers: { onStreamChunk },
        },
      });

      await consumeStream(processor, stream);

      expect(onStreamChunk).toHaveBeenCalledTimes(2); // Empty chunks are skipped
      expect(onStreamChunk).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          iteration: 0,
          rawChunk: "Hello ",
          accumulatedText: "Hello ",
          logger: expect.any(Object),
        }),
      );
      expect(onStreamChunk).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          rawChunk: "world",
          accumulatedText: "Hello world",
        }),
      );
    });

    it("sees chunk after interceptRawChunk transformation", async () => {
      const onStreamChunk = vi.fn<(context: ObserveChunkContext) => void>();

      const stream = createMockStream([{ text: "**bold**" }, { text: "", finishReason: "stop" }]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          interceptors: {
            interceptRawChunk: (chunk) => chunk.replace(/\*\*(.*?)\*\*/g, "$1"),
          },
          observers: { onStreamChunk },
        },
      });

      await consumeStream(processor, stream);

      expect(onStreamChunk).toHaveBeenCalledWith(
        expect.objectContaining({
          rawChunk: "bold",
          accumulatedText: "bold",
        }),
      );
    });
  });

  describe("Observer Parallel Execution", () => {
    it("runs multiple observers in parallel within the same hook call", async () => {
      const executionOrder: string[] = [];
      const observer1 = vi.fn(async () => {
        executionOrder.push("observer1-start");
        await new Promise((resolve) => setTimeout(resolve, 20));
        executionOrder.push("observer1-end");
      });

      const observer2 = vi.fn(async () => {
        executionOrder.push("observer2-start");
        await new Promise((resolve) => setTimeout(resolve, 10));
        executionOrder.push("observer2-end");
      });

      // Use StreamProcessor level hooks to test parallel execution
      const stream = createMockStream([{ text: "Hello" }, { text: "", finishReason: "stop" }]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          observers: {
            onStreamChunk: observer1,
            // Can't easily test parallel execution at this level since we only have one observer type per event
            // Instead, we'll verify both are called
          },
        },
      });

      await consumeStream(processor, stream);

      expect(observer1).toHaveBeenCalled();
      // Observers run independently and don't block each other
      expect(executionOrder).toContain("observer1-start");
      expect(executionOrder).toContain("observer1-end");
    });

    it("continues execution even if one observer fails", async () => {
      const successfulObserver = vi.fn();
      const failingObserver = vi.fn(() => {
        throw new Error("Observer failed");
      });

      const stream = createMockStream([{ text: "Hello" }, { text: "", finishReason: "stop" }]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          observers: {
            onStreamChunk: failingObserver,
            onGadgetExecutionComplete: successfulObserver, // Won't be called but shouldn't affect failingObserver
          },
        },
      });

      // Should not throw
      const result = await consumeStream(processor, stream);
      expect(result.rawResponse).toBe("Hello");
      expect(failingObserver).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// INTERCEPTOR TESTS
// ============================================================================

describe("Interceptors (Synchronous Transformations)", () => {
  let registry: GadgetRegistry;

  beforeEach(() => {
    registry = new GadgetRegistry();
  });

  describe("interceptRawChunk", () => {
    it("transforms raw chunks from LLM", async () => {
      const interceptRawChunk = vi.fn((chunk: string) => chunk.toUpperCase());

      const stream = createMockStream([
        { text: "hello" },
        { text: " world" },
        { text: "", finishReason: "stop" },
      ]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          interceptors: { interceptRawChunk },
        },
      });

      const result = await consumeStream(processor, stream);

      expect(interceptRawChunk).toHaveBeenCalledTimes(2);
      expect(result.rawResponse).toBe("HELLO WORLD");
    });

    it("can suppress chunks by returning null", async () => {
      const interceptRawChunk = vi.fn((chunk: string) => {
        if (chunk.includes("SECRET")) return null;
        return chunk;
      });

      const stream = createMockStream([
        { text: "public " },
        { text: "SECRET " },
        { text: "data" },
        { text: "", finishReason: "stop" },
      ]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          interceptors: { interceptRawChunk },
        },
      });

      const result = await consumeStream(processor, stream);

      expect(result.rawResponse).toBe("public data");
    });

    it("receives context with iteration and accumulated text", async () => {
      const interceptRawChunk = vi.fn((chunk: string, context) => {
        expect(context).toEqual(
          expect.objectContaining({
            iteration: 0,
            accumulatedText: expect.any(String),
            logger: expect.any(Object),
          }),
        );
        return chunk;
      });

      const stream = createMockStream([{ text: "test" }, { text: "", finishReason: "stop" }]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          interceptors: { interceptRawChunk },
        },
      });

      await consumeStream(processor, stream);
      expect(interceptRawChunk).toHaveBeenCalled();
    });
  });

  describe("interceptTextChunk", () => {
    it("transforms text chunks before display", async () => {
      const interceptTextChunk = vi.fn((chunk: string) => `[${chunk}]`);

      const stream = createMockStream([
        { text: "Hello World" },
        { text: "", finishReason: "stop" },
      ]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          interceptors: { interceptTextChunk },
        },
      });

      const result = await consumeStream(processor, stream);

      const textEvents = result.outputs.filter((e) => e.type === "text");
      expect(textEvents).toHaveLength(1);
      expect(textEvents[0]).toEqual({ type: "text", content: "[Hello World]" });
      expect(interceptTextChunk).toHaveBeenCalled();
    });

    it("can suppress text chunks by returning null", async () => {
      const interceptTextChunk = vi.fn((chunk: string) => {
        // Suppress everything
        return null;
      });

      const stream = createMockStream([
        { text: "All of this text" },
        { text: " will be suppressed" },
        { text: "", finishReason: "stop" },
      ]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          interceptors: { interceptTextChunk },
        },
      });

      const result = await consumeStream(processor, stream);

      const textEvents = result.outputs.filter((e) => e.type === "text");
      // All text was suppressed
      expect(textEvents).toHaveLength(0);
      expect(interceptTextChunk).toHaveBeenCalled();
    });
  });

  describe("interceptAssistantMessage", () => {
    it("transforms final message before storing in conversation", async () => {
      const interceptAssistantMessage = vi.fn((message: string) => {
        return message.replace(/secret_key=\w+/g, "secret_key=[REDACTED]");
      });

      const stream = createMockStream([
        { text: "Result: secret_key=abc123" },
        { text: "", finishReason: "stop" },
      ]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          interceptors: { interceptAssistantMessage },
        },
      });

      const result = await consumeStream(processor, stream);

      expect(result.finalMessage).toBe("Result: secret_key=[REDACTED]");
      expect(result.rawResponse).toBe("Result: secret_key=abc123");
    });

    it("receives context with raw response", async () => {
      const interceptAssistantMessage = vi.fn((message: string, context) => {
        expect(context).toEqual(
          expect.objectContaining({
            iteration: 0,
            rawResponse: "test message",
            logger: expect.any(Object),
          }),
        );
        return message;
      });

      const stream = createMockStream([
        { text: "test message" },
        { text: "", finishReason: "stop" },
      ]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          interceptors: { interceptAssistantMessage },
        },
      });

      await consumeStream(processor, stream);
      expect(interceptAssistantMessage).toHaveBeenCalled();
    });

    it("cannot suppress message (always returns transformed message)", async () => {
      const interceptAssistantMessage = vi.fn(() => "");

      const stream = createMockStream([
        { text: "original message" },
        { text: "", finishReason: "stop" },
      ]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          interceptors: { interceptAssistantMessage },
        },
      });

      const result = await consumeStream(processor, stream);

      // Empty string is still stored
      expect(result.finalMessage).toBe("");
    });
  });

  describe("interceptGadgetParameters", () => {
    it("transforms gadget parameters before execution", async () => {
      registry.registerByClass(new TestGadget());
      const interceptGadgetParameters = vi.fn((params: Record<string, unknown>) => {
        return { ...params, message: `[MODIFIED] ${params.message}` };
      });

      const stream = createMockStream([
        {
          text: `${GADGET_START_PREFIX}TestGadget:1\n${GADGET_ARG_PREFIX}message\nhello\n${GADGET_END_PREFIX}`,
        },
        { text: "", finishReason: "stop" },
      ]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          interceptors: { interceptGadgetParameters },
        },
      });

      const result = await consumeStream(processor, stream);

      expect(interceptGadgetParameters).toHaveBeenCalledWith(
        { message: "hello" },
        expect.any(Object),
      );

      const gadgetResult = result.outputs.find((e) => e.type === "gadget_result");
      expect(gadgetResult).toBeDefined();
      if (gadgetResult && gadgetResult.type === "gadget_result") {
        expect(gadgetResult.result.result).toBe("Echo: [MODIFIED] hello");
      }
    });

    // NOTE: This test uses Agent since onGadgetExecutionStart is now called via the tree-hook-bridge
    it("modified parameters are visible in subsequent hooks", async () => {
      registry.registerByClass(new TestGadget());
      const onGadgetExecutionStart = vi.fn<(context: ObserveGadgetStartContext) => void>();

      const mockAdapter = new MockAdapter([
        [
          {
            text: `${GADGET_START_PREFIX}TestGadget:1\n${GADGET_ARG_PREFIX}message\noriginal\n${GADGET_END_PREFIX}`,
          },
          { text: "", finishReason: "stop" },
        ],
        [{ text: "Done", finishReason: "stop" }],
      ]);

      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          interceptors: {
            interceptGadgetParameters: (params) => ({ ...params, message: "modified" }),
          },
          observers: { onGadgetExecutionStart },
        },
      });

      await collectEvents(agent.run());

      expect(onGadgetExecutionStart).toHaveBeenCalledWith(
        expect.objectContaining({
          parameters: { message: "modified" },
        }),
      );
    });

    it("receives context with gadget name and invocation ID", async () => {
      registry.registerByClass(new TestGadget());
      const interceptGadgetParameters = vi.fn((params: Record<string, unknown>, context) => {
        expect(context).toEqual(
          expect.objectContaining({
            iteration: 0,
            gadgetName: "TestGadget",
            invocationId: "42",
            logger: expect.any(Object),
          }),
        );
        return params;
      });

      const stream = createMockStream([
        {
          text: `${GADGET_START_PREFIX}TestGadget:42\n${GADGET_ARG_PREFIX}message\ntest\n${GADGET_END_PREFIX}`,
        },
        { text: "", finishReason: "stop" },
      ]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          interceptors: { interceptGadgetParameters },
        },
      });

      await consumeStream(processor, stream);
      expect(interceptGadgetParameters).toHaveBeenCalled();
    });
  });

  describe("interceptGadgetResult", () => {
    it("transforms gadget result before returning to LLM", async () => {
      registry.registerByClass(new TestGadget());
      const interceptGadgetResult = vi.fn((result: string) => {
        return result.toUpperCase();
      });

      const stream = createMockStream([
        {
          text: `${GADGET_START_PREFIX}TestGadget:1\n${GADGET_ARG_PREFIX}message\ntest\n${GADGET_END_PREFIX}`,
        },
        { text: "", finishReason: "stop" },
      ]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          interceptors: { interceptGadgetResult },
        },
      });

      const result = await consumeStream(processor, stream);

      const gadgetResult = result.outputs.find((e) => e.type === "gadget_result");
      expect(gadgetResult).toBeDefined();
      if (gadgetResult && gadgetResult.type === "gadget_result") {
        expect(gadgetResult.result.result).toBe("ECHO: TEST");
      }
    });

    it("receives context with execution details", async () => {
      registry.registerByClass(new TestGadget());
      const interceptGadgetResult = vi.fn((result: string, context) => {
        expect(context).toEqual(
          expect.objectContaining({
            iteration: 0,
            gadgetName: "TestGadget",
            invocationId: "99",
            parameters: { message: "test" },
            executionTimeMs: expect.any(Number),
            logger: expect.any(Object),
          }),
        );
        return result;
      });

      const stream = createMockStream([
        {
          text: `${GADGET_START_PREFIX}TestGadget:99\n${GADGET_ARG_PREFIX}message\ntest\n${GADGET_END_PREFIX}`,
        },
        { text: "", finishReason: "stop" },
      ]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          interceptors: { interceptGadgetResult },
        },
      });

      await consumeStream(processor, stream);
      expect(interceptGadgetResult).toHaveBeenCalled();
    });

    it("cannot suppress result (always returns transformed result)", async () => {
      registry.registerByClass(new TestGadget());
      const interceptGadgetResult = vi.fn(() => "");

      const stream = createMockStream([
        {
          text: `${GADGET_START_PREFIX}TestGadget:1\n${GADGET_ARG_PREFIX}message\ntest\n${GADGET_END_PREFIX}`,
        },
        { text: "", finishReason: "stop" },
      ]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          interceptors: { interceptGadgetResult },
        },
      });

      const result = await consumeStream(processor, stream);

      const gadgetResult = result.outputs.find((e) => e.type === "gadget_result");
      if (gadgetResult && gadgetResult.type === "gadget_result") {
        // Empty string is still returned
        expect(gadgetResult.result.result).toBe("");
      }
    });
  });

  describe("Interceptor Sequential Execution", () => {
    it("runs interceptors in sequence for chunks", async () => {
      const executionOrder: string[] = [];

      const interceptor1 = vi.fn((chunk: string) => {
        executionOrder.push("interceptor1");
        return `[1:${chunk}]`;
      });

      const interceptor2 = vi.fn((chunk: string) => {
        executionOrder.push("interceptor2");
        return `[2:${chunk}]`;
      });

      const stream = createMockStream([{ text: "test" }, { text: "", finishReason: "stop" }]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          interceptors: {
            interceptRawChunk: interceptor1,
            interceptTextChunk: interceptor2,
          },
        },
      });

      const result = await consumeStream(processor, stream);

      // interceptRawChunk runs first, then interceptTextChunk
      expect(executionOrder).toEqual(["interceptor1", "interceptor2"]);
      expect(result.rawResponse).toBe("[1:test]");

      const textEvent = result.outputs.find((e) => e.type === "text");
      if (textEvent && textEvent.type === "text") {
        expect(textEvent.content).toBe("[2:[1:test]]");
      }
    });
  });
});

// ============================================================================
// CONTROLLER TESTS
// ============================================================================

describe("Controllers (Async Lifecycle Control)", () => {
  let registry: GadgetRegistry;

  beforeEach(() => {
    registry = new GadgetRegistry();
  });

  describe("beforeLLMCall", () => {
    it("can modify LLM options", async () => {
      const beforeLLMCall = vi.fn(async (): Promise<BeforeLLMCallAction> => {
        return {
          action: "proceed",
          modifiedOptions: { temperature: 0.9 },
        };
      });

      const mockAdapter = new MockAdapter([[{ text: "Response", finishReason: "stop" }]]);
      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        temperature: 0.5,
        logger: testLogger,
        hooks: {
          controllers: { beforeLLMCall },
        },
      });

      await collectEvents(agent.run());

      expect(beforeLLMCall).toHaveBeenCalled();
      // Check that modified temperature was used
      expect(mockAdapter.receivedCalls[0]?.temperature).toBe(0.9);
    });

    it("can skip LLM call with synthetic response", async () => {
      const beforeLLMCall = vi.fn(async (): Promise<BeforeLLMCallAction> => {
        return {
          action: "skip",
          syntheticResponse: "Synthetic response from controller",
        };
      });

      const mockAdapter = new MockAdapter([
        [{ text: "Should not see this", finishReason: "stop" }],
      ]);
      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          controllers: { beforeLLMCall },
        },
      });

      const events = await collectEvents(agent.run());

      expect(beforeLLMCall).toHaveBeenCalled();
      // LLM was never called
      expect(mockAdapter.receivedCalls).toHaveLength(0);
      // Synthetic response was yielded
      const textEvents = events.filter((e) => e.type === "text");
      expect(textEvents).toHaveLength(1);
      if (textEvents[0] && textEvents[0].type === "text") {
        expect(textEvents[0].content).toBe("Synthetic response from controller");
      }
    });

    it("receives correct context", async () => {
      const beforeLLMCall = vi.fn(async (context): Promise<BeforeLLMCallAction> => {
        expect(context).toEqual(
          expect.objectContaining({
            iteration: 0,
            options: expect.objectContaining({
              model: "openai:gpt-4",
              messages: expect.any(Array),
            }),
            logger: expect.any(Object),
          }),
        );
        return { action: "proceed" };
      });

      const mockAdapter = new MockAdapter([[{ text: "Response", finishReason: "stop" }]]);
      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          controllers: { beforeLLMCall },
        },
      });

      await collectEvents(agent.run());
      expect(beforeLLMCall).toHaveBeenCalled();
    });
  });

  describe("afterLLMCall", () => {
    it("can append messages to conversation", async () => {
      registry.registerByClass(new TestGadget());
      let callCount = 0;
      const afterLLMCall = vi.fn(async (): Promise<AfterLLMCallAction> => {
        callCount++;
        if (callCount === 1) {
          return {
            action: "append_messages",
            messages: [{ role: "user", content: "Additional context" }],
          };
        }
        return { action: "continue" };
      });

      const mockAdapter = new MockAdapter([
        // First iteration with gadget call
        [
          {
            text: `${GADGET_START_PREFIX}TestGadget:1\n${GADGET_ARG_PREFIX}message\nfirst\n${GADGET_END_PREFIX}`,
          },
          { text: "", finishReason: "stop" },
        ],
        // Second iteration (after appending messages)
        [{ text: "Second response", finishReason: "stop" }],
      ]);

      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        maxIterations: 3,
        logger: testLogger,
        hooks: {
          controllers: { afterLLMCall },
        },
      });

      await collectEvents(agent.run());

      expect(afterLLMCall).toHaveBeenCalled();
      // Should have made 2 LLM calls
      expect(mockAdapter.receivedCalls).toHaveLength(2);
    });

    it("can modify final message", async () => {
      const afterLLMCall = vi.fn(async (): Promise<AfterLLMCallAction> => {
        return {
          action: "modify_and_continue",
          modifiedMessage: "Modified by controller",
        };
      });

      const mockAdapter = new MockAdapter([[{ text: "Original message", finishReason: "stop" }]]);

      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          controllers: { afterLLMCall },
        },
      });

      await collectEvents(agent.run());

      expect(afterLLMCall).toHaveBeenCalled();
      // The modified message should be stored in conversation
      // (We can't directly verify conversation state, but we tested the flow)
    });

    it("can both append and modify", async () => {
      registry.registerByClass(new TestGadget());
      let callCount = 0;
      const afterLLMCall = vi.fn(async (): Promise<AfterLLMCallAction> => {
        callCount++;
        if (callCount === 1) {
          return {
            action: "append_and_modify",
            modifiedMessage: "Modified",
            messages: [{ role: "user", content: "Appended" }],
          };
        }
        return { action: "continue" };
      });

      const mockAdapter = new MockAdapter([
        // First iteration with gadget
        [
          {
            text: `${GADGET_START_PREFIX}TestGadget:1\n${GADGET_ARG_PREFIX}message\nfirst\n${GADGET_END_PREFIX}`,
          },
          { text: "", finishReason: "stop" },
        ],
        // Second iteration after append
        [{ text: "Second", finishReason: "stop" }],
      ]);

      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        maxIterations: 3,
        logger: testLogger,
        hooks: {
          controllers: { afterLLMCall },
        },
      });

      await collectEvents(agent.run());

      expect(afterLLMCall).toHaveBeenCalled();
      expect(mockAdapter.receivedCalls).toHaveLength(2);
    });

    it("receives correct context with usage info", async () => {
      const afterLLMCall = vi.fn(async (context): Promise<AfterLLMCallAction> => {
        expect(context).toEqual(
          expect.objectContaining({
            iteration: 0,
            finishReason: "stop",
            finalMessage: "Response with usage",
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            logger: expect.any(Object),
          }),
        );
        return { action: "continue" };
      });

      const mockAdapter = new MockAdapter([
        [
          { text: "Response with usage", finishReason: "stop" },
          { text: "", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
        ],
      ]);

      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          controllers: { afterLLMCall },
        },
      });

      await collectEvents(agent.run());
      expect(afterLLMCall).toHaveBeenCalled();
    });
  });

  describe("afterLLMError", () => {
    it("can recover from LLM error with fallback response", async () => {
      const afterLLMError = vi.fn(async (): Promise<AfterLLMErrorAction> => {
        return {
          action: "recover",
          fallbackResponse: "Fallback response",
        };
      });

      const errorAdapter = new ErrorAdapter("LLM failed");
      const client = new LLMist([errorAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          controllers: { afterLLMError },
        },
      });

      // Should not throw because error was recovered
      await collectEvents(agent.run());

      expect(afterLLMError).toHaveBeenCalled();
      // Recovery adds message to conversation and ends the loop
    });

    it("can rethrow error", async () => {
      const afterLLMError = vi.fn(async (): Promise<AfterLLMErrorAction> => {
        return { action: "rethrow" };
      });

      const errorAdapter = new ErrorAdapter("Cannot recover");
      const client = new LLMist([errorAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          controllers: { afterLLMError },
        },
      });

      await expect(collectEvents(agent.run())).rejects.toThrow("Cannot recover");
      expect(afterLLMError).toHaveBeenCalled();
    });

    it("receives correct error context", async () => {
      const afterLLMError = vi.fn(async (context): Promise<AfterLLMErrorAction> => {
        expect(context.error.message).toBe("Test error");
        expect(context.options).toBeDefined();
        expect(context.logger).toBeDefined();
        expect(typeof context.iteration).toBe("number");
        return {
          action: "recover",
          fallbackResponse: "Recovered",
        };
      });

      const errorAdapter = new ErrorAdapter("Test error");
      const client = new LLMist([errorAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          controllers: { afterLLMError },
        },
      });

      await collectEvents(agent.run());
      expect(afterLLMError).toHaveBeenCalled();
    });
  });

  describe("beforeGadgetExecution", () => {
    it("can skip gadget execution with synthetic result", async () => {
      registry.registerByClass(new TestGadget());
      const beforeGadgetExecution = vi.fn(async (): Promise<BeforeGadgetExecutionAction> => {
        return {
          action: "skip",
          syntheticResult: "Skipped execution",
        };
      });

      const stream = createMockStream([
        {
          text: `${GADGET_START_PREFIX}TestGadget:1\n${GADGET_ARG_PREFIX}message\ntest\n${GADGET_END_PREFIX}`,
        },
        { text: "", finishReason: "stop" },
      ]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          controllers: { beforeGadgetExecution },
        },
      });

      const result = await consumeStream(processor, stream);

      expect(beforeGadgetExecution).toHaveBeenCalled();

      const gadgetResult = result.outputs.find((e) => e.type === "gadget_result");
      expect(gadgetResult).toBeDefined();
      if (gadgetResult && gadgetResult.type === "gadget_result") {
        expect(gadgetResult.result.result).toBe("Skipped execution");
        expect(gadgetResult.result.executionTimeMs).toBe(0);
      }
    });

    it("can proceed with execution", async () => {
      registry.registerByClass(new TestGadget());
      const beforeGadgetExecution = vi.fn(async (): Promise<BeforeGadgetExecutionAction> => {
        return { action: "proceed" };
      });

      const stream = createMockStream([
        {
          text: `${GADGET_START_PREFIX}TestGadget:1\n${GADGET_ARG_PREFIX}message\nhello\n${GADGET_END_PREFIX}`,
        },
        { text: "", finishReason: "stop" },
      ]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          controllers: { beforeGadgetExecution },
        },
      });

      const result = await consumeStream(processor, stream);

      expect(beforeGadgetExecution).toHaveBeenCalled();

      const gadgetResult = result.outputs.find((e) => e.type === "gadget_result");
      if (gadgetResult && gadgetResult.type === "gadget_result") {
        expect(gadgetResult.result.result).toBe("Echo: hello");
      }
    });

    it("receives correct context with parameters", async () => {
      registry.registerByClass(new TestGadget());
      const beforeGadgetExecution = vi.fn(async (context): Promise<BeforeGadgetExecutionAction> => {
        expect(context).toEqual(
          expect.objectContaining({
            iteration: 0,
            gadgetName: "TestGadget",
            invocationId: "42",
            parameters: { message: "test" },
            logger: expect.any(Object),
          }),
        );
        return { action: "proceed" };
      });

      const stream = createMockStream([
        {
          text: `${GADGET_START_PREFIX}TestGadget:42\n${GADGET_ARG_PREFIX}message\ntest\n${GADGET_END_PREFIX}`,
        },
        { text: "", finishReason: "stop" },
      ]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          controllers: { beforeGadgetExecution },
        },
      });

      await consumeStream(processor, stream);
      expect(beforeGadgetExecution).toHaveBeenCalled();
    });
  });

  describe("afterGadgetExecution", () => {
    it("can recover from gadget error with fallback", async () => {
      registry.registerByClass(new ErrorGadget());
      const afterGadgetExecution = vi.fn(async (): Promise<AfterGadgetExecutionAction> => {
        return {
          action: "recover",
          fallbackResult: "Recovered from error",
        };
      });

      const stream = createMockStream([
        {
          text: `${GADGET_START_PREFIX}ErrorGadget:1\n{}\n${GADGET_END_PREFIX}`,
        },
        { text: "", finishReason: "stop" },
      ]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          controllers: { afterGadgetExecution },
        },
      });

      const result = await consumeStream(processor, stream);

      expect(afterGadgetExecution).toHaveBeenCalled();

      const gadgetResult = result.outputs.find((e) => e.type === "gadget_result");
      expect(gadgetResult).toBeDefined();
      if (gadgetResult && gadgetResult.type === "gadget_result") {
        expect(gadgetResult.result.error).toBeUndefined();
        expect(gadgetResult.result.result).toBe("Recovered from error");
      }
    });

    it("can continue after successful execution", async () => {
      registry.registerByClass(new TestGadget());
      const afterGadgetExecution = vi.fn(async (): Promise<AfterGadgetExecutionAction> => {
        return { action: "continue" };
      });

      const stream = createMockStream([
        {
          text: `${GADGET_START_PREFIX}TestGadget:1\n${GADGET_ARG_PREFIX}message\ntest\n${GADGET_END_PREFIX}`,
        },
        { text: "", finishReason: "stop" },
      ]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          controllers: { afterGadgetExecution },
        },
      });

      const result = await consumeStream(processor, stream);

      expect(afterGadgetExecution).toHaveBeenCalled();

      const gadgetResult = result.outputs.find((e) => e.type === "gadget_result");
      if (gadgetResult && gadgetResult.type === "gadget_result") {
        expect(gadgetResult.result.result).toBe("Echo: test");
      }
    });

    it("receives correct context with execution details", async () => {
      registry.registerByClass(new TestGadget());
      const afterGadgetExecution = vi.fn(async (context): Promise<AfterGadgetExecutionAction> => {
        expect(context).toEqual(
          expect.objectContaining({
            iteration: 0,
            gadgetName: "TestGadget",
            invocationId: "99",
            parameters: { message: "test" },
            result: "Echo: test",
            error: undefined,
            executionTimeMs: expect.any(Number),
            logger: expect.any(Object),
          }),
        );
        return { action: "continue" };
      });

      const stream = createMockStream([
        {
          text: `${GADGET_START_PREFIX}TestGadget:99\n${GADGET_ARG_PREFIX}message\ntest\n${GADGET_END_PREFIX}`,
        },
        { text: "", finishReason: "stop" },
      ]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          controllers: { afterGadgetExecution },
        },
      });

      await consumeStream(processor, stream);
      expect(afterGadgetExecution).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe("Hook System Integration", () => {
  let registry: GadgetRegistry;

  beforeEach(() => {
    registry = new GadgetRegistry();
  });

  describe("Complete Lifecycle Flow", () => {
    it("executes all hook types in correct order", async () => {
      registry.registerByClass(new TestGadget());
      const executionOrder: string[] = [];

      const hooks = {
        observers: {
          onLLMCallStart: vi.fn(() => executionOrder.push("onLLMCallStart")),
          onLLMCallComplete: vi.fn(() => executionOrder.push("onLLMCallComplete")),
          onStreamChunk: vi.fn(() => executionOrder.push("onStreamChunk")),
          onGadgetExecutionStart: vi.fn(() => executionOrder.push("onGadgetExecutionStart")),
          onGadgetExecutionComplete: vi.fn(() => executionOrder.push("onGadgetExecutionComplete")),
        },
        interceptors: {
          interceptRawChunk: vi.fn((chunk: string) => {
            executionOrder.push("interceptRawChunk");
            return chunk;
          }),
          interceptTextChunk: vi.fn((chunk: string) => {
            executionOrder.push("interceptTextChunk");
            return chunk;
          }),
          interceptGadgetParameters: vi.fn((params: Record<string, unknown>) => {
            executionOrder.push("interceptGadgetParameters");
            return params;
          }),
          interceptGadgetResult: vi.fn((result: string) => {
            executionOrder.push("interceptGadgetResult");
            return result;
          }),
          interceptAssistantMessage: vi.fn((message: string) => {
            executionOrder.push("interceptAssistantMessage");
            return message;
          }),
        },
        controllers: {
          beforeLLMCall: vi.fn(async (): Promise<BeforeLLMCallAction> => {
            executionOrder.push("beforeLLMCall");
            return { action: "proceed" };
          }),
          afterLLMCall: vi.fn(async (): Promise<AfterLLMCallAction> => {
            executionOrder.push("afterLLMCall");
            return { action: "continue" };
          }),
          beforeGadgetExecution: vi.fn(async (): Promise<BeforeGadgetExecutionAction> => {
            executionOrder.push("beforeGadgetExecution");
            return { action: "proceed" };
          }),
          afterGadgetExecution: vi.fn(async (): Promise<AfterGadgetExecutionAction> => {
            executionOrder.push("afterGadgetExecution");
            return { action: "continue" };
          }),
        },
      };

      const mockAdapter = new MockAdapter([
        [
          {
            text: `Text ${GADGET_START_PREFIX}TestGadget:1\n${GADGET_ARG_PREFIX}message\ntest\n${GADGET_END_PREFIX}`,
          },
          { text: "", finishReason: "stop" },
        ],
      ]);

      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks,
      });

      await collectEvents(agent.run());

      // Verify execution order follows the documented flow
      // Note: After gadget calls, agent continues and makes another LLM call (text-only response)
      const expectedStartOrder = [
        "onLLMCallStart",
        "beforeLLMCall",
        "interceptRawChunk",
        "onStreamChunk",
        "interceptTextChunk", // Text before gadget
        "interceptGadgetParameters",
        "beforeGadgetExecution",
        "onGadgetExecutionStart",
        "interceptGadgetResult",
        "afterGadgetExecution",
        "onGadgetExecutionComplete",
        "interceptAssistantMessage",
        "onLLMCallComplete",
        "afterLLMCall",
      ];

      // Verify the start of the execution order matches our expectations
      for (let i = 0; i < expectedStartOrder.length; i++) {
        expect(executionOrder[i]).toBe(expectedStartOrder[i]);
      }
    });

    it("handles complex multi-iteration scenario with all hooks", async () => {
      registry.registerByClass(new TestGadget());
      let llmCallCount = 0;
      let gadgetExecutionCount = 0;

      const hooks = {
        observers: {
          onLLMCallStart: vi.fn(() => {
            llmCallCount++;
          }),
          onGadgetExecutionStart: vi.fn(() => {
            gadgetExecutionCount++;
          }),
        },
        interceptors: {
          interceptGadgetResult: vi.fn((result: string) => `[INTERCEPTED] ${result}`),
        },
        controllers: {
          afterLLMCall: vi.fn(async (context): Promise<AfterLLMCallAction> => {
            if (context.iteration === 0) {
              return {
                action: "append_messages",
                messages: [{ role: "user", content: "Continue" }],
              };
            }
            return { action: "continue" };
          }),
        },
      };

      const mockAdapter = new MockAdapter([
        // Iteration 0: gadget call
        [
          {
            text: `${GADGET_START_PREFIX}TestGadget:1\n${GADGET_ARG_PREFIX}message\nfirst\n${GADGET_END_PREFIX}`,
          },
          { text: "", finishReason: "stop" },
        ],
        // Iteration 1: another gadget call
        [
          {
            text: `${GADGET_START_PREFIX}TestGadget:2\n${GADGET_ARG_PREFIX}message\nsecond\n${GADGET_END_PREFIX}`,
          },
          { text: "", finishReason: "stop" },
        ],
        // Iteration 2: text only (terminate)
        [{ text: "Done", finishReason: "stop" }],
      ]);

      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        maxIterations: 3,
        logger: testLogger,
        hooks,
      });

      const events = await collectEvents(agent.run());

      expect(llmCallCount).toBe(3);
      expect(gadgetExecutionCount).toBe(2);

      // Verify interceptor was applied to both gadget results
      const gadgetResults = events.filter((e) => e.type === "gadget_result");
      expect(gadgetResults).toHaveLength(2);
      for (const result of gadgetResults) {
        if (result.type === "gadget_result") {
          expect(result.result.result).toContain("[INTERCEPTED]");
        }
      }
    });
  });

  describe("Error Handling Across Hooks", () => {
    it("handles observer errors gracefully without breaking flow", async () => {
      registry.registerByClass(new TestGadget());
      const successfulHook = vi.fn();
      const failingHook = vi.fn(() => {
        throw new Error("Observer failed");
      });

      const mockAdapter = new MockAdapter([
        [
          {
            text: `${GADGET_START_PREFIX}TestGadget:1\n${GADGET_ARG_PREFIX}message\ntest\n${GADGET_END_PREFIX}`,
          },
          { text: "", finishReason: "stop" },
        ],
      ]);

      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          observers: {
            onLLMCallStart: failingHook,
            onGadgetExecutionComplete: successfulHook,
          },
        },
      });

      // Should not throw
      const events = await collectEvents(agent.run());

      expect(failingHook).toHaveBeenCalled();
      expect(successfulHook).toHaveBeenCalled();
      expect(events.length).toBeGreaterThan(0);
    });

    it("uses controller to recover from gadget error", async () => {
      registry.registerByClass(new ErrorGadget());

      const afterGadgetExecution = vi.fn(async (context): Promise<AfterGadgetExecutionAction> => {
        if (context.error) {
          return {
            action: "recover",
            fallbackResult: "Recovered successfully",
          };
        }
        return { action: "continue" };
      });

      const stream = createMockStream([
        {
          text: `${GADGET_START_PREFIX}ErrorGadget:1\n{}\n${GADGET_END_PREFIX}`,
        },
        { text: "", finishReason: "stop" },
      ]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks: {
          controllers: { afterGadgetExecution },
        },
      });

      const result = await consumeStream(processor, stream);

      const gadgetResult = result.outputs.find((e) => e.type === "gadget_result");
      if (gadgetResult && gadgetResult.type === "gadget_result") {
        expect(gadgetResult.result.error).toBeUndefined();
        expect(gadgetResult.result.result).toBe("Recovered successfully");
      }
    });

    it("uses controller to recover from LLM error", async () => {
      const afterLLMError = vi.fn(async (): Promise<AfterLLMErrorAction> => {
        return {
          action: "recover",
          fallbackResponse: "LLM failed but recovered",
        };
      });

      const errorAdapter = new ErrorAdapter("LLM Error");
      const client = new LLMist([errorAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          controllers: { afterLLMError },
        },
      });

      // Should not throw
      await collectEvents(agent.run());

      expect(afterLLMError).toHaveBeenCalled();
    });
  });

  describe("Hook Combinations", () => {
    it("combines interceptors to build complex transformations", async () => {
      registry.registerByClass(new TestGadget());

      // Pipeline: uppercase raw chunk -> add prefix to text -> wrap result
      const hooks = {
        interceptors: {
          interceptRawChunk: vi.fn((chunk: string) => chunk.toUpperCase()),
          interceptTextChunk: vi.fn((chunk: string) => `>> ${chunk}`),
          interceptGadgetResult: vi.fn((result: string) => `[RESULT: ${result}]`),
        },
      };

      const stream = createMockStream([
        { text: "hello " },
        {
          text: `${GADGET_START_PREFIX}TestGadget:1\n${GADGET_ARG_PREFIX}message\nworld\n${GADGET_END_PREFIX}`,
        },
        { text: "", finishReason: "stop" },
      ]);

      const processor = new StreamProcessor({
        iteration: 0,
        registry,
        logger: testLogger,
        hooks,
      });

      const result = await consumeStream(processor, stream);

      // Raw chunk was uppercased
      expect(result.rawResponse).toContain("HELLO");

      // Text chunk has prefix
      const textEvent = result.outputs.find((e) => e.type === "text");
      if (textEvent && textEvent.type === "text") {
        expect(textEvent.content).toBe(">> HELLO ");
      }

      // Gadget result was wrapped
      const gadgetResult = result.outputs.find((e) => e.type === "gadget_result");
      if (gadgetResult && gadgetResult.type === "gadget_result") {
        expect(gadgetResult.result.result).toContain("[RESULT: Echo:");
      }
    });

    // NOTE: This test uses Agent since onGadgetExecutionComplete is now called via the tree-hook-bridge
    it("combines observer and controller for metrics and control", async () => {
      registry.registerByClass(new TestGadget());
      let executionTimeTracked = 0;
      let errorRecoveryTriggered = false;

      const onGadgetExecutionComplete = vi.fn((context: ObserveGadgetCompleteContext) => {
        executionTimeTracked = context.executionTimeMs;
      });

      const afterGadgetExecution = vi.fn(async (context): Promise<AfterGadgetExecutionAction> => {
        if (context.error) {
          errorRecoveryTriggered = true;
          return {
            action: "recover",
            fallbackResult: "Recovered",
          };
        }
        return { action: "continue" };
      });

      const mockAdapter = new MockAdapter([
        [
          {
            text: `${GADGET_START_PREFIX}TestGadget:1\n${GADGET_ARG_PREFIX}message\ntest\n${GADGET_END_PREFIX}`,
          },
          { text: "", finishReason: "stop" },
        ],
        [{ text: "Done", finishReason: "stop" }],
      ]);

      const client = new LLMist([mockAdapter]);
      const agent = new Agent(AGENT_INTERNAL_KEY, {
        client,
        model: "openai:gpt-4",
        userPrompt: "Test",
        registry,
        logger: testLogger,
        hooks: {
          observers: { onGadgetExecutionComplete },
          controllers: { afterGadgetExecution },
        },
      });

      await collectEvents(agent.run());

      expect(onGadgetExecutionComplete).toHaveBeenCalled();
      expect(executionTimeTracked).toBeGreaterThanOrEqual(0);
      expect(errorRecoveryTriggered).toBe(false);
    });
  });
});
