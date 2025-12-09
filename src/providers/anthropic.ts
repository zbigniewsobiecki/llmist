import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageCreateParamsStreaming,
  MessageStreamEvent,
} from "@anthropic-ai/sdk/resources/messages";
import type { LLMMessage } from "../core/messages.js";
import type { ModelSpec } from "../core/model-catalog.js";
import type { LLMGenerationOptions, LLMStream, ModelDescriptor } from "../core/options.js";
import { ANTHROPIC_MODELS } from "./anthropic-models.js";
import { BaseProviderAdapter } from "./base-provider.js";
import { ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS, FALLBACK_CHARS_PER_TOKEN } from "./constants.js";
import { createProviderFromEnv } from "./utils.js";

export class AnthropicMessagesProvider extends BaseProviderAdapter {
  readonly providerId = "anthropic" as const;

  supports(descriptor: ModelDescriptor): boolean {
    return descriptor.provider === this.providerId;
  }

  getModelSpecs() {
    return ANTHROPIC_MODELS;
  }

  // =========================================================================
  // Image Generation (Not Supported)
  // =========================================================================

  supportsImageGeneration(_modelId: string): boolean {
    return false;
  }

  async generateImage(): Promise<never> {
    throw new Error(
      "Anthropic does not support image generation. Use OpenAI (DALL-E, GPT Image) or Google Gemini (Imagen) instead.",
    );
  }

  // =========================================================================
  // Speech Generation (Not Supported)
  // =========================================================================

  supportsSpeechGeneration(_modelId: string): boolean {
    return false;
  }

  async generateSpeech(): Promise<never> {
    throw new Error(
      "Anthropic does not support speech generation. Use OpenAI (TTS) or Google Gemini (TTS) instead.",
    );
  }

  protected buildRequestPayload(
    options: LLMGenerationOptions,
    descriptor: ModelDescriptor,
    spec: ModelSpec | undefined,
    messages: LLMMessage[],
  ): MessageCreateParamsStreaming {
    const systemMessages = messages.filter((message) => message.role === "system");

    // System message as array of text blocks with cache_control on last block
    // This enables Anthropic's prompt caching for the system prompt
    const system =
      systemMessages.length > 0
        ? systemMessages.map((m, index) => ({
            type: "text" as const,
            text: m.content,
            // Add cache_control to the LAST system message block
            ...(index === systemMessages.length - 1
              ? { cache_control: { type: "ephemeral" as const } }
              : {}),
          }))
        : undefined;

    const nonSystemMessages = messages.filter(
      (message): message is LLMMessage & { role: "user" | "assistant" } =>
        message.role !== "system",
    );

    // Find index of last user message for cache breakpoint
    const lastUserIndex = nonSystemMessages.reduce(
      (lastIdx, msg, idx) => (msg.role === "user" ? idx : lastIdx),
      -1,
    );

    // Build conversation with cache_control on the last user message
    // This caches the conversation history prefix for multi-turn efficiency
    const conversation = nonSystemMessages.map((message, index) => ({
      role: message.role,
      content: [
        {
          type: "text" as const,
          text: message.content,
          // Add cache_control to the LAST user message
          ...(message.role === "user" && index === lastUserIndex
            ? { cache_control: { type: "ephemeral" as const } }
            : {}),
        },
      ],
    }));

    // Anthropic requires max_tokens, so use a smart default if not specified
    // Use model's max from the passed spec, or fall back to the default constant
    const defaultMaxTokens = spec?.maxOutputTokens ?? ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS;

    const payload: MessageCreateParamsStreaming = {
      model: descriptor.name,
      system,
      messages: conversation,
      max_tokens: options.maxTokens ?? defaultMaxTokens,
      temperature: options.temperature,
      top_p: options.topP,
      stop_sequences: options.stopSequences,
      stream: true,
      ...options.extra,
    };

    return payload;
  }

