/**
 * OpenAI Image Generation Model Catalog
 *
 * Pricing as of December 2025:
 *
 * GPT Image 1.5 (flagship):
 * - Low quality: ~$0.008 per image
 * - Medium quality: ~$0.03 per image
 * - High quality: ~$0.13 per image
 *
 * GPT Image 1 (previous gen):
 * - Low quality: ~$0.011 per image
 * - Medium quality: ~$0.04 per image
 * - High quality: ~$0.17 per image
 *
 * GPT Image 1 Mini (cost-effective):
 * - Low quality: ~$0.005 per image
 * - Medium quality: ~$0.02 per image
 * - High quality: ~$0.052 per image
 *
 * Sora 2 (video generation):
 * - Standard quality: ~$0.50 per 5-second clip
 * - High quality: ~$1.00 per 5-second clip
 *
 * DALL-E 3 (deprecated):
 * - 1024x1024: $0.040 (standard), $0.080 (hd)
 * - 1024x1792: $0.080 (standard), $0.120 (hd)
 * - 1792x1024: $0.080 (standard), $0.120 (hd)
 *
 * DALL-E 2 (deprecated):
 * - 256x256: $0.016
 * - 512x512: $0.018
 * - 1024x1024: $0.020
 *
 * @see https://platform.openai.com/docs/guides/images
 */

import type { ImageModelSpec } from "../core/media-types.js";

/** GPT Image supported sizes */
export const GPT_IMAGE_SIZES = [
  "1024x1024",
  "1024x1536",
  "1536x1024",
  "1920x1080",
  "auto",
] as const;
export type GptImageSize = (typeof GPT_IMAGE_SIZES)[number];

/** GPT Image quality levels */
export const GPT_IMAGE_QUALITIES = ["low", "medium", "high"] as const;
export type GptImageQuality = (typeof GPT_IMAGE_QUALITIES)[number];

/** Sora video durations */
export const SORA_DURATIONS = ["5s", "10s", "15s", "20s"] as const;
export type SoraDuration = (typeof SORA_DURATIONS)[number];

/** DALL-E 3 supported sizes (deprecated) */
export const DALLE3_SIZES = ["1024x1024", "1024x1792", "1792x1024"] as const;
export type DallE3Size = (typeof DALLE3_SIZES)[number];

/** DALL-E 3 quality levels (deprecated) */
export const DALLE3_QUALITIES = ["standard", "hd"] as const;
export type DallE3Quality = (typeof DALLE3_QUALITIES)[number];

/** DALL-E 2 supported sizes (deprecated) */
export const DALLE2_SIZES = ["256x256", "512x512", "1024x1024"] as const;
export type DallE2Size = (typeof DALLE2_SIZES)[number];

/**
 * OpenAI Image Model Specifications
 */
