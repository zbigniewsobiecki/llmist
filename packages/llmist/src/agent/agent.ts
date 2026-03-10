/**
 * Agent: Lean orchestrator using the clean hooks architecture.
 *
 * The Agent delegates ALL stream processing and hook coordination to StreamProcessor,
 * making it a simple loop orchestrator with clear responsibilities.
 */

import type { ILogObj, Logger } from "tslog";
import type { LLMist } from "../core/client.js";
import { ExecutionTree, type NodeId } from "../core/execution-tree.js";
import type { ContentPart } from "../core/input-content.js";
import type { MessageContent } from "../core/messages.js";
import { LLMMessageBuilder } from "../core/messages.js";
import { resolveModel } from "../core/model-shortcuts.js";
import type { CachingConfig, LLMGenerationOptions, ReasoningConfig } from "../core/options.js";
import type { PromptTemplateConfig } from "../core/prompt-config.js";
import type { RateLimitConfig } from "../core/rate-limit.js";
import { RateLimitTracker, resolveRateLimitConfig } from "../core/rate-limit.js";
import type { ResolvedRetryConfig, RetryConfig } from "../core/retry.js";
import { resolveRetryConfig } from "../core/retry.js";
import { BudgetPricingUnavailableError } from "../gadgets/exceptions.js";
import { MediaStore } from "../gadgets/media-store.js";
import type { GadgetRegistry } from "../gadgets/registry.js";
import type {
  AgentContextConfig,
  GadgetExecutionMode,
  StreamCompletionEvent,
  StreamEvent,
  SubagentConfigMap,
  TextOnlyHandler,
} from "../gadgets/types.js";
import { createLogger } from "../logging/logger.js";
import { type AGENT_INTERNAL_KEY, isValidAgentKey } from "./agent-internal-key.js";
import type { CompactionConfig, CompactionEvent, CompactionStats } from "./compaction/config.js";
import { CompactionManager } from "./compaction/manager.js";
import { ConversationManager } from "./conversation-manager.js";
import { ConversationUpdater } from "./conversation-updater.js";
import { type EventHandlers, runWithHandlers } from "./event-handlers.js";
import type {
  AgentHooks,
  ObserveAbortContext,
  ObserveRateLimitThrottleContext,
  Observers,
} from "./hooks.js";
import type { IConversationManager } from "./interfaces.js";
import { LLMCallLifecycle } from "./llm-call-lifecycle.js";
import type { OutputLimitConfig } from "./output-limit-manager.js";
import { OutputLimitManager } from "./output-limit-manager.js";
import { RetryOrchestrator } from "./retry-orchestrator.js";
import { safeObserve } from "./safe-observe.js";
import { StreamProcessor } from "./stream-processor.js";
import { bridgeTreeToHooks, getSubagentContextForNode } from "./tree-hook-bridge.js";

/**
 * Configuration for the execution tree context (shared tree model with subagents).
 */
export interface TreeConfig {
  /**
   * Shared execution tree for tracking all LLM calls and gadget executions.
   * If provided (by a parent subagent), nodes are added to this tree.
   * If not provided, the Agent creates its own tree.
   */
  tree?: ExecutionTree;

  /**
   * Parent node ID in the tree (when this agent is a subagent).
   * Used to set parentId on all nodes created by this agent.
   */
  parentNodeId?: NodeId;

  /**
   * Base depth for nodes created by this agent.
   * Root agents use 0; subagents use (parentDepth + 1).
   */
  baseDepth?: number;

  /**
   * Parent agent's observer hooks for subagent visibility.
   *
   * When a subagent is created with withParentContext(ctx), these observers
   * are also called for gadget events (in addition to the subagent's own hooks),
   * enabling the parent to observe subagent gadget activity.
   */
  parentObservers?: Observers;
}

/**
 * Configuration for custom gadget block format prefixes.
 */
export interface PrefixConfig {
  /** Custom gadget start prefix */
  gadgetStartPrefix?: string;

  /** Custom gadget end prefix */
  gadgetEndPrefix?: string;

  /** Custom gadget argument prefix for block format parameters */
  gadgetArgPrefix?: string;
}

/**
 * Configuration options for the Agent.
 */
export interface AgentOptions {
  /** The LLM client */
  client: LLMist;

  /** The model ID */
  model: string;

  /** System prompt */
  systemPrompt?: string;

  /** Initial user prompt (optional if using build()). Can be text or multimodal content. */
  userPrompt?: string | ContentPart[];

  /** Maximum iterations */
  maxIterations?: number;

  /** Budget limit in USD. Agent loop stops when cumulative cost reaches this limit. */
  budget?: number;

  /** Temperature */
  temperature?: number;

  /** Gadget registry */
  registry: GadgetRegistry;

  /** Logger */
  logger?: Logger<ILogObj>;

  /** Clean hooks system */
  hooks?: AgentHooks;

  /** Callback for requesting human input during execution */
  requestHumanInput?: (question: string) => Promise<string>;

