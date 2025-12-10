/**
 * Fluent builder for creating agents with delightful DX.
 *
 * @example
 * ```typescript
 * const agent = await LLMist.createAgent()
 *   .withModel("sonnet")
 *   .withSystem("You are a helpful assistant")
 *   .withGadgets(Calculator, Weather)
 *   .withMaxIterations(10)
 *   .ask("What's the weather in Paris?");
 *
 * for await (const event of agent.run()) {
 *   // process events
 * }
 * ```
 */

import type { ILogObj, Logger } from "tslog";
import type { LLMist } from "../core/client.js";
import { GADGET_ARG_PREFIX, GADGET_END_PREFIX, GADGET_START_PREFIX } from "../core/constants.js";
import type { ContentPart, ImageMimeType } from "../core/input-content.js";
import {
  detectImageMimeType,
  text,
  toBase64,
} from "../core/input-content.js";
import type { MessageContent } from "../core/messages.js";
import { resolveModel } from "../core/model-shortcuts.js";
import type { PromptConfig } from "../core/prompt-config.js";
import type { GadgetOrClass } from "../gadgets/registry.js";
import { GadgetRegistry } from "../gadgets/registry.js";
import type { TextOnlyHandler } from "../gadgets/types.js";
import { Agent, type AgentOptions } from "./agent.js";
import { AGENT_INTERNAL_KEY } from "./agent-internal-key.js";
import type { CompactionConfig } from "./compaction/config.js";
import { collectText, type EventHandlers } from "./event-handlers.js";
import type {
  AgentHooks,
  BeforeLLMCallAction,
  LLMCallControllerContext,
} from "./hooks.js";

/**
 * Message for conversation history.
 * User messages can be text (string) or multimodal (ContentPart[]).
 */
export type HistoryMessage =
  | { user: string | ContentPart[] }
  | { assistant: string }
  | { system: string };

/**
 * Context available to trailing message functions.
 * Provides iteration information for dynamic message generation.
 */
export type TrailingMessageContext = Pick<LLMCallControllerContext, "iteration" | "maxIterations">;

/**
 * Trailing message can be a static string or a function that generates the message.
 * The function receives context about the current iteration.
 */
export type TrailingMessage = string | ((ctx: TrailingMessageContext) => string);

/**
 * Fluent builder for creating agents.
 *
 * Provides a chainable API for configuring and creating agents,
 * making the code more expressive and easier to read.
 */
export class AgentBuilder {
  private client?: LLMist;
  private model?: string;
  private systemPrompt?: string;
  private temperature?: number;
  private maxIterations?: number;
  private logger?: Logger<ILogObj>;
  private hooks?: AgentHooks;
  private promptConfig?: PromptConfig;
  private gadgets: GadgetOrClass[] = [];
  private initialMessages: Array<{
    role: "system" | "user" | "assistant";
    content: MessageContent;
  }> = [];
  private onHumanInputRequired?: (question: string) => Promise<string>;
  private gadgetStartPrefix?: string;
  private gadgetEndPrefix?: string;
  private gadgetArgPrefix?: string;
  private textOnlyHandler?: TextOnlyHandler;
  private textWithGadgetsHandler?: {
    gadgetName: string;
    parameterMapping: (text: string) => Record<string, unknown>;
    resultMapping?: (text: string) => string;
  };
  private stopOnGadgetError?: boolean;
  private shouldContinueAfterError?: (context: {
    error: string;
    gadgetName: string;
    errorType: "parse" | "validation" | "execution";
    parameters?: Record<string, unknown>;
  }) => boolean | Promise<boolean>;
  private defaultGadgetTimeoutMs?: number;
  private gadgetOutputLimit?: boolean;
  private gadgetOutputLimitPercent?: number;
  private compactionConfig?: CompactionConfig;
  private signal?: AbortSignal;
  private trailingMessage?: TrailingMessage;

  constructor(client?: LLMist) {
    this.client = client;
  }

  /**
   * Set the model to use.
   * Supports aliases like "gpt4", "sonnet", "flash".
   *
   * @param model - Model name or alias
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * .withModel("sonnet")           // Alias
   * .withModel("gpt-5-nano")       // Auto-detects provider
   * .withModel("openai:gpt-5")     // Explicit provider
   * ```
   */
  withModel(model: string): this {
    this.model = resolveModel(model);
    return this;
  }

