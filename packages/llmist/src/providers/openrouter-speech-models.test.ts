import { describe, expect, it } from "vitest";
import {
  calculateOpenRouterSpeechCost,
  getOpenRouterSpeechModelSpec,
  isOpenRouterSpeechModel,
  OPENROUTER_TTS_VOICES,
  openrouterSpeechModels,
} from "./openrouter-speech-models.js";

describe("openrouterSpeechModels", () => {
  it("exports an array of model specifications", () => {
    expect(Array.isArray(openrouterSpeechModels)).toBe(true);
    expect(openrouterSpeechModels.length).toBeGreaterThan(0);
  });

  describe("model specifications", () => {
    it.each(openrouterSpeechModels)("$modelId has valid provider and modelId", (model) => {
      expect(model.provider).toBe("openrouter");
      expect(typeof model.modelId).toBe("string");
      expect(model.modelId.length).toBeGreaterThan(0);
      expect(typeof model.displayName).toBe("string");
      expect(model.displayName.length).toBeGreaterThan(0);
    });

    it.each(openrouterSpeechModels)("$modelId has valid pricing (non-negative)", (model) => {
      const { pricing } = model;

      if (pricing.perInputToken !== undefined) {
        expect(pricing.perInputToken).toBeGreaterThanOrEqual(0);
      }

      if (pricing.perAudioOutputToken !== undefined) {
        expect(pricing.perAudioOutputToken).toBeGreaterThanOrEqual(0);
      }

      if (pricing.perMinute !== undefined) {
        expect(pricing.perMinute).toBeGreaterThanOrEqual(0);
      }

      // At least one pricing field must be set
      const hasPricing =
        pricing.perInputToken !== undefined ||
        pricing.perAudioOutputToken !== undefined ||
        pricing.perMinute !== undefined;
      expect(hasPricing).toBe(true);
    });

    it.each(openrouterSpeechModels)("$modelId has valid voices and formats", (model) => {
      expect(Array.isArray(model.voices)).toBe(true);
      expect(model.voices.length).toBeGreaterThan(0);
      expect(Array.isArray(model.formats)).toBe(true);
      expect(model.formats.length).toBeGreaterThan(0);
    });

    it.each(
      openrouterSpeechModels,
    )("$modelId has valid defaults and input constraints", (model) => {
      expect(typeof model.defaultVoice).toBe("string");
      expect(model.defaultVoice.length).toBeGreaterThan(0);
      expect(typeof model.defaultFormat).toBe("string");
      expect(model.defaultFormat.length).toBeGreaterThan(0);
      expect(model.maxInputLength).toBeGreaterThan(0);
    });

    it.each(openrouterSpeechModels)("$modelId default voice is in voices list", (model) => {
      expect(model.voices).toContain(model.defaultVoice);
    });

    it.each(openrouterSpeechModels)("$modelId default format is in formats list", (model) => {
      expect(model.formats).toContain(model.defaultFormat);
    });

    it.each(openrouterSpeechModels)("$modelId supports voice instructions", (model) => {
      expect(model.features.voiceInstructions).toBe(true);
    });
  });

  describe("voice constants", () => {
    it("OPENROUTER_TTS_VOICES contains expected standard voices", () => {
      expect(OPENROUTER_TTS_VOICES).toContain("alloy");
      expect(OPENROUTER_TTS_VOICES).toContain("echo");
      expect(OPENROUTER_TTS_VOICES).toContain("fable");
      expect(OPENROUTER_TTS_VOICES).toContain("onyx");
      expect(OPENROUTER_TTS_VOICES).toContain("nova");
      expect(OPENROUTER_TTS_VOICES).toContain("shimmer");
    });

    it("OPENROUTER_TTS_VOICES has 6 voices", () => {
      expect(OPENROUTER_TTS_VOICES.length).toBe(6);
    });
  });

  describe("specific models", () => {
    it("includes openai/gpt-4o-audio-preview", () => {
      const model = openrouterSpeechModels.find((m) => m.modelId === "openai/gpt-4o-audio-preview");
      expect(model).toBeDefined();
      expect(model?.provider).toBe("openrouter");
      expect(model?.pricing.perMinute).toBeDefined();
      expect(model?.pricing.perInputToken).toBeDefined();
      expect(model?.pricing.perAudioOutputToken).toBeDefined();
    });

    it("includes openai/gpt-audio", () => {
      const model = openrouterSpeechModels.find((m) => m.modelId === "openai/gpt-audio");
      expect(model).toBeDefined();
      expect(model?.provider).toBe("openrouter");
      expect(model?.pricing.perMinute).toBeDefined();
      expect(model?.pricing.perInputToken).toBeDefined();
      expect(model?.pricing.perAudioOutputToken).toBeDefined();
    });

    it("includes openai/gpt-audio-mini with lower pricing than openai/gpt-audio", () => {
      const full = openrouterSpeechModels.find((m) => m.modelId === "openai/gpt-audio");
      const mini = openrouterSpeechModels.find((m) => m.modelId === "openai/gpt-audio-mini");
      expect(full).toBeDefined();
      expect(mini).toBeDefined();
      expect(mini?.pricing.perMinute ?? 0).toBeLessThan(full?.pricing.perMinute ?? 0);
      expect(mini?.pricing.perInputToken ?? 0).toBeLessThan(full?.pricing.perInputToken ?? 0);
    });

    it("all models use alloy as default voice", () => {
      for (const model of openrouterSpeechModels) {
        expect(model.defaultVoice).toBe("alloy");
      }
    });

    it("all models default to pcm16 format", () => {
      for (const model of openrouterSpeechModels) {
        expect(model.defaultFormat).toBe("pcm16");
      }
    });

    it("all models only support pcm16 format", () => {
      for (const model of openrouterSpeechModels) {
        expect(model.formats).toEqual(["pcm16"]);
      }
    });

    it("all models have 128K max input length", () => {
      for (const model of openrouterSpeechModels) {
        expect(model.maxInputLength).toBe(128000);
      }
    });
  });

  describe("helper functions", () => {
    describe("getOpenRouterSpeechModelSpec", () => {
      it("returns spec for a known model", () => {
        const spec = getOpenRouterSpeechModelSpec("openai/gpt-audio");
        expect(spec).toBeDefined();
        expect(spec?.modelId).toBe("openai/gpt-audio");
        expect(spec?.provider).toBe("openrouter");
      });

      it("returns spec for openai/gpt-4o-audio-preview", () => {
        const spec = getOpenRouterSpeechModelSpec("openai/gpt-4o-audio-preview");
        expect(spec).toBeDefined();
        expect(spec?.modelId).toBe("openai/gpt-4o-audio-preview");
      });

      it("returns spec for openai/gpt-audio-mini", () => {
        const spec = getOpenRouterSpeechModelSpec("openai/gpt-audio-mini");
        expect(spec).toBeDefined();
        expect(spec?.modelId).toBe("openai/gpt-audio-mini");
      });

      it("returns undefined for an unknown model", () => {
        const spec = getOpenRouterSpeechModelSpec("unknown-model");
        expect(spec).toBeUndefined();
      });

      it("returns undefined for an empty string", () => {
        const spec = getOpenRouterSpeechModelSpec("");
        expect(spec).toBeUndefined();
      });
    });

    describe("isOpenRouterSpeechModel", () => {
      it("returns true for known speech models", () => {
        expect(isOpenRouterSpeechModel("openai/gpt-4o-audio-preview")).toBe(true);
        expect(isOpenRouterSpeechModel("openai/gpt-audio")).toBe(true);
        expect(isOpenRouterSpeechModel("openai/gpt-audio-mini")).toBe(true);
      });

      it("returns false for non-speech models", () => {
        expect(isOpenRouterSpeechModel("openai/gpt-4o")).toBe(false);
        expect(isOpenRouterSpeechModel("openai/dall-e-3")).toBe(false);
        expect(isOpenRouterSpeechModel("anthropic/claude-3-5-sonnet")).toBe(false);
      });

      it("returns false for empty string", () => {
        expect(isOpenRouterSpeechModel("")).toBe(false);
      });

      it("returns false for partial model ID matches", () => {
        expect(isOpenRouterSpeechModel("gpt-audio")).toBe(false);
        expect(isOpenRouterSpeechModel("gpt-audio-mini")).toBe(false);
      });
    });

    describe("calculateOpenRouterSpeechCost", () => {
      it("calculates per-minute cost when estimatedMinutes is provided", () => {
        // openai/gpt-audio-mini has perMinute = 0.015
        // 2 minutes * $0.015/min = $0.030
        const cost = calculateOpenRouterSpeechCost("openai/gpt-audio-mini", 1500, 2);
        expect(cost).toBeDefined();
        expect(cost).toBeCloseTo(0.03);
      });

      it("calculates per-minute cost using character estimate when minutes not provided", () => {
        // 750 chars / 750 chars_per_min = 1 minute
        // openai/gpt-audio-mini: 1 minute * $0.015/min = $0.015
        const cost = calculateOpenRouterSpeechCost("openai/gpt-audio-mini", 750);
        expect(cost).toBeDefined();
        expect(cost).toBeCloseTo(0.015);
      });

      it("per-minute cost matches explicit minutes times rate", () => {
        const minutes = 3;
        const model = openrouterSpeechModels.find((m) => m.modelId === "openai/gpt-audio")!;
        const expectedCost = minutes * (model.pricing.perMinute ?? 0);
        const cost = calculateOpenRouterSpeechCost("openai/gpt-audio", 2250, minutes);
        expect(cost).toBeCloseTo(expectedCost);
      });

      it("gpt-audio costs more per minute than gpt-audio-mini", () => {
        const miniCost = calculateOpenRouterSpeechCost("openai/gpt-audio-mini", 750, 1);
        const fullCost = calculateOpenRouterSpeechCost("openai/gpt-audio", 750, 1);
        expect(miniCost).toBeDefined();
        expect(fullCost).toBeDefined();
        expect(fullCost!).toBeGreaterThan(miniCost!);
      });

      it("returns undefined for an unknown model", () => {
        const cost = calculateOpenRouterSpeechCost("unknown-model", 1000);
        expect(cost).toBeUndefined();
      });

      it("returns undefined for empty model ID", () => {
        const cost = calculateOpenRouterSpeechCost("", 1000);
        expect(cost).toBeUndefined();
      });

      // NOTE: The token-based pricing fallback branches (perInputToken only, and
      // perInputToken + perAudioOutputToken) exist in calculateOpenRouterSpeechCost
      // for future extensibility, but are not reachable with the current model catalog
      // because all OpenRouter speech models define perMinute pricing. Those branches
      // are covered by code review; no unit test can exercise them via the public API
      // without modifying the production model catalog (which is out of scope here).
    });
  });
});
