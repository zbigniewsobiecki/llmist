import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import type { LLMMessage } from "../core/messages.js";
import type { ModelSpec } from "../core/model-catalog.js";
import type { LLMGenerationOptions, LLMStream, ModelDescriptor } from "../core/options.js";
import { BaseProviderAdapter } from "./base-provider.js";
import { FALLBACK_CHARS_PER_TOKEN } from "./constants.js";
import { GEMINI_MODELS } from "./gemini-models.js";
import { createProviderFromEnv } from "./utils.js";

type GeminiContent = {
  role: string;
  parts: Array<{ text: string }>;
};

type GeminiChunk = {
  text?: () => string;
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
  };
};

const GEMINI_ROLE_MAP: Record<LLMMessage["role"], "user" | "model"> = {
  system: "user",
  user: "user",
  assistant: "model",
};

export class GeminiGenerativeProvider extends BaseProviderAdapter {
  readonly providerId = "gemini" as const;

  supports(descriptor: ModelDescriptor): boolean {
    return descriptor.provider === this.providerId;
  }

  getModelSpecs() {
    return GEMINI_MODELS;
  }

  protected buildRequestPayload(
    options: LLMGenerationOptions,
    descriptor: ModelDescriptor,
    _spec: ModelSpec | undefined,
    messages: LLMMessage[],
  ): {
    model: string;
    contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    config: Record<string, unknown>;
  } {
    // Convert messages to Gemini format (system messages become user+model exchanges)
    const contents = this.convertMessagesToContents(messages);
    const generationConfig = this.buildGenerationConfig(options);

    // Build the config object for the new SDK
    const config: Record<string, unknown> = {
      // Note: systemInstruction removed - it doesn't work with countTokens()
      // System messages are now included in contents as user+model exchanges
      ...(generationConfig ? { ...generationConfig } : {}),
      // Explicitly disable function calling to prevent UNEXPECTED_TOOL_CALL errors
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.NONE,
        },
      },
      ...options.extra,
    };

    return {
      model: descriptor.name,
      contents: this.convertContentsForNewSDK(contents),
      config,
    };
  }

  protected async executeStreamRequest(payload: {
    model: string;
    contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    config: Record<string, unknown>;
  }): Promise<AsyncIterable<GeminiChunk>> {
    const client = this.client as GoogleGenAI;
    const streamResponse = await client.models.generateContentStream(payload);
    return streamResponse as unknown as AsyncIterable<GeminiChunk>;
  }

  /**
   * Convert LLM messages to Gemini contents format.
   *
   * For Gemini, we convert system messages to user+model exchanges instead of
   * using systemInstruction, because:
   * 1. systemInstruction doesn't work with countTokens() API
   * 2. This approach gives perfect token counting accuracy (0% error)
   * 3. The model receives and follows system instructions identically
   *
   * System message: "You are a helpful assistant"
   * Becomes:
   * - User: "You are a helpful assistant"
   * - Model: "Understood."
   */
  private convertMessagesToContents(messages: LLMMessage[]): GeminiContent[] {
    const expandedMessages: LLMMessage[] = [];

    for (const message of messages) {
      if (message.role === "system") {
        // Convert system message to user+model exchange
        expandedMessages.push({
          role: "user",
          content: message.content,
        });
        expandedMessages.push({
          role: "assistant",
          content: "Understood.",
        });
      } else {
        expandedMessages.push(message);
      }
    }

    return this.mergeConsecutiveMessages(expandedMessages);
  }

  private mergeConsecutiveMessages(messages: LLMMessage[]): GeminiContent[] {
    if (messages.length === 0) {
      return [];
    }

    const result: GeminiContent[] = [];
    let currentGroup: GeminiContent | null = null;

    for (const message of messages) {
      const geminiRole = GEMINI_ROLE_MAP[message.role];

      if (currentGroup && currentGroup.role === geminiRole) {
        // Merge into current group
        currentGroup.parts.push({ text: message.content });
      } else {
        // Start new group
        if (currentGroup) {
          result.push(currentGroup);
        }
        currentGroup = {
          role: geminiRole,
          parts: [{ text: message.content }],
        };
      }
    }

    // Push the last group
    if (currentGroup) {
      result.push(currentGroup);
    }

    return result;
  }

  private convertContentsForNewSDK(
    contents: GeminiContent[],
  ): Array<{ role: string; parts: Array<{ text: string }> }> {
    // The new SDK expects a simpler format for contents
    return contents.map((content) => ({
      role: content.role,
      parts: content.parts.map((part) => ({ text: part.text })),
    }));
  }

  private buildGenerationConfig(options: LLMGenerationOptions) {
    const config: Record<string, unknown> = {};

    // Only set maxOutputTokens if explicitly provided
    // Otherwise let Gemini use "as much as fits" in the context window
    if (typeof options.maxTokens === "number") {
      config.maxOutputTokens = options.maxTokens;
    }

    if (typeof options.temperature === "number") {
      config.temperature = options.temperature;
    }
    if (typeof options.topP === "number") {
      config.topP = options.topP;
    }
    if (options.stopSequences?.length) {
      config.stopSequences = options.stopSequences;
    }

    return Object.keys(config).length > 0 ? config : null;
  }

  protected async *wrapStream(iterable: AsyncIterable<unknown>): LLMStream {
    const stream = iterable as AsyncIterable<GeminiChunk>;
    for await (const chunk of stream) {
      const text = this.extractText(chunk);
      if (text) {
        yield { text, rawEvent: chunk };
      }

      const finishReason = this.extractFinishReason(chunk);
      const usage = this.extractUsage(chunk);

      if (finishReason || usage) {
        yield { text: "", finishReason, usage, rawEvent: chunk };
      }
    }
  }

  private extractText(chunk: GeminiChunk): string {
    if (!chunk?.candidates) {
      return "";
    }

    return chunk.candidates
      .flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");
  }

  private extractFinishReason(chunk: GeminiChunk): string | null {
    const candidate = chunk?.candidates?.find((item) => item.finishReason);
    return candidate?.finishReason ?? null;
  }

  private extractUsage(
    chunk: GeminiChunk,
  ):
    | { inputTokens: number; outputTokens: number; totalTokens: number; cachedInputTokens?: number }
    | undefined {
    const usageMetadata = chunk?.usageMetadata;
    if (!usageMetadata) {
      return undefined;
    }

    return {
      inputTokens: usageMetadata.promptTokenCount ?? 0,
      outputTokens: usageMetadata.candidatesTokenCount ?? 0,
      totalTokens: usageMetadata.totalTokenCount ?? 0,
      // Gemini returns cached token count in cachedContentTokenCount
      cachedInputTokens: usageMetadata.cachedContentTokenCount ?? 0,
    };
  }

  /**
   * Count tokens in messages using Gemini's native token counting API.
   *
   * This method provides accurate token estimation for Gemini models by:
   * - Using the SDK's countTokens() method
   * - Converting system messages to user+model exchanges (same as in generation)
   * - This gives perfect token counting accuracy (0% error vs actual usage)
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
   *   { provider: "gemini", name: "gemini-1.5-pro" }
   * );
   * ```
   */
  async countTokens(
    messages: LLMMessage[],
    descriptor: ModelDescriptor,
    _spec?: ModelSpec,
  ): Promise<number> {
    const client = this.client as GoogleGenAI;

    // Convert messages to Gemini format (same as buildRequestPayload)
    const contents = this.convertMessagesToContents(messages);

    try {
      // Use Gemini's count_tokens method
      const response = await client.models.countTokens({
        model: descriptor.name,
        contents: this.convertContentsForNewSDK(contents),
        // Note: systemInstruction not used - it's not supported by countTokens()
        // and would cause a 2100% token counting error
      });
      return response.totalTokens ?? 0;
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

export function createGeminiProviderFromEnv(): GeminiGenerativeProvider | null {
  return createProviderFromEnv("GEMINI_API_KEY", GoogleGenAI, GeminiGenerativeProvider);
}
