/**
 * Tests for ImageNamespace
 *
 * Verifies image generation routing to providers and model listing.
 */

import { describe, expect, it, vi } from "vitest";
import type { ProviderAdapter } from "../../providers/provider.js";
import type {
  ImageGenerationOptions,
  ImageGenerationResult,
  ImageModelSpec,
} from "../media-types.js";
import { ImageNamespace } from "./image.js";

/**
 * Creates a mock provider adapter for testing.
 */
function createMockAdapter(opts: {
  providerId: string;
  supportsImage?: boolean;
  imageModels?: ImageModelSpec[];
  generateImageResult?: ImageGenerationResult;
}): ProviderAdapter {
  const { providerId, supportsImage = false, imageModels = [], generateImageResult } = opts;

  return {
    providerId,
    supports: () => false,
    stream: () => (async function* () {})(),
    supportsImageGeneration: supportsImage
      ? (modelId: string) => imageModels.some((m) => m.modelId === modelId)
      : undefined,
    getImageModelSpecs: imageModels.length > 0 ? () => imageModels : undefined,
    generateImage: supportsImage
      ? vi.fn(async (_options: ImageGenerationOptions): Promise<ImageGenerationResult> => {
          return (
            generateImageResult ?? {
              images: [{ url: "https://example.com/image.png" }],
              model: _options.model,
              usage: { imagesGenerated: 1, size: "1024x1024", quality: "standard" },
              cost: 0.04,
            }
          );
        })
      : undefined,
  };
}

const mockImageSpec: ImageModelSpec = {
  provider: "test",
  modelId: "test-image-model",
  displayName: "Test Image Model",
  pricing: {
    "1024x1024": { standard: 0.04, hd: 0.08 },
  },
  supportedSizes: ["1024x1024"],
  supportedQualities: ["standard", "hd"],
  maxImages: 1,
};

