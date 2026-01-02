/**
 * Tests for tree-hook-bridge.ts
 *
 * The bridge handles:
 * - LLM call events for subagent visibility (fire-and-forget)
 *
 * NOTE: Gadget observer tests are NOT here because gadget observers are now
 * handled directly in stream-processor.ts with await for proper ordering.
 * The getSubagentContextForNode() function is tested indirectly through those tests.
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
      const subagentLLMCall = tree.addLLMCall({
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
      expect(llmStartContexts[0].subagentContext!.parentGadgetInvocationId).toBe("browse-web-1");
      expect(llmStartContexts[0].subagentContext!.depth).toBeGreaterThan(0);
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
      expect(llmCompleteContexts[0].subagentContext!.parentGadgetInvocationId).toBe("browse-web-1");
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
      expect(llmErrorContexts[0].subagentContext!.parentGadgetInvocationId).toBe("browse-web-1");
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
    expect(context!.parentGadgetInvocationId).toBe("parent-gadget");
    expect(context!.depth).toBeGreaterThan(0);
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
