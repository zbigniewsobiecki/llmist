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
import type { ExecutionEvent, ExecutionTree } from "llmist";
import {
  formatGadgetCollapsed,
  formatGadgetExpanded,
  formatLLMCallCollapsed,
  formatLLMCallExpanded,
  getContinuationIndent,
  getIndent,
} from "../ui/block-formatters.js";
import { formatUserMessage, renderMarkdown } from "../ui/formatters.js";
import { NodeStore, type CompleteGadgetOptions } from "./node-store.js";
import type {
  BlockNode,
  ContentFilterMode,
  GadgetNode,
  LLMCallNode,
  SelectableBlock,
  SystemMessageNode,
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

  /** Rendered blocks with UI state */
  private blocks = new Map<string, SelectableBlock>();

  /** IDs of selectable blocks in display order */
  private selectableIds: string[] = [];

  /** Currently selected block index (-1 = none) */
  private selectedIndex = -1;

  /** Persisted expanded states (survives rebuildBlocks) */
  private expandedStates = new Map<string, boolean>();

  /** Whether to auto-scroll to bottom on new content ("follow mode") */
  private followMode: boolean = true;

  /** Content filter mode for block visibility */
  private contentFilterMode: ContentFilterMode = "full";

  /** Threshold in pixels for detecting "at bottom" position */
  private static readonly AT_BOTTOM_THRESHOLD = 5;

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
   * In tree mode, this is only used for attaching raw request/response data
   * to the block for the raw viewer feature. Parent-child relationships are
   * determined by event.parentId in handleTreeEvent(), not by this method.
   */
  getCurrentLLMCallId(): string | null {
    return this.nodeStore.currentLLMCallId;
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

    // Collect IDs of nodes from the previous session
    const nodesToRemove: string[] = [];
    for (const [id, node] of this.nodeStore.nodes.entries()) {
      if (node.sessionId === prevSessionId) {
        nodesToRemove.push(id);
      }
    }

    // Remove nodes and their widgets
    for (const id of nodesToRemove) {
      this.nodeStore.nodes.delete(id);
      const block = this.blocks.get(id);
      if (block?.box) {
        block.box.detach();
      }
      this.blocks.delete(id);
      this.expandedStates.delete(id);
    }

    // Update rootIds - filter out removed nodes
    this.nodeStore.rootIds = this.nodeStore.rootIds.filter((id) => !nodesToRemove.includes(id));

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
    // Clear existing blocks
    for (const child of [...this.container.children]) {
      child.detach();
    }
    // Clear any direct content on the container (e.g., from appendQuestionToBody)
    // This prevents stale content from persisting across mode switches
    this.container.setContent("");
    this.blocks.clear();
    this.selectableIds = [];

    // Track vertical position (starts at 0, will be offset for bottom-alignment)
    let top = 0;

    // Traverse tree in order
    for (const rootId of this.nodeStore.rootIds) {
      top = this.renderNodeTree(rootId, top);
    }

    // Restore selection if possible
    if (this.selectedIndex >= this.selectableIds.length) {
      this.selectedIndex = this.selectableIds.length - 1;
    }

    // Apply bottom alignment and auto-scroll (chat-like behavior)
    this.applyBottomAlignmentAndScroll();

    this.renderCallback();
    this.notifyHasContentChange();
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
    const node = this.getNode(nodeId);
    if (!node) return top;

    // Check if this node should be visible in current filter mode
    const visible = this.isNodeVisible(node);

    if (visible) {
      // In focused mode, TellUser renders as plain text (chat-like)
      const renderAsText = this.shouldRenderAsText(node);

      // Create block for this node
      const block = renderAsText
        ? this.createTextLikeBlock(node as GadgetNode, top)
        : this.createBlock(node, top);
      this.blocks.set(nodeId, block);

      // Track selectable blocks (only if visible and not rendered as text)
      if (block.selectable) {
        this.selectableIds.push(nodeId);
      }

      // Calculate height of this block
      const height = this.getBlockHeight(block);
      top += height;
    }

    // Always traverse children even if parent is hidden
    // This ensures nested TellUser/AskUser gadgets are found
    if ("children" in node && node.children.length > 0) {
      for (const childId of node.children) {
        top = this.renderNodeTree(childId, top);
      }
    }

    return top;
  }

  /**
   * Check if a gadget should render as plain text in focused mode.
   * TellUser, AskUser, and Finish render as text for a chat-like experience.
   */
  private shouldRenderAsText(node: BlockNode): boolean {
    if (this.contentFilterMode !== "focused") return false;
    if (node.type !== "gadget") return false;

    const name = (node as GadgetNode).name;
    return name === "TellUser" || name === "AskUser" || name === "Finish";
  }

  /**
   * Create a text-like block for TellUser/AskUser/Finish gadgets in focused mode.
   * Renders just the content without the gadget header.
   */
  private createTextLikeBlock(node: GadgetNode, top: number): SelectableBlock {
    // Extract message/question from gadget parameters
    let content = "";

    if (node.name === "TellUser") {
      const message = node.parameters?.message;
      if (typeof message === "string") {
        content = `\n${renderMarkdown(message)}\n`;
      }
    } else if (node.name === "AskUser") {
      const question = node.parameters?.question;
      if (typeof question === "string") {
        // Render question with a prompt indicator
        content = `\n? ${question}\n`;
      }
    } else if (node.name === "Finish") {
      const message = node.parameters?.message;
      if (typeof message === "string" && message.trim()) {
        // Render finish message with a completion indicator
        content = `\n\x1b[32m✓\x1b[0m ${renderMarkdown(message)}\n`;
      }
    }

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
  private formatBlockContent(node: BlockNode, selected: boolean, expanded: boolean): string {
    const indent = getIndent(node.depth);

    switch (node.type) {
      case "llm_call": {
        const collapsed = formatLLMCallCollapsed(node, selected);
        if (!expanded) {
          return indent + collapsed;
        }
        const expandedLines = formatLLMCallExpanded(node);
        const contIndent = getContinuationIndent(node.depth);
        return [indent + collapsed, ...expandedLines.map((line) => contIndent + line)].join("\n");
      }

      case "gadget": {
        const collapsed = formatGadgetCollapsed(node, selected);
        if (!expanded) {
          return indent + collapsed;
        }
        const expandedLines = formatGadgetExpanded(node);
        const contIndent = getContinuationIndent(node.depth);
        return [indent + collapsed, ...expandedLines.map((line) => contIndent + line)].join("\n");
      }

      case "text": {
        // User messages (id starts with "user_") are formatted specially
        // to show the user icon and avoid double markdown processing
        if (node.id.startsWith("user_")) {
          return formatUserMessage(node.content);
        }
        // Regular text content - abbreviate when collapsed, full when expanded
        const fullContent = renderMarkdown(node.content);
        if (expanded) {
          return `\n${fullContent}\n`;
        }
        return this.abbreviateToLines(fullContent, 2, selected);
      }

      case "thinking": {
        const DIM = "\x1b[2m";
        const RED_DIM = "\x1b[2;31m";
        const RESET = "\x1b[0m";
        const contIndent = getContinuationIndent(node.depth);

        if (node.thinkingType === "redacted") {
          // Redacted thinking - show locked indicator
          const header = `${indent}${RED_DIM}🔒 [Redacted thinking block]${RESET}`;
          return header;
        }

        if (!expanded) {
          // Collapsed: show icon + abbreviated first line
          const firstLine = node.content.split("\n")[0]?.slice(0, 60) ?? "";
          const suffix = node.isComplete ? "" : "...";
          return `${indent}${DIM}💭 Thinking${suffix} ${firstLine}${RESET}`;
        }

        // Expanded: show full thinking content in dim styling
        const tokenInfo = node.isComplete
          ? ` (${Math.ceil(node.content.length / 4)} tokens est.)`
          : "";
        const header = `${indent}${DIM}▼ 💭 Thinking${tokenInfo}${RESET}`;
        const contentLines = node.content
          .split("\n")
          .map((line) => `${contIndent}${DIM}${line}${RESET}`);
        return [header, ...contentLines].join("\n");
      }

      case "system_message": {
        const icon = this.getSystemMessageIcon(node.category);
        const color = this.getSystemMessageColor(node.category);
        const RESET = "\x1b[0m";
        return `${indent}${color}${icon} ${node.message}${RESET}`;
      }
    }
  }

  /**
   * Get icon for system message category.
   */
  private getSystemMessageIcon(category: SystemMessageNode["category"]): string {
    switch (category) {
      case "throttle":
        return "⏸";
      case "retry":
        return "🔄";
      case "info":
        return "ℹ️";
      case "warning":
        return "⚠️";
      case "error":
        return "❌";
    }
  }

  /**
   * Get ANSI color code for system message category.
   */
  private getSystemMessageColor(category: SystemMessageNode["category"]): string {
    const YELLOW = "\x1b[33m";
    const BLUE = "\x1b[34m";
    const GRAY = "\x1b[90m";
    const RED = "\x1b[31m";

    switch (category) {
      case "throttle":
        return YELLOW;
      case "retry":
        return BLUE;
      case "info":
        return GRAY;
      case "warning":
        return YELLOW;
      case "error":
        return RED;
    }
  }

  /**
   * Abbreviate text content to a maximum number of lines.
   * Shows truncation indicator if content exceeds limit.
   *
   * @param text - The text to abbreviate
   * @param maxLines - Maximum number of lines to show
   * @param selected - Whether this block is selected (for indicator styling)
   * @returns Abbreviated text with truncation indicator if needed
   */
  private abbreviateToLines(text: string, maxLines: number, selected: boolean): string {
    // Split text into lines, filtering out empty lines at start
    const lines = text.split("\n");

    // Find first non-empty line
    let startIndex = 0;
    while (startIndex < lines.length && lines[startIndex].trim() === "") {
      startIndex++;
    }

    // Get content lines (skip leading empty lines)
    const contentLines = lines.slice(startIndex);

    if (contentLines.length <= maxLines) {
      // Content fits, return with leading newline for visual separation
      return `\n${contentLines.join("\n")}`;
    }

    // Need to truncate - take first maxLines and add indicator
    const truncatedLines = contentLines.slice(0, maxLines);
    const indicator = selected ? "▶ ..." : "  ...";

    return `\n${truncatedLines.join("\n")}\n${indicator}`;
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
    for (const rootId of this.nodeStore.rootIds) {
      top = this.repositionNodeTree(rootId, top);
    }

    // Re-apply bottom alignment after repositioning
    this.applyBottomAlignmentAndScroll();
  }

  private repositionNodeTree(nodeId: string, top: number): number {
    const node = this.getNode(nodeId);
    if (!node) return top;

    // Only reposition if node has a block (visible nodes)
    const block = this.blocks.get(nodeId);
    if (block) {
      block.box.top = top;
      const height = this.getBlockHeight(block);
      top += height;
    }

    // Always traverse children even if parent is hidden
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
    for (const rootId of this.nodeStore.rootIds) {
      totalHeight = this.sumNodeTreeHeight(rootId, totalHeight);
    }
    return totalHeight;
  }

  private sumNodeTreeHeight(nodeId: string, currentHeight: number): number {
    const node = this.getNode(nodeId);
    if (!node) return currentHeight;

    // Only count height for visible nodes (those with blocks)
    const block = this.blocks.get(nodeId);
    if (block) {
      currentHeight += this.getBlockHeight(block);
    }

    // Always traverse children even if parent is hidden
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
      for (const rootId of this.nodeStore.rootIds) {
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
    const node = this.getNode(nodeId);
    if (!node) return;

    // Only apply offset to visible nodes (those with blocks)
    const block = this.blocks.get(nodeId);
    if (block) {
      block.box.top = (block.box.top as number) + offset;
    }

    // Always traverse children even if parent is hidden
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
    this.followMode = true;
    // Rebuild blocks with immediate render to ensure screen is properly cleared
    // This prevents visual artifacts from the previous mode persisting
    this.rebuildBlocksImmediate();
  }

  /**
   * Rebuild all blocks and render immediately.
   * Used for mode switches where we need to ensure the screen is fully cleared.
   */
  private rebuildBlocksImmediate(): void {
    // Clear existing blocks
    for (const child of [...this.container.children]) {
      child.detach();
    }
    // Clear any direct content on the container
    this.container.setContent("");
    this.blocks.clear();
    this.selectableIds = [];

    // Force immediate render to clear old visual artifacts BEFORE creating new blocks
    // This is critical for mode switches to prevent content overlay
    this.renderNowCallback();

    // Track vertical position (starts at 0, will be offset for bottom-alignment)
    let top = 0;

    // Traverse tree in order
    for (const rootId of this.nodeStore.rootIds) {
      top = this.renderNodeTree(rootId, top);
    }

    // Restore selection if possible
    if (this.selectedIndex >= this.selectableIds.length) {
      this.selectedIndex = this.selectableIds.length - 1;
    }

    // Apply bottom alignment and auto-scroll (chat-like behavior)
    this.applyBottomAlignmentAndScroll();

    // Render again with new content
    this.renderNowCallback();
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
   * In focused mode:
   * - Text nodes are always visible
   * - LLM call blocks are hidden
   * - Gadget blocks are hidden EXCEPT TellUser and AskUser
   *   (Finish is hidden - status bar indicates completion)
   */
  private isNodeVisible(node: BlockNode): boolean {
    if (this.contentFilterMode === "full") {
      return true;
    }

    // Focused mode filtering
    switch (node.type) {
      case "text":
        // Text is always visible
        return true;
      case "llm_call":
        // LLM calls are hidden in focused mode
        return false;
      case "thinking":
        // Thinking is hidden in focused mode
        return false;
      case "gadget": {
        // Keep user-facing gadgets visible in focused mode
        const name = (node as GadgetNode).name;
        return name === "TellUser" || name === "AskUser" || name === "Finish";
      }
      default:
        return false;
    }
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

    // Clear all mappings for a fresh start with the new tree
    this.treeNodeToBlockId.clear();
    this.nodeStore.clearIdempotencyMaps();

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
        // Reset thinking tracker for new LLM call
        this.nodeStore.currentThinkingId = null;

        // Find parent block ID if this is a nested LLM call
        let parentBlockId: string | undefined;
        if (event.parentId) {
          parentBlockId = this.treeNodeToBlockId.get(event.parentId);
        }

        // Create the LLM call block
        // Note: event.iteration is 0-indexed, but display uses 1-indexed
        // Pass isNested=true when depth > 0 to differentiate nested calls
        // from root calls that happen to have the same iteration number
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
        // Complete any active thinking block before completing the LLM call
        this.completeThinking();

        const blockId = this.treeNodeToBlockId.get(event.nodeId);
        if (blockId) {
          this.completeLLMCall(blockId, {
            inputTokens: event.usage?.inputTokens,
            cachedInputTokens: event.usage?.cachedInputTokens,
            outputTokens: event.usage?.outputTokens,
            reasoningTokens: event.usage?.reasoningTokens,
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

      case "thinking": {
        this.addThinking(event.content, event.thinkingType);
        break;
      }

      case "gadget_call": {
        // Find parent LLM call block
        let parentBlockId: string | undefined;
        if (event.parentId) {
          parentBlockId = this.treeNodeToBlockId.get(event.parentId);
        }

        // Temporarily set current LLM call for proper parenting
        const previousLLMCallId = this.nodeStore.currentLLMCallId;
        if (parentBlockId) {
          this.setCurrentLLMCall(parentBlockId);
        }

        const blockId = this.addGadget(event.invocationId, event.name, event.parameters);
        this.treeNodeToBlockId.set(event.nodeId, blockId);

        // Restore previous context
        this.nodeStore.currentLLMCallId = previousLLMCallId;
        break;
      }

      case "gadget_complete": {
        // Convert storedMedia to mediaOutputs format for the TUI
        const mediaOutputs = event.storedMedia?.map((m) => ({
          kind: m.kind,
          path: m.path,
          mimeType: m.mimeType,
          description: m.description,
        }));
        this.completeGadget(event.invocationId, {
          result: event.result,
          executionTimeMs: event.executionTimeMs,
          cost: event.cost,
          mediaOutputs,
        });
        break;
      }

      case "gadget_error": {
        this.completeGadget(event.invocationId, {
          error: event.error,
          executionTimeMs: event.executionTimeMs,
        });
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