  /**
   * Gadget prefix configuration (start/end/arg prefixes for block format).
   * When set, takes precedence over the individual gadgetStartPrefix/gadgetEndPrefix/gadgetArgPrefix fields.
   */
  prefixConfig?: PrefixConfig;

  /** Custom gadget start prefix */
  gadgetStartPrefix?: string;

  /** Custom gadget end prefix */
  gadgetEndPrefix?: string;

  /** Custom gadget argument prefix for block format parameters */
  gadgetArgPrefix?: string;

  /** Initial messages. User messages support multimodal content. */
  initialMessages?: Array<{ role: "system" | "user" | "assistant"; content: MessageContent }>;

  /** Text-only handler */
  textOnlyHandler?: TextOnlyHandler;

  /**
   * Handler for text content that appears alongside gadget calls.
   * When set, text accompanying gadgets will be wrapped as a synthetic gadget call.
   */
  textWithGadgetsHandler?: {
    /** Name of the gadget to use for wrapping text */
    gadgetName: string;
    /** Maps text content to gadget parameters */
    parameterMapping: (text: string) => Record<string, unknown>;
    /** Maps text content to the result string (optional, defaults to text) */
    resultMapping?: (text: string) => string;
  };

  /** Default gadget timeout */
  defaultGadgetTimeoutMs?: number;

  /** Gadget execution mode: 'parallel' (default) or 'sequential' */
  gadgetExecutionMode?: GadgetExecutionMode;

  /** Custom prompt configuration for gadget system prompts */
  promptConfig?: PromptTemplateConfig;

  /**
   * Gadget output limit configuration.
   * When set, takes precedence over the individual gadgetOutputLimit/gadgetOutputLimitPercent fields.
   */
  outputLimitConfig?: OutputLimitConfig;

  /** Enable gadget output limiting (default: true) */
  gadgetOutputLimit?: boolean;

  /** Max gadget output as % of model context window (default: 15) */
  gadgetOutputLimitPercent?: number;

  /** Context compaction configuration (enabled by default) */
  compactionConfig?: CompactionConfig;

  /** Retry configuration for LLM API calls (enabled by default) */
  retryConfig?: RetryConfig;

  /** Rate limit configuration for proactive throttling */
  rateLimitConfig?: RateLimitConfig;

  /** Optional abort signal for cancelling requests mid-flight */
  signal?: AbortSignal;

  /** Reasoning/thinking configuration for reasoning-capable models */
  reasoning?: ReasoningConfig;

  /** Context caching configuration for supported providers */
  caching?: CachingConfig;

  /** Subagent-specific configuration overrides (from CLI config) */
  subagentConfig?: SubagentConfigMap;

  /** Maximum gadgets to execute per LLM response (0 = unlimited) */
  maxGadgetsPerResponse?: number;

  // ==========================================================================
  // Execution Tree Context (for shared tree model with subagents)
  // ==========================================================================

  /**
   * Execution tree configuration (shared tree model with subagents).
   * When set, takes precedence over the individual parentTree/parentNodeId/baseDepth/parentObservers fields.
   */
  treeConfig?: TreeConfig;

  /**
   * Shared execution tree for tracking all LLM calls and gadget executions.
   * If provided (by a parent subagent), nodes are added to this tree.
   * If not provided, the Agent creates its own tree.
   */
  parentTree?: ExecutionTree;

  /**
   * Parent node ID in the tree (when this agent is a subagent).
   * Used to set parentId on all nodes created by this agent.
   */
  parentNodeId?: NodeId;

  /**
   * Base depth for nodes created by this agent.
   * Root agents use 0; subagents use (parentDepth + 1).
   */
  baseDepth?: number;

  /**
   * Parent agent's observer hooks for subagent visibility.
   *
   * When a subagent is created with withParentContext(ctx), these observers
   * are also called for gadget events (in addition to the subagent's own hooks),
   * enabling the parent to observe subagent gadget activity.
   */
  parentObservers?: Observers;

  /**
   * Shared rate limit tracker from parent agent.
   *
   * When provided (via withParentContext), this agent uses the parent's tracker
   * instead of creating its own. All LLM calls count toward the shared limits.
   */
  sharedRateLimitTracker?: RateLimitTracker;

  /**
   * Shared retry configuration from parent agent.
   *
   * When provided (via withParentContext), this agent uses the parent's retry
   * settings instead of creating its own.
   */
  sharedRetryConfig?: ResolvedRetryConfig;
}

/**
 * Agent: Lean orchestrator that delegates to StreamProcessor.
 *
 * Responsibilities:
 * - Run the main agent loop
 * - Call LLM API
 * - Delegate stream processing to StreamProcessor
 * - Coordinate conversation management
 * - Execute top-level lifecycle controllers
 *
 * NOT responsible for:
 * - Stream parsing (StreamProcessor)
 * - Hook coordination (StreamProcessor)
 * - Gadget execution (StreamProcessor -> GadgetExecutor)
 */