  /**
   * Set the system prompt.
   *
   * @param prompt - System prompt
   * @returns This builder for chaining
   */
  withSystem(prompt: string): this {
    this.systemPrompt = prompt;
    return this;
  }

  /**
   * Set the temperature (0-1).
   *
   * @param temperature - Temperature value
   * @returns This builder for chaining
   */
  withTemperature(temperature: number): this {
    this.temperature = temperature;
    return this;
  }

  /**
   * Set maximum iterations.
   *
   * @param max - Maximum number of iterations
   * @returns This builder for chaining
   */
  withMaxIterations(max: number): this {
    this.maxIterations = max;
    return this;
  }

  /**
   * Set logger instance.
   *
   * @param logger - Logger instance
   * @returns This builder for chaining
   */
  withLogger(logger: Logger<ILogObj>): this {
    this.logger = logger;
    return this;
  }

  /**
   * Add hooks for agent lifecycle events.
   *
   * @param hooks - Agent hooks configuration
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * import { HookPresets } from 'llmist/hooks';
   *
   * .withHooks(HookPresets.logging())
   * .withHooks(HookPresets.merge(
   *   HookPresets.logging(),
   *   HookPresets.timing()
   * ))
   * ```
   */
  withHooks(hooks: AgentHooks): this {
    this.hooks = hooks;
    return this;
  }

  /**
   * Configure custom prompts for gadget system messages.
   *
   * @param config - Prompt configuration object
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * .withPromptConfig({
   *   mainInstruction: "Use the gadget markers below:",
   *   rules: ["Always use markers", "Never use function calling"]
   * })
   * ```
   */
  withPromptConfig(config: PromptConfig): this {
    this.promptConfig = config;
    return this;
  }

  /**
   * Add gadgets (classes or instances).
   * Can be called multiple times to add more gadgets.
   *
   * @param gadgets - Gadget classes or instances
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * .withGadgets(Calculator, Weather, Email)
   * .withGadgets(new Calculator(), new Weather())
   * .withGadgets(createGadget({ ... }))
   * ```
   */
  withGadgets(...gadgets: GadgetOrClass[]): this {
    this.gadgets.push(...gadgets);
    return this;
  }

  /**
   * Add conversation history messages.
   * Useful for continuing previous conversations.
   *
   * @param messages - Array of history messages
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * .withHistory([
   *   { user: "Hello" },
   *   { assistant: "Hi there!" },
   *   { user: "How are you?" },
   *   { assistant: "I'm doing well, thanks!" }
   * ])
   * ```
   */
  withHistory(messages: HistoryMessage[]): this {
    for (const msg of messages) {
      if ("user" in msg) {
        this.initialMessages.push({ role: "user", content: msg.user });
      } else if ("assistant" in msg) {
        this.initialMessages.push({ role: "assistant", content: msg.assistant });
      } else if ("system" in msg) {
        this.initialMessages.push({ role: "system", content: msg.system });
      }
    }
    return this;
  }

  /**
   * Add a single message to the conversation history.
   *
   * @param message - Single history message
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * .addMessage({ user: "Hello" })
   * .addMessage({ assistant: "Hi there!" })
   * ```
   */
  addMessage(message: HistoryMessage): this {
    return this.withHistory([message]);
  }

  /**
   * Set the human input handler for interactive conversations.
   *
   * @param handler - Function to handle human input requests
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * .onHumanInput(async (question) => {
   *   return await promptUser(question);
   * })
   * ```
   */
  onHumanInput(handler: (question: string) => Promise<string>): this {
    this.onHumanInputRequired = handler;
    return this;
  }

  /**
   * Set custom gadget marker prefix.
   *
   * @param prefix - Custom start prefix for gadget markers
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * .withGadgetStartPrefix("<<GADGET_START>>")
   * ```
   */
  withGadgetStartPrefix(prefix: string): this {
    this.gadgetStartPrefix = prefix;
    return this;
  }

