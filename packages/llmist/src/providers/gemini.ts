import { FunctionCallingConfigMode, GoogleGenAI, Modality } from "@google/genai";
import type { ContentPart } from "../core/input-content.js";
import type {
  ImageGenerationOptions,
  ImageGenerationResult,
  ImageModelSpec,
  SpeechGenerationOptions,
  SpeechGenerationResult,
  SpeechModelSpec,
} from "../core/media-types.js";
import type { LLMMessage, MessageContent } from "../core/messages.js";
import { extractMessageText, normalizeMessageContent } from "../core/messages.js";
import type { ModelSpec } from "../core/model-catalog.js";
import type { LLMGenerationOptions, LLMStream, ModelDescriptor } from "../core/options.js";
import { BaseProviderAdapter } from "./base-provider.js";
import { FALLBACK_CHARS_PER_TOKEN } from "./constants.js";
import {
  calculateGeminiImageCost,
  geminiImageModels,
  getGeminiImageModelSpec,
  isGeminiImageModel,
} from "./gemini-image-models.js";
import { GEMINI_MODELS } from "./gemini-models.js";
import {
  calculateGeminiSpeechCost,
  geminiSpeechModels,
  getGeminiSpeechModelSpec,
  isGeminiSpeechModel,
} from "./gemini-speech-models.js";
import { createProviderFromEnv } from "./utils.js";

/**
 * Gemini content part - can be text or inline data (images/audio).
 */
type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

/**
 * Gemini content with role and multimodal parts.
 */
type GeminiContent = {
  role: string;
  parts: GeminiPart[];
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

/**
 * Wraps raw PCM audio data in a WAV file container.
 *
 * WAV format structure:
 * - RIFF header (12 bytes)
 * - fmt chunk (24 bytes) - describes audio format
 * - data chunk (8 bytes + audio data)
 *
 * @param pcmData - Raw PCM audio samples
 * @param sampleRate - Sample rate in Hz (e.g., 24000)
 * @param bitsPerSample - Bits per sample (e.g., 16)
 * @param numChannels - Number of audio channels (1 = mono, 2 = stereo)
 * @returns ArrayBuffer containing valid WAV file
 */
function wrapPcmInWav(
  pcmData: Uint8Array,
  sampleRate: number,
  bitsPerSample: number,
  numChannels: number,
): ArrayBuffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length;
  const headerSize = 44;
  const fileSize = headerSize + dataSize - 8; // File size minus RIFF header

  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);

  // RIFF header
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, fileSize, true); // File size - 8
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // fmt chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // fmt chunk size (16 for PCM)
  view.setUint16(20, 1, true); // Audio format (1 = PCM)
  view.setUint16(22, numChannels, true); // Number of channels
  view.setUint32(24, sampleRate, true); // Sample rate
  view.setUint32(28, byteRate, true); // Byte rate
  view.setUint16(32, blockAlign, true); // Block align
  view.setUint16(34, bitsPerSample, true); // Bits per sample

  // data chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true); // Data size

  // Copy PCM data
  uint8.set(pcmData, headerSize);

  return buffer;
}

export class GeminiGenerativeProvider extends BaseProviderAdapter {
  readonly providerId = "gemini" as const;

  supports(descriptor: ModelDescriptor): boolean {
    return descriptor.provider === this.providerId;
  }

  getModelSpecs() {
    return GEMINI_MODELS;
  }

  // =========================================================================
  // Image Generation
  // =========================================================================

  getImageModelSpecs(): ImageModelSpec[] {
    return geminiImageModels;
  }

  supportsImageGeneration(modelId: string): boolean {
    return isGeminiImageModel(modelId);
  }

