/**
 * ScrollManager - Manages scroll position, follow mode, and bottom alignment.
 *
 * Extracted from BlockRenderer to separate scroll/layout concerns from
 * node management and rendering. Operates on a ScrollableBox container
 * and a block/node accessor interface.
 *
 * @module
 */

import type { ScrollableBox } from "@unblessed/node";
import type { BlockNode, SelectableBlock } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// ScrollManager Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Accessors the ScrollManager needs from BlockRenderer to perform calculations.
 */
export interface ScrollManagerAccessors {
  /** Get the list of root node IDs */
  getRootIds: () => string[];
  /** Get a node by ID */
  getNode: (id: string) => BlockNode | undefined;
  /** Get a rendered block by node ID */
  getBlock: (id: string) => SelectableBlock | undefined;
  /** Get the currently selected block */
  getSelectedBlock: () => SelectableBlock | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// ScrollManager Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages scroll position, follow mode, and bottom-alignment for the TUI.
 *
 * Provides chat-like scrolling behavior:
 * - Content is pushed to the bottom when it doesn't fill the viewport
 * - Auto-scrolls to new content when follow mode is active
 * - Disables follow mode when user scrolls up
 * - Re-enables follow mode when user scrolls back to the bottom
 */
export class ScrollManager {
  private container: ScrollableBox;
  private accessors: ScrollManagerAccessors;

  /** Whether to auto-scroll to bottom on new content ("follow mode") */
  private followMode = true;

  /** Threshold in pixels for detecting "at bottom" position */
  static readonly AT_BOTTOM_THRESHOLD = 5;

  constructor(container: ScrollableBox, accessors: ScrollManagerAccessors) {
    this.container = container;
    this.accessors = accessors;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Handle user scroll event.
   * Disables follow mode if user scrolls away from bottom.
   */
  handleUserScroll(): void {
    if (!this.isAtBottom()) {
      this.followMode = false;
    } else {
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
  }

  /**
   * Get current follow mode state.
   */
  isFollowMode(): boolean {
    return this.followMode;
  }

  /**
   * Set follow mode directly (e.g., when switching content filter modes).
   */
  setFollowMode(value: boolean): void {
    this.followMode = value;
  }

  /**
   * Handle terminal resize.
   * Recalculates bottom alignment with new container dimensions.
   * The actual repositioning is done by BlockRenderer; this just returns
   * whether scrolling should happen.
   */
  handleResize(): void {
    // Repositioning is handled by BlockRenderer calling repositionBlocks().
    // ScrollManager's role on resize is just to re-apply bottom alignment
    // via applyBottomAlignmentAndScroll() which BlockRenderer calls.
  }

  /**
   * Scroll container to keep selected block visible.
   */
  scrollToSelection(): void {
    const block = this.accessors.getSelectedBlock();
    if (!block) return;

    if (!this.container.getScroll || !this.container.scrollTo) return;

    const blockTop = block.box.top as number;
    const blockHeight = getBlockHeight(block);
    const containerHeight = this.container.height as number;
    const scrollPos = this.container.getScroll();

    // If block is above visible area, scroll up
    if (blockTop < scrollPos) {
      this.container.scrollTo(blockTop);
      this.followMode = false;
    }
    // If block is below visible area, scroll down
    else if (blockTop + blockHeight > scrollPos + containerHeight) {
      this.container.scrollTo(blockTop + blockHeight - containerHeight);
      if (this.isAtBottom()) {
        this.followMode = true;
      }
    }
  }

  /**
   * Apply bottom-alignment offset to all blocks and handle auto-scroll.
   * Called after rebuildBlocks() and repositionBlocks().
   *
   * @param applyOffset - Callback to apply vertical offset to each root tree
   */
  applyBottomAlignmentAndScroll(applyOffset: (rootId: string, offset: number) => void): void {
    const offset = this.getBottomAlignmentOffset();

    if (offset > 0) {
      for (const rootId of this.accessors.getRootIds()) {
        applyOffset(rootId, offset);
      }
    }

    if (this.followMode) {
      this.scrollToBottom();
    }
  }

  /**
   * Reposition all blocks after a height change.
   *
   * @param repositionTree - Callback to reposition a node tree starting at a given top
   * @returns Final top position after repositioning
   */
  repositionBlocks(repositionTree: (rootId: string, top: number) => number): void {
    let top = 0;
    for (const rootId of this.accessors.getRootIds()) {
      top = repositionTree(rootId, top);
    }
    this.applyBottomAlignmentAndScroll((rootId, offset) => {
      this.applyOffsetToNodeTree(rootId, offset);
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Check if scroll position is at or near the bottom.
   */
  private isAtBottom(): boolean {
    if (!this.container.getScroll) return true;

    const scrollPos = this.container.getScroll();
    const containerHeight = this.container.height as number;
    const contentHeight = this.getTotalContentHeight();

    const maxScroll = Math.max(0, contentHeight - containerHeight);
    return scrollPos >= maxScroll - ScrollManager.AT_BOTTOM_THRESHOLD;
  }

  /**
   * Scroll to the bottom of content.
   */
  private scrollToBottom(): void {
    if (!this.container.setScrollPerc) return;
    this.container.setScrollPerc(100);
  }

  /**
   * Calculate total height of all rendered blocks.
   */
  private getTotalContentHeight(): number {
    let totalHeight = 0;
    for (const rootId of this.accessors.getRootIds()) {
      totalHeight = this.sumNodeTreeHeight(rootId, totalHeight);
    }
    return totalHeight;
  }

  private sumNodeTreeHeight(nodeId: string, currentHeight: number): number {
    const node = this.accessors.getNode(nodeId);
    if (!node) return currentHeight;

    const block = this.accessors.getBlock(nodeId);
    if (block) {
      currentHeight += getBlockHeight(block);
    }

    if ("children" in node) {
      for (const childId of (node as { children: string[] }).children) {
        currentHeight = this.sumNodeTreeHeight(childId, currentHeight);
      }
    }
    return currentHeight;
  }

  /**
   * Calculate vertical offset to push content to bottom when content < viewport.
   */
  private getBottomAlignmentOffset(): number {
    const containerHeight = this.container.height as number;
    const contentHeight = this.getTotalContentHeight();

    if (contentHeight >= containerHeight) {
      return 0;
    }

    return containerHeight - contentHeight;
  }

  /**
   * Apply vertical offset to a node tree (for bottom alignment).
   */
  private applyOffsetToNodeTree(nodeId: string, offset: number): void {
    const node = this.accessors.getNode(nodeId);
    if (!node) return;

    const block = this.accessors.getBlock(nodeId);
    if (block) {
      block.box.top = (block.box.top as number) + offset;
    }

    if ("children" in node) {
      for (const childId of (node as { children: string[] }).children) {
        this.applyOffsetToNodeTree(childId, offset);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the height (in lines) of a rendered block.
 */
export function getBlockHeight(block: SelectableBlock): number {
  const content = block.box.getContent();
  return content.split("\n").length;
}