  /**
   * Set custom gadget marker suffix.
   *
   * @param suffix - Custom end suffix for gadget markers
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * .withGadgetEndPrefix("<<GADGET_END>>")
   * ```
   */
  withGadgetEndPrefix(suffix: string): this {
    this.gadgetEndPrefix = suffix;
    return this;
  }

  /**
   * Set custom argument prefix for block format parameters.
   *
   * @param prefix - Custom prefix for argument markers (default: "!!!ARG:")
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * .withGadgetArgPrefix("<<ARG>>")
   * ```
   */
  withGadgetArgPrefix(prefix: string): this {
    this.gadgetArgPrefix = prefix;
    return this;
  }

  /**
   * Set the text-only handler strategy.
   *
   * Controls what happens when the LLM returns text without calling any gadgets:
   * - "terminate": End the agent loop (default)
   * - "acknowledge": Continue the loop for another iteration
   * - "wait_for_input": Wait for human input
   * - Custom handler: Provide a function for dynamic behavior
   *
   * @param handler - Text-only handler strategy or custom handler
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * // Simple strategy
   * .withTextOnlyHandler("acknowledge")
   *
   * // Custom handler
   * .withTextOnlyHandler({
   *   type: "custom",
   *   handler: async (context) => {
   *     if (context.text.includes("?")) {
   *       return { action: "wait_for_input", question: context.text };
   *     }
   *     return { action: "continue" };
   *   }
   * })
   * ```
   */
  withTextOnlyHandler(handler: TextOnlyHandler): this {
    this.textOnlyHandler = handler;
    return this;
  }

  /**
   * Set the handler for text content that appears alongside gadget calls.
   *
   * When set, text accompanying gadget responses will be wrapped as a
   * synthetic gadget call before the actual gadget results in the
   * conversation history.
   *
   * @param handler - Configuration for wrapping text
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * // Wrap text as TellUser gadget
   * .withTextWithGadgetsHandler({
   *   gadgetName: "TellUser",
   *   parameterMapping: (text) => ({ message: text, done: false, type: "info" }),
   *   resultMapping: (text) => `ℹ️  ${text}`,
   * })
   * ```
   */
  withTextWithGadgetsHandler(handler: {
    gadgetName: string;
    parameterMapping: (text: string) => Record<string, unknown>;
    resultMapping?: (text: string) => string;
  }): this {
    this.textWithGadgetsHandler = handler;
    return this;
  }

  /**
   * Set whether to stop gadget execution on first error.
   *
   * When true (default), if a gadget fails:
   * - Subsequent gadgets in the same response are skipped
   * - LLM stream is cancelled to save costs
   * - Agent loop continues with error in context
   *
   * When false:
   * - All gadgets in the response still execute
   * - LLM stream continues to completion
   *
   * @param stop - Whether to stop on gadget error
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * .withStopOnGadgetError(false)
   * ```
   */
  withStopOnGadgetError(stop: boolean): this {
    this.stopOnGadgetError = stop;
    return this;
  }

  /**
   * Set custom error handling logic.
   *
   * Provides fine-grained control over whether to continue after different types of errors.
   * Overrides `stopOnGadgetError` when provided.
   *
   * **Note:** This builder method configures the underlying `shouldContinueAfterError` option
   * in `AgentOptions`. The method is named `withErrorHandler` for better developer experience,
   * but maps to the `shouldContinueAfterError` property internally.
   *
   * @param handler - Function that decides whether to continue after an error.
   *                  Return `true` to continue execution, `false` to stop.
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * .withErrorHandler((context) => {
   *   // Stop on parse errors, continue on validation/execution errors
   *   if (context.errorType === "parse") {
   *     return false;
   *   }
   *   if (context.error.includes("CRITICAL")) {
   *     return false;
   *   }
   *   return true;
   * })
   * ```
   */
  withErrorHandler(
    handler: (context: {
      error: string;
      gadgetName: string;
      errorType: "parse" | "validation" | "execution";
      parameters?: Record<string, unknown>;
    }) => boolean | Promise<boolean>,
  ): this {
    this.shouldContinueAfterError = handler;
    return this;
  }

