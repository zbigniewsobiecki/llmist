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
import type { ExecutionTree } from "llmist";
import {
  formatBlockContent,
  formatGadgetAsText,
  isNodeVisibleInFilterMode,
  shouldRenderAsText,
} from "./block-content-formatter.js";
import { type CompleteGadgetOptions, NodeStore } from "./node-store.js";
import { getBlockHeight, ScrollManager } from "./scroll-manager.js";
import { TreeBridge } from "./tree-bridge.js";
import { traverseNodeTree } from "./tree-layout.js";
import type {
  BlockNode,
  ContentFilterMode,
  GadgetNode,
  LLMCallNode,
  SelectableBlock,
} from "./types.js";

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
  private renderNowCallback: () => void;

  /** Node store — manages all node CRUD, idempotency, and session tracking */
  private nodeStore: NodeStore;

  /** Scroll manager — manages scroll position, follow mode, and bottom alignment */
  private scrollManager: ScrollManager;

  /** Tree bridge — manages ExecutionTree subscriptions and tree→block mapping */
  private treeBridge: TreeBridge;

  /** Rendered blocks with UI state */
  private blocks = new Map<string, SelectableBlock>();

  /** IDs of selectable blocks in display order */
  private selectableIds: string[] = [];

  /** Currently selected block index (-1 = none) */
  private selectedIndex = -1;

  /** Persisted expanded states (survives rebuildBlocks) */
  private expandedStates = new Map<string, boolean>();

  /** Content filter mode for block visibility */
  private contentFilterMode: ContentFilterMode = "full";

  /** Callback for content state changes (empty to non-empty or vice versa) */
  private onHasContentChangeCallback: ((hasContent: boolean) => void) | null = null;

  /** Last reported hasContent state (to avoid duplicate callbacks) */
  private lastHasContentState = false;

  constructor(
    container: ScrollableBox,
    renderCallback: () => void,
    renderNowCallback?: () => void,
  ) {
    this.container = container;
    this.renderCallback = renderCallback;
    this.renderNowCallback = renderNowCallback ?? renderCallback;

    // Create NodeStore and wire callbacks
    this.nodeStore = new NodeStore();
    this.nodeStore.setCallbacks({
      onNodeAdded: () => this.rebuildBlocks(),
      onNodeUpdated: (nodeId: string) => this.updateBlock(nodeId),
    });

    // Create ScrollManager with accessor interface (implements ScrollManagerAccessors)
    this.scrollManager = new ScrollManager(container, {
      getRootIds: () => this.nodeStore.rootIds,
      getNode: (id: string) => this.nodeStore.getNode(id),
      getBlock: (id: string) => this.blocks.get(id),
      getSelectedBlock: () => this.getSelectedBlock(),
    });

    this.treeBridge = new TreeBridge({
      onResetThinking: () => this.nodeStore.resetCurrentThinking(),
      onSetCurrentLLMCall: (llmCallId) => this.setCurrentLLMCall(llmCallId),
      onClearIdempotencyMaps: () => this.nodeStore.clearIdempotencyMaps(),
      onAddLLMCall: (iteration, model, parentGadgetId, isNested) =>
        this.addLLMCall(iteration, model, parentGadgetId, isNested),
      onCompleteLLMCall: (id, details, rawResponse) =>
        this.completeLLMCall(id, details, rawResponse),
      onSetLLMCallRequest: (id, messages) => this.setLLMCallRequest(id, messages),
      onSetLLMCallResponse: (id, rawResponse) => this.setLLMCallResponse(id, rawResponse),
      onCompleteThinking: () => this.completeThinking(),
      onAddThinking: (content, thinkingType) => this.addThinking(content, thinkingType),
      onAddGadget: (invocationId, name, parameters) =>
        this.addGadget(invocationId, name, parameters),
      onCompleteGadget: (invocationId, options) => this.completeGadget(invocationId, options),
      onSkipGadget: (invocationId, reason) => this.skipGadget(invocationId, reason),
      onGetCurrentLLMCallId: () => this.getCurrentLLMCallId(),
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API - Node Management
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Add an LLM call node (top-level or nested in gadget).
   * Idempotent - returns existing block if already created for this iteration.
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
    return this.nodeStore.addLLMCall(iteration, model, parentGadgetId, isNested);
  }

  /**
   * Complete an LLM call with details and optional raw response.
   */
  completeLLMCall(id: string, details: LLMCallNode["details"], rawResponse?: string): void {
    this.nodeStore.completeLLMCall(id, details, rawResponse);
  }

  /**
   * Store raw request messages for an LLM call.
   * Called when the LLM call is ready (after controller modifications).
   */
  setLLMCallRequest(id: string, messages: import("llmist").LLMMessage[]): void {
    this.nodeStore.setLLMCallRequest(id, messages);
  }

  /**
   * Add a gadget node as a child of the current LLM call.
   *
   * Gadgets are nested under the LLM call that spawned them.
   * They appear indented and are visible when the parent is rendered.
   */
  addGadget(invocationId: string, name: string, parameters?: Record<string, unknown>): string {
    return this.nodeStore.addGadget(invocationId, name, parameters);
  }

  /**
   * Complete a gadget with result.
   */
  completeGadget(invocationId: string, options: CompleteGadgetOptions = {}): void {
    this.nodeStore.completeGadget(invocationId, options);
  }

  /**
   * Mark a gadget as skipped with a rendered reason.
   */
  skipGadget(invocationId: string, reason: string): void {
    this.nodeStore.completeGadget(invocationId, { error: reason });
  }

  /**
   * Add a text node (flows between LLM calls).
   */
  addText(content: string): string {
    return this.nodeStore.addText(content);
  }

  /**
   * Add a system message block (for rate limiting, retry notifications, etc.).
   *
   * Displays immediately with an icon and color based on category.
   * Non-selectable like text blocks.
   *
   * @param message - The system message text
   * @param category - Message category for styling
   * @returns The block ID
   */
  addSystemMessage(
    message: string,
    category: "throttle" | "retry" | "info" | "warning" | "error",
  ): string {
    return this.nodeStore.addSystemMessage(message, category);
  }

  /**
   * Add thinking content from a reasoning model.
   * Creates a new thinking block on first chunk, appends to existing on subsequent chunks.
   * The block lives as a child of the current LLM call.
   *
   * @param content - Thinking text chunk
   * @param thinkingType - Whether this is actual thinking or redacted content
   */
  addThinking(content: string, thinkingType: "thinking" | "redacted"): void {
    this.nodeStore.addThinking(content, thinkingType);
  }

  /**
   * Complete the current thinking block.
   * Called when the LLM call finishes to mark thinking as complete.
   */
  completeThinking(): void {
    this.nodeStore.completeThinking();
  }

  /**
   * Add a user message block (for REPL mid-session input).
   *
   * Displays immediately with a distinct icon (👤) to differentiate
   * from LLM responses. Non-selectable like other text blocks.
   *
   * @param message - The user's input message
   * @returns The block ID
   */
  addUserMessage(message: string): string {
    return this.nodeStore.addUserMessage(message);
  }

  /**
   * Find a gadget node by its invocation ID.
   * Uses O(1) Map lookup instead of linear search.
   */
  findGadgetByInvocationId(invocationId: string): GadgetNode | undefined {
    return this.nodeStore.findGadgetByInvocationId(invocationId);
  }

  /**
   * Set the current LLM call context for gadget parenting.
   * Used when processing subagent events to ensure gadgets are nested
   * under the correct subagent LLM call.
   */
  setCurrentLLMCall(llmCallId: string | null): void {
    this.nodeStore.currentLLMCallId = llmCallId;
  }

  /**
   * Get the current LLM call ID.
   *
   * In tree mode, TreeBridge uses this to restore the current parent context
   * while translating gadget events into renderer updates.
   */
  getCurrentLLMCallId(): string | null {
    return this.nodeStore.currentLLMCallId;
  }

  /**
   * Check if tree subscription is active.
   * When active, external code should skip block creation (tree handles it).
   */
  isTreeSubscribed(): boolean {
    return this.treeBridge.isSubscribed();
  }

  /**
   * Store raw response for an LLM call (enrichment only).
   * Use this when tree handles completion but hooks have raw data.
   */
  setLLMCallResponse(id: string, rawResponse: string): void {
    this.nodeStore.setLLMCallResponse(id, rawResponse);
  }

  /**
   * Clear all blocks.
   */
  clear(): void {
    this.nodeStore.clear();
    this.blocks.clear();
    this.expandedStates.clear();
    this.selectableIds = [];
    this.selectedIndex = -1;

    // Clear container children
    for (const child of [...this.container.children]) {
      child.detach();
    }
    this.renderCallback();
    this.notifyHasContentChange();
  }

  /**
   * Set callback for content state changes.
   * Called when blocks transition from empty to non-empty or vice versa.
   * Used by HintsBar to know when "^B browse" hint should be shown.
   */
  onHasContentChange(callback: (hasContent: boolean) => void): void {
    this.onHasContentChangeCallback = callback;
    // Notify immediately with current state
    callback(this.blocks.size > 0);
  }

  /**
   * Start a new session. Called at the start of each REPL turn.
   * Increments the session counter so new blocks get the new sessionId.
   */
  startNewSession(): void {
    this.nodeStore.startNewSession();
  }

  /**
   * Clear blocks from the previous session only.
   * Called when the current session finishes, keeping its content visible.
   * The previous session's content was kept visible during this session for context.
   */
  clearPreviousSession(): void {
    const prevSessionId = this.nodeStore.getPreviousSessionId();
    if (prevSessionId === null) return;

    // Delegate node removal (including rootIds + idempotency map cleanup) to NodeStore
    const nodesToRemove = this.nodeStore.removeSessionNodes(prevSessionId);

    // Clean up BlockRenderer-owned UI state for removed nodes
    for (const id of nodesToRemove) {
      const block = this.blocks.get(id);
      if (block?.box) {
        block.box.detach();
      }
      this.blocks.delete(id);
      this.expandedStates.delete(id);
    }

    // Update selectableIds - filter out removed nodes
    this.selectableIds = this.selectableIds.filter((id) => !nodesToRemove.includes(id));

    // Adjust selection if needed
    if (this.selectedIndex >= this.selectableIds.length) {
      this.selectedIndex = this.selectableIds.length - 1;
    }

    // Clear the previous session marker
    this.nodeStore.clearPreviousSessionId();

    this.renderCallback();
    this.notifyHasContentChange();
  }

  /**
   * Get the current session ID (for node creation).
   */
  getCurrentSessionId(): number {
    return this.nodeStore.getCurrentSessionId();
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

  /**
   * Notify callback if content state has changed.
   * Only fires when transitioning from empty to non-empty or vice versa.
   */
  private notifyHasContentChange(): void {
    const hasContent = this.blocks.size > 0;
    if (hasContent !== this.lastHasContentState) {
      this.lastHasContentState = hasContent;
      this.onHasContentChangeCallback?.(hasContent);
    }
  }

  private getNode(id: string): BlockNode | undefined {
    return this.nodeStore.getNode(id);
  }

  /**
   * Rebuild all blocks from the node tree.
   * Called when nodes are added/removed.
   */
  private rebuildBlocks(): void {
    this.rebuildBlocksCore(false);
  }

  /**
   * Render a node and its children recursively.
   * Returns the next available top position.
   *
   * In focused mode, hidden nodes (LLM calls, most gadgets) are skipped
   * but their children are still traversed to find visible nested content
   * like TellUser gadgets within subagents.
   *
   * TellUser gadgets render as plain text in focused mode
   * (no headers, just content) for a clean chat-like experience.
   */
  private renderNodeTree(nodeId: string, top: number): number {
    return traverseNodeTree(
      nodeId,
      (id) => this.getNode(id),
      (currentNodeId, node, currentTop) => {
        if (!this.isNodeVisible(node)) {
          return currentTop;
        }

        const block = shouldRenderAsText(node, this.contentFilterMode)
          ? this.createTextLikeBlock(node as GadgetNode, currentTop)
          : this.createBlock(node, currentTop);
        this.blocks.set(currentNodeId, block);

        if (block.selectable) {
          this.selectableIds.push(currentNodeId);
        }

        return currentTop + getBlockHeight(block);
      },
      top,
    );
  }

  /**
   * Create a text-like block for TellUser/AskUser/Finish gadgets in focused mode.
   * Renders just the content without the gadget header.
   */
  private createTextLikeBlock(node: GadgetNode, top: number): SelectableBlock {
    const content = formatGadgetAsText(node);

    // Create Box widget (non-selectable, like text blocks)
    const box = new Box({
      parent: this.container,
      top,
      left: 0,
      width: "100%",
      height: content.split("\n").length,
      content,
      tags: false,
    });

    return {
      node,
      box,
      expanded: false,
      selectable: false, // Not selectable in focused mode
    };
  }

  /**
   * Create a block for a node.
   */
  private createBlock(node: BlockNode, top: number): SelectableBlock {
    const isSelected = this.selectableIds.length === this.selectedIndex;
    // User messages are not selectable, but regular text blocks are
    // (so they can be expanded from abbreviated view)
    const selectable = node.type !== "text" || !node.id.startsWith("user_");

    // Get persisted expanded state (survives rebuildBlocks), default to collapsed
    const expanded = this.expandedStates.get(node.id) ?? false;

    // Format content
    const content = formatBlockContent(node, isSelected, expanded);

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
   * Update a single block (after state change).
   */
  private updateBlock(nodeId: string): void {
    const block = this.blocks.get(nodeId);
    const node = this.getNode(nodeId);
    if (!block || !node) return;

    const isSelected = this.selectableIds[this.selectedIndex] === nodeId;
    const content = formatBlockContent(node, isSelected, block.expanded);

    const oldHeight = getBlockHeight(block);
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
        const content = formatBlockContent(block.node, isSelected, block.expanded);
        block.box.setContent(content);
      }
    }

    // Scroll to keep selection visible
    this.scrollToSelection();
    this.renderCallback();
  }

  /**
   * Reposition all blocks after height change.
   * Delegates positioning logic to ScrollManager.
   */
  private repositionBlocks(): void {
    this.scrollManager.repositionBlocks((rootId, top) => this.repositionNodeTree(rootId, top));
  }

  private repositionNodeTree(nodeId: string, top: number): number {
    return traverseNodeTree(
      nodeId,
      (id) => this.getNode(id),
      (currentNodeId, _node, currentTop) => {
        const block = this.blocks.get(currentNodeId);
        if (!block) {
          return currentTop;
        }

        block.box.top = currentTop;
        return currentTop + getBlockHeight(block);
      },
      top,
    );
  }

  /**
   * Scroll container to keep selected block visible.
   * Delegates to ScrollManager.
   */
  private scrollToSelection(): void {
    this.scrollManager.scrollToSelection();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Bottom Alignment & Auto-Scroll (Chat-like behavior) — delegated to ScrollManager
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Apply bottom-alignment offset to all blocks and handle auto-scroll.
   * Delegates to ScrollManager.
   * Called after rebuildBlocks() and repositionBlocks().
   */
  private applyBottomAlignmentAndScroll(): void {
    this.scrollManager.applyBottomAlignmentAndScroll();
  }

  /**
   * Handle user scroll event.
   * Disables follow mode if user scrolls away from bottom.
   * Delegates to ScrollManager.
   */
  handleUserScroll(): void {
    this.scrollManager.handleUserScroll();
  }

  /**
   * Re-enable follow mode and scroll to bottom.
   * Called when user presses End/G to go to last block.
   * Delegates to ScrollManager.
   */
  enableFollowMode(): void {
    this.scrollManager.enableFollowMode();
    this.renderCallback();
  }

  /**
   * Handle terminal resize.
   * Recalculates bottom alignment with new container dimensions.
   * Delegates repositioning and scroll state to ScrollManager.
   */
  handleResize(): void {
    this.repositionBlocks();
    this.renderCallback();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Content Filter Mode (Focused Mode)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Set content filter mode (full or focused).
   * In focused mode, only text and user-facing gadgets are visible.
   */
  setContentFilterMode(mode: ContentFilterMode): void {
    if (this.contentFilterMode === mode) return;
    this.contentFilterMode = mode;
    // Clear selection when switching to focused mode (nothing selectable)
    if (mode === "focused") {
      this.selectedIndex = -1;
    }
    // Reset follow mode to ensure scroll position is corrected for new content height
    // Without this, old scroll position may exceed new content, causing blank screen
    this.scrollManager.setFollowMode(true);
    // Rebuild blocks with immediate render to ensure screen is properly cleared
    // This prevents visual artifacts from the previous mode persisting
    this.rebuildBlocksImmediate();
  }

  /**
   * Rebuild all blocks and render immediately.
   * Used for mode switches where we need to ensure the screen is fully cleared.
   */
  private rebuildBlocksImmediate(): void {
    this.rebuildBlocksCore(true);
  }

  /**
   * Shared implementation for rebuildBlocks and rebuildBlocksImmediate.
   *
   * @param immediate - When true, forces a synchronous render pass before
   *   and after building blocks to clear visual artifacts (used on mode switch).
   *   When false, defers a single render to the end via renderCallback.
   */
  private rebuildBlocksCore(immediate: boolean): void {
    // Clear existing blocks
    for (const child of [...this.container.children]) {
      child.detach();
    }
    // Clear any direct content on the container (e.g., from appendQuestionToBody)
    // This prevents stale content from persisting across mode switches
    this.container.setContent("");
    this.blocks.clear();
    this.selectableIds = [];

    if (immediate) {
      // Force immediate render to clear old visual artifacts BEFORE creating new blocks
      // This is critical for mode switches to prevent content overlay
      this.renderNowCallback();
    }

    let top = 0;
    for (const rootId of this.nodeStore.rootIds) {
      top = this.renderNodeTree(rootId, top);
    }

    // Restore selection if possible
    if (this.selectedIndex >= this.selectableIds.length) {
      this.selectedIndex = this.selectableIds.length - 1;
    }

    // Apply bottom alignment and auto-scroll (chat-like behavior)
    this.applyBottomAlignmentAndScroll();

    if (immediate) {
      // Render again with new content
      this.renderNowCallback();
    } else {
      this.renderCallback();
    }
    this.notifyHasContentChange();
  }

  /**
   * Get the current content filter mode.
   */
  getContentFilterMode(): ContentFilterMode {
    return this.contentFilterMode;
  }

  /**
   * Check if a node should be visible in the current content filter mode.
   *
   * In focused mode, only text and user-facing gadgets remain visible.
   * TellUser, AskUser, and Finish render as plain text for a chat-like view.
   */
  private isNodeVisible(node: BlockNode): boolean {
    return isNodeVisibleInFilterMode(node, this.contentFilterMode);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ExecutionTree Integration
  // ───────────────────────────────────────────────────────────────────────────

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
    return this.treeBridge.subscribeToTree(tree);
  }

  /**
   * Get block ID for a tree node ID.
   * Useful for external code that needs to correlate tree nodes with blocks.
   */
  getBlockIdForTreeNode(treeNodeId: string): string | undefined {
    return this.treeBridge.getBlockIdForTreeNode(treeNodeId);
  }
}