export class Agent {
  private readonly client: LLMist;
  private readonly model: string;
  private readonly maxIterations: number;
  private readonly budget?: number;
  private readonly temperature?: number;
  private readonly logger: Logger<ILogObj>;
  private readonly hooks: AgentHooks;
  private readonly conversation: ConversationManager;
  private readonly registry: GadgetRegistry;
  private readonly gadgetStartPrefix?: string;
  private readonly gadgetEndPrefix?: string;
  private readonly gadgetArgPrefix?: string;
  private readonly requestHumanInput?: (question: string) => Promise<string>;
  private readonly conversationUpdater: ConversationUpdater;
  private readonly defaultGadgetTimeoutMs?: number;
  private readonly gadgetExecutionMode: GadgetExecutionMode;
  private readonly defaultMaxTokens?: number;
  private hasUserPrompt: boolean;

  // Gadget output limiting
  private readonly outputLimitManager: OutputLimitManager;

  // Context compaction
  private readonly compactionManager?: CompactionManager;

  // Media storage (for gadgets returning images, audio, etc.)
  private readonly mediaStore: MediaStore;

  // Cancellation
  private readonly signal?: AbortSignal;
  private readonly reasoning?: ReasoningConfig;
  private readonly caching?: CachingConfig;

  // Retry configuration
  private readonly retryConfig: ResolvedRetryConfig;

  // Rate limit tracker for proactive throttling
  private readonly rateLimitTracker?: RateLimitTracker;

  // Subagent configuration
  private readonly agentContextConfig: AgentContextConfig;
  private readonly subagentConfig?: SubagentConfigMap;

  // Gadget limiting
  private readonly maxGadgetsPerResponse: number;

  // Cross-iteration dependency tracking - allows gadgets to depend on results from prior iterations
  private readonly completedInvocationIds: Set<string> = new Set();
  private readonly failedInvocationIds: Set<string> = new Set();

  // Queue for user messages injected during agent execution (REPL mid-session input)
  private readonly pendingUserMessages: string[] = [];

  // Execution Tree - first-class model for nested subagent support
  private readonly tree: ExecutionTree;
  private readonly parentNodeId: NodeId | null;
  private readonly baseDepth: number;

  // Parent observer hooks for subagent visibility
  private readonly parentObservers?: Observers;

  // LLM call lifecycle helper (encapsulates prepareLLMCall, completeLLMCall, notifyLLMError)
  private readonly llmCallLifecycle: LLMCallLifecycle;

