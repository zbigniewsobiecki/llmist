/**
 * TreeBridge - Manages ExecutionTree subscription and maps tree→block IDs.
 *
 * Extracted from BlockRenderer to separate tree integration from rendering.
 * Translates ExecutionTree events into block creation/completion calls.
 *
 * @module
 */

import type { ExecutionEvent, ExecutionTree } from "llmist";
import type { CompleteGadgetOptions } from "./node-store.js";
import type { LLMCallNode } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// TreeBridge Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Interface for creating and updating blocks from tree events.
 * BlockRenderer implements this interface so TreeBridge can call back into it.
 */
export interface TreeBridgeCallbacks {
  /** Reset thinking tracker (called before new LLM call) */
  onResetThinking: () => void;
  /** Set the current LLM call context for gadget parenting */
  onSetCurrentLLMCall: (llmCallId: string | null) => void;
  /** Clear idempotency maps before subscribing to a new tree */
  onClearIdempotencyMaps: () => void;
  /** Create an LLM call block */
  onAddLLMCall: (
    iteration: number,
    model: string,
    parentGadgetId?: string,
    isNested?: boolean,
  ) => string;
  /** Complete an LLM call block */
  onCompleteLLMCall: (id: string, details: LLMCallNode["details"], rawResponse?: string) => void;
  /** Store raw request messages for an LLM call */
  onSetLLMCallRequest: (id: string, messages: import("llmist").LLMMessage[]) => void;
  /** Store raw response for an LLM call */
  onSetLLMCallResponse: (id: string, rawResponse: string) => void;
  /** Complete the active thinking block */
  onCompleteThinking: () => void;
  /** Add thinking content */
  onAddThinking: (content: string, thinkingType: "thinking" | "redacted") => void;
  /** Create a gadget block */
  onAddGadget: (invocationId: string, name: string, parameters?: Record<string, unknown>) => string;
  /** Complete a gadget block */
  onCompleteGadget: (invocationId: string, options: CompleteGadgetOptions) => void;
  /** Mark a gadget as skipped */
  onSkipGadget: (invocationId: string, reason: string) => void;
  /** Get the current LLM call ID */
  onGetCurrentLLMCallId: () => string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TreeBridge Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages ExecutionTree subscription and translates tree events into
 * block creation/completion calls on BlockRenderer.
 *
 * Extracted from BlockRenderer to separate tree integration concerns.
 * Uses a callback interface to avoid direct coupling to BlockRenderer.
 */
export class TreeBridge {
  /** Unsubscribe function for tree events */
  private treeUnsubscribe: (() => void) | null = null;

  /** Map tree node IDs to block node IDs */
  private treeNodeToBlockId = new Map<string, string>();

  private callbacks: TreeBridgeCallbacks;

  constructor(callbacks: TreeBridgeCallbacks) {
    this.callbacks = callbacks;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Check if tree subscription is active.
   */
  isSubscribed(): boolean {
    return this.treeUnsubscribe !== null;
  }

  /**
   * Subscribe to an ExecutionTree for automatic block updates.
   *
   * When subscribed, the TreeBridge will automatically create and update
   * blocks based on tree events, calling the provided callbacks.
   *
   * @param tree - The ExecutionTree to subscribe to
   * @returns Unsubscribe function to stop listening
   *
   * @example
   * ```typescript
   * const agent = builder.ask("Hello");
   * const unsubscribe = treeBridge.subscribeToTree(agent.getTree());
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
    this.callbacks.onClearIdempotencyMaps();

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
   * Get block ID for a tree node ID.
   * Useful for external code that needs to correlate tree nodes with blocks.
   */
  getBlockIdForTreeNode(treeNodeId: string): string | undefined {
    return this.treeNodeToBlockId.get(treeNodeId);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Event Handling
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Handle an ExecutionTree event.
   */
  private handleTreeEvent(event: ExecutionEvent, tree: ExecutionTree): void {
    switch (event.type) {
      case "llm_call_start": {
        // Reset thinking tracker for new LLM call
        this.callbacks.onResetThinking();

        // Find parent block ID if this is a nested LLM call
        let parentBlockId: string | undefined;
        if (event.parentId) {
          parentBlockId = this.treeNodeToBlockId.get(event.parentId);
        }

        // Create the LLM call block
        // Note: event.iteration is 0-indexed, but display uses 1-indexed
        // Pass isNested=true when depth > 0 to differentiate nested calls
        // from root calls that happen to have the same iteration number
        const blockId = this.callbacks.onAddLLMCall(
          event.iteration + 1,
          event.model,
          parentBlockId,
          event.depth > 0,
        );
        this.treeNodeToBlockId.set(event.nodeId, blockId);

        // Attach raw request data from tree (needed for nested LLM calls)
        const startNode = tree.getNode(event.nodeId);
        if (startNode?.type === "llm_call" && startNode.request) {
          this.callbacks.onSetLLMCallRequest(blockId, startNode.request);
        }
        break;
      }

      case "llm_call_complete": {
        // Complete any active thinking block before completing the LLM call
        this.callbacks.onCompleteThinking();

        const blockId = this.treeNodeToBlockId.get(event.nodeId);
        if (blockId) {
          this.callbacks.onCompleteLLMCall(blockId, {
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
            this.callbacks.onSetLLMCallResponse(blockId, completeNode.response);
          }
        }
        break;
      }

      case "thinking": {
        this.callbacks.onAddThinking(event.content, event.thinkingType);
        break;
      }

      case "gadget_call": {
        // Find parent LLM call block
        let parentBlockId: string | undefined;
        if (event.parentId) {
          parentBlockId = this.treeNodeToBlockId.get(event.parentId);
        }

        // Temporarily set current LLM call for proper parenting
        const previousLLMCallId = this.callbacks.onGetCurrentLLMCallId();
        if (parentBlockId) {
          this.callbacks.onSetCurrentLLMCall(parentBlockId);
        }

        const blockId = this.callbacks.onAddGadget(
          event.invocationId,
          event.name,
          event.parameters,
        );
        this.treeNodeToBlockId.set(event.nodeId, blockId);

        // Restore previous context
        this.callbacks.onSetCurrentLLMCall(previousLLMCallId);
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
        this.callbacks.onCompleteGadget(event.invocationId, {
          result: event.result,
          executionTimeMs: event.executionTimeMs,
          cost: event.cost,
          mediaOutputs,
        });
        break;
      }

      case "gadget_error": {
        this.callbacks.onCompleteGadget(event.invocationId, {
          error: event.error,
          executionTimeMs: event.executionTimeMs,
        });
        break;
      }

      case "gadget_skipped": {
        this.callbacks.onSkipGadget(event.invocationId, `Skipped: ${event.failedDependencyError}`);
        break;
      }

      // text events are handled separately (not part of tree structure)
      // llm_call_stream and llm_call_error are informational
    }
  }
}
