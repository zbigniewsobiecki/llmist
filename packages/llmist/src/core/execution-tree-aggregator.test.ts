/**
 * Isolated unit tests for ExecutionTreeAggregator.
 */

import { describe, expect, test } from "vitest";
import type { GadgetMediaOutput } from "../gadgets/types.js";
import { ExecutionTreeAggregator } from "./execution-tree-aggregator.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type NodeType = "llm_call" | "gadget";

interface MockNode {
  type: NodeType;
  completedAt: number | null;
  children: string[];
  cost?: number;
  usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
  media?: GadgetMediaOutput[];
}

function buildAggregator(
  nodes: Record<string, MockNode>,
  descendants: Record<string, string[]> = {},
): ExecutionTreeAggregator {
  const nodeMap = new Map<string, MockNode>(Object.entries(nodes));

  const getDescendants = (id: string, type?: string): MockNode[] => {
    const ids = descendants[id] ?? [];
    return ids
      .map((childId) => nodeMap.get(childId))
      .filter((n): n is MockNode => n !== undefined && (!type || n.type === type));
  };

  return new ExecutionTreeAggregator(nodeMap as any, getDescendants as any);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExecutionTreeAggregator", () => {
  describe("getTotalCost", () => {
    test("returns 0 for an empty tree", () => {
      const agg = buildAggregator({});
      expect(agg.getTotalCost()).toBe(0);
    });

    test("sums costs from all nodes regardless of type", () => {
      const agg = buildAggregator({
        llm_1: { type: "llm_call", completedAt: 1, children: [], cost: 0.01 },
        llm_2: { type: "llm_call", completedAt: 1, children: [], cost: 0.02 },
        gadget_1: { type: "gadget", completedAt: 1, children: [], cost: 0.005 },
      });

      expect(agg.getTotalCost()).toBeCloseTo(0.035);
    });

    test("ignores nodes with no cost", () => {
      const agg = buildAggregator({
        llm_1: { type: "llm_call", completedAt: 1, children: [] }, // no cost
        llm_2: { type: "llm_call", completedAt: 1, children: [], cost: 0.01 },
      });

      expect(agg.getTotalCost()).toBeCloseTo(0.01);
    });
  });

  describe("getSubtreeCost", () => {
    test("returns 0 for non-existent node", () => {
      const agg = buildAggregator({});
      expect(agg.getSubtreeCost("missing")).toBe(0);
    });

    test("includes root node and all descendants", () => {
      const agg = buildAggregator(
        {
          llm_1: { type: "llm_call", completedAt: 1, children: ["gadget_1"], cost: 0.01 },
          gadget_1: { type: "gadget", completedAt: 1, children: ["llm_2"], cost: 0.005 },
          llm_2: { type: "llm_call", completedAt: 1, children: [], cost: 0.002 },
        },
        { llm_1: ["gadget_1", "llm_2"] },
      );

      expect(agg.getSubtreeCost("llm_1")).toBeCloseTo(0.017);
    });

    test("excludes nodes outside the subtree", () => {
      const agg = buildAggregator(
        {
          llm_1: { type: "llm_call", completedAt: 1, children: [], cost: 0.01 },
          llm_2: { type: "llm_call", completedAt: 1, children: [], cost: 0.02 },
        },
        { llm_1: [] },
      );

      // Only llm_1 subtree
      expect(agg.getSubtreeCost("llm_1")).toBeCloseTo(0.01);
    });
  });

  describe("getTotalTokens", () => {
    test("returns zeros for empty tree", () => {
      const agg = buildAggregator({});
      expect(agg.getTotalTokens()).toEqual({ input: 0, output: 0, cached: 0 });
    });

    test("aggregates tokens from llm_call nodes only", () => {
      const agg = buildAggregator({
        llm_1: {
          type: "llm_call",
          completedAt: 1,
          children: [],
          usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 20 },
        },
        gadget_1: {
          type: "gadget",
          completedAt: 1,
          children: [],
          // gadget nodes never have usage — should be ignored
        },
        llm_2: {
          type: "llm_call",
          completedAt: 1,
          children: [],
          usage: { inputTokens: 200, outputTokens: 100, cachedInputTokens: 30 },
        },
      });

      const tokens = agg.getTotalTokens();
      expect(tokens.input).toBe(300);
      expect(tokens.output).toBe(150);
      expect(tokens.cached).toBe(50);
    });

    test("handles llm_call nodes without usage data", () => {
      const agg = buildAggregator({
        llm_1: { type: "llm_call", completedAt: null, children: [] }, // in-flight, no usage yet
        llm_2: {
          type: "llm_call",
          completedAt: 1,
          children: [],
          usage: { inputTokens: 100, outputTokens: 50 },
        },
      });

      const tokens = agg.getTotalTokens();
      expect(tokens.input).toBe(100);
      expect(tokens.output).toBe(50);
      expect(tokens.cached).toBe(0);
    });
  });

  describe("getSubtreeTokens", () => {
    test("returns zeros for non-existent node", () => {
      const agg = buildAggregator({});
      expect(agg.getSubtreeTokens("missing")).toEqual({ input: 0, output: 0, cached: 0 });
    });

    test("aggregates tokens for node and descendants", () => {
      const agg = buildAggregator(
        {
          llm_1: {
            type: "llm_call",
            completedAt: 1,
            children: [],
            usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 20 },
          },
          llm_2: {
            type: "llm_call",
            completedAt: 1,
            children: [],
            usage: { inputTokens: 200, outputTokens: 100, cachedInputTokens: 50 },
          },
        },
        { llm_1: ["llm_2"] },
      );

      const tokens = agg.getSubtreeTokens("llm_1");
      expect(tokens.input).toBe(300);
      expect(tokens.output).toBe(150);
      expect(tokens.cached).toBe(70);
    });
  });

  describe("getSubtreeMedia", () => {
    test("returns empty array for non-existent node", () => {
      const agg = buildAggregator({});
      expect(agg.getSubtreeMedia("missing")).toEqual([]);
    });

    test("collects media from gadget root node", () => {
      const img: GadgetMediaOutput = { kind: "image", data: "base64data", mimeType: "image/png" };
      const agg = buildAggregator({
        gadget_1: { type: "gadget", completedAt: 1, children: [], media: [img] },
      });

      expect(agg.getSubtreeMedia("gadget_1")).toEqual([img]);
    });

    test("collects media from descendant gadgets", () => {
      const img1: GadgetMediaOutput = { kind: "image", data: "img1", mimeType: "image/png" };
      const img2: GadgetMediaOutput = { kind: "image", data: "img2", mimeType: "image/png" };

      const agg = buildAggregator(
        {
          llm_1: { type: "llm_call", completedAt: 1, children: ["gadget_1"] },
          gadget_1: { type: "gadget", completedAt: 1, children: ["llm_2"], media: [img1] },
          llm_2: { type: "llm_call", completedAt: 1, children: ["gadget_2"] },
          gadget_2: { type: "gadget", completedAt: 1, children: [], media: [img2] },
        },
        { llm_1: ["gadget_1", "llm_2", "gadget_2"] },
      );

      const media = agg.getSubtreeMedia("llm_1");
      expect(media).toHaveLength(2);
      const dataValues = media.map((m) => m.data);
      expect(dataValues).toContain("img1");
      expect(dataValues).toContain("img2");
    });
  });

  describe("isSubtreeComplete", () => {
    test("returns true for non-existent node", () => {
      const agg = buildAggregator({});
      expect(agg.isSubtreeComplete("missing")).toBe(true);
    });

    test("returns false when root node has no completedAt", () => {
      const agg = buildAggregator({
        llm_1: { type: "llm_call", completedAt: null, children: [] },
      });

      expect(agg.isSubtreeComplete("llm_1")).toBe(false);
    });

    test("returns false when a descendant is not complete", () => {
      const agg = buildAggregator(
        {
          llm_1: { type: "llm_call", completedAt: 1, children: ["gadget_1"] },
          gadget_1: { type: "gadget", completedAt: null, children: [] }, // still running
        },
        { llm_1: ["gadget_1"] },
      );

      expect(agg.isSubtreeComplete("llm_1")).toBe(false);
    });

    test("returns true when root and all descendants are complete", () => {
      const agg = buildAggregator(
        {
          llm_1: { type: "llm_call", completedAt: 1, children: ["gadget_1"] },
          gadget_1: { type: "gadget", completedAt: 2, children: [] },
        },
        { llm_1: ["gadget_1"] },
      );

      expect(agg.isSubtreeComplete("llm_1")).toBe(true);
    });
  });

  describe("getNodeCount", () => {
    test("returns zeros for empty tree", () => {
      const agg = buildAggregator({});
      expect(agg.getNodeCount()).toEqual({ llmCalls: 0, gadgets: 0 });
    });

    test("counts llm_call and gadget nodes correctly", () => {
      const agg = buildAggregator({
        llm_1: { type: "llm_call", completedAt: 1, children: [] },
        llm_2: { type: "llm_call", completedAt: 1, children: [] },
        gadget_1: { type: "gadget", completedAt: 1, children: [] },
      });

      expect(agg.getNodeCount()).toEqual({ llmCalls: 2, gadgets: 1 });
    });
  });
});
