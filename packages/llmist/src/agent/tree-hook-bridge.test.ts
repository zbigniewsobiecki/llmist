/**
 * Tests for tree-hook-bridge.ts
 *
 * Verifies that SubagentContext is correctly derived:
 * - Root agent gadgets: subagentContext is undefined
 * - Subagent gadgets: subagentContext has parentGadgetInvocationId and depth
 */
import { describe, expect, it, mock } from "bun:test";
import type { ILogObj, Logger } from "tslog";

import { ExecutionTree } from "../core/execution-tree.js";
import type { AgentHooks, ObserveGadgetCompleteContext, ObserveGadgetStartContext } from "./hooks.js";
import { bridgeTreeToHooks } from "./tree-hook-bridge.js";

// Create a minimal mock logger
function createMockLogger(): Logger<ILogObj> {
  return {
    warn: mock(() => {}),
    debug: mock(() => {}),
    info: mock(() => {}),
    error: mock(() => {}),
    trace: mock(() => {}),
    fatal: mock(() => {}),
    silly: mock(() => {}),
  } as unknown as Logger<ILogObj>;
}

describe("bridgeTreeToHooks", () => {
  describe("SubagentContext derivation", () => {
    it("root agent gadgets should NOT have subagentContext", async () => {
      const tree = new ExecutionTree();
      const logger = createMockLogger();

      const startContexts: ObserveGadgetStartContext[] = [];
      const completeContexts: ObserveGadgetCompleteContext[] = [];

      const hooks: AgentHooks = {
        observers: {
          onGadgetExecutionStart: (ctx) => {
            startContexts.push(ctx);
          },
          onGadgetExecutionComplete: (ctx) => {
            completeContexts.push(ctx);
          },
        },
      };

      // Subscribe to tree events
      bridgeTreeToHooks(tree, hooks, logger);

      // Simulate root agent: LLM call at depth 0, gadget at depth 1
      const llmCall = tree.addLLMCall({ iteration: 1 });
      const gadgetNode = tree.addGadget({
        invocationId: "root-gadget-1",
        name: "RootGadget",
        parameters: { foo: "bar" },
        parentId: llmCall.id,
      });
      tree.startGadget(gadgetNode.id);
      tree.completeGadget(gadgetNode.id, { result: "result", executionTimeMs: 100 });
      tree.completeLLMCall(llmCall.id, {});

      // Wait for async observers
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Root gadget should NOT have subagentContext
      expect(startContexts.length).toBe(1);
      expect(startContexts[0].gadgetName).toBe("RootGadget");
      expect(startContexts[0].subagentContext).toBeUndefined();

      expect(completeContexts.length).toBe(1);
      expect(completeContexts[0].gadgetName).toBe("RootGadget");
      expect(completeContexts[0].subagentContext).toBeUndefined();
    });

    it("subagent gadgets should have subagentContext with parentGadgetInvocationId", async () => {
      const tree = new ExecutionTree();
      const logger = createMockLogger();

      const startContexts: ObserveGadgetStartContext[] = [];
      const completeContexts: ObserveGadgetCompleteContext[] = [];

      const hooks: AgentHooks = {
        observers: {
          onGadgetExecutionStart: (ctx) => {
            startContexts.push(ctx);
          },
          onGadgetExecutionComplete: (ctx) => {
            completeContexts.push(ctx);
          },
        },
      };

      bridgeTreeToHooks(tree, hooks, logger);

      // Simulate:
      // 1. Root LLM call (depth 0)
      // 2. Parent gadget that spawns subagent (depth 1)
      // 3. Subagent LLM call (depth 2)
      // 4. Subagent gadget (depth 3) - this should have subagentContext

      const rootLLMCall = tree.addLLMCall({ iteration: 1 });
      const parentGadgetNode = tree.addGadget({
        invocationId: "parent-gadget",
        name: "SubagentGadget",
        parameters: {},
        parentId: rootLLMCall.id,
      });
      tree.startGadget(parentGadgetNode.id);

      // Subagent starts: new LLM call as child of parent gadget
      const subagentLLMCall = tree.addLLMCall({ iteration: 1, parentId: parentGadgetNode.id });

      // Subagent runs its own gadget (explicitly under the subagent LLM call)
      const subagentGadgetNode = tree.addGadget({
        invocationId: "subagent-gadget",
        name: "InnerGadget",
        parameters: { inner: true },
        parentId: subagentLLMCall.id,
      });
      tree.startGadget(subagentGadgetNode.id);
      tree.completeGadget(subagentGadgetNode.id, { result: "inner result", executionTimeMs: 50 });

      tree.completeLLMCall(subagentLLMCall.id, {});
      tree.completeGadget(parentGadgetNode.id, { result: "parent result", executionTimeMs: 200 });
      tree.completeLLMCall(rootLLMCall.id, {});

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Find the subagent gadget's contexts
      const subagentGadgetStart = startContexts.find((c) => c.gadgetName === "InnerGadget");
      const subagentGadgetComplete = completeContexts.find((c) => c.gadgetName === "InnerGadget");

      // Subagent gadget SHOULD have subagentContext
      expect(subagentGadgetStart).toBeDefined();
      expect(subagentGadgetStart!.subagentContext).toBeDefined();
      expect(subagentGadgetStart!.subagentContext!.parentGadgetInvocationId).toBe("parent-gadget");
      expect(subagentGadgetStart!.subagentContext!.depth).toBeGreaterThan(0);

      expect(subagentGadgetComplete).toBeDefined();
      expect(subagentGadgetComplete!.subagentContext).toBeDefined();
      expect(subagentGadgetComplete!.subagentContext!.parentGadgetInvocationId).toBe("parent-gadget");

      // Parent gadget should NOT have subagentContext (it's in root agent)
      const parentGadgetStart = startContexts.find((c) => c.gadgetName === "SubagentGadget");
      expect(parentGadgetStart).toBeDefined();
      expect(parentGadgetStart!.subagentContext).toBeUndefined();
    });

    it("deeply nested subagent gadgets should have correct parentGadgetInvocationId", async () => {
      const tree = new ExecutionTree();
      const logger = createMockLogger();

      const contexts: ObserveGadgetStartContext[] = [];

      const hooks: AgentHooks = {
        observers: {
          onGadgetExecutionStart: (ctx) => {
            contexts.push(ctx);
          },
        },
      };

      bridgeTreeToHooks(tree, hooks, logger);

      // Level 0: Root agent LLM call
      const rootLLM = tree.addLLMCall({ iteration: 1 });

      // Level 1 gadget: under root LLM
      const level1GadgetNode = tree.addGadget({
        invocationId: "level-1-gadget",
        name: "Level1Gadget",
        parameters: {},
        parentId: rootLLM.id,
      });
      tree.startGadget(level1GadgetNode.id);

      // Level 1 subagent LLM: under level 1 gadget
      const subagent1LLM = tree.addLLMCall({ iteration: 1, parentId: level1GadgetNode.id });

      // Level 2 gadget: under subagent1 LLM
      const level2GadgetNode = tree.addGadget({
        invocationId: "level-2-gadget",
        name: "Level2Gadget",
        parameters: {},
        parentId: subagent1LLM.id,
      });
      tree.startGadget(level2GadgetNode.id);

      // Level 2 subagent LLM: under level 2 gadget
      const subagent2LLM = tree.addLLMCall({ iteration: 1, parentId: level2GadgetNode.id });

      // Level 3 gadget: under subagent2 LLM
      const level3GadgetNode = tree.addGadget({
        invocationId: "level-3-gadget",
        name: "Level3Gadget",
        parameters: {},
        parentId: subagent2LLM.id,
      });
      tree.startGadget(level3GadgetNode.id);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Level 1 gadget: no subagentContext (in root)
      const level1 = contexts.find((c) => c.gadgetName === "Level1Gadget");
      expect(level1?.subagentContext).toBeUndefined();

      // Level 2 gadget: parent is level-1-gadget
      const level2 = contexts.find((c) => c.gadgetName === "Level2Gadget");
      expect(level2?.subagentContext?.parentGadgetInvocationId).toBe("level-1-gadget");

      // Level 3 gadget: parent is level-2-gadget
      const level3 = contexts.find((c) => c.gadgetName === "Level3Gadget");
      expect(level3?.subagentContext?.parentGadgetInvocationId).toBe("level-2-gadget");
    });
  });

  it("unsubscribe should stop hook calls", async () => {
    const tree = new ExecutionTree();
    const logger = createMockLogger();
    let callCount = 0;

    const hooks: AgentHooks = {
      observers: {
        onGadgetExecutionStart: () => {
          callCount++;
        },
      },
    };

    const unsubscribe = bridgeTreeToHooks(tree, hooks, logger);

    // First gadget should trigger hook
    const llm1 = tree.addLLMCall({ iteration: 1 });
    const g1 = tree.addGadget({ invocationId: "g1", name: "Gadget1", parameters: {}, parentId: llm1.id });
    tree.startGadget(g1.id);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(callCount).toBe(1);

    // Unsubscribe
    unsubscribe();

    // Second gadget should NOT trigger hook
    const g2 = tree.addGadget({ invocationId: "g2", name: "Gadget2", parameters: {}, parentId: llm1.id });
    tree.startGadget(g2.id);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(callCount).toBe(1); // Still 1, not 2
  });

  describe("LLM event bridging", () => {
    it("subagent LLM calls should trigger onLLMCallStart hook with subagentContext", async () => {
      const tree = new ExecutionTree();
      const logger = createMockLogger();

      const llmStartContexts: { iteration: number; model: string; subagentContext?: { parentGadgetInvocationId: string; depth: number } }[] = [];

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

      const llmCompleteContexts: { finishReason: string | null; subagentContext?: { parentGadgetInvocationId: string } }[] = [];

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
  });
});
