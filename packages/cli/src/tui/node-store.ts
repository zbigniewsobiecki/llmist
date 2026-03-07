/**
 * NodeStore - Manages the block node tree for the TUI renderer.
 *
 * Responsible for:
 * - Node CRUD (add/complete/clear)
 * - Idempotency tracking (iteration, invocation, nested key maps)
 * - Session management (currentSessionId, previousSessionId)
 * - Change notifications (onNodeAdded, onNodeUpdated, onNodeRemoved)
 *
 * @module
 */

import type {
  BlockNode,
  GadgetNode,
  LLMCallNode,
  SystemMessageNode,
  TextNode,
  ThinkingNode,
} from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// NodeStore Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for completing a gadget execution.
 */
export interface CompleteGadgetOptions {
  result?: string;
  error?: string;
  executionTimeMs?: number;
  cost?: number;
  mediaOutputs?: GadgetNode["mediaOutputs"];
}

/**
 * Callbacks for reacting to node changes.
 * BlockRenderer subscribes to these to trigger re-renders.
 */
export interface NodeStoreCallbacks {
  /** Called when a new node is added (triggers rebuild) */
  onNodeAdded?: () => void;
  /** Called when an existing node is updated (triggers single-block update) */
  onNodeUpdated?: (nodeId: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// NodeStore Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages the block node tree — node CRUD, idempotency, and session tracking.
 *
 * Extracted from BlockRenderer to separate the data layer from the rendering layer.
 * Emits callbacks on changes so BlockRenderer can trigger re-renders.
 */
export class NodeStore {
  /** All nodes in the tree (flat for easy lookup) */
  readonly nodes = new Map<string, BlockNode>();

  /** Root node IDs (top-level LLM calls and text) */
  rootIds: string[] = [];

  /** Counter for generating unique node IDs */
  private nodeIdCounter = 0;

  /** Current LLM call node (for adding gadget children) */
  currentLLMCallId: string | null = null;

  /** Current thinking block (accumulates chunks during streaming) */
  currentThinkingId: string | null = null;

  /** Current session ID (increments each new REPL turn) */
  private currentSessionId = 0;

  /** Previous session ID (for deferred cleanup) */
  private previousSessionId: number | null = null;

  /** Track main agent LLM calls by iteration for idempotency */
  private llmCallByIteration = new Map<number, string>();

  /** Track gadgets by invocationId for idempotency */
  private gadgetByInvocationId = new Map<string, string>();

  /** Track nested LLM calls by parentId_iteration for idempotency */
  private nestedLLMCallByKey = new Map<string, string>();

  /** Callbacks for change notifications */
  private callbacks: NodeStoreCallbacks = {};

  // ───────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Set callbacks for node change notifications.
   */
  setCallbacks(callbacks: NodeStoreCallbacks): void {
    this.callbacks = callbacks;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Node CRUD
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Add an LLM call node (top-level or nested in gadget).
   * Idempotent - returns existing block if already created for this iteration.
   */
  addLLMCall(
    iteration: number,
    model: string,
    parentGadgetId?: string,
    isNested?: boolean,
  ): string {
    // Idempotency check
    if (!parentGadgetId && !isNested) {
      const existingId = this.llmCallByIteration.get(iteration);
      if (existingId) {
        this.currentLLMCallId = existingId;
        return existingId;
      }
    } else if (parentGadgetId) {
      const nestedKey = `${parentGadgetId}_${iteration}`;
      const existingId = this.nestedLLMCallByKey.get(nestedKey);
      if (existingId) {
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
      sessionId: this.currentSessionId,
      iteration,
      model,
      isComplete: false,
      children: [],
    };

    this.nodes.set(id, node);

    if (parentGadgetId) {
      const parent = this.getNode(parentGadgetId) as GadgetNode;
      parent.children.push(id);
      const nestedKey = `${parentGadgetId}_${iteration}`;
      this.nestedLLMCallByKey.set(nestedKey, id);
    } else {
      this.rootIds.push(id);
      this.llmCallByIteration.set(iteration, id);
    }

    this.currentLLMCallId = id;
    this.callbacks.onNodeAdded?.();
    return id;
  }

  /**
   * Complete an LLM call with details and optional raw response.
   */
  completeLLMCall(id: string, details: LLMCallNode["details"], rawResponse?: string): void {
    const node = this.getNode(id) as LLMCallNode | undefined;
    if (!node || node.type !== "llm_call") return;

    node.isComplete = true;
    node.details = details;
    if (rawResponse !== undefined) {
      node.rawResponse = rawResponse;
    }
    this.callbacks.onNodeUpdated?.(id);
  }

  /**
   * Store raw request messages for an LLM call.
   */
  setLLMCallRequest(id: string, messages: import("llmist").LLMMessage[]): void {
    const node = this.getNode(id) as LLMCallNode | undefined;
    if (!node || node.type !== "llm_call") return;
    node.rawRequest = messages;
  }

  /**
   * Store raw response for an LLM call (enrichment only).
   */
  setLLMCallResponse(id: string, rawResponse: string): void {
    const node = this.getNode(id) as LLMCallNode | undefined;
    if (!node || node.type !== "llm_call") return;
    node.rawResponse = rawResponse;
  }

  /**
   * Add a gadget node as a child of the current LLM call.
   * Idempotent - returns existing block if already created.
   */
  addGadget(invocationId: string, name: string, parameters?: Record<string, unknown>): string {
    const existingId = this.gadgetByInvocationId.get(invocationId);
    if (existingId) {
      return existingId;
    }

    const id = this.generateId("gadget");
    const parentLLMCallId = this.currentLLMCallId;

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
      sessionId: this.currentSessionId,
      invocationId,
      name,
      isComplete: false,
      parameters,
      children: [],
    };

    this.nodes.set(id, node);

    if (parentLLMCallId) {
      const parent = this.getNode(parentLLMCallId) as LLMCallNode;
      parent.children.push(id);
    } else {
      this.rootIds.push(id);
    }

    this.gadgetByInvocationId.set(invocationId, id);
    this.callbacks.onNodeAdded?.();
    return id;
  }

  /**
   * Complete a gadget with result.
   */
  completeGadget(invocationId: string, options: CompleteGadgetOptions = {}): void {
    const node = this.findGadgetByInvocationId(invocationId);
    if (!node) return;

    const { result, error, executionTimeMs, cost, mediaOutputs } = options;

    node.isComplete = true;
    node.result = result;
    node.error = error;
    node.executionTimeMs = executionTimeMs;
    node.cost = cost;
    node.mediaOutputs = mediaOutputs;

    if (result) {
      node.resultTokens = Math.ceil(result.length / 4);
    }

    if (node.children.length > 0) {
      node.subagentStats = this.aggregateSubagentStats(node.children);
    }

    this.callbacks.onNodeUpdated?.(node.id);
  }

  /**
   * Add a text node.
   */
  addText(content: string): string {
    const id = this.generateId("text");

    const node: TextNode = {
      id,
      type: "text",
      depth: 0,
      parentId: null,
      sessionId: this.currentSessionId,
      content,
      children: [] as never[],
    };

    this.nodes.set(id, node);
    this.rootIds.push(id);
    this.callbacks.onNodeAdded?.();
    return id;
  }

  /**
   * Add a system message node.
   */
  addSystemMessage(
    message: string,
    category: "throttle" | "retry" | "info" | "warning" | "error",
  ): string {
    const id = this.generateId("system");

    const node: SystemMessageNode = {
      id,
      type: "system_message",
      depth: 0,
      parentId: null,
      sessionId: this.currentSessionId,
      message,
      category,
      children: [] as never[],
    };

    this.nodes.set(id, node);
    this.rootIds.push(id);
    this.callbacks.onNodeAdded?.();
    return id;
  }

  /**
   * Add thinking content from a reasoning model.
   * Creates a new thinking block on first chunk, appends to existing on subsequent.
   */
  addThinking(content: string, thinkingType: "thinking" | "redacted"): void {
    if (this.currentThinkingId) {
      const node = this.getNode(this.currentThinkingId) as ThinkingNode | undefined;
      if (node && node.type === "thinking") {
        node.content += content;
        this.callbacks.onNodeUpdated?.(this.currentThinkingId);
        return;
      }
    }

    const id = this.generateId("thinking");
    const parentLLMCallId = this.currentLLMCallId;

    let depth = 0;
    if (parentLLMCallId) {
      const parent = this.getNode(parentLLMCallId);
      if (parent) {
        depth = parent.depth + 1;
      }
    }

    const node: ThinkingNode = {
      id,
      type: "thinking",
      depth,
      parentId: parentLLMCallId,
      sessionId: this.currentSessionId,
      content,
      thinkingType,
      isComplete: false,
      children: [] as never[],
    };

    this.nodes.set(id, node);

    if (parentLLMCallId) {
      const parent = this.getNode(parentLLMCallId) as LLMCallNode;
      parent.children.push(id);
    } else {
      this.rootIds.push(id);
    }

    this.currentThinkingId = id;
    this.callbacks.onNodeAdded?.();
  }

  /**
   * Complete the current thinking block.
   */
  completeThinking(): void {
    if (!this.currentThinkingId) return;

    const node = this.getNode(this.currentThinkingId) as ThinkingNode | undefined;
    if (node && node.type === "thinking") {
      node.isComplete = true;
      this.callbacks.onNodeUpdated?.(this.currentThinkingId);
    }

    this.currentThinkingId = null;
  }

  /**
   * Add a user message node.
   */
  addUserMessage(message: string): string {
    const id = this.generateId("user");

    const node: TextNode = {
      id,
      type: "text",
      depth: 0,
      parentId: null,
      sessionId: this.currentSessionId,
      content: message,
      children: [] as never[],
    };

    this.nodes.set(id, node);
    this.rootIds.push(id);
    this.callbacks.onNodeAdded?.();
    return id;
  }

  /**
   * Find a gadget node by its invocation ID.
   */
  findGadgetByInvocationId(invocationId: string): GadgetNode | undefined {
    const blockId = this.gadgetByInvocationId.get(invocationId);
    if (!blockId) return undefined;
    const node = this.nodes.get(blockId);
    return node?.type === "gadget" ? (node as GadgetNode) : undefined;
  }

  /**
   * Get a node by ID.
   */
  getNode(id: string): BlockNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Clear all nodes and reset state.
   */
  clear(): void {
    this.nodes.clear();
    this.llmCallByIteration.clear();
    this.gadgetByInvocationId.clear();
    this.nestedLLMCallByKey.clear();
    this.rootIds = [];
    this.currentLLMCallId = null;
    this.currentThinkingId = null;
  }

  /**
   * Clear idempotency maps (used when subscribing to a new tree).
   */
  clearIdempotencyMaps(): void {
    this.llmCallByIteration.clear();
    this.gadgetByInvocationId.clear();
    this.nestedLLMCallByKey.clear();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Session Management
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Start a new session. Called at the start of each REPL turn.
   */
  startNewSession(): void {
    this.previousSessionId = this.currentSessionId;
    this.currentSessionId++;
  }

  /**
   * Get the current session ID.
   */
  getCurrentSessionId(): number {
    return this.currentSessionId;
  }

  /**
   * Get the previous session ID (or null if none).
   */
  getPreviousSessionId(): number | null {
    return this.previousSessionId;
  }

  /**
   * Clear the previous session marker after cleanup.
   */
  clearPreviousSessionId(): void {
    this.previousSessionId = null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Generate a unique node ID.
   */
  private generateId(prefix: string): string {
    return `${prefix}_${++this.nodeIdCounter}`;
  }

  /**
   * Aggregate token/cost stats from child LLM call nodes.
   */
  private aggregateSubagentStats(childIds: string[]): GadgetNode["subagentStats"] {
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
}
