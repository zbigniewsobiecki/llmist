import type { ModelRegistry } from "llmist";
import { stripProviderPrefix } from "../ui/formatters.js";

/**
 * Represents a nested agent LLM call tracked under a parent gadget invocation.
 */
export interface NestedAgentEntry {
  parentInvocationId: string;
  depth: number;
  model: string;
  iteration: number;
  /** Parent call number for hierarchical display (e.g., #1.2) */
  parentCallNumber?: number;
  /** Gadget invocation ID for unique subagent identification (e.g., #6.browse_web_1.2) */
  gadgetInvocationId?: string;
  startTime: number;
  inputTokens?: number;
  outputTokens?: number;
  // First-class subagent metrics (cached tokens, cost, finish reason)
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningTokens?: number;
  finishReason?: string;
  cost?: number;
  completed?: boolean;
  completedTime?: number;
}

/**
 * Represents a nested gadget call tracked under a parent gadget invocation.
 */
export interface NestedGadgetEntry {
  depth: number;
  parentInvocationId: string;
  name: string;
  parameters?: Record<string, unknown>;
  startTime: number;
  completed?: boolean;
  completedTime?: number;
}

/**
 * Tracks nested agents and nested gadgets for hierarchical subagent display.
 * Single responsibility: manage CRUD operations for all nested operation tracking state.
 */
export class NestedOperationTracker {
  private nestedAgents: Map<string, NestedAgentEntry> = new Map();
  private nestedGadgets: Map<string, NestedGadgetEntry> = new Map();

  constructor(private readonly modelRegistry?: ModelRegistry) {}

  // ===== Nested Agents =====

  /**
   * Add a nested agent LLM call (called when nested llm_call_start event received).
   * Used to display hierarchical progress for subagent gadgets.
   * @param parentCallNumber - Top-level call number for hierarchical display (e.g., #1.2)
   * @param gadgetInvocationId - Gadget invocation ID for unique subagent identification
   */
  addNestedAgent(
    id: string,
    parentInvocationId: string,
    depth: number,
    model: string,
    iteration: number,
    info?: {
      inputTokens?: number;
      cachedInputTokens?: number;
    },
    parentCallNumber?: number,
    gadgetInvocationId?: string,
  ): void {
    this.nestedAgents.set(id, {
      parentInvocationId,
      depth,
      model,
      iteration,
      parentCallNumber,
      gadgetInvocationId,
      startTime: Date.now(),
      inputTokens: info?.inputTokens,
      cachedInputTokens: info?.cachedInputTokens,
    });
  }

  /**
   * Update a nested agent with completion info (called when nested llm_call_end event received).
   * Records completion time to freeze the elapsed timer.
   * @param info - Full LLM call info including tokens, cache details, and cost
   */
  updateNestedAgent(
    id: string,
    info: {
      inputTokens?: number;
      outputTokens?: number;
      cachedInputTokens?: number;
      cacheCreationInputTokens?: number;
      reasoningTokens?: number;
      finishReason?: string;
      cost?: number;
    },
  ): void {
    const agent = this.nestedAgents.get(id);
    if (agent) {
      // Only update if new value is defined - preserve initial values from addNestedAgent()
      if (info.inputTokens !== undefined) agent.inputTokens = info.inputTokens;
      if (info.outputTokens !== undefined) agent.outputTokens = info.outputTokens;
      if (info.cachedInputTokens !== undefined) agent.cachedInputTokens = info.cachedInputTokens;
      if (info.cacheCreationInputTokens !== undefined)
        agent.cacheCreationInputTokens = info.cacheCreationInputTokens;
      if (info.reasoningTokens !== undefined) agent.reasoningTokens = info.reasoningTokens;
      if (info.finishReason !== undefined) agent.finishReason = info.finishReason;

      // Calculate cost if not provided and we have model registry
      if (info.cost !== undefined) {
        agent.cost = info.cost;
      } else if (this.modelRegistry && agent.model && agent.outputTokens) {
        // Calculate cost using model registry (first-class subagent metric)
        // Use agent.* values which include preserved initial values from addNestedAgent()
        try {
          const modelName = stripProviderPrefix(agent.model);
          const costResult = this.modelRegistry.estimateCost(
            modelName,
            agent.inputTokens ?? 0,
            agent.outputTokens,
            agent.cachedInputTokens,
            agent.cacheCreationInputTokens,
            agent.reasoningTokens,
          );
          agent.cost = costResult?.totalCost;
        } catch {
          // Ignore cost calculation errors
        }
      }

      agent.completed = true;
      agent.completedTime = Date.now();
    }
  }

