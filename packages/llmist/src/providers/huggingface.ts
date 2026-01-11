/**
 * Hugging Face Provider Adapter
 *
 * Supports both serverless inference (router.huggingface.co) and
 * dedicated inference endpoints. Uses OpenAI SDK for API compatibility
 * since HF APIs follow OpenAI's chat completions format.
 *
 * Environment variables:
 * - HF_TOKEN (primary) or HUGGING_FACE_API_KEY (fallback)
 * - HF_ENDPOINT_URL (optional) - for dedicated endpoints
 *
 * Provider selection syntax (serverless only):
 * - model:fastest - route to fastest available provider
 * - model:cheapest - route to cheapest provider
 * - model:sambanova, model:groq, etc. - route to specific provider
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
import { HUGGINGFACE_MODELS } from "./huggingface-models.js";
import { isNonEmpty, readEnvVar } from "./utils.js";

const ROLE_MAP: Record<LLMMessage["role"], "system" | "user" | "assistant"> = {
  system: "system",
  user: "user",
  assistant: "assistant",
};

export class HuggingFaceProvider extends BaseProviderAdapter {
  readonly providerId = "huggingface" as const;
  private readonly endpointType: "serverless" | "dedicated";

  constructor(client: OpenAI, endpointType: "serverless" | "dedicated" = "serverless") {
    super(client);
    this.endpointType = endpointType;
  }

  supports(descriptor: ModelDescriptor): boolean {
    // Accept both "huggingface" and "hf" as provider identifiers
    return descriptor.provider === this.providerId || descriptor.provider === "hf";
  }

  getModelSpecs() {
    return HUGGINGFACE_MODELS;
  }

  protected buildApiRequest(
    options: LLMGenerationOptions,
    descriptor: ModelDescriptor,
    _spec: ModelSpec | undefined,
    messages: LLMMessage[],
  ): Parameters<OpenAI["chat"]["completions"]["create"]>[0] {
    const { maxTokens, temperature, topP, stopSequences, extra } = options;

    // Model name is passed as-is to HF API
    // Provider selection suffixes (:fastest, :cheapest, etc.) are handled by HF router
    return {
      model: descriptor.name,
      messages: messages.map((message) => this.convertToHuggingFaceMessage(message)),
      // HF accepts max_tokens (like many providers), though OpenAI uses max_completion_tokens
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      temperature,
      top_p: topP,
      stop: stopSequences,
      stream: true,
      stream_options: { include_usage: true },
      ...(extra ?? {}),
    };
  }

  /**
   * Convert an LLMMessage to HuggingFace's ChatCompletionMessageParam.
   * HF uses OpenAI-compatible format.
   * Handles role-specific content type requirements:
   * - system/assistant: string content only
   * - user: string or multimodal array content (for vision models)
   */
  private convertToHuggingFaceMessage(message: LLMMessage): ChatCompletionMessageParam {
    const role = ROLE_MAP[message.role];

    // User messages support multimodal content
    if (role === "user") {
      const content = this.convertToHuggingFaceContent(message.content);
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
   * Convert llmist content to HuggingFace's content format.
   * Optimizes by returning string for text-only content, array for multimodal.
   * Note: Multimodal support will be added in Phase 2.
   */
  private convertToHuggingFaceContent(
    content: MessageContent,
  ): string | ChatCompletionContentPart[] {
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
          "Hugging Face chat completions do not currently support audio input in llmist. Audio support will be added in Phase 2.",
        );
      }

      throw new Error(`Unsupported content type: ${(part as ContentPart).type}`);
    });
  }

  /**
   * Convert an image content part to HuggingFace's image_url format.
   * Supports both URLs and base64 data URLs (OpenAI-compatible format).
   * Note: Image support requires vision-capable models on HF.
   */
  private convertImagePart(part: ImageContentPart): ChatCompletionContentPart {
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

    try {
      // Pass abort signal to SDK via request options
      const stream = await client.chat.completions.create(payload, signal ? { signal } : undefined);
      return stream as unknown as AsyncIterable<ChatCompletionChunk>;
    } catch (error) {
      // Enhance error messages for HF-specific issues
      if (error instanceof Error) {
        if (error.message.includes("rate limit") || error.message.includes("429")) {
          throw new Error(
            `HF rate limit exceeded. Free tier has limits. Consider upgrading or using a dedicated endpoint. Original error: ${error.message}`,
          );
        }
        if (error.message.includes("model not found") || error.message.includes("404")) {
          throw new Error(
            `Model not available on HF ${this.endpointType} inference. Check model name or try a different endpoint type. Original error: ${error.message}`,
          );
        }
        if (error.message.includes("401") || error.message.includes("unauthorized")) {
          throw new Error(
            `HF authentication failed. Check that HF_TOKEN or HUGGING_FACE_API_KEY is set correctly and starts with 'hf_'. Original error: ${error.message}`,
          );
        }
        // HF serverless inference often returns 400 for transient capacity/loading issues
        // Wrap these to make them identifiable and allow retry logic to treat them as rate limits
        if (error.message.includes("400") || error.name === "BadRequestError") {
          throw new Error(
            `HF bad request (often transient on serverless). Original error: ${error.message}`,
          );
        }
      }
      throw error;
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
      // HF follows OpenAI format for token usage
      const usage = chunk.usage
        ? {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
            // HF doesn't currently support prompt caching, but structure is ready
            cachedInputTokens: 0,
          }
        : undefined;

      if (finishReason || usage) {
        yield { text: "", finishReason, usage, rawEvent: chunk };
      }
    }
  }

  /**
   * Count tokens in messages using character-based fallback estimation.
   *
   * Hugging Face doesn't provide a native token counting API yet, so we use
   * a simple character-based heuristic (4 chars per token) which is reasonably
   * accurate for most models.
   *
   * Future enhancement: Could integrate tiktoken for common model families
   * (Llama, Mistral) that use known tokenizers.
   *
   * @param messages - The messages to count tokens for
   * @param descriptor - Model descriptor containing the model name
   * @param _spec - Optional model specification (currently unused)
   * @returns Promise resolving to the estimated input token count
   *
   * @throws Never throws - returns 0 on error with warning
   */
  async countTokens(
    messages: LLMMessage[],
    descriptor: ModelDescriptor,
    _spec?: ModelSpec,
  ): Promise<number> {
    try {
      // Extract text content from all messages
      let totalChars = 0;
      for (const msg of messages) {
        const parts = normalizeMessageContent(msg.content);
        for (const part of parts) {
          if (part.type === "text") {
            totalChars += part.text.length;
          }
        }
      }

      // Use standard 4 chars/token estimate
      // This is a reasonable heuristic for most LLMs
      return Math.ceil(totalChars / FALLBACK_CHARS_PER_TOKEN);
    } catch (error) {
      console.warn(`Token counting failed for ${descriptor.name}, using zero estimate:`, error);
      return 0;
    }
  }
}