export const openaiImageModels: ImageModelSpec[] = [
  // GPT Image 1.5 Family (flagship)
  {
    provider: "openai",
    modelId: "gpt-image-1.5",
    displayName: "GPT Image 1.5",
    pricing: {
      bySize: {
        "1024x1024": { low: 0.008, medium: 0.03, high: 0.13 },
        "1024x1536": { low: 0.012, medium: 0.045, high: 0.195 },
        "1536x1024": { low: 0.012, medium: 0.045, high: 0.195 },
        "1920x1080": { low: 0.016, medium: 0.06, high: 0.26 },
      },
    },
    supportedSizes: [...GPT_IMAGE_SIZES],
    supportedQualities: [...GPT_IMAGE_QUALITIES],
    maxImages: 1,
    defaultSize: "1024x1024",
    defaultQuality: "medium",
    features: {
      textRendering: true,
      transparency: true,
      editing: true,
    },
  },
  // GPT Image 1 Family (previous gen)
  {
    provider: "openai",
    modelId: "gpt-image-1",
    displayName: "GPT Image 1",
    pricing: {
      bySize: {
        "1024x1024": { low: 0.011, medium: 0.04, high: 0.17 },
        "1024x1536": { low: 0.016, medium: 0.06, high: 0.25 },
        "1536x1024": { low: 0.016, medium: 0.06, high: 0.25 },
      },
    },
    supportedSizes: ["1024x1024", "1024x1536", "1536x1024"],
    supportedQualities: [...GPT_IMAGE_QUALITIES],
    maxImages: 1,
    defaultSize: "1024x1024",
    defaultQuality: "medium",
    features: {
      textRendering: true,
      transparency: true,
    },
  },
  {
    provider: "openai",
    modelId: "gpt-image-1-mini",
    displayName: "GPT Image 1 Mini",
    pricing: {
      bySize: {
        "1024x1024": { low: 0.005, medium: 0.02, high: 0.052 },
        "1024x1536": { low: 0.0075, medium: 0.03, high: 0.078 },
        "1536x1024": { low: 0.0075, medium: 0.03, high: 0.078 },
      },
    },
    supportedSizes: ["1024x1024", "1024x1536", "1536x1024"],
    supportedQualities: [...GPT_IMAGE_QUALITIES],
    maxImages: 1,
    defaultSize: "1024x1024",
    defaultQuality: "medium",
    features: {
      textRendering: true,
      transparency: true,
    },
  },
  // Sora Video Generation Models
  {
    provider: "openai",
    modelId: "sora-2",
    displayName: "Sora 2",
    pricing: {
      bySize: {
        "1920x1080": { standard: 0.5, high: 1.0 },
        "1080x1920": { standard: 0.5, high: 1.0 },
        "1024x1024": { standard: 0.4, high: 0.8 },
      },
    },
    supportedSizes: ["1920x1080", "1080x1920", "1024x1024"],
    supportedQualities: ["standard", "high"],
    maxImages: 1,
    defaultSize: "1920x1080",
    defaultQuality: "standard",
    features: {
      videoGeneration: true,
    },
  },
  {
    provider: "openai",
    modelId: "sora-2-pro",
    displayName: "Sora 2 Pro",
    pricing: {
      bySize: {
        "1920x1080": { standard: 1.0, high: 2.0 },
        "1080x1920": { standard: 1.0, high: 2.0 },
        "1024x1024": { standard: 0.8, high: 1.6 },
      },
    },
    supportedSizes: ["1920x1080", "1080x1920", "1024x1024"],
    supportedQualities: ["standard", "high"],
    maxImages: 1,
    defaultSize: "1920x1080",
    defaultQuality: "standard",
    features: {
      videoGeneration: true,
      extendedDuration: true,
    },
  },
  // DALL-E Family (deprecated - use GPT Image models instead)
  {
    provider: "openai",
    modelId: "dall-e-3",
    displayName: "DALL-E 3 (Deprecated)",
    pricing: {
      bySize: {
        "1024x1024": { standard: 0.04, hd: 0.08 },
        "1024x1792": { standard: 0.08, hd: 0.12 },
        "1792x1024": { standard: 0.08, hd: 0.12 },
      },
    },
    supportedSizes: [...DALLE3_SIZES],
    supportedQualities: [...DALLE3_QUALITIES],
    maxImages: 1, // DALL-E 3 only supports n=1
    defaultSize: "1024x1024",
    defaultQuality: "standard",
    features: {
      textRendering: true,
    },
  },
  {
    provider: "openai",
    modelId: "dall-e-2",
    displayName: "DALL-E 2 (Deprecated)",
    pricing: {
      bySize: {
        "256x256": 0.016,
        "512x512": 0.018,
        "1024x1024": 0.02,
      },
    },
    supportedSizes: [...DALLE2_SIZES],
    maxImages: 10,
    defaultSize: "1024x1024",
  },
];

/**
 * Get image model spec by model ID.
 */
export function getOpenAIImageModelSpec(modelId: string): ImageModelSpec | undefined {
  return openaiImageModels.find((m) => m.modelId === modelId);
}

/**
 * Check if a model ID is an OpenAI image model.
 */
export function isOpenAIImageModel(modelId: string): boolean {
  return openaiImageModels.some((m) => m.modelId === modelId);
}

/**
 * Calculate cost for image generation.
 *
 * @param modelId - The model ID (dall-e-3 or dall-e-2)
 * @param size - Image size
 * @param quality - Quality level (for DALL-E 3)
 * @param n - Number of images
 * @returns Cost in USD, or undefined if model not found
 */
export function calculateOpenAIImageCost(
  modelId: string,
  size: string,
  quality = "standard",
  n = 1,
): number | undefined {
  const spec = getOpenAIImageModelSpec(modelId);
  if (!spec) return undefined;

  // Get price for this size
  const sizePrice = spec.pricing.bySize?.[size];
  if (sizePrice === undefined) return undefined;

  let pricePerImage: number;

  if (typeof sizePrice === "number") {
    // Flat pricing (DALL-E 2)
    pricePerImage = sizePrice;
  } else {
    // Quality-based pricing (DALL-E 3)
    pricePerImage = sizePrice[quality];
    if (pricePerImage === undefined) return undefined;
  }

  return pricePerImage * n;
}