  /**
   * Creates a new Agent instance.
   * @internal This constructor is private. Use LLMist.createAgent() or AgentBuilder instead.
   */
  constructor(key: typeof AGENT_INTERNAL_KEY, options: AgentOptions) {
    if (!isValidAgentKey(key)) {
      throw new Error(
        "Agent cannot be instantiated directly. Use LLMist.createAgent() or new AgentBuilder() instead.",
      );
    }

    this.client = options.client;
    this.model = resolveModel(options.model);
    this.maxIterations = options.maxIterations ?? 10;
    this.budget = options.budget;
    this.temperature = options.temperature;
    this.logger = options.logger ?? createLogger({ name: "llmist:agent" });
    this.registry = options.registry;

    // Resolve prefix config: sub-config object takes precedence over individual fields
    const prefixConfig = options.prefixConfig;
    this.gadgetStartPrefix = prefixConfig?.gadgetStartPrefix ?? options.gadgetStartPrefix;
    this.gadgetEndPrefix = prefixConfig?.gadgetEndPrefix ?? options.gadgetEndPrefix;
    this.gadgetArgPrefix = prefixConfig?.gadgetArgPrefix ?? options.gadgetArgPrefix;

    this.requestHumanInput = options.requestHumanInput;
    this.defaultGadgetTimeoutMs = options.defaultGadgetTimeoutMs;
    this.gadgetExecutionMode = options.gadgetExecutionMode ?? "parallel";
    this.defaultMaxTokens = this.resolveMaxTokensFromCatalog(options.model);

    // Resolve output limit config: sub-config object takes precedence over individual fields
    const olc = options.outputLimitConfig;
    const outputLimitConfig: OutputLimitConfig = {
      enabled: olc?.enabled ?? options.gadgetOutputLimit,
      limitPercent: olc?.limitPercent ?? options.gadgetOutputLimitPercent,
    };

    // Initialize gadget output limiting
    this.outputLimitManager = new OutputLimitManager(
      this.client,
      this.model,
      outputLimitConfig,
      this.registry,
      this.logger,
    );

    // Initialize media storage for gadgets returning images, audio, etc.
    this.mediaStore = new MediaStore();

    // Chain output limiter interceptor with user hooks
    this.hooks = this.outputLimitManager.getHooks(options.hooks);

    // Build conversation
    const baseBuilder = new LLMMessageBuilder(options.promptConfig);
    if (options.systemPrompt) {
      baseBuilder.addSystem(options.systemPrompt);
    }

    baseBuilder.addGadgets(this.registry.getAll(), {
      startPrefix: this.gadgetStartPrefix,
      endPrefix: this.gadgetEndPrefix,
      argPrefix: this.gadgetArgPrefix,
    });
    const baseMessages = baseBuilder.build();

    const initialMessages = (options.initialMessages ?? []).map((message) => ({
      role: message.role,
      content: message.content,
    }));

    this.conversation = new ConversationManager(baseMessages, initialMessages, {
      startPrefix: this.gadgetStartPrefix,
      endPrefix: this.gadgetEndPrefix,
      argPrefix: this.gadgetArgPrefix,
    });
    this.hasUserPrompt = !!options.userPrompt;
    if (options.userPrompt) {
      this.conversation.addUserMessage(options.userPrompt);
    }

    // Initialize conversation updater (owns text-only and text-with-gadgets handling)
    this.conversationUpdater = new ConversationUpdater(
      this.conversation,
      options.textOnlyHandler ?? "terminate",
      options.textWithGadgetsHandler,
      this.logger,
    );

    // Initialize context compaction (enabled by default)
    const compactionEnabled = options.compactionConfig?.enabled ?? true;
    if (compactionEnabled) {
      this.compactionManager = new CompactionManager(
        this.client,
        this.model,
        options.compactionConfig,
      );
    }

    // Store abort signal for cancellation
    this.signal = options.signal;

    // Store reasoning configuration
    this.reasoning = options.reasoning;

    // Store caching configuration
    this.caching = options.caching;

    // Initialize retry configuration
    // Prefer shared config from parent (for coordinated retry across subagents)
    this.retryConfig = options.sharedRetryConfig ?? resolveRetryConfig(options.retryConfig);

    // Initialize rate limit tracker for proactive throttling
    // Prefer shared tracker from parent (for coordinated limits across subagents)
    if (options.sharedRateLimitTracker) {
      this.rateLimitTracker = options.sharedRateLimitTracker;
    } else {
      const rateLimitConfig = resolveRateLimitConfig(options.rateLimitConfig);
      if (rateLimitConfig.enabled) {
        this.rateLimitTracker = new RateLimitTracker(options.rateLimitConfig);
      }
    }

    // Build agent context config for subagents to inherit
    this.agentContextConfig = {
      model: this.model,
      temperature: this.temperature,
    };
    this.subagentConfig = options.subagentConfig;

    // Initialize gadget limiting (0 = unlimited)
    this.maxGadgetsPerResponse = options.maxGadgetsPerResponse ?? 0;

    // Resolve tree config: sub-config object takes precedence over individual fields
    const treeConfig = options.treeConfig;
    // Initialize Execution Tree
    // If a parent tree is provided (subagent case), share it; otherwise create a new tree
    this.tree = treeConfig?.tree ?? options.parentTree ?? new ExecutionTree();
    this.parentNodeId = treeConfig?.parentNodeId ?? options.parentNodeId ?? null;
    this.baseDepth = treeConfig?.baseDepth ?? options.baseDepth ?? 0;
    this.parentObservers = treeConfig?.parentObservers ?? options.parentObservers;

    // Initialize LLM call lifecycle helper
    this.llmCallLifecycle = new LLMCallLifecycle({
      client: this.client,
      conversation: this.conversation,
      tree: this.tree,
      hooks: this.hooks,
      logger: this.logger,
      rateLimitTracker: this.rateLimitTracker,
      signal: this.signal,
      temperature: this.temperature,
      reasoning: this.reasoning,
      caching: this.caching,
      model: this.model,
      defaultMaxTokens: this.defaultMaxTokens,
      maxIterations: this.maxIterations,
      budget: this.budget,
      parentNodeId: this.parentNodeId,
    });

    // Validate budget against model pricing
    if (this.budget !== undefined) {
      const spec = this.client.modelRegistry?.getModelSpec?.(this.model);
      if (!spec || (spec.pricing.input === 0 && spec.pricing.output === 0)) {
        throw new BudgetPricingUnavailableError(this.model, this.budget);
      }
    }
  }

  /**
   * Get the gadget registry for this agent.
   *
   * Useful for inspecting registered gadgets in tests or advanced use cases.
   *
   * @returns The GadgetRegistry instance
   *
   * @example
   * ```typescript
   * const agent = new AgentBuilder()
   *   .withModel("sonnet")
   *   .withGadgets(Calculator, Weather)
   *   .build();
   *
   * // Inspect registered gadgets
   * console.log(agent.getRegistry().getNames()); // ['Calculator', 'Weather']
   * ```
   */
  getRegistry(): GadgetRegistry {
    return this.registry;
  }

  /**
   * Get the media store for this agent session.
   *
   * The media store holds all media outputs (images, audio, etc.) produced by gadgets
   * during this agent's execution. Use this to:
   * - Access stored media files by ID
   * - List all stored media
   * - Clean up temporary files after execution
   *
   * @returns The MediaStore instance for this agent
   *
   * @example
   * ```typescript
   * const agent = new AgentBuilder()
   *   .withModel("sonnet")
   *   .build();
   *
   * // After execution, access stored media
   * const store = agent.getMediaStore();
   * for (const media of store.list()) {
   *   console.log(`${media.id}: ${media.path}`);
   * }
   *
   * // Clean up when done
   * await store.cleanup();
   * ```
   */
  getMediaStore(): MediaStore {
    return this.mediaStore;
  }

