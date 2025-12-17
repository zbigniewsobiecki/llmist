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
  LLMCallInfo,
  StreamCompletionEvent,
  StreamEvent,
  SubagentConfigMap,
  SubagentEvent,
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

  // Subagent configuration
  private readonly agentContextConfig: AgentContextConfig;
  private readonly subagentConfig?: SubagentConfigMap;

  // Subagent event callback for subagent gadgets
  private readonly userSubagentEventCallback?: (event: SubagentEvent) => void;
  // Internal queue for yielding subagent events in run()
  private readonly pendingSubagentEvents: SubagentEvent[] = [];
  // Combined callback that queues events AND calls user callback
  private readonly onSubagentEvent: (event: SubagentEvent) => void;
  // Counter for generating synthetic invocation IDs for wrapped text content
  private syntheticInvocationCounter = 0;

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

    // Store user callback and create combined callback that:
    // 1. Queues events for yielding in run()
    // 2. Calls user callback if provided
    // 3. Fires hooks with subagentContext for consistent event handling
    this.userSubagentEventCallback = options.onSubagentEvent;
    this.onSubagentEvent = (event: SubagentEvent) => {
      this.pendingSubagentEvents.push(event);
      this.userSubagentEventCallback?.(event);

      // Fire the SAME hooks with subagentContext - enables consistent hook-based handling
      const subagentContext = {
        parentGadgetInvocationId: event.gadgetInvocationId,
        depth: event.depth,
      };

      // Fire hooks asynchronously but don't block
      if (event.type === "llm_call_start") {
        const info = event.event as LLMCallInfo;
        void this.hooks?.observers?.onLLMCallStart?.({
          iteration: info.iteration,
          options: { model: info.model, messages: [] },
          logger: this.logger,
          subagentContext,
        });
      } else if (event.type === "llm_call_end") {
        const info = event.event as LLMCallInfo;
        // Use full usage object if available (preserves cached tokens), fallback to basic reconstruction
        const usage = info.usage ?? (info.outputTokens
          ? {
              inputTokens: info.inputTokens ?? 0,
              outputTokens: info.outputTokens,
              totalTokens: (info.inputTokens ?? 0) + info.outputTokens,
            }
          : undefined);
        void this.hooks?.observers?.onLLMCallComplete?.({
          iteration: info.iteration,
          options: { model: info.model, messages: [] },
          finishReason: info.finishReason ?? null,
          usage,
          rawResponse: "",
          finalMessage: "",
          logger: this.logger,
          subagentContext,
        });
      } else if (event.type === "gadget_call") {
        const gadgetEvent = event.event as { call: { invocationId: string; gadgetName: string; parameters?: Record<string, unknown> } };
        void this.hooks?.observers?.onGadgetExecutionStart?.({
          iteration: 0,
          gadgetName: gadgetEvent.call.gadgetName,
          invocationId: gadgetEvent.call.invocationId,
          parameters: gadgetEvent.call.parameters ?? {},
          logger: this.logger,
          subagentContext,
        });
      } else if (event.type === "gadget_result") {
        const resultEvent = event.event as { result: { invocationId: string; gadgetName?: string; executionTimeMs?: number } };
        void this.hooks?.observers?.onGadgetExecutionComplete?.({
          iteration: 0,
          gadgetName: resultEvent.result.gadgetName ?? "unknown",
          invocationId: resultEvent.result.invocationId,
          parameters: {},
          executionTimeMs: resultEvent.result.executionTimeMs ?? 0,
          logger: this.logger,
          subagentContext,
        });
      }
    };
  }

  /**
   * Flush pending subagent events as StreamEvents.
   * Called from run() to yield queued subagent events from subagent gadgets.
   */
  private *flushPendingSubagentEvents(): Generator<StreamEvent> {
    while (this.pendingSubagentEvents.length > 0) {
      const event = this.pendingSubagentEvents.shift();
      if (event) {
        yield { type: "subagent_event", subagentEvent: event };
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

        const stream = this.client.stream(llmOptions);

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
          yield event;

          // Yield any subagent events that accumulated during gadget execution
          // This enables real-time display of subagent activity (Navigate, Screenshot, etc.)
          yield* this.flushPendingSubagentEvents();
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
