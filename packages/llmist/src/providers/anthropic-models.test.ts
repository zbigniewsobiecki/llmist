import { describe, expect, it } from "vitest";
import { ANTHROPIC_MODELS } from "./anthropic-models.js";

describe("ANTHROPIC_MODELS", () => {
  it("exports an array of model specifications", () => {
    expect(Array.isArray(ANTHROPIC_MODELS)).toBe(true);
    expect(ANTHROPIC_MODELS.length).toBeGreaterThan(0);
  });

  describe("model specifications", () => {
    it.each(ANTHROPIC_MODELS)("$modelId has valid structure", (model) => {
      // Required fields
      expect(model.provider).toBe("anthropic");
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

    it.each(ANTHROPIC_MODELS)("$modelId has valid pricing", (model) => {
      expect(model.pricing.input).toBeGreaterThanOrEqual(0);
      expect(model.pricing.output).toBeGreaterThanOrEqual(0);

      // Anthropic models support caching
      if (model.pricing.cachedInput !== undefined) {
        expect(model.pricing.cachedInput).toBeGreaterThanOrEqual(0);
        expect(model.pricing.cachedInput).toBeLessThanOrEqual(model.pricing.input);
      }
      if (model.pricing.cacheWriteInput !== undefined) {
        expect(model.pricing.cacheWriteInput).toBeGreaterThanOrEqual(0);
      }
    });

    it.each(ANTHROPIC_MODELS)("$modelId has valid features", (model) => {
      expect(typeof model.features.streaming).toBe("boolean");
      expect(typeof model.features.functionCalling).toBe("boolean");
      expect(typeof model.features.vision).toBe("boolean");

      // All Anthropic models support streaming and function calling
      expect(model.features.streaming).toBe(true);
      expect(model.features.functionCalling).toBe(true);
    });
  });

  describe("model aliases", () => {
    it("includes modern aliases without date suffixes", () => {
      const aliases = ANTHROPIC_MODELS.filter((m) => !m.modelId.match(/\d{8}$/));
      expect(aliases.length).toBeGreaterThan(0);

      const aliasNames = aliases.map((m) => m.modelId);
      expect(aliasNames).toContain("claude-haiku-4-5");
      expect(aliasNames).toContain("claude-sonnet-4-5");
      expect(aliasNames).toContain("claude-opus-4-5");
    });

    it("includes dated versions", () => {
      const dated = ANTHROPIC_MODELS.filter((m) => m.modelId.match(/\d{8}$/));
      expect(dated.length).toBeGreaterThan(0);
    });
  });

  describe("model families", () => {
    it("includes Claude 4 family models", () => {
      const claude4 = ANTHROPIC_MODELS.filter((m) => m.metadata?.family === "Claude 4");
      expect(claude4.length).toBeGreaterThan(0);
    });

    it("includes Claude 3 family models for backwards compatibility", () => {
      const claude3 = ANTHROPIC_MODELS.filter((m) => m.metadata?.family === "Claude 3");
      expect(claude3.length).toBeGreaterThan(0);
    });
  });

  describe("specific models", () => {
    it("has claude-sonnet-4-5 with expected capabilities", () => {
      const sonnet = ANTHROPIC_MODELS.find((m) => m.modelId === "claude-sonnet-4-5");
      expect(sonnet).toBeDefined();
      expect(sonnet?.contextWindow).toBe(200_000);
      expect(sonnet?.features.vision).toBe(true);
      expect(sonnet?.features.reasoning).toBe(true);
    });

    it("has claude-haiku-4-5 as the fastest model", () => {
      const haiku = ANTHROPIC_MODELS.find((m) => m.modelId === "claude-haiku-4-5");
      expect(haiku).toBeDefined();
      // Haiku should have lower pricing than Sonnet
      const sonnet = ANTHROPIC_MODELS.find((m) => m.modelId === "claude-sonnet-4-5");
      expect(haiku?.pricing.input).toBeLessThan(sonnet?.pricing.input ?? 0);
    });
  });
});
