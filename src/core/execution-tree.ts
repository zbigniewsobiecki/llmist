/**
 * First-class Execution Tree model for nested subagent support.
 *
 * The ExecutionTree is THE single source of truth for execution state.
 * All nodes (including nested subagent nodes) live in one tree.
 * Events are projections of tree changes.
 *
 * @module core/execution-tree
 */

import type { GadgetMediaOutput } from "../gadgets/types.js";
import type { LLMMessage } from "./messages.js";
import type { TokenUsage } from "./options.js";

// =============================================================================
// Node Identifiers
// =============================================================================

/**
 * Unique identifier for any execution node.
 * Format examples: "llm_1", "gadget_abc123", "llm_1_2" (nested)
 */
export type NodeId = string;

/**
 * Node type discriminator.
 */
export type ExecutionNodeType = "llm_call" | "gadget";

// =============================================================================
// Execution Node Types
// =============================================================================

/**
 * Base properties shared by all execution nodes.
 */
interface BaseExecutionNode {
  /** Unique identifier for this node */
  id: NodeId;
  /** Node type discriminator */
  type: ExecutionNodeType;
  /** Parent node ID (null for root nodes) */
  parentId: NodeId | null;
  /** Nesting depth (0 = root, 1 = child of gadget, etc.) */
  depth: number;
  /** Path from root to this node: ["llm_1", "gadget_abc", "llm_1_1"] */
  path: NodeId[];
  /** Creation timestamp */
  createdAt: number;
  /** Completion timestamp (null if in progress) */
  completedAt: number | null;
}

/**
 * LLM call execution node.
 */
export interface LLMCallNode extends BaseExecutionNode {
  type: "llm_call";
  /** Iteration number within the agent loop (1-indexed for display) */
  iteration: number;
  /** Model identifier */
  model: string;
  /** Request messages (set when call starts) */
  request?: LLMMessage[];
  /** Accumulated response text */
  response: string;
  /** Token usage (set on completion) */
  usage?: TokenUsage;
  /** Finish reason from LLM */
  finishReason?: string | null;
  /** Cost in USD */
  cost?: number;
  /** Child node IDs (gadgets spawned by this LLM call) */
  children: NodeId[];
}

/**
 * Gadget execution state.
 */
export type GadgetState = "pending" | "running" | "completed" | "failed" | "skipped";

/**
 * Gadget execution node.
 */
export interface GadgetNode extends BaseExecutionNode {
  type: "gadget";
  /** Invocation ID (LLM-generated or auto) */
  invocationId: string;
  /** Gadget name */
  name: string;
  /** Parameters passed to the gadget */
  parameters: Record<string, unknown>;
  /** Dependencies (other invocation IDs this gadget waits for) */
  dependencies: string[];
  /** Execution state */
  state: GadgetState;
  /** Result string (if completed successfully) */
  result?: string;
  /** Error message (if failed or skipped) */
  error?: string;
  /** Failed dependency invocation ID (if skipped due to dependency) */
  failedDependency?: string;
  /** Execution time in milliseconds */
  executionTimeMs?: number;
  /** Cost in USD */
  cost?: number;
  /** Media outputs from this gadget */
  media?: GadgetMediaOutput[];
  /** Child node IDs (nested LLM calls for subagent gadgets) */
  children: NodeId[];
  /** Whether this gadget is a subagent (has nested LLM calls) */
  isSubagent: boolean;
}

/**
 * Union of all execution node types.
 */
export type ExecutionNode = LLMCallNode | GadgetNode;

// =============================================================================
// Node Creation Parameters
// =============================================================================

export interface AddLLMCallParams {
  /** Iteration number (1-indexed) */
  iteration: number;
  /** Model identifier */
  model: string;
  /** Request messages */
  request?: LLMMessage[];
  /** Parent node ID (for subagent LLM calls) */
  parentId?: NodeId | null;
}

export interface AddGadgetParams {
  /** Invocation ID */
  invocationId: string;
  /** Gadget name */
  name: string;
  /** Parameters */
  parameters: Record<string, unknown>;
  /** Dependencies */
  dependencies?: string[];
  /** Parent LLM call node ID */
  parentId?: NodeId | null;
}

