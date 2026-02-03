/**
 * OpenAI-Compatible Provider Base Class
 *
 * Base class for "meta-providers" that expose an OpenAI-compatible API
 * but route to multiple underlying models/providers. Examples include:
 * - OpenRouter (openrouter.ai)
 * - TogetherAI (together.ai)
 * - Fireworks (fireworks.ai)
 * - Anyscale (anyscale.com)
 *
 * This base class provides:
 * - OpenAI SDK integration with custom baseURL
 * - Message conversion to OpenAI format
 * - Streaming normalization
 * - Character-based token estimation
 * - Custom header support for analytics/tracking
 * - Pluggable error enhancement
 *
 * Subclasses implement:
 * - providerId and providerAlias
 * - getModelSpecs() for available models
 * - getCustomHeaders() for provider-specific headers
 * - enhanceError() for provider-specific error messages
 * - buildProviderSpecificParams() for provider-specific request options
 */

import OpenAI from "openai";
import type {
  ChatCompletionChunk,
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { ContentPart, ImageContentPart } from "../core/input-content.js";
import type { LLMMessage, MessageContent } from "../core/messages.js";
import { extractMessageText, normalizeMessageContent } from "../core/messages.js";
import type { ModelSpec } from "../core/model-catalog.js";
import type { LLMGenerationOptions, LLMStream, ModelDescriptor } from "../core/options.js";
import { BaseProviderAdapter } from "./base-provider.js";
import { FALLBACK_CHARS_PER_TOKEN } from "./constants.js";

const ROLE_MAP: Record<LLMMessage["role"], "system" | "user" | "assistant"> = {
  system: "system",
  user: "user",
  assistant: "assistant",
};

/**
 * Base configuration for OpenAI-compatible providers.
 * Subclasses can extend this with provider-specific options.
 */
export interface OpenAICompatibleConfig {
  /**
   * Optional custom headers to include in all requests.
   * Useful for analytics/tracking.
   */
  customHeaders?: Record<string, string>;
}

/**
 * Abstract base class for providers using OpenAI-compatible APIs.
 *
 * @example
 * ```typescript
 * class MyMetaProvider extends OpenAICompatibleProvider<MyConfig> {
 *   readonly providerId = "myprovider" as const;
 *   protected readonly providerAlias = "mp";
 *
 *   getModelSpecs() { return MY_MODELS; }
 *
 *   protected getCustomHeaders(): Record<string, string> {
 *     return { "X-My-Header": this.config.myValue };
 *   }
 *
 *   protected enhanceError(error: unknown): Error {
 *     // Provider-specific error handling
 *   }
 * }
 * ```
 */
export abstract class OpenAICompatibleProvider<
  TConfig extends OpenAICompatibleConfig = OpenAICompatibleConfig,
> extends BaseProviderAdapter {
  abstract readonly providerId: string;

  /**
   * Short alias for the provider (e.g., "or" for openrouter, "hf" for huggingface).
   * If not set, only the full providerId is accepted.
   */
  protected readonly providerAlias?: string;

  protected readonly config: TConfig;

  constructor(client: OpenAI, config: TConfig) {
    super(client);
    this.config = config;
  }

  /**
   * Check if this provider supports the given model descriptor.
   * Accepts both the full providerId and the short alias.
   */
  supports(descriptor: ModelDescriptor): boolean {
    return (
      descriptor.provider === this.providerId ||
      (this.providerAlias !== undefined && descriptor.provider === this.providerAlias)
    );
  }

  /**
   * Return the model specs for this provider.
   * Must be implemented by subclasses.
   */
  abstract getModelSpecs(): ModelSpec[];

  /**
   * Get custom headers to include in requests.
   * Override in subclasses for provider-specific headers.
   */
  protected getCustomHeaders(): Record<string, string> {
    return this.config.customHeaders ?? {};
  }

  /**
   * Enhance error messages with provider-specific guidance.
   * Override in subclasses for better error messages.
   */
  protected enhanceError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }
    return new Error(String(error));
  }

  /**
   * Build provider-specific request parameters.
   * Override in subclasses to add custom parameters from `extra`.
   *
   * @param extra - The extra options from LLMGenerationOptions
   * @returns Object with provider-specific params to merge into the request
   */
  protected buildProviderSpecificParams(
    _extra: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    return {};
  }

  protected buildApiRequest(
    options: LLMGenerationOptions,
    descriptor: ModelDescriptor,
    _spec: ModelSpec | undefined,
    messages: LLMMessage[],
  ): Parameters<OpenAI["chat"]["completions"]["create"]>[0] {
    const { maxTokens, temperature, topP, stopSequences, extra } = options;

    // Build base request
    const request: Record<string, unknown> = {
      model: descriptor.name,
      messages: messages.map((message) => this.convertMessage(message)),
      stream: true,
      stream_options: { include_usage: true },
    };

    // Standard optional parameters
    if (maxTokens !== undefined) {
      request.max_tokens = maxTokens;
    }
    if (temperature !== undefined) {
      request.temperature = temperature;
    }
    if (topP !== undefined) {
      request.top_p = topP;
    }
    if (stopSequences) {
      request.stop = stopSequences;
    }

    // Add provider-specific parameters
    const providerParams = this.buildProviderSpecificParams(extra as Record<string, unknown>);
    Object.assign(request, providerParams);

    // Pass through remaining extra options
    if (extra) {
      // Filter out keys that were already handled by buildProviderSpecificParams
      const handledKeys = Object.keys(providerParams);
      for (const [key, value] of Object.entries(extra)) {
        if (!handledKeys.includes(key) && !this.isProviderSpecificKey(key)) {
          request[key] = value;
        }
      }
    }

    return request as unknown as Parameters<OpenAI["chat"]["completions"]["create"]>[0];
  }

  /**
   * Check if a key should be filtered from passthrough.
   * Override in subclasses to filter provider-specific keys from extra.
   */
  protected isProviderSpecificKey(_key: string): boolean {
    return false;
  }

  /**
   * Convert an LLMMessage to OpenAI's ChatCompletionMessageParam format.
   */
  protected convertMessage(message: LLMMessage): ChatCompletionMessageParam {
    const role = ROLE_MAP[message.role];

    // User messages support multimodal content
    if (role === "user") {
      const content = this.convertContent(message.content);
      return {
        role: "user",
        content,
        ...(message.name ? { name: message.name } : {}),
      };
    }

    // System and assistant messages only support string content
    const textContent =
      typeof message.content === "string" ? message.content : extractMessageText(message.content);

    if (role === "system") {
      return {
        role: "system",
        content: textContent,
        ...(message.name ? { name: message.name } : {}),
      };
    }

    // Assistant role
    return {
      role: "assistant",
      content: textContent,
      ...(message.name ? { name: message.name } : {}),
    };
  }

  /**
   * Convert llmist content to OpenAI's content format.
   */
  protected convertContent(content: MessageContent): string | ChatCompletionContentPart[] {
    // Optimization: keep simple string content as-is
    if (typeof content === "string") {
      return content;
    }

    // Convert array content to OpenAI-compatible format
    return content.map((part) => {
      if (part.type === "text") {
        return { type: "text" as const, text: part.text };
      }

      if (part.type === "image") {
        return this.convertImagePart(part);
      }

      if (part.type === "audio") {
        throw new Error(
          `${this.providerId} does not support audio input through llmist. ` +
            `Check provider docs for model-specific audio support.`,
        );
      }

      throw new Error(`Unsupported content type: ${(part as ContentPart).type}`);
    });
  }

  /**
   * Convert an image content part to OpenAI's image_url format.
   */
  protected convertImagePart(part: ImageContentPart): ChatCompletionContentPart {
    if (part.source.type === "url") {
      return {
        type: "image_url" as const,
        image_url: { url: part.source.url },
      };
    }

    // Convert base64 to data URL format
    return {
      type: "image_url" as const,
      image_url: {
        url: `data:${part.source.mediaType};base64,${part.source.data}`,
      },
    };
  }

  protected async executeStreamRequest(
    payload: Parameters<OpenAI["chat"]["completions"]["create"]>[0],
    signal?: AbortSignal,
  ): Promise<AsyncIterable<ChatCompletionChunk>> {
    const client = this.client as OpenAI;

    // Get custom headers from subclass
    const headers = this.getCustomHeaders();

    const requestOptions: { signal?: AbortSignal; headers?: Record<string, string> } = {};
    if (signal) {
      requestOptions.signal = signal;
    }
    if (Object.keys(headers).length > 0) {
      requestOptions.headers = headers;
    }

    try {
      const stream = await client.chat.completions.create(
        payload,
        Object.keys(requestOptions).length > 0 ? requestOptions : undefined,
      );
      return stream as unknown as AsyncIterable<ChatCompletionChunk>;
    } catch (error) {
      // Use subclass-specific error enhancement
      throw this.enhanceError(error);
    }
  }

  protected async *normalizeProviderStream(iterable: AsyncIterable<unknown>): LLMStream {
    const stream = iterable as AsyncIterable<ChatCompletionChunk>;

    for await (const chunk of stream) {
      const text = chunk.choices.map((choice) => choice.delta?.content ?? "").join("");
      if (text) {
        yield { text, rawEvent: chunk };
      }

      const finishReason = chunk.choices.find((choice) => choice.finish_reason)?.finish_reason;

      // Extract token usage if available (typically in the final chunk)
      // Also extract reasoning tokens from completion_tokens_details if present
      type CompatUsageDetails = {
        completion_tokens_details?: { reasoning_tokens?: number };
      };
      const usageDetails = chunk.usage as (typeof chunk.usage & CompatUsageDetails) | undefined;
      const usage = chunk.usage
        ? {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
            cachedInputTokens: 0,
            reasoningTokens: usageDetails?.completion_tokens_details?.reasoning_tokens,
          }
        : undefined;

      if (finishReason || usage) {
        yield { text: "", finishReason, usage, rawEvent: chunk };
      }
    }
  }

  /**
   * Count tokens using character-based fallback estimation.
   * Most meta-providers don't have a native token counting API.
   */
  async countTokens(
    messages: LLMMessage[],
    descriptor: ModelDescriptor,
    _spec?: ModelSpec,
  ): Promise<number> {
    try {
      let totalChars = 0;
      for (const msg of messages) {
        const parts = normalizeMessageContent(msg.content);
        for (const part of parts) {
          if (part.type === "text") {
            totalChars += part.text.length;
          }
        }
      }

      return Math.ceil(totalChars / FALLBACK_CHARS_PER_TOKEN);
    } catch (error) {
      console.warn(`Token counting failed for ${descriptor.name}, using zero estimate:`, error);
      return 0;
    }
  }
}

/**
 * Helper function to create an OpenAI-compatible provider from environment.
 *
 * @param envKey - Environment variable name for the API key
 * @param baseURL - Base URL for the provider's API
 * @param ProviderClass - The provider class constructor
 * @param configFactory - Factory function to create config from env
 * @returns Provider instance or null if no API key
 */
export function createOpenAICompatibleProviderFromEnv<
  TConfig extends OpenAICompatibleConfig,
  TProvider extends OpenAICompatibleProvider<TConfig>,
>(
  envKey: string,
  baseURL: string,
  ProviderClass: new (client: OpenAI, config: TConfig) => TProvider,
  configFactory: () => TConfig,
): TProvider | null {
  const apiKey = process.env[envKey];

  if (!apiKey || apiKey.trim() === "") {
    return null;
  }

  const config = configFactory();

  const client = new OpenAI({
    apiKey: apiKey.trim(),
    baseURL,
    timeout: 120_000, // 2 minute timeout
    maxRetries: 0, // Disable SDK retries - llmist handles all retries at application level
  });

  return new ProviderClass(client, config);
}
