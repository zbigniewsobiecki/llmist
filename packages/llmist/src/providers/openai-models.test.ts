import { describe, expect, it } from "vitest";
import { OPENAI_MODELS } from "./openai-models.js";

describe("OPENAI_MODELS", () => {
  it("exports an array of model specifications", () => {
    expect(Array.isArray(OPENAI_MODELS)).toBe(true);
    expect(OPENAI_MODELS.length).toBeGreaterThan(0);
  });

  describe("model specifications", () => {
    it.each(OPENAI_MODELS)("$modelId has valid structure", (model) => {
      // Required fields
      expect(model.provider).toBe("openai");
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

    it.each(OPENAI_MODELS)("$modelId has valid pricing", (model) => {
      expect(model.pricing.input).toBeGreaterThanOrEqual(0);
      expect(model.pricing.output).toBeGreaterThanOrEqual(0);

      // Output should generally cost more than input
      expect(model.pricing.output).toBeGreaterThanOrEqual(model.pricing.input);

      if (model.pricing.cachedInput !== undefined) {
        expect(model.pricing.cachedInput).toBeGreaterThanOrEqual(0);
        expect(model.pricing.cachedInput).toBeLessThanOrEqual(model.pricing.input);
      }
    });

    it.each(OPENAI_MODELS)("$modelId has valid features", (model) => {
      expect(typeof model.features.streaming).toBe("boolean");
      expect(typeof model.features.functionCalling).toBe("boolean");
      expect(typeof model.features.vision).toBe("boolean");

      // All OpenAI models support streaming and function calling
      expect(model.features.streaming).toBe(true);
      expect(model.features.functionCalling).toBe(true);
    });
  });

  describe("model families", () => {
    it("includes GPT-5 family models", () => {
      const gpt5 = OPENAI_MODELS.filter((m) => m.metadata?.family?.startsWith("GPT-5"));
      expect(gpt5.length).toBeGreaterThan(0);
    });

    it("includes GPT-4 family models", () => {
      const gpt4 = OPENAI_MODELS.filter((m) => m.metadata?.family?.startsWith("GPT-4"));
      expect(gpt4.length).toBeGreaterThan(0);
    });

    it("includes o-series reasoning models", () => {
      const oSeries = OPENAI_MODELS.filter((m) => m.metadata?.family === "o-series");
      expect(oSeries.length).toBeGreaterThan(0);

      // o-series should have reasoning capability
      for (const model of oSeries) {
        expect(model.features.reasoning).toBe(true);
      }
    });
  });

  describe("specific models", () => {
    it("has gpt-5 with 1M context window", () => {
      const gpt5 = OPENAI_MODELS.find((m) => m.modelId === "gpt-5");
      expect(gpt5).toBeDefined();
      expect(gpt5?.contextWindow).toBe(1_000_000);
      expect(gpt5?.features.vision).toBe(true);
    });

    it("has gpt-5-nano as cost-efficient option", () => {
      const nano = OPENAI_MODELS.find((m) => m.modelId === "gpt-5-nano");
      expect(nano).toBeDefined();
      // Nano should be cheapest in GPT-5 family
      const gpt5Family = OPENAI_MODELS.filter(
        (m) => m.modelId.startsWith("gpt-5") && !m.modelId.includes("pro"),
      );
      for (const model of gpt5Family) {
        expect(nano?.pricing.input).toBeLessThanOrEqual(model.pricing.input);
      }
    });

    it("has gpt-4o-mini as affordable option", () => {
      const mini = OPENAI_MODELS.find((m) => m.modelId === "gpt-4o-mini");
      expect(mini).toBeDefined();
      expect(mini?.features.vision).toBe(true);
      expect(mini?.pricing.input).toBeLessThan(1); // Should be under $1/M tokens
    });

    it("has o1 reasoning model", () => {
      const o1 = OPENAI_MODELS.find((m) => m.modelId === "o1");
      expect(o1).toBeDefined();
      expect(o1?.features.reasoning).toBe(true);
      expect(o1?.metadata?.supportsTemperature).toBe(false);
    });
  });

  describe("temperature support metadata", () => {
    it("reasoning models disable temperature", () => {
      const reasoningModels = OPENAI_MODELS.filter((m) => m.features.reasoning === true);
      for (const model of reasoningModels) {
        expect(model.metadata?.supportsTemperature).toBe(false);
      }
    });
  });
});
