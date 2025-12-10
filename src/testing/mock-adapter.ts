import type {
  ImageGenerationOptions,
  ImageGenerationResult,
  SpeechGenerationOptions,
  SpeechGenerationResult,
} from "../core/media-types.js";
import type { LLMGenerationOptions, LLMStream, ModelDescriptor } from "../core/options.js";
import type { ProviderAdapter } from "../providers/provider.js";
import { getMockManager, type MockManager } from "./mock-manager.js";
import { createMockStream } from "./mock-stream.js";
import type { MockMatcherContext, MockOptions, MockResponse } from "./mock-types.js";

/**
 * Provider adapter that serves mock responses instead of making real LLM API calls.
 * This is useful for testing applications that use llmist without incurring API costs.
 *
 * The MockProviderAdapter has high priority (100) and is always checked before
 * real providers when both are registered. This enables selective mocking where
 * some models use mocks while others use real providers. If no matching mock is
 * found and strictMode is disabled, requests return an empty response.
 *
 * @example
 * ```typescript
 * import { LLMist, createMockAdapter, mockLLM } from 'llmist/testing';
 *
 * // Use with real providers for selective mocking
 * const client = new LLMist({
 *   adapters: [createMockAdapter()],
 *   autoDiscoverProviders: true // Also loads real OpenAI, Anthropic, etc.
 * });
 *
 * // Register mocks for specific models
 * mockLLM()
 *   .forModel('gpt-5-nano')
 *   .returns('Test response')
 *   .register();
 *
 * // gpt-5-nano uses mock, other models use real providers
 * const stream = client.stream({
 *   model: 'openai:gpt-5-nano',
 *   messages: [{ role: 'user', content: 'test' }]
 * });
 * ```
 */
export class MockProviderAdapter implements ProviderAdapter {
  readonly providerId = "mock";
  readonly priority = 100; // High priority: check mocks before real providers
  private readonly mockManager: MockManager;

  constructor(options?: MockOptions) {
    this.mockManager = getMockManager(options);
  }

  supports(_descriptor: ModelDescriptor): boolean {
    // Support any provider when using mock adapter
    // This allows tests to use "openai:gpt-4", "anthropic:claude", etc.
    return true;
  }

  stream(
    options: LLMGenerationOptions,
    descriptor: ModelDescriptor,
    _spec?: unknown,
  ): LLMStream {
    // Create matcher context
    const context: MockMatcherContext = {
      model: options.model,
      provider: descriptor.provider,
      modelName: descriptor.name,
      options,
      messages: options.messages,
    };

    // Find matching mock (async operation)
    // We need to handle this in the stream generator
    return this.createMockStreamFromContext(context);
  }