  /**
   * Get the execution tree for this agent.
   *
   * The execution tree provides a first-class model of all LLM calls and gadget executions,
   * including nested subagent activity. Use this to:
   * - Query execution state: `tree.getNode(id)`
   * - Get total cost: `tree.getTotalCost()`
   * - Get subtree cost/media/tokens: `tree.getSubtreeCost(nodeId)`
   * - Subscribe to events: `tree.on("llm_call_complete", handler)`
   * - Stream all events: `for await (const event of tree.events())`
   *
   * For subagents (created with `withParentContext`), the tree is shared with the parent,
   * enabling unified tracking and real-time visibility across all nesting levels.
   *
   * @returns The ExecutionTree instance
   *
   * @example
   * ```typescript
   * const agent = LLMist.createAgent()
   *   .withModel("sonnet")
   *   .withGadgets(BrowseWeb)
   *   .ask("Research topic X");
   *
   * for await (const event of agent.run()) {
   *   // Process events...
   * }
   *
   * // After execution, query the tree
   * const tree = agent.getTree();
   * console.log(`Total cost: $${tree.getTotalCost().toFixed(4)}`);
   *
   * // Inspect all LLM calls
   * for (const node of tree.getAllNodes()) {
   *   if (node.type === "llm_call") {
   *     console.log(`LLM #${node.iteration}: ${node.model}`);
   *   }
   * }
   * ```
   */
  getTree(): ExecutionTree {
    return this.tree;
  }

  /**
   * Manually trigger context compaction.
   *
   * Forces compaction regardless of threshold. Useful for:
   * - Pre-emptive context management before expected long operations
   * - Testing compaction behavior
   *
   * @returns CompactionEvent if compaction was performed, null if not configured or no history
   *
   * @example
   * ```typescript
   * const agent = await LLMist.createAgent()
   *   .withModel('sonnet')
   *   .withCompaction()
   *   .ask('...');
   *
   * // Manually compact before a long operation
   * const event = await agent.compact();
   * if (event) {
   *   console.log(`Saved ${event.tokensBefore - event.tokensAfter} tokens`);
   * }
   * ```
   */
  async compact(): Promise<CompactionEvent | null> {
    if (!this.compactionManager) {
      return null;
    }
    // Use -1 to indicate manual (out-of-band) compaction, not part of the normal iteration cycle
    return this.compactionManager.compact(this.conversation, -1);
  }

  /**
   * Get compaction statistics.
   *
   * @returns CompactionStats if compaction is enabled, null otherwise
   *
   * @example
   * ```typescript
   * const stats = agent.getCompactionStats();
   * if (stats) {
   *   console.log(`Total compactions: ${stats.totalCompactions}`);
   *   console.log(`Tokens saved: ${stats.totalTokensSaved}`);
   *   console.log(`Current usage: ${stats.currentUsage.percent.toFixed(1)}%`);
   * }
   * ```
   */
  getCompactionStats(): CompactionStats | null {
    return this.compactionManager?.getStats() ?? null;
  }

  /**
   * Get the conversation manager for this agent.
   * Used by REPL mode to extract session history for continuation.
   *
   * @returns The conversation manager containing all messages
   *
   * @example
   * ```typescript
   * // After running agent, extract history for next session
   * const history = agent.getConversation().getConversationHistory();
   * // Pass to next agent via builder.withHistory()
   * ```
   */
  getConversation(): IConversationManager {
    return this.conversation;
  }

  /**
   * Inject a user message to be processed in the next iteration.
   * Used by REPL mode to allow user input during a running session.
   *
   * The message is queued and will be added to the conversation before
   * the next LLM call. This allows users to provide additional context
   * or instructions while the agent is executing.
   *
   * @param message - The user message to inject
   *
   * @example
   * ```typescript
   * // While agent is running in TUI:
   * tui.onMidSessionInput((msg) => {
   *   agent.injectUserMessage(msg);
   * });
   * ```
   */
  injectUserMessage(message: string): void {
    this.pendingUserMessages.push(message);
    this.logger.debug("User message queued for injection", { message });
  }

