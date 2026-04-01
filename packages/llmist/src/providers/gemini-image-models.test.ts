import { describe, expect, it } from "vitest";
import {
  calculateGeminiImageCost,
  geminiImageModels,
  getGeminiImageModelSpec,
  IMAGEN4_ASPECT_RATIOS,
  isGeminiImageModel,
} from "./gemini-image-models.js";

describe("geminiImageModels", () => {
  it("exports an array of model specifications", () => {
    expect(Array.isArray(geminiImageModels)).toBe(true);
    expect(geminiImageModels.length).toBeGreaterThan(0);
  });

  describe("model specifications", () => {
    it.each(geminiImageModels)("$modelId has valid provider and modelId", (model) => {
      expect(model.provider).toBe("gemini");
      expect(typeof model.modelId).toBe("string");
      expect(model.modelId.length).toBeGreaterThan(0);
      expect(typeof model.displayName).toBe("string");
      expect(model.displayName.length).toBeGreaterThan(0);
    });

    it.each(geminiImageModels)("$modelId has valid pricing (non-negative)", (model) => {
      const { pricing } = model;

      if (pricing.perImage !== undefined) {
        expect(pricing.perImage).toBeGreaterThanOrEqual(0);
      }

      if (pricing.bySize !== undefined) {
        for (const [, price] of Object.entries(pricing.bySize)) {
          expect(typeof price).toBe("number");
          expect(price as number).toBeGreaterThanOrEqual(0);
        }
      }

      // At least one pricing field must be set
      const hasPricing = pricing.perImage !== undefined || pricing.bySize !== undefined;
      expect(hasPricing).toBe(true);
    });

    it.each(geminiImageModels)("$modelId has valid supported sizes and defaults", (model) => {
      expect(Array.isArray(model.supportedSizes)).toBe(true);
      expect(model.supportedSizes.length).toBeGreaterThan(0);
      expect(typeof model.defaultSize).toBe("string");
      expect(model.defaultSize.length).toBeGreaterThan(0);
    });

    it.each(geminiImageModels)("$modelId default size is in supported sizes", (model) => {
      expect(model.supportedSizes).toContain(model.defaultSize);
    });

    it.each(geminiImageModels)("$modelId has valid maxImages", (model) => {
      expect(model.maxImages).toBeGreaterThan(0);
    });
  });

  describe("aspect ratio constants", () => {
    it("IMAGEN4_ASPECT_RATIOS includes standard ratios", () => {
      expect(IMAGEN4_ASPECT_RATIOS).toContain("1:1");
      expect(IMAGEN4_ASPECT_RATIOS).toContain("16:9");
      expect(IMAGEN4_ASPECT_RATIOS).toContain("9:16");
      expect(IMAGEN4_ASPECT_RATIOS).toContain("3:4");
      expect(IMAGEN4_ASPECT_RATIOS).toContain("4:3");
    });
  });

  describe("model families", () => {
    it("includes Imagen 4 family models", () => {
      const imagen4 = geminiImageModels.filter((m) => m.modelId.startsWith("imagen-4.0"));
      expect(imagen4.length).toBeGreaterThan(0);
    });

    it("includes Gemini native image generation models", () => {
      const geminiNative = geminiImageModels.filter((m) => m.modelId.startsWith("gemini-"));
      expect(geminiNative.length).toBeGreaterThan(0);
    });

    it("Imagen 4 models support up to 4 images", () => {
      const imagen4 = geminiImageModels.filter((m) => m.modelId.startsWith("imagen-4.0"));
      for (const model of imagen4) {
        expect(model.maxImages).toBe(4);
      }
    });

    it("Imagen 4 models all have textRendering feature", () => {
      const imagen4 = geminiImageModels.filter((m) => m.modelId.startsWith("imagen-4.0"));
      for (const model of imagen4) {
        expect(model.features.textRendering).toBe(true);
      }
    });
  });

  describe("specific models", () => {
    it("includes imagen-4.0-fast-generate-001 as cheapest Imagen 4 option", () => {
      const fast = geminiImageModels.find((m) => m.modelId === "imagen-4.0-fast-generate-001");
      expect(fast).toBeDefined();
      expect(fast?.pricing.perImage).toBeDefined();
      // Fast should be cheaper than standard
      const standard = geminiImageModels.find((m) => m.modelId === "imagen-4.0-generate-001");
      expect(fast?.pricing.perImage ?? 0).toBeLessThan(standard?.pricing.perImage ?? 0);
    });

    it("includes imagen-4.0-ultra-generate-001 as most expensive Imagen 4 option", () => {
      const ultra = geminiImageModels.find((m) => m.modelId === "imagen-4.0-ultra-generate-001");
      const standard = geminiImageModels.find((m) => m.modelId === "imagen-4.0-generate-001");
      expect(ultra).toBeDefined();
      expect(ultra?.pricing.perImage ?? 0).toBeGreaterThan(standard?.pricing.perImage ?? 0);
    });

    it("includes gemini-2.5-flash-image with conversational feature", () => {
      const model = geminiImageModels.find((m) => m.modelId === "gemini-2.5-flash-image");
      expect(model).toBeDefined();
      expect(model?.features.conversational).toBe(true);
      expect(model?.maxImages).toBe(1);
    });

    it("includes gemini-3-pro-image-preview with size-based pricing", () => {
      const model = geminiImageModels.find((m) => m.modelId === "gemini-3-pro-image-preview");
      expect(model).toBeDefined();
      expect(model?.pricing.bySize).toBeDefined();
      expect(model?.pricing.bySize?.["4K"]).toBeGreaterThan(model?.pricing.bySize?.["1K"] ?? 0);
    });

    it("includes nano-banana-pro-preview alias with same pricing as gemini-3-pro-image-preview", () => {
      const alias = geminiImageModels.find((m) => m.modelId === "nano-banana-pro-preview");
      const original = geminiImageModels.find((m) => m.modelId === "gemini-3-pro-image-preview");
      expect(alias).toBeDefined();
      expect(original).toBeDefined();
      expect(alias?.pricing.bySize?.["2K"]).toBe(original?.pricing.bySize?.["2K"]);
    });
  });

  describe("helper functions", () => {
    describe("getGeminiImageModelSpec", () => {
      it("returns spec for a known model", () => {
        const spec = getGeminiImageModelSpec("imagen-4.0-generate-001");
        expect(spec).toBeDefined();
        expect(spec?.modelId).toBe("imagen-4.0-generate-001");
      });

      it("returns undefined for an unknown model", () => {
        const spec = getGeminiImageModelSpec("unknown-model");
        expect(spec).toBeUndefined();
      });
    });

    describe("isGeminiImageModel", () => {
      it("returns true for known image models", () => {
        expect(isGeminiImageModel("imagen-4.0-generate-001")).toBe(true);
        expect(isGeminiImageModel("imagen-4.0-fast-generate-001")).toBe(true);
        expect(isGeminiImageModel("gemini-2.5-flash-image")).toBe(true);
        expect(isGeminiImageModel("nano-banana-pro-preview")).toBe(true);
      });

      it("returns false for non-image models", () => {
        expect(isGeminiImageModel("gemini-2.0-flash")).toBe(false);
        expect(isGeminiImageModel("gemini-2.5-flash-preview-tts")).toBe(false);
        expect(isGeminiImageModel("")).toBe(false);
      });
    });

    describe("calculateGeminiImageCost", () => {
      it("calculates cost for per-image model (imagen-4.0-generate-001)", () => {
        const cost = calculateGeminiImageCost("imagen-4.0-generate-001", "1:1", 1);
        expect(cost).toBeDefined();
        expect(cost).toBeCloseTo(0.04);
      });

      it("calculates cost for multiple images", () => {
        const single = calculateGeminiImageCost("imagen-4.0-generate-001", "1:1", 1);
        const quad = calculateGeminiImageCost("imagen-4.0-generate-001", "1:1", 4);
        expect(single).toBeDefined();
        expect(quad).toBeDefined();
        expect(quad!).toBeCloseTo(single! * 4);
      });

      it("calculates size-based cost for gemini-3-pro-image-preview", () => {
        const cost1k = calculateGeminiImageCost("gemini-3-pro-image-preview", "1K", 1);
        const cost4k = calculateGeminiImageCost("gemini-3-pro-image-preview", "4K", 1);
        expect(cost1k).toBeDefined();
        expect(cost4k).toBeDefined();
        expect(cost4k!).toBeGreaterThan(cost1k!);
      });

      it("uses default size when not specified", () => {
        // Default size for imagen-4.0-generate-001 is "1:1"
        const costDefault = calculateGeminiImageCost("imagen-4.0-generate-001");
        const costExplicit = calculateGeminiImageCost("imagen-4.0-generate-001", "1:1", 1);
        expect(costDefault).toBeCloseTo(costExplicit!);
      });

      it("returns undefined for an unknown model", () => {
        const cost = calculateGeminiImageCost("unknown-model");
        expect(cost).toBeUndefined();
      });
    });
  });
});
