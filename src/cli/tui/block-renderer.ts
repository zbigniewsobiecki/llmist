/**
 * BlockRenderer - Interactive block-based TUI renderer.
 *
 * Manages a tree of selectable/expandable blocks for LLM calls and gadgets.
 * Handles navigation, selection, and expand/collapse interactions.
 *
 * @module
 */

import { Box, ScrollableBox } from "@unblessed/node";
import type {
  BlockNode,
  LLMCallNode,
  GadgetNode,
  TextNode,
  SelectableBlock,
} from "./types.js";
import {
  formatLLMCallCollapsed,
  formatLLMCallExpanded,
  formatGadgetCollapsed,
  formatGadgetExpanded,
  getIndent,
  getContinuationIndent,
} from "../ui/block-formatters.js";

// ─────────────────────────────────────────────────────────────────────────────
// BlockRenderer Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages interactive blocks in the TUI.
 *
 * Features:
 * - Tree structure of LLM calls and gadgets
 * - Keyboard navigation (up/down)
 * - Expand/collapse for details
 * - Dynamic updates (gadget results, subagent events)
 */
export class BlockRenderer {
  private container: ScrollableBox;
  private renderCallback: () => void;

  /** All nodes in the tree (flat for easy lookup) */
  private nodes = new Map<string, BlockNode>();

  /** Root node IDs (top-level LLM calls and text) */
  private rootIds: string[] = [];

  /** Rendered blocks with UI state */
  private blocks = new Map<string, SelectableBlock>();

  /** IDs of selectable blocks in display order */
  private selectableIds: string[] = [];

  /** Currently selected block index (-1 = none) */
  private selectedIndex = -1;

  /** Counter for generating unique node IDs */
  private nodeIdCounter = 0;

  /** Current LLM call node (for adding gadget children) */
  private currentLLMCallId: string | null = null;

  /** Persisted expanded states (survives rebuildBlocks) */
  private expandedStates = new Map<string, boolean>();

  /** Track main agent LLM calls by iteration to prevent duplicates */
  private llmCallByIteration = new Map<number, string>();

