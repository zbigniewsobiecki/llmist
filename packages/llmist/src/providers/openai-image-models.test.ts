import { describe, expect, it } from "vitest";
import {
  calculateOpenAIImageCost,
  DALLE2_SIZES,
  DALLE3_QUALITIES,
  DALLE3_SIZES,
  GPT_IMAGE_QUALITIES,
  GPT_IMAGE_SIZES,
  getOpenAIImageModelSpec,
  isOpenAIImageModel,
  openaiImageModels,
  SORA_DURATIONS,
} from "./openai-image-models.js";

describe("openaiImageModels", () => {
  it("exports a non-empty array of model specifications", () => {
    expect(Array.isArray(openaiImageModels)).toBe(true);
    expect(openaiImageModels.length).toBeGreaterThan(0);
  });

  describe("catalog integrity", () => {
    it.each(openaiImageModels)("$modelId has valid provider and modelId", (model) => {
      expect(model.provider).toBe("openai");
      expect(typeof model.modelId).toBe("string");
      expect(model.modelId.length).toBeGreaterThan(0);
      expect(typeof model.displayName).toBe("string");
      expect(model.displayName.length).toBeGreaterThan(0);
    });
  });

  describe("pricing shape validity", () => {
    it.each(openaiImageModels)("$modelId has valid pricing (non-negative)", (model) => {
      const { bySize } = model.pricing;
      expect(bySize).toBeDefined();

      for (const [, price] of Object.entries(bySize ?? {})) {
        if (typeof price === "number") {
          expect(price).toBeGreaterThanOrEqual(0);
        } else if (typeof price === "object" && price !== null) {
          for (const [, qualityPrice] of Object.entries(price)) {
            expect(typeof qualityPrice).toBe("number");
            expect(qualityPrice as number).toBeGreaterThanOrEqual(0);
          }
        } else {
          // Each entry should be either a number or a quality-keyed object
          expect(false).toBe(true);
        }
      }
    });
  });

  describe("supported constraints", () => {
    it.each(openaiImageModels)("$modelId defaultSize is in supportedSizes", (model) => {
      expect(model.supportedSizes).toContain(model.defaultSize);
    });

    it.each(
      openaiImageModels,
    )("$modelId defaultQuality is in supportedQualities (if present)", (model) => {
      if (model.defaultQuality !== undefined && model.supportedQualities !== undefined) {
        expect(model.supportedQualities).toContain(model.defaultQuality);
      }
    });
  });

  describe("exported tuple constants", () => {
    it("GPT_IMAGE_SIZES contains expected values", () => {
      expect(GPT_IMAGE_SIZES).toContain("1024x1024");
      expect(GPT_IMAGE_SIZES).toContain("1024x1536");
      expect(GPT_IMAGE_SIZES).toContain("1536x1024");
      expect(GPT_IMAGE_SIZES).toContain("1920x1080");
      expect(GPT_IMAGE_SIZES).toContain("auto");
    });

    it("GPT_IMAGE_QUALITIES contains low, medium, high", () => {
      expect(GPT_IMAGE_QUALITIES).toContain("low");
      expect(GPT_IMAGE_QUALITIES).toContain("medium");
      expect(GPT_IMAGE_QUALITIES).toContain("high");
    });

    it("SORA_DURATIONS contains expected durations", () => {
      expect(SORA_DURATIONS).toContain("5s");
      expect(SORA_DURATIONS).toContain("10s");
      expect(SORA_DURATIONS).toContain("15s");
      expect(SORA_DURATIONS).toContain("20s");
    });

    it("DALLE3_SIZES contains expected sizes", () => {
      expect(DALLE3_SIZES).toContain("1024x1024");
      expect(DALLE3_SIZES).toContain("1024x1792");
      expect(DALLE3_SIZES).toContain("1792x1024");
    });

    it("DALLE3_QUALITIES contains standard and hd", () => {
      expect(DALLE3_QUALITIES).toContain("standard");
      expect(DALLE3_QUALITIES).toContain("hd");
    });

    it("DALLE2_SIZES contains expected sizes", () => {
      expect(DALLE2_SIZES).toContain("256x256");
      expect(DALLE2_SIZES).toContain("512x512");
      expect(DALLE2_SIZES).toContain("1024x1024");
    });
  });

  describe("helper functions", () => {
    describe("getOpenAIImageModelSpec", () => {
      it("returns spec for gpt-image-1.5", () => {
        const spec = getOpenAIImageModelSpec("gpt-image-1.5");
        expect(spec).toBeDefined();
        expect(spec?.modelId).toBe("gpt-image-1.5");
      });

      it("returns spec for dall-e-3", () => {
        const spec = getOpenAIImageModelSpec("dall-e-3");
        expect(spec).toBeDefined();
        expect(spec?.modelId).toBe("dall-e-3");
      });

      it("returns spec for dall-e-2", () => {
        const spec = getOpenAIImageModelSpec("dall-e-2");
        expect(spec).toBeDefined();
        expect(spec?.modelId).toBe("dall-e-2");
      });

      it("returns undefined for an unknown model ID", () => {
        const spec = getOpenAIImageModelSpec("unknown-model");
        expect(spec).toBeUndefined();
      });
    });

    describe("isOpenAIImageModel", () => {
      it("returns true for known catalog members", () => {
        for (const model of openaiImageModels) {
          expect(isOpenAIImageModel(model.modelId)).toBe(true);
        }
      });

      it("returns false for a non-OpenAI image model", () => {
        expect(isOpenAIImageModel("gemini-image")).toBe(false);
      });

      it("returns false for an empty string", () => {
        expect(isOpenAIImageModel("")).toBe(false);
      });
    });

    describe("calculateOpenAIImageCost", () => {
      describe("flat pricing (DALL-E 2)", () => {
        it("dall-e-2 512x512 → $0.018", () => {
          const cost = calculateOpenAIImageCost("dall-e-2", "512x512");
          expect(cost).toBeCloseTo(0.018);
        });

        it("dall-e-2 256x256 → $0.016", () => {
          const cost = calculateOpenAIImageCost("dall-e-2", "256x256");
          expect(cost).toBeCloseTo(0.016);
        });

        it("dall-e-2 1024x1024 → $0.020", () => {
          const cost = calculateOpenAIImageCost("dall-e-2", "1024x1024");
          expect(cost).toBeCloseTo(0.02);
        });
      });

      describe("quality pricing (DALL-E 3)", () => {
        it("dall-e-3 1024x1024 hd → $0.08", () => {
          const cost = calculateOpenAIImageCost("dall-e-3", "1024x1024", "hd");
          expect(cost).toBeCloseTo(0.08);
        });

        it("dall-e-3 1024x1024 standard → $0.04", () => {
          const cost = calculateOpenAIImageCost("dall-e-3", "1024x1024", "standard");
          expect(cost).toBeCloseTo(0.04);
        });
      });

      describe("quality pricing (GPT Image 1.5)", () => {
        it("gpt-image-1.5 1024x1024 low → matches catalog ($0.008)", () => {
          const spec = getOpenAIImageModelSpec("gpt-image-1.5");
          const catalogPrice = (spec?.pricing.bySize?.["1024x1024"] as Record<string, number>)?.low;
          const cost = calculateOpenAIImageCost("gpt-image-1.5", "1024x1024", "low");
          expect(cost).toBeCloseTo(catalogPrice);
          expect(cost).toBeCloseTo(0.008);
        });

        it("gpt-image-1.5 1024x1024 medium → matches catalog ($0.03)", () => {
          const spec = getOpenAIImageModelSpec("gpt-image-1.5");
          const catalogPrice = (spec?.pricing.bySize?.["1024x1024"] as Record<string, number>)
            ?.medium;
          const cost = calculateOpenAIImageCost("gpt-image-1.5", "1024x1024", "medium");
          expect(cost).toBeCloseTo(catalogPrice);
          expect(cost).toBeCloseTo(0.03);
        });

        it("gpt-image-1.5 1024x1024 high → matches catalog ($0.13)", () => {
          const spec = getOpenAIImageModelSpec("gpt-image-1.5");
          const catalogPrice = (spec?.pricing.bySize?.["1024x1024"] as Record<string, number>)
            ?.high;
          const cost = calculateOpenAIImageCost("gpt-image-1.5", "1024x1024", "high");
          expect(cost).toBeCloseTo(catalogPrice);
          expect(cost).toBeCloseTo(0.13);
        });
      });

      describe("n multiplier", () => {
        it("3 images × $0.04 (dall-e-3 1024x1024 standard) → $0.12", () => {
          const cost = calculateOpenAIImageCost("dall-e-3", "1024x1024", "standard", 3);
          expect(cost).toBeCloseTo(0.12);
        });

        it("multiplier scales linearly with n", () => {
          const single = calculateOpenAIImageCost("dall-e-2", "256x256", "standard", 1);
          const triple = calculateOpenAIImageCost("dall-e-2", "256x256", "standard", 3);
          expect(single).toBeDefined();
          expect(triple).toBeDefined();
          expect(triple!).toBeCloseTo(single! * 3);
        });
      });

      describe("unknown inputs", () => {
        it("returns undefined for an unknown model", () => {
          const cost = calculateOpenAIImageCost("unknown-model", "1024x1024");
          expect(cost).toBeUndefined();
        });

        it("returns undefined for an unknown size", () => {
          const cost = calculateOpenAIImageCost("dall-e-2", "9999x9999");
          expect(cost).toBeUndefined();
        });

        it("returns undefined for an unknown quality on quality-priced models", () => {
          const cost = calculateOpenAIImageCost("dall-e-3", "1024x1024", "unknown-quality");
          expect(cost).toBeUndefined();
        });
      });
    });
  });
});
