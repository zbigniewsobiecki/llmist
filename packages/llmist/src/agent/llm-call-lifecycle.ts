/**
 * LLMCallLifecycle: Encapsulates LLM call preparation, completion, and observer notification.
 *
 * Extracted from Agent to provide a focused, testable module for managing the LLM
 * call lifecycle — from building options and tree nodes, through hook notifications,
 * to cost calculation and after-call controller invocation.
 *
 * Follows the stateless helper class pattern (like RetryOrchestrator) — no instance state
 * beyond injected dependencies, just methods that operate on Agent dependencies.
 *
 * ## Observer Call Order (preserved from Agent)
 * 1. `onLLMCallStart`  — fires when tree node is created, before controller
 * 2. `beforeLLMCall` controller — can skip or modify options
 * 3. `onLLMCallReady` — fires after controller modifications, before API call
 * 4. [LLM API Call + Stream]
 * 5. `onLLMCallComplete` — fires after stream completes
 * 6. `afterLLMCall` controller — can modify/append messages
 * 7. `onLLMCallError` — fires when an error escapes the stream
 *
 * @module agent/llm-call-lifecycle
 */

import type { ILogObj, Logger } from "tslog";
import type { LLMist } from "../core/client.js";
import type { ExecutionTree, NodeId } from "../core/execution-tree.js";
import { extractMessageText } from "../core/messages.js";
import type { ModelSpec } from "../core/model-catalog.js";
import type { CachingConfig, LLMGenerationOptions, ReasoningConfig } from "../core/options.js";
import type { RateLimitTracker } from "../core/rate-limit.js";
import type { StreamCompletionEvent } from "../gadgets/types.js";
import type { ConversationManager } from "./conversation-manager.js";
import {
  validateAfterLLMCallAction,
  validateAfterLLMErrorAction,
  validateBeforeLLMCallAction,
} from "./hook-validators.js";
import type {
  AfterLLMCallAction,
  AfterLLMCallControllerContext,
  AfterLLMErrorAction,
  AgentHooks,
  BeforeLLMCallAction,
  LLMCallControllerContext,
  LLMErrorControllerContext,
  ObserveLLMCallContext,
  ObserveLLMCallReadyContext,
  ObserveLLMCompleteContext,
  ObserveLLMErrorContext,
} from "./hooks.js";
import { safeObserve } from "./safe-observe.js";
import { getSubagentContextForNode } from "./tree-hook-bridge.js";

// ============================================================================
// Constructor options
// ============================================================================

/**
 * Options for constructing an LLMCallLifecycle instance.
 *
 * All dependencies are injected from the owning Agent so the lifecycle
 * helper remains stateless beyond what it receives here.
 */
export interface LLMCallLifecycleOptions {
  /** The LLMist client used to resolve model specs and pricing */
  client: LLMist;
  /** Conversation manager holding current message history */
  conversation: ConversationManager;
  /** Execution tree for node creation and cost tracking */
  tree: ExecutionTree;
  /** Agent hooks (observers, interceptors, controllers) */
  hooks: AgentHooks;
  /** Logger instance */
  logger: Logger<ILogObj>;
  /** Rate limit tracker (optional) */
  rateLimitTracker?: RateLimitTracker;
  /** Optional abort signal */
  signal?: AbortSignal;
  /** Temperature override */
  temperature?: number;
  /** Reasoning configuration */
  reasoning?: ReasoningConfig;
  /** Caching configuration */
  caching?: CachingConfig;
  /** Model ID (resolved) */
  model: string;
  /** Default max tokens from model catalog */
  defaultMaxTokens?: number;
  /** Maximum iterations configured for the agent */
  maxIterations: number;
  /** Budget limit in USD (optional) */
  budget?: number;
  /** Parent node ID for tree hierarchy (null for root agent) */
  parentNodeId: NodeId | null;
}

// ============================================================================
// LLMCallLifecycle
// ============================================================================

/**
 * LLMCallLifecycle: Stateless helper that encapsulates LLM call lifecycle logic.
 *
 * Provides four public methods:
 * - `prepareLLMCall(iteration, nodeId)` — builds options, creates tree node, fires hooks
 * - `completeLLMCall(nodeId, metadata)` — fires onLLMCallComplete, updates tree with cost
 * - `notifyLLMCallReady(iteration, nodeId, options)` — fires onLLMCallReady observer
 * - `notifyLLMError(iteration, nodeId, error)` — fires onLLMError observer + controller
 *
 * @example
 * ```typescript
 * const lifecycle = new LLMCallLifecycle({ client, conversation, tree, hooks, logger, ... });
 *
 * const prepared = await lifecycle.prepareLLMCall(iteration);
 * // ... run the LLM stream ...
 * await lifecycle.completeLLMCall(prepared.llmNodeId, streamResult, iteration, prepared.options, gadgetCallCount);
 * ```
 */