  private async *createMockStreamFromContext(context: MockMatcherContext): LLMStream {
    // Find matching mock
    const mockResponse = await this.mockManager.findMatch(context);

    if (!mockResponse) {
      // This should not happen if MockManager is configured correctly
      // but handle it gracefully
      yield {
        text: "",
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
      return;
    }

    // Stream the mock response
    yield* createMockStream(mockResponse);
  }

  // ==========================================================================
  // Image Generation Support
  // ==========================================================================

  /**
   * Check if this adapter supports image generation for a given model.
   * Returns true if there's a registered mock with images for this model.
   */
  supportsImageGeneration(_modelId: string): boolean {
    // Always return true so the mock adapter can intercept all image requests
    return true;
  }

  /**
   * Generate mock images based on registered mocks.
   *
   * @param options - Image generation options
   * @returns Mock image generation result
   */
  async generateImage(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
    // Create a matcher context for image generation
    const context: MockMatcherContext = {
      model: options.model,
      provider: "mock",
      modelName: options.model,
      options: {
        model: options.model,
        messages: [{ role: "user", content: options.prompt }],
      },
      messages: [{ role: "user", content: options.prompt }],
    };

    const mockResponse = await this.mockManager.findMatch(context);

    if (!mockResponse?.images || mockResponse.images.length === 0) {
      throw new Error(
        `No mock registered for image generation with model "${options.model}". ` +
          `Use mockLLM().forModel("${options.model}").returnsImage(...).register() to add one.`,
      );
    }

    return this.createImageResult(options, mockResponse);
  }

  /**
   * Transform mock response into ImageGenerationResult format.
   *
   * @param options - Original image generation options
   * @param mockResponse - Mock response containing image data
   * @returns ImageGenerationResult with mock data and zero cost
   */
  private createImageResult(
    options: ImageGenerationOptions,
    mockResponse: MockResponse,
  ): ImageGenerationResult {
    const images = mockResponse.images ?? [];

    return {
      images: images.map((img) => ({
        b64Json: img.data,
        revisedPrompt: img.revisedPrompt,
      })),
      model: options.model,
      usage: {
        imagesGenerated: images.length,
        size: options.size ?? "1024x1024",
        quality: options.quality ?? "standard",
      },
      cost: 0, // Mock cost is always 0
    };
  }

  // ==========================================================================
  // Speech Generation Support
  // ==========================================================================

  /**
   * Check if this adapter supports speech generation for a given model.
   * Returns true if there's a registered mock with audio for this model.
   */
  supportsSpeechGeneration(_modelId: string): boolean {
    // Always return true so the mock adapter can intercept all speech requests
    return true;
  }

  /**
   * Generate mock speech based on registered mocks.
   *
   * @param options - Speech generation options
   * @returns Mock speech generation result
   */
  async generateSpeech(options: SpeechGenerationOptions): Promise<SpeechGenerationResult> {
    // Create a matcher context for speech generation
    const context: MockMatcherContext = {
      model: options.model,
      provider: "mock",
      modelName: options.model,
      options: {
        model: options.model,
        messages: [{ role: "user", content: options.input }],
      },
      messages: [{ role: "user", content: options.input }],
    };

    const mockResponse = await this.mockManager.findMatch(context);

    if (!mockResponse?.audio) {
      throw new Error(
        `No mock registered for speech generation with model "${options.model}". ` +
          `Use mockLLM().forModel("${options.model}").returnsAudio(...).register() to add one.`,
      );
    }

    return this.createSpeechResult(options, mockResponse);
  }

  /**
   * Transform mock response into SpeechGenerationResult format.
   * Converts base64 audio data to ArrayBuffer.
   *
   * @param options - Original speech generation options
   * @param mockResponse - Mock response containing audio data
   * @returns SpeechGenerationResult with mock data and zero cost
   */
  private createSpeechResult(
    options: SpeechGenerationOptions,
    mockResponse: MockResponse,
  ): SpeechGenerationResult {
    // biome-ignore lint/style/noNonNullAssertion: audio is verified to exist in generateSpeech before calling this
    const audio = mockResponse.audio!;

    // Convert base64 to ArrayBuffer
    const binaryString = atob(audio.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Determine audio format from MIME type
    const format = this.mimeTypeToAudioFormat(audio.mimeType);

    return {
      audio: bytes.buffer,
      model: options.model,
      usage: {
        characterCount: options.input.length,
      },
      cost: 0, // Mock cost is always 0
      format,
    };
  }

  /**
   * Map MIME type to audio format for SpeechGenerationResult.
   * Defaults to "mp3" for unknown MIME types.
   *
   * @param mimeType - Audio MIME type string
   * @returns Audio format identifier
   */
  private mimeTypeToAudioFormat(mimeType: string): "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm" {
    const mapping: Record<string, "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm"> = {
      "audio/mp3": "mp3",
      "audio/mpeg": "mp3",
      "audio/wav": "wav",
      "audio/webm": "opus",
      "audio/ogg": "opus",
    };
    return mapping[mimeType] ?? "mp3";
  }
}

/**
 * Create a mock provider adapter instance.
 * This is a convenience factory function.
 *
 * @param options - Optional configuration for the mock system
 * @returns A configured MockProviderAdapter
 *
 * @example
 * ```typescript
 * const adapter = createMockAdapter({ strictMode: true, debug: true });
 * const client = new LLMist([adapter]);
 * ```
 */
export function createMockAdapter(options?: MockOptions): MockProviderAdapter {
  return new MockProviderAdapter(options);
}