  constructor(container: ScrollableBox, renderCallback: () => void) {
    this.container = container;
    this.renderCallback = renderCallback;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API - Node Management
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Add an LLM call node (top-level or nested in gadget).
   * For main agent calls (no parent), deduplicates by iteration number.
   */
  addLLMCall(
    iteration: number,
    model: string,
    parentGadgetId?: string,
  ): string {
    // Deduplicate main agent LLM calls by iteration
    if (!parentGadgetId) {
      const existingId = this.llmCallByIteration.get(iteration);
      if (existingId) {
        // Return existing block instead of creating duplicate
        this.currentLLMCallId = existingId;
        return existingId;
      }
    }

    const id = this.generateId("llm");
    const depth = parentGadgetId ? this.getNode(parentGadgetId)!.depth + 1 : 0;

    const node: LLMCallNode = {
      id,
      type: "llm_call",
      depth,
      parentId: parentGadgetId ?? null,
      iteration,
      model,
      isComplete: false,
      children: [],
    };

    this.nodes.set(id, node);

    if (parentGadgetId) {
      // Nested LLM call - add to parent gadget's children
      const parent = this.getNode(parentGadgetId) as GadgetNode;
      parent.children.push(id);
    } else {
      // Top-level LLM call - track by iteration for deduplication
      this.rootIds.push(id);
      this.llmCallByIteration.set(iteration, id);
    }

    this.currentLLMCallId = id;
    this.rebuildBlocks();
    return id;
  }

  /**
   * Complete an LLM call with details and optional raw response.
   */
  completeLLMCall(
    id: string,
    details: LLMCallNode["details"],
    rawResponse?: string,
  ): void {
    const node = this.getNode(id) as LLMCallNode | undefined;
    if (!node || node.type !== "llm_call") return;

    node.isComplete = true;
    node.details = details;
    if (rawResponse !== undefined) {
      node.rawResponse = rawResponse;
    }
    this.updateBlock(id);
  }

  /**
   * Store raw request messages for an LLM call.
   * Called when the LLM call is ready (after controller modifications).
   */
  setLLMCallRequest(
    id: string,
    messages: import("../../core/messages.js").LLMMessage[],
  ): void {
    const node = this.getNode(id) as LLMCallNode | undefined;
    if (!node || node.type !== "llm_call") return;
    node.rawRequest = messages;
  }

  /**
   * Add a gadget node as a child of the current LLM call.
   *
   * Gadgets are nested under the LLM call that spawned them.
   * They appear indented and are visible when the parent is rendered.
   */
  addGadget(
    invocationId: string,
    name: string,
    parameters?: Record<string, unknown>,
  ): string {
    const id = this.generateId("gadget");
    const parentLLMCallId = this.currentLLMCallId;

    // Calculate depth based on parent
    let depth = 0;
    if (parentLLMCallId) {
      const parent = this.getNode(parentLLMCallId);
      if (parent) {
        depth = parent.depth + 1;
      }
    }

    const node: GadgetNode = {
      id,
      type: "gadget",
      depth,
      parentId: parentLLMCallId,
      invocationId,
      name,
      isComplete: false,
      parameters,
      children: [], // Used for subagent nested LLM calls
    };

    this.nodes.set(id, node);

    if (parentLLMCallId) {
      // Nest under parent LLM call
      const parent = this.getNode(parentLLMCallId) as LLMCallNode;
      parent.children.push(id);
    } else {
      // No parent LLM call - add to root
      this.rootIds.push(id);
    }

    this.rebuildBlocks();
    return id;
  }

  /**
   * Complete a gadget with result.
   */
  completeGadget(
    invocationId: string,
    result?: string,
    error?: string,
    executionTimeMs?: number,
    cost?: number,
  ): void {
    // Find gadget by invocationId
    const node = this.findGadgetByInvocationId(invocationId);
    if (!node) return;

    node.isComplete = true;
    node.result = result;
    node.error = error;
    node.executionTimeMs = executionTimeMs;
    node.cost = cost;

    // Estimate result tokens (rough: ~4 chars per token)
    if (result) {
      node.resultTokens = Math.ceil(result.length / 4);
    }

    // Aggregate subagent stats from child LLM call nodes
    if (node.children.length > 0) {
      node.subagentStats = this.aggregateSubagentStats(node.children);
    }

    this.updateBlock(node.id);
  }

  /**
   * Aggregate token/cost stats from child LLM call nodes.
   */
  private aggregateSubagentStats(
    childIds: string[],
  ): GadgetNode["subagentStats"] {
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;
    let cost = 0;
    let llmCallCount = 0;

    for (const childId of childIds) {
      const child = this.nodes.get(childId);
      if (child?.type === "llm_call" && child.details) {
        inputTokens += child.details.inputTokens ?? 0;
        outputTokens += child.details.outputTokens ?? 0;
        cachedTokens += child.details.cachedInputTokens ?? 0;
        cost += child.details.cost ?? 0;
        llmCallCount++;
      }
    }

    return { inputTokens, outputTokens, cachedTokens, cost, llmCallCount };
  }

  /**
   * Add a text node (flows between LLM calls).
   */
  addText(content: string): string {
    const id = this.generateId("text");

    const node: TextNode = {
      id,
      type: "text",
      depth: 0,
      parentId: null,
      content,
      children: [] as never[],
    };

    this.nodes.set(id, node);
    this.rootIds.push(id);
    this.rebuildBlocks();
    return id;
  }

  /**
   * Find a gadget node by its invocation ID.
   */
  findGadgetByInvocationId(invocationId: string): GadgetNode | undefined {
    for (const node of this.nodes.values()) {
      if (node.type === "gadget" && node.invocationId === invocationId) {
        return node;
      }
    }
    return undefined;
  }

  /**
   * Set the current LLM call context for gadget parenting.
   * Used when processing subagent events to ensure gadgets are nested
   * under the correct subagent LLM call.
   */
  setCurrentLLMCall(llmCallId: string | null): void {
    this.currentLLMCallId = llmCallId;
  }

  /**
   * Clear all blocks.
   */
  clear(): void {
    this.nodes.clear();
    this.blocks.clear();
    this.expandedStates.clear();
    this.llmCallByIteration.clear();
    this.rootIds = [];
    this.selectableIds = [];
    this.selectedIndex = -1;
    this.currentLLMCallId = null;

    // Clear container children
    for (const child of [...this.container.children]) {
      child.detach();
    }
    this.renderCallback();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API - Selection & Navigation
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Move selection to the next selectable block.
   */
  selectNext(): void {
    if (this.selectableIds.length === 0) return;

    if (this.selectedIndex < this.selectableIds.length - 1) {
      this.selectedIndex++;
      this.updateSelection();
    }
  }

  /**
   * Move selection to the previous selectable block.
   */
  selectPrevious(): void {
    if (this.selectableIds.length === 0) return;

    if (this.selectedIndex > 0) {
      this.selectedIndex--;
      this.updateSelection();
    } else if (this.selectedIndex === -1 && this.selectableIds.length > 0) {
      // Select last if nothing selected
      this.selectedIndex = this.selectableIds.length - 1;
      this.updateSelection();
    }
  }

  /**
   * Select first selectable block.
   */
  selectFirst(): void {
    if (this.selectableIds.length > 0) {
      this.selectedIndex = 0;
      this.updateSelection();
    }
  }

  /**
   * Select last selectable block.
   */
  selectLast(): void {
    if (this.selectableIds.length > 0) {
      this.selectedIndex = this.selectableIds.length - 1;
      this.updateSelection();
    }
  }

  /**
   * Get currently selected block.
   */
  getSelectedBlock(): SelectableBlock | undefined {
    if (this.selectedIndex < 0 || this.selectedIndex >= this.selectableIds.length) {
      return undefined;
    }
    return this.blocks.get(this.selectableIds[this.selectedIndex]);
  }

  /**
   * Toggle expand/collapse of selected block.
   */
  toggleExpand(): void {
    const block = this.getSelectedBlock();
    if (!block) return;

    block.expanded = !block.expanded;
    // Persist expanded state across rebuilds
    this.expandedStates.set(block.node.id, block.expanded);
    this.updateBlock(block.node.id);
  }

  /**
   * Collapse selected block (or deselect if already collapsed).
   */
  collapseOrDeselect(): void {
    const block = this.getSelectedBlock();
    if (!block) return;

    if (block.expanded) {
      block.expanded = false;
      // Persist collapsed state across rebuilds
      this.expandedStates.set(block.node.id, false);
      this.updateBlock(block.node.id);
    } else {
      this.selectedIndex = -1;
      this.updateSelection();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private - Node & Block Management
  // ───────────────────────────────────────────────────────────────────────────

  private generateId(prefix: string): string {
    return `${prefix}_${++this.nodeIdCounter}`;
  }

  private getNode(id: string): BlockNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Rebuild all blocks from the node tree.
   * Called when nodes are added/removed.
   */
  private rebuildBlocks(): void {
    // Clear existing blocks
    for (const child of [...this.container.children]) {
      child.detach();
    }
    this.blocks.clear();
    this.selectableIds = [];

    // Track vertical position
    let top = 0;

    // Traverse tree in order
    for (const rootId of this.rootIds) {
      top = this.renderNodeTree(rootId, top);
    }

    // Restore selection if possible
    if (this.selectedIndex >= this.selectableIds.length) {
      this.selectedIndex = this.selectableIds.length - 1;
    }

    this.renderCallback();
  }

  /**
   * Render a node and its children recursively.
   * Returns the next available top position.
   */
  private renderNodeTree(nodeId: string, top: number): number {
    const node = this.getNode(nodeId);
    if (!node) return top;

    // Create block for this node
    const block = this.createBlock(node, top);
    this.blocks.set(nodeId, block);

    // Track selectable blocks
    if (block.selectable) {
      this.selectableIds.push(nodeId);
    }

    // Calculate height of this block
    const height = this.getBlockHeight(block);
    top += height;

    // Always render children (gadgets are always visible under their LLM call)
    // The expanded state controls inline details, not child visibility
    if ("children" in node && node.children.length > 0) {
      for (const childId of node.children) {
        top = this.renderNodeTree(childId, top);
      }
    }

    return top;
  }

  /**
   * Create a block for a node.
   */
  private createBlock(node: BlockNode, top: number): SelectableBlock {
    const isSelected = this.selectableIds.length === this.selectedIndex;
    const selectable = node.type !== "text";

    // Get persisted expanded state (survives rebuildBlocks), default to collapsed
    const expanded = this.expandedStates.get(node.id) ?? false;

    // Format content
    const content = this.formatBlockContent(node, isSelected, expanded);

    // Create Box widget
    const box = new Box({
      parent: this.container,
      top,
      left: 0,
      width: "100%",
      height: content.split("\n").length,
      content,
      tags: false, // We use ANSI codes directly
    });

    return {
      node,
      box,
      expanded,
      selectable,
    };
  }

  /**
   * Format block content based on type and state.
   */
  private formatBlockContent(
    node: BlockNode,
    selected: boolean,
    expanded: boolean,
  ): string {
    const indent = getIndent(node.depth);

    switch (node.type) {
      case "llm_call": {
        const collapsed = formatLLMCallCollapsed(node, selected);
        if (!expanded) {
          return indent + collapsed;
        }
        const expandedLines = formatLLMCallExpanded(node);
        const contIndent = getContinuationIndent(node.depth);
        return [
          indent + collapsed,
          ...expandedLines.map((line) => contIndent + line),
        ].join("\n");
      }

      case "gadget": {
        const collapsed = formatGadgetCollapsed(node, selected);
        if (!expanded) {
          return indent + collapsed;
        }
        const expandedLines = formatGadgetExpanded(node);
        const contIndent = getContinuationIndent(node.depth);
        return [
          indent + collapsed,
          ...expandedLines.map((line) => contIndent + line),
        ].join("\n");
      }

      case "text":
        return node.content;
    }
  }

  /**
   * Get the height (in lines) of a block.
   */
  private getBlockHeight(block: SelectableBlock): number {
    const content = block.box.getContent();
    return content.split("\n").length;
  }

  /**
   * Update a single block (after state change).
   */
  private updateBlock(nodeId: string): void {
    const block = this.blocks.get(nodeId);
    const node = this.getNode(nodeId);
    if (!block || !node) return;

    const isSelected = this.selectableIds[this.selectedIndex] === nodeId;
    const content = this.formatBlockContent(node, isSelected, block.expanded);

    const oldHeight = this.getBlockHeight(block);
    block.box.setContent(content);
    const newHeight = content.split("\n").length;
    block.box.height = newHeight;

    // If height changed, need to reposition subsequent blocks
    if (oldHeight !== newHeight) {
      this.repositionBlocks();
    }

    this.renderCallback();
  }

  /**
   * Update selection highlighting.
   */
  private updateSelection(): void {
    // Update all selectable blocks
    for (const id of this.selectableIds) {
      const block = this.blocks.get(id);
      if (block) {
        const isSelected = this.selectableIds[this.selectedIndex] === id;
        const content = this.formatBlockContent(block.node, isSelected, block.expanded);
        block.box.setContent(content);
      }
    }

    // Scroll to keep selection visible
    this.scrollToSelection();
    this.renderCallback();
  }

  /**
   * Reposition all blocks after height change.
   */
  private repositionBlocks(): void {
    let top = 0;
    for (const rootId of this.rootIds) {
      top = this.repositionNodeTree(rootId, top);
    }
  }

  private repositionNodeTree(nodeId: string, top: number): number {
    const block = this.blocks.get(nodeId);
    const node = this.getNode(nodeId);
    if (!block || !node) return top;

    block.box.top = top;
    const height = this.getBlockHeight(block);
    top += height;

    // Always traverse children (they're always visible)
    if ("children" in node) {
      for (const childId of node.children) {
        top = this.repositionNodeTree(childId, top);
      }
    }

    return top;
  }

  /**
   * Scroll container to keep selected block visible.
   */
  private scrollToSelection(): void {
    const block = this.getSelectedBlock();
    if (!block) return;

    // Skip if scroll methods not available
    if (!this.container.getScroll || !this.container.scrollTo) return;

    const blockTop = block.box.top as number;
    const blockHeight = this.getBlockHeight(block);
    const containerHeight = this.container.height as number;
    const scrollPos = this.container.getScroll();

    // If block is above visible area, scroll up
    if (blockTop < scrollPos) {
      this.container.scrollTo(blockTop);
    }
    // If block is below visible area, scroll down
    else if (blockTop + blockHeight > scrollPos + containerHeight) {
      this.container.scrollTo(blockTop + blockHeight - containerHeight);
    }
  }
}
