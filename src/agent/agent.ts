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
import { LLMMessageBuilder } from "../core/messages.js";
import { resolveModel } from "../core/model-shortcuts.js";
import type { LLMGenerationOptions } from "../core/options.js";
import type { PromptConfig } from "../core/prompt-config.js";
import type { ParameterFormat } from "../gadgets/parser.js";
import type { GadgetRegistry } from "../gadgets/registry.js";
import type { StreamEvent, TextOnlyHandler } from "../gadgets/types.js";
import { createGadgetOutputViewer } from "../gadgets/output-viewer.js";
import { createLogger } from "../logging/logger.js";
import { GadgetOutputStore } from "./gadget-output-store.js";
import type { GadgetResultInterceptorContext } from "./hooks.js";
import { type AGENT_INTERNAL_KEY, isValidAgentKey } from "./agent-internal-key.js";
import { ConversationManager } from "./conversation-manager.js";
import { type EventHandlers, runWithHandlers } from "./event-handlers.js";
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

  /** Initial user prompt (optional if using build()) */
  userPrompt?: string;

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

  /** Callback for human input */
  onHumanInputRequired?: (question: string) => Promise<string>;

  /** Parameter format */
  parameterFormat?: ParameterFormat;

  /** Custom gadget start prefix */
  gadgetStartPrefix?: string;

  /** Custom gadget end prefix */
  gadgetEndPrefix?: string;

  /** Initial messages */
  initialMessages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;

  /** Text-only handler */
  textOnlyHandler?: TextOnlyHandler;

  /** Stop on gadget error */
  stopOnGadgetError?: boolean;

  /** Custom error continuation logic */
  shouldContinueAfterError?: (context: {
    error: string;
    gadgetName: string;
    errorType: "parse" | "validation" | "execution";
    parameters?: Record<string, unknown>;
  }) => boolean | Promise<boolean>;

  /** Default gadget timeout */
  defaultGadgetTimeoutMs?: number;

  /** Custom prompt configuration for gadget system prompts */
  promptConfig?: PromptConfig;

  /** Enable gadget output limiting (default: true) */
  gadgetOutputLimit?: boolean;

  /** Max gadget output as % of model context window (default: 15) */
  gadgetOutputLimitPercent?: number;
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
  private readonly parameterFormat: ParameterFormat;
  private readonly gadgetStartPrefix?: string;
  private readonly gadgetEndPrefix?: string;
  private readonly onHumanInputRequired?: (question: string) => Promise<string>;
  private readonly textOnlyHandler: TextOnlyHandler;
  private readonly stopOnGadgetError: boolean;
  private readonly shouldContinueAfterError?: (context: {
    error: string;
    gadgetName: string;
    errorType: "parse" | "validation" | "execution";
    parameters?: Record<string, unknown>;
  }) => boolean | Promise<boolean>;
  private readonly defaultGadgetTimeoutMs?: number;
  private readonly defaultMaxTokens?: number;
  private userPromptProvided: boolean;

  // Gadget output limiting
  private readonly outputStore: GadgetOutputStore;
  private readonly outputLimitEnabled: boolean;
  private readonly outputLimitCharLimit: number;

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
    this.parameterFormat = options.parameterFormat ?? "json";
    this.gadgetStartPrefix = options.gadgetStartPrefix;
    this.gadgetEndPrefix = options.gadgetEndPrefix;
    this.onHumanInputRequired = options.onHumanInputRequired;
    this.textOnlyHandler = options.textOnlyHandler ?? "terminate";
    this.stopOnGadgetError = options.stopOnGadgetError ?? true;
    this.shouldContinueAfterError = options.shouldContinueAfterError;
    this.defaultGadgetTimeoutMs = options.defaultGadgetTimeoutMs;
    this.defaultMaxTokens = this.resolveMaxTokensFromCatalog(options.model);

    // Initialize gadget output limiting
    this.outputLimitEnabled = options.gadgetOutputLimit ?? DEFAULT_GADGET_OUTPUT_LIMIT;
    this.outputStore = new GadgetOutputStore();

    // Calculate character limit from model context window
    const limitPercent = options.gadgetOutputLimitPercent ?? DEFAULT_GADGET_OUTPUT_LIMIT_PERCENT;
    const limits = this.client.modelRegistry.getModelLimits(this.model);
    const contextWindow = limits?.contextWindow ?? FALLBACK_CONTEXT_WINDOW;
    this.outputLimitCharLimit = Math.floor(contextWindow * (limitPercent / 100) * CHARS_PER_TOKEN);

    // Auto-register GadgetOutputViewer when limiting is enabled
    if (this.outputLimitEnabled) {
      this.registry.register("GadgetOutputViewer", createGadgetOutputViewer(this.outputStore));
    }

    // Merge output limiter interceptor into hooks
    this.hooks = this.mergeOutputLimiterHook(options.hooks);

    // Build conversation
    const baseBuilder = new LLMMessageBuilder(options.promptConfig);
    if (options.systemPrompt) {
      baseBuilder.addSystem(options.systemPrompt);
    }

    baseBuilder.addGadgets(this.registry.getAll(), this.parameterFormat, {
      startPrefix: options.gadgetStartPrefix,
      endPrefix: options.gadgetEndPrefix,
    });
    const baseMessages = baseBuilder.build();

    const initialMessages = (options.initialMessages ?? []).map((message) => ({
      role: message.role,
      content: message.content,
    }));

    this.conversation = new ConversationManager(baseMessages, initialMessages, {
      parameterFormat: this.parameterFormat,
      startPrefix: options.gadgetStartPrefix,
      endPrefix: options.gadgetEndPrefix,
    });
    this.userPromptProvided = !!options.userPrompt;
    if (options.userPrompt) {
      this.conversation.addUserMessage(options.userPrompt);
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
   * Run the agent loop.
   * Clean, simple orchestration - all complexity is in StreamProcessor.
   *
   * @throws {Error} If no user prompt was provided (when using build() without ask())
   */
  async *run(): AsyncGenerator<StreamEvent> {
    if (!this.userPromptProvided) {
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
      this.logger.debug("Starting iteration", { iteration: currentIteration });

      try {
        // Prepare LLM call options
        let llmOptions: LLMGenerationOptions = {
          model: this.model,
          messages: this.conversation.getMessages(),
          temperature: this.temperature,
          maxTokens: this.defaultMaxTokens,
        };

        // Observer: LLM call start
        await this.safeObserve(async () => {
          if (this.hooks.observers?.onLLMCallStart) {
            const context: ObserveLLMCallContext = {
              iteration: currentIteration,
              options: llmOptions,
              logger: this.logger,
            };
            await this.hooks.observers.onLLMCallStart(context);
          }
        });

        // Controller: Before LLM call
        if (this.hooks.controllers?.beforeLLMCall) {
          const context: LLMCallControllerContext = {
            iteration: currentIteration,
            options: llmOptions,
            logger: this.logger,
          };
          const action: BeforeLLMCallAction = await this.hooks.controllers.beforeLLMCall(context);

          // Validate the action
          validateBeforeLLMCallAction(action);

          if (action.action === "skip") {
            this.logger.info("Controller skipped LLM call, using synthetic response");
            // Add synthetic response to conversation
            this.conversation.addAssistantMessage(action.syntheticResponse);
            // Yield as text event
            yield { type: "text", content: action.syntheticResponse };
            break;
          } else if (action.action === "proceed" && action.modifiedOptions) {
            llmOptions = { ...llmOptions, ...action.modifiedOptions };
          }
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
        const stream = this.client.stream(llmOptions);

        // Process stream - ALL complexity delegated to StreamProcessor
        const processor = new StreamProcessor({
          iteration: currentIteration,
          registry: this.registry,
          parameterFormat: this.parameterFormat,
          gadgetStartPrefix: this.gadgetStartPrefix,
          gadgetEndPrefix: this.gadgetEndPrefix,
          hooks: this.hooks,
          logger: this.logger.getSubLogger({ name: "stream-processor" }),
          onHumanInputRequired: this.onHumanInputRequired,
          stopOnGadgetError: this.stopOnGadgetError,
          shouldContinueAfterError: this.shouldContinueAfterError,
          defaultGadgetTimeoutMs: this.defaultGadgetTimeoutMs,
        });

        const result = await processor.process(stream);

        // Yield all outputs to user
        for (const output of result.outputs) {
          yield output;
        }

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

        // Controller: After LLM call
        let finalMessage = result.finalMessage;
        if (this.hooks.controllers?.afterLLMCall) {
          const context: AfterLLMCallControllerContext = {
            iteration: currentIteration,
            options: llmOptions,
            finishReason: result.finishReason,
            usage: result.usage,
            finalMessage: result.finalMessage,
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
                this.conversation.addAssistantMessage(msg.content);
              } else if (msg.role === "system") {
                // System messages can't be added mid-conversation, treat as user
                this.conversation.addUserMessage(`[System] ${msg.content}`);
              }
            }
          }
        }

        // Add gadget results to conversation (if any were executed)
        if (result.didExecuteGadgets) {
          // Extract and add all gadget results to conversation
          for (const output of result.outputs) {
            if (output.type === "gadget_result") {
              const gadgetResult = output.result;
              this.conversation.addGadgetCall(
                gadgetResult.gadgetName,
                gadgetResult.parameters,
                gadgetResult.error ?? gadgetResult.result ?? "",
              );
            }
          }
        } else {
          // No gadgets executed - wrap text as synthetic TellUser result
          // This keeps conversation history consistent (gadget-oriented) and
          // helps LLMs stay in the "gadget invocation" mindset
          if (finalMessage.trim()) {
            this.conversation.addGadgetCall(
              "TellUser",
              { message: finalMessage, done: false, type: "info" },
              `ℹ️  ${finalMessage}`,
            );
          }
          // Empty responses: don't add anything, just check if we should continue

          // Handle text-only responses
          const shouldBreak = await this.handleTextOnlyResponse(finalMessage);
          if (shouldBreak) {
            break;
          }
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
   * Merge the output limiter interceptor into user-provided hooks.
   * The limiter runs first, then chains to any user interceptor.
   */
  private mergeOutputLimiterHook(userHooks?: AgentHooks): AgentHooks {
    if (!this.outputLimitEnabled) {
      return userHooks ?? {};
    }

    const limiterInterceptor = (
      result: string,
      ctx: GadgetResultInterceptorContext,
    ): string => {
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