  /**
   * Remove a nested agent (called when the nested LLM call completes).
   */
  removeNestedAgent(id: string): void {
    this.nestedAgents.delete(id);
  }

  /**
   * Get a nested agent by ID (for accessing startTime, etc.).
   */
  getNestedAgent(id: string): NestedAgentEntry | undefined {
    return this.nestedAgents.get(id);
  }

  /**
   * Get the underlying Map of nested agents (for iteration in render logic).
   */
  getNestedAgentsMap(): Map<string, NestedAgentEntry> {
    return this.nestedAgents;
  }

  /**
   * Get aggregated metrics from all nested agents for a parent gadget.
   * Used to show total token counts and cost for subagent gadgets like BrowseWeb.
   */
  getAggregatedSubagentMetrics(parentInvocationId: string): {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cost: number;
    callCount: number;
  } {
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;
    let cost = 0;
    let callCount = 0;

    for (const [, nested] of this.nestedAgents) {
      if (nested.parentInvocationId === parentInvocationId) {
        inputTokens += nested.inputTokens ?? 0;
        outputTokens += nested.outputTokens ?? 0;
        cachedInputTokens += nested.cachedInputTokens ?? 0;
        cost += nested.cost ?? 0;
        callCount++;
      }
    }

    return { inputTokens, outputTokens, cachedInputTokens, cost, callCount };
  }

  /**
   * Remove all nested agents and gadgets whose parentInvocationId matches the given ID.
   * Called when parent gadgets are cleared.
   */
  clearByParentInvocationId(parentInvocationId: string): void {
    for (const [nestedId, nested] of this.nestedAgents) {
      if (nested.parentInvocationId === parentInvocationId) {
        this.nestedAgents.delete(nestedId);
      }
    }
    for (const [nestedId, nested] of this.nestedGadgets) {
      if (nested.parentInvocationId === parentInvocationId) {
        this.nestedGadgets.delete(nestedId);
      }
    }
  }

  // ===== Nested Gadgets =====

  /**
   * Add a nested gadget call (called when nested gadget_call event received).
   */
  addNestedGadget(
    id: string,
    depth: number,
    parentInvocationId: string,
    name: string,
    parameters?: Record<string, unknown>,
  ): void {
    this.nestedGadgets.set(id, {
      depth,
      parentInvocationId,
      name,
      parameters,
      startTime: Date.now(),
    });
  }

  /**
   * Remove a nested gadget (called when nested gadget_result event received).
   */
  removeNestedGadget(id: string): void {
    this.nestedGadgets.delete(id);
  }

  /**
   * Get a nested gadget by ID (for accessing startTime, name, etc.).
   */
  getNestedGadget(id: string): NestedGadgetEntry | undefined {
    return this.nestedGadgets.get(id);
  }

  /**
   * Get the underlying Map of nested gadgets (for iteration in render logic).
   */
  getNestedGadgetsMap(): Map<string, NestedGadgetEntry> {
    return this.nestedGadgets;
  }

  /**
   * Mark a nested gadget as completed (keeps it visible with ✓ indicator).
   * Records completion time to freeze the elapsed timer.
   */
  completeNestedGadget(id: string): void {
    const gadget = this.nestedGadgets.get(id);
    if (gadget) {
      gadget.completed = true;
      gadget.completedTime = Date.now();
    }
  }
}