export interface CompleteLLMCallParams {
  /** Accumulated response text */
  response?: string;
  /** Token usage */
  usage?: TokenUsage;
  /** Finish reason */
  finishReason?: string | null;
  /** Cost in USD */
  cost?: number;
}

export interface CompleteGadgetParams {
  /** Result string */
  result?: string;
  /** Error message */
  error?: string;
  /** Failed dependency (for skipped gadgets) */
  failedDependency?: string;
  /** Execution time in ms */
  executionTimeMs?: number;
  /** Cost in USD */
  cost?: number;
  /** Media outputs */
  media?: GadgetMediaOutput[];
}

// =============================================================================
// Event Types (imported from execution-events.ts)
// =============================================================================

// Forward declaration - actual types in execution-events.ts
import type { ExecutionEvent, ExecutionEventType } from "./execution-events.js";

export type { ExecutionEvent, ExecutionEventType };

// =============================================================================
// Event Listener Types
// =============================================================================

/** Event listener function type */
type EventListener = (event: ExecutionEvent) => void;

// =============================================================================
// ExecutionTree Class
// =============================================================================

/**
 * The Execution Tree - single source of truth for all execution state.
 *
 * Features:
 * - Stores all nodes (LLM calls, gadgets) in a hierarchical structure
 * - Emits events on mutations
 * - Provides query methods for aggregation (costs, media, descendants)
 * - Supports single shared tree model for nested subagents
 *
 * @example
 * ```typescript
 * const tree = new ExecutionTree();
 *
 * // Add root LLM call
 * const llmNode = tree.addLLMCall({ iteration: 1, model: "sonnet" });
 *
 * // Add gadget under the LLM call
 * const gadgetNode = tree.addGadget({
 *   invocationId: "gc_1",
 *   name: "ReadFile",
 *   parameters: { path: "/foo.txt" },
 *   parentId: llmNode.id,
 * });
 *
 * // Complete the gadget
 * tree.completeGadget(gadgetNode.id, { result: "file contents", executionTimeMs: 50 });
 *
 * // Query total cost
 * console.log(tree.getTotalCost());
 * ```
 */
export class ExecutionTree {
  private nodes = new Map<NodeId, ExecutionNode>();
  private rootIds: NodeId[] = [];
  private eventListeners = new Map<ExecutionEventType, Set<EventListener>>();
  private eventIdCounter = 0;
  private invocationIdToNodeId = new Map<string, NodeId>();

  // For async event streaming
  private eventQueue: ExecutionEvent[] = [];
  private eventWaiters: Array<(event: ExecutionEvent) => void> = [];
  private isCompleted = false;

  /**
   * Base depth for all nodes in this tree.
   * Used when this tree is a subagent's view into a parent tree.
   */
  public readonly baseDepth: number;

  /**
   * Parent node ID for subagent trees.
   * All root nodes in this tree will have this as their parentId.
   */
  public readonly parentNodeId: NodeId | null;

  constructor(options?: { baseDepth?: number; parentNodeId?: NodeId | null }) {
    this.baseDepth = options?.baseDepth ?? 0;
    this.parentNodeId = options?.parentNodeId ?? null;
  }

  // ===========================================================================
  // Node ID Generation
  // ===========================================================================

  private generateLLMCallId(iteration: number, parentId: NodeId | null): NodeId {
    if (parentId) {
      // Subagent LLM call: include parent info for uniqueness
      return `llm_${parentId}_${iteration}`;
    }
    return `llm_${iteration}`;
  }

  private gadgetIdCounter = 0;
  private generateGadgetId(invocationId: string): NodeId {
    return `gadget_${invocationId}_${++this.gadgetIdCounter}`;
  }

  // ===========================================================================
  // Event Emission
  // ===========================================================================