/**
 * Create a Hugging Face provider from environment variables.
 *
 * Environment variables:
 * - HF_TOKEN (primary) or HUGGING_FACE_API_KEY (fallback) - Required for authentication
 * - HF_ENDPOINT_URL (optional) - Custom endpoint URL for dedicated deployments
 *
 * @returns HuggingFaceProvider instance or null if no API key is found
 *
 * @example
 * ```bash
 * # Serverless inference (default)
 * export HF_TOKEN="hf_..."
 *
 * # Dedicated endpoint
 * export HF_TOKEN="hf_..."
 * export HF_ENDPOINT_URL="https://xxx.endpoints.huggingface.cloud"
 * ```
 */
export function createHuggingFaceProviderFromEnv(): HuggingFaceProvider | null {
  // Try HF_TOKEN first (official HF environment variable), then fallback to HUGGING_FACE_API_KEY
  const token = readEnvVar("HF_TOKEN") || readEnvVar("HUGGING_FACE_API_KEY");

  if (!isNonEmpty(token)) {
    return null;
  }

  // Validate token format (HF tokens should start with "hf_")
  if (!token.startsWith("hf_")) {
    console.warn(
      "Warning: HF token should start with 'hf_'. Authentication may fail if token format is incorrect.",
    );
  }

  // Check for custom endpoint URL (for dedicated deployments)
  const endpointUrl = readEnvVar("HF_ENDPOINT_URL");
  const baseURL = endpointUrl || "https://router.huggingface.co/v1";
  const endpointType = endpointUrl ? "dedicated" : "serverless";

  // Create OpenAI SDK client with HF base URL
  const client = new OpenAI({
    apiKey: token.trim(),
    baseURL,
    timeout: 60_000, // 60s timeout - HF free tier can be slower than OpenAI
    maxRetries: 0, // Disable SDK retries - llmist handles all retries at application level
  });

  return new HuggingFaceProvider(client, endpointType);
}
