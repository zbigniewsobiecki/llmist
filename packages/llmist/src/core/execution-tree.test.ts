/**
 * Tests for ExecutionTree - the first-class model for nested subagent support.
 */

import { beforeEach, describe, expect, test } from "vitest";
import type { ExecutionEvent } from "./execution-events.js";
import { ExecutionTree } from "./execution-tree.js";

describe("ExecutionTree", () => {
  let tree: ExecutionTree;

  beforeEach(() => {
    tree = new ExecutionTree();
  });

  describe("LLM Call Management", () => {
    test("addLLMCall creates node with correct properties", () => {
      const node = tree.addLLMCall({
        iteration: 1,
        model: "sonnet",
      });

      expect(node).toBeDefined();
      expect(node.type).toBe("llm_call");
      expect(node.iteration).toBe(1);
      expect(node.model).toBe("sonnet");
      expect(node.depth).toBe(0);
      expect(node.parentId).toBeNull();
      expect(node.path).toEqual([node.id]);
      expect(node.completedAt).toBeNull();
    });

    test("addLLMCall with parentId sets correct depth and path", () => {
      // Create parent gadget first (need an LLM call first for proper hierarchy)
      const llmNode = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      const gadgetNode = tree.addGadget({
        invocationId: "gc_1",
        name: "BrowseWeb",
        parameters: {},
        dependencies: [],
        parentId: llmNode.id,
      });

      // Create child LLM call (subagent)
      const childLlm = tree.addLLMCall({
        iteration: 1,
        model: "haiku",
        parentId: gadgetNode.id,
      });

      expect(childLlm.depth).toBe(2);
      expect(childLlm.parentId).toBe(gadgetNode.id);
      expect(childLlm.path).toEqual([llmNode.id, gadgetNode.id, childLlm.id]);
    });

    test("completeLLMCall updates node with response details", () => {
      const node = tree.addLLMCall({ iteration: 1, model: "sonnet" });

      tree.completeLLMCall(node.id, {
        response: "Hello, world!",
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        finishReason: "stop",
        cost: 0.001,
      });

      const updatedNode = tree.getNode(node.id);
      expect(updatedNode?.type === "llm_call" && updatedNode.response).toBe("Hello, world!");
      expect(updatedNode?.type === "llm_call" && updatedNode.usage?.inputTokens).toBe(100);
      expect(updatedNode?.type === "llm_call" && updatedNode.finishReason).toBe("stop");
      expect(updatedNode?.type === "llm_call" && updatedNode.cost).toBe(0.001);
      expect(updatedNode?.completedAt).not.toBeNull();
    });

    test("failLLMCall marks node as failed", () => {
      const node = tree.addLLMCall({ iteration: 1, model: "sonnet" });

      tree.failLLMCall(node.id, new Error("API error"), false);

      const updatedNode = tree.getNode(node.id);
      // failLLMCall emits an error event but doesn't store the error on the node
      // It just marks completedAt
      expect(updatedNode?.completedAt).not.toBeNull();
    });

    test("appendLLMResponse accumulates streaming text", () => {
      const node = tree.addLLMCall({ iteration: 1, model: "sonnet" });

      tree.appendLLMResponse(node.id, "Hello, ");
      tree.appendLLMResponse(node.id, "world!");

      const updatedNode = tree.getNode(node.id);
      expect(updatedNode?.type === "llm_call" && updatedNode.response).toBe("Hello, world!");
    });
  });

  describe("Gadget Management", () => {
    test("addGadget creates node with correct properties", () => {
      const node = tree.addGadget({
        invocationId: "gc_123",
        name: "Calculator",
        parameters: { a: 5, b: 3 },
        dependencies: [],
      });

      expect(node).toBeDefined();
      expect(node.type).toBe("gadget");
      expect(node.invocationId).toBe("gc_123");
      expect(node.name).toBe("Calculator");
      expect(node.parameters).toEqual({ a: 5, b: 3 });
      expect(node.state).toBe("pending");
      expect(node.depth).toBe(0);
    });

    test("addGadget with parent LLM call sets correct hierarchy", () => {
      const llmNode = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      const gadgetNode = tree.addGadget({
        invocationId: "gc_1",
        name: "Search",
        parameters: { query: "test" },
        dependencies: [],
        parentId: llmNode.id,
      });

      expect(gadgetNode.parentId).toBe(llmNode.id);
      expect(gadgetNode.depth).toBe(1);
      expect(gadgetNode.path).toEqual([llmNode.id, gadgetNode.id]);

      // Check that gadget is in LLM's children
      const updatedLlmNode = tree.getNode(llmNode.id);
      expect(updatedLlmNode?.type === "llm_call" && updatedLlmNode.children).toContain(
        gadgetNode.id,
      );
    });

    test("startGadget transitions state to running", () => {
      const node = tree.addGadget({
        invocationId: "gc_1",
        name: "Fetch",
        parameters: {},
        dependencies: [],
      });

      tree.startGadget(node.id);

      const updatedNode = tree.getNode(node.id);
      expect(updatedNode?.type === "gadget" && updatedNode.state).toBe("running");
    });

    test("completeGadget sets result and marks completed", () => {
      const node = tree.addGadget({
        invocationId: "gc_1",
        name: "Calculator",
        parameters: {},
        dependencies: [],
      });

      tree.startGadget(node.id);
      tree.completeGadget(node.id, {
        result: "8",
        executionTimeMs: 150,
        cost: 0.0001,
      });

      const updatedNode = tree.getNode(node.id);
      expect(updatedNode?.type === "gadget" && updatedNode.state).toBe("completed");
      expect(updatedNode?.type === "gadget" && updatedNode.result).toBe("8");
      expect(updatedNode?.type === "gadget" && updatedNode.executionTimeMs).toBe(150);
      expect(updatedNode?.type === "gadget" && updatedNode.cost).toBe(0.0001);
      expect(updatedNode?.completedAt).not.toBeNull();
    });

    test("completeGadget with media stores media outputs", () => {
      const node = tree.addGadget({
        invocationId: "gc_1",
        name: "Screenshot",
        parameters: {},
        dependencies: [],
      });

      const media = [
        {
          kind: "image" as const,
          data: "base64...",
          mimeType: "image/png",
          description: "Screenshot",
        },
      ];

      tree.startGadget(node.id);
      tree.completeGadget(node.id, {
        result: "Screenshot taken",
        executionTimeMs: 500,
        media,
      });

      const updatedNode = tree.getNode(node.id);
      expect(updatedNode?.type === "gadget" && updatedNode.media).toEqual(media);
    });

    test("completeGadget with error sets error and marks failed", () => {
      const node = tree.addGadget({
        invocationId: "gc_1",
        name: "Fetch",
        parameters: {},
        dependencies: [],
      });

      tree.startGadget(node.id);
      tree.completeGadget(node.id, {
        error: "Network timeout",
        executionTimeMs: 5000,
      });

      const updatedNode = tree.getNode(node.id);
      expect(updatedNode?.type === "gadget" && updatedNode.state).toBe("failed");
      expect(updatedNode?.type === "gadget" && updatedNode.error).toBe("Network timeout");
      expect(updatedNode?.completedAt).not.toBeNull();
    });

    test("skipGadget marks as skipped with dependency info", () => {
      tree.addGadget({
        invocationId: "dep_1",
        name: "FirstGadget",
        parameters: {},
        dependencies: [],
      });

      const node = tree.addGadget({
        invocationId: "gc_2",
        name: "DependentGadget",
        parameters: {},
        dependencies: ["dep_1"],
      });

      tree.skipGadget(node.id, "dep_1", "Dependency failed", "dependency_failed");

      const updatedNode = tree.getNode(node.id);
      expect(updatedNode?.type === "gadget" && updatedNode.state).toBe("skipped");
      expect(updatedNode?.type === "gadget" && updatedNode.failedDependency).toBe("dep_1");
    });
  });

  describe("Tree Queries", () => {
    test("getNodeCount returns counts of nodes by type", () => {
      tree.addLLMCall({ iteration: 1, model: "sonnet" });
      tree.addGadget({ invocationId: "gc_1", name: "A", parameters: {}, dependencies: [] });
      tree.addGadget({ invocationId: "gc_2", name: "B", parameters: {}, dependencies: [] });

      const counts = tree.getNodeCount();
      expect(counts.llmCalls).toBe(1);
      expect(counts.gadgets).toBe(2);
    });

    test("getChildren returns direct children", () => {
      const llmNode = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      const gadget1 = tree.addGadget({
        invocationId: "gc_1",
        name: "A",
        parameters: {},
        dependencies: [],
        parentId: llmNode.id,
      });
      const gadget2 = tree.addGadget({
        invocationId: "gc_2",
        name: "B",
        parameters: {},
        dependencies: [],
        parentId: llmNode.id,
      });

      const children = tree.getChildren(llmNode.id);
      expect(children.length).toBe(2);
      expect(children.map((n) => n.id)).toContain(gadget1.id);
      expect(children.map((n) => n.id)).toContain(gadget2.id);
    });

    test("getAncestors returns all ancestors from root to parent", () => {
      const llm1 = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      const gadget1 = tree.addGadget({
        invocationId: "gc_1",
        name: "BrowseWeb",
        parameters: {},
        dependencies: [],
        parentId: llm1.id,
      });
      const llm2 = tree.addLLMCall({ iteration: 1, model: "haiku", parentId: gadget1.id });
      const gadget2 = tree.addGadget({
        invocationId: "gc_2",
        name: "Click",
        parameters: {},
        dependencies: [],
        parentId: llm2.id,
      });

      const ancestors = tree.getAncestors(gadget2.id);
      expect(ancestors.length).toBe(3);
      // getAncestors returns from root to parent (genealogical order)
      expect(ancestors[0].id).toBe(llm1.id); // Root first
      expect(ancestors[1].id).toBe(gadget1.id);
      expect(ancestors[2].id).toBe(llm2.id); // Immediate parent last
    });

    test("getDescendants returns all descendants", () => {
      const llm1 = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      const gadget1 = tree.addGadget({
        invocationId: "gc_1",
        name: "BrowseWeb",
        parameters: {},
        dependencies: [],
        parentId: llm1.id,
      });
      const llm2 = tree.addLLMCall({ iteration: 1, model: "haiku", parentId: gadget1.id });
      const gadget2 = tree.addGadget({
        invocationId: "gc_2",
        name: "Click",
        parameters: {},
        dependencies: [],
        parentId: llm2.id,
      });

      const descendants = tree.getDescendants(llm1.id);
      expect(descendants.length).toBe(3);
      expect(descendants.map((n) => n.id)).toContain(gadget1.id);
      expect(descendants.map((n) => n.id)).toContain(llm2.id);
      expect(descendants.map((n) => n.id)).toContain(gadget2.id);
    });

    test("getDescendants with type filter", () => {
      const llm1 = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      const gadget1 = tree.addGadget({
        invocationId: "gc_1",
        name: "BrowseWeb",
        parameters: {},
        dependencies: [],
        parentId: llm1.id,
      });
      tree.addLLMCall({ iteration: 1, model: "haiku", parentId: gadget1.id });

      const gadgetDescendants = tree.getDescendants(llm1.id, "gadget");
      expect(gadgetDescendants.length).toBe(1);
      expect(gadgetDescendants[0].type).toBe("gadget");
    });

    test("getRoots returns only root nodes", () => {
      const llm1 = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      tree.addGadget({
        invocationId: "gc_1",
        name: "BrowseWeb",
        parameters: {},
        dependencies: [],
        parentId: llm1.id,
      });
      const llm2 = tree.addLLMCall({ iteration: 2, model: "sonnet" }); // Another root

      const roots = tree.getRoots();
      expect(roots.length).toBe(2);
      expect(roots.map((n) => n.id)).toContain(llm1.id);
      expect(roots.map((n) => n.id)).toContain(llm2.id);
    });
  });

  describe("Subtree Aggregation", () => {
    test("getSubtreeCost aggregates costs from all descendants", () => {
      const llm1 = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      tree.completeLLMCall(llm1.id, { response: "ok", cost: 0.01 });

      const gadget1 = tree.addGadget({
        invocationId: "gc_1",
        name: "BrowseWeb",
        parameters: {},
        dependencies: [],
        parentId: llm1.id,
      });

      // Subagent LLM call inside BrowseWeb
      const subLlm = tree.addLLMCall({ iteration: 1, model: "haiku", parentId: gadget1.id });
      tree.completeLLMCall(subLlm.id, { response: "ok", cost: 0.002 });

      // Subagent gadget
      const subGadget = tree.addGadget({
        invocationId: "gc_sub",
        name: "Click",
        parameters: {},
        dependencies: [],
        parentId: subLlm.id,
      });
      tree.startGadget(subGadget.id);
      tree.completeGadget(subGadget.id, { result: "done", executionTimeMs: 100, cost: 0.0001 });

      // Complete the parent gadget
      tree.startGadget(gadget1.id);
      tree.completeGadget(gadget1.id, { result: "done", executionTimeMs: 1000, cost: 0.005 });

      // Total subtree cost from root LLM
      const totalCost = tree.getSubtreeCost(llm1.id);
      expect(totalCost).toBeCloseTo(0.01 + 0.005 + 0.002 + 0.0001, 6);
    });

    test("getSubtreeTokens aggregates token usage", () => {
      const llm1 = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      tree.completeLLMCall(llm1.id, {
        response: "ok",
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cachedInputTokens: 20 },
      });

      const gadget1 = tree.addGadget({
        invocationId: "gc_1",
        name: "BrowseWeb",
        parameters: {},
        dependencies: [],
        parentId: llm1.id,
      });

      const subLlm = tree.addLLMCall({ iteration: 1, model: "haiku", parentId: gadget1.id });
      tree.completeLLMCall(subLlm.id, {
        response: "ok",
        usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300, cachedInputTokens: 50 },
      });

      const tokens = tree.getSubtreeTokens(llm1.id);
      expect(tokens.input).toBe(300);
      expect(tokens.output).toBe(150);
      expect(tokens.cached).toBe(70);
    });

    test("getSubtreeMedia collects all media from descendant gadgets", () => {
      const llm1 = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      const gadget1 = tree.addGadget({
        invocationId: "gc_1",
        name: "BrowseWeb",
        parameters: {},
        dependencies: [],
        parentId: llm1.id,
      });

      const subLlm = tree.addLLMCall({ iteration: 1, model: "haiku", parentId: gadget1.id });
      const screenshot1 = tree.addGadget({
        invocationId: "gc_ss1",
        name: "Screenshot",
        parameters: {},
        dependencies: [],
        parentId: subLlm.id,
      });
      tree.startGadget(screenshot1.id);
      tree.completeGadget(screenshot1.id, {
        result: "done",
        executionTimeMs: 100,
        media: [{ kind: "image", data: "img1", mimeType: "image/png" }],
      });

      const screenshot2 = tree.addGadget({
        invocationId: "gc_ss2",
        name: "Screenshot",
        parameters: {},
        dependencies: [],
        parentId: subLlm.id,
      });
      tree.startGadget(screenshot2.id);
      tree.completeGadget(screenshot2.id, {
        result: "done",
        executionTimeMs: 100,
        media: [{ kind: "image", data: "img2", mimeType: "image/png" }],
      });

      const allMedia = tree.getSubtreeMedia(llm1.id);
      expect(allMedia.length).toBe(2);
      // Order depends on tree traversal, so check both are present
      const mediaData = allMedia.map((m) => m.data);
      expect(mediaData).toContain("img1");
      expect(mediaData).toContain("img2");
    });

    test("isSubtreeComplete returns true when all nodes completed", () => {
      const llm1 = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      const gadget1 = tree.addGadget({
        invocationId: "gc_1",
        name: "Test",
        parameters: {},
        dependencies: [],
        parentId: llm1.id,
      });

      // Initially not complete
      expect(tree.isSubtreeComplete(llm1.id)).toBe(false);

      tree.completeLLMCall(llm1.id, { response: "ok" });
      expect(tree.isSubtreeComplete(llm1.id)).toBe(false); // Gadget still pending

      tree.startGadget(gadget1.id);
      expect(tree.isSubtreeComplete(llm1.id)).toBe(false); // Gadget still running

      tree.completeGadget(gadget1.id, { result: "done", executionTimeMs: 100 });
      expect(tree.isSubtreeComplete(llm1.id)).toBe(true); // All complete
    });
  });

  describe("Total Aggregation", () => {
    test("getTotalCost aggregates costs across all nodes", () => {
      const llm1 = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      tree.completeLLMCall(llm1.id, { response: "ok", cost: 0.01 });

      const llm2 = tree.addLLMCall({ iteration: 2, model: "sonnet" });
      tree.completeLLMCall(llm2.id, { response: "ok", cost: 0.02 });

      const gadget = tree.addGadget({
        invocationId: "gc_1",
        name: "API",
        parameters: {},
        dependencies: [],
        parentId: llm2.id,
      });
      tree.startGadget(gadget.id);
      tree.completeGadget(gadget.id, { result: "done", executionTimeMs: 100, cost: 0.005 });

      expect(tree.getTotalCost()).toBeCloseTo(0.035, 6);
    });

    test("getTotalTokens aggregates tokens across all LLM calls", () => {
      const llm1 = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      tree.completeLLMCall(llm1.id, {
        response: "ok",
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      });

      const llm2 = tree.addLLMCall({ iteration: 2, model: "sonnet" });
      tree.completeLLMCall(llm2.id, {
        response: "ok",
        usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
      });

      const tokens = tree.getTotalTokens();
      expect(tokens.input).toBe(300);
      expect(tokens.output).toBe(150);
    });
  });

  describe("Event System", () => {
    test("on() subscribes to specific event types", () => {
      const events: ExecutionEvent[] = [];
      tree.on("llm_call_start", (e) => events.push(e));

      tree.addLLMCall({ iteration: 1, model: "sonnet" });
      tree.addGadget({ invocationId: "gc_1", name: "Test", parameters: {}, dependencies: [] });

      // Should only receive LLM event
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("llm_call_start");
    });

    test("onAll() subscribes to all events", () => {
      const events: ExecutionEvent[] = [];
      tree.onAll((e) => events.push(e));

      const llmNode = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      const gadgetNode = tree.addGadget({
        invocationId: "gc_1",
        name: "Test",
        parameters: {},
        dependencies: [],
        parentId: llmNode.id,
      });
      tree.startGadget(gadgetNode.id);
      tree.completeGadget(gadgetNode.id, { result: "done", executionTimeMs: 100 });
      tree.completeLLMCall(llmNode.id, { response: "ok" });

      // Should receive: llm_start, gadget_call, gadget_start, gadget_complete, llm_complete
      expect(events.length).toBe(5);
    });

    test("events carry correct tree context", () => {
      const events: ExecutionEvent[] = [];
      tree.onAll((e) => events.push(e));

      const llmNode = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      const gadgetNode = tree.addGadget({
        invocationId: "gc_1",
        name: "Test",
        parameters: {},
        dependencies: [],
        parentId: llmNode.id,
      });

      // Find the gadget_call event
      const gadgetCallEvent = events.find((e) => e.type === "gadget_call");
      expect(gadgetCallEvent).toBeDefined();
      expect(gadgetCallEvent?.nodeId).toBe(gadgetNode.id);
      expect(gadgetCallEvent?.parentId).toBe(llmNode.id);
      expect(gadgetCallEvent?.depth).toBe(1);
      expect(gadgetCallEvent?.path).toEqual([llmNode.id, gadgetNode.id]);
    });

    test("on() returns unsubscribe function", () => {
      const events: ExecutionEvent[] = [];
      const unsubscribe = tree.on("llm_call_start", (e) => events.push(e));

      tree.addLLMCall({ iteration: 1, model: "sonnet" });
      expect(events.length).toBe(1);

      unsubscribe();
      tree.addLLMCall({ iteration: 2, model: "sonnet" });
      expect(events.length).toBe(1); // Should not have received second event
    });

    test("events() returns async iterable of all events", async () => {
      const eventIterator = tree.events();
      const receivedEvents: ExecutionEvent[] = [];

      // Start consuming events in background
      const consumer = (async () => {
        for await (const event of eventIterator) {
          receivedEvents.push(event);
          if (receivedEvents.length >= 3) break; // Stop after 3 events
        }
      })();

      // Emit some events
      const llmNode = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      tree.addGadget({
        invocationId: "gc_1",
        name: "Test",
        parameters: {},
        dependencies: [],
        parentId: llmNode.id,
      });
      tree.completeLLMCall(llmNode.id, { response: "ok" });

      await consumer;

      expect(receivedEvents.length).toBe(3);
      expect(receivedEvents[0].type).toBe("llm_call_start");
      expect(receivedEvents[1].type).toBe("gadget_call");
      expect(receivedEvents[2].type).toBe("llm_call_complete");
    });
  });

  describe("Node Lookup", () => {
    test("getNodeByInvocationId finds gadget by invocation ID", () => {
      tree.addGadget({
        invocationId: "gc_abc123",
        name: "Test",
        parameters: {},
        dependencies: [],
      });

      const node = tree.getNodeByInvocationId("gc_abc123");
      expect(node).toBeDefined();
      expect(node?.type === "gadget" && node.invocationId).toBe("gc_abc123");
    });

    test("getNodeByInvocationId returns undefined for non-existent ID", () => {
      const node = tree.getNodeByInvocationId("nonexistent");
      expect(node).toBeUndefined();
    });
  });

  describe("Edge Cases", () => {
    test("operations on non-existent node return gracefully", () => {
      expect(tree.getNode("nonexistent")).toBeUndefined();
      expect(tree.getChildren("nonexistent")).toEqual([]);
      expect(tree.getAncestors("nonexistent")).toEqual([]);
      expect(tree.getDescendants("nonexistent")).toEqual([]);
      expect(tree.getSubtreeCost("nonexistent")).toBe(0);
    });

    test("deep nesting maintains correct paths", () => {
      // Create a deeply nested structure: LLM -> Gadget -> LLM -> Gadget -> LLM -> Gadget
      const llm1 = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      const g1 = tree.addGadget({
        invocationId: "gc_1",
        name: "BrowseWeb",
        parameters: {},
        dependencies: [],
        parentId: llm1.id,
      });
      const llm2 = tree.addLLMCall({ iteration: 1, model: "haiku", parentId: g1.id });
      const g2 = tree.addGadget({
        invocationId: "gc_2",
        name: "Navigate",
        parameters: {},
        dependencies: [],
        parentId: llm2.id,
      });
      const llm3 = tree.addLLMCall({ iteration: 1, model: "flash", parentId: g2.id });
      const g3 = tree.addGadget({
        invocationId: "gc_3",
        name: "Click",
        parameters: {},
        dependencies: [],
        parentId: llm3.id,
      });

      const deepestNode = tree.getNode(g3.id);
      expect(deepestNode?.depth).toBe(5);
      expect(deepestNode?.path).toEqual([llm1.id, g1.id, llm2.id, g2.id, llm3.id, g3.id]);
    });

    test("empty tree returns empty aggregations", () => {
      expect(tree.getTotalCost()).toBe(0);
      expect(tree.getTotalTokens()).toEqual({ input: 0, output: 0, cached: 0 });
      expect(tree.getNodeCount()).toEqual({ llmCalls: 0, gadgets: 0 });
      expect(tree.getRoots()).toEqual([]);
    });
  });
});
