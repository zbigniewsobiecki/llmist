/**
 * ExecutionTreeAggregator — cost, token, and media aggregation for ExecutionTree.
 *
 * This class is responsible solely for rollup computations. It receives the
 * node map and a traversal callback from `ExecutionTree` at construction time
 * and exposes the same aggregation methods that used to live on `ExecutionTree`.
 *
 * Keeping this logic separate makes it straightforward to test the aggregation
 * math in isolation, without needing to drive a full `ExecutionTree` instance.
 *
 * @module core/execution-tree-aggregator
 */

import type { GadgetMediaOutput } from "../gadgets/types.js";

// ---------------------------------------------------------------------------
// Minimal node interfaces (structural — actual ExecutionNode objects satisfy these)
// ---------------------------------------------------------------------------

interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

interface AggregableNode {
  type: string;
  completedAt: number | null;
  children: string[];
  /** Present only on llm_call nodes */
  cost?: number;
  /** Present only on llm_call nodes */
  usage?: UsageSnapshot;
  /** Present only on gadget nodes */
  media?: GadgetMediaOutput[];
}

// ---------------------------------------------------------------------------
// ExecutionTreeAggregator
// ---------------------------------------------------------------------------

/**
 * Provides aggregation over an `ExecutionTree`'s node map.
 *
 * @example
 * ```typescript
 * // ExecutionTree creates the aggregator internally:
 * const agg = new ExecutionTreeAggregator(
 *   this.nodes,
 *   (id, type) => this.getDescendants(id, type),
 * );
 * console.log(agg.getTotalCost());
 * ```
 */
export class ExecutionTreeAggregator {
  constructor(
    private readonly nodes: ReadonlyMap<string, AggregableNode>,
    private readonly getDescendants: (id: string, type?: string) => ReadonlyArray<AggregableNode>,
  ) {}

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Extract the monetary cost from a single node (0 when not set).
   */
  private getNodeCost(node: AggregableNode): number {
    return node.cost ?? 0;
  }

  /**
   * Accumulate token counts from an iterable of nodes.
   * Non-LLM nodes (gadgets) are ignored.
   */
  private accumulateTokens(nodes: Iterable<AggregableNode>): {
    input: number;
    output: number;
    cached: number;
  } {
    let input = 0;
    let output = 0;
    let cached = 0;

    for (const node of nodes) {
      if (node.type === "llm_call" && node.usage) {
        input += node.usage.inputTokens;
        output += node.usage.outputTokens;
        cached += node.usage.cachedInputTokens ?? 0;
      }
    }

    return { input, output, cached };
  }

  // ===========================================================================
  // Cost
  // ===========================================================================

  /**
   * Total cost across every node in the tree.
   */
  getTotalCost(): number {
    let total = 0;
    for (const node of this.nodes.values()) {
      total += this.getNodeCost(node);
    }
    return total;
  }

  /**
   * Total cost for a subtree (node + all descendants).
   */
  getSubtreeCost(nodeId: string): number {
    const node = this.nodes.get(nodeId);
    if (!node) return 0;

    let total = this.getNodeCost(node);
    for (const descendant of this.getDescendants(nodeId)) {
      total += this.getNodeCost(descendant);
    }
    return total;
  }

  // ===========================================================================
  // Tokens
  // ===========================================================================

  /**
   * Aggregate token usage across the entire tree.
   */
  getTotalTokens(): { input: number; output: number; cached: number } {
    return this.accumulateTokens(this.nodes.values());
  }

  /**
   * Aggregate token usage for a subtree.
   */
  getSubtreeTokens(nodeId: string): { input: number; output: number; cached: number } {
    const node = this.nodes.get(nodeId);
    if (!node) return { input: 0, output: 0, cached: 0 };

    return this.accumulateTokens([node, ...this.getDescendants(nodeId)]);
  }

  // ===========================================================================
  // Media
  // ===========================================================================

  /**
   * Collect all media outputs from gadget nodes in a subtree.
   */
  getSubtreeMedia(nodeId: string): GadgetMediaOutput[] {
    const node = this.nodes.get(nodeId);
    if (!node) return [];

    const media: GadgetMediaOutput[] = [];
    const nodesToProcess: AggregableNode[] = node.type === "gadget" ? [node] : [];
    nodesToProcess.push(...(this.getDescendants(nodeId, "gadget") as AggregableNode[]));

    for (const n of nodesToProcess) {
      if (n.type === "gadget" && n.media) {
        media.push(...n.media);
      }
    }

    return media;
  }

  // ===========================================================================
  // Completion & counts
  // ===========================================================================

  /**
   * Check whether a subtree is fully complete (all nodes have `completedAt` set).
   */
  isSubtreeComplete(nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return true;
    if (!node.completedAt) return false;

    for (const descendant of this.getDescendants(nodeId)) {
      if (!descendant.completedAt) return false;
    }

    return true;
  }

  /**
   * Count LLM call nodes and gadget nodes in the tree.
   */
  getNodeCount(): { llmCalls: number; gadgets: number } {
    let llmCalls = 0;
    let gadgets = 0;

    for (const node of this.nodes.values()) {
      if (node.type === "llm_call") llmCalls++;
      else if (node.type === "gadget") gadgets++;
    }

    return { llmCalls, gadgets };
  }
}