  /**
   * Set default timeout for gadget execution.
   *
   * @param timeoutMs - Timeout in milliseconds (must be non-negative)
   * @returns This builder for chaining
   * @throws {Error} If timeout is negative
   *
   * @example
   * ```typescript
   * .withDefaultGadgetTimeout(5000) // 5 second timeout
   * ```
   */
  withDefaultGadgetTimeout(timeoutMs: number): this {
    if (timeoutMs < 0) {
      throw new Error("Timeout must be a non-negative number");
    }
    this.defaultGadgetTimeoutMs = timeoutMs;
    return this;
  }

  /**
   * Enable or disable gadget output limiting.
   *
   * When enabled, gadget outputs exceeding the configured limit are stored
   * and can be browsed using the GadgetOutputViewer gadget.
   *
   * @param enabled - Whether to enable output limiting (default: true)
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * .withGadgetOutputLimit(false) // Disable output limiting
   * ```
   */
  withGadgetOutputLimit(enabled: boolean): this {
    this.gadgetOutputLimit = enabled;
    return this;
  }

  /**
   * Set the maximum gadget output as a percentage of the model's context window.
   *
   * Outputs exceeding this limit are stored for later browsing with GadgetOutputViewer.
   *
   * @param percent - Percentage of context window (1-100, default: 15)
   * @returns This builder for chaining
   * @throws {Error} If percent is not between 1 and 100
   *
   * @example
   * ```typescript
   * .withGadgetOutputLimitPercent(25) // 25% of context window
   * ```
   */
  withGadgetOutputLimitPercent(percent: number): this {
    if (percent < 1 || percent > 100) {
      throw new Error("Output limit percent must be between 1 and 100");
    }
    this.gadgetOutputLimitPercent = percent;
    return this;
  }

  /**
   * Configure context compaction.
   *
   * Context compaction automatically manages conversation history to prevent
   * context window overflow in long-running agent conversations.
   *
   * @param config - Compaction configuration options
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * // Custom thresholds
   * .withCompaction({
   *   triggerThresholdPercent: 70,
   *   targetPercent: 40,
   *   preserveRecentTurns: 10,
   * })
   *
   * // Different strategy
   * .withCompaction({
   *   strategy: 'sliding-window',
   * })
   *
   * // With callback
   * .withCompaction({
   *   onCompaction: (event) => {
   *     console.log(`Saved ${event.tokensBefore - event.tokensAfter} tokens`);
   *   }
   * })
   * ```
   */
  withCompaction(config: CompactionConfig): this {
    this.compactionConfig = { ...config, enabled: config.enabled ?? true };
    return this;
  }

  /**
   * Disable context compaction.
   *
   * By default, compaction is enabled. Use this method to explicitly disable it.
   *
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * .withoutCompaction() // Disable automatic compaction
   * ```
   */
  withoutCompaction(): this {
    this.compactionConfig = { enabled: false };
    return this;
  }

  /**
   * Set an abort signal for cancelling requests mid-flight.
   *
   * When the signal is aborted, the current LLM request will be cancelled
   * and the agent loop will exit gracefully.
   *
   * @param signal - AbortSignal from an AbortController
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * const controller = new AbortController();
   *
   * // Cancel after 30 seconds
   * setTimeout(() => controller.abort(), 30000);
   *
   * const agent = LLMist.createAgent()
   *   .withModel("sonnet")
   *   .withSignal(controller.signal)
   *   .ask("Write a long story");
   *
   * // Or cancel on user action
   * document.getElementById("cancel").onclick = () => controller.abort();
   * ```
   */
  withSignal(signal: AbortSignal): this {
    this.signal = signal;
    return this;
  }

  /**
   * Add an ephemeral trailing message that appears at the end of each LLM request.
   *
   * The message is NOT persisted to conversation history - it only appears in the
   * current LLM call. This is useful for injecting context-specific instructions
   * or reminders without polluting the conversation history.
   *
   * @param message - Static string or function that generates the message
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * // Static message
   * .withTrailingMessage("Always respond in JSON format.")
   *
   * // Dynamic message based on iteration
   * .withTrailingMessage((ctx) =>
   *   `[Iteration ${ctx.iteration}/${ctx.maxIterations}] Stay focused on the task.`
   * )
   * ```
   */
  withTrailingMessage(message: TrailingMessage): this {
    this.trailingMessage = message;
    return this;
  }

