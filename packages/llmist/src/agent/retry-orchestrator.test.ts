/**
 * Unit tests for RetryOrchestrator.
 *
 * Tests cover:
 * - Success on first attempt (no retries needed)
 * - Retry on retryable errors with correct backoff/delay
 * - Retry-After header support
 * - Jitter application
 * - Exhausted retries: onRetriesExhausted callback and error re-throw
 * - Non-retryable errors thrown immediately
 * - onRetryAttempt observer hook called with correct context
 * - State reset between retry attempts
 * - Cross-iteration invocation ID accumulation
 * - Retry disabled via config
 */

import type { ILogObj, Logger } from "tslog";
import { describe, expect, it, vi } from "vitest";
import { ExecutionTree } from "../core/execution-tree.js";
import type { LLMGenerationOptions } from "../core/options.js";
import type { ResolvedRetryConfig } from "../core/retry.js";
import type { StreamCompletionEvent, StreamEvent } from "../gadgets/types.js";
import type { AgentHooks } from "./hooks.js";
import { RetryOrchestrator, type RetryResult } from "./retry-orchestrator.js";
import type { StreamProcessor } from "./stream-processor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLogger(): Logger<ILogObj> {
  return {
    warn: vi.fn(() => {}),
    debug: vi.fn(() => {}),
    info: vi.fn(() => {}),
    error: vi.fn(() => {}),
    trace: vi.fn(() => {}),
    fatal: vi.fn(() => {}),
    silly: vi.fn(() => {}),
  } as unknown as Logger<ILogObj>;
}

function createRetryConfig(overrides: Partial<ResolvedRetryConfig> = {}): ResolvedRetryConfig {
  return {
    enabled: true,
    retries: 3,
    minTimeout: 100,
    maxTimeout: 1000,
    factor: 2,
    randomize: false,
    respectRetryAfter: true,
    maxRetryAfterMs: 5000,
    ...overrides,
  };
}

function makeMockStreamCompletionEvent(
  overrides: Partial<StreamCompletionEvent> = {},
): StreamCompletionEvent {
  return {
    type: "stream_complete",
    finishReason: "stop",
    usage: { inputTokens: 10, outputTokens: 20 },
    rawResponse: "raw",
    finalMessage: "final",
    didExecuteGadgets: false,
    shouldBreakLoop: false,
    ...overrides,
  };
}

/**
 * Create a mock StreamProcessor that yields the given events and returns
 * stream_complete as the last event.
 */
function createMockProcessor(
  events: StreamEvent[],
  completionEvent: StreamCompletionEvent,
  completedIds: Set<string> = new Set(),
  failedIds: Set<string> = new Set(),
): StreamProcessor {
  const allEvents: StreamEvent[] = [...events, completionEvent];
  return {
    process: async function* (_stream: unknown) {
      for (const event of allEvents) {
        yield event;
      }
    },
    getCompletedInvocationIds: () => completedIds,
    getFailedInvocationIds: () => failedIds,
  } as unknown as StreamProcessor;
}

/**
 * Create a mock StreamProcessor that throws an error.
 */
function createErrorProcessor(error: Error): StreamProcessor {
  return {
    process: async function* (_stream: unknown) {
      throw error;
      // biome-ignore lint/correctness/noUnreachable: required for generator typing
      yield {} as StreamEvent;
    },
    getCompletedInvocationIds: () => new Set<string>(),
    getFailedInvocationIds: () => new Set<string>(),
  } as unknown as StreamProcessor;
}

type MockStream = AsyncIterable<never>;
const MOCK_STREAM: MockStream = {
  [Symbol.asyncIterator]: async function* () {},
};

function createMockCreateStream(): (
  _opts: LLMGenerationOptions,
  _iter: number,
  _nodeId: string,
) => Promise<MockStream> {
  return vi.fn(async () => MOCK_STREAM);
}

/**
 * Collect all events yielded by the orchestrator's orchestrate() generator
 * and return both the yielded events and the final return value.
 */
