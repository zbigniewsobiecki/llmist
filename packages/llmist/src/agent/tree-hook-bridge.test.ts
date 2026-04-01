/**
 * Tests for tree-hook-bridge.ts
 *
 * The bridge handles:
 * - LLM call events for subagent visibility (fire-and-forget)
 * - Gadget events for subagent visibility (fire-and-forget)
 *
 * NOTE: Root-level gadget observer hooks are handled directly in stream-processor.ts
 * with await for proper ordering. This bridge only handles SUBAGENT events
 * to avoid double-calling.
 */

import type { ILogObj, Logger } from "tslog";
import { describe, expect, it, vi } from "vitest";

import { ExecutionTree } from "../core/execution-tree.js";
import type { AgentHooks } from "./hooks.js";
import { bridgeTreeToHooks, getSubagentContextForNode } from "./tree-hook-bridge.js";

// Create a minimal mock logger
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

describe("bridgeTreeToHooks", () => {
  describe("LLM event bridging", () => {
    it("subagent LLM calls should trigger onLLMCallStart hook with subagentContext", async () => {
      const tree = new ExecutionTree();
      const logger = createMockLogger();

      const llmStartContexts: {
        iteration: number;
        model: string;
        subagentContext?: { parentGadgetInvocationId: string; depth: number };
      }[] = [];

      const hooks: AgentHooks = {
        observers: {
          onLLMCallStart: (ctx) => {
            llmStartContexts.push({
              iteration: ctx.iteration,
              model: ctx.options.model,
              subagentContext: ctx.subagentContext,
            });
          },
        },
      };

      bridgeTreeToHooks(tree, hooks, logger);

      // Root LLM call (should NOT trigger bridge - it's handled directly in agent.ts)
      const rootLLMCall = tree.addLLMCall({ iteration: 1, model: "root-model" });

      // Parent gadget that spawns subagent
      const parentGadgetNode = tree.addGadget({
        invocationId: "browse-web-1",
        name: "BrowseWeb",
        parameters: {},
        parentId: rootLLMCall.id,
      });
      tree.startGadget(parentGadgetNode.id);

      // Subagent LLM call (should trigger bridge with subagentContext)
      const _subagentLLMCall = tree.addLLMCall({
        iteration: 1,
        model: "subagent-model",
        parentId: parentGadgetNode.id,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Root LLM call should NOT be bridged (it has no subagentContext)
      // Subagent LLM call SHOULD be bridged with correct subagentContext
      expect(llmStartContexts.length).toBe(1);
      expect(llmStartContexts[0].model).toBe("subagent-model");
      expect(llmStartContexts[0].subagentContext).toBeDefined();
      expect(llmStartContexts[0].subagentContext?.parentGadgetInvocationId).toBe("browse-web-1");
      expect(llmStartContexts[0].subagentContext?.depth).toBeGreaterThan(0);
    });

    it("subagent LLM completion should trigger onLLMCallComplete hook", async () => {
      const tree = new ExecutionTree();
      const logger = createMockLogger();

      const llmCompleteContexts: {
        finishReason: string | null;
        subagentContext?: { parentGadgetInvocationId: string };
      }[] = [];

      const hooks: AgentHooks = {
        observers: {
          onLLMCallComplete: (ctx) => {
            llmCompleteContexts.push({
              finishReason: ctx.finishReason,
              subagentContext: ctx.subagentContext,
            });
          },
        },
      };

      bridgeTreeToHooks(tree, hooks, logger);

      // Setup tree structure
      const rootLLMCall = tree.addLLMCall({ iteration: 1, model: "root-model" });
      const parentGadgetNode = tree.addGadget({
        invocationId: "browse-web-1",
        name: "BrowseWeb",
        parameters: {},
        parentId: rootLLMCall.id,
      });
      tree.startGadget(parentGadgetNode.id);

      // Subagent LLM call
      const subagentLLMCall = tree.addLLMCall({
        iteration: 1,
        model: "subagent-model",
        parentId: parentGadgetNode.id,
      });

      // Complete the subagent LLM call
      tree.completeLLMCall(subagentLLMCall.id, {
        response: "Subagent response",
        finishReason: "stop",
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Subagent LLM completion should be bridged
      expect(llmCompleteContexts.length).toBe(1);
      expect(llmCompleteContexts[0].finishReason).toBe("stop");
      expect(llmCompleteContexts[0].subagentContext).toBeDefined();
      expect(llmCompleteContexts[0].subagentContext?.parentGadgetInvocationId).toBe("browse-web-1");
    });

    it("subagent LLM error should trigger onLLMCallError hook", async () => {
      const tree = new ExecutionTree();
      const logger = createMockLogger();

      const llmErrorContexts: {
        error: Error;
        subagentContext?: { parentGadgetInvocationId: string };
      }[] = [];

      const hooks: AgentHooks = {
        observers: {
          onLLMCallError: (ctx) => {
            llmErrorContexts.push({
              error: ctx.error,
              subagentContext: ctx.subagentContext,
            });
          },
        },
      };

      bridgeTreeToHooks(tree, hooks, logger);

      // Setup tree structure
      const rootLLMCall = tree.addLLMCall({ iteration: 1, model: "root-model" });
      const parentGadgetNode = tree.addGadget({
        invocationId: "browse-web-1",
        name: "BrowseWeb",
        parameters: {},
        parentId: rootLLMCall.id,
      });
      tree.startGadget(parentGadgetNode.id);

      // Subagent LLM call
      const subagentLLMCall = tree.addLLMCall({
        iteration: 1,
        model: "subagent-model",
        parentId: parentGadgetNode.id,
      });

      // Fail the subagent LLM call
      const testError = new Error("Test LLM error");
      tree.failLLMCall(subagentLLMCall.id, testError, false);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Subagent LLM error should be bridged
      expect(llmErrorContexts.length).toBe(1);
      expect(llmErrorContexts[0].error).toBe(testError);
      expect(llmErrorContexts[0].subagentContext).toBeDefined();
      expect(llmErrorContexts[0].subagentContext?.parentGadgetInvocationId).toBe("browse-web-1");
    });
  });

  describe("gadget event bridging", () => {
    it("subagent gadget start should trigger onGadgetExecutionStart hook with correct subagentContext", async () => {
      const tree = new ExecutionTree();
      const logger = createMockLogger();

      const capturedContexts: {
        gadgetName: string;
        invocationId: string;
        subagentContext?: { parentGadgetInvocationId: string; depth: number };
      }[] = [];

      const hooks: AgentHooks = {
        observers: {
          onGadgetExecutionStart: (ctx) => {
            capturedContexts.push({
              gadgetName: ctx.gadgetName,
              invocationId: ctx.invocationId,
              subagentContext: ctx.subagentContext,
            });
          },
        },
      };

      bridgeTreeToHooks(tree, hooks, logger);

      // Root-level structure: root LLM → parent gadget (spawns subagent)
      const rootLLMCall = tree.addLLMCall({ iteration: 1, model: "root-model" });
      const parentGadget = tree.addGadget({
        invocationId: "subagent-spawner-1",
        name: "SubagentSpawner",
        parameters: {},
        parentId: rootLLMCall.id,
      });
      tree.startGadget(parentGadget.id);

      // Root gadget start (should NOT be bridged - no subagentContext)
      // It fired a gadget_start event but depth/ancestry means no parent gadget → no bridge

      // Subagent level: subagent LLM → subagent gadget
      const subagentLLM = tree.addLLMCall({
        iteration: 1,
        model: "subagent-model",
        parentId: parentGadget.id,
      });
      const subagentGadget = tree.addGadget({
        invocationId: "subagent-inner-gadget-1",
        name: "InnerGadget",
        parameters: { query: "hello" },
        parentId: subagentLLM.id,
      });
      tree.startGadget(subagentGadget.id);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Root gadget start should NOT be bridged (it has no parent gadget in ancestry)
      // Only the subagent inner gadget start should be captured
      expect(capturedContexts.length).toBe(1);
      expect(capturedContexts[0].gadgetName).toBe("InnerGadget");
      expect(capturedContexts[0].invocationId).toBe("subagent-inner-gadget-1");
      expect(capturedContexts[0].subagentContext).toBeDefined();
      expect(capturedContexts[0].subagentContext?.parentGadgetInvocationId).toBe(
        "subagent-spawner-1",
      );
      expect(capturedContexts[0].subagentContext?.depth).toBeGreaterThan(0);
    });

    it("subagent gadget complete should trigger onGadgetExecutionComplete hook with results and timing", async () => {
      const tree = new ExecutionTree();
      const logger = createMockLogger();

      const capturedContexts: {
        gadgetName: string;
        invocationId: string;
        finalResult?: string;
        executionTimeMs: number;
        cost?: number;
        subagentContext?: { parentGadgetInvocationId: string; depth: number };
      }[] = [];

      const hooks: AgentHooks = {
        observers: {
          onGadgetExecutionComplete: (ctx) => {
            capturedContexts.push({
              gadgetName: ctx.gadgetName,
              invocationId: ctx.invocationId,
              finalResult: ctx.finalResult,
              executionTimeMs: ctx.executionTimeMs,
              cost: ctx.cost,
              subagentContext: ctx.subagentContext,
            });
          },
        },
      };

      bridgeTreeToHooks(tree, hooks, logger);

      // Build subagent tree structure
      const rootLLM = tree.addLLMCall({ iteration: 1, model: "root-model" });
      const parentGadget = tree.addGadget({
        invocationId: "subagent-spawner-1",
        name: "SubagentSpawner",
        parameters: {},
        parentId: rootLLM.id,
      });
      tree.startGadget(parentGadget.id);

      const subagentLLM = tree.addLLMCall({
        iteration: 1,
        model: "subagent-model",
        parentId: parentGadget.id,
      });
      const subagentGadget = tree.addGadget({
        invocationId: "subagent-inner-gadget-1",
        name: "InnerGadget",
        parameters: { query: "hello" },
        parentId: subagentLLM.id,
      });
      tree.startGadget(subagentGadget.id);

      // Complete the subagent gadget with result and timing
      tree.completeGadget(subagentGadget.id, {
        result: "The answer is 42",
        executionTimeMs: 150,
        cost: 0.001,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(capturedContexts.length).toBe(1);
      expect(capturedContexts[0].gadgetName).toBe("InnerGadget");
      expect(capturedContexts[0].invocationId).toBe("subagent-inner-gadget-1");
      expect(capturedContexts[0].finalResult).toBe("The answer is 42");
      expect(capturedContexts[0].executionTimeMs).toBe(150);
      expect(capturedContexts[0].cost).toBe(0.001);
      expect(capturedContexts[0].subagentContext).toBeDefined();
      expect(capturedContexts[0].subagentContext?.parentGadgetInvocationId).toBe(
        "subagent-spawner-1",
      );
    });

    it("subagent gadget error should trigger onGadgetExecutionComplete hook with error details", async () => {
      const tree = new ExecutionTree();
      const logger = createMockLogger();

      const capturedContexts: {
        gadgetName: string;
        invocationId: string;
        error?: string;
        finalResult?: string;
        executionTimeMs: number;
        subagentContext?: { parentGadgetInvocationId: string };
      }[] = [];

      const hooks: AgentHooks = {
        observers: {
          onGadgetExecutionComplete: (ctx) => {
            capturedContexts.push({
              gadgetName: ctx.gadgetName,
              invocationId: ctx.invocationId,
              error: ctx.error,
              finalResult: ctx.finalResult,
              executionTimeMs: ctx.executionTimeMs,
              subagentContext: ctx.subagentContext,
            });
          },
        },
      };

      bridgeTreeToHooks(tree, hooks, logger);

      // Build subagent tree structure
      const rootLLM = tree.addLLMCall({ iteration: 1, model: "root-model" });
      const parentGadget = tree.addGadget({
        invocationId: "subagent-spawner-1",
        name: "SubagentSpawner",
        parameters: {},
        parentId: rootLLM.id,
      });
      tree.startGadget(parentGadget.id);

      const subagentLLM = tree.addLLMCall({
        iteration: 1,
        model: "subagent-model",
        parentId: parentGadget.id,
      });
      const subagentGadget = tree.addGadget({
        invocationId: "failing-gadget-1",
        name: "FailingGadget",
        parameters: {},
        parentId: subagentLLM.id,
      });
      tree.startGadget(subagentGadget.id);

      // Fail the subagent gadget
      tree.completeGadget(subagentGadget.id, {
        error: "Connection refused",
        executionTimeMs: 50,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(capturedContexts.length).toBe(1);
      expect(capturedContexts[0].gadgetName).toBe("FailingGadget");
      expect(capturedContexts[0].invocationId).toBe("failing-gadget-1");
      expect(capturedContexts[0].error).toBe("Connection refused");
      expect(capturedContexts[0].finalResult).toBeUndefined();
      expect(capturedContexts[0].executionTimeMs).toBe(50);
      expect(capturedContexts[0].subagentContext).toBeDefined();
      expect(capturedContexts[0].subagentContext?.parentGadgetInvocationId).toBe(
        "subagent-spawner-1",
      );
    });

    it("subagent gadget skipped should trigger onGadgetSkipped hook", async () => {
      const tree = new ExecutionTree();
      const logger = createMockLogger();

      const capturedContexts: {
        gadgetName: string;
        invocationId: string;
        failedDependency: string;
        failedDependencyError: string;
        subagentContext?: { parentGadgetInvocationId: string };
      }[] = [];

      const hooks: AgentHooks = {
        observers: {
          onGadgetSkipped: (ctx) => {
            capturedContexts.push({
              gadgetName: ctx.gadgetName,
              invocationId: ctx.invocationId,
              failedDependency: ctx.failedDependency,
              failedDependencyError: ctx.failedDependencyError,
              subagentContext: ctx.subagentContext,
            });
          },
        },
      };

      bridgeTreeToHooks(tree, hooks, logger);

      // Build subagent tree structure
      const rootLLM = tree.addLLMCall({ iteration: 1, model: "root-model" });
      const parentGadget = tree.addGadget({
        invocationId: "subagent-spawner-1",
        name: "SubagentSpawner",
        parameters: {},
        parentId: rootLLM.id,
      });
      tree.startGadget(parentGadget.id);

      const subagentLLM = tree.addLLMCall({
        iteration: 1,
        model: "subagent-model",
        parentId: parentGadget.id,
      });

      // Add a dependent gadget and a gadget that depends on it
      const subagentGadget1 = tree.addGadget({
        invocationId: "dep-gadget-1",
        name: "DependencyGadget",
        parameters: {},
        parentId: subagentLLM.id,
      });
      tree.startGadget(subagentGadget1.id);
      tree.completeGadget(subagentGadget1.id, {
        error: "fetch failed",
        executionTimeMs: 10,
      });

      const subagentGadget2 = tree.addGadget({
        invocationId: "skipped-gadget-1",
        name: "SkippedGadget",
        parameters: {},
        dependencies: ["dep-gadget-1"],
        parentId: subagentLLM.id,
      });

      // Skip the second gadget due to the failed dependency
      tree.skipGadget(subagentGadget2.id, "dep-gadget-1", "fetch failed", "dependency_failed");

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(capturedContexts.length).toBe(1);
      expect(capturedContexts[0].gadgetName).toBe("SkippedGadget");
      expect(capturedContexts[0].invocationId).toBe("skipped-gadget-1");
      expect(capturedContexts[0].failedDependency).toBe("dep-gadget-1");
      expect(capturedContexts[0].failedDependencyError).toBe("fetch failed");
      expect(capturedContexts[0].subagentContext).toBeDefined();
      expect(capturedContexts[0].subagentContext?.parentGadgetInvocationId).toBe(
        "subagent-spawner-1",
      );
    });

    it("gadget event ordering: start completes before complete via chainObserverCall", async () => {
      const tree = new ExecutionTree();
      const logger = createMockLogger();

      const eventOrder: string[] = [];
      let startResolve: (() => void) | undefined;

      // Use a delayed start observer to test ordering
      const hooks: AgentHooks = {
        observers: {
          onGadgetExecutionStart: async (_ctx) => {
            // Simulate slow start observer
            await new Promise<void>((resolve) => {
              startResolve = resolve;
            });
            eventOrder.push("start");
          },
          onGadgetExecutionComplete: (_ctx) => {
            eventOrder.push("complete");
          },
        },
      };

      bridgeTreeToHooks(tree, hooks, logger);

      // Build subagent tree structure
      const rootLLM = tree.addLLMCall({ iteration: 1, model: "root-model" });
      const parentGadget = tree.addGadget({
        invocationId: "subagent-spawner-1",
        name: "SubagentSpawner",
        parameters: {},
        parentId: rootLLM.id,
      });
      tree.startGadget(parentGadget.id);

      const subagentLLM = tree.addLLMCall({
        iteration: 1,
        model: "subagent-model",
        parentId: parentGadget.id,
      });
      const subagentGadget = tree.addGadget({
        invocationId: "ordered-gadget-1",
        name: "OrderedGadget",
        parameters: {},
        parentId: subagentLLM.id,
      });
      tree.startGadget(subagentGadget.id);

      // Complete the gadget immediately after start
      tree.completeGadget(subagentGadget.id, {
        result: "done",
        executionTimeMs: 10,
      });

      // Give time for events to propagate but not resolve the slow start
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Complete should not have fired yet (waiting on start chain)
      expect(eventOrder).toEqual([]);

      // Resolve the slow start observer
      startResolve?.();
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Now both should have fired in order: start → complete
      expect(eventOrder).toEqual(["start", "complete"]);
    });

    it("root-level gadget events should NOT be bridged (only subagent events are bridged)", async () => {
      const tree = new ExecutionTree();
      const logger = createMockLogger();

      const capturedStartContexts: { gadgetName: string }[] = [];
      const capturedCompleteContexts: { gadgetName: string }[] = [];
      const capturedSkippedContexts: { gadgetName: string }[] = [];

      const hooks: AgentHooks = {
        observers: {
          onGadgetExecutionStart: (ctx) => {
            capturedStartContexts.push({ gadgetName: ctx.gadgetName });
          },
          onGadgetExecutionComplete: (ctx) => {
            capturedCompleteContexts.push({ gadgetName: ctx.gadgetName });
          },
          onGadgetSkipped: (ctx) => {
            capturedSkippedContexts.push({ gadgetName: ctx.gadgetName });
          },
        },
      };

      bridgeTreeToHooks(tree, hooks, logger);

      // Root-level LLM call and gadgets (depth 0 / 1 — no parent gadget in ancestry)
      const rootLLM = tree.addLLMCall({ iteration: 1, model: "root-model" });

      // Root gadget 1: starts and completes
      const rootGadget1 = tree.addGadget({
        invocationId: "root-gadget-1",
        name: "RootGadget1",
        parameters: {},
        parentId: rootLLM.id,
      });
      tree.startGadget(rootGadget1.id);
      tree.completeGadget(rootGadget1.id, { result: "ok", executionTimeMs: 5 });

      // Root gadget 2: starts and errors
      const rootGadget2 = tree.addGadget({
        invocationId: "root-gadget-2",
        name: "RootGadget2",
        parameters: {},
        parentId: rootLLM.id,
      });
      tree.startGadget(rootGadget2.id);
      tree.completeGadget(rootGadget2.id, { error: "some error", executionTimeMs: 5 });

      // Root gadget 3: gets skipped
      const rootGadget3 = tree.addGadget({
        invocationId: "root-gadget-3",
        name: "RootGadget3",
        parameters: {},
        dependencies: ["root-gadget-2"],
        parentId: rootLLM.id,
      });
      tree.skipGadget(rootGadget3.id, "root-gadget-2", "some error", "dependency_failed");

      await new Promise((resolve) => setTimeout(resolve, 10));

      // None of the root-level gadget events should be bridged
      expect(capturedStartContexts).toEqual([]);
      expect(capturedCompleteContexts).toEqual([]);
      expect(capturedSkippedContexts).toEqual([]);
    });
  });

  it("unsubscribe should stop LLM hook calls", async () => {
    const tree = new ExecutionTree();
    const logger = createMockLogger();
    let callCount = 0;

    const hooks: AgentHooks = {
      observers: {
        onLLMCallStart: () => {
          callCount++;
        },
      },
    };

    const unsubscribe = bridgeTreeToHooks(tree, hooks, logger);

    // Setup for subagent LLM calls
    const rootLLM1 = tree.addLLMCall({ iteration: 1, model: "root" });
    const gadget1 = tree.addGadget({
      invocationId: "g1",
      name: "Gadget1",
      parameters: {},
      parentId: rootLLM1.id,
    });
    tree.startGadget(gadget1.id);

    // First subagent LLM should trigger hook
    tree.addLLMCall({ iteration: 1, model: "subagent1", parentId: gadget1.id });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(callCount).toBe(1);

    // Unsubscribe
    unsubscribe();

    // Second subagent LLM should NOT trigger hook
    tree.addLLMCall({ iteration: 2, model: "subagent2", parentId: gadget1.id });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(callCount).toBe(1); // Still 1, not 2
  });
});

describe("getSubagentContextForNode", () => {
  it("returns undefined for root agent nodes", () => {
    const tree = new ExecutionTree();

    // Root LLM call
    const rootLLM = tree.addLLMCall({ iteration: 1, model: "root" });

    // Root gadget (under root LLM)
    const gadgetNode = tree.addGadget({
      invocationId: "root-gadget",
      name: "RootGadget",
      parameters: {},
      parentId: rootLLM.id,
    });

    // Root gadget should NOT have subagentContext
    const context = getSubagentContextForNode(tree, gadgetNode.id);
    expect(context).toBeUndefined();
  });

  it("returns subagentContext for subagent nodes", () => {
    const tree = new ExecutionTree();

    // Root LLM call
    const rootLLM = tree.addLLMCall({ iteration: 1, model: "root" });

    // Parent gadget (spawns subagent)
    const parentGadget = tree.addGadget({
      invocationId: "parent-gadget",
      name: "SubagentGadget",
      parameters: {},
      parentId: rootLLM.id,
    });

    // Subagent LLM call
    const subagentLLM = tree.addLLMCall({
      iteration: 1,
      model: "subagent",
      parentId: parentGadget.id,
    });

    // Subagent gadget
    const subagentGadget = tree.addGadget({
      invocationId: "subagent-gadget",
      name: "InnerGadget",
      parameters: {},
      parentId: subagentLLM.id,
    });

    // Subagent gadget SHOULD have subagentContext
    const context = getSubagentContextForNode(tree, subagentGadget.id);
    expect(context).toBeDefined();
    expect(context?.parentGadgetInvocationId).toBe("parent-gadget");
    expect(context?.depth).toBeGreaterThan(0);
  });

  it("finds correct parent gadget for deeply nested nodes", () => {
    const tree = new ExecutionTree();

    // Level 0: Root LLM
    const rootLLM = tree.addLLMCall({ iteration: 1, model: "root" });

    // Level 1: First gadget
    const level1Gadget = tree.addGadget({
      invocationId: "level-1-gadget",
      name: "Level1",
      parameters: {},
      parentId: rootLLM.id,
    });

    // Level 1 subagent LLM
    const subagent1LLM = tree.addLLMCall({
      iteration: 1,
      model: "subagent1",
      parentId: level1Gadget.id,
    });

    // Level 2: Second gadget
    const level2Gadget = tree.addGadget({
      invocationId: "level-2-gadget",
      name: "Level2",
      parameters: {},
      parentId: subagent1LLM.id,
    });

    // Level 2 subagent LLM
    const subagent2LLM = tree.addLLMCall({
      iteration: 1,
      model: "subagent2",
      parentId: level2Gadget.id,
    });

    // Level 3: Third gadget
    const level3Gadget = tree.addGadget({
      invocationId: "level-3-gadget",
      name: "Level3",
      parameters: {},
      parentId: subagent2LLM.id,
    });

    // Level 1 gadget: no subagentContext (root agent)
    const context1 = getSubagentContextForNode(tree, level1Gadget.id);
    expect(context1).toBeUndefined();

    // Level 2 gadget: parent is level-1-gadget
    const context2 = getSubagentContextForNode(tree, level2Gadget.id);
    expect(context2?.parentGadgetInvocationId).toBe("level-1-gadget");

    // Level 3 gadget: parent is level-2-gadget
    const context3 = getSubagentContextForNode(tree, level3Gadget.id);
    expect(context3?.parentGadgetInvocationId).toBe("level-2-gadget");
  });
});
