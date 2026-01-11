import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getModelId,
  getProvider,
  hasProviderPrefix,
  MODEL_ALIASES,
  resolveModel,
} from "./model-shortcuts.js";

describe("Model Shortcuts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
  describe("MODEL_ALIASES", () => {
    it("should contain all expected aliases", () => {
      expect(MODEL_ALIASES).toHaveProperty("gpt4");
      expect(MODEL_ALIASES).toHaveProperty("sonnet");
      expect(MODEL_ALIASES).toHaveProperty("haiku");
      expect(MODEL_ALIASES).toHaveProperty("flash");
    });

    it("should map to correct full model IDs", () => {
      expect(MODEL_ALIASES["gpt4"]).toBe("openai:gpt-4o");
      expect(MODEL_ALIASES["sonnet"]).toBe("anthropic:claude-sonnet-4-5");
      expect(MODEL_ALIASES["haiku"]).toBe("anthropic:claude-haiku-4-5");
      expect(MODEL_ALIASES["flash"]).toBe("gemini:gemini-2.5-flash");
    });

    it("should contain OpenRouter aliases", () => {
      expect(MODEL_ALIASES).toHaveProperty("or:sonnet");
      expect(MODEL_ALIASES).toHaveProperty("or:opus");
      expect(MODEL_ALIASES).toHaveProperty("or:haiku");
      expect(MODEL_ALIASES).toHaveProperty("or:gpt4o");
      expect(MODEL_ALIASES).toHaveProperty("or:llama");
      expect(MODEL_ALIASES).toHaveProperty("or:deepseek");
    });

    it("should map OpenRouter aliases to correct full model IDs", () => {
      expect(MODEL_ALIASES["or:sonnet"]).toBe("openrouter:anthropic/claude-sonnet-4-5");
      expect(MODEL_ALIASES["or:opus"]).toBe("openrouter:anthropic/claude-opus-4-5");
      expect(MODEL_ALIASES["or:haiku"]).toBe("openrouter:anthropic/claude-haiku-4-5");
      expect(MODEL_ALIASES["or:gpt4o"]).toBe("openrouter:openai/gpt-4o");
      expect(MODEL_ALIASES["or:gpt5"]).toBe("openrouter:openai/gpt-5.2");
      expect(MODEL_ALIASES["or:flash"]).toBe("openrouter:google/gemini-2.5-flash");
      expect(MODEL_ALIASES["or:llama"]).toBe("openrouter:meta-llama/llama-3.3-70b-instruct");
      expect(MODEL_ALIASES["or:deepseek"]).toBe("openrouter:deepseek/deepseek-r1");
    });
  });

  describe("resolveModel", () => {
    describe("with aliases", () => {
      it("should resolve gpt4 alias", () => {
        expect(resolveModel("gpt4")).toBe("openai:gpt-4o");
      });

      it("should resolve gpt5-nano alias", () => {
        expect(resolveModel("gpt5-nano")).toBe("openai:gpt-5-nano");
      });

      it("should resolve sonnet alias", () => {
        expect(resolveModel("sonnet")).toBe("anthropic:claude-sonnet-4-5");
      });

      it("should resolve haiku alias", () => {
        expect(resolveModel("haiku")).toBe("anthropic:claude-haiku-4-5");
      });

      it("should resolve opus alias", () => {
        expect(resolveModel("opus")).toBe("anthropic:claude-opus-4-5");
      });

      it("should resolve flash alias", () => {
        expect(resolveModel("flash")).toBe("gemini:gemini-2.5-flash");
      });

      it("should be case-insensitive for aliases", () => {
        expect(resolveModel("GPT4")).toBe("openai:gpt-4o");
        expect(resolveModel("SONNET")).toBe("anthropic:claude-sonnet-4-5");
        expect(resolveModel("Flash")).toBe("gemini:gemini-2.5-flash");
      });

      it("should resolve OpenRouter or: aliases", () => {
        expect(resolveModel("or:sonnet")).toBe("openrouter:anthropic/claude-sonnet-4-5");
        expect(resolveModel("or:opus")).toBe("openrouter:anthropic/claude-opus-4-5");
        expect(resolveModel("or:haiku")).toBe("openrouter:anthropic/claude-haiku-4-5");
        expect(resolveModel("or:gpt4o")).toBe("openrouter:openai/gpt-4o");
        expect(resolveModel("or:gpt5")).toBe("openrouter:openai/gpt-5.2");
        expect(resolveModel("or:flash")).toBe("openrouter:google/gemini-2.5-flash");
        expect(resolveModel("or:llama")).toBe("openrouter:meta-llama/llama-3.3-70b-instruct");
        expect(resolveModel("or:deepseek")).toBe("openrouter:deepseek/deepseek-r1");
      });
    });

    describe("with explicit provider prefix", () => {
      it("should pass through models with provider prefix", () => {
        expect(resolveModel("openai:gpt-4o")).toBe("openai:gpt-4o");
        expect(resolveModel("anthropic:claude-3-5-sonnet")).toBe("anthropic:claude-3-5-sonnet");
        expect(resolveModel("gemini:gemini-2.0-flash")).toBe("gemini:gemini-2.0-flash");
      });

      it("should handle custom providers", () => {
        expect(resolveModel("custom:my-model")).toBe("custom:my-model");
      });
    });

    describe("with smart detection", () => {
      it("should auto-detect OpenAI models", () => {
        expect(resolveModel("gpt-4o")).toBe("openai:gpt-4o");
        expect(resolveModel("gpt-5-nano")).toBe("openai:gpt-5-nano");
        expect(resolveModel("gpt-3.5-turbo")).toBe("openai:gpt-3.5-turbo");
      });

      it("should auto-detect Anthropic models", () => {
        expect(resolveModel("claude-3-5-sonnet")).toBe("anthropic:claude-3-5-sonnet");
        expect(resolveModel("claude-3-5-haiku")).toBe("anthropic:claude-3-5-haiku");
        expect(resolveModel("claude-3-opus")).toBe("anthropic:claude-3-opus");
      });

      it("should auto-detect Gemini models", () => {
        expect(resolveModel("gemini-2.0-flash")).toBe("gemini:gemini-2.0-flash");
        expect(resolveModel("gemini-1.5-pro")).toBe("gemini:gemini-1.5-pro");
      });
    });

    describe("fallback behavior", () => {
      it("should fallback to OpenAI for unknown models with warning", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(resolveModel("unknown-model")).toBe("openai:unknown-model");
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Unknown model 'unknown-model'"),
        );

        warnSpy.mockRestore();
      });

      it("should suppress warning with silent option", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(resolveModel("unknown-model", { silent: true })).toBe("openai:unknown-model");
        expect(warnSpy).not.toHaveBeenCalled();

        warnSpy.mockRestore();
      });

      it("should throw error with strict option", () => {
        expect(() => resolveModel("unknown-model", { strict: true })).toThrow(
          "Unknown model 'unknown-model'",
        );
        expect(() => resolveModel("gp4", { strict: true })).toThrow("Unknown model 'gp4'");
      });

      it("should handle edge cases with silent option", () => {
        expect(resolveModel("", { silent: true })).toBe("openai:");
        expect(resolveModel("   ", { silent: true })).toBe("openai:   ");
      });

      it("should detect typos and suggest alternatives", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        resolveModel("gp4");
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("gpt4"));

        warnSpy.mockRestore();
      });
    });

    describe("validation", () => {
      it("should recognize known model patterns", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        // These should NOT warn because they match known patterns
        resolveModel("gpt-4o");
        resolveModel("claude-3-5-sonnet");
        resolveModel("gemini-2.0-flash");
        resolveModel("o1");
        resolveModel("o3-mini");

        expect(warnSpy).not.toHaveBeenCalled();

        warnSpy.mockRestore();
      });

      it("should warn on unrecognized patterns", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        resolveModel("random-model");
        resolveModel("model123");

        expect(warnSpy).toHaveBeenCalledTimes(2);

        warnSpy.mockRestore();
      });

      it("should not warn for known aliases", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        resolveModel("gpt4");
        resolveModel("sonnet");
        resolveModel("haiku");
        resolveModel("flash");

        expect(warnSpy).not.toHaveBeenCalled();

        warnSpy.mockRestore();
      });

      it("should not warn for models with provider prefix", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        resolveModel("custom:my-model");
        resolveModel("unknown:weird-model");

        expect(warnSpy).not.toHaveBeenCalled();

        warnSpy.mockRestore();
      });
    });
  });

  describe("hasProviderPrefix", () => {
    it("should return true for models with provider prefix", () => {
      expect(hasProviderPrefix("openai:gpt-4o")).toBe(true);
      expect(hasProviderPrefix("anthropic:claude")).toBe(true);
      expect(hasProviderPrefix("gemini:flash")).toBe(true);
      expect(hasProviderPrefix("custom:model")).toBe(true);
    });

    it("should return false for models without provider prefix", () => {
      expect(hasProviderPrefix("gpt4")).toBe(false);
      expect(hasProviderPrefix("sonnet")).toBe(false);
      expect(hasProviderPrefix("gpt-5-nano")).toBe(false);
      expect(hasProviderPrefix("claude-3-5-sonnet")).toBe(false);
    });

    it("should handle edge cases", () => {
      expect(hasProviderPrefix("")).toBe(false);
      expect(hasProviderPrefix(":model")).toBe(true);
      expect(hasProviderPrefix("model:")).toBe(true);
    });
  });

  describe("getProvider", () => {
    it("should extract provider from full model string", () => {
      expect(getProvider("openai:gpt-4o")).toBe("openai");
      expect(getProvider("anthropic:claude-3-5-sonnet")).toBe("anthropic");
      expect(getProvider("gemini:gemini-2.0-flash")).toBe("gemini");
      expect(getProvider("custom:my-model")).toBe("custom");
    });

    it("should return undefined for models without prefix", () => {
      expect(getProvider("gpt4")).toBeUndefined();
      expect(getProvider("sonnet")).toBeUndefined();
      expect(getProvider("gpt-5-nano")).toBeUndefined();
    });

    it("should handle edge cases", () => {
      expect(getProvider("")).toBeUndefined();
      expect(getProvider(":model")).toBe("");
      expect(getProvider("model:")).toBe("model");
    });
  });

  describe("getModelId", () => {
    it("should extract model ID from full model string", () => {
      expect(getModelId("openai:gpt-4o")).toBe("gpt-4o");
      expect(getModelId("anthropic:claude-3-5-sonnet")).toBe("claude-3-5-sonnet");
      expect(getModelId("gemini:gemini-2.0-flash")).toBe("gemini-2.0-flash");
      expect(getModelId("custom:my-model")).toBe("my-model");
    });

    it("should return original string for models without prefix", () => {
      expect(getModelId("gpt4")).toBe("gpt4");
      expect(getModelId("sonnet")).toBe("sonnet");
      expect(getModelId("gpt-5-nano")).toBe("gpt-5-nano");
    });

    it("should handle edge cases", () => {
      expect(getModelId("")).toBe("");
      expect(getModelId(":model")).toBe("model");
      expect(getModelId("model:")).toBe("");
    });

    it("should handle multiple colons", () => {
      expect(getModelId("provider:model:version")).toBe("model:version");
    });
  });

  describe("integration tests", () => {
    it("should work together for common workflows", () => {
      const model1 = "gpt4";
      const resolved1 = resolveModel(model1);
      expect(hasProviderPrefix(resolved1)).toBe(true);
      expect(getProvider(resolved1)).toBe("openai");
      expect(getModelId(resolved1)).toBe("gpt-4o");

      const model2 = "sonnet";
      const resolved2 = resolveModel(model2);
      expect(hasProviderPrefix(resolved2)).toBe(true);
      expect(getProvider(resolved2)).toBe("anthropic");
      expect(getModelId(resolved2)).toBe("claude-sonnet-4-5");
    });

    it("should handle roundtrip for already prefixed models", () => {
      const model = "openai:gpt-4o";
      const resolved = resolveModel(model);
      expect(resolved).toBe(model);
      expect(getProvider(resolved)).toBe("openai");
      expect(getModelId(resolved)).toBe("gpt-4o");
    });
  });
});