  protected async executeStreamRequest(
    payload: MessageCreateParamsStreaming,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<MessageStreamEvent>> {
    const client = this.client as Anthropic;
    // Pass abort signal to SDK via request options
    const stream = await client.messages.create(payload, signal ? { signal } : undefined);
    return stream as unknown as AsyncIterable<MessageStreamEvent>;
  }

  protected async *wrapStream(iterable: AsyncIterable<unknown>): LLMStream {
    const stream = iterable as AsyncIterable<MessageStreamEvent>;
    let inputTokens = 0;
    let cachedInputTokens = 0;
    let cacheCreationInputTokens = 0;

    for await (const event of stream) {
      // Track and yield input tokens from message_start event
      // Anthropic returns cache_read_input_tokens and cache_creation_input_tokens
      if (event.type === "message_start") {
        const usage = event.message.usage as {
          input_tokens: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
        // Total input tokens includes uncached + cached reads + cache writes
        cachedInputTokens = usage.cache_read_input_tokens ?? 0;
        cacheCreationInputTokens = usage.cache_creation_input_tokens ?? 0;
        inputTokens = usage.input_tokens + cachedInputTokens + cacheCreationInputTokens;
        // Yield early so hooks can access input tokens before text streams
        yield {
          text: "",
          usage: {
            inputTokens,
            outputTokens: 0,
            totalTokens: inputTokens,
            cachedInputTokens,
            cacheCreationInputTokens,
          },
          rawEvent: event,
        };
        continue;
      }

      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { text: event.delta.text ?? "", rawEvent: event };
        continue;
      }

      if (event.type === "message_delta") {
        const usage = event.usage
          ? {
              inputTokens,
              outputTokens: event.usage.output_tokens,
              totalTokens: inputTokens + event.usage.output_tokens,
              cachedInputTokens,
              cacheCreationInputTokens,
            }
          : undefined;

        if (event.delta.stop_reason || usage) {
          yield {
            text: "",
            finishReason: event.delta.stop_reason ?? undefined,
            usage,
            rawEvent: event,
          };
        }
        continue;
      }

      if (event.type === "message_stop") {
        yield { text: "", finishReason: "stop", rawEvent: event };
      }
    }
  }

  /**
   * Count tokens in messages using Anthropic's native token counting API.
   *
   * This method provides accurate token estimation for Anthropic models by:
   * - Using the native messages.countTokens() API
   * - Properly handling system messages and conversation structure
   * - Transforming messages to Anthropic's expected format
   *
   * @param messages - The messages to count tokens for
   * @param descriptor - Model descriptor containing the model name
   * @param _spec - Optional model specification (currently unused)
   * @returns Promise resolving to the estimated input token count
   *
   * @throws Never throws - falls back to character-based estimation (4 chars/token) on error
   *
   * @example
   * ```typescript
   * const count = await provider.countTokens(
   *   [{ role: "user", content: "Hello!" }],
   *   { provider: "anthropic", name: "claude-3-5-sonnet-20241022" }
   * );
   * ```
   */
  async countTokens(
    messages: LLMMessage[],
    descriptor: ModelDescriptor,
    _spec?: ModelSpec,
  ): Promise<number> {
    const client = this.client as Anthropic;

    // Extract system messages and conversation messages
    const systemMessages = messages.filter((message) => message.role === "system");
    const system =
      systemMessages.length > 0 ? systemMessages.map((m) => m.content).join("\n\n") : undefined;

    const conversation = messages
      .filter(
        (message): message is LLMMessage & { role: "user" | "assistant" } =>
          message.role !== "system",
      )
      .map((message) => ({
        role: message.role,
        content: [
          {
            type: "text" as const,
            text: message.content,
          },
        ],
      }));

    try {
      // Use the native token counting API
      const response = await client.messages.countTokens({
        model: descriptor.name,
        messages: conversation,
        ...(system ? { system } : {}),
      });

      return response.input_tokens;
    } catch (error) {
      // Log the error for debugging
      console.warn(
        `Token counting failed for ${descriptor.name}, using fallback estimation:`,
        error,
      );
      // Fallback to rough estimation if API fails
      const totalChars = messages.reduce((sum, msg) => sum + (msg.content?.length ?? 0), 0);
      return Math.ceil(totalChars / FALLBACK_CHARS_PER_TOKEN);
    }
  }
}

export function createAnthropicProviderFromEnv(): AnthropicMessagesProvider | null {
  return createProviderFromEnv("ANTHROPIC_API_KEY", Anthropic, AnthropicMessagesProvider);
}
