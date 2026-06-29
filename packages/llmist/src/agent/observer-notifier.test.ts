import type { ILogObj, Logger } from "tslog";
import { describe, expect, it, vi } from "vitest";
import { ExecutionTree, type NodeId } from "../core/execution-tree.js";
import type { GadgetArgsPartialEvent } from "../gadgets/types.js";
import type {
  ObserveGadgetArgsPartialContext,
  ObserveGadgetCompleteContext,
  ObserveGadgetSkippedContext,
  ObserveGadgetStartContext,
  Observers,
} from "./hooks.js";
import {
  notifyGadgetArgsPartial,
  notifyGadgetComplete,
  notifyGadgetSkipped,
  notifyGadgetStart,
} from "./observer-notifier.js";

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

/**
 * Build an ExecutionTree with a gadget node for the given invocationId.
 * Returns { tree, invocationId } for use in tests.
 */
function buildTreeWithGadget(invocationId: string): {
  tree: ExecutionTree;
  invocationId: string;
} {
  const tree = new ExecutionTree();
  const llmNode = tree.addLLMCall({ iteration: 1, model: "test-model" });
  tree.addGadget({
    invocationId,
    name: "TestGadget",
    parameters: { input: "value" },
    parentId: llmNode.id,
  });
  return { tree, invocationId };
}

/**
 * Build a tree shaped like a subagent execution:
 *   root LLM → spawning gadget → subagent LLM
 * The subagent's LLM node is the partial's `parentNodeId`; because it has a
 * parent gadget in its ancestry, `getSubagentContextForNode` resolves a real
 * (non-undefined) SubagentContext from it.
 */
function buildTreeWithSubagentLLM(): {
  tree: ExecutionTree;
  subagentLLMNodeId: NodeId;
  spawnInvocationId: string;
} {
  const tree = new ExecutionTree();
  const rootLLM = tree.addLLMCall({ iteration: 1, model: "test-model" });
  const spawn = tree.addGadget({
    invocationId: "spawn_1",
    name: "Subagent",
    parameters: {},
    parentId: rootLLM.id,
  });
  const subagentLLM = tree.addLLMCall({
    iteration: 1,
    model: "test-model",
    parentId: spawn.id,
  });
  return { tree, subagentLLMNodeId: subagentLLM.id, spawnInvocationId: "spawn_1" };
}