async function collectOrchestrate(
  orchestrator: RetryOrchestrator,
  createStreamFn: ReturnType<typeof createMockCreateStream>,
  createProcessorFn: (_iter: number, _nodeId: string) => StreamProcessor,
): Promise<{ events: StreamEvent[]; result: RetryResult | null }> {
  const llmOptions = { model: "test", messages: [] } as unknown as LLMGenerationOptions;
  const gen = orchestrator.orchestrate(llmOptions, 1, "node-1", createStreamFn, createProcessorFn);

  const events: StreamEvent[] = [];
  let next = await gen.next();
  while (!next.done) {
    events.push(next.value);
    next = await gen.next();
  }
  return { events, result: next.value };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RetryOrchestrator", () => {
  // =========================================================================
  // Construction
  // =========================================================================

  describe("constructor", () => {
    it("should create with provided options", () => {
      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig(),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep: vi.fn(),
      });

      expect(orchestrator.getCompletedInvocationIds().size).toBe(0);
      expect(orchestrator.getFailedInvocationIds().size).toBe(0);
    });
  });

  // =========================================================================
  // Success on first attempt
  // =========================================================================

  describe("success on first attempt", () => {
    it("should yield events and return RetryResult on success", async () => {
      const completionEvent = makeMockStreamCompletionEvent();
      const textEvent: StreamEvent = { type: "text", content: "hello" };
      const processor = createMockProcessor([textEvent], completionEvent);

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig(),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep: vi.fn(),
      });

      const createStreamFn = createMockCreateStream();
      const { events, result } = await collectOrchestrate(
        orchestrator,
        createStreamFn,
        () => processor,
      );

      // Should yield the text event (but NOT the stream_complete event)
      expect(events).toEqual([textEvent]);

      // Should return a RetryResult
      expect(result).not.toBeNull();
      expect(result?.streamMetadata).toBe(completionEvent);
      expect(result?.textOutputs).toEqual(["hello"]);
      expect(result?.gadgetResults).toEqual([]);
      expect(result?.gadgetCallCount).toBe(0);
    });

    it("should accumulate gadget_result events and count gadget calls", async () => {
      const completionEvent = makeMockStreamCompletionEvent({ didExecuteGadgets: true });
      const gadgetResult: StreamEvent = {
        type: "gadget_result",
        result: {
          gadgetName: "Calc",
          invocationId: "inv1",
          parameters: {},
          result: "42",
          executionTimeMs: 1,
        },
      };
      const processor = createMockProcessor([gadgetResult], completionEvent);

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig(),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep: vi.fn(),
      });

      const { events, result } = await collectOrchestrate(
        orchestrator,
        createMockCreateStream(),
        () => processor,
      );

      expect(events).toEqual([gadgetResult]);
      expect(result?.gadgetCallCount).toBe(1);
      expect(result?.gadgetResults).toEqual([gadgetResult]);
    });

    it("should not yield stream_complete events to consumer", async () => {
      const completionEvent = makeMockStreamCompletionEvent();
      const processor = createMockProcessor([], completionEvent);

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig(),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep: vi.fn(),
      });

      const { events } = await collectOrchestrate(
        orchestrator,
        createMockCreateStream(),
        () => processor,
      );

      // stream_complete event should NOT be yielded
      expect(events.find((e) => e.type === "stream_complete")).toBeUndefined();
    });

    it("should call tree.endLLMResponse when llm_response_end event received", async () => {
      const tree = new ExecutionTree();
      const endSpy = vi.spyOn(tree, "endLLMResponse");

      const completionEvent = makeMockStreamCompletionEvent();
      const llmResponseEnd: StreamEvent = {
        type: "llm_response_end",
        finishReason: "stop",
        usage: { inputTokens: 5, outputTokens: 10 },
      };
      const processor = createMockProcessor([llmResponseEnd], completionEvent);

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig(),
        logger: createMockLogger(),
        hooks: {},
        tree,
        sleep: vi.fn(),
      });

      // Use a specific node ID to verify the correct ID is forwarded
      const llmOptions = { model: "test", messages: [] } as unknown as LLMGenerationOptions;
      const specificNodeId = "test-llm-node-42";
      const gen = orchestrator.orchestrate(
        llmOptions,
        1,
        specificNodeId,
        createMockCreateStream(),
        () => processor,
      );
      let next = await gen.next();
      while (!next.done) {
        next = await gen.next();
      }

      expect(endSpy).toHaveBeenCalledWith(specificNodeId, {
        finishReason: "stop",
        usage: { inputTokens: 5, outputTokens: 10 },
      });
    });
  });

  // =========================================================================
  // Cross-iteration invocation ID accumulation
  // =========================================================================

  describe("cross-iteration invocation ID tracking", () => {
    it("should accumulate completed invocation IDs from processor", async () => {
      const completionEvent = makeMockStreamCompletionEvent();
      const completedIds = new Set(["inv1", "inv2"]);
      const processor = createMockProcessor([], completionEvent, completedIds);

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig(),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep: vi.fn(),
      });

      await collectOrchestrate(orchestrator, createMockCreateStream(), () => processor);

      expect(orchestrator.getCompletedInvocationIds()).toEqual(new Set(["inv1", "inv2"]));
    });

    it("should accumulate failed invocation IDs from processor", async () => {
      const completionEvent = makeMockStreamCompletionEvent();
      const failedIds = new Set(["inv3"]);
      const processor = createMockProcessor([], completionEvent, new Set(), failedIds);

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig(),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep: vi.fn(),
      });

      await collectOrchestrate(orchestrator, createMockCreateStream(), () => processor);

      expect(orchestrator.getFailedInvocationIds()).toEqual(new Set(["inv3"]));
    });

    it("should reset invocation IDs at the start of each orchestrate() call", async () => {
      const completionEvent = makeMockStreamCompletionEvent();
      const completedIds = new Set(["inv1"]);
      const processor = createMockProcessor([], completionEvent, completedIds);

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig(),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep: vi.fn(),
      });

      // First call
      await collectOrchestrate(orchestrator, createMockCreateStream(), () => processor);
      expect(orchestrator.getCompletedInvocationIds()).toEqual(new Set(["inv1"]));

      // Second call with different IDs
      const completedIds2 = new Set(["inv_fresh"]);
      const processor2 = createMockProcessor([], completionEvent, completedIds2);
      await collectOrchestrate(orchestrator, createMockCreateStream(), () => processor2);

      // Should only contain IDs from the second call, not the first
      expect(orchestrator.getCompletedInvocationIds()).toEqual(new Set(["inv_fresh"]));
    });
  });

  // =========================================================================
  // Retry on retryable errors
  // =========================================================================

  describe("retry on retryable errors", () => {
    it("should retry on retryable error and succeed on second attempt", async () => {
      const rateLimitError = Object.assign(new Error("rate limit exceeded"), { status: 429 });
      const completionEvent = makeMockStreamCompletionEvent();
      const successProcessor = createMockProcessor([], completionEvent);
      const errorProcessor = createErrorProcessor(rateLimitError);
      const sleep = vi.fn(async () => {});

      let attempt = 0;
      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig({ retries: 2, randomize: false }),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep,
      });

      const { result } = await collectOrchestrate(orchestrator, createMockCreateStream(), () =>
        ++attempt === 1 ? errorProcessor : successProcessor,
      );

      expect(result).not.toBeNull();
      expect(result?.streamMetadata).toBe(completionEvent);
      expect(sleep).toHaveBeenCalledOnce();
    });

    it("should calculate correct exponential backoff delay", async () => {
      const error = Object.assign(new Error("502 bad gateway"), { status: 502 });
      const completionEvent = makeMockStreamCompletionEvent();

      const sleep = vi.fn(async () => {});
      let attempt = 0;

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig({
          retries: 3,
          minTimeout: 100,
          factor: 2,
          randomize: false,
          respectRetryAfter: false,
        }),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep,
      });

      await collectOrchestrate(orchestrator, createMockCreateStream(), () =>
        ++attempt < 3 ? createErrorProcessor(error) : createMockProcessor([], completionEvent),
      );

      // Attempt 1 fails: delay = 100 * 2^0 = 100ms
      // Attempt 2 fails: delay = 100 * 2^1 = 200ms
      expect(sleep).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenNthCalledWith(1, 100);
      expect(sleep).toHaveBeenNthCalledWith(2, 200);
    });

    it("should cap delay at maxTimeout", async () => {
      const error = Object.assign(new Error("server error"), { status: 503 });
      const completionEvent = makeMockStreamCompletionEvent();

      const sleep = vi.fn(async () => {});
      let attempt = 0;

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig({
          retries: 3,
          minTimeout: 1000,
          maxTimeout: 500, // less than minTimeout intentionally — cap applies immediately
          factor: 2,
          randomize: false,
          respectRetryAfter: false,
        }),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep,
      });

      await collectOrchestrate(orchestrator, createMockCreateStream(), () =>
        ++attempt < 2 ? createErrorProcessor(error) : createMockProcessor([], completionEvent),
      );

      // baseDelay = 1000 * 2^0 = 1000, capped at maxTimeout = 500
      expect(sleep).toHaveBeenCalledWith(500);
    });

    it("should apply jitter when randomize is true", async () => {
      const error = Object.assign(new Error("rate_limit"), { status: 429 });
      const completionEvent = makeMockStreamCompletionEvent();
      const sleep = vi.fn(async () => {});
      let attempt = 0;

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig({
          retries: 2,
          minTimeout: 1000,
          factor: 1,
          randomize: true, // jitter enabled
          respectRetryAfter: false,
        }),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep,
      });

      await collectOrchestrate(orchestrator, createMockCreateStream(), () =>
        ++attempt < 2 ? createErrorProcessor(error) : createMockProcessor([], completionEvent),
      );

      // With jitter: finalDelay = delay * (0.5 + Math.random())
      // delay = 1000 * 1^0 = 1000, so finalDelay is between 500 and 1500
      const delayArg = (sleep as ReturnType<typeof vi.fn>).mock.calls[0][0] as number;
      expect(delayArg).toBeGreaterThanOrEqual(500);
      expect(delayArg).toBeLessThanOrEqual(1500);
    });

    it("should reset accumulated state between retry attempts", async () => {
      const rateLimitError = Object.assign(new Error("429"), { status: 429 });
      const completionEvent = makeMockStreamCompletionEvent();
      const textEvent: StreamEvent = { type: "text", content: "partial text from failed attempt" };

      // First processor yields a text event then throws
      let streamCallCount = 0;
      const sleep = vi.fn(async () => {});

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig({ retries: 2, randomize: false }),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep,
      });

      // First attempt: yields a text event then fails mid-stream
      const firstProcessor = {
        process: async function* (_stream: unknown) {
          yield textEvent;
          throw rateLimitError;
          // biome-ignore lint/correctness/noUnreachable: required for generator typing
          yield {} as StreamEvent;
        },
        getCompletedInvocationIds: () => new Set<string>(),
        getFailedInvocationIds: () => new Set<string>(),
      } as unknown as StreamProcessor;

      // Second attempt: yields a fresh text event and succeeds
      const freshTextEvent: StreamEvent = { type: "text", content: "fresh text" };
      const secondProcessor = createMockProcessor([freshTextEvent], completionEvent);

      let collected: RetryResult | null = null;
      const llmOptions = { model: "test", messages: [] } as unknown as LLMGenerationOptions;
      const gen = orchestrator.orchestrate(llmOptions, 1, "node-1", createMockCreateStream(), () =>
        ++streamCallCount === 1 ? firstProcessor : secondProcessor,
      );

      const allEvents: StreamEvent[] = [];
      let next = await gen.next();
      while (!next.done) {
        allEvents.push(next.value);
        next = await gen.next();
      }
      collected = next.value;

      // The partial text from the failed first attempt should be reset
      // so textOutputs should only contain the fresh text
      expect(collected?.textOutputs).toEqual(["fresh text"]);
      expect(collected?.textOutputs).not.toContain("partial text from failed attempt");
    });

    it("should call onRetry callback on each retry", async () => {
      const error = Object.assign(new Error("429"), { status: 429 });
      const completionEvent = makeMockStreamCompletionEvent();
      const onRetry = vi.fn();
      let attempt = 0;

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig({ retries: 2, onRetry, randomize: false }),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep: vi.fn(async () => {}),
      });

      await collectOrchestrate(orchestrator, createMockCreateStream(), () =>
        ++attempt < 2 ? createErrorProcessor(error) : createMockProcessor([], completionEvent),
      );

      expect(onRetry).toHaveBeenCalledOnce();
      expect(onRetry).toHaveBeenCalledWith(error, 1); // called with (error, attemptNumber)
    });
  });

  // =========================================================================
  // Retry-After support
  // =========================================================================

  describe("Retry-After header support", () => {
    it("should use Retry-After delay when respectRetryAfter is true", async () => {
      const error = Object.assign(new Error("rate limit"), {
        status: 429,
        headers: { "retry-after": "2" }, // 2 seconds
      });
      const completionEvent = makeMockStreamCompletionEvent();
      const sleep = vi.fn(async () => {});
      let attempt = 0;

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig({
          retries: 2,
          minTimeout: 100,
          factor: 1,
          randomize: false,
          respectRetryAfter: true,
          maxRetryAfterMs: 5000,
        }),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep,
      });

      await collectOrchestrate(orchestrator, createMockCreateStream(), () =>
        ++attempt < 2 ? createErrorProcessor(error) : createMockProcessor([], completionEvent),
      );

      // Should use Retry-After (2000ms) rather than exponential backoff (100ms)
      expect(sleep).toHaveBeenCalledWith(2000);
    });

    it("should cap Retry-After delay at maxRetryAfterMs", async () => {
      const error = Object.assign(new Error("rate limit"), {
        status: 429,
        headers: { "retry-after": "100" }, // 100 seconds
      });
      const completionEvent = makeMockStreamCompletionEvent();
      const sleep = vi.fn(async () => {});
      let attempt = 0;

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig({
          retries: 2,
          minTimeout: 100,
          factor: 1,
          randomize: false,
          respectRetryAfter: true,
          maxRetryAfterMs: 5000, // 5 second cap
        }),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep,
      });

      await collectOrchestrate(orchestrator, createMockCreateStream(), () =>
        ++attempt < 2 ? createErrorProcessor(error) : createMockProcessor([], completionEvent),
      );

      // Should be capped at maxRetryAfterMs (5000ms)
      expect(sleep).toHaveBeenCalledWith(5000);
    });

    it("should ignore Retry-After when respectRetryAfter is false", async () => {
      const error = Object.assign(new Error("rate limit"), {
        status: 429,
        headers: { "retry-after": "100" },
      });
      const completionEvent = makeMockStreamCompletionEvent();
      const sleep = vi.fn(async () => {});
      let attempt = 0;

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig({
          retries: 2,
          minTimeout: 200,
          factor: 1,
          randomize: false,
          respectRetryAfter: false,
        }),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep,
      });

      await collectOrchestrate(orchestrator, createMockCreateStream(), () =>
        ++attempt < 2 ? createErrorProcessor(error) : createMockProcessor([], completionEvent),
      );

      // Should use minTimeout (200ms) not Retry-After (100000ms)
      expect(sleep).toHaveBeenCalledWith(200);
    });
  });

  // =========================================================================
  // Observer hook: onRetryAttempt
  // =========================================================================

  describe("onRetryAttempt observer hook", () => {
    it("should call onRetryAttempt with correct context on retry", async () => {
      const error = Object.assign(new Error("rate_limit exceeded"), { status: 429 });
      const completionEvent = makeMockStreamCompletionEvent();
      const onRetryAttempt = vi.fn(async () => {});
      let attempt = 0;

      const hooks: AgentHooks = {
        observers: { onRetryAttempt },
      };

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig({ retries: 2, randomize: false }),
        logger: createMockLogger(),
        hooks,
        tree: new ExecutionTree(),
        sleep: vi.fn(async () => {}),
      });

      await collectOrchestrate(orchestrator, createMockCreateStream(), () =>
        ++attempt < 2 ? createErrorProcessor(error) : createMockProcessor([], completionEvent),
      );

      expect(onRetryAttempt).toHaveBeenCalledOnce();
      const ctx = onRetryAttempt.mock.calls[0][0];
      expect(ctx.iteration).toBe(1);
      expect(ctx.attemptNumber).toBe(1);
      expect(ctx.retriesLeft).toBe(2); // retries:2, first attempt failed → 2 left
      expect(ctx.error).toBe(error);
      expect(ctx.logger).toBeDefined();
    });

    it("should pass retryAfterMs to observer when Retry-After header present", async () => {
      const error = Object.assign(new Error("rate limit"), {
        status: 429,
        headers: { "retry-after": "3" },
      });
      const completionEvent = makeMockStreamCompletionEvent();
      const onRetryAttempt = vi.fn(async () => {});
      let attempt = 0;

      const hooks: AgentHooks = {
        observers: { onRetryAttempt },
      };

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig({ retries: 2, randomize: false }),
        logger: createMockLogger(),
        hooks,
        tree: new ExecutionTree(),
        sleep: vi.fn(async () => {}),
      });

      await collectOrchestrate(orchestrator, createMockCreateStream(), () =>
        ++attempt < 2 ? createErrorProcessor(error) : createMockProcessor([], completionEvent),
      );

      const ctx = onRetryAttempt.mock.calls[0][0];
      expect(ctx.retryAfterMs).toBe(3000); // 3 seconds = 3000ms
    });

    it("should not call onRetryAttempt when observer is not defined", async () => {
      const error = Object.assign(new Error("429"), { status: 429 });
      const completionEvent = makeMockStreamCompletionEvent();
      let attempt = 0;

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig({ retries: 2, randomize: false }),
        logger: createMockLogger(),
        hooks: {}, // no observers
        tree: new ExecutionTree(),
        sleep: vi.fn(async () => {}),
      });

      // Should not throw even without observers
      await expect(
        collectOrchestrate(orchestrator, createMockCreateStream(), () =>
          ++attempt < 2 ? createErrorProcessor(error) : createMockProcessor([], completionEvent),
        ),
      ).resolves.not.toThrow();
    });
  });

  // =========================================================================
  // Retries exhausted
  // =========================================================================

  describe("retries exhausted", () => {
    it("should throw error when all retries exhausted", async () => {
      const error = Object.assign(new Error("server error"), { status: 500 });

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig({ retries: 2, randomize: false }),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep: vi.fn(async () => {}),
      });

      await expect(
        collectOrchestrate(orchestrator, createMockCreateStream(), () =>
          createErrorProcessor(error),
        ),
      ).rejects.toThrow("server error");
    });

    it("should call onRetriesExhausted when all retries are used", async () => {
      const error = Object.assign(new Error("503"), { status: 503 });
      const onRetriesExhausted = vi.fn();

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig({ retries: 2, onRetriesExhausted, randomize: false }),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep: vi.fn(async () => {}),
      });

      await expect(
        collectOrchestrate(orchestrator, createMockCreateStream(), () =>
          createErrorProcessor(error),
        ),
      ).rejects.toThrow();

      expect(onRetriesExhausted).toHaveBeenCalledWith(error, 3); // 3 attempts total (1 + 2 retries)
    });

    it("should sleep between each retry attempt", async () => {
      const error = Object.assign(new Error("500"), { status: 500 });
      const sleep = vi.fn(async () => {});

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig({ retries: 3, minTimeout: 50, factor: 2, randomize: false }),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep,
      });

      await expect(
        collectOrchestrate(orchestrator, createMockCreateStream(), () =>
          createErrorProcessor(error),
        ),
      ).rejects.toThrow();

      // 3 retries = 3 sleep calls
      expect(sleep).toHaveBeenCalledTimes(3);
    });
  });

  // =========================================================================
  // Non-retryable errors
  // =========================================================================

  describe("non-retryable errors", () => {
    it("should throw immediately for non-retryable errors", async () => {
      const error = Object.assign(new Error("bad request"), { status: 400 });
      const sleep = vi.fn(async () => {});

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig({ retries: 3, randomize: false }),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep,
      });

      await expect(
        collectOrchestrate(orchestrator, createMockCreateStream(), () =>
          createErrorProcessor(error),
        ),
      ).rejects.toThrow("bad request");

      // Should not have slept (error was non-retryable)
      expect(sleep).not.toHaveBeenCalled();
    });

    it("should use custom shouldRetry function when provided", async () => {
      const error = new Error("custom non-retryable");
      const sleep = vi.fn(async () => {});
      // Custom shouldRetry says everything is non-retryable
      const shouldRetry = vi.fn(() => false);

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig({ retries: 3, shouldRetry, randomize: false }),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep,
      });

      await expect(
        collectOrchestrate(orchestrator, createMockCreateStream(), () =>
          createErrorProcessor(error),
        ),
      ).rejects.toThrow("custom non-retryable");

      expect(shouldRetry).toHaveBeenCalledWith(error);
      expect(sleep).not.toHaveBeenCalled();
    });

    it("should use custom shouldRetry function that always retries", async () => {
      const error = new Error("custom error"); // Would normally be non-retryable
      const completionEvent = makeMockStreamCompletionEvent();
      const sleep = vi.fn(async () => {});
      // Custom shouldRetry says everything is retryable
      const shouldRetry = vi.fn(() => true);
      let attempt = 0;

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig({ retries: 2, shouldRetry, randomize: false }),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep,
      });

      const { result } = await collectOrchestrate(orchestrator, createMockCreateStream(), () =>
        ++attempt < 2 ? createErrorProcessor(error) : createMockProcessor([], completionEvent),
      );

      expect(result).not.toBeNull();
      expect(sleep).toHaveBeenCalledOnce();
    });
  });

  // =========================================================================
  // Retry disabled
  // =========================================================================

  describe("retry disabled", () => {
    it("should not retry when enabled is false", async () => {
      const error = Object.assign(new Error("429"), { status: 429 });
      const sleep = vi.fn(async () => {});

      const orchestrator = new RetryOrchestrator({
        retryConfig: createRetryConfig({ enabled: false }),
        logger: createMockLogger(),
        hooks: {},
        tree: new ExecutionTree(),
        sleep,
      });

      await expect(
        collectOrchestrate(orchestrator, createMockCreateStream(), () =>
          createErrorProcessor(error),
        ),
      ).rejects.toThrow("429");

      expect(sleep).not.toHaveBeenCalled();
    });
  });
});
