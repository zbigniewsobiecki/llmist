import OpenAI from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import { encoding_for_model, type TiktokenModel } from "tiktoken";
import type { LLMMessage } from "../core/messages.js";
import type { ModelSpec } from "../core/model-catalog.js";
import type { LLMGenerationOptions, LLMStream, ModelDescriptor } from "../core/options.js";
import { BaseProviderAdapter } from "./base-provider.js";
import {
  FALLBACK_CHARS_PER_TOKEN,
  OPENAI_MESSAGE_OVERHEAD_TOKENS,
  OPENAI_NAME_FIELD_OVERHEAD_TOKENS,
  OPENAI_REPLY_PRIMING_TOKENS,
} from "./constants.js";
import { OPENAI_MODELS } from "./openai-models.js";
import { createProviderFromEnv } from "./utils.js";

const ROLE_MAP: Record<LLMMessage["role"], "system" | "user" | "assistant"> = {
  system: "system",
  user: "user",
  assistant: "assistant",
};

// Note: Temperature support is now determined from the ModelSpec passed to stream()
// instead of being hardcoded at module level

function sanitizeExtra(
  extra: Record<string, unknown> | undefined,
  allowTemperature: boolean,
): Record<string, unknown> | undefined {
  if (!extra) {
    return undefined;
  }

  if (allowTemperature || !Object.hasOwn(extra, "temperature")) {
    return extra;
  }

  return Object.fromEntries(Object.entries(extra).filter(([key]) => key !== "temperature"));
}

export class OpenAIChatProvider extends BaseProviderAdapter {
  readonly providerId = "openai" as const;

  supports(descriptor: ModelDescriptor): boolean {
    return descriptor.provider === this.providerId;
  }

  getModelSpecs() {
    return OPENAI_MODELS;
  }

  protected buildRequestPayload(
    options: LLMGenerationOptions,
    descriptor: ModelDescriptor,
    spec: ModelSpec | undefined,
    messages: LLMMessage[],
  ): Parameters<OpenAI["chat"]["completions"]["create"]>[0] {
    const { maxTokens, temperature, topP, stopSequences, extra } = options;

    // Use spec metadata to determine temperature support, defaulting to true if spec is unavailable
    const supportsTemperature = spec?.metadata?.supportsTemperature !== false;
    const shouldIncludeTemperature = typeof temperature === "number" && supportsTemperature;
    const sanitizedExtra = sanitizeExtra(extra, shouldIncludeTemperature);

    return {
      model: descriptor.name,
      messages: messages.map((message) => ({
        role: ROLE_MAP[message.role],
        content: message.content,
        name: message.name,
      })),
      // Only set max_completion_tokens if explicitly provided
      // Otherwise let the API use "as much as fits" in the context window
      ...(maxTokens !== undefined ? { max_completion_tokens: maxTokens } : {}),
      top_p: topP,
      stop: stopSequences,
      stream: true,
      stream_options: { include_usage: true },
      ...(sanitizedExtra ?? {}),
      ...(shouldIncludeTemperature ? { temperature } : {}),
    };
  }

  protected async executeStreamRequest(
    payload: Parameters<OpenAI["chat"]["completions"]["create"]>[0],
  ): Promise<AsyncIterable<ChatCompletionChunk>> {
    const client = this.client as OpenAI;
    const stream = await client.chat.completions.create(payload);
    return stream as unknown as AsyncIterable<ChatCompletionChunk>;
  }

  protected async *wrapStream(iterable: AsyncIterable<unknown>): LLMStream {
    const stream = iterable as AsyncIterable<ChatCompletionChunk>;
    for await (const chunk of stream) {
      const text = chunk.choices.map((choice) => choice.delta?.content ?? "").join("");
      if (text) {
        yield { text, rawEvent: chunk };
      }

      const finishReason = chunk.choices.find((choice) => choice.finish_reason)?.finish_reason;

      // Extract token usage if available (typically in the final chunk)
      // OpenAI returns cached token count in prompt_tokens_details.cached_tokens
      const usage = chunk.usage
        ? {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
            cachedInputTokens:
              (chunk.usage as { prompt_tokens_details?: { cached_tokens?: number } })
                .prompt_tokens_details?.cached_tokens ?? 0,
          }
        : undefined;

      if (finishReason || usage) {
        yield { text: "", finishReason, usage, rawEvent: chunk };
      }
    }
  }

  /**
   * Count tokens in messages using OpenAI's tiktoken library.
   *
   * This method provides accurate token estimation for OpenAI models by:
   * - Using the model-specific tokenizer encoding
   * - Accounting for message formatting overhead
   * - Falling back to gpt-4o encoding for unknown models
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
   *   { provider: "openai", name: "gpt-4" }
   * );
   * ```
   */
  async countTokens(
    messages: LLMMessage[],
    descriptor: ModelDescriptor,
    _spec?: ModelSpec,
  ): Promise<number> {
    try {
      // Map model names to tiktoken models
      // For models not directly supported, use a reasonable default
      const modelName = descriptor.name as TiktokenModel;
      let encoding;

      try {
        encoding = encoding_for_model(modelName);
      } catch {
        // If the specific model isn't supported, fall back to gpt-4o which uses cl100k_base
        encoding = encoding_for_model("gpt-4o");
      }

      try {
        let tokenCount = 0;

        // Count tokens per message with proper formatting
        // OpenAI's format adds tokens for message boundaries and roles
        // Token overhead based on OpenAI's message formatting
        // See: https://github.com/openai/openai-cookbook/blob/main/examples/How_to_count_tokens_with_tiktoken.ipynb
        for (const message of messages) {
          // Every message follows <im_start>{role/name}\n{content}<im_end>\n
          tokenCount += OPENAI_MESSAGE_OVERHEAD_TOKENS;

          const roleText = ROLE_MAP[message.role];
          tokenCount += encoding.encode(roleText).length;
          tokenCount += encoding.encode(message.content ?? "").length;

          if (message.name) {
            tokenCount += encoding.encode(message.name).length;
            tokenCount += OPENAI_NAME_FIELD_OVERHEAD_TOKENS;
          }
        }

        tokenCount += OPENAI_REPLY_PRIMING_TOKENS;

        return tokenCount;
      } finally {
        // Always free the encoding to prevent memory leaks
        encoding.free();
      }
    } catch (error) {
      // Log the error for debugging
      console.warn(
        `Token counting failed for ${descriptor.name}, using fallback estimation:`,
        error,
      );
      // If tiktoken fails, provide a rough estimate
      const totalChars = messages.reduce((sum, msg) => sum + (msg.content?.length ?? 0), 0);
      return Math.ceil(totalChars / FALLBACK_CHARS_PER_TOKEN);
    }
  }
}

export function createOpenAIProviderFromEnv(): OpenAIChatProvider | null {
  return createProviderFromEnv("OPENAI_API_KEY", OpenAI, OpenAIChatProvider);
}
