/**
 * BlockRenderer - Interactive block-based TUI renderer.
 *
 * Manages a tree of selectable/expandable blocks for LLM calls and gadgets.
 * Handles navigation, selection, and expand/collapse interactions.
 *
 * Can optionally subscribe to an ExecutionTree for automatic updates,
 * eliminating the need for manual event handling.
 *
 * @module
 */

import { Box, type ScrollableBox } from "@unblessed/node";
import type {
  ExecutionTree,
  ExecutionEvent,
} from "../../core/execution-tree.js";
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
import { renderMarkdown } from "../ui/formatters.js";

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

  /** Whether to auto-scroll to bottom on new content ("follow mode") */
  private followMode: boolean = true;

  /** Threshold in pixels for detecting "at bottom" position */
  private static readonly AT_BOTTOM_THRESHOLD = 5;

  /** Track main agent LLM calls by iteration to prevent duplicates */
  private llmCallByIteration = new Map<number, string>();

  /** Track gadgets by invocationId to prevent duplicates */
  private gadgetByInvocationId = new Map<string, string>();

  /** Track nested LLM calls by parentId_iteration to prevent duplicates */
  private nestedLLMCallByKey = new Map<string, string>();

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
   *
   * @param iteration - 1-indexed iteration number
   * @param model - Model name (e.g., "anthropic:claude-sonnet-4-5")
   * @param parentGadgetId - Parent gadget block ID for nested LLM calls
   * @param isNested - Override flag to treat as nested even without parentGadgetId
   *                   (used when tree event depth > 0 but parent lookup failed)
   */
  addLLMCall(
    iteration: number,
    model: string,
    parentGadgetId?: string,
    isNested?: boolean,
  ): string {
    // Deduplicate main agent LLM calls by iteration (only if NOT a nested call)
    // isNested flag prevents deduplication even when parentGadgetId lookup failed
    if (!parentGadgetId && !isNested) {
      const existingId = this.llmCallByIteration.get(iteration);
      if (existingId) {
        // Return existing block instead of creating duplicate
        this.currentLLMCallId = existingId;
        return existingId;
      }
    } else if (parentGadgetId) {
      // Deduplicate nested subagent LLM calls by parent + iteration
      const nestedKey = `${parentGadgetId}_${iteration}`;
      const existingId = this.nestedLLMCallByKey.get(nestedKey);
      if (existingId) {
        // Return existing block instead of creating duplicate
        this.currentLLMCallId = existingId;
        return existingId;
      }
    }

    const id = this.generateId("llm");
    const parentNode = parentGadgetId ? this.getNode(parentGadgetId) : undefined;
    const depth = parentNode ? parentNode.depth + 1 : 0;

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
      // Track for deduplication
      const nestedKey = `${parentGadgetId}_${iteration}`;
      this.nestedLLMCallByKey.set(nestedKey, id);
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
    // Deduplicate gadgets by invocationId
    const existingId = this.gadgetByInvocationId.get(invocationId);
    if (existingId) {
      // Return existing block instead of creating duplicate
      return existingId;
    }

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

    // Track for deduplication
    this.gadgetByInvocationId.set(invocationId, id);

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
   * Uses O(1) Map lookup instead of linear search.
   */
  findGadgetByInvocationId(invocationId: string): GadgetNode | undefined {
    const blockId = this.gadgetByInvocationId.get(invocationId);
    if (!blockId) return undefined;
    const node = this.nodes.get(blockId);
    return node?.type === "gadget" ? (node as GadgetNode) : undefined;
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
   * Get the current LLM call ID.
   *
   * In tree mode, this is only used for attaching raw request/response data
   * to the block for the raw viewer feature. Parent-child relationships are
   * determined by event.parentId in handleTreeEvent(), not by this method.
   */
  getCurrentLLMCallId(): string | null {
    return this.currentLLMCallId;
  }

  /**
   * Check if tree subscription is active.
   * When active, external code should skip block creation (tree handles it).
   */
  isTreeSubscribed(): boolean {
    return this.treeUnsubscribe !== null;
  }

  /**
   * Store raw response for an LLM call (enrichment only).
   * Use this when tree handles completion but hooks have raw data.
   */
  setLLMCallResponse(id: string, rawResponse: string): void {
    const node = this.getNode(id) as LLMCallNode | undefined;
    if (!node || node.type !== "llm_call") return;
    node.rawResponse = rawResponse;
  }

  /**
   * Clear all blocks.
   */
  clear(): void {
    this.nodes.clear();
    this.blocks.clear();
    this.expandedStates.clear();
    this.llmCallByIteration.clear();
    this.gadgetByInvocationId.clear();
    this.nestedLLMCallByKey.clear();
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

    // Track vertical position (starts at 0, will be offset for bottom-alignment)
    let top = 0;

    // Traverse tree in order
    for (const rootId of this.rootIds) {
      top = this.renderNodeTree(rootId, top);
    }

    // Restore selection if possible
    if (this.selectedIndex >= this.selectableIds.length) {
      this.selectedIndex = this.selectableIds.length - 1;
    }

    // Apply bottom alignment and auto-scroll (chat-like behavior)
    this.applyBottomAlignmentAndScroll();

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
        // Render text content as markdown for beautiful formatting
        // Add margin (empty line) above and below for visual separation
        return `\n${renderMarkdown(node.content)}\n`;
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

    // Re-apply bottom alignment after repositioning
    this.applyBottomAlignmentAndScroll();
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
      // Disable follow mode when scrolling up
      this.followMode = false;
    }
    // If block is below visible area, scroll down
    else if (blockTop + blockHeight > scrollPos + containerHeight) {
      this.container.scrollTo(blockTop + blockHeight - containerHeight);
      // Check if now at bottom, re-enable follow mode
      if (this.isAtBottom()) {
        this.followMode = true;
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Bottom Alignment & Auto-Scroll (Chat-like behavior)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Calculate total height of all rendered blocks.
   * Used for bottom-alignment offset calculation.
   */
  private getTotalContentHeight(): number {
    let totalHeight = 0;
    for (const rootId of this.rootIds) {
      totalHeight = this.sumNodeTreeHeight(rootId, totalHeight);
    }
    return totalHeight;
  }

  private sumNodeTreeHeight(nodeId: string, currentHeight: number): number {
    const block = this.blocks.get(nodeId);
    const node = this.getNode(nodeId);
    if (!block || !node) return currentHeight;

    currentHeight += this.getBlockHeight(block);

    if ("children" in node) {
      for (const childId of node.children) {
        currentHeight = this.sumNodeTreeHeight(childId, currentHeight);
      }
    }
    return currentHeight;
  }

  /**
   * Calculate vertical offset to push content to bottom when content < viewport.
   * Returns 0 when content fills or exceeds viewport.
   */
  private getBottomAlignmentOffset(): number {
    const containerHeight = this.container.height as number;
    const contentHeight = this.getTotalContentHeight();

    if (contentHeight >= containerHeight) {
      return 0; // Content fills viewport, no offset needed
    }

    return containerHeight - contentHeight;
  }

  /**
   * Check if scroll position is at or near the bottom.
   */
  private isAtBottom(): boolean {
    if (!this.container.getScroll) return true;

    const scrollPos = this.container.getScroll();
    const containerHeight = this.container.height as number;
    const contentHeight = this.getTotalContentHeight();

    // At bottom if scrollPos + containerHeight >= contentHeight (with threshold)
    const maxScroll = Math.max(0, contentHeight - containerHeight);
    return scrollPos >= maxScroll - BlockRenderer.AT_BOTTOM_THRESHOLD;
  }

  /**
   * Scroll to the bottom of content.
   */
  private scrollToBottom(): void {
    if (!this.container.setScrollPerc) return;
    this.container.setScrollPerc(100);
  }

  /**
   * Apply bottom-alignment offset to all blocks and handle auto-scroll.
   * Called after rebuildBlocks() and repositionBlocks().
   */
  private applyBottomAlignmentAndScroll(): void {
    const offset = this.getBottomAlignmentOffset();

    // Apply offset to all blocks if content is shorter than viewport
    if (offset > 0) {
      for (const rootId of this.rootIds) {
        this.applyOffsetToNodeTree(rootId, offset);
      }
    }

    // Auto-scroll to bottom if in follow mode
    if (this.followMode) {
      this.scrollToBottom();
    }
  }

  /**
   * Apply vertical offset to a node tree (for bottom alignment).
   */
  private applyOffsetToNodeTree(nodeId: string, offset: number): void {
    const block = this.blocks.get(nodeId);
    const node = this.getNode(nodeId);
    if (!block || !node) return;

    block.box.top = (block.box.top as number) + offset;

    if ("children" in node) {
      for (const childId of node.children) {
        this.applyOffsetToNodeTree(childId, offset);
      }
    }
  }

  /**
   * Handle user scroll event.
   * Disables follow mode if user scrolls away from bottom.
   */
  handleUserScroll(): void {
    if (!this.isAtBottom()) {
      this.followMode = false;
    } else {
      // User scrolled back to bottom, re-enable follow mode
      this.followMode = true;
    }
  }

  /**
   * Re-enable follow mode and scroll to bottom.
   * Called when user presses End/G to go to last block.
   */
  enableFollowMode(): void {
    this.followMode = true;
    this.scrollToBottom();
    this.renderCallback();
  }

  /**
   * Handle terminal resize.
   * Recalculates bottom alignment with new container dimensions.
   */
  handleResize(): void {
    this.repositionBlocks();
    this.renderCallback();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ExecutionTree Integration
  // ───────────────────────────────────────────────────────────────────────────

  /** Unsubscribe function for tree events */
  private treeUnsubscribe: (() => void) | null = null;

  /** Map tree node IDs to block node IDs */
  private treeNodeToBlockId = new Map<string, string>();

  /**
   * Subscribe to an ExecutionTree for automatic block updates.
   *
   * When subscribed, the BlockRenderer will automatically create and update
   * blocks based on tree events. This eliminates the need to manually call
   * addLLMCall(), addGadget(), etc.
   *
   * @param tree - The ExecutionTree to subscribe to
   * @returns Unsubscribe function to stop listening
   *
   * @example
   * ```typescript
   * const agent = builder.ask("Hello");
   * const unsubscribe = blockRenderer.subscribeToTree(agent.getTree());
   *
   * for await (const event of agent.run()) {
   *   // Blocks are automatically updated via tree subscription
   * }
   *
   * unsubscribe();
   * ```
   */
  subscribeToTree(tree: ExecutionTree): () => void {
    // Unsubscribe from previous tree if any
    if (this.treeUnsubscribe) {
      this.treeUnsubscribe();
    }

    this.treeNodeToBlockId.clear();

    // Subscribe to all events
    this.treeUnsubscribe = tree.onAll((event: ExecutionEvent) => {
      this.handleTreeEvent(event, tree);
    });

    return () => {
      if (this.treeUnsubscribe) {
        this.treeUnsubscribe();
        this.treeUnsubscribe = null;
      }
    };
  }

  /**
   * Handle an ExecutionTree event.
   */
  private handleTreeEvent(event: ExecutionEvent, tree: ExecutionTree): void {
    switch (event.type) {
      case "llm_call_start": {
        // Find parent block ID if this is a nested LLM call
        let parentBlockId: string | undefined;
        if (event.parentId) {
          parentBlockId = this.treeNodeToBlockId.get(event.parentId);
        }

        // Create the LLM call block
        // Note: event.iteration is 0-indexed, but display uses 1-indexed
        // The hook path already adds +1, so we do the same here for deduplication
        // Pass isNested=true when depth > 0 to prevent false deduplication
        // against top-level calls when parentBlockId lookup fails
        const blockId = this.addLLMCall(
          event.iteration + 1,
          event.model,
          parentBlockId,
          event.depth > 0,
        );
        this.treeNodeToBlockId.set(event.nodeId, blockId);

        // Attach raw request data from tree (needed for nested LLM calls)
        const startNode = tree.getNode(event.nodeId);
        if (startNode?.type === "llm_call" && startNode.request) {
          this.setLLMCallRequest(blockId, startNode.request);
        }
        break;
      }

      case "llm_call_complete": {
        const blockId = this.treeNodeToBlockId.get(event.nodeId);
        if (blockId) {
          this.completeLLMCall(blockId, {
            inputTokens: event.usage?.inputTokens,
            cachedInputTokens: event.usage?.cachedInputTokens,
            outputTokens: event.usage?.outputTokens,
            cost: event.cost,
            finishReason: event.finishReason ?? undefined,
          });

          // Attach raw response data from tree (needed for nested LLM calls)
          const completeNode = tree.getNode(event.nodeId);
          if (completeNode?.type === "llm_call" && completeNode.response) {
            this.setLLMCallResponse(blockId, completeNode.response);
          }
        }
        break;
      }

      case "gadget_call": {
        // Find parent LLM call block
        let parentBlockId: string | undefined;
        if (event.parentId) {
          parentBlockId = this.treeNodeToBlockId.get(event.parentId);
        }

        // Temporarily set current LLM call for proper parenting
        const previousLLMCallId = this.currentLLMCallId;
        if (parentBlockId) {
          this.setCurrentLLMCall(parentBlockId);
        }

        const blockId = this.addGadget(
          event.invocationId,
          event.name,
          event.parameters,
        );
        this.treeNodeToBlockId.set(event.nodeId, blockId);

        // Restore previous context
        this.currentLLMCallId = previousLLMCallId;
        break;
      }

      case "gadget_complete": {
        this.completeGadget(
          event.invocationId,
          event.result,
          undefined,
          event.executionTimeMs,
          event.cost,
        );
        break;
      }

      case "gadget_error": {
        this.completeGadget(
          event.invocationId,
          undefined,
          event.error,
          event.executionTimeMs,
        );
        break;
      }

      case "gadget_skipped": {
        // Find the gadget and mark it as skipped
        const node = this.findGadgetByInvocationId(event.invocationId);
        if (node) {
          node.isComplete = true;
          node.error = `Skipped: ${event.failedDependencyError}`;
          this.updateBlock(node.id);
        }
        break;
      }

      // text events are handled separately (not part of tree structure)
      // llm_call_stream and llm_call_error are informational
    }
  }

  /**
   * Get block ID for a tree node ID.
   * Useful for external code that needs to correlate tree nodes with blocks.
   */
  getBlockIdForTreeNode(treeNodeId: string): string | undefined {
    return this.treeNodeToBlockId.get(treeNodeId);
  }
}
