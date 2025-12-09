/**
 * Google Gemini Image Generation Model Catalog
 *
 * Pricing as of December 2025:
 *
 * Imagen 4 Family (standalone image generation):
 * - imagen-4.0-fast-generate-001: $0.02 per image
 * - imagen-4.0-generate-001: $0.04 per image
 * - imagen-4.0-ultra-generate-001: $0.06 per image
 *
 * Gemini Native Image Generation (multimodal):
 * - gemini-2.5-flash-image: $0.039 per output image
 * - gemini-3-pro-image-preview: ~$0.134 per 1K/2K image, $0.24 per 4K
 *
 * @see https://ai.google.dev/gemini-api/docs/pricing
 * @see https://ai.google.dev/gemini-api/docs/imagen
 */

import type { ImageModelSpec } from "../core/media-types.js";

/** Imagen 4 supported aspect ratios */
export const IMAGEN4_ASPECT_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;
export type Imagen4AspectRatio = (typeof IMAGEN4_ASPECT_RATIOS)[number];

/** Gemini native image supported aspect ratios */
export const GEMINI_IMAGE_ASPECT_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;

/**
 * Google Image Model Specifications
 */
export const geminiImageModels: ImageModelSpec[] = [
  // Imagen 4 Family (standalone image generation)
  {
    provider: "gemini",
    modelId: "imagen-4.0-fast-generate-001",
    displayName: "Imagen 4 Fast",
    pricing: {
      perImage: 0.02,
    },
    supportedSizes: [...IMAGEN4_ASPECT_RATIOS],
    maxImages: 4,
    defaultSize: "1:1",
    features: {
      textRendering: true,
    },
  },
  {
    provider: "gemini",
    modelId: "imagen-4.0-generate-001",
    displayName: "Imagen 4",
    pricing: {
      perImage: 0.04,
    },
    supportedSizes: [...IMAGEN4_ASPECT_RATIOS],
    maxImages: 4,
    defaultSize: "1:1",
    features: {
      textRendering: true,
    },
  },
  {
    provider: "gemini",
    modelId: "imagen-4.0-ultra-generate-001",
    displayName: "Imagen 4 Ultra",
    pricing: {
      perImage: 0.06,
    },
    supportedSizes: [...IMAGEN4_ASPECT_RATIOS],
    maxImages: 4,
    defaultSize: "1:1",
    features: {
      textRendering: true,
    },
  },
  // Preview versions
  {
    provider: "gemini",
    modelId: "imagen-4.0-generate-preview-06-06",
    displayName: "Imagen 4 (Preview)",
    pricing: {
      perImage: 0.04,
    },
    supportedSizes: [...IMAGEN4_ASPECT_RATIOS],
    maxImages: 4,
    defaultSize: "1:1",
    features: {
      textRendering: true,
    },
  },
  {
    provider: "gemini",
    modelId: "imagen-4.0-ultra-generate-preview-06-06",
    displayName: "Imagen 4 Ultra (Preview)",
    pricing: {
      perImage: 0.06,
    },
    supportedSizes: [...IMAGEN4_ASPECT_RATIOS],
    maxImages: 4,
    defaultSize: "1:1",
    features: {
      textRendering: true,
    },
  },
  // Gemini Native Image Generation (multimodal models)
  {
    provider: "gemini",
    modelId: "gemini-2.5-flash-image",
    displayName: "Gemini 2.5 Flash Image",
    pricing: {
      perImage: 0.039,
    },
    supportedSizes: [...GEMINI_IMAGE_ASPECT_RATIOS],
    maxImages: 1,
    defaultSize: "1:1",
    features: {
      conversational: true,
      textRendering: true,
    },
  },
  {
    provider: "gemini",
    modelId: "gemini-2.5-flash-image-preview",
    displayName: "Gemini 2.5 Flash Image (Preview)",
    pricing: {
      perImage: 0.039,
    },
    supportedSizes: [...GEMINI_IMAGE_ASPECT_RATIOS],
    maxImages: 1,
    defaultSize: "1:1",
    features: {
      conversational: true,
      textRendering: true,
    },
  },
  {
    provider: "gemini",
    modelId: "gemini-3-pro-image-preview",
    displayName: "Gemini 3 Pro Image (Preview)",
    pricing: {
      // Token-based: ~$0.134 per 1K/2K image, $0.24 per 4K
      // Using 2K as default
      bySize: {
        "1K": 0.134,
        "2K": 0.134,
        "4K": 0.24,
      },
    },
    supportedSizes: ["1K", "2K", "4K"],
    maxImages: 1,
    defaultSize: "2K",
    features: {
      conversational: true,
      textRendering: true,
    },
  },
  // Alias: nano-banana-pro-preview is gemini-3-pro-image-preview
  {
    provider: "gemini",
    modelId: "nano-banana-pro-preview",
    displayName: "Nano Banana Pro (Gemini 3 Pro Image)",
    pricing: {
      bySize: {
        "1K": 0.134,
        "2K": 0.134,
        "4K": 0.24,
      },
    },
    supportedSizes: ["1K", "2K", "4K"],
    maxImages: 1,
    defaultSize: "2K",
    features: {
      conversational: true,
      textRendering: true,
    },
  },
];

/**
 * Get image model spec by model ID.
 */
export function getGeminiImageModelSpec(modelId: string): ImageModelSpec | undefined {
  return geminiImageModels.find((m) => m.modelId === modelId);
}

/**
 * Check if a model ID is a Gemini image model.
 */
export function isGeminiImageModel(modelId: string): boolean {
  return geminiImageModels.some((m) => m.modelId === modelId);
}

/**
 * Calculate cost for image generation.
 *
 * @param modelId - The model ID
 * @param size - Image size (for models with size-based pricing)
 * @param n - Number of images
 * @returns Cost in USD, or undefined if model not found
 */
export function calculateGeminiImageCost(
  modelId: string,
  size = "1:1",
  n = 1,
): number | undefined {
  const spec = getGeminiImageModelSpec(modelId);
  if (!spec) return undefined;

  // Simple per-image pricing (Imagen 4, Gemini Flash Image)
  if (spec.pricing.perImage !== undefined) {
    return spec.pricing.perImage * n;
  }

  // Size-based pricing (Gemini 3 Pro Image)
  if (spec.pricing.bySize) {
    const sizePrice = spec.pricing.bySize[size];
    if (typeof sizePrice === "number") {
      return sizePrice * n;
    }
  }

  return undefined;
}