export class LLMCallLifecycle {
  private readonly client: LLMist;
  private readonly conversation: ConversationManager;
  private readonly tree: ExecutionTree;
  private readonly hooks: AgentHooks;
  private readonly logger: Logger<ILogObj>;
  private readonly rateLimitTracker?: RateLimitTracker;
  private readonly signal?: AbortSignal;
  private readonly temperature?: number;
  private readonly reasoning?: ReasoningConfig;
  private readonly caching?: CachingConfig;
  private readonly model: string;
  private readonly defaultMaxTokens?: number;
  private readonly maxIterations: number;
  private readonly budget?: number;
  private readonly parentNodeId: NodeId | null;

  constructor(options: LLMCallLifecycleOptions) {
    this.client = options.client;
    this.conversation = options.conversation;
    this.tree = options.tree;
    this.hooks = options.hooks;
    this.logger = options.logger;
    this.rateLimitTracker = options.rateLimitTracker;
    this.signal = options.signal;
    this.temperature = options.temperature;
    this.reasoning = options.reasoning;
    this.caching = options.caching;
    this.model = options.model;
    this.defaultMaxTokens = options.defaultMaxTokens;
    this.maxIterations = options.maxIterations;
    this.budget = options.budget;
    this.parentNodeId = options.parentNodeId;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Prepare LLM call options, create a tree node, and process lifecycle hooks.
   *
   * Fires `onLLMCallStart` and `onLLMCallReady` observers, and runs the
   * `beforeLLMCall` controller (which may skip the call or modify options).
   *
   * @param iteration - Current agent iteration number
   * @returns Resolved options, node ID, and optional skip-with-synthetic response
   */
  async prepareLLMCall(
    iteration: number,
  ): Promise<{ options: LLMGenerationOptions; llmNodeId: string; skipWithSynthetic?: string }> {
    // Resolve reasoning config: explicit config > auto-enable for reasoning models > none
    const spec = this.client.modelRegistry?.getModelSpec?.(this.model);
    const reasoning = this.resolveReasoningConfig(spec);

    // Resolve caching config: explicit config > default enabled
    const caching = this.resolveCachingConfig();

    let llmOptions: LLMGenerationOptions = {
      model: this.model,
      messages: this.conversation.getMessages(),
      temperature: this.temperature,
      maxTokens: this.defaultMaxTokens,
      signal: this.signal,
      reasoning,
      caching,
    };

    // Create LLM call node in execution tree BEFORE hooks
    // This allows hooks to receive SubagentContext
    const llmNode = this.tree.addLLMCall({
      iteration,
      model: llmOptions.model,
      parentId: this.parentNodeId,
      request: llmOptions.messages,
    });

    // Observer: LLM call start
    await safeObserve(async () => {
      if (this.hooks.observers?.onLLMCallStart) {
        const subagentContext = getSubagentContextForNode(this.tree, llmNode.id);
        const context: ObserveLLMCallContext = {
          iteration,
          options: llmOptions,
          logger: this.logger,
          subagentContext,
        };
        await this.hooks.observers.onLLMCallStart(context);
      }
    }, this.logger);

    // Controller: Before LLM call
    if (this.hooks.controllers?.beforeLLMCall) {
      const context: LLMCallControllerContext = {
        iteration,
        maxIterations: this.maxIterations,
        budget: this.budget,
        totalCost: this.tree.getTotalCost(),
        options: llmOptions,
        logger: this.logger,
      };
      const action: BeforeLLMCallAction = await this.hooks.controllers.beforeLLMCall(context);

      // Validate the action
      validateBeforeLLMCallAction(action);

      if (action.action === "skip") {
        this.logger.info("Controller skipped LLM call, using synthetic response");
        return {
          options: llmOptions,
          llmNodeId: llmNode.id,
          skipWithSynthetic: action.syntheticResponse,
        };
      } else if (action.action === "proceed" && action.modifiedOptions) {
        llmOptions = { ...llmOptions, ...action.modifiedOptions };
      }
    }

    // Observer: LLM call ready (after controller modifications)
    await safeObserve(async () => {
      if (this.hooks.observers?.onLLMCallReady) {
        const subagentContext = getSubagentContextForNode(this.tree, llmNode.id);
        const context: ObserveLLMCallReadyContext = {
          iteration,
          maxIterations: this.maxIterations,
          budget: this.budget,
          totalCost: this.tree.getTotalCost(),
          options: llmOptions,
          logger: this.logger,
          subagentContext,
        };
        await this.hooks.observers.onLLMCallReady(context);
      }
    }, this.logger);

    return { options: llmOptions, llmNodeId: llmNode.id };
  }

  /**
   * Complete an LLM call: fire `onLLMCallComplete` observer, update the execution
   * tree with cost, and process the `afterLLMCall` controller.
   *
   * @param nodeId - The execution tree node ID for this call
   * @param result - The stream completion event with usage, finishReason, etc.
   * @param iteration - Current agent iteration number
   * @param llmOptions - The options that were used for the LLM call
   * @param gadgetCallCount - Number of gadget calls in this response
   * @returns The (possibly modified) final message
   */
  async completeLLMCall(
    nodeId: NodeId,
    result: StreamCompletionEvent,
    iteration: number,
    llmOptions: LLMGenerationOptions,
    gadgetCallCount: number,
  ): Promise<string> {
    // Observer: LLM call complete
    await safeObserve(async () => {
      if (this.hooks.observers?.onLLMCallComplete) {
        const subagentContext = getSubagentContextForNode(this.tree, nodeId);
        const context: ObserveLLMCompleteContext = {
          iteration,
          options: llmOptions,
          finishReason: result.finishReason,
          usage: result.usage,
          rawResponse: result.rawResponse,
          finalMessage: result.finalMessage,
          thinkingContent: result.thinkingContent,
          logger: this.logger,
          subagentContext,
        };
        await this.hooks.observers.onLLMCallComplete(context);
      }
    }, this.logger);

    // Complete LLM call in execution tree (with cost calculation)
    this.completeLLMCallInTree(nodeId, result);

    // Process afterLLMCall controller (may modify finalMessage or append messages)
    return this.processAfterLLMCallController(iteration, llmOptions, result, gadgetCallCount);
  }

  /**
   * Notify the `onLLMCallReady` observer with the given options.
   *
   * Called separately when the caller needs to fire the ready hook outside the
   * normal `prepareLLMCall` flow (e.g., after an interrupted call is resumed).
   *
   * @param iteration - Current agent iteration number
   * @param nodeId - The execution tree node ID
   * @param options - The final LLM options (after any controller modifications)
   */
  async notifyLLMCallReady(
    iteration: number,
    nodeId: NodeId,
    options: LLMGenerationOptions,
  ): Promise<void> {
    await safeObserve(async () => {
      if (this.hooks.observers?.onLLMCallReady) {
        const subagentContext = getSubagentContextForNode(this.tree, nodeId);
        const context: ObserveLLMCallReadyContext = {
          iteration,
          maxIterations: this.maxIterations,
          budget: this.budget,
          totalCost: this.tree.getTotalCost(),
          options,
          logger: this.logger,
          subagentContext,
        };
        await this.hooks.observers.onLLMCallReady(context);
      }
    }, this.logger);
  }

  /**
   * Notify the `onLLMCallError` observer and invoke the `afterLLMError` controller.
   *
   * Returns the controller's action result (either "rethrow" or "recover" with a
   * fallback response). The caller is responsible for acting on the returned action.
   *
   * @param iteration - Current agent iteration number
   * @param nodeId - The execution tree node ID (may be undefined if error occurred before node creation)
   * @param error - The error that occurred
   * @returns The AfterLLMErrorAction (or a default "rethrow" action if no controller is set)
   */
  async notifyLLMError(
    iteration: number,
    nodeId: string | undefined,
    error: Error,
  ): Promise<AfterLLMErrorAction> {
    this.logger.error("LLM call failed", { error: error.message });

    let action: AfterLLMErrorAction = { action: "rethrow" };

    if (this.hooks.controllers?.afterLLMError) {
      const context: LLMErrorControllerContext = {
        iteration,
        options: {
          model: this.model,
          messages: this.conversation.getMessages(),
          temperature: this.temperature,
          maxTokens: this.defaultMaxTokens,
        },
        error,
        logger: this.logger,
      };
      action = await this.hooks.controllers.afterLLMError(context);

      // Validate the action
      validateAfterLLMErrorAction(action);
    }

    // Observer: LLM error (fires after controller so `recovered` reflects controller decision)
    const recovered = action.action === "recover";
    await safeObserve(async () => {
      if (this.hooks.observers?.onLLMCallError) {
        const subagentContext = nodeId ? getSubagentContextForNode(this.tree, nodeId) : undefined;
        const context: ObserveLLMErrorContext = {
          iteration,
          options: {
            model: this.model,
            messages: this.conversation.getMessages(),
            temperature: this.temperature,
            maxTokens: this.defaultMaxTokens,
          },
          error,
          recovered,
          logger: this.logger,
          subagentContext,
        };
        await this.hooks.observers.onLLMCallError(context);
      }
    }, this.logger);

    return action;
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Resolve reasoning configuration with auto-enable logic.
   *
   * Priority: explicit config > auto-enable for reasoning models > undefined
   * When a model has `features.reasoning: true` and no explicit config is set,
   * reasoning is automatically enabled at "medium" effort.
   */
  private resolveReasoningConfig(spec: ModelSpec | undefined): ReasoningConfig | undefined {
    // Explicit config always wins
    if (this.reasoning !== undefined) return this.reasoning;
    // Auto-enable for reasoning-capable models
    if (spec?.features?.reasoning) {
      return { enabled: true, effort: "medium" };
    }
    return undefined;
  }

  /**
   * Resolve caching configuration.
   *
   * Priority: explicit config > default enabled (preserves Anthropic's existing behavior)
   * Default is `{ enabled: true }` which means:
   * - Anthropic: `cache_control` markers are added (existing behavior preserved)
   * - Gemini: Cache manager is consulted but skips if no explicit config was set
   * - OpenAI: No-op (server-side automatic)
   */
  private resolveCachingConfig(): CachingConfig | undefined {
    // Explicit config always wins
    if (this.caching !== undefined) return this.caching;
    // Default: enabled (preserves Anthropic's existing always-on caching behavior)
    return { enabled: true };
  }

  /**
   * Calculate cost and complete LLM call in execution tree.
   * Also records usage to rate limit tracker for proactive throttling.
   */
  private completeLLMCallInTree(nodeId: NodeId, result: StreamCompletionEvent): void {
    const inputTokens = result.usage?.inputTokens ?? 0;
    const outputTokens = result.usage?.outputTokens ?? 0;

    // Record usage to rate limit tracker for proactive throttling
    if (this.rateLimitTracker) {
      this.rateLimitTracker.recordUsage(inputTokens, outputTokens);
    }

    // Calculate cost using ModelRegistry (if available)
    const llmCost = this.client.modelRegistry?.estimateCost?.(
      this.model,
      inputTokens,
      outputTokens,
      result.usage?.cachedInputTokens ?? 0,
      result.usage?.cacheCreationInputTokens ?? 0,
      result.usage?.reasoningTokens ?? 0,
    )?.totalCost;

    // Complete LLM call in execution tree (including cost for automatic aggregation)
    this.tree.completeLLMCall(nodeId, {
      response: result.rawResponse,
      usage: result.usage,
      finishReason: result.finishReason,
      cost: llmCost,
      thinkingContent: result.thinkingContent,
    });
  }

  /**
   * Process afterLLMCall controller and return modified final message.
   *
   * Skips controller invocation for interrupted calls (`finishReason === "interrupted"`)
   * to preserve the original Agent behavior: the `afterLLMCall` controller was never
   * invoked for interrupted calls in the pre-extraction code. Skipping it here prevents
   * side effects (e.g., `append_messages` mutating conversation state) during cleanup
   * of an already-exited run loop.
   */
  private async processAfterLLMCallController(
    iteration: number,
    llmOptions: LLMGenerationOptions,
    result: StreamCompletionEvent,
    gadgetCallCount: number,
  ): Promise<string> {
    let finalMessage = result.finalMessage;

    // Skip controller for interrupted calls — the run loop has already exited,
    // so controller side effects (append_messages, append_and_modify) would mutate
    // conversation state with no subsequent LLM call to consume those messages.
    if (!this.hooks.controllers?.afterLLMCall || result.finishReason === "interrupted") {
      return finalMessage;
    }

    const context: AfterLLMCallControllerContext = {
      iteration,
      maxIterations: this.maxIterations,
      budget: this.budget,
      totalCost: this.tree.getTotalCost(),
      options: llmOptions,
      finishReason: result.finishReason,
      usage: result.usage,
      finalMessage: result.finalMessage,
      gadgetCallCount,
      logger: this.logger,
    };
    const action: AfterLLMCallAction = await this.hooks.controllers.afterLLMCall(context);

    // Validate the action
    validateAfterLLMCallAction(action);

    if (action.action === "modify_and_continue" || action.action === "append_and_modify") {
      finalMessage = action.modifiedMessage;
    }

    if (action.action === "append_messages" || action.action === "append_and_modify") {
      for (const msg of action.messages) {
        if (msg.role === "user") {
          this.conversation.addUserMessage(msg.content);
        } else if (msg.role === "assistant") {
          this.conversation.addAssistantMessage(extractMessageText(msg.content));
        } else if (msg.role === "system") {
          this.conversation.addUserMessage(`[System] ${extractMessageText(msg.content)}`);
        }
      }
    }

    return finalMessage;
  }
}