  private emit(event: ExecutionEvent): void {
    // Notify sync listeners
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error(`Error in event listener for ${event.type}:`, error);
        }
      }
    }

    // Also emit to "all" listeners
    const allListeners = this.eventListeners.get("*");
    if (allListeners) {
      for (const listener of allListeners) {
        try {
          listener(event);
        } catch (error) {
          console.error("Error in wildcard event listener:", error);
        }
      }
    }

    // Push to async queue
    if (this.eventWaiters.length > 0) {
      const waiter = this.eventWaiters.shift();
      if (waiter) waiter(event);
    } else {
      this.eventQueue.push(event);
    }
  }

  private createBaseEventProps(node: ExecutionNode): {
    eventId: number;
    timestamp: number;
    nodeId: NodeId;
    parentId: NodeId | null;
    depth: number;
    path: NodeId[];
  } {
    return {
      eventId: ++this.eventIdCounter,
      timestamp: Date.now(),
      nodeId: node.id,
      parentId: node.parentId,
      depth: node.depth,
      path: node.path,
    };
  }

  // ===========================================================================
  // Node Creation
  // ===========================================================================

  /**
   * Add a new LLM call node to the tree.
   */
  addLLMCall(params: AddLLMCallParams): LLMCallNode {
    const parentId = params.parentId ?? this.parentNodeId;
    const parent = parentId ? this.nodes.get(parentId) : null;

    const depth = parent ? parent.depth + 1 : this.baseDepth;
    const path = parent ? [...parent.path] : [];

    const id = this.generateLLMCallId(params.iteration, parentId);
    path.push(id);

    const node: LLMCallNode = {
      id,
      type: "llm_call",
      parentId,
      depth,
      path,
      createdAt: Date.now(),
      completedAt: null,
      iteration: params.iteration,
      model: params.model,
      request: params.request,
      response: "",
      children: [],
    };

    this.nodes.set(id, node);

    if (!parentId) {
      this.rootIds.push(id);
    } else if (parent) {
      parent.children.push(id);
    }

    this.emit({
      type: "llm_call_start",
      ...this.createBaseEventProps(node),
      iteration: node.iteration,
      model: node.model,
      request: node.request,
    });

    return node;
  }

  /**
   * Add text to an LLM call's response (for streaming).
   */
  appendLLMResponse(nodeId: NodeId, chunk: string): void {
    const node = this.nodes.get(nodeId);
    if (!node || node.type !== "llm_call") {
      throw new Error(`LLM call node not found: ${nodeId}`);
    }

    (node as LLMCallNode).response += chunk;

    this.emit({
      type: "llm_call_stream",
      ...this.createBaseEventProps(node),
      chunk,
    });
  }

  /**
   * Complete an LLM call node.
   */
  completeLLMCall(nodeId: NodeId, params: CompleteLLMCallParams): void {
    const node = this.nodes.get(nodeId);
    if (!node || node.type !== "llm_call") {
      throw new Error(`LLM call node not found: ${nodeId}`);
    }

    const llmNode = node as LLMCallNode;
    llmNode.completedAt = Date.now();
    if (params.response !== undefined) llmNode.response = params.response;
    if (params.usage) llmNode.usage = params.usage;
    if (params.finishReason !== undefined) llmNode.finishReason = params.finishReason;
    if (params.cost !== undefined) llmNode.cost = params.cost;

    this.emit({
      type: "llm_call_complete",
      ...this.createBaseEventProps(node),
      response: llmNode.response,
      usage: llmNode.usage,
      finishReason: llmNode.finishReason,
      cost: llmNode.cost,
    });
  }

  /**
   * Mark an LLM call as failed.
   */
  failLLMCall(nodeId: NodeId, error: Error, recovered: boolean): void {
    const node = this.nodes.get(nodeId);
    if (!node || node.type !== "llm_call") {
      throw new Error(`LLM call node not found: ${nodeId}`);
    }

    const llmNode = node as LLMCallNode;
    llmNode.completedAt = Date.now();

    this.emit({
      type: "llm_call_error",
      ...this.createBaseEventProps(node),
      error,
      recovered,
    });
  }

  /**
   * Add a new gadget node to the tree.
   */
  addGadget(params: AddGadgetParams): GadgetNode {
    const parentId = params.parentId ?? this.getCurrentLLMCallId() ?? this.parentNodeId;
    const parent = parentId ? this.nodes.get(parentId) : null;

    const depth = parent ? parent.depth + 1 : this.baseDepth;
    const path = parent ? [...parent.path] : [];

    const id = this.generateGadgetId(params.invocationId);
    path.push(id);

    const node: GadgetNode = {
      id,
      type: "gadget",
      parentId,
      depth,
      path,
      createdAt: Date.now(),
      completedAt: null,
      invocationId: params.invocationId,
      name: params.name,
      parameters: params.parameters,
      dependencies: params.dependencies ?? [],
      state: "pending",
      children: [],
      isSubagent: false,
    };

    this.nodes.set(id, node);
    this.invocationIdToNodeId.set(params.invocationId, id);

    if (parent) {
      parent.children.push(id);
    }

    this.emit({
      type: "gadget_call",
      ...this.createBaseEventProps(node),
      invocationId: node.invocationId,
      name: node.name,
      parameters: node.parameters,
      dependencies: node.dependencies,
    });

    return node;
  }

  /**
   * Mark a gadget as started (running).
   */
  startGadget(nodeId: NodeId): void {
    const node = this.nodes.get(nodeId);
    if (!node || node.type !== "gadget") {
      throw new Error(`Gadget node not found: ${nodeId}`);
    }

    const gadgetNode = node as GadgetNode;
    gadgetNode.state = "running";

    this.emit({
      type: "gadget_start",
      ...this.createBaseEventProps(node),
      invocationId: gadgetNode.invocationId,
      name: gadgetNode.name,
    });
  }

  /**
   * Complete a gadget node successfully.
   */
  completeGadget(nodeId: NodeId, params: CompleteGadgetParams): void {
    const node = this.nodes.get(nodeId);
    if (!node || node.type !== "gadget") {
      throw new Error(`Gadget node not found: ${nodeId}`);
    }

    const gadgetNode = node as GadgetNode;
    gadgetNode.completedAt = Date.now();
    gadgetNode.state = params.error ? "failed" : "completed";
    if (params.result !== undefined) gadgetNode.result = params.result;
    if (params.error) gadgetNode.error = params.error;
    if (params.executionTimeMs !== undefined) gadgetNode.executionTimeMs = params.executionTimeMs;
    if (params.cost !== undefined) gadgetNode.cost = params.cost;
    if (params.media) gadgetNode.media = params.media;

    // Mark as subagent if it has child LLM calls
    gadgetNode.isSubagent = gadgetNode.children.some((childId) => {
      const child = this.nodes.get(childId);
      return child?.type === "llm_call";
    });

    if (params.error) {
      this.emit({
        type: "gadget_error",
        ...this.createBaseEventProps(node),
        invocationId: gadgetNode.invocationId,
        name: gadgetNode.name,
        error: params.error,
        executionTimeMs: params.executionTimeMs ?? 0,
      });
    } else {
      this.emit({
        type: "gadget_complete",
        ...this.createBaseEventProps(node),
        invocationId: gadgetNode.invocationId,
        name: gadgetNode.name,
        result: params.result ?? "",
        executionTimeMs: params.executionTimeMs ?? 0,
        cost: params.cost,
        media: params.media,
      });
    }
  }

  /**
   * Mark a gadget as skipped due to dependency failure.
   */
  skipGadget(
    nodeId: NodeId,
    failedDependency: string,
    failedDependencyError: string,
    reason: "dependency_failed" | "controller_skip",
  ): void {
    const node = this.nodes.get(nodeId);
    if (!node || node.type !== "gadget") {
      throw new Error(`Gadget node not found: ${nodeId}`);
    }

    const gadgetNode = node as GadgetNode;
    gadgetNode.completedAt = Date.now();
    gadgetNode.state = "skipped";
    gadgetNode.failedDependency = failedDependency;
    gadgetNode.error = failedDependencyError;

    this.emit({
      type: "gadget_skipped",
      ...this.createBaseEventProps(node),
      invocationId: gadgetNode.invocationId,
      name: gadgetNode.name,
      reason,
      failedDependency,
      failedDependencyError,
    });
  }

  // ===========================================================================
  // Text Events (pure notifications, not tree nodes)
  // ===========================================================================

  /**
   * Emit a text event (notification only, not stored in tree).
   */
  emitText(content: string, llmCallNodeId: NodeId): void {
    const node = this.nodes.get(llmCallNodeId);
    if (!node) {
      throw new Error(`Node not found: ${llmCallNodeId}`);
    }

    this.emit({
      type: "text",
      ...this.createBaseEventProps(node),
      content,
    });
  }

  // ===========================================================================
  // Query Methods
  // ===========================================================================

  /**
   * Get a node by ID.
   */
  getNode(id: NodeId): ExecutionNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Get a gadget node by invocation ID.
   */
  getNodeByInvocationId(invocationId: string): GadgetNode | undefined {
    const nodeId = this.invocationIdToNodeId.get(invocationId);
    if (!nodeId) return undefined;
    const node = this.nodes.get(nodeId);
    return node?.type === "gadget" ? (node as GadgetNode) : undefined;
  }

  /**
   * Get all root nodes (depth 0 for this tree).
   */
  getRoots(): ExecutionNode[] {
    return this.rootIds
      .map((id) => this.nodes.get(id))
      .filter((node): node is ExecutionNode => node !== undefined);
  }

  /**
   * Get children of a node.
   */
  getChildren(id: NodeId): ExecutionNode[] {
    const node = this.nodes.get(id);
    if (!node) return [];
    return node.children
      .map((childId) => this.nodes.get(childId))
      .filter((child): child is ExecutionNode => child !== undefined);
  }

  /**
   * Get ancestors of a node (from root to parent).
   */
  getAncestors(id: NodeId): ExecutionNode[] {
    const node = this.nodes.get(id);
    if (!node) return [];

    const ancestors: ExecutionNode[] = [];
    let currentId = node.parentId;
    while (currentId) {
      const ancestor = this.nodes.get(currentId);
      if (ancestor) {
        ancestors.unshift(ancestor);
        currentId = ancestor.parentId;
      } else {
        break;
      }
    }
    return ancestors;
  }

  /**
   * Get all descendants of a node.
   */
  getDescendants(id: NodeId, type?: ExecutionNodeType): ExecutionNode[] {
    const node = this.nodes.get(id);
    if (!node) return [];

    const descendants: ExecutionNode[] = [];
    const stack = [...node.children];

    while (stack.length > 0) {
      const childId = stack.pop()!;
      const child = this.nodes.get(childId);
      if (child) {
        if (!type || child.type === type) {
          descendants.push(child);
        }
        stack.push(...child.children);
      }
    }

    return descendants;
  }

  /**
   * Get the current (most recent incomplete) LLM call node.
   */
  getCurrentLLMCallId(): NodeId | undefined {
    // Find the most recent root LLM call that's not complete
    for (let i = this.rootIds.length - 1; i >= 0; i--) {
      const node = this.nodes.get(this.rootIds[i]);
      if (node?.type === "llm_call" && !node.completedAt) {
        return node.id;
      }
    }
    return undefined;
  }

  // ===========================================================================
  // Aggregation Methods (for subagent support)
  // ===========================================================================

  /**
   * Get total cost for entire tree.
   */
  getTotalCost(): number {
    let total = 0;
    for (const node of this.nodes.values()) {
      if (node.type === "llm_call" && (node as LLMCallNode).cost) {
        total += (node as LLMCallNode).cost!;
      } else if (node.type === "gadget" && (node as GadgetNode).cost) {
        total += (node as GadgetNode).cost!;
      }
    }
    return total;
  }

  /**
   * Get total cost for a subtree (node and all descendants).
   */
  getSubtreeCost(nodeId: NodeId): number {
    const node = this.nodes.get(nodeId);
    if (!node) return 0;

    let total = 0;

    // Add node's own cost
    if (node.type === "llm_call" && (node as LLMCallNode).cost) {
      total += (node as LLMCallNode).cost!;
    } else if (node.type === "gadget" && (node as GadgetNode).cost) {
      total += (node as GadgetNode).cost!;
    }

    // Add descendants' costs
    for (const descendant of this.getDescendants(nodeId)) {
      if (descendant.type === "llm_call" && (descendant as LLMCallNode).cost) {
        total += (descendant as LLMCallNode).cost!;
      } else if (descendant.type === "gadget" && (descendant as GadgetNode).cost) {
        total += (descendant as GadgetNode).cost!;
      }
    }

    return total;
  }

  /**
   * Get token usage for entire tree.
   */
  getTotalTokens(): { input: number; output: number; cached: number } {
    let input = 0;
    let output = 0;
    let cached = 0;

    for (const node of this.nodes.values()) {
      if (node.type === "llm_call") {
        const llmNode = node as LLMCallNode;
        if (llmNode.usage) {
          input += llmNode.usage.inputTokens;
          output += llmNode.usage.outputTokens;
          cached += llmNode.usage.cachedInputTokens ?? 0;
        }
      }
    }

    return { input, output, cached };
  }

  /**
   * Get token usage for a subtree.
   */
  getSubtreeTokens(nodeId: NodeId): { input: number; output: number; cached: number } {
    const node = this.nodes.get(nodeId);
    if (!node) return { input: 0, output: 0, cached: 0 };

    let input = 0;
    let output = 0;
    let cached = 0;

    const nodesToProcess = [node, ...this.getDescendants(nodeId)];

    for (const n of nodesToProcess) {
      if (n.type === "llm_call") {
        const llmNode = n as LLMCallNode;
        if (llmNode.usage) {
          input += llmNode.usage.inputTokens;
          output += llmNode.usage.outputTokens;
          cached += llmNode.usage.cachedInputTokens ?? 0;
        }
      }
    }

    return { input, output, cached };
  }

  /**
   * Collect all media from a subtree.
   */
  getSubtreeMedia(nodeId: NodeId): GadgetMediaOutput[] {
    const node = this.nodes.get(nodeId);
    if (!node) return [];

    const media: GadgetMediaOutput[] = [];
    const nodesToProcess: ExecutionNode[] = node.type === "gadget" ? [node] : [];
    nodesToProcess.push(...this.getDescendants(nodeId, "gadget"));

    for (const n of nodesToProcess) {
      if (n.type === "gadget") {
        const gadgetNode = n as GadgetNode;
        if (gadgetNode.media) {
          media.push(...gadgetNode.media);
        }
      }
    }

    return media;
  }

  /**
   * Check if a subtree is complete (all nodes finished).
   */
  isSubtreeComplete(nodeId: NodeId): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return true;
    if (!node.completedAt) return false;

    for (const descendant of this.getDescendants(nodeId)) {
      if (!descendant.completedAt) return false;
    }

    return true;
  }

  /**
   * Get node counts.
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

  // ===========================================================================
  // Event Subscription
  // ===========================================================================

  /**
   * Subscribe to events of a specific type.
   * Returns unsubscribe function.
   *
   * @param type - Event type to subscribe to (use "*" for all events)
   * @param listener - Callback function that receives matching events
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * const unsubscribe = tree.on("gadget_complete", (event) => {
   *   if (event.type === "gadget_complete") {
   *     console.log(`Gadget ${event.name} completed`);
   *   }
   * });
   * ```
   */
  on(type: ExecutionEventType, listener: EventListener): () => void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    const listeners = this.eventListeners.get(type)!;
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }

  /**
   * Subscribe to all events.
   */
  onAll(listener: EventListener): () => void {
    return this.on("*", listener);
  }

  /**
   * Get async iterable of all events.
   * Events are yielded as they occur.
   */
  async *events(): AsyncGenerator<ExecutionEvent> {
    while (!this.isCompleted) {
      // Drain queue first
      while (this.eventQueue.length > 0) {
        yield this.eventQueue.shift()!;
      }

      if (this.isCompleted) break;

      // Wait for next event
      const event = await new Promise<ExecutionEvent>((resolve) => {
        // Check queue again in case events arrived while setting up
        if (this.eventQueue.length > 0) {
          resolve(this.eventQueue.shift()!);
        } else {
          this.eventWaiters.push(resolve);
        }
      });

      yield event;
    }

    // Drain remaining events
    while (this.eventQueue.length > 0) {
      yield this.eventQueue.shift()!;
    }
  }

  /**
   * Mark the tree as complete (no more events will be emitted).
   */
  complete(): void {
    this.isCompleted = true;
    // Wake up any waiters with a dummy event that signals completion
    for (const waiter of this.eventWaiters) {
      // Push a completion marker so waiters can exit
    }
    this.eventWaiters = [];
  }

  /**
   * Check if the tree is complete.
   */
  isComplete(): boolean {
    return this.isCompleted;
  }
}
