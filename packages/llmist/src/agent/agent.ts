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
import { MediaStore } from "../gadgets/media-store.js";
import { createGadgetOutputViewer } from "../gadgets/output-viewer.js";
import type { GadgetRegistry } from "../gadgets/registry.js";
import type {
  AgentContextConfig,
  StreamCompletionEvent,
  StreamEvent,
  SubagentConfigMap,
  SubagentEvent,
  TextOnlyHandler,
} from "../gadgets/types.js";
import { createLogger } from "../logging/logger.js";
import { type AGENT_INTERNAL_KEY, isValidAgentKey } from "./agent-internal-key.js";
import type { CompactionConfig, CompactionEvent, CompactionStats } from "./compaction/config.js";
import type { RetryConfig, ResolvedRetryConfig } from "../core/retry.js";
import { resolveRetryConfig, isRetryableError } from "../core/retry.js";
import pRetry from "p-retry";
import { CompactionManager } from "./compaction/manager.js";
import { ConversationManager } from "./conversation-manager.js";
import type { IConversationManager } from "./interfaces.js";
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
} from "./hooks.js";
import { StreamProcessor } from "./stream-processor.js";

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

  /** Optional abort signal for cancelling requests mid-flight */
  signal?: AbortSignal;

  /** Subagent-specific configuration overrides (from CLI config) */
  subagentConfig?: SubagentConfigMap;

  /** Callback for subagent gadgets to report subagent events to parent */
  onSubagentEvent?: (event: SubagentEvent) => void;

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

  // Subagent configuration
  private readonly agentContextConfig: AgentContextConfig;
  private readonly subagentConfig?: SubagentConfigMap;

  /**
   * User-provided callback for subagent events (from withSubagentEventHandler).
   * Called synchronously before events are queued for streaming.
   */
  private readonly userSubagentEventCallback?: (event: SubagentEvent) => void;
  /**
   * Internal callback passed to StreamProcessor.
   * StreamProcessor wraps this to: (1) call userSubagentEventCallback, then (2) queue for streaming.
   * @see StreamProcessor.wrappedOnSubagentEvent for the unified event streaming architecture.
   */
  private readonly onSubagentEvent: (event: SubagentEvent) => void;
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

    /**
     * Configure subagent event handling.
     *
     * UNIFIED EVENT STREAMING ARCHITECTURE:
     * Subagent events (llm_call_start, gadget_call, etc.) are streamed in real-time through
     * StreamProcessor's `completedResultsQueue`. This creates a unified event bus where all
     * runtime events are interleaved and yielded via `waitForInFlightExecutions()`.
     *
     * EVENT FLOW:
     * 1. Subagent gadget emits event → StreamProcessor.wrappedOnSubagentEvent
     * 2. wrappedOnSubagentEvent calls this.onSubagentEvent (user callback first)
     * 3. Then pushes to completedResultsQueue for streaming
     * 4. Agent's run() loop yields event via waitForInFlightExecutions()
     *
     * This replaces the previous architecture where events were queued in a separate
     * `pendingSubagentEvents` array and flushed at iteration boundaries, which caused
     * batching rather than real-time streaming.
     */
    this.userSubagentEventCallback = options.onSubagentEvent;
    this.onSubagentEvent = (event: SubagentEvent) => {
      // Invoke user callback - StreamProcessor handles queuing for real-time streaming
      this.userSubagentEventCallback?.(event);
    };
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
   * @throws {Error} If no user prompt was provided (when using build() without ask())
   */
  async *run(): AsyncGenerator<StreamEvent> {
    if (!this.hasUserPrompt) {
      throw new Error(
        "No user prompt provided. Use .ask(prompt) instead of .build(), or call agent.run() after providing a prompt.",
      );
    }

    let currentIteration = 0;

    this.logger.info("Starting agent loop", {
      model: this.model,
      maxIterations: this.maxIterations,
    });

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

        // Prepare LLM call with hooks
        const prepared = await this.prepareLLMCall(currentIteration);
        const llmOptions = prepared.options;

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

        // Add LLM call to execution tree
        const llmNode = this.tree.addLLMCall({
          iteration: currentIteration,
          model: llmOptions.model,
          parentId: this.parentNodeId,
          request: llmOptions.messages,
        });
        const currentLLMNodeId = llmNode.id;

        // Create LLM stream with retry logic (if enabled)
        const stream = await this.createStreamWithRetry(llmOptions, currentIteration);

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
          onSubagentEvent: this.onSubagentEvent,
          // Tree context for execution tracking
          tree: this.tree,
          parentNodeId: currentLLMNodeId, // Gadgets are children of this LLM call
          baseDepth: this.baseDepth,
          // Cross-iteration dependency tracking
          priorCompletedInvocations: this.completedInvocationIds,
          priorFailedInvocations: this.failedInvocationIds,
        });

        // Consume the stream processor generator, yielding events in real-time
        // The final event is a StreamCompletionEvent containing metadata
        let streamMetadata: StreamCompletionEvent | null = null;
        let gadgetCallCount = 0;

        // Track outputs for conversation history (since we stream instead of batch)
        const textOutputs: string[] = [];
        const gadgetResults: StreamEvent[] = [];

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
          }

          // Yield event to consumer in real-time
          // (includes subagent events from completedResultsQueue for real-time streaming)
          yield event;
        }

        // Ensure we received the completion metadata
        if (!streamMetadata) {
          throw new Error("Stream processing completed without metadata event");
        }

        // Collect completed/failed invocation IDs for cross-iteration dependency tracking
        for (const id of processor.getCompletedInvocationIds()) {
          this.completedInvocationIds.add(id);
        }
        for (const id of processor.getFailedInvocationIds()) {
          this.failedInvocationIds.add(id);
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
            const context: ObserveLLMCompleteContext = {
              iteration: currentIteration,
              options: llmOptions,
              finishReason: result.finishReason,
              usage: result.usage,
              rawResponse: result.rawResponse,
              finalMessage: result.finalMessage,
              logger: this.logger,
            };
            await this.hooks.observers.onLLMCallComplete(context);
          }
        });

        // Complete LLM call in execution tree (with cost calculation)
        this.completeLLMCallInTree(currentLLMNodeId, result);

        // Process afterLLMCall controller (may modify finalMessage or append messages)
        const finalMessage = await this.processAfterLLMCallController(
          currentIteration,
          llmOptions,
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
            const context: ObserveLLMErrorContext = {
              iteration: currentIteration,
              options: {
                model: this.model,
                messages: this.conversation.getMessages(),
                temperature: this.temperature,
                maxTokens: this.defaultMaxTokens,
              },
              error: error as Error,
              recovered: errorHandled,
              logger: this.logger,
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
  }

  /**
   * Create LLM stream with retry logic.
   * Wraps the stream creation with exponential backoff for transient failures.
   */
  private async createStreamWithRetry(
    llmOptions: LLMGenerationOptions,
    iteration: number,
  ): Promise<ReturnType<LLMist["stream"]>> {
    // If retry is disabled, return stream directly
    if (!this.retryConfig.enabled) {
      return this.client.stream(llmOptions);
    }

    const { retries, minTimeout, maxTimeout, factor, randomize, onRetry, onRetriesExhausted, shouldRetry } =
      this.retryConfig;

    try {
      return await pRetry(
        async (attemptNumber) => {
          this.logger.debug("Creating LLM stream", { attempt: attemptNumber, maxAttempts: retries + 1 });
          return this.client.stream(llmOptions);
        },
        {
          retries,
          minTimeout,
          maxTimeout,
          factor,
          randomize,
          signal: this.signal,
          onFailedAttempt: (context) => {
            const { error, attemptNumber, retriesLeft } = context;
            this.logger.warn(
              `LLM call failed (attempt ${attemptNumber}/${attemptNumber + retriesLeft}), retrying...`,
              { error: error.message, retriesLeft },
            );
            onRetry?.(error, attemptNumber);
          },
          shouldRetry: (context) => {
            // Use custom shouldRetry if provided, otherwise use default classification
            if (shouldRetry) {
              return shouldRetry(context.error);
            }
            return isRetryableError(context.error);
          },
        },
      );
    } catch (error) {
      // All retries exhausted - call observer hook before re-throwing
      this.logger.error(`LLM call failed after ${retries + 1} attempts`, {
        error: (error as Error).message,
        iteration,
      });
      onRetriesExhausted?.(error as Error, retries + 1);
      throw error;
    }
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
   * Prepare LLM call options and process beforeLLMCall controller.
   * @returns options and optional skipWithSynthetic response if controller wants to skip
   */
  private async prepareLLMCall(
    iteration: number,
  ): Promise<{ options: LLMGenerationOptions; skipWithSynthetic?: string }> {
    let llmOptions: LLMGenerationOptions = {
      model: this.model,
      messages: this.conversation.getMessages(),
      temperature: this.temperature,
      maxTokens: this.defaultMaxTokens,
      signal: this.signal,
    };

    // Observer: LLM call start
    await this.safeObserve(async () => {
      if (this.hooks.observers?.onLLMCallStart) {
        const context: ObserveLLMCallContext = {
          iteration,
          options: llmOptions,
          logger: this.logger,
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
        return { options: llmOptions, skipWithSynthetic: action.syntheticResponse };
      } else if (action.action === "proceed" && action.modifiedOptions) {
        llmOptions = { ...llmOptions, ...action.modifiedOptions };
      }
    }

    // Observer: LLM call ready (after controller modifications)
    await this.safeObserve(async () => {
      if (this.hooks.observers?.onLLMCallReady) {
        const context: ObserveLLMCallReadyContext = {
          iteration,
          maxIterations: this.maxIterations,
          options: llmOptions,
          logger: this.logger,
        };
        await this.hooks.observers.onLLMCallReady(context);
      }
    });

    return { options: llmOptions };
  }

  /**
   * Calculate cost and complete LLM call in execution tree.
   */
  private completeLLMCallInTree(
    nodeId: NodeId,
    result: StreamCompletionEvent,
  ): void {
    // Calculate cost using ModelRegistry (if available)
    const llmCost = this.client.modelRegistry?.estimateCost?.(
      this.model,
      result.usage?.inputTokens ?? 0,
      result.usage?.outputTokens ?? 0,
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

    // No gadgets executed - wrap text as synthetic TellUser result
    if (finalMessage.trim()) {
      const syntheticId = `gc_tell_${++this.syntheticInvocationCounter}`;
      this.conversation.addGadgetCallResult(
        "TellUser",
        { message: finalMessage, done: false, type: "info" },
        `ℹ️  ${finalMessage}`,
        syntheticId,
      );
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
