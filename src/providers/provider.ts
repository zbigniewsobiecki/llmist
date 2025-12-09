import type {
  ImageGenerationOptions,
  ImageGenerationResult,
  ImageModelSpec,
  SpeechGenerationOptions,
  SpeechGenerationResult,
  SpeechModelSpec,
} from "../core/media-types.js";
import type { LLMMessage } from "../core/messages.js";
import type { ModelSpec } from "../core/model-catalog.js";
import type { LLMGenerationOptions, LLMStream, ModelDescriptor } from "../core/options.js";

export interface ProviderAdapter {
  readonly providerId: string;

  /**
   * Optional priority for adapter resolution.
   * Higher numbers = higher priority (checked first).
   *
   * When multiple adapters support the same model descriptor, the adapter
   * with the highest priority is selected. Adapters with equal priority
   * maintain their registration order (stable sort).
   *
   * Default: 0 (normal priority)
   * Mock adapters use: 100 (high priority)
   *
   * @default 0
   */
  readonly priority?: number;

  supports(model: ModelDescriptor): boolean;
  stream(options: LLMGenerationOptions, descriptor: ModelDescriptor, spec?: ModelSpec): LLMStream;

  /**
   * Optionally provide model specifications for this provider.
   * This allows the model registry to discover available models and their capabilities.
   */
  getModelSpecs?(): ModelSpec[];

  /**
   * Count tokens in messages before making an API call.
   * Uses provider-specific native token counting methods.
   * @param messages - Array of messages to count tokens for
   * @param descriptor - Model descriptor
   * @param spec - Optional model specification
   * @returns Promise resolving to the number of input tokens
   */
  countTokens?(
    messages: LLMMessage[],
    descriptor: ModelDescriptor,
    spec?: ModelSpec,
  ): Promise<number>;

  // =========================================================================
  // Image Generation (optional)
  // =========================================================================

  /**
   * Get image model specifications for this provider.
   * Returns undefined if the provider doesn't support image generation.
   */
  getImageModelSpecs?(): ImageModelSpec[];

  /**
   * Check if this provider supports image generation for a given model.
   * @param modelId - Model identifier (e.g., "dall-e-3")
   */
  supportsImageGeneration?(modelId: string): boolean;

  /**
   * Generate images from a text prompt.
   * @param options - Image generation options
   * @returns Promise resolving to the generation result with images and cost
   */
  generateImage?(options: ImageGenerationOptions): Promise<ImageGenerationResult>;

  // =========================================================================
  // Speech Generation (optional)
  // =========================================================================

  /**
   * Get speech model specifications for this provider.
   * Returns undefined if the provider doesn't support speech generation.
   */
  getSpeechModelSpecs?(): SpeechModelSpec[];

  /**
   * Check if this provider supports speech generation for a given model.
   * @param modelId - Model identifier (e.g., "tts-1", "tts-1-hd")
   */
  supportsSpeechGeneration?(modelId: string): boolean;

  /**
   * Generate speech audio from text.
   * @param options - Speech generation options
   * @returns Promise resolving to the generation result with audio and cost
   */
  generateSpeech?(options: SpeechGenerationOptions): Promise<SpeechGenerationResult>;
}