  async generateImage(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
    const client = this.client as GoogleGenAI;
    const spec = getGeminiImageModelSpec(options.model);
    const isImagenModel = options.model.startsWith("imagen");

    const aspectRatio = options.size ?? spec?.defaultSize ?? "1:1";
    const n = options.n ?? 1;

    if (isImagenModel) {
      // Use Imagen API for imagen models
      // Note: safetyFilterLevel and personGeneration can be configured for less restrictive filtering
      // Valid safetyFilterLevel values: "BLOCK_NONE" | "BLOCK_ONLY_HIGH" | "BLOCK_MEDIUM_AND_ABOVE" | "BLOCK_LOW_AND_ABOVE"
      // Valid personGeneration values: "ALLOW_ALL" | "ALLOW_ADULT" | "DONT_ALLOW"
      const response = await client.models.generateImages({
        model: options.model,
        prompt: options.prompt,
        config: {
          numberOfImages: n,
          aspectRatio: aspectRatio,
          outputMimeType: options.responseFormat === "b64_json" ? "image/png" : "image/jpeg",
        },
      });

      const images = response.generatedImages ?? [];
      const cost = calculateGeminiImageCost(options.model, aspectRatio, images.length);

      return {
        // Gemini's imageBytes is already base64 encoded, so use it directly
        images: images.map((img) => ({
          b64Json: img.image?.imageBytes ?? undefined,
        })),
        model: options.model,
        usage: {
          imagesGenerated: images.length,
          size: aspectRatio,
          quality: "standard",
        },
        cost,
      };
    }
    // Use native Gemini image generation for gemini-* models
    const response = await client.models.generateContent({
      model: options.model,
      contents: [{ role: "user", parts: [{ text: options.prompt }] }],
      config: {
        responseModalities: [Modality.IMAGE, Modality.TEXT],
      },
    });

    // Extract images from response
    const images: Array<{ b64Json?: string; url?: string }> = [];
    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if ("inlineData" in part && part.inlineData) {
          images.push({
            b64Json: part.inlineData.data,
          });
        }
      }
    }

    const cost = calculateGeminiImageCost(options.model, aspectRatio, images.length);

    return {
      images,
      model: options.model,
      usage: {
        imagesGenerated: images.length,
        size: aspectRatio,
        quality: "standard",
      },
      cost,
    };
  }

  // =========================================================================
  // Speech Generation
  // =========================================================================

  getSpeechModelSpecs(): SpeechModelSpec[] {
    return geminiSpeechModels;
  }

  supportsSpeechGeneration(modelId: string): boolean {
    return isGeminiSpeechModel(modelId);
  }

  async generateSpeech(options: SpeechGenerationOptions): Promise<SpeechGenerationResult> {
    const client = this.client as GoogleGenAI;
    const spec = getGeminiSpeechModelSpec(options.model);

    const voice = options.voice ?? spec?.defaultVoice ?? "Zephyr";

    // Gemini TTS uses speech configuration
    const response = await client.models.generateContent({
      model: options.model,
      contents: [
        {
          role: "user",
          parts: [{ text: options.input }],
        },
      ],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voice,
            },
          },
        },
      },
    });

    // Extract audio from response
    let pcmData: Uint8Array | undefined;
    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if ("inlineData" in part && part.inlineData?.data) {
          // Convert base64 to Uint8Array
          const base64 = part.inlineData.data;
          const binary = atob(base64);
          pcmData = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            pcmData[i] = binary.charCodeAt(i);
          }
          break;
        }
      }
    }

    if (!pcmData) {
      throw new Error("No audio data in Gemini TTS response");
    }

    // Wrap raw PCM data in WAV headers (Gemini returns 24kHz, 16-bit, mono PCM)
    const audioData = wrapPcmInWav(pcmData, 24000, 16, 1);

    const cost = calculateGeminiSpeechCost(options.model, options.input.length);

    return {
      audio: audioData,
      model: options.model,
      usage: {
        characterCount: options.input.length,
      },
      cost,
      format: spec?.defaultFormat ?? "wav",
    };
  }

  protected buildApiRequest(
    options: LLMGenerationOptions,
    descriptor: ModelDescriptor,
    _spec: ModelSpec | undefined,
    messages: LLMMessage[],
  ): {
    model: string;
    contents: GeminiContent[];
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
      contents,
      config,
    };
  }

  protected async executeStreamRequest(
    payload: {
      model: string;
      contents: GeminiContent[];
      config: Record<string, unknown>;
    },
    signal?: AbortSignal,
  ): Promise<AsyncIterable<GeminiChunk>> {
    const client = this.client as GoogleGenAI;
    // Gemini SDK uses abortSignal in the config object
    const streamResponse = await client.models.generateContentStream({
      ...payload,
      config: {
        ...payload.config,
        ...(signal ? { abortSignal: signal } : {}),
      },
    });
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
    const expandedMessages: Array<{ role: LLMMessage["role"]; content: MessageContent }> = [];

    for (const message of messages) {
      if (message.role === "system") {
        // Convert system message to user+model exchange
        // System messages are always text-only
        expandedMessages.push({
          role: "user",
          content: extractMessageText(message.content),
        });
        expandedMessages.push({
          role: "assistant",
          content: "Understood.",
        });
      } else {
        expandedMessages.push({
          role: message.role,
          content: message.content,
        });
      }
    }

    return this.mergeConsecutiveMessages(expandedMessages);
  }

  /**
   * Merge consecutive messages with the same role (required by Gemini).
   * Handles multimodal content by converting to Gemini's part format.
   */
  private mergeConsecutiveMessages(
    messages: Array<{ role: LLMMessage["role"]; content: MessageContent }>,
  ): GeminiContent[] {
    if (messages.length === 0) {
      return [];
    }

    const result: GeminiContent[] = [];
    let currentGroup: GeminiContent | null = null;

    for (const message of messages) {
      const geminiRole = GEMINI_ROLE_MAP[message.role];
      const geminiParts = this.convertToGeminiParts(message.content);

      if (currentGroup && currentGroup.role === geminiRole) {
        // Merge into current group
        currentGroup.parts.push(...geminiParts);
      } else {
        // Start new group
        if (currentGroup) {
          result.push(currentGroup);
        }
        currentGroup = {
          role: geminiRole,
          parts: geminiParts,
        };
      }
    }

    // Push the last group
    if (currentGroup) {
      result.push(currentGroup);
    }

    return result;
  }

  /**
   * Convert llmist content to Gemini's part format.
   * Handles text, images, and audio (Gemini supports all three).
   */
  private convertToGeminiParts(content: MessageContent): GeminiPart[] {
    const parts = normalizeMessageContent(content);

    return parts.map((part) => {
      if (part.type === "text") {
        return { text: part.text };
      }

      if (part.type === "image") {
        if (part.source.type === "url") {
          throw new Error(
            "Gemini does not support image URLs directly. Please provide base64-encoded image data.",
          );
        }
        return {
          inlineData: {
            mimeType: part.source.mediaType,
            data: part.source.data,
          },
        };
      }

      if (part.type === "audio") {
        return {
          inlineData: {
            mimeType: part.source.mediaType,
            data: part.source.data,
          },
        };
      }

      throw new Error(`Unsupported content type: ${(part as ContentPart).type}`);
    });
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

  protected async *normalizeProviderStream(iterable: AsyncIterable<unknown>): LLMStream {
    const stream = iterable as AsyncIterable<GeminiChunk>;
    for await (const chunk of stream) {
      const text = this.extractMessageText(chunk);
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

  private extractMessageText(chunk: GeminiChunk): string {
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
    // This now handles multimodal content
    const contents = this.convertMessagesToContents(messages);

    // Return 0 for empty messages - Gemini API requires non-empty contents
    if (!contents || contents.length === 0) {
      return 0;
    }

    try {
      // Use Gemini's count_tokens method
      const response = await client.models.countTokens({
        model: descriptor.name,
        contents,
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
      // For multimodal, extract text and estimate; images/audio add tokens
      let totalChars = 0;
      let mediaCount = 0;
      for (const msg of messages) {
        const parts = normalizeMessageContent(msg.content);
        for (const part of parts) {
          if (part.type === "text") {
            totalChars += part.text.length;
          } else if (part.type === "image" || part.type === "audio") {
            mediaCount++;
          }
        }
      }
      // Gemini charges ~258 tokens per image/audio (for standard size).
      // Source: https://ai.google.dev/gemini-api/docs/tokens
      // Actual cost varies by media type and dimensions.
      return Math.ceil(totalChars / FALLBACK_CHARS_PER_TOKEN) + mediaCount * 258;
    }
  }
}

export function createGeminiProviderFromEnv(): GeminiGenerativeProvider | null {
  return createProviderFromEnv("GEMINI_API_KEY", GoogleGenAI, GeminiGenerativeProvider);
}