  /**
   * Add a synthetic gadget call to the conversation history.
   *
   * This is useful for in-context learning - showing the LLM what "past self"
   * did correctly so it mimics the pattern. The call is formatted with proper
   * markers and parameter format.
   *
   * @param gadgetName - Name of the gadget
   * @param parameters - Parameters passed to the gadget
   * @param result - Result returned by the gadget
   * @returns This builder for chaining
   *
   * @example
   * ```typescript
   * .withSyntheticGadgetCall(
   *   'TellUser',
   *   {
   *     message: '👋 Hello!\n\nHere\'s what I can do:\n- Analyze code\n- Run commands',
   *     done: false,
   *     type: 'info'
   *   },
   *   'ℹ️  👋 Hello!\n\nHere\'s what I can do:\n- Analyze code\n- Run commands'
   * )
   * ```
   */
  withSyntheticGadgetCall(
    gadgetName: string,
    parameters: Record<string, unknown>,
    result: string,
  ): this {
    const startPrefix = this.gadgetStartPrefix ?? GADGET_START_PREFIX;
    const endPrefix = this.gadgetEndPrefix ?? GADGET_END_PREFIX;

    const paramStr = this.formatBlockParameters(parameters, "");

    // Assistant message with gadget call
    this.initialMessages.push({
      role: "assistant",
      content: `${startPrefix}${gadgetName}\n${paramStr}\n${endPrefix}`,
    });

    // User message with result
    this.initialMessages.push({
      role: "user",
      content: `Result: ${result}`,
    });

    return this;
  }

  /**
   * Compose the final hooks, including trailing message if configured.
   */
  private composeHooks(): AgentHooks | undefined {
    if (!this.trailingMessage) {
      return this.hooks;
    }

    const trailingMsg = this.trailingMessage;
    const existingBeforeLLMCall = this.hooks?.controllers?.beforeLLMCall;

    const trailingMessageController = async (
      ctx: LLMCallControllerContext,
    ): Promise<BeforeLLMCallAction> => {
      // Run existing beforeLLMCall first if present
      const result: BeforeLLMCallAction = existingBeforeLLMCall
        ? await existingBeforeLLMCall(ctx)
        : { action: "proceed" };

      // If action is "skip", don't inject trailing message
      if (result.action === "skip") {
        return result;
      }

      // Get messages (possibly already modified by existing controller)
      const messages = [...(result.modifiedOptions?.messages || ctx.options.messages)];

      // Generate trailing message content
      const content =
        typeof trailingMsg === "function"
          ? trailingMsg({ iteration: ctx.iteration, maxIterations: ctx.maxIterations })
          : trailingMsg;

      // Append as ephemeral user message
      messages.push({ role: "user", content });

      return {
        action: "proceed",
        modifiedOptions: { ...result.modifiedOptions, messages },
      };
    };

    return {
      ...this.hooks,
      controllers: {
        ...this.hooks?.controllers,
        beforeLLMCall: trailingMessageController,
      },
    };
  }