describe("ImageNamespace", () => {
  describe("generate()", () => {
    it("routes generation to the correct provider", async () => {
      const adapter = createMockAdapter({
        providerId: "test",
        supportsImage: true,
        imageModels: [mockImageSpec],
      });
      const namespace = new ImageNamespace([adapter], "test");

      const result = await namespace.generate({
        model: "test-image-model",
        prompt: "A cat in space",
      });

      expect(result.images).toHaveLength(1);
      expect(result.images[0].url).toBe("https://example.com/image.png");
      expect(result.cost).toBe(0.04);
      expect(adapter.generateImage).toHaveBeenCalledTimes(1);
    });

    it("passes all options to the provider", async () => {
      const adapter = createMockAdapter({
        providerId: "test",
        supportsImage: true,
        imageModels: [mockImageSpec],
      });
      const namespace = new ImageNamespace([adapter], "test");

      await namespace.generate({
        model: "test-image-model",
        prompt: "A dog on mars",
        size: "1024x1024",
        quality: "hd",
        n: 2,
        responseFormat: "b64_json",
      });

      expect(adapter.generateImage).toHaveBeenCalledWith({
        model: "test-image-model",
        prompt: "A dog on mars",
        size: "1024x1024",
        quality: "hd",
        n: 2,
        responseFormat: "b64_json",
      });
    });

    it("throws error when no provider supports the model", async () => {
      const adapter = createMockAdapter({
        providerId: "test",
        supportsImage: false,
      });
      const namespace = new ImageNamespace([adapter], "test");

      await expect(
        namespace.generate({
          model: "unknown-model",
          prompt: "Test",
        }),
      ).rejects.toThrow(/No provider supports image generation for model "unknown-model"/);
    });

    it("selects correct provider when multiple are available", async () => {
      const adapter1 = createMockAdapter({
        providerId: "provider1",
        supportsImage: true,
        imageModels: [{ ...mockImageSpec, modelId: "model-a" }],
      });
      const adapter2 = createMockAdapter({
        providerId: "provider2",
        supportsImage: true,
        imageModels: [{ ...mockImageSpec, modelId: "model-b" }],
      });
      const namespace = new ImageNamespace([adapter1, adapter2], "provider1");

      await namespace.generate({ model: "model-b", prompt: "Test" });

      expect(adapter1.generateImage).not.toHaveBeenCalled();
      expect(adapter2.generateImage).toHaveBeenCalledTimes(1);
    });

    it("returns result with revised prompt when available", async () => {
      const adapter = createMockAdapter({
        providerId: "test",
        supportsImage: true,
        imageModels: [mockImageSpec],
        generateImageResult: {
          images: [
            {
              url: "https://example.com/image.png",
              revisedPrompt: "An adorable orange cat floating in outer space",
            },
          ],
          model: "test-image-model",
          usage: { imagesGenerated: 1, size: "1024x1024", quality: "standard" },
          cost: 0.04,
        },
      });
      const namespace = new ImageNamespace([adapter], "test");

      const result = await namespace.generate({
        model: "test-image-model",
        prompt: "A cat in space",
      });

      expect(result.images[0].revisedPrompt).toBe("An adorable orange cat floating in outer space");
    });

    it("returns base64 data when requested", async () => {
      const adapter = createMockAdapter({
        providerId: "test",
        supportsImage: true,
        imageModels: [mockImageSpec],
        generateImageResult: {
          images: [{ b64Json: "iVBORw0KGgoAAAANSUhEUgAAAAUA..." }],
          model: "test-image-model",
          usage: { imagesGenerated: 1, size: "1024x1024", quality: "standard" },
          cost: 0.04,
        },
      });
      const namespace = new ImageNamespace([adapter], "test");

      const result = await namespace.generate({
        model: "test-image-model",
        prompt: "Test",
        responseFormat: "b64_json",
      });

      expect(result.images[0].b64Json).toBeDefined();
      expect(result.images[0].url).toBeUndefined();
    });
  });

  describe("listModels()", () => {
    it("returns empty array when no adapters have image models", () => {
      const adapter = createMockAdapter({ providerId: "test" });
      const namespace = new ImageNamespace([adapter], "test");

      expect(namespace.listModels()).toEqual([]);
    });

    it("returns all image models from all providers", () => {
      const spec1: ImageModelSpec = { ...mockImageSpec, modelId: "model-1" };
      const spec2: ImageModelSpec = { ...mockImageSpec, modelId: "model-2" };
      const spec3: ImageModelSpec = { ...mockImageSpec, modelId: "model-3" };

      const adapter1 = createMockAdapter({
        providerId: "p1",
        supportsImage: true,
        imageModels: [spec1],
      });
      const adapter2 = createMockAdapter({
        providerId: "p2",
        supportsImage: true,
        imageModels: [spec2, spec3],
      });
      const namespace = new ImageNamespace([adapter1, adapter2], "p1");

      const models = namespace.listModels();

      expect(models).toHaveLength(3);
      expect(models.map((m) => m.modelId)).toEqual(["model-1", "model-2", "model-3"]);
    });
  });

  describe("supportsModel()", () => {
    it("returns true when a provider supports the model", () => {
      const adapter = createMockAdapter({
        providerId: "test",
        supportsImage: true,
        imageModels: [mockImageSpec],
      });
      const namespace = new ImageNamespace([adapter], "test");

      expect(namespace.supportsModel("test-image-model")).toBe(true);
    });

    it("returns false when no provider supports the model", () => {
      const adapter = createMockAdapter({
        providerId: "test",
        supportsImage: true,
        imageModels: [mockImageSpec],
      });
      const namespace = new ImageNamespace([adapter], "test");

      expect(namespace.supportsModel("unknown-model")).toBe(false);
    });

    it("returns false when no adapters support image generation", () => {
      const adapter = createMockAdapter({ providerId: "test" });
      const namespace = new ImageNamespace([adapter], "test");

      expect(namespace.supportsModel("any-model")).toBe(false);
    });
  });
});
