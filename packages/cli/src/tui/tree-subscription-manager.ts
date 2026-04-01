import type { ExecutionTree } from "llmist";
import type { BlockRenderer } from "./block-renderer.js";
import type { StatusBar } from "./status-bar.js";

/**
 * Manages ExecutionTree subscriptions for TUI components.
 * Orchestrates combined unsubscriptions from BlockRenderer and StatusBar.
 */
export class TreeSubscriptionManager {
  private treeUnsubscribe: (() => void) | null = null;

  constructor(
    private blockRenderer: BlockRenderer,
    private statusBar: StatusBar,
  ) {}

  /**
   * Subscribe to an ExecutionTree for automatic updates.
   * Handles previous unsubscription and returns a combined unsubscribe function.
   */
  subscribe(tree: ExecutionTree): () => void {
    // Unsubscribe from previous tree
    this.unsubscribe();

    // Subscribe block renderer to tree (for block creation)
    const unsubBlock = this.blockRenderer.subscribeToTree(tree);

    // Subscribe status bar to tree (for activity tracking)
    const unsubStatus = this.statusBar.subscribeToTree(tree);

    // Combined unsubscribe
    this.treeUnsubscribe = () => {
      unsubBlock();
      unsubStatus();
    };

    return () => this.unsubscribe();
  }

  /**
   * Unsubscribe from the current tree if any.
   */
  unsubscribe(): void {
    if (this.treeUnsubscribe) {
      this.treeUnsubscribe();
      this.treeUnsubscribe = null;
    }
  }
}
