import { beforeEach, describe, expect, it } from "bun:test";
import type { ProviderAdapter } from "../providers/provider.js";
import type { ModelSpec } from "./model-catalog.js";
import { ModelRegistry } from "./model-registry.js";

describe("ModelRegistry", () => {
  let registry: ModelRegistry;

  const createModelSpec = (
    modelId: string,
    provider: string,
    contextWindow = 8192,
    maxOutputTokens = 4096,
    inputPrice = 5.0,
    outputPrice = 15.0,
    cachedInputPrice?: number,
  ): ModelSpec => ({
    modelId,
    provider,
    contextWindow,
    maxOutputTokens,
    pricing: {
      input: inputPrice,
      output: outputPrice,
      cachedInput: cachedInputPrice,
    },
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
      json: true,
    },
  });

  const createMockProvider = (providerId: string, specs: ModelSpec[]): ProviderAdapter => ({
    providerId,
    supports: () => true,
    stream: async function* () {
      yield { type: "content_delta", text: "test" };
    },
    getModelSpecs: () => specs,
  });

  beforeEach(() => {
    registry = new ModelRegistry();
  });

  describe("registerProvider()", () => {
    it("should register provider and collect model specs", () => {
      const spec = createModelSpec("gpt-4", "openai");
      const provider = createMockProvider("openai", [spec]);

      registry.registerProvider(provider);

      const models = registry.listModels();
      expect(models).toHaveLength(1);
      expect(models[0].modelId).toBe("gpt-4");
    });

    it("should handle provider without getModelSpecs", () => {
      const provider: ProviderAdapter = {
        providerId: "custom",
        supports: () => true,
        stream: async function* () {
          yield { type: "content_delta", text: "test" };
        },
      };

      registry.registerProvider(provider);

      const models = registry.listModels();
      expect(models).toHaveLength(0);
    });

    it("should register multiple providers", () => {
      const spec1 = createModelSpec("gpt-4", "openai");
      const spec2 = createModelSpec("claude-3", "anthropic");

      const provider1 = createMockProvider("openai", [spec1]);
      const provider2 = createMockProvider("anthropic", [spec2]);

      registry.registerProvider(provider1);
      registry.registerProvider(provider2);

      const models = registry.listModels();
      expect(models).toHaveLength(2);
    });

    it("should register provider with multiple model specs", () => {
      const specs = [
        createModelSpec("gpt-4", "openai"),
        createModelSpec("gpt-3.5-turbo", "openai"),
      ];
      const provider = createMockProvider("openai", specs);

      registry.registerProvider(provider);

      const models = registry.listModels();
      expect(models).toHaveLength(2);
    });
  });

  describe("getModelSpec()", () => {
    beforeEach(() => {
      const spec1 = createModelSpec("gpt-4", "openai");
      const spec2 = createModelSpec("claude-3", "anthropic");
      const provider1 = createMockProvider("openai", [spec1]);
      const provider2 = createMockProvider("anthropic", [spec2]);

      registry.registerProvider(provider1);
      registry.registerProvider(provider2);
    });

    it("should return model spec by ID", () => {
      const spec = registry.getModelSpec("gpt-4");

      expect(spec).toBeDefined();
      expect(spec?.modelId).toBe("gpt-4");
      expect(spec?.provider).toBe("openai");
    });

    it("should return undefined for non-existent model", () => {
      const spec = registry.getModelSpec("non-existent");

      expect(spec).toBeUndefined();
    });
  });

  describe("listModels()", () => {
    beforeEach(() => {
      const specs1 = [
        createModelSpec("gpt-4", "openai"),
        createModelSpec("gpt-3.5-turbo", "openai"),
      ];
      const specs2 = [createModelSpec("claude-3", "anthropic")];
      const provider1 = createMockProvider("openai", specs1);
      const provider2 = createMockProvider("anthropic", specs2);

      registry.registerProvider(provider1);
      registry.registerProvider(provider2);
    });

    it("should list all models when no provider specified", () => {
      const models = registry.listModels();

      expect(models).toHaveLength(3);
      expect(models.map((m) => m.modelId)).toEqual(["gpt-4", "gpt-3.5-turbo", "claude-3"]);
    });

    it("should filter models by provider", () => {
      const models = registry.listModels("openai");

      expect(models).toHaveLength(2);
      expect(models.map((m) => m.modelId)).toEqual(["gpt-4", "gpt-3.5-turbo"]);
    });

    it("should return empty array for non-existent provider", () => {
      const models = registry.listModels("non-existent");

      expect(models).toEqual([]);
    });
  });

  describe("getModelLimits()", () => {
    beforeEach(() => {
      const spec = createModelSpec("gpt-4", "openai", 8192, 4096);
      const provider = createMockProvider("openai", [spec]);
      registry.registerProvider(provider);
    });

    it("should return context window and max output tokens", () => {
      const limits = registry.getModelLimits("gpt-4");

      expect(limits).toBeDefined();
      expect(limits?.contextWindow).toBe(8192);
      expect(limits?.maxOutputTokens).toBe(4096);
    });

    it("should return undefined for non-existent model", () => {
      const limits = registry.getModelLimits("non-existent");

      expect(limits).toBeUndefined();
    });
  });

  describe("estimateCost()", () => {
    beforeEach(() => {
      // Model with cached input pricing
      const spec = createModelSpec("gpt-4", "openai", 8192, 4096, 30.0, 60.0, 15.0);
      const provider = createMockProvider("openai", [spec]);
      registry.registerProvider(provider);
    });

    it("should calculate cost for input and output tokens", () => {
      const cost = registry.estimateCost("gpt-4", 1000, 500);

      expect(cost).toBeDefined();
      expect(cost?.inputCost).toBe(0.03); // (1000 / 1M) * 30
      expect(cost?.outputCost).toBe(0.03); // (500 / 1M) * 60
      expect(cost?.totalCost).toBe(0.06);
      expect(cost?.currency).toBe("USD");
    });

    it("should use cached input pricing when requested", () => {
      const cost = registry.estimateCost("gpt-4", 1000, 500, true);

      expect(cost).toBeDefined();
      expect(cost?.inputCost).toBe(0.015); // (1000 / 1M) * 15 (cached)
      expect(cost?.outputCost).toBe(0.03);
      expect(cost?.totalCost).toBe(0.045);
    });

    it("should fall back to regular input pricing when cached pricing unavailable", () => {
      const spec = createModelSpec("claude-3", "anthropic", 8192, 4096, 3.0, 15.0);
      const provider = createMockProvider("anthropic", [spec]);
      registry.registerProvider(provider);

      const cost = registry.estimateCost("claude-3", 1000, 500, true);

      expect(cost).toBeDefined();
      expect(cost?.inputCost).toBe(0.003); // Uses regular input price
    });

    it("should return undefined for non-existent model", () => {
      const cost = registry.estimateCost("non-existent", 1000, 500);

      expect(cost).toBeUndefined();
    });

    it("should handle zero tokens", () => {
      const cost = registry.estimateCost("gpt-4", 0, 0);

      expect(cost).toBeDefined();
      expect(cost?.inputCost).toBe(0);
      expect(cost?.outputCost).toBe(0);
      expect(cost?.totalCost).toBe(0);
    });
  });

  describe("validateModelConfig()", () => {
    beforeEach(() => {
      const spec = createModelSpec("gpt-4", "openai", 8192, 4096);
      const provider = createMockProvider("openai", [spec]);
      registry.registerProvider(provider);
    });

    it("should return true when tokens within context window", () => {
      const valid = registry.validateModelConfig("gpt-4", 5000);

      expect(valid).toBe(true);
    });

    it("should return false when tokens exceed context window", () => {
      const valid = registry.validateModelConfig("gpt-4", 10000);

      expect(valid).toBe(false);
    });

    it("should return true when tokens exactly match context window", () => {
      const valid = registry.validateModelConfig("gpt-4", 8192);

      expect(valid).toBe(true);
    });

    it("should return false for non-existent model", () => {
      const valid = registry.validateModelConfig("non-existent", 5000);

      expect(valid).toBe(false);
    });
  });

  describe("supportsFeature()", () => {
    beforeEach(() => {
      const spec: ModelSpec = {
        modelId: "gpt-4-vision",
        provider: "openai",
        contextWindow: 8192,
        maxOutputTokens: 4096,
        pricing: { input: 30.0, output: 60.0 },
        features: {
          streaming: true,
          functionCalling: true,
          vision: true,
          json: false,
        },
      };
      const provider = createMockProvider("openai", [spec]);
      registry.registerProvider(provider);
    });

    it("should return true for supported features", () => {
      expect(registry.supportsFeature("gpt-4-vision", "vision")).toBe(true);
      expect(registry.supportsFeature("gpt-4-vision", "streaming")).toBe(true);
      expect(registry.supportsFeature("gpt-4-vision", "functionCalling")).toBe(true);
    });

    it("should return false for unsupported features", () => {
      expect(registry.supportsFeature("gpt-4-vision", "json")).toBe(false);
    });

    it("should return false for non-existent model", () => {
      expect(registry.supportsFeature("non-existent", "vision")).toBe(false);
    });
  });

  describe("getModelsByFeature()", () => {
    beforeEach(() => {
      const specs = [
        {
          ...createModelSpec("gpt-4-vision", "openai"),
          features: {
            streaming: true,
            functionCalling: true,
            vision: true,
            json: false,
          },
        },
        {
          ...createModelSpec("gpt-4", "openai"),
          features: {
            streaming: true,
            functionCalling: true,
            vision: false,
            json: true,
          },
        },
        {
          ...createModelSpec("claude-3", "anthropic"),
          features: {
            streaming: true,
            functionCalling: false,
            vision: true,
            json: false,
          },
        },
      ];

      registry.registerProvider(createMockProvider("openai", specs.slice(0, 2)));
      registry.registerProvider(createMockProvider("anthropic", [specs[2]]));
    });

    it("should filter models by feature across all providers", () => {
      const visionModels = registry.getModelsByFeature("vision");

      expect(visionModels).toHaveLength(2);
      expect(visionModels.map((m) => m.modelId)).toEqual(["gpt-4-vision", "claude-3"]);
    });

    it("should filter models by feature and provider", () => {
      const visionModels = registry.getModelsByFeature("vision", "openai");

      expect(visionModels).toHaveLength(1);
      expect(visionModels[0].modelId).toBe("gpt-4-vision");
    });

    it("should return empty array when no models support feature", () => {
      const models = registry.getModelsByFeature("json", "anthropic");

      expect(models).toEqual([]);
    });

    it("should return all models when all support feature", () => {
      const streamingModels = registry.getModelsByFeature("streaming");

      expect(streamingModels).toHaveLength(3);
    });
  });

  describe("getCheapestModel()", () => {
    beforeEach(() => {
      const specs = [
        createModelSpec("gpt-4", "openai", 8192, 4096, 30.0, 60.0), // Most expensive
        createModelSpec("gpt-3.5-turbo", "openai", 4096, 2048, 0.5, 1.5), // Cheapest
        createModelSpec("claude-3", "anthropic", 8192, 4096, 3.0, 15.0), // Mid-range
      ];

      registry.registerProvider(createMockProvider("openai", specs.slice(0, 2)));
      registry.registerProvider(createMockProvider("anthropic", [specs[2]]));
    });

    it("should return cheapest model across all providers", () => {
      const cheapest = registry.getCheapestModel(1000, 500);

      expect(cheapest).toBeDefined();
      expect(cheapest?.modelId).toBe("gpt-3.5-turbo");
    });

    it("should return cheapest model for specific provider", () => {
      const cheapest = registry.getCheapestModel(1000, 500, "anthropic");

      expect(cheapest).toBeDefined();
      expect(cheapest?.modelId).toBe("claude-3");
    });

    it("should handle different token counts", () => {
      // With high output tokens, relative prices might differ
      const cheapest = registry.getCheapestModel(100, 10000);

      expect(cheapest).toBeDefined();
      expect(cheapest?.modelId).toBe("gpt-3.5-turbo"); // Still cheapest
    });

    it("should return undefined when no models available", () => {
      const cheapest = registry.getCheapestModel(1000, 500, "non-existent");

      expect(cheapest).toBeUndefined();
    });

    it("should return undefined when registry is empty", () => {
      const emptyRegistry = new ModelRegistry();
      const cheapest = emptyRegistry.getCheapestModel(1000, 500);

      expect(cheapest).toBeUndefined();
    });

    it("should handle models with identical pricing", () => {
      const identicalSpecs = [
        createModelSpec("model-a", "provider", 8192, 4096, 10.0, 20.0),
        createModelSpec("model-b", "provider", 8192, 4096, 10.0, 20.0),
      ];
      const testRegistry = new ModelRegistry();
      testRegistry.registerProvider(createMockProvider("provider", identicalSpecs));

      const cheapest = testRegistry.getCheapestModel(1000, 500);

      expect(cheapest).toBeDefined();
      // Should return first one found
      expect(cheapest?.modelId).toBe("model-a");
    });
  });

  describe("Integration", () => {
    it("should handle complex multi-provider scenario", () => {
      // Register multiple providers with various models
      const openaiSpecs = [
        createModelSpec("gpt-4", "openai", 8192, 4096, 30.0, 60.0),
        createModelSpec("gpt-3.5-turbo", "openai", 4096, 2048, 0.5, 1.5),
      ];
      const anthropicSpecs = [
        createModelSpec("claude-3-opus", "anthropic", 200000, 4096, 15.0, 75.0),
        createModelSpec("claude-3-sonnet", "anthropic", 200000, 4096, 3.0, 15.0),
      ];

      registry.registerProvider(createMockProvider("openai", openaiSpecs));
      registry.registerProvider(createMockProvider("anthropic", anthropicSpecs));

      // Test various registry operations
      expect(registry.listModels()).toHaveLength(4);
      expect(registry.listModels("openai")).toHaveLength(2);
      expect(registry.listModels("anthropic")).toHaveLength(2);

      // Find cheapest overall
      const cheapest = registry.getCheapestModel(1000, 500);
      expect(cheapest?.modelId).toBe("gpt-3.5-turbo");

      // Validate large context model
      const validOpus = registry.validateModelConfig("claude-3-opus", 150000);
      expect(validOpus).toBe(true);

      const invalidOpus = registry.validateModelConfig("gpt-4", 150000);
      expect(invalidOpus).toBe(false);

      // Cost estimation
      const gpt4Cost = registry.estimateCost("gpt-4", 1000, 1000);
      const sonnetCost = registry.estimateCost("claude-3-sonnet", 1000, 1000);

      expect(gpt4Cost?.totalCost).toBeGreaterThan(sonnetCost?.totalCost ?? 0);
    });
  });

  describe("registerModel()", () => {
    it("should register a single custom model", () => {
      const customModel = createModelSpec("custom-model-v1", "openai", 100_000, 8192, 10.0, 20.0);

      registry.registerModel(customModel);

      const spec = registry.getModelSpec("custom-model-v1");
      expect(spec).toBeDefined();
      expect(spec?.modelId).toBe("custom-model-v1");
      expect(spec?.provider).toBe("openai");
    });

    it("should add custom model to provider map", () => {
      const customModel = createModelSpec("custom-model-v1", "openai", 100_000, 8192, 10.0, 20.0);

      registry.registerModel(customModel);

      const openaiModels = registry.listModels("openai");
      expect(openaiModels).toHaveLength(1);
      expect(openaiModels[0].modelId).toBe("custom-model-v1");
    });

    it("should register custom models for new providers", () => {
      const customModel = createModelSpec("my-model", "custom-provider", 50_000, 4096, 5.0, 10.0);

      registry.registerModel(customModel);

      const spec = registry.getModelSpec("my-model");
      expect(spec).toBeDefined();
      expect(spec?.provider).toBe("custom-provider");

      const customProviderModels = registry.listModels("custom-provider");
      expect(customProviderModels).toHaveLength(1);
    });

    it("should throw error when modelId is missing", () => {
      const invalidModel = {
        provider: "openai",
        contextWindow: 100_000,
        maxOutputTokens: 8192,
        pricing: { input: 10.0, output: 20.0 },
        features: { streaming: true, functionCalling: true, vision: false, json: true },
      } as ModelSpec;

      expect(() => registry.registerModel(invalidModel)).toThrow(
        "ModelSpec must have modelId and provider",
      );
    });

    it("should throw error when provider is missing", () => {
      const invalidModel = {
        modelId: "custom-model",
        contextWindow: 100_000,
        maxOutputTokens: 8192,
        pricing: { input: 10.0, output: 20.0 },
        features: { streaming: true, functionCalling: true, vision: false, json: true },
      } as ModelSpec;

      expect(() => registry.registerModel(invalidModel)).toThrow(
        "ModelSpec must have modelId and provider",
      );
    });

    it("should overwrite existing model with warning", () => {
      const originalModel = createModelSpec("gpt-4", "openai", 8192, 4096, 30.0, 60.0);
      const updatedModel = createModelSpec("gpt-4", "openai", 128_000, 16_384, 25.0, 50.0);

      registry.registerModel(originalModel);

      // Mock console.warn to verify warning is logged
      const originalWarn = console.warn;
      let warningLogged = false;
      console.warn = (...args: unknown[]) => {
        if (typeof args[0] === "string" && args[0].includes("Overwriting existing model spec")) {
          warningLogged = true;
        }
      };

      registry.registerModel(updatedModel);

      console.warn = originalWarn;
      expect(warningLogged).toBe(true);

      // Verify the model was updated
      const spec = registry.getModelSpec("gpt-4");
      expect(spec?.contextWindow).toBe(128_000);
      expect(spec?.maxOutputTokens).toBe(16_384);

      // Verify only one model exists (not duplicated)
      const models = registry.listModels();
      expect(models).toHaveLength(1);
    });

    it("should work with all registry methods after custom registration", () => {
      const customModel = createModelSpec("fine-tuned-gpt", "openai", 100_000, 8192, 7.5, 30.0);
      registry.registerModel(customModel);

      // Test getModelLimits
      const limits = registry.getModelLimits("fine-tuned-gpt");
      expect(limits?.contextWindow).toBe(100_000);
      expect(limits?.maxOutputTokens).toBe(8192);

      // Test estimateCost
      const cost = registry.estimateCost("fine-tuned-gpt", 1000, 500);
      expect(cost?.inputCost).toBe(0.0075);
      expect(cost?.outputCost).toBe(0.015);

      // Test validateModelConfig
      expect(registry.validateModelConfig("fine-tuned-gpt", 50_000)).toBe(true);
      expect(registry.validateModelConfig("fine-tuned-gpt", 150_000)).toBe(false);

      // Test supportsFeature
      expect(registry.supportsFeature("fine-tuned-gpt", "streaming")).toBe(true);
    });
  });

  describe("registerModels()", () => {
    it("should register multiple custom models at once", () => {
      const customModels = [
        createModelSpec("model-a", "openai", 100_000, 8192, 10.0, 20.0),
        createModelSpec("model-b", "openai", 200_000, 16_384, 15.0, 30.0),
        createModelSpec("model-c", "anthropic", 150_000, 8192, 12.0, 25.0),
      ];

      registry.registerModels(customModels);

      expect(registry.listModels()).toHaveLength(3);
      expect(registry.getModelSpec("model-a")).toBeDefined();
      expect(registry.getModelSpec("model-b")).toBeDefined();
      expect(registry.getModelSpec("model-c")).toBeDefined();
    });

    it("should handle empty array", () => {
      registry.registerModels([]);

      expect(registry.listModels()).toHaveLength(0);
    });

    it("should handle mix of new and duplicate models", () => {
      const model1 = createModelSpec("model-1", "openai", 100_000, 8192, 10.0, 20.0);
      registry.registerModel(model1);

      const customModels = [
        createModelSpec("model-1", "openai", 200_000, 16_384, 15.0, 30.0), // Duplicate
        createModelSpec("model-2", "openai", 150_000, 8192, 12.0, 25.0), // New
      ];

      // Suppress console.warn for this test
      const originalWarn = console.warn;
      console.warn = () => {};

      registry.registerModels(customModels);

      console.warn = originalWarn;

      // Should have 2 models total (duplicate was overwritten)
      expect(registry.listModels()).toHaveLength(2);

      // Verify the duplicate was updated
      const updatedModel = registry.getModelSpec("model-1");
      expect(updatedModel?.contextWindow).toBe(200_000);
    });
  });

  describe("Custom models with existing providers", () => {
    beforeEach(() => {
      const spec = createModelSpec("gpt-4", "openai");
      const provider = createMockProvider("openai", [spec]);
      registry.registerProvider(provider);
    });

    it("should add custom model alongside provider models", () => {
      const customModel = createModelSpec("gpt-4-custom", "openai", 150_000, 16_384, 20.0, 40.0);
      registry.registerModel(customModel);

      const openaiModels = registry.listModels("openai");
      expect(openaiModels).toHaveLength(2);
      expect(openaiModels.map((m) => m.modelId)).toEqual(["gpt-4", "gpt-4-custom"]);
    });

    it("should find cheapest model including custom models", () => {
      // Add a cheaper custom model
      const cheapCustomModel = createModelSpec("cheap-model", "openai", 50_000, 4096, 0.1, 0.5);
      registry.registerModel(cheapCustomModel);

      const cheapest = registry.getCheapestModel(1000, 500);
      expect(cheapest?.modelId).toBe("cheap-model");
    });

    it("should filter custom models by feature", () => {
      const visionModel: ModelSpec = {
        modelId: "custom-vision",
        provider: "openai",
        contextWindow: 100_000,
        maxOutputTokens: 8192,
        pricing: { input: 10.0, output: 20.0 },
        features: {
          streaming: true,
          functionCalling: true,
          vision: true,
          json: false,
        },
      };

      registry.registerModel(visionModel);

      const visionModels = registry.getModelsByFeature("vision", "openai");
      expect(visionModels).toHaveLength(1);
      expect(visionModels[0].modelId).toBe("custom-vision");
    });
  });
});
