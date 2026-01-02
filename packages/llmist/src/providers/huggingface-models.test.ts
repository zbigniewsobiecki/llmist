import { describe, expect, it } from "vitest";
import { HUGGINGFACE_MODELS } from "./huggingface-models.js";

describe("HUGGINGFACE_MODELS", () => {
  it("exports an array of model specifications", () => {
    expect(Array.isArray(HUGGINGFACE_MODELS)).toBe(true);
    expect(HUGGINGFACE_MODELS.length).toBeGreaterThan(0);
  });

  describe("model specifications", () => {
    it.each(HUGGINGFACE_MODELS)("$modelId has valid structure", (model) => {
      // Required fields
      expect(model.provider).toBe("huggingface");
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

    it.each(HUGGINGFACE_MODELS)("$modelId has free pricing (serverless)", (model) => {
      // Hugging Face serverless inference is free
      expect(model.pricing.input).toBe(0);
      expect(model.pricing.output).toBe(0);
    });

    it.each(HUGGINGFACE_MODELS)("$modelId has valid features", (model) => {
      expect(typeof model.features.streaming).toBe("boolean");
      expect(typeof model.features.functionCalling).toBe("boolean");
      expect(typeof model.features.vision).toBe("boolean");

      // All HF models support streaming
      expect(model.features.streaming).toBe(true);
    });
  });

  describe("model ID format", () => {
    it("all model IDs follow org/model-name format", () => {
      for (const model of HUGGINGFACE_MODELS) {
        expect(model.modelId).toMatch(/^[\w-]+\/[\w.-]+$/);
      }
    });
  });

  describe("model families", () => {
    it("includes DeepSeek models", () => {
      const deepseek = HUGGINGFACE_MODELS.filter((m) => m.modelId.startsWith("deepseek-ai/"));
      expect(deepseek.length).toBeGreaterThan(0);
    });

    it("includes Meta Llama models", () => {
      const llama = HUGGINGFACE_MODELS.filter((m) => m.modelId.startsWith("meta-llama/"));
      expect(llama.length).toBeGreaterThan(0);
    });

    it("includes Mistral models", () => {
      const mistral = HUGGINGFACE_MODELS.filter((m) => m.modelId.startsWith("mistralai/"));
      expect(mistral.length).toBeGreaterThan(0);
    });

    it("includes Qwen models", () => {
      const qwen = HUGGINGFACE_MODELS.filter((m) => m.modelId.startsWith("Qwen/"));
      expect(qwen.length).toBeGreaterThan(0);
    });

    it("includes Google Gemma models", () => {
      const gemma = HUGGINGFACE_MODELS.filter((m) => m.modelId.startsWith("google/gemma"));
      expect(gemma.length).toBeGreaterThan(0);
    });
  });

  describe("specific models", () => {
    it("has DeepSeek-R1 reasoning model", () => {
      const r1 = HUGGINGFACE_MODELS.find((m) => m.modelId === "deepseek-ai/DeepSeek-R1");
      expect(r1).toBeDefined();
      expect(r1?.features.reasoning).toBe(true);
    });

    it("has Llama 3.1 8B as widely supported model", () => {
      const llama = HUGGINGFACE_MODELS.find(
        (m) => m.modelId === "meta-llama/Llama-3.1-8B-Instruct",
      );
      expect(llama).toBeDefined();
      expect(llama?.contextWindow).toBe(128_000);
      expect(llama?.features.functionCalling).toBe(true);
    });

    it("has Qwen 2.5 Coder for coding tasks", () => {
      const coder = HUGGINGFACE_MODELS.find((m) => m.modelId === "Qwen/Qwen2.5-Coder-32B-Instruct");
      expect(coder).toBeDefined();
      expect(coder?.metadata?.notes).toContain("coding");
    });

    it("has vision-capable models", () => {
      const visionModels = HUGGINGFACE_MODELS.filter((m) => m.features.vision === true);
      expect(visionModels.length).toBeGreaterThan(0);
    });
  });

  describe("function calling support", () => {
    it("many models support function calling", () => {
      const withFunctionCalling = HUGGINGFACE_MODELS.filter(
        (m) => m.features.functionCalling === true,
      );
      expect(withFunctionCalling.length).toBeGreaterThan(5);
    });

    it("some older models lack function calling", () => {
      const withoutFunctionCalling = HUGGINGFACE_MODELS.filter(
        (m) => m.features.functionCalling === false,
      );
      expect(withoutFunctionCalling.length).toBeGreaterThan(0);
    });
  });

  describe("context window sizes", () => {
    it("has models with 128K context", () => {
      const large = HUGGINGFACE_MODELS.filter((m) => m.contextWindow >= 128_000);
      expect(large.length).toBeGreaterThan(0);
    });

    it("has smaller models for efficiency", () => {
      const small = HUGGINGFACE_MODELS.filter((m) => m.contextWindow <= 32_768);
      expect(small.length).toBeGreaterThan(0);
    });
  });
});
