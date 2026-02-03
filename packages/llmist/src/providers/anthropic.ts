import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  ImageBlockParam,
  MessageCreateParamsStreaming,
  MessageStreamEvent,
  TextBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import type { ContentPart, ImageContentPart, ImageMimeType } from "../core/input-content.js";
import type { LLMMessage, MessageContent } from "../core/messages.js";
import { extractMessageText, normalizeMessageContent } from "../core/messages.js";
import type { ModelSpec } from "../core/model-catalog.js";
import type {
  LLMGenerationOptions,
  LLMStream,
  ModelDescriptor,
  ReasoningConfig,
  ReasoningEffort,
} from "../core/options.js";
import { ANTHROPIC_MODELS } from "./anthropic-models.js";
import { BaseProviderAdapter } from "./base-provider.js";
import { ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS, FALLBACK_CHARS_PER_TOKEN } from "./constants.js";
import { createProviderFromEnv } from "./utils.js";

/** Maps llmist reasoning effort levels to Anthropic thinking budget_tokens */
const ANTHROPIC_EFFORT_BUDGET: Record<ReasoningEffort, number> = {
  none: 1024, // Minimum allowed by Anthropic
  low: 2048,
  medium: 8192,
  high: 16384,
  maximum: 32768,
};

/** Resolve Anthropic thinking parameters from ReasoningConfig */
function resolveAnthropicThinking(
  reasoning: ReasoningConfig | undefined,
): { type: "enabled"; budget_tokens: number } | undefined {
  if (!reasoning?.enabled) return undefined;

  // Explicit budget takes precedence (clamped to Anthropic's minimum of 1024)
  const budget = reasoning.budgetTokens
    ? Math.max(1024, reasoning.budgetTokens)
    : ANTHROPIC_EFFORT_BUDGET[reasoning.effort ?? "medium"];

  return { type: "enabled", budget_tokens: budget };
}

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

  protected buildApiRequest(
    options: LLMGenerationOptions,
    descriptor: ModelDescriptor,
    spec: ModelSpec | undefined,
    messages: LLMMessage[],
  ): MessageCreateParamsStreaming {
    // Caching is enabled by default for Anthropic (preserves existing behavior).
    // Only disabled when explicitly set to false via withoutCaching().
    const cachingEnabled = options.caching?.enabled !== false;

    const systemMessages = messages.filter((message) => message.role === "system");

    // System message as array of text blocks with cache_control on last block
    // This enables Anthropic's prompt caching for the system prompt
    // System messages are always text-only
    const system =
      systemMessages.length > 0
        ? systemMessages.map((m, index) => ({
            type: "text" as const,
            text: extractMessageText(m.content),
            // Add cache_control to the LAST system message block (only when caching is enabled)
            ...(cachingEnabled && index === systemMessages.length - 1
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

    // Build conversation with multimodal content support
    // Cache_control is added to the last part of the last user message (only when caching is enabled)
    const conversation = nonSystemMessages.map((message, index) => ({
      role: message.role,
      content: this.convertToAnthropicContent(
        message.content,
        cachingEnabled && message.role === "user" && index === lastUserIndex,
      ),
    }));

    // Anthropic requires max_tokens, so use a smart default if not specified
    // Use model's max from the passed spec, or fall back to the default constant
    const defaultMaxTokens = spec?.maxOutputTokens ?? ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS;

    // Resolve thinking configuration from reasoning config
    const thinking = resolveAnthropicThinking(options.reasoning);

    // Anthropic forbids temperature when thinking is enabled
    const temperature = thinking ? undefined : options.temperature;

    const payload: MessageCreateParamsStreaming = {
      model: descriptor.name,
      system,
      messages: conversation,
      max_tokens: options.maxTokens ?? defaultMaxTokens,
      temperature,
      top_p: options.topP,
      stop_sequences: options.stopSequences,
      stream: true,
      ...(thinking ? { thinking } : {}),
      ...options.extra,
    };

    return payload;
  }

  /**
   * Convert llmist content to Anthropic's content block format.
   * Handles text, images (base64 only), and applies cache_control.
   */
  private convertToAnthropicContent(
    content: MessageContent,
    addCacheControl: boolean,
  ): ContentBlockParam[] {
    const parts = normalizeMessageContent(content);

    return parts.map((part, index) => {
      const isLastPart = index === parts.length - 1;
      const cacheControl =
        addCacheControl && isLastPart ? { cache_control: { type: "ephemeral" as const } } : {};

      if (part.type === "text") {
        return {
          type: "text" as const,
          text: part.text,
          ...cacheControl,
        } as TextBlockParam;
      }

      if (part.type === "image") {
        return this.convertImagePart(part, cacheControl);
      }

      if (part.type === "audio") {
        throw new Error(
          "Anthropic does not support audio input. Use Google Gemini for audio processing.",
        );
      }

      throw new Error(`Unsupported content type: ${(part as ContentPart).type}`);
    });
  }

  /**
   * Convert an image content part to Anthropic's image block format.
   */
  private convertImagePart(
    part: ImageContentPart,
    cacheControl: { cache_control?: { type: "ephemeral" } },
  ): ImageBlockParam {
    if (part.source.type === "url") {
      throw new Error(
        "Anthropic does not support image URLs. Please provide base64-encoded image data instead.",
      );
    }

    return {
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: part.source.mediaType as ImageMimeType,
        data: part.source.data,
      },
      ...cacheControl,
    };
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

  protected async *normalizeProviderStream(iterable: AsyncIterable<unknown>): LLMStream {
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

      // Handle thinking content blocks (from extended thinking / reasoning mode)
      if (event.type === "content_block_start") {
        const block = event.content_block as { type: string };
        if (block.type === "thinking") {
          yield { text: "", thinking: { content: "", type: "thinking" }, rawEvent: event };
          continue;
        }
        if (block.type === "redacted_thinking") {
          yield { text: "", thinking: { content: "", type: "redacted" }, rawEvent: event };
          continue;
        }
      }

      if (event.type === "content_block_delta") {
        const delta = event.delta as { type: string; thinking?: string; signature?: string };
        if (delta.type === "thinking_delta" && delta.thinking) {
          yield {
            text: "",
            thinking: { content: delta.thinking, type: "thinking" },
            rawEvent: event,
          };
          continue;
        }
        if (delta.type === "signature_delta" && delta.signature) {
          yield {
            text: "",
            thinking: { content: "", type: "thinking", signature: delta.signature },
            rawEvent: event,
          };
          continue;
        }
        if (delta.type === "text_delta") {
          yield { text: (delta as { text?: string }).text ?? "", rawEvent: event };
          continue;
        }
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
      systemMessages.length > 0
        ? systemMessages.map((m) => extractMessageText(m.content)).join("\n\n")
        : undefined;

    // Convert messages to Anthropic format, handling multimodal content
    const conversation = messages
      .filter(
        (message): message is LLMMessage & { role: "user" | "assistant" } =>
          message.role !== "system",
      )
      .map((message) => ({
        role: message.role,
        content: this.convertToAnthropicContent(message.content, false),
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
      // For multimodal, extract text and estimate; images add ~1000 tokens
      let totalChars = 0;
      let imageCount = 0;
      for (const msg of messages) {
        const parts = normalizeMessageContent(msg.content);
        for (const part of parts) {
          if (part.type === "text") {
            totalChars += part.text.length;
          } else if (part.type === "image") {
            imageCount++;
          }
        }
      }
      // Anthropic charges ~1000 tokens per image (rough estimate).
      // Source: https://docs.anthropic.com/en/docs/build-with-claude/vision
      // Actual cost depends on image size, but this provides a reasonable fallback.
      return Math.ceil(totalChars / FALLBACK_CHARS_PER_TOKEN) + imageCount * 1000;
    }
  }
}

export function createAnthropicProviderFromEnv(): AnthropicMessagesProvider | null {
  return createProviderFromEnv("ANTHROPIC_API_KEY", Anthropic, AnthropicMessagesProvider);
}
