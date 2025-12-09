/**
 * Image Generation Namespace
 *
 * Provides image generation methods.
 *
 * @example
 * ```typescript
 * const llmist = new LLMist();
 *
 * const result = await llmist.image.generate({
 *   model: "dall-e-3",
 *   prompt: "A cat in space",
 *   size: "1024x1024",
 *   quality: "hd",
 * });
 *
 * console.log(result.images[0].url);
 * console.log("Cost:", result.cost);
 * ```
 */

import type {
  ImageGenerationOptions,
  ImageGenerationResult,
  ImageModelSpec,
} from "../media-types.js";
import type { ProviderAdapter } from "../../providers/provider.js";

export class ImageNamespace {
  constructor(
    private readonly adapters: ProviderAdapter[],
    private readonly defaultProvider: string,
  ) {}

  /**
   * Generate images from a text prompt.
   *
   * @param options - Image generation options
   * @returns Promise resolving to the generation result with images and cost
   * @throws Error if the provider doesn't support image generation
   */
  async generate(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
    const modelId = options.model;

    // Find an adapter that supports this image model
    const adapter = this.findImageAdapter(modelId);
    if (!adapter || !adapter.generateImage) {
      throw new Error(
        `No provider supports image generation for model "${modelId}". ` +
          `Available image models: ${this.listModels().map((m) => m.modelId).join(", ")}`,
      );
    }

    return adapter.generateImage(options);
  }

  /**
   * List all available image generation models.
   */
  listModels(): ImageModelSpec[] {
    const models: ImageModelSpec[] = [];
    for (const adapter of this.adapters) {
      if (adapter.getImageModelSpecs) {
        models.push(...adapter.getImageModelSpecs());
      }
    }
    return models;
  }

  /**
   * Check if a model is supported for image generation.
   */
  supportsModel(modelId: string): boolean {
    return this.findImageAdapter(modelId) !== undefined;
  }

  private findImageAdapter(modelId: string): ProviderAdapter | undefined {
    return this.adapters.find(
      (adapter) => adapter.supportsImageGeneration?.(modelId) ?? false,
    );
  }
}
