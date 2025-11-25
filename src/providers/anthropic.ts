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

  protected buildRequestPayload(
    options: LLMGenerationOptions,
    descriptor: ModelDescriptor,
    spec: ModelSpec | undefined,
    messages: LLMMessage[],
  ): MessageCreateParamsStreaming {
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
  ): Promise<AsyncIterable<MessageStreamEvent>> {
    const client = this.client as Anthropic;
    const stream = await client.messages.create(payload);
    return stream as unknown as AsyncIterable<MessageStreamEvent>;
  }

  protected async *wrapStream(iterable: AsyncIterable<unknown>): LLMStream {
    const stream = iterable as AsyncIterable<MessageStreamEvent>;
    let inputTokens = 0;

    for await (const event of stream) {
      // Track and yield input tokens from message_start event
      if (event.type === "message_start") {
        inputTokens = event.message.usage.input_tokens;
        // Yield early so hooks can access input tokens before text streams
        yield {
          text: "",
          usage: {
            inputTokens,
            outputTokens: 0,
            totalTokens: inputTokens,
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
