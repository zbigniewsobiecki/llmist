/**
 * Agent: Lean orchestrator using the clean hooks architecture.
 *
 * The Agent delegates ALL stream processing and hook coordination to StreamProcessor,
 * making it a simple loop orchestrator with clear responsibilities.
 */

import type { ILogObj, Logger } from "tslog";
import type { LLMist } from "../core/client.js";
import {
  CHARS_PER_TOKEN,
  DEFAULT_GADGET_OUTPUT_LIMIT,
  DEFAULT_GADGET_OUTPUT_LIMIT_PERCENT,
  FALLBACK_CONTEXT_WINDOW,
} from "../core/constants.js";
import { ExecutionTree, type NodeId } from "../core/execution-tree.js";
import type { ContentPart } from "../core/input-content.js";
import type { MessageContent } from "../core/messages.js";
import { extractMessageText, LLMMessageBuilder } from "../core/messages.js";
import { resolveModel } from "../core/model-shortcuts.js";
import type { LLMGenerationOptions } from "../core/options.js";
import type { PromptTemplateConfig } from "../core/prompt-config.js";
import type { RateLimitConfig } from "../core/rate-limit.js";
import { RateLimitTracker, resolveRateLimitConfig } from "../core/rate-limit.js";
import type { ResolvedRetryConfig, RetryConfig } from "../core/retry.js";
import { extractRetryAfterMs, isRetryableError, resolveRetryConfig } from "../core/retry.js";
import { MediaStore } from "../gadgets/media-store.js";
import { createGadgetOutputViewer } from "../gadgets/output-viewer.js";
import type { GadgetRegistry } from "../gadgets/registry.js";
import type {
  AgentContextConfig,
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
import { type EventHandlers, runWithHandlers } from "./event-handlers.js";
import { GadgetOutputStore } from "./gadget-output-store.js";
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
  GadgetResultInterceptorContext,
  LLMCallControllerContext,
  LLMErrorControllerContext,
  ObserveAbortContext,
  ObserveLLMCallContext,
  ObserveLLMCallReadyContext,
  ObserveLLMCompleteContext,
  ObserveLLMErrorContext,
  ObserveRateLimitThrottleContext,
  ObserveRetryAttemptContext,
  Observers,
} from "./hooks.js";
import type { IConversationManager } from "./interfaces.js";
import { StreamProcessor } from "./stream-processor.js";
import { bridgeTreeToHooks, getSubagentContextForNode } from "./tree-hook-bridge.js";

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

  /** Custom prompt configuration for gadget system prompts */
  promptConfig?: PromptTemplateConfig;

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

  /** Subagent-specific configuration overrides (from CLI config) */
  subagentConfig?: SubagentConfigMap;

  // ==========================================================================
  // Execution Tree Context (for shared tree model with subagents)
  // ==========================================================================

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
  private readonly temperature?: number;
  private readonly logger: Logger<ILogObj>;
  private readonly hooks: AgentHooks;
  private readonly conversation: ConversationManager;
  private readonly registry: GadgetRegistry;
  private readonly gadgetStartPrefix?: string;
  private readonly gadgetEndPrefix?: string;
  private readonly gadgetArgPrefix?: string;
  private readonly requestHumanInput?: (question: string) => Promise<string>;
  private readonly textOnlyHandler: TextOnlyHandler;
  private readonly textWithGadgetsHandler?: {
    gadgetName: string;
    parameterMapping: (text: string) => Record<string, unknown>;
    resultMapping?: (text: string) => string;
  };
  private readonly defaultGadgetTimeoutMs?: number;
  private readonly defaultMaxTokens?: number;
  private hasUserPrompt: boolean;

  // Gadget output limiting
  private readonly outputStore: GadgetOutputStore;
  private readonly outputLimitEnabled: boolean;
  private readonly outputLimitCharLimit: number;

  // Context compaction
  private readonly compactionManager?: CompactionManager;

  // Media storage (for gadgets returning images, audio, etc.)
  private readonly mediaStore: MediaStore;

  // Cancellation
  private readonly signal?: AbortSignal;

  // Retry configuration
  private readonly retryConfig: ResolvedRetryConfig;

  // Rate limit tracker for proactive throttling
  private readonly rateLimitTracker?: RateLimitTracker;

  // Subagent configuration
  private readonly agentContextConfig: AgentContextConfig;
  private readonly subagentConfig?: SubagentConfigMap;

  // Counter for generating synthetic invocation IDs for wrapped text content
  private syntheticInvocationCounter = 0;

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
    this.temperature = options.temperature;
    this.logger = options.logger ?? createLogger({ name: "llmist:agent" });
    this.registry = options.registry;
    this.gadgetStartPrefix = options.gadgetStartPrefix;
    this.gadgetEndPrefix = options.gadgetEndPrefix;
    this.gadgetArgPrefix = options.gadgetArgPrefix;
    this.requestHumanInput = options.requestHumanInput;
    this.textOnlyHandler = options.textOnlyHandler ?? "terminate";
    this.textWithGadgetsHandler = options.textWithGadgetsHandler;
    this.defaultGadgetTimeoutMs = options.defaultGadgetTimeoutMs;
    this.defaultMaxTokens = this.resolveMaxTokensFromCatalog(options.model);

    // Initialize gadget output limiting
    this.outputLimitEnabled = options.gadgetOutputLimit ?? DEFAULT_GADGET_OUTPUT_LIMIT;
    this.outputStore = new GadgetOutputStore();

    // Initialize media storage for gadgets returning images, audio, etc.
    this.mediaStore = new MediaStore();

    // Calculate character limit from model context window
    const limitPercent = options.gadgetOutputLimitPercent ?? DEFAULT_GADGET_OUTPUT_LIMIT_PERCENT;
    const limits = this.client.modelRegistry.getModelLimits(this.model);
    const contextWindow = limits?.contextWindow ?? FALLBACK_CONTEXT_WINDOW;
    this.outputLimitCharLimit = Math.floor(contextWindow * (limitPercent / 100) * CHARS_PER_TOKEN);

    // Auto-register GadgetOutputViewer when limiting is enabled
    // Pass the same character limit so viewer output is also bounded
    if (this.outputLimitEnabled) {
      this.registry.register(
        "GadgetOutputViewer",
        createGadgetOutputViewer(this.outputStore, this.outputLimitCharLimit),
      );
    }

    // Chain output limiter interceptor with user hooks
    this.hooks = this.chainOutputLimiterWithUserHooks(options.hooks);

    // Build conversation
    const baseBuilder = new LLMMessageBuilder(options.promptConfig);
    if (options.systemPrompt) {
      baseBuilder.addSystem(options.systemPrompt);
    }

    baseBuilder.addGadgets(this.registry.getAll(), {
      startPrefix: options.gadgetStartPrefix,
      endPrefix: options.gadgetEndPrefix,
      argPrefix: options.gadgetArgPrefix,
    });
    const baseMessages = baseBuilder.build();

    const initialMessages = (options.initialMessages ?? []).map((message) => ({
      role: message.role,
      content: message.content,
    }));

    this.conversation = new ConversationManager(baseMessages, initialMessages, {
      startPrefix: options.gadgetStartPrefix,
      endPrefix: options.gadgetEndPrefix,
      argPrefix: options.gadgetArgPrefix,
    });
    this.hasUserPrompt = !!options.userPrompt;
    if (options.userPrompt) {
      this.conversation.addUserMessage(options.userPrompt);
    }

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

    // Initialize retry configuration (enabled by default)
    this.retryConfig = resolveRetryConfig(options.retryConfig);

    // Initialize rate limit tracker for proactive throttling (if configured)
    const rateLimitConfig = resolveRateLimitConfig(options.rateLimitConfig);
    if (rateLimitConfig.enabled) {
      this.rateLimitTracker = new RateLimitTracker(options.rateLimitConfig);
    }

    // Build agent context config for subagents to inherit
    this.agentContextConfig = {
      model: this.model,
      temperature: this.temperature,
    };
    this.subagentConfig = options.subagentConfig;

    // Initialize Execution Tree
    // If a parent tree is provided (subagent case), share it; otherwise create a new tree
    this.tree = options.parentTree ?? new ExecutionTree();
    this.parentNodeId = options.parentNodeId ?? null;
    this.baseDepth = options.baseDepth ?? 0;
    this.parentObservers = options.parentObservers;
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
          const prepared = await this.prepareLLMCall(currentIteration);
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
          // pRetry in createStreamWithRetry() only catches errors during the initial stream() call,
          // but 429/5xx errors can also occur DURING iteration over the stream.
          // This outer retry loop catches those iteration errors and retries the entire LLM call.
          const maxStreamAttempts = this.retryConfig.enabled ? this.retryConfig.retries + 1 : 1;
          let streamAttempt = 0;
          let streamMetadata: StreamCompletionEvent | null = null;
          let gadgetCallCount = 0;
          const textOutputs: string[] = [];
          const gadgetResults: StreamEvent[] = [];

          while (streamAttempt < maxStreamAttempts) {
            streamAttempt++;

            try {
              // Create LLM stream with rate limiting (retry is handled by this outer loop)
              const stream = await this.createStream(
                llmOptions,
                currentIteration,
                currentLLMNodeId,
              );

              // Process stream - ALL complexity delegated to StreamProcessor
              const processor = new StreamProcessor({
                iteration: currentIteration,
                registry: this.registry,
                gadgetStartPrefix: this.gadgetStartPrefix,
                gadgetEndPrefix: this.gadgetEndPrefix,
                gadgetArgPrefix: this.gadgetArgPrefix,
                hooks: this.hooks,
                logger: this.logger.getSubLogger({ name: "stream-processor" }),
                requestHumanInput: this.requestHumanInput,
                defaultGadgetTimeoutMs: this.defaultGadgetTimeoutMs,
                client: this.client,
                mediaStore: this.mediaStore,
                agentConfig: this.agentContextConfig,
                subagentConfig: this.subagentConfig,
                // Tree context for execution tracking
                tree: this.tree,
                parentNodeId: currentLLMNodeId, // Gadgets are children of this LLM call
                baseDepth: this.baseDepth,
                // Cross-iteration dependency tracking
                priorCompletedInvocations: this.completedInvocationIds,
                priorFailedInvocations: this.failedInvocationIds,
                // Parent observer hooks for subagent visibility
                parentObservers: this.parentObservers,
              });

              // Consume the stream processor generator, yielding events in real-time
              // The final event is a StreamCompletionEvent containing metadata
              for await (const event of processor.process(stream)) {
                if (event.type === "stream_complete") {
                  // Completion event - extract metadata, don't yield to consumer
                  streamMetadata = event;
                  continue;
                }

                // Track outputs for later conversation history updates
                if (event.type === "text") {
                  textOutputs.push(event.content);
                } else if (event.type === "gadget_result") {
                  gadgetCallCount++;
                  gadgetResults.push(event);
                } else if (event.type === "llm_response_end") {
                  // Signal that LLM finished generating (before gadgets complete)
                  // This allows consumers to track "LLM thinking time" separately
                  this.tree.endLLMResponse(currentLLMNodeId!, {
                    finishReason: event.finishReason,
                    usage: event.usage,
                  });
                }

                // Yield event to consumer in real-time
                // (includes subagent events from completedResultsQueue for real-time streaming)
                yield event;
              }

              // Collect completed/failed invocation IDs for cross-iteration dependency tracking
              for (const id of processor.getCompletedInvocationIds()) {
                this.completedInvocationIds.add(id);
              }
              for (const id of processor.getFailedInvocationIds()) {
                this.failedInvocationIds.add(id);
              }

              // Stream completed successfully - break retry loop
              break;
            } catch (streamError) {
              // Check if this is a retryable error and we have attempts remaining
              const error = streamError as Error;
              const canRetry = this.retryConfig.enabled && streamAttempt < maxStreamAttempts;
              const shouldRetryError = this.retryConfig.shouldRetry
                ? this.retryConfig.shouldRetry(error)
                : isRetryableError(error);

              if (canRetry && shouldRetryError) {
                // Extract Retry-After hint if present
                const retryAfterMs = this.retryConfig.respectRetryAfter
                  ? extractRetryAfterMs(error)
                  : null;

                // Calculate delay: use Retry-After if available, otherwise exponential backoff
                const baseDelay =
                  this.retryConfig.minTimeout * this.retryConfig.factor ** (streamAttempt - 1);
                const cappedBaseDelay = Math.min(baseDelay, this.retryConfig.maxTimeout);
                const delay =
                  retryAfterMs !== null
                    ? Math.min(retryAfterMs, this.retryConfig.maxRetryAfterMs)
                    : cappedBaseDelay;

                // Add jitter if randomize is enabled
                const finalDelay = this.retryConfig.randomize
                  ? delay * (0.5 + Math.random())
                  : delay;

                this.logger.warn(
                  `Stream iteration failed (attempt ${streamAttempt}/${maxStreamAttempts}), retrying...`,
                  {
                    error: error.message,
                    retriesLeft: maxStreamAttempts - streamAttempt,
                    delayMs: Math.round(finalDelay),
                    retryAfterMs,
                  },
                );

                // Call retry callback
                this.retryConfig.onRetry?.(error, streamAttempt);

                // Emit observer hook for retry attempt
                await this.safeObserve(async () => {
                  if (this.hooks.observers?.onRetryAttempt) {
                    // currentLLMNodeId is guaranteed to be defined at this point (set in prepareLLMCall)
                    const subagentContext = getSubagentContextForNode(this.tree, currentLLMNodeId!);
                    const hookContext: ObserveRetryAttemptContext = {
                      iteration: currentIteration,
                      attemptNumber: streamAttempt,
                      retriesLeft: maxStreamAttempts - streamAttempt,
                      error,
                      retryAfterMs: retryAfterMs ?? undefined,
                      logger: this.logger,
                      subagentContext,
                    };
                    await this.hooks.observers.onRetryAttempt(hookContext);
                  }
                });

                // Wait before retrying
                await this.sleep(finalDelay);

                // Reset state for retry attempt (clear any partial results from failed attempt)
                streamMetadata = null;
                gadgetCallCount = 0;
                textOutputs.length = 0;
                gadgetResults.length = 0;

                continue;
              }

              // Not retryable or retries exhausted
              if (streamAttempt > 1) {
                // We had at least one retry - call exhausted callback
                this.logger.error(`Stream iteration failed after ${streamAttempt} attempts`, {
                  error: error.message,
                  iteration: currentIteration,
                });
                this.retryConfig.onRetriesExhausted?.(error, streamAttempt);
              }
              throw error;
            }
          }

          // Ensure we received the completion metadata
          if (!streamMetadata) {
            throw new Error("Stream processing completed without metadata event");
          }

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

          // Observer: LLM call complete
          await this.safeObserve(async () => {
            if (this.hooks.observers?.onLLMCallComplete) {
              // At this point, currentLLMNodeId and llmOptions are guaranteed to be defined
              const subagentContext = getSubagentContextForNode(this.tree, currentLLMNodeId!);
              const context: ObserveLLMCompleteContext = {
                iteration: currentIteration,
                options: llmOptions!,
                finishReason: result.finishReason,
                usage: result.usage,
                rawResponse: result.rawResponse,
                finalMessage: result.finalMessage,
                logger: this.logger,
                subagentContext,
              };
              await this.hooks.observers.onLLMCallComplete(context);
            }
          });

          // Complete LLM call in execution tree (with cost calculation)
          this.completeLLMCallInTree(currentLLMNodeId!, result);

          // Process afterLLMCall controller (may modify finalMessage or append messages)
          const finalMessage = await this.processAfterLLMCallController(
            currentIteration,
            llmOptions!,
            result,
            gadgetCallCount,
          );

          // Update conversation with results (gadgets or text-only)
          const shouldBreakFromTextOnly = await this.updateConversationWithResults(
            result.didExecuteGadgets,
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
        } catch (error) {
          // Handle LLM error
          const errorHandled = await this.handleLLMError(error as Error, currentIteration);

          // Observer: LLM error
          await this.safeObserve(async () => {
            if (this.hooks.observers?.onLLMCallError) {
              // Use llmOptions if available, fallback to constructing options
              const options = llmOptions ?? {
                model: this.model,
                messages: this.conversation.getMessages(),
                temperature: this.temperature,
                maxTokens: this.defaultMaxTokens,
              };
              // Get SubagentContext if we have a node ID
              const subagentContext = currentLLMNodeId
                ? getSubagentContextForNode(this.tree, currentLLMNodeId)
                : undefined;
              const context: ObserveLLMErrorContext = {
                iteration: currentIteration,
                options,
                error: error as Error,
                recovered: errorHandled,
                logger: this.logger,
                subagentContext,
              };
              await this.hooks.observers.onLLMCallError(context);
            }
          });

          if (!errorHandled) {
            throw error;
          }
        }

        currentIteration++;
      }

      this.logger.info("Agent loop completed", {
        totalIterations: currentIteration,
        reason: currentIteration >= this.maxIterations ? "max_iterations" : "natural_completion",
      });
    } finally {
      // Safety net: Complete any in-flight LLM call if generator terminated early
      // This handles cases where consumers break from for-await loop prematurely
      if (currentLLMNodeId) {
        const node = this.tree.getNode(currentLLMNodeId);
        if (node && node.type === "llm_call" && !node.completedAt) {
          // Call observer hook for the interrupted request
          await this.safeObserve(async () => {
            if (this.hooks.observers?.onLLMCallComplete) {
              const subagentContext = getSubagentContextForNode(this.tree, currentLLMNodeId!);
              const context: ObserveLLMCompleteContext = {
                iteration: currentIteration,
                options: llmOptions ?? {
                  model: this.model,
                  messages: this.conversation.getMessages(),
                  temperature: this.temperature,
                  maxTokens: this.defaultMaxTokens,
                },
                finishReason: "interrupted",
                usage: undefined,
                rawResponse: "", // No response available for interrupted request
                finalMessage: "", // No final message for interrupted request
                logger: this.logger,
                subagentContext,
              };
              await this.hooks.observers.onLLMCallComplete(context);
            }
          });

          // Complete the LLM call in the execution tree
          this.tree.completeLLMCall(currentLLMNodeId, {
            finishReason: "interrupted",
          });
        }
      }

      // Always clean up the bridge subscription
      unsubscribeBridge();
    }
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
        await this.safeObserve(async () => {
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
        });

        await this.sleep(throttleDelay);
      }
    }

    return this.client.stream(llmOptions);
  }

  /**
   * Simple sleep utility for rate limit delays.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Handle LLM error through controller.
   */
  private async handleLLMError(error: Error, iteration: number): Promise<boolean> {
    this.logger.error("LLM call failed", { error: error.message });

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
      const action: AfterLLMErrorAction = await this.hooks.controllers.afterLLMError(context);

      // Validate the action
      validateAfterLLMErrorAction(action);

      if (action.action === "recover") {
        this.logger.info("Controller recovered from LLM error");
        this.conversation.addAssistantMessage(action.fallbackResponse);
        return true;
      }
    }

    return false;
  }

  /**
   * Handle text-only response (no gadgets called).
   */
  private async handleTextOnlyResponse(_text: string): Promise<boolean> {
    const handler = this.textOnlyHandler;

    if (typeof handler === "string") {
      switch (handler) {
        case "terminate":
          this.logger.info("No gadgets called, ending loop");
          return true;
        case "acknowledge":
          this.logger.info("No gadgets called, continuing loop");
          return false;
        case "wait_for_input":
          this.logger.info("No gadgets called, waiting for input");
          return true;
        default:
          this.logger.warn(`Unknown text-only strategy: ${handler}, defaulting to terminate`);
          return true;
      }
    }

    // For gadget and custom handlers, they would need to be implemented
    // This is simplified for now
    return true;
  }

  /**
   * Safely execute an observer, catching and logging any errors.
   */
  private async safeObserve(fn: () => void | Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.error("Observer threw error (ignoring)", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
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

  /**
   * Chain the output limiter interceptor with user-provided hooks.
   * The limiter runs first, then chains to any user interceptor.
   */
  private chainOutputLimiterWithUserHooks(userHooks?: AgentHooks): AgentHooks {
    if (!this.outputLimitEnabled) {
      return userHooks ?? {};
    }

    const limiterInterceptor = (result: string, ctx: GadgetResultInterceptorContext): string => {
      // Skip limiting for GadgetOutputViewer itself to avoid recursion
      if (ctx.gadgetName === "GadgetOutputViewer") {
        return result;
      }

      if (result.length > this.outputLimitCharLimit) {
        const id = this.outputStore.store(ctx.gadgetName, result);
        const lines = result.split("\n").length;
        const bytes = new TextEncoder().encode(result).length;

        this.logger.info("Gadget output exceeded limit, stored for browsing", {
          gadgetName: ctx.gadgetName,
          outputId: id,
          bytes,
          lines,
          charLimit: this.outputLimitCharLimit,
        });

        return (
          `[Gadget "${ctx.gadgetName}" returned too much data: ` +
          `${bytes.toLocaleString()} bytes, ${lines.toLocaleString()} lines. ` +
          `Use GadgetOutputViewer with id "${id}" to read it]`
        );
      }

      return result;
    };

    // Chain with any user-provided interceptor (limiter runs first)
    const userInterceptor = userHooks?.interceptors?.interceptGadgetResult;
    const chainedInterceptor = userInterceptor
      ? (result: string, ctx: GadgetResultInterceptorContext) =>
          userInterceptor(limiterInterceptor(result, ctx), ctx)
      : limiterInterceptor;

    return {
      ...userHooks,
      interceptors: {
        ...userHooks?.interceptors,
        interceptGadgetResult: chainedInterceptor,
      },
    };
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

    await this.safeObserve(async () => {
      if (this.hooks.observers?.onAbort) {
        const context: ObserveAbortContext = {
          iteration,
          reason: this.signal?.reason,
          logger: this.logger,
        };
        await this.hooks.observers.onAbort(context);
      }
    });

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
    await this.safeObserve(async () => {
      if (this.hooks.observers?.onCompaction) {
        await this.hooks.observers.onCompaction({
          iteration,
          event: compactionEvent,
          // biome-ignore lint/style/noNonNullAssertion: compactionManager exists if compactionEvent is truthy
          stats: this.compactionManager!.getStats(),
          logger: this.logger,
        });
      }
    });

    return { type: "compaction", event: compactionEvent } as StreamEvent;
  }

  /**
   * Prepare LLM call options, create tree node, and process beforeLLMCall controller.
   * @returns options, node ID, and optional skipWithSynthetic response if controller wants to skip
   */
  private async prepareLLMCall(
    iteration: number,
  ): Promise<{ options: LLMGenerationOptions; llmNodeId: string; skipWithSynthetic?: string }> {
    let llmOptions: LLMGenerationOptions = {
      model: this.model,
      messages: this.conversation.getMessages(),
      temperature: this.temperature,
      maxTokens: this.defaultMaxTokens,
      signal: this.signal,
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
    await this.safeObserve(async () => {
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
    });

    // Controller: Before LLM call
    if (this.hooks.controllers?.beforeLLMCall) {
      const context: LLMCallControllerContext = {
        iteration,
        maxIterations: this.maxIterations,
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
    await this.safeObserve(async () => {
      if (this.hooks.observers?.onLLMCallReady) {
        const subagentContext = getSubagentContextForNode(this.tree, llmNode.id);
        const context: ObserveLLMCallReadyContext = {
          iteration,
          maxIterations: this.maxIterations,
          options: llmOptions,
          logger: this.logger,
          subagentContext,
        };
        await this.hooks.observers.onLLMCallReady(context);
      }
    });

    return { options: llmOptions, llmNodeId: llmNode.id };
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
    )?.totalCost;

    // Complete LLM call in execution tree (including cost for automatic aggregation)
    this.tree.completeLLMCall(nodeId, {
      response: result.rawResponse,
      usage: result.usage,
      finishReason: result.finishReason,
      cost: llmCost,
    });
  }

  /**
   * Process afterLLMCall controller and return modified final message.
   */
  private async processAfterLLMCallController(
    iteration: number,
    llmOptions: LLMGenerationOptions,
    result: StreamCompletionEvent,
    gadgetCallCount: number,
  ): Promise<string> {
    let finalMessage = result.finalMessage;

    if (!this.hooks.controllers?.afterLLMCall) {
      return finalMessage;
    }

    const context: AfterLLMCallControllerContext = {
      iteration,
      maxIterations: this.maxIterations,
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

  /**
   * Update conversation history with gadget results or text-only response.
   * @returns true if loop should break (text-only handler requested termination)
   */
  private async updateConversationWithResults(
    didExecuteGadgets: boolean,
    textOutputs: string[],
    gadgetResults: StreamEvent[],
    finalMessage: string,
  ): Promise<boolean> {
    if (didExecuteGadgets) {
      // If configured, wrap accompanying text as a synthetic gadget call
      if (this.textWithGadgetsHandler) {
        const textContent = textOutputs.join("");

        if (textContent.trim()) {
          const { gadgetName, parameterMapping, resultMapping } = this.textWithGadgetsHandler;
          const syntheticId = `gc_text_${++this.syntheticInvocationCounter}`;
          this.conversation.addGadgetCallResult(
            gadgetName,
            parameterMapping(textContent),
            resultMapping ? resultMapping(textContent) : textContent,
            syntheticId,
          );
        }
      }

      // Add all gadget results to conversation
      for (const output of gadgetResults) {
        if (output.type === "gadget_result") {
          const gadgetResult = output.result;
          this.conversation.addGadgetCallResult(
            gadgetResult.gadgetName,
            gadgetResult.parameters,
            gadgetResult.error ?? gadgetResult.result ?? "",
            gadgetResult.invocationId,
            gadgetResult.media,
            gadgetResult.mediaIds,
          );
        }
      }

      return false; // Don't break loop
    }

    // No gadgets executed - add text as assistant message
    // (Use textWithGadgetsHandler if gadget wrapping is needed)
    if (finalMessage.trim()) {
      this.conversation.addAssistantMessage(finalMessage);
    }

    // Handle text-only responses
    return await this.handleTextOnlyResponse(finalMessage);
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
