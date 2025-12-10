import OpenAI from "openai";
import type {
  ChatCompletionChunk,
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { encoding_for_model, type TiktokenModel } from "tiktoken";
import type { ContentPart, ImageContentPart } from "../core/input-content.js";
import type {
  ImageGenerationOptions,
  ImageGenerationResult,
  ImageModelSpec,
  SpeechGenerationOptions,
  SpeechGenerationResult,
  SpeechModelSpec,
} from "../core/media-types.js";
import type { LLMMessage, MessageContent } from "../core/messages.js";
import { extractText, normalizeContent } from "../core/messages.js";
import type { ModelSpec } from "../core/model-catalog.js";
import type { LLMGenerationOptions, LLMStream, ModelDescriptor } from "../core/options.js";
import { BaseProviderAdapter } from "./base-provider.js";
import {
  FALLBACK_CHARS_PER_TOKEN,
  OPENAI_MESSAGE_OVERHEAD_TOKENS,
  OPENAI_NAME_FIELD_OVERHEAD_TOKENS,
  OPENAI_REPLY_PRIMING_TOKENS,
} from "./constants.js";
import {
  calculateOpenAIImageCost,
  getOpenAIImageModelSpec,
  isOpenAIImageModel,
  openaiImageModels,
} from "./openai-image-models.js";
import { OPENAI_MODELS } from "./openai-models.js";
import {
  calculateOpenAISpeechCost,
  getOpenAISpeechModelSpec,
  isOpenAISpeechModel,
  openaiSpeechModels,
} from "./openai-speech-models.js";
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

  // =========================================================================
  // Image Generation
  // =========================================================================

  getImageModelSpecs(): ImageModelSpec[] {
    return openaiImageModels;
  }

  supportsImageGeneration(modelId: string): boolean {
    return isOpenAIImageModel(modelId);
  }

  async generateImage(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
    const client = this.client as OpenAI;
    const spec = getOpenAIImageModelSpec(options.model);

    const size = options.size ?? spec?.defaultSize ?? "1024x1024";
    const quality = options.quality ?? spec?.defaultQuality ?? "standard";
    const n = options.n ?? 1;

    // Determine which parameters to include based on model capabilities
    const isDallE2 = options.model === "dall-e-2";
    const isGptImage = options.model.startsWith("gpt-image");

    // Build request payload conditionally
    // - DALL-E 2: no quality parameter, no response_format
    // - GPT Image: quality uses low/medium/high, no response_format (uses output_format)
    // - DALL-E 3: supports quality (standard/hd) and response_format
    const requestParams: Parameters<typeof client.images.generate>[0] = {
      model: options.model,
      prompt: options.prompt,
      size: size as "1024x1024" | "1024x1792" | "1792x1024" | "256x256" | "512x512",
      n,
    };

    // Only DALL-E 3 supports the quality parameter with standard/hd values
    if (!isDallE2 && !isGptImage) {
      requestParams.quality = quality as "standard" | "hd";
    }

    // GPT Image models use output_format instead of response_format
    if (isGptImage) {
      // GPT Image supports: png, webp, jpeg
      // Map b64_json to the default format (png) since GPT Image API is different
      // For now, we'll always return URLs for GPT Image models
      // Note: GPT Image API uses different response structure
    } else if (!isDallE2) {
      // DALL-E 3 supports response_format
      requestParams.response_format = options.responseFormat ?? "url";
    }

    const response = await client.images.generate(requestParams);

    const cost = calculateOpenAIImageCost(options.model, size, quality, n);
    // Type assertion: we're not using streaming, so response is ImagesResponse
    const images = (response as OpenAI.Images.ImagesResponse).data ?? [];

    return {
      images: images.map((img) => ({
        url: img.url,
        b64Json: img.b64_json,
        revisedPrompt: img.revised_prompt,
      })),
      model: options.model,
      usage: {
        imagesGenerated: images.length,
        size,
        quality,
      },
      cost,
    };
  }

  // =========================================================================
  // Speech Generation
  // =========================================================================

  getSpeechModelSpecs(): SpeechModelSpec[] {
    return openaiSpeechModels;
  }

  supportsSpeechGeneration(modelId: string): boolean {
    return isOpenAISpeechModel(modelId);
  }

  async generateSpeech(options: SpeechGenerationOptions): Promise<SpeechGenerationResult> {
    const client = this.client as OpenAI;
    const spec = getOpenAISpeechModelSpec(options.model);

    const format = options.responseFormat ?? spec?.defaultFormat ?? "mp3";
    const voice = options.voice ?? spec?.defaultVoice ?? "alloy";

    const response = await client.audio.speech.create({
      model: options.model,
      input: options.input,
      voice: voice as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer",
      response_format: format,
      speed: options.speed ?? 1.0,
    });

    const audioBuffer = await response.arrayBuffer();
    const cost = calculateOpenAISpeechCost(options.model, options.input.length);

    return {
      audio: audioBuffer,
      model: options.model,
      usage: {
        characterCount: options.input.length,
      },
      cost,
      format,
    };
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
      messages: messages.map((message) => this.convertToOpenAIMessage(message)),
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

  /**
   * Convert an LLMMessage to OpenAI's ChatCompletionMessageParam.
   * Handles role-specific content type requirements:
   * - system/assistant: string content only
   * - user: string or multimodal array content
   */
  private convertToOpenAIMessage(message: LLMMessage): ChatCompletionMessageParam {
    const role = ROLE_MAP[message.role];

    // User messages support multimodal content
    if (role === "user") {
      const content = this.convertToOpenAIContent(message.content);
      return {
        role: "user",
        content,
        ...(message.name ? { name: message.name } : {}),
      };
    }

    // System and assistant messages only support string content
    const textContent = typeof message.content === "string" ? message.content : extractText(message.content);

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
   * Optimizes by returning string for text-only content, array for multimodal.
   */
  private convertToOpenAIContent(
    content: MessageContent,
  ): string | ChatCompletionContentPart[] {
    // Optimization: keep simple string content as-is
    if (typeof content === "string") {
      return content;
    }

    // Convert array content to OpenAI format
    return content.map((part) => {
      if (part.type === "text") {
        return { type: "text" as const, text: part.text };
      }

      if (part.type === "image") {
        return this.convertImagePart(part);
      }

      if (part.type === "audio") {
        throw new Error(
          "OpenAI chat completions do not support audio input. Use Whisper for transcription or Gemini for audio understanding.",
        );
      }

      throw new Error(`Unsupported content type: ${(part as ContentPart).type}`);
    });
  }

  /**
   * Convert an image content part to OpenAI's image_url format.
   * Supports both URLs and base64 data URLs.
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
    // Pass abort signal to SDK via request options
    const stream = await client.chat.completions.create(payload, signal ? { signal } : undefined);
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
        let imageCount = 0;

        // Count tokens per message with proper formatting
        // OpenAI's format adds tokens for message boundaries and roles
        // Token overhead based on OpenAI's message formatting
        // See: https://github.com/openai/openai-cookbook/blob/main/examples/How_to_count_tokens_with_tiktoken.ipynb
        for (const message of messages) {
          // Every message follows <im_start>{role/name}\n{content}<im_end>\n
          tokenCount += OPENAI_MESSAGE_OVERHEAD_TOKENS;

          const roleText = ROLE_MAP[message.role];
          tokenCount += encoding.encode(roleText).length;

          // Handle multimodal content
          const textContent = extractText(message.content);
          tokenCount += encoding.encode(textContent).length;

          // Count images for estimation (each image ~85 tokens base + variable)
          const parts = normalizeContent(message.content);
          for (const part of parts) {
            if (part.type === "image") {
              imageCount++;
            }
          }

          if (message.name) {
            tokenCount += encoding.encode(message.name).length;
            tokenCount += OPENAI_NAME_FIELD_OVERHEAD_TOKENS;
          }
        }

        tokenCount += OPENAI_REPLY_PRIMING_TOKENS;
        // Add ~765 tokens per image (low detail mode).
        // Source: https://platform.openai.com/docs/guides/vision
        // High detail mode varies by image size (510-1105 tokens per 512px tile + 85 base).
        tokenCount += imageCount * 765;

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
      let totalChars = 0;
      let imageCount = 0;
      for (const msg of messages) {
        const parts = normalizeContent(msg.content);
        for (const part of parts) {
          if (part.type === "text") {
            totalChars += part.text.length;
          } else if (part.type === "image") {
            imageCount++;
          }
        }
      }
      // Use same image token estimate as tiktoken path (765 tokens per image).
      return Math.ceil(totalChars / FALLBACK_CHARS_PER_TOKEN) + imageCount * 765;
    }
  }
}

export function createOpenAIProviderFromEnv(): OpenAIChatProvider | null {
  return createProviderFromEnv("OPENAI_API_KEY", OpenAI, OpenAIChatProvider);
}
