import { describe, expect, it } from "vitest";
import { GEMINI_MODELS } from "./gemini-models.js";

describe("GEMINI_MODELS", () => {
  it("exports an array of model specifications", () => {
    expect(Array.isArray(GEMINI_MODELS)).toBe(true);
    expect(GEMINI_MODELS.length).toBeGreaterThan(0);
  });

  describe("model specifications", () => {
    it.each(GEMINI_MODELS)("$modelId has valid structure", (model) => {
      // Required fields
      expect(model.provider).toBe("gemini");
      expect(typeof model.modelId).toBe("string");
      expect(model.modelId.length).toBeGreaterThan(0);
      expect(typeof model.displayName).toBe("string");
      expect(model.displayName.length).toBeGreaterThan(0);

      // Numeric constraints
      expect(model.contextWindow).toBeGreaterThan(0);
      expect(model.maxOutputTokens).toBeGreaterThan(0);
      expect(model.maxOutputTokens).toBeLessThanOrEqual(model.contextWindow);

      // Knowledge cutoff
      expect(typeof model.knowledgeCutoff).toBe("string");
    });

    it.each(GEMINI_MODELS)("$modelId has valid pricing", (model) => {
      expect(model.pricing.input).toBeGreaterThanOrEqual(0);
      expect(model.pricing.output).toBeGreaterThanOrEqual(0);

      // Output typically costs more than input
      expect(model.pricing.output).toBeGreaterThanOrEqual(model.pricing.input);

      if (model.pricing.cachedInput !== undefined) {
        expect(model.pricing.cachedInput).toBeGreaterThanOrEqual(0);
        expect(model.pricing.cachedInput).toBeLessThanOrEqual(model.pricing.input);
      }
    });

    it.each(GEMINI_MODELS)("$modelId has valid features", (model) => {
      expect(typeof model.features.streaming).toBe("boolean");
      expect(typeof model.features.functionCalling).toBe("boolean");
      expect(typeof model.features.vision).toBe("boolean");

      // All Gemini models support streaming and function calling
      expect(model.features.streaming).toBe(true);
      expect(model.features.functionCalling).toBe(true);
    });
  });

  describe("model families", () => {
    it("includes Gemini 3 family models", () => {
      const gemini3 = GEMINI_MODELS.filter((m) => m.metadata?.family === "Gemini 3");
      expect(gemini3.length).toBeGreaterThan(0);
    });

    it("includes Gemini 2.5 family models", () => {
      const gemini25 = GEMINI_MODELS.filter((m) => m.metadata?.family === "Gemini 2.5");
      expect(gemini25.length).toBeGreaterThan(0);
    });

    it("includes Gemini 2.0 family models", () => {
      const gemini20 = GEMINI_MODELS.filter((m) => m.metadata?.family === "Gemini 2.0");
      expect(gemini20.length).toBeGreaterThan(0);
    });
  });

  describe("context windows", () => {
    it("all Gemini models have 1M+ context window", () => {
      for (const model of GEMINI_MODELS) {
        expect(model.contextWindow).toBeGreaterThanOrEqual(1_000_000);
      }
    });
  });

  describe("specific models", () => {
    it("has gemini-2.5-pro as flagship model", () => {
      const pro = GEMINI_MODELS.find((m) => m.modelId === "gemini-2.5-pro");
      expect(pro).toBeDefined();
      expect(pro?.contextWindow).toBe(1_048_576);
      expect(pro?.features.vision).toBe(true);
      expect(pro?.features.reasoning).toBe(true);
    });

    it("has gemini-2.5-flash as fast option", () => {
      const flash = GEMINI_MODELS.find((m) => m.modelId === "gemini-2.5-flash");
      expect(flash).toBeDefined();
      // Flash should be cheaper than Pro
      const pro = GEMINI_MODELS.find((m) => m.modelId === "gemini-2.5-pro");
      expect(flash?.pricing.input).toBeLessThan(pro?.pricing.input ?? 0);
    });

    it("has gemini-2.5-flash-lite as cost-efficient in 2.5 family", () => {
      const lite = GEMINI_MODELS.find((m) => m.modelId === "gemini-2.5-flash-lite");
      expect(lite).toBeDefined();
      // Lite should be cheapest in 2.5 family
      const family25 = GEMINI_MODELS.filter((m) => m.metadata?.family === "Gemini 2.5");
      for (const model of family25) {
        expect(lite?.pricing.input).toBeLessThanOrEqual(model.pricing.input);
      }
    });

    it("has gemini-3-pro-preview with deep think", () => {
      const preview = GEMINI_MODELS.find((m) => m.modelId === "gemini-3-pro-preview");
      expect(preview).toBeDefined();
      expect(preview?.features.reasoning).toBe(true);
      expect(preview?.metadata?.notes).toContain("Deep Think");
    });
  });

  describe("flash vs pro pricing", () => {
    it("flash models are cheaper than pro models", () => {
      const flashModels = GEMINI_MODELS.filter((m) => m.modelId.toLowerCase().includes("flash"));
      const proModels = GEMINI_MODELS.filter((m) => m.modelId.toLowerCase().includes("pro"));

      // Average flash price should be lower than average pro price
      const avgFlashInput =
        flashModels.reduce((sum, m) => sum + m.pricing.input, 0) / flashModels.length;
      const avgProInput = proModels.reduce((sum, m) => sum + m.pricing.input, 0) / proModels.length;

      expect(avgFlashInput).toBeLessThan(avgProInput);
    });
  });
});