  /**
   * Format parameters as block format with JSON Pointer paths.
   */
  private formatBlockParameters(params: Record<string, unknown>, prefix: string): string {
    const lines: string[] = [];
    const argPrefix = this.gadgetArgPrefix ?? GADGET_ARG_PREFIX;

    for (const [key, value] of Object.entries(params)) {
      const fullPath = prefix ? `${prefix}/${key}` : key;

      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          const itemPath = `${fullPath}/${index}`;
          if (typeof item === "object" && item !== null) {
            lines.push(this.formatBlockParameters(item as Record<string, unknown>, itemPath));
          } else {
            lines.push(`${argPrefix}${itemPath}`);
            lines.push(String(item));
          }
        });
      } else if (typeof value === "object" && value !== null) {
        lines.push(this.formatBlockParameters(value as Record<string, unknown>, fullPath));
      } else {
        lines.push(`${argPrefix}${fullPath}`);
        lines.push(String(value));
      }
    }

    return lines.join("\n");
  }

  /**
   * Build and create the agent with the given user prompt.
   * Returns the Agent instance ready to run.
   *
   * @param userPrompt - User's question or request
   * @returns Configured Agent instance
   *
   * @example
   * ```typescript
   * const agent = await LLMist.createAgent()
   *   .withModel("sonnet")
   *   .withGadgets(Calculator)
   *   .ask("What is 2+2?");
   *
   * for await (const event of agent.run()) {
   *   // handle events
   * }
   * ```
   */
  /**
   * Build AgentOptions with the given user prompt.
   * Centralizes options construction for ask(), askWithImage(), and askWithContent().
   */
  private buildAgentOptions(userPrompt: string | ContentPart[]): AgentOptions {
    // Lazy import to avoid circular dependency
    if (!this.client) {
      const { LLMist: LLMistClass } =
        require("../core/client.js") as typeof import("../core/client.js");
      this.client = new LLMistClass();
    }

    const registry = GadgetRegistry.from(this.gadgets);

    return {
      client: this.client,
      model: this.model ?? "openai:gpt-5-nano",
      systemPrompt: this.systemPrompt,
      userPrompt,
      registry,
      maxIterations: this.maxIterations,
      temperature: this.temperature,
      logger: this.logger,
      hooks: this.composeHooks(),
      promptConfig: this.promptConfig,
      initialMessages: this.initialMessages,
      onHumanInputRequired: this.onHumanInputRequired,
      gadgetStartPrefix: this.gadgetStartPrefix,
      gadgetEndPrefix: this.gadgetEndPrefix,
      gadgetArgPrefix: this.gadgetArgPrefix,
      textOnlyHandler: this.textOnlyHandler,
      textWithGadgetsHandler: this.textWithGadgetsHandler,
      stopOnGadgetError: this.stopOnGadgetError,
      shouldContinueAfterError: this.shouldContinueAfterError,
      defaultGadgetTimeoutMs: this.defaultGadgetTimeoutMs,
      gadgetOutputLimit: this.gadgetOutputLimit,
      gadgetOutputLimitPercent: this.gadgetOutputLimitPercent,
      compactionConfig: this.compactionConfig,
      signal: this.signal,
    };
  }

  ask(userPrompt: string): Agent {
    const options = this.buildAgentOptions(userPrompt);
    return new Agent(AGENT_INTERNAL_KEY, options);
  }

  /**
   * Build and create the agent with a multimodal user prompt (text + image).
   * Returns the Agent instance ready to run.
   *
   * @param textPrompt - Text prompt describing what to do with the image
   * @param imageData - Image data (Buffer, Uint8Array, or base64 string)
   * @param mimeType - Optional MIME type (auto-detected if not provided)
   * @returns Configured Agent instance
   *
   * @example
   * ```typescript
   * const agent = LLMist.createAgent()
   *   .withModel("gpt-4o")
   *   .withSystem("You analyze images")
   *   .askWithImage(
   *     "What's in this image?",
   *     await fs.readFile("photo.jpg")
   *   );
   *
   * for await (const event of agent.run()) {
   *   // handle events
   * }
   * ```
   */
  askWithImage(
    textPrompt: string,
    imageData: Buffer | Uint8Array | string,
    mimeType?: ImageMimeType,
  ): Agent {
    const imageBuffer =
      typeof imageData === "string" ? Buffer.from(imageData, "base64") : imageData;
    const detectedMime = mimeType ?? detectImageMimeType(imageBuffer);

    if (!detectedMime) {
      throw new Error(
        "Could not detect image MIME type. Please provide the mimeType parameter explicitly.",
      );
    }

    // Build multimodal content
    const userContent: ContentPart[] = [
      text(textPrompt),
      {
        type: "image",
        source: {
          type: "base64",
          mediaType: detectedMime,
          data: toBase64(imageBuffer),
        },
      },
    ];

    const options = this.buildAgentOptions(userContent);
    return new Agent(AGENT_INTERNAL_KEY, options);
  }

  /**
   * Build and return an Agent configured with multimodal content.
   * More flexible than askWithImage - accepts any combination of content parts.
   *
   * @param content - Array of content parts (text, images, audio)
   * @returns A configured Agent ready for execution
   *
   * @example
   * ```typescript
   * import { text, imageFromBuffer, audioFromBuffer } from "llmist";
   *
   * const agent = LLMist.createAgent()
   *   .withModel("gemini:gemini-2.5-flash")
   *   .askWithContent([
   *     text("Describe this image and transcribe the audio:"),
   *     imageFromBuffer(imageData),
   *     audioFromBuffer(audioData),
   *   ]);
   *
   * for await (const event of agent.run()) {
   *   // handle events
   * }
   * ```
   */
  askWithContent(content: ContentPart[]): Agent {
    const options = this.buildAgentOptions(content);
    return new Agent(AGENT_INTERNAL_KEY, options);
  }

  /**
   * Build, run, and collect only the text response.
   * Convenient for simple queries where you just want the final answer.
   *
   * @param userPrompt - User's question or request
   * @returns Promise resolving to the complete text response
   *
   * @example
   * ```typescript
   * const answer = await LLMist.createAgent()
   *   .withModel("gpt4-mini")
   *   .withGadgets(Calculator)
   *   .askAndCollect("What is 42 * 7?");
   *
   * console.log(answer); // "294"
   * ```
   */
  async askAndCollect(userPrompt: string): Promise<string> {
    const agent = this.ask(userPrompt);
    return collectText(agent.run());
  }

  /**
   * Build and run with event handlers.
   * Combines agent creation and event handling in one call.
   *
   * @param userPrompt - User's question or request
   * @param handlers - Event handlers
   *
   * @example
   * ```typescript
   * await LLMist.createAgent()
   *   .withModel("sonnet")
   *   .withGadgets(Calculator)
   *   .askWith("What is 2+2?", {
   *     onText: (text) => console.log("LLM:", text),
   *     onGadgetResult: (result) => console.log("Result:", result.result),
   *   });
   * ```
   */
  async askWith(userPrompt: string, handlers: EventHandlers): Promise<void> {
    const agent = this.ask(userPrompt);
    await agent.runWith(handlers);
  }

  /**
   * Build the agent without a user prompt.
   *
   * Returns an Agent instance that can be inspected (e.g., check registered gadgets)
   * but cannot be run without first calling .ask(prompt).
   *
   * This is useful for:
   * - Testing: Inspect the registry, configuration, etc.
   * - Advanced use cases: Build agent configuration separately from execution
   *
   * @returns Configured Agent instance (without user prompt)
   *
   * @example
   * ```typescript
   * // Build agent for inspection
   * const agent = new AgentBuilder()
   *   .withModel("sonnet")
   *   .withGadgets(Calculator, Weather)
   *   .build();
   *
   * // Inspect registered gadgets
   * console.log(agent.getRegistry().getNames()); // ['Calculator', 'Weather']
   *
   * // Note: Calling agent.run() will throw an error
   * // Use .ask(prompt) instead if you want to run the agent
   * ```
   */
  build(): Agent {
    // Lazy import to avoid circular dependency
    if (!this.client) {
      const { LLMist: LLMistClass } =
        require("../core/client.js") as typeof import("../core/client.js");
      this.client = new LLMistClass();
    }
    const registry = GadgetRegistry.from(this.gadgets);

    const options: AgentOptions = {
      client: this.client,
      model: this.model ?? "openai:gpt-5-nano",
      systemPrompt: this.systemPrompt,
      // No userPrompt - agent.run() will throw if called directly
      registry,
      maxIterations: this.maxIterations,
      temperature: this.temperature,
      logger: this.logger,
      hooks: this.composeHooks(),
      promptConfig: this.promptConfig,
      initialMessages: this.initialMessages,
      onHumanInputRequired: this.onHumanInputRequired,
      gadgetStartPrefix: this.gadgetStartPrefix,
      gadgetEndPrefix: this.gadgetEndPrefix,
      gadgetArgPrefix: this.gadgetArgPrefix,
      textOnlyHandler: this.textOnlyHandler,
      textWithGadgetsHandler: this.textWithGadgetsHandler,
      stopOnGadgetError: this.stopOnGadgetError,
      shouldContinueAfterError: this.shouldContinueAfterError,
      defaultGadgetTimeoutMs: this.defaultGadgetTimeoutMs,
      gadgetOutputLimit: this.gadgetOutputLimit,
      gadgetOutputLimitPercent: this.gadgetOutputLimitPercent,
      compactionConfig: this.compactionConfig,
      signal: this.signal,
    };

    return new Agent(AGENT_INTERNAL_KEY, options);
  }
}