  /**
   * Run the agent loop.
   * Clean, simple orchestration - all complexity is in StreamProcessor.
   *
   * ## Event Architecture
   *
   * ExecutionTree is the single source of truth for all agent events.
   * Gadget observer hooks (`onGadgetExecutionStart`, `onGadgetExecutionComplete`,
   * `onGadgetSkipped`) are derived from tree events via `tree-hook-bridge.ts`.
   * This ensures consistent `subagentContext` for nested agents - both the TUI
   * and user hook observers receive identical event context.
   *
   * @throws {Error} If no user prompt was provided (when using build() without ask())
   */
  async *run(): AsyncGenerator<StreamEvent> {
    if (!this.hasUserPrompt) {
      throw new Error(
        "No user prompt provided. Use .ask(prompt) instead of .build(), or call agent.run() after providing a prompt.",
      );
    }

    // Bridge ExecutionTree events to hook observers for gadget events.
    // This is the single source of truth - tree events trigger hooks with proper subagentContext.
    const unsubscribeBridge = bridgeTreeToHooks(this.tree, this.hooks, this.logger);

    let currentIteration = 0;

    this.logger.info("Starting agent loop", {
      model: this.model,
      maxIterations: this.maxIterations,
      ...(this.budget !== undefined && { budget: this.budget }),
    });

    // Declare outside while loop so they're accessible in the finally block
    // for safety net completion of in-flight LLM calls
    let currentLLMNodeId: string | undefined;
    let llmOptions: LLMGenerationOptions | undefined;

    try {
      while (currentIteration < this.maxIterations) {
        // Check abort signal at start of each iteration
        if (await this.checkAbortAndNotify(currentIteration)) {
          return;
        }

        // Process any injected user messages (from REPL mid-session input)
        while (this.pendingUserMessages.length > 0) {
          const msg = this.pendingUserMessages.shift()!;
          this.conversation.addUserMessage(msg);
          this.logger.info("Injected user message into conversation", {
            iteration: currentIteration,
            messageLength: msg.length,
          });
        }

        this.logger.debug("Starting iteration", { iteration: currentIteration });

        try {
          // Check and perform context compaction if needed
          const compactionEvent = await this.checkAndPerformCompaction(currentIteration);
          if (compactionEvent) {
            yield compactionEvent;
          }

          // Prepare LLM call (creates tree node and calls onLLMCallStart/Ready hooks)
          const prepared = await this.llmCallLifecycle.prepareLLMCall(currentIteration);
          llmOptions = prepared.options;
          currentLLMNodeId = prepared.llmNodeId;

          // Handle skip action from beforeLLMCall controller
          if (prepared.skipWithSynthetic !== undefined) {
            this.conversation.addAssistantMessage(prepared.skipWithSynthetic);
            yield { type: "text", content: prepared.skipWithSynthetic };
            break;
          }

          // Call LLM
          this.logger.info("Calling LLM", { model: this.model });
          this.logger.silly("LLM request details", {
            model: llmOptions.model,
            temperature: llmOptions.temperature,
            maxTokens: llmOptions.maxTokens,
            messageCount: llmOptions.messages.length,
            messages: llmOptions.messages,
          });

          // Stream creation and iteration with retry for errors during streaming.
          // All retry orchestration is encapsulated in executeWithRetry(), which also
          // tracks textOutputs, gadgetResults, and gadgetCallCount — resetting them
          // between retry attempts so only data from the final successful attempt is returned.

          // Iterate the retry generator manually to capture its return value (stream metadata
          // and accumulated tracking state). for-await-of discards the generator's final
          // done-value, so we use .next() directly.
          const retryGen = this.executeWithRetry(llmOptions, currentIteration, currentLLMNodeId);
          let next = await retryGen.next();
          while (!next.done) {
            // Yield event to consumer in real-time
            yield next.value;
            next = await retryGen.next();
          }
          // When done === true, the value is the generator's return value
          const retryResult = next.value;

          // Ensure we received the completion metadata
          if (!retryResult) {
            throw new Error("Stream processing completed without metadata event");
          }

          const { streamMetadata, textOutputs, gadgetResults, gadgetCallCount } = retryResult;

          // Use streamMetadata as the result for remaining logic
          const result = streamMetadata;

          this.logger.info("LLM response completed", {
            finishReason: result.finishReason,
            usage: result.usage,
            didExecuteGadgets: result.didExecuteGadgets,
          });
          this.logger.silly("LLM response details", {
            rawResponse: result.rawResponse,
          });

          // Complete LLM call: fire onLLMCallComplete observer, update tree with cost,
          // process afterLLMCall controller (may modify finalMessage or append messages)
          const finalMessage = await this.llmCallLifecycle.completeLLMCall(
            currentLLMNodeId!,
            result,
            currentIteration,
            llmOptions!,
            gadgetCallCount,
          );

          // Update conversation with results (gadgets or text-only)
          const shouldBreakFromTextOnly = this.conversationUpdater.updateWithResults(
            textOutputs,
            gadgetResults,
            finalMessage,
          );
          if (shouldBreakFromTextOnly) {
            break;
          }

          // Check if loop should break
          if (result.shouldBreakLoop) {
            this.logger.info("Loop terminated by gadget or processor");
            break;
          }

          // Check if budget limit has been reached
          if (this.budget !== undefined) {
            const totalCost = this.tree.getTotalCost();
            if (totalCost >= this.budget) {
              this.logger.info("Budget limit reached", {
                totalCost,
                budget: this.budget,
                iteration: currentIteration,
              });
              break;
            }
          }
        } catch (error) {
          // Delegate error handling and observer notification to lifecycle helper
          const action = await this.llmCallLifecycle.notifyLLMError(
            currentIteration,
            currentLLMNodeId,
            error as Error,
          );

          if (action.action === "recover") {
            this.logger.info("Controller recovered from LLM error");
            this.conversation.addAssistantMessage(action.fallbackResponse);
          } else {
            throw error;
          }
        }

        currentIteration++;
      }

      let reason: string;
      if (this.budget !== undefined && this.tree.getTotalCost() >= this.budget) {
        reason = "budget_exceeded";
      } else if (currentIteration >= this.maxIterations) {
        reason = "max_iterations";
      } else {
        reason = "natural_completion";
      }

      this.logger.info("Agent loop completed", {
        totalIterations: currentIteration,
        reason,
        ...(this.budget !== undefined && {
          totalCost: this.tree.getTotalCost(),
          budget: this.budget,
        }),
      });
    } finally {
      // Safety net: Complete any in-flight LLM call if generator terminated early
      // This handles cases where consumers break from for-await loop prematurely
      if (currentLLMNodeId) {
        const node = this.tree.getNode(currentLLMNodeId);
        if (node && node.type === "llm_call" && !node.completedAt) {
          // Delegate to lifecycle helper: fires onLLMCallComplete observer and updates tree
          await this.llmCallLifecycle.completeLLMCall(
            currentLLMNodeId,
            {
              type: "stream_complete",
              finishReason: "interrupted",
              usage: undefined,
              rawResponse: "", // No response available for interrupted request
              finalMessage: "", // No final message for interrupted request
              didExecuteGadgets: false,
              shouldBreakLoop: false,
            },
            currentIteration,
            llmOptions ?? {
              model: this.model,
              messages: this.conversation.getMessages(),
              temperature: this.temperature,
              maxTokens: this.defaultMaxTokens,
            },
            0, // gadgetCallCount: no gadgets for interrupted call
          );
        }
      }

      // Always clean up the bridge subscription
      unsubscribeBridge();
    }
  }

