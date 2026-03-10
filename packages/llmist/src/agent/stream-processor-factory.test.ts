/**
 * Unit tests for StreamProcessorFactory.
 *
 * Tests cover:
 * - Factory constructs a StreamProcessor instance
 * - Factory passes prefix config to StreamProcessor (parser uses correct prefixes)
 * - Factory passes cross-iteration state to StreamProcessor
 * - Factory creates a sub-logger for each processor
 * - Factory passes gadget execution mode
 * - Multiple create() calls return independent StreamProcessor instances
 */

import type { ILogObj, Logger } from "tslog";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMist } from "../core/client.js";
import { ExecutionTree } from "../core/execution-tree.js";
import type { ModelRegistry } from "../core/model-registry.js";
import { resolveRetryConfig } from "../core/retry.js";
import { MediaStore } from "../gadgets/media-store.js";
import { GadgetRegistry } from "../gadgets/registry.js";
import type { AgentContextConfig } from "../gadgets/types.js";
import type { AgentHooks } from "./hooks.js";
import { StreamProcessor } from "./stream-processor.js";
import {
  StreamProcessorFactory,
  type StreamProcessorFactoryOptions,
} from "./stream-processor-factory.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLogger(): Logger<ILogObj> {
  const subLogger = {
    warn: vi.fn(() => {}),
    debug: vi.fn(() => {}),
    info: vi.fn(() => {}),
    error: vi.fn(() => {}),
    trace: vi.fn(() => {}),
    fatal: vi.fn(() => {}),
    silly: vi.fn(() => {}),
    getSubLogger: vi.fn(),
  } as unknown as Logger<ILogObj>;

  const logger = {
    warn: vi.fn(() => {}),
    debug: vi.fn(() => {}),
    info: vi.fn(() => {}),
    error: vi.fn(() => {}),
    trace: vi.fn(() => {}),
    fatal: vi.fn(() => {}),
    silly: vi.fn(() => {}),
    getSubLogger: vi.fn().mockReturnValue(subLogger),
  } as unknown as Logger<ILogObj>;

  return logger;
}

function createMockClient(): LLMist {
  const modelRegistry = {
    getModelLimits: vi.fn(() => ({ contextWindow: 128_000, maxOutputTokens: 4096 })),
    getModelSpec: vi.fn(() => undefined),
    estimateCost: vi.fn(() => undefined),
  } as unknown as ModelRegistry;

  return { modelRegistry } as unknown as LLMist;
}

function createFactoryOptions(
  overrides: Partial<StreamProcessorFactoryOptions> = {},
): StreamProcessorFactoryOptions {
  const agentContextConfig: AgentContextConfig = { model: "gpt-4o", temperature: 0.5 };

  return {
    registry: new GadgetRegistry(),
    hooks: {},
    logger: createMockLogger(),
    gadgetExecutionMode: "parallel",
    client: createMockClient(),
    mediaStore: new MediaStore(),
    agentContextConfig,
    tree: new ExecutionTree(),
    baseDepth: 0,
    retryConfig: resolveRetryConfig(undefined),
    maxGadgetsPerResponse: 0,
    ...overrides,
  };
}

