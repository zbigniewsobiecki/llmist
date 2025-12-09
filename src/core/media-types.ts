/**
 * Types and interfaces for multimodal generation (image, speech).
 *
 * These types support non-token-based billing models where costs are calculated
 * per-image, per-character, or per-second rather than per-token.
 */

// ============================================================================
// Image Generation Types
// ============================================================================

/**
 * Options for image generation requests.
 */
export interface ImageGenerationOptions {
  /** Model to use (e.g., "dall-e-3", "imagen-3.0-generate-002") */
  model: string;

  /** Text prompt describing the desired image */
  prompt: string;

  /**
   * Image size/dimensions.
   * - OpenAI: "1024x1024", "1024x1792", "1792x1024"
   * - Gemini: "1:1", "3:4", "4:3", "9:16", "16:9"
   */
  size?: string;

  /**
   * Image quality level.
   * - OpenAI: "standard", "hd"
   */
  quality?: string;

  /**
   * Number of images to generate.
   * Note: DALL-E 3 only supports n=1
   */
  n?: number;

  /**
   * Response format for the generated image.
   * - "url": Returns a URL to the image (expires after ~1 hour)
   * - "b64_json": Returns base64-encoded image data
   */
  responseFormat?: "url" | "b64_json";
}

/**
 * A single generated image.
 */
export interface GeneratedImage {
  /** URL to the generated image (if responseFormat is "url") */
  url?: string;

  /** Base64-encoded image data (if responseFormat is "b64_json") */
  b64Json?: string;

  /** Revised prompt (if the model modified the original prompt) */
  revisedPrompt?: string;
}

/**
 * Usage information for image generation.
 */
export interface ImageUsage {
  /** Number of images generated */
  imagesGenerated: number;

  /** Size of generated images */
  size: string;

  /** Quality level used */
  quality: string;
}

/**
 * Result of an image generation request.
 */
export interface ImageGenerationResult {
  /** Array of generated images */
  images: GeneratedImage[];

  /** Model used for generation */
  model: string;

  /** Usage information */
  usage: ImageUsage;

  /** Estimated cost in USD */
  cost?: number;
}

// ============================================================================
// Speech Generation Types
// ============================================================================

/**
 * Available audio formats for speech generation.
 */
export type AudioFormat = "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";

/**
 * Options for speech (TTS) generation requests.
 */
export interface SpeechGenerationOptions {
  /** Model to use (e.g., "tts-1", "tts-1-hd") */
  model: string;

  /** Text to convert to speech */
  input: string;

  /**
   * Voice to use for generation.
   * - OpenAI: "alloy", "echo", "fable", "onyx", "nova", "shimmer"
   * - Gemini: "Zephyr", "Puck", "Charon", "Kore", etc.
   */
  voice: string;

  /** Output audio format (default: "mp3") */
  responseFormat?: AudioFormat;

  /**
   * Speed of the generated audio.
   * Range: 0.25 to 4.0 (default: 1.0)
   */
  speed?: number;
}

/**
 * Usage information for speech generation.
 */
export interface SpeechUsage {
  /** Number of characters processed */
  characterCount: number;
}

/**
 * Result of a speech generation request.
 */
export interface SpeechGenerationResult {
  /** Generated audio data */
  audio: ArrayBuffer;

  /** Model used for generation */
  model: string;

  /** Usage information */
  usage: SpeechUsage;

  /** Estimated cost in USD */
  cost?: number;

  /** Audio format of the result */
  format: AudioFormat;
}

// ============================================================================
// Model Specification Types
// ============================================================================

/**
 * Pricing structure for image models.
 * Maps size -> quality -> price per image.
 */
export interface ImageModelPricing {
  /** Simple per-image price (for models with uniform pricing) */
  perImage?: number;

  /**
   * Size-based pricing.
   * Maps size (e.g., "1024x1024") to quality-based pricing or flat price.
   */
  bySize?: Record<string, Record<string, number> | number>;
}

/**
 * Pricing structure for speech models.
 * Supports both character-based pricing (tts-1, tts-1-hd) and
 * token-based pricing (gpt-4o-mini-tts).
 */
export interface SpeechModelPricing {
  /** Price per character (e.g., 0.000015 for $15 per 1M chars) - for tts-1, tts-1-hd */
  perCharacter?: number;

  /** Token-based pricing (for gpt-4o-mini-tts) */
  perInputToken?: number; // e.g., $0.60 per 1M = 0.0000006
  perAudioOutputToken?: number; // e.g., $12 per 1M = 0.000012

  /** Approximate cost per minute of generated audio (for estimation) */
  perMinute?: number;
}

/**
 * Specification for an image generation model.
 */
export interface ImageModelSpec {
  /** Provider identifier (e.g., "openai", "gemini") */
  provider: string;

  /** Model identifier */
  modelId: string;

  /** Human-readable display name */
  displayName: string;

  /** Pricing information */
  pricing: ImageModelPricing;

  /** Supported image sizes */
  supportedSizes: string[];

  /** Supported quality levels (optional) */
  supportedQualities?: string[];

  /** Maximum images per request */
  maxImages: number;

  /** Default size if not specified */
  defaultSize?: string;

  /** Default quality if not specified */
  defaultQuality?: string;

  /** Additional feature flags */
  features?: {
    /** Supports conversational/multi-turn image editing */
    conversational?: boolean;
    /** Optimized for text rendering in images */
    textRendering?: boolean;
    /** Supports transparency */
    transparency?: boolean;
  };
}

/**
 * Specification for a speech generation model.
 */
export interface SpeechModelSpec {
  /** Provider identifier (e.g., "openai", "gemini") */
  provider: string;

  /** Model identifier */
  modelId: string;

  /** Human-readable display name */
  displayName: string;

  /** Pricing information */
  pricing: SpeechModelPricing;

  /** Available voice options */
  voices: string[];

  /** Supported audio formats */
  formats: AudioFormat[];

  /** Maximum input text length (characters) */
  maxInputLength: number;

  /** Default voice if not specified */
  defaultVoice?: string;

  /** Default format if not specified */
  defaultFormat?: AudioFormat;

  /** Additional feature flags */
  features?: {
    /** Supports multi-speaker output */
    multiSpeaker?: boolean;
    /** Number of supported languages */
    languages?: number;
    /** Supports voice instructions/steering */
    voiceInstructions?: boolean;
  };
}