  /**
   * Execute a single LLM call attempt with full retry orchestration.
   *
   * Delegates all retry logic to RetryOrchestrator, then propagates the accumulated
   * invocation IDs back to the agent's cross-iteration tracking sets.
   *
   * Yields stream events in real-time and returns the final stream completion metadata
   * along with accumulated tracking state from the final successful attempt only.
   */
  private async *executeWithRetry(
    llmOptions: LLMGenerationOptions,
    currentIteration: number,
    currentLLMNodeId: string,
  ): AsyncGenerator<
    StreamEvent,
    {
      streamMetadata: StreamCompletionEvent;
      textOutputs: string[];
      gadgetResults: StreamEvent[];
      gadgetCallCount: number;
    } | null
  > {
    const orchestrator = new RetryOrchestrator({
      retryConfig: this.retryConfig,
      logger: this.logger,
      hooks: this.hooks,
      tree: this.tree,
      sleep: (ms) => this.sleep(ms),
    });

    const result = yield* orchestrator.orchestrate(
      llmOptions,
      currentIteration,
      currentLLMNodeId,
      (opts, iter, nodeId) => this.createStream(opts, iter, nodeId),
      (iter, nodeId) => this.createStreamProcessor(iter, nodeId),
    );

    // Propagate accumulated invocation IDs to agent's cross-iteration tracking
    for (const id of orchestrator.getCompletedInvocationIds()) {
      this.completedInvocationIds.add(id);
    }
    for (const id of orchestrator.getFailedInvocationIds()) {
      this.failedInvocationIds.add(id);
    }

    return result;
  }

  /**
   * Create LLM stream with proactive rate limit protection.
   *
   * Note: Retry logic for errors during streaming is handled by the outer loop in run().
   * This method only handles proactive rate limiting (delaying requests to stay within limits).
   */
  private async createStream(
    llmOptions: LLMGenerationOptions,
    iteration: number,
    llmNodeId: string,
  ): Promise<ReturnType<LLMist["stream"]>> {
    // Proactive rate limit throttling
    if (this.rateLimitTracker) {
      const throttleDelay = this.rateLimitTracker.getRequiredDelayMs();
      if (throttleDelay > 0) {
        this.logger.debug("Rate limit throttling", { delayMs: throttleDelay });

        // Emit observer hook for rate limit throttling
        await safeObserve(async () => {
          if (this.hooks.observers?.onRateLimitThrottle) {
            const subagentContext = getSubagentContextForNode(this.tree, llmNodeId);
            const context: ObserveRateLimitThrottleContext = {
              iteration,
              delayMs: throttleDelay,
              stats: this.rateLimitTracker!.getUsageStats(),
              logger: this.logger,
              subagentContext,
            };
            await this.hooks.observers.onRateLimitThrottle(context);
          }
        }, this.logger);

        await this.sleep(throttleDelay);
      }

      // Reserve a request slot BEFORE making the call
      // This ensures concurrent subagents see this pending request
      this.rateLimitTracker.reserveRequest();
    }

    return this.client.stream(llmOptions);
  }