/** Build a gadget_args_partial event with sensible defaults. */
function makePartialEvent(overrides: Partial<GadgetArgsPartialEvent> = {}): GadgetArgsPartialEvent {
  return {
    type: "gadget_args_partial",
    invocationId: "gadget_1",
    gadgetName: "FillForm",
    fieldPath: "title",
    value: "Hello",
    delta: "lo",
    isFieldComplete: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: notifyGadgetStart
// ---------------------------------------------------------------------------

describe("notifyGadgetStart", () => {
  describe("observer calling", () => {
    it("should call hooks.observers.onGadgetExecutionStart when defined", async () => {
      const logger = createMockLogger();
      const { tree, invocationId } = buildTreeWithGadget("g1");
      const capturedContexts: ObserveGadgetStartContext[] = [];

      const hooks: Observers = {
        onGadgetExecutionStart: (ctx) => {
          capturedContexts.push(ctx);
        },
      };

      await notifyGadgetStart({
        tree,
        hooks,
        parentObservers: undefined,
        logger,
        iteration: 1,
        gadgetName: "TestGadget",
        invocationId,
        parameters: { input: "value" },
      });

      expect(capturedContexts).toHaveLength(1);
      expect(capturedContexts[0].gadgetName).toBe("TestGadget");
      expect(capturedContexts[0].invocationId).toBe(invocationId);
      expect(capturedContexts[0].iteration).toBe(1);
      expect(capturedContexts[0].parameters).toEqual({ input: "value" });
    });

    it("should call parentObservers.onGadgetExecutionStart when defined", async () => {
      const logger = createMockLogger();
      const { tree, invocationId } = buildTreeWithGadget("g1");
      const capturedContexts: ObserveGadgetStartContext[] = [];

      const parentObservers: Observers = {
        onGadgetExecutionStart: (ctx) => {
          capturedContexts.push(ctx);
        },
      };

      await notifyGadgetStart({
        tree,
        hooks: undefined,
        parentObservers,
        logger,
        iteration: 2,
        gadgetName: "TestGadget",
        invocationId,
        parameters: {},
      });

      expect(capturedContexts).toHaveLength(1);
      expect(capturedContexts[0].iteration).toBe(2);
    });

    it("should call both hooks and parentObservers sequentially", async () => {
      const logger = createMockLogger();
      const { tree, invocationId } = buildTreeWithGadget("g1");
      const order: string[] = [];

      const hooks: Observers = {
        onGadgetExecutionStart: async () => {
          await Promise.resolve();
          order.push("hooks");
        },
      };

      const parentObservers: Observers = {
        onGadgetExecutionStart: async () => {
          await Promise.resolve();
          order.push("parentObservers");
        },
      };

      await notifyGadgetStart({
        tree,
        hooks,
        parentObservers,
        logger,
        iteration: 1,
        gadgetName: "TestGadget",
        invocationId,
        parameters: {},
      });

      // hooks must be called before parentObservers (sequential await)
      expect(order).toEqual(["hooks", "parentObservers"]);
    });

    it("should do nothing when neither hooks nor parentObservers are defined", async () => {
      const logger = createMockLogger();
      const { tree, invocationId } = buildTreeWithGadget("g1");

      await expect(
        notifyGadgetStart({
          tree,
          hooks: undefined,
          parentObservers: undefined,
          logger,
          iteration: 1,
          gadgetName: "TestGadget",
          invocationId,
          parameters: {},
        }),
      ).resolves.toBeUndefined();

      expect(logger.error).not.toHaveBeenCalled();
    });

    it("should do nothing when hooks has no onGadgetExecutionStart", async () => {
      const logger = createMockLogger();
      const { tree, invocationId } = buildTreeWithGadget("g1");

      await notifyGadgetStart({
        tree,
        hooks: {}, // empty observers
        parentObservers: undefined,
        logger,
        iteration: 1,
        gadgetName: "TestGadget",
        invocationId,
        parameters: {},
      });

      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe("subagentContext resolution", () => {
    it("should pass undefined subagentContext when tree is undefined", async () => {
      const logger = createMockLogger();
      const capturedContexts: ObserveGadgetStartContext[] = [];

      const hooks: Observers = {
        onGadgetExecutionStart: (ctx) => capturedContexts.push(ctx),
      };

      await notifyGadgetStart({
        tree: undefined,
        hooks,
        parentObservers: undefined,
        logger,
        iteration: 1,
        gadgetName: "TestGadget",
        invocationId: "g1",
        parameters: {},
      });

      expect(capturedContexts[0].subagentContext).toBeUndefined();
    });

    it("should pass undefined subagentContext for root-level gadgets", async () => {
      const logger = createMockLogger();
      const { tree, invocationId } = buildTreeWithGadget("root-gadget");
      const capturedContexts: ObserveGadgetStartContext[] = [];

      const hooks: Observers = {
        onGadgetExecutionStart: (ctx) => capturedContexts.push(ctx),
      };

      await notifyGadgetStart({
        tree,
        hooks,
        parentObservers: undefined,
        logger,
        iteration: 1,
        gadgetName: "TestGadget",
        invocationId,
        parameters: {},
      });

      // Root gadgets have no parent gadget, so subagentContext is undefined
      expect(capturedContexts[0].subagentContext).toBeUndefined();
    });

    it("should pass logger in observer context", async () => {
      const logger = createMockLogger();
      const { tree, invocationId } = buildTreeWithGadget("g1");
      const capturedContexts: ObserveGadgetStartContext[] = [];

      const hooks: Observers = {
        onGadgetExecutionStart: (ctx) => capturedContexts.push(ctx),
      };

      await notifyGadgetStart({
        tree,
        hooks,
        parentObservers: undefined,
        logger,
        iteration: 1,
        gadgetName: "TestGadget",
        invocationId,
        parameters: {},
      });

      expect(capturedContexts[0].logger).toBe(logger);
    });
  });

  describe("error isolation", () => {
    it("should not throw when hooks observer throws an error", async () => {
      const logger = createMockLogger();
      const { tree, invocationId } = buildTreeWithGadget("g1");

      const hooks: Observers = {
        onGadgetExecutionStart: () => {
          throw new Error("observer error");
        },
      };

      await expect(
        notifyGadgetStart({
          tree,
          hooks,
          parentObservers: undefined,
          logger,
          iteration: 1,
          gadgetName: "TestGadget",
          invocationId,
          parameters: {},
        }),
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it("should still call parentObservers even if hooks observer throws", async () => {
      const logger = createMockLogger();
      const { tree, invocationId } = buildTreeWithGadget("g1");
      const parentCalled: boolean[] = [];

      const hooks: Observers = {
        onGadgetExecutionStart: () => {
          throw new Error("hooks error");
        },
      };

      const parentObservers: Observers = {
        onGadgetExecutionStart: () => {
          parentCalled.push(true);
        },
      };

      await notifyGadgetStart({
        tree,
        hooks,
        parentObservers,
        logger,
        iteration: 1,
        gadgetName: "TestGadget",
        invocationId,
        parameters: {},
      });

      expect(parentCalled).toEqual([true]);
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: notifyGadgetSkipped
// ---------------------------------------------------------------------------

describe("notifyGadgetSkipped", () => {
  describe("observer calling", () => {
    it("should call hooks.observers.onGadgetSkipped with correct context", async () => {
      const logger = createMockLogger();
      const { tree, invocationId } = buildTreeWithGadget("g1");
      const capturedContexts: ObserveGadgetSkippedContext[] = [];

      const hooks: Observers = {
        onGadgetSkipped: (ctx) => capturedContexts.push(ctx),
      };

      await notifyGadgetSkipped({
        tree,
        hooks,
        parentObservers: undefined,
        logger,
        iteration: 1,
        gadgetName: "TestGadget",
        invocationId,
        parameters: { x: 1 },
        failedDependency: "dep-gadget-1",
        failedDependencyError: "Dependency failed with error",
      });

      expect(capturedContexts).toHaveLength(1);
      expect(capturedContexts[0].gadgetName).toBe("TestGadget");
      expect(capturedContexts[0].invocationId).toBe(invocationId);
      expect(capturedContexts[0].failedDependency).toBe("dep-gadget-1");
      expect(capturedContexts[0].failedDependencyError).toBe("Dependency failed with error");
      expect(capturedContexts[0].parameters).toEqual({ x: 1 });
    });

    it("should call parentObservers.onGadgetSkipped when defined", async () => {
      const logger = createMockLogger();
      const { tree, invocationId } = buildTreeWithGadget("g1");
      const capturedContexts: ObserveGadgetSkippedContext[] = [];

      const parentObservers: Observers = {
        onGadgetSkipped: (ctx) => capturedContexts.push(ctx),
      };

      await notifyGadgetSkipped({
        tree,
        hooks: undefined,
        parentObservers,
        logger,
        iteration: 3,
        gadgetName: "TestGadget",
        invocationId,
        parameters: {},
        failedDependency: "failed-dep",
        failedDependencyError: "error",
      });

      expect(capturedContexts).toHaveLength(1);
      expect(capturedContexts[0].iteration).toBe(3);
    });

    it("should call hooks before parentObservers (sequential await)", async () => {
      const logger = createMockLogger();
      const { tree, invocationId } = buildTreeWithGadget("g1");
      const order: string[] = [];

      const hooks: Observers = {
        onGadgetSkipped: async () => {
          await Promise.resolve();
          order.push("hooks");
        },
      };

      const parentObservers: Observers = {
        onGadgetSkipped: async () => {
          await Promise.resolve();
          order.push("parentObservers");
        },
      };

      await notifyGadgetSkipped({
        tree,
        hooks,
        parentObservers,
        logger,
        iteration: 1,
        gadgetName: "TestGadget",
        invocationId,
        parameters: {},
        failedDependency: "dep",
        failedDependencyError: "err",
      });

      expect(order).toEqual(["hooks", "parentObservers"]);
    });
  });

  describe("error isolation", () => {
    it("should not throw when observer throws", async () => {
      const logger = createMockLogger();
      const { tree, invocationId } = buildTreeWithGadget("g1");

      const hooks: Observers = {
        onGadgetSkipped: () => {
          throw new Error("boom");
        },
      };

      await expect(
        notifyGadgetSkipped({
          tree,
          hooks,
          parentObservers: undefined,
          logger,
          iteration: 1,
          gadgetName: "TestGadget",
          invocationId,
          parameters: {},
          failedDependency: "dep",
          failedDependencyError: "err",
        }),
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: notifyGadgetComplete
// ---------------------------------------------------------------------------

describe("notifyGadgetComplete", () => {
  describe("observer calling", () => {
    it("should call hooks.observers.onGadgetExecutionComplete with correct context", async () => {
      const logger = createMockLogger();
      const { tree, invocationId } = buildTreeWithGadget("g1");
      const capturedContexts: ObserveGadgetCompleteContext[] = [];

      const hooks: Observers = {
        onGadgetExecutionComplete: (ctx) => capturedContexts.push(ctx),
      };

      await notifyGadgetComplete({
        tree,
        hooks,
        parentObservers: undefined,
        logger,
        iteration: 1,
        gadgetName: "TestGadget",
        invocationId,
        parameters: { key: "val" },
        finalResult: "result-output",
        error: undefined,
        executionTimeMs: 42,
        cost: 0.001,
      });

      expect(capturedContexts).toHaveLength(1);
      expect(capturedContexts[0].gadgetName).toBe("TestGadget");
      expect(capturedContexts[0].invocationId).toBe(invocationId);
      expect(capturedContexts[0].finalResult).toBe("result-output");
      expect(capturedContexts[0].error).toBeUndefined();
      expect(capturedContexts[0].executionTimeMs).toBe(42);
      expect(capturedContexts[0].cost).toBe(0.001);
      expect(capturedContexts[0].parameters).toEqual({ key: "val" });
    });

    it("should pass error field when gadget failed", async () => {
      const logger = createMockLogger();
      const { tree, invocationId } = buildTreeWithGadget("g1");
      const capturedContexts: ObserveGadgetCompleteContext[] = [];

      const hooks: Observers = {
        onGadgetExecutionComplete: (ctx) => capturedContexts.push(ctx),
      };

      await notifyGadgetComplete({
        tree,
        hooks,
        parentObservers: undefined,
        logger,
        iteration: 1,
        gadgetName: "TestGadget",
        invocationId,
        parameters: {},
        finalResult: undefined,
        error: "Gadget execution failed",
        executionTimeMs: 15,
        cost: undefined,
      });

      expect(capturedContexts[0].error).toBe("Gadget execution failed");
      expect(capturedContexts[0].finalResult).toBeUndefined();
      expect(capturedContexts[0].cost).toBeUndefined();
    });

    it("should call parentObservers.onGadgetExecutionComplete when defined", async () => {
      const logger = createMockLogger();
      const { tree, invocationId } = buildTreeWithGadget("g1");
      const parentCalled: boolean[] = [];

      const parentObservers: Observers = {
        onGadgetExecutionComplete: () => {
          parentCalled.push(true);
        },
      };

      await notifyGadgetComplete({
        tree,
        hooks: undefined,
        parentObservers,
        logger,
        iteration: 1,
        gadgetName: "TestGadget",
        invocationId,
        parameters: {},
        finalResult: "ok",
        error: undefined,
        executionTimeMs: 10,
        cost: undefined,
      });

      expect(parentCalled).toEqual([true]);
    });

    it("should call hooks before parentObservers (sequential await)", async () => {
      const logger = createMockLogger();
      const { tree, invocationId } = buildTreeWithGadget("g1");
      const order: string[] = [];

      const hooks: Observers = {
        onGadgetExecutionComplete: async () => {
          await Promise.resolve();
          order.push("hooks");
        },
      };

      const parentObservers: Observers = {
        onGadgetExecutionComplete: async () => {
          await Promise.resolve();
          order.push("parentObservers");
        },
      };

      await notifyGadgetComplete({
        tree,
        hooks,
        parentObservers,
        logger,
        iteration: 1,
        gadgetName: "TestGadget",
        invocationId,
        parameters: {},
        finalResult: "ok",
        error: undefined,
        executionTimeMs: 10,
        cost: undefined,
      });

      expect(order).toEqual(["hooks", "parentObservers"]);
    });

    it("should do nothing when neither hooks nor parentObservers are defined", async () => {
      const logger = createMockLogger();
      const { tree, invocationId } = buildTreeWithGadget("g1");

      await expect(
        notifyGadgetComplete({
          tree,
          hooks: undefined,
          parentObservers: undefined,
          logger,
          iteration: 1,
          gadgetName: "TestGadget",
          invocationId,
          parameters: {},
          finalResult: "ok",
          error: undefined,
          executionTimeMs: 10,
          cost: undefined,
        }),
      ).resolves.toBeUndefined();

      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe("subagentContext resolution", () => {
    it("should pass undefined subagentContext when tree is undefined", async () => {
      const logger = createMockLogger();
      const capturedContexts: ObserveGadgetCompleteContext[] = [];

      const hooks: Observers = {
        onGadgetExecutionComplete: (ctx) => capturedContexts.push(ctx),
      };

      await notifyGadgetComplete({
        tree: undefined,
        hooks,
        parentObservers: undefined,
        logger,
        iteration: 1,
        gadgetName: "TestGadget",
        invocationId: "g1",
        parameters: {},
        finalResult: "ok",
        error: undefined,
        executionTimeMs: 10,
        cost: undefined,
      });

      expect(capturedContexts[0].subagentContext).toBeUndefined();
    });

    it("should include logger in observer context", async () => {
      const logger = createMockLogger();
      const { tree, invocationId } = buildTreeWithGadget("g1");
      const capturedContexts: ObserveGadgetCompleteContext[] = [];

      const hooks: Observers = {
        onGadgetExecutionComplete: (ctx) => capturedContexts.push(ctx),
      };

      await notifyGadgetComplete({
        tree,
        hooks,
        parentObservers: undefined,
        logger,
        iteration: 1,
        gadgetName: "TestGadget",
        invocationId,
        parameters: {},
        finalResult: "ok",
        error: undefined,
        executionTimeMs: 10,
        cost: undefined,
      });

      expect(capturedContexts[0].logger).toBe(logger);
    });
  });

  describe("error isolation", () => {
    it("should not throw when hooks observer throws", async () => {
      const logger = createMockLogger();
      const { tree, invocationId } = buildTreeWithGadget("g1");

      const hooks: Observers = {
        onGadgetExecutionComplete: () => {
          throw new Error("observer crash");
        },
      };

      await expect(
        notifyGadgetComplete({
          tree,
          hooks,
          parentObservers: undefined,
          logger,
          iteration: 1,
          gadgetName: "TestGadget",
          invocationId,
          parameters: {},
          finalResult: "ok",
          error: undefined,
          executionTimeMs: 10,
          cost: undefined,
        }),
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it("should still call parentObservers when hooks observer throws", async () => {
      const logger = createMockLogger();
      const { tree, invocationId } = buildTreeWithGadget("g1");
      const parentCalled: boolean[] = [];

      const hooks: Observers = {
        onGadgetExecutionComplete: () => {
          throw new Error("hooks crash");
        },
      };

      const parentObservers: Observers = {
        onGadgetExecutionComplete: () => {
          parentCalled.push(true);
        },
      };

      await notifyGadgetComplete({
        tree,
        hooks,
        parentObservers,
        logger,
        iteration: 1,
        gadgetName: "TestGadget",
        invocationId,
        parameters: {},
        finalResult: "ok",
        error: undefined,
        executionTimeMs: 10,
        cost: undefined,
      });

      expect(parentCalled).toEqual([true]);
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: notifyGadgetArgsPartial
// ---------------------------------------------------------------------------

describe("notifyGadgetArgsPartial", () => {
  describe("observer calling", () => {
    it("should call hooks.observers.onGadgetArgsPartial with the partial context", async () => {
      const logger = createMockLogger();
      const captured: ObserveGadgetArgsPartialContext[] = [];

      const hooks: Observers = {
        onGadgetArgsPartial: (ctx) => {
          captured.push(ctx);
        },
      };

      await notifyGadgetArgsPartial({
        tree: undefined,
        hooks,
        parentObservers: undefined,
        logger,
        iteration: 1,
        parentNodeId: null,
        event: makePartialEvent({
          fieldPath: "title",
          value: "Hello",
          delta: "lo",
          isFieldComplete: false,
        }),
      });

      expect(captured).toHaveLength(1);
      expect(captured[0]).toMatchObject({
        iteration: 1,
        invocationId: "gadget_1",
        gadgetName: "FillForm",
        fieldPath: "title",
        value: "Hello",
        delta: "lo",
        isFieldComplete: false,
      });
    });

    it("should call parentObservers.onGadgetArgsPartial when defined", async () => {
      const logger = createMockLogger();
      const captured: ObserveGadgetArgsPartialContext[] = [];

      const parentObservers: Observers = {
        onGadgetArgsPartial: (ctx) => {
          captured.push(ctx);
        },
      };

      await notifyGadgetArgsPartial({
        tree: undefined,
        hooks: undefined,
        parentObservers,
        logger,
        iteration: 4,
        parentNodeId: undefined,
        event: makePartialEvent(),
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].iteration).toBe(4);
    });

    it("should call hooks before parentObservers (sequential await)", async () => {
      const logger = createMockLogger();
      const order: string[] = [];

      const hooks: Observers = {
        onGadgetArgsPartial: async () => {
          await Promise.resolve();
          order.push("hooks");
        },
      };

      const parentObservers: Observers = {
        onGadgetArgsPartial: async () => {
          await Promise.resolve();
          order.push("parentObservers");
        },
      };

      await notifyGadgetArgsPartial({
        tree: undefined,
        hooks,
        parentObservers,
        logger,
        iteration: 1,
        parentNodeId: undefined,
        event: makePartialEvent(),
      });

      expect(order).toEqual(["hooks", "parentObservers"]);
    });

    it("should do nothing when neither hooks nor parentObservers are defined", async () => {
      const logger = createMockLogger();

      await expect(
        notifyGadgetArgsPartial({
          tree: undefined,
          hooks: undefined,
          parentObservers: undefined,
          logger,
          iteration: 1,
          parentNodeId: undefined,
          event: makePartialEvent(),
        }),
      ).resolves.toBeUndefined();

      expect(logger.error).not.toHaveBeenCalled();
    });

    it("should do nothing when observers objects have no onGadgetArgsPartial", async () => {
      const logger = createMockLogger();

      await notifyGadgetArgsPartial({
        tree: undefined,
        hooks: {},
        parentObservers: {},
        logger,
        iteration: 1,
        parentNodeId: undefined,
        event: makePartialEvent(),
      });

      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe("subagentContext resolution", () => {
    it("should pass undefined subagentContext when tree is undefined", async () => {
      const logger = createMockLogger();
      const captured: ObserveGadgetArgsPartialContext[] = [];

      const hooks: Observers = {
        onGadgetArgsPartial: (ctx) => captured.push(ctx),
      };

      await notifyGadgetArgsPartial({
        tree: undefined,
        hooks,
        parentObservers: undefined,
        logger,
        iteration: 1,
        parentNodeId: "some-node" as NodeId,
        event: makePartialEvent(),
      });

      expect(captured[0].subagentContext).toBeUndefined();
    });

    it("should pass undefined subagentContext for a root-level LLM parentNodeId", async () => {
      const logger = createMockLogger();
      const tree = new ExecutionTree();
      const rootLLM = tree.addLLMCall({ iteration: 1, model: "test-model" });
      const captured: ObserveGadgetArgsPartialContext[] = [];

      const hooks: Observers = {
        onGadgetArgsPartial: (ctx) => captured.push(ctx),
      };

      await notifyGadgetArgsPartial({
        tree,
        hooks,
        parentObservers: undefined,
        logger,
        iteration: 1,
        parentNodeId: rootLLM.id,
        event: makePartialEvent(),
      });

      // No parent gadget in the LLM node's ancestry → not a subagent.
      expect(captured[0].subagentContext).toBeUndefined();
    });

    it("should derive subagentContext from a nested subagent LLM parentNodeId", async () => {
      const logger = createMockLogger();
      const { tree, subagentLLMNodeId, spawnInvocationId } = buildTreeWithSubagentLLM();
      const captured: ObserveGadgetArgsPartialContext[] = [];

      const hooks: Observers = {
        onGadgetArgsPartial: (ctx) => captured.push(ctx),
      };

      await notifyGadgetArgsPartial({
        tree,
        hooks,
        parentObservers: undefined,
        logger,
        iteration: 1,
        parentNodeId: subagentLLMNodeId,
        event: makePartialEvent(),
      });

      expect(captured[0].subagentContext).toEqual({
        parentGadgetInvocationId: spawnInvocationId,
        depth: tree.getNode(subagentLLMNodeId)?.depth,
      });
    });

    it("should include logger in observer context", async () => {
      const logger = createMockLogger();
      const captured: ObserveGadgetArgsPartialContext[] = [];

      const hooks: Observers = {
        onGadgetArgsPartial: (ctx) => captured.push(ctx),
      };

      await notifyGadgetArgsPartial({
        tree: undefined,
        hooks,
        parentObservers: undefined,
        logger,
        iteration: 1,
        parentNodeId: undefined,
        event: makePartialEvent(),
      });

      expect(captured[0].logger).toBe(logger);
    });
  });

  describe("error isolation", () => {
    it("should not throw when hooks observer throws an error", async () => {
      const logger = createMockLogger();

      const hooks: Observers = {
        onGadgetArgsPartial: () => {
          throw new Error("observer error");
        },
      };

      await expect(
        notifyGadgetArgsPartial({
          tree: undefined,
          hooks,
          parentObservers: undefined,
          logger,
          iteration: 1,
          parentNodeId: undefined,
          event: makePartialEvent(),
        }),
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it("should still call parentObservers even if hooks observer throws", async () => {
      const logger = createMockLogger();
      const parentCalled: boolean[] = [];

      const hooks: Observers = {
        onGadgetArgsPartial: () => {
          throw new Error("hooks error");
        },
      };

      const parentObservers: Observers = {
        onGadgetArgsPartial: () => {
          parentCalled.push(true);
        },
      };

      await notifyGadgetArgsPartial({
        tree: undefined,
        hooks,
        parentObservers,
        logger,
        iteration: 1,
        parentNodeId: undefined,
        event: makePartialEvent(),
      });

      expect(parentCalled).toEqual([true]);
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });
});
