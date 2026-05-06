import { describe, expect, it } from "vitest";
import { OPENROUTER_MODELS } from "./openrouter-models.js";

describe("OPENROUTER_MODELS", () => {
  it("exports an array of model specifications", () => {
    expect(Array.isArray(OPENROUTER_MODELS)).toBe(true);
    expect(OPENROUTER_MODELS.length).toBeGreaterThan(0);
  });

  describe("model specifications", () => {
    it.each(OPENROUTER_MODELS)("$modelId has valid structure", (model) => {
      expect(model.provider).toBe("openrouter");
      expect(typeof model.modelId).toBe("string");
      expect(model.modelId.length).toBeGreaterThan(0);
      expect(typeof model.displayName).toBe("string");
      expect(model.displayName.length).toBeGreaterThan(0);

      expect(model.contextWindow).toBeGreaterThan(0);
      expect(model.maxOutputTokens).toBeGreaterThan(0);
      expect(model.maxOutputTokens).toBeLessThanOrEqual(model.contextWindow);
    });

    it.each(OPENROUTER_MODELS)("$modelId has valid pricing", (model) => {
      expect(model.pricing.input).toBeGreaterThanOrEqual(0);
      expect(model.pricing.output).toBeGreaterThanOrEqual(0);
      expect(model.pricing.output).toBeGreaterThanOrEqual(model.pricing.input);
    });

    it.each(OPENROUTER_MODELS)("$modelId has valid features", (model) => {
      expect(typeof model.features.streaming).toBe("boolean");
      expect(model.features.streaming).toBe(true);
    });
  });

  describe("Gemini 3.1 family", () => {
    it("includes 4 Gemini 3.1 models", () => {
      const gemini31 = OPENROUTER_MODELS.filter((m) => m.metadata?.family === "Gemini 3.1");
      expect(gemini31).toHaveLength(4);
    });

    it("has gemini-3.1-pro-preview", () => {
      const model = OPENROUTER_MODELS.find((m) => m.modelId === "google/gemini-3.1-pro-preview");
      expect(model).toBeDefined();
      expect(model?.contextWindow).toBe(1_048_576);
      expect(model?.maxOutputTokens).toBe(65_536);
      expect(model?.pricing.input).toBe(2.0);
      expect(model?.pricing.output).toBe(12.0);
      expect(model?.features.functionCalling).toBe(true);
      expect(model?.features.vision).toBe(true);
      expect(model?.features.reasoning).toBe(true);
    });

    it("has gemini-3.1-pro-preview-customtools", () => {
      const model = OPENROUTER_MODELS.find(
        (m) => m.modelId === "google/gemini-3.1-pro-preview-customtools",
      );
      expect(model).toBeDefined();
      expect(model?.pricing.input).toBe(2.0);
      expect(model?.pricing.output).toBe(12.0);
      expect(model?.features.functionCalling).toBe(true);
      expect(model?.features.reasoning).toBe(true);
    });

    it("has gemini-3.1-flash-lite-preview", () => {
      const model = OPENROUTER_MODELS.find(
        (m) => m.modelId === "google/gemini-3.1-flash-lite-preview",
      );
      expect(model).toBeDefined();
      expect(model?.contextWindow).toBe(1_048_576);
      expect(model?.maxOutputTokens).toBe(65_536);
      expect(model?.pricing.input).toBe(0.25);
      expect(model?.pricing.output).toBe(1.5);
      expect(model?.features.functionCalling).toBe(true);
      expect(model?.features.reasoning).toBe(true);
    });

    it("has gemini-3.1-flash-image-preview", () => {
      const model = OPENROUTER_MODELS.find(
        (m) => m.modelId === "google/gemini-3.1-flash-image-preview",
      );
      expect(model).toBeDefined();
      expect(model?.contextWindow).toBe(65_536);
      expect(model?.maxOutputTokens).toBe(65_536);
      expect(model?.pricing.input).toBe(0.5);
      expect(model?.pricing.output).toBe(3.0);
      expect(model?.features.vision).toBe(true);
    });

    it("flash-lite is cheaper than pro", () => {
      const pro = OPENROUTER_MODELS.find((m) => m.modelId === "google/gemini-3.1-pro-preview");
      const flashLite = OPENROUTER_MODELS.find(
        (m) => m.modelId === "google/gemini-3.1-flash-lite-preview",
      );
      expect(flashLite?.pricing.input).toBeLessThan(pro?.pricing.input ?? 0);
      expect(flashLite?.pricing.output).toBeLessThan(pro?.pricing.output ?? 0);
    });
  });
});