  /**
   * Factory method for constructing a StreamProcessor for a given iteration.
   *
   * Encapsulates all StreamProcessor configuration, keeping executeWithRetry()
   * focused on retry orchestration rather than processor construction details.
   */
  private createStreamProcessor(iteration: number, llmNodeId: string): StreamProcessor {
    return new StreamProcessor({
      iteration,
      registry: this.registry,
      gadgetStartPrefix: this.gadgetStartPrefix,
      gadgetEndPrefix: this.gadgetEndPrefix,
      gadgetArgPrefix: this.gadgetArgPrefix,
      hooks: this.hooks,
      logger: this.logger.getSubLogger({ name: "stream-processor" }),
      requestHumanInput: this.requestHumanInput,
      defaultGadgetTimeoutMs: this.defaultGadgetTimeoutMs,
      gadgetExecutionMode: this.gadgetExecutionMode,
      client: this.client,
      mediaStore: this.mediaStore,
      agentConfig: this.agentContextConfig,
      subagentConfig: this.subagentConfig,
      // Tree context for execution tracking
      tree: this.tree,
      parentNodeId: llmNodeId, // Gadgets are children of this LLM call
      baseDepth: this.baseDepth,
      // Cross-iteration dependency tracking
      priorCompletedInvocations: this.completedInvocationIds,
      priorFailedInvocations: this.failedInvocationIds,
      // Parent observer hooks for subagent visibility
      parentObservers: this.parentObservers,
      // Shared rate limit tracker and retry config for subagents
      rateLimitTracker: this.rateLimitTracker,
      retryConfig: this.retryConfig,
      // Gadget limiting
      maxGadgetsPerResponse: this.maxGadgetsPerResponse,
    });
  }

  /**
   * Simple sleep utility for rate limit delays.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Resolve max tokens from model catalog.
   */
  private resolveMaxTokensFromCatalog(modelId: string): number | undefined {
    const limits = this.client.modelRegistry.getModelLimits(modelId);
    if (limits?.maxOutputTokens !== undefined) {
      return limits.maxOutputTokens;
    }

    const separatorIndex = modelId.indexOf(":");
    if (separatorIndex === -1) {
      return undefined;
    }

    const unprefixedModelId = modelId.slice(separatorIndex + 1).trim();
    if (!unprefixedModelId) {
      return undefined;
    }

    return this.client.modelRegistry.getModelLimits(unprefixedModelId)?.maxOutputTokens;
  }

  // ==========================================================================
  // Agent Loop Helper Methods (extracted from run() for readability)
  // ==========================================================================

  /**
   * Check abort signal and notify observers if aborted.
   * @returns true if agent should terminate
   */
  private async checkAbortAndNotify(iteration: number): Promise<boolean> {
    if (!this.signal?.aborted) return false;

    this.logger.info("Agent loop terminated by abort signal", {
      iteration,
      reason: this.signal.reason,
    });

    await safeObserve(async () => {
      if (this.hooks.observers?.onAbort) {
        const context: ObserveAbortContext = {
          iteration,
          reason: this.signal?.reason,
          logger: this.logger,
        };
        await this.hooks.observers.onAbort(context);
      }
    }, this.logger);

    return true;
  }

  /**
   * Check and perform context compaction if needed.
   * @returns compaction stream event if compaction occurred, null otherwise
   */
  private async checkAndPerformCompaction(iteration: number): Promise<StreamEvent | null> {
    if (!this.compactionManager) return null;

    const compactionEvent = await this.compactionManager.checkAndCompact(
      this.conversation,
      iteration,
    );

    if (!compactionEvent) return null;

    this.logger.info("Context compacted", {
      strategy: compactionEvent.strategy,
      tokensBefore: compactionEvent.tokensBefore,
      tokensAfter: compactionEvent.tokensAfter,
    });

    // Observer: Compaction occurred
    await safeObserve(async () => {
      if (this.hooks.observers?.onCompaction) {
        await this.hooks.observers.onCompaction({
          iteration,
          event: compactionEvent,
          // biome-ignore lint/style/noNonNullAssertion: compactionManager exists if compactionEvent is truthy
          stats: this.compactionManager!.getStats(),
          logger: this.logger,
        });
      }
    }, this.logger);

    return { type: "compaction", event: compactionEvent } as StreamEvent;
  }

  /**
   * Run agent with named event handlers (syntactic sugar).
   *
   * Instead of verbose if/else chains, use named handlers for cleaner code.
   *
   * @param handlers - Named event handlers
   *
   * @example
   * ```typescript
   * await agent.runWith({
   *   onText: (text) => console.log("LLM:", text),
   *   onGadgetResult: (result) => console.log("Result:", result.result),
   *   onGadgetCall: (call) => console.log("Calling:", call.gadgetName),
   * });
   * ```
   */
  async runWith(handlers: EventHandlers): Promise<void> {
    return runWithHandlers(this.run(), handlers);
  }
}