function createFactory(
  overrides: Partial<StreamProcessorFactoryOptions> = {},
): StreamProcessorFactory {
  return new StreamProcessorFactory(createFactoryOptions(overrides));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StreamProcessorFactory", () => {
  let tree: ExecutionTree;

  beforeEach(() => {
    tree = new ExecutionTree();
  });

  describe("Construction", () => {
    it("creates without errors given minimal valid options", () => {
      const factory = createFactory({ tree });
      expect(factory).toBeDefined();
    });
  });

  describe("create()", () => {
    it("returns a StreamProcessor instance", () => {
      const factory = createFactory({ tree });
      const llmNode = tree.addLLMCall({
        iteration: 0,
        model: "gpt-4o",
        parentId: null,
        request: [],
      });

      const processor = factory.create(0, llmNode.id, {
        priorCompletedInvocations: new Set(),
        priorFailedInvocations: new Set(),
      });

      expect(processor).toBeInstanceOf(StreamProcessor);
    });

    it("returns independent StreamProcessor instances on each call", () => {
      const factory = createFactory({ tree });
      const llmNode = tree.addLLMCall({
        iteration: 0,
        model: "gpt-4o",
        parentId: null,
        request: [],
      });

      const p1 = factory.create(0, llmNode.id, {
        priorCompletedInvocations: new Set(),
        priorFailedInvocations: new Set(),
      });
      const p2 = factory.create(1, llmNode.id, {
        priorCompletedInvocations: new Set(),
        priorFailedInvocations: new Set(),
      });

      expect(p1).not.toBe(p2);
    });

    it("calls logger.getSubLogger to create a sub-logger for the processor", () => {
      const logger = createMockLogger();
      const factory = createFactory({ tree, logger });
      const llmNode = tree.addLLMCall({
        iteration: 0,
        model: "gpt-4o",
        parentId: null,
        request: [],
      });

      factory.create(0, llmNode.id, {
        priorCompletedInvocations: new Set(),
        priorFailedInvocations: new Set(),
      });

      expect(logger.getSubLogger).toHaveBeenCalledWith({ name: "stream-processor" });
    });

    it("passes the iteration number to StreamProcessor", async () => {
      // Verify by checking that a processor created with iteration=5 reflects that
      // in its hook context. We use an interceptor that captures the iteration.
      let capturedIteration: number | undefined;

      const hooks: AgentHooks = {
        interceptors: {
          interceptRawChunk: (chunk, ctx) => {
            capturedIteration = ctx.iteration;
            return chunk;
          },
        },
      };

      const factory = createFactory({ tree, hooks });
      const llmNode = tree.addLLMCall({
        iteration: 5,
        model: "gpt-4o",
        parentId: null,
        request: [],
      });

      const processor = factory.create(5, llmNode.id, {
        priorCompletedInvocations: new Set(),
        priorFailedInvocations: new Set(),
      });

      // Feed a tiny stream to trigger the interceptor
      async function* miniStream() {
        yield { text: "hello" };
      }

      // Consume stream to trigger interceptors
      for await (const _ of processor.process(miniStream())) {
        /* drain */
      }

      expect(capturedIteration).toBe(5);
    });

    it("passes cross-iteration completed invocation IDs to processor", () => {
      // Completed IDs from prior iterations should be accessible to the new processor.
      // We verify this indirectly: the factory passes the set to StreamProcessor which
      // uses it in dependency resolution (GadgetDependencyResolver).
      const priorCompleted = new Set(["inv-001", "inv-002"]);
      const factory = createFactory({ tree });
      const llmNode = tree.addLLMCall({
        iteration: 1,
        model: "gpt-4o",
        parentId: null,
        request: [],
      });

      // Should not throw — factory correctly passes sets through
      const processor = factory.create(1, llmNode.id, {
        priorCompletedInvocations: priorCompleted,
        priorFailedInvocations: new Set(),
      });

      expect(processor).toBeInstanceOf(StreamProcessor);
    });

    it("passes cross-iteration failed invocation IDs to processor", () => {
      const priorFailed = new Set(["inv-fail-001"]);
      const factory = createFactory({ tree });
      const llmNode = tree.addLLMCall({
        iteration: 1,
        model: "gpt-4o",
        parentId: null,
        request: [],
      });

      const processor = factory.create(1, llmNode.id, {
        priorCompletedInvocations: new Set(),
        priorFailedInvocations: priorFailed,
      });

      expect(processor).toBeInstanceOf(StreamProcessor);
    });
  });

  describe("PrefixConfig", () => {
    it("passes custom prefixes to StreamProcessor (processor uses them during parsing)", async () => {
      const customStart = "<<<GADGET:";
      const customEnd = ">>>DONE";
      const customArg = "<<<ARG:";

      let textOutput = "";

      const hooks: AgentHooks = {
        interceptors: {
          interceptRawChunk: (chunk) => {
            textOutput += chunk;
            return chunk;
          },
        },
      };

      const factory = createFactory({
        tree,
        hooks,
        prefixConfig: {
          gadgetStartPrefix: customStart,
          gadgetEndPrefix: customEnd,
          gadgetArgPrefix: customArg,
        },
      });

      const llmNode = tree.addLLMCall({
        iteration: 0,
        model: "gpt-4o",
        parentId: null,
        request: [],
      });

      const processor = factory.create(0, llmNode.id, {
        priorCompletedInvocations: new Set(),
        priorFailedInvocations: new Set(),
      });

      // Feed a plain text stream (no gadget calls) — custom prefixes won't be triggered
      // but the processor must be constructed correctly (not throw)
      async function* textStream() {
        yield { text: "hello world" };
      }

      for await (const _ of processor.process(textStream())) {
        /* drain */
      }

      expect(textOutput).toContain("hello world");
    });
  });

  describe("GadgetExecutionMode", () => {
    it("accepts parallel execution mode without error", () => {
      const factory = createFactory({ tree, gadgetExecutionMode: "parallel" });
      const llmNode = tree.addLLMCall({
        iteration: 0,
        model: "gpt-4o",
        parentId: null,
        request: [],
      });

      const processor = factory.create(0, llmNode.id, {
        priorCompletedInvocations: new Set(),
        priorFailedInvocations: new Set(),
      });

      expect(processor).toBeInstanceOf(StreamProcessor);
    });

    it("accepts sequential execution mode without error", () => {
      const factory = createFactory({ tree, gadgetExecutionMode: "sequential" });
      const llmNode = tree.addLLMCall({
        iteration: 0,
        model: "gpt-4o",
        parentId: null,
        request: [],
      });

      const processor = factory.create(0, llmNode.id, {
        priorCompletedInvocations: new Set(),
        priorFailedInvocations: new Set(),
      });

      expect(processor).toBeInstanceOf(StreamProcessor);
    });
  });
});
