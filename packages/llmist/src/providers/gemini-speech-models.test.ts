import { describe, expect, it } from "vitest";
import {
  calculateGeminiSpeechCost,
  GEMINI_TTS_VOICES,
  geminiSpeechModels,
  getGeminiSpeechModelSpec,
  isGeminiSpeechModel,
} from "./gemini-speech-models.js";

describe("geminiSpeechModels", () => {
  it("exports an array of model specifications", () => {
    expect(Array.isArray(geminiSpeechModels)).toBe(true);
    expect(geminiSpeechModels.length).toBeGreaterThan(0);
  });

  describe("model specifications", () => {
    it.each(geminiSpeechModels)("$modelId has valid provider and modelId", (model) => {
      expect(model.provider).toBe("gemini");
      expect(typeof model.modelId).toBe("string");
      expect(model.modelId.length).toBeGreaterThan(0);
      expect(typeof model.displayName).toBe("string");
      expect(model.displayName.length).toBeGreaterThan(0);
    });

    it.each(geminiSpeechModels)("$modelId has valid pricing (non-negative)", (model) => {
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

    it.each(geminiSpeechModels)("$modelId has valid voices and formats", (model) => {
      expect(Array.isArray(model.voices)).toBe(true);
      expect(model.voices.length).toBeGreaterThan(0);
      expect(Array.isArray(model.formats)).toBe(true);
      expect(model.formats.length).toBeGreaterThan(0);
    });

    it.each(geminiSpeechModels)("$modelId has valid defaults and input constraints", (model) => {
      expect(typeof model.defaultVoice).toBe("string");
      expect(model.defaultVoice.length).toBeGreaterThan(0);
      expect(typeof model.defaultFormat).toBe("string");
      expect(model.defaultFormat.length).toBeGreaterThan(0);
      expect(model.maxInputLength).toBeGreaterThan(0);
    });

    it.each(geminiSpeechModels)("$modelId default voice is in voices list", (model) => {
      expect(model.voices).toContain(model.defaultVoice);
    });

    it.each(geminiSpeechModels)("$modelId default format is in formats list", (model) => {
      expect(model.formats).toContain(model.defaultFormat);
    });

    it.each(
      geminiSpeechModels,
    )("$modelId supports multi-speaker and voice instructions", (model) => {
      expect(model.features.multiSpeaker).toBe(true);
      expect(model.features.voiceInstructions).toBe(true);
    });
  });

  describe("voice constants", () => {
    it("GEMINI_TTS_VOICES contains 30 voices", () => {
      expect(GEMINI_TTS_VOICES.length).toBe(30);
    });

    it("GEMINI_TTS_VOICES includes expected voices", () => {
      expect(GEMINI_TTS_VOICES).toContain("Zephyr");
      expect(GEMINI_TTS_VOICES).toContain("Puck");
      expect(GEMINI_TTS_VOICES).toContain("Sulafat");
    });
  });

  describe("specific models", () => {
    it("includes gemini-2.5-flash-preview-tts", () => {
      const model = geminiSpeechModels.find((m) => m.modelId === "gemini-2.5-flash-preview-tts");
      expect(model).toBeDefined();
      expect(model?.provider).toBe("gemini");
      expect(model?.pricing.perInputToken).toBeDefined();
      expect(model?.pricing.perAudioOutputToken).toBeDefined();
    });

    it("includes gemini-2.5-pro-preview-tts", () => {
      const model = geminiSpeechModels.find((m) => m.modelId === "gemini-2.5-pro-preview-tts");
      expect(model).toBeDefined();
      expect(model?.provider).toBe("gemini");
      expect(model?.pricing.perInputToken).toBeDefined();
      expect(model?.pricing.perAudioOutputToken).toBeDefined();
    });

    it("pro model has higher pricing than flash model", () => {
      const flash = geminiSpeechModels.find((m) => m.modelId === "gemini-2.5-flash-preview-tts");
      const pro = geminiSpeechModels.find((m) => m.modelId === "gemini-2.5-pro-preview-tts");
      expect(flash).toBeDefined();
      expect(pro).toBeDefined();
      expect(pro?.pricing.perInputToken ?? 0).toBeGreaterThan(flash?.pricing.perInputToken ?? 0);
      expect(pro?.pricing.perAudioOutputToken ?? 0).toBeGreaterThan(
        flash?.pricing.perAudioOutputToken ?? 0,
      );
    });

    it("all models use Zephyr as default voice", () => {
      for (const model of geminiSpeechModels) {
        expect(model.defaultVoice).toBe("Zephyr");
      }
    });

    it("all models default to wav format", () => {
      for (const model of geminiSpeechModels) {
        expect(model.defaultFormat).toBe("wav");
      }
    });
  });

  describe("helper functions", () => {
    describe("getGeminiSpeechModelSpec", () => {
      it("returns spec for a known model", () => {
        const spec = getGeminiSpeechModelSpec("gemini-2.5-flash-preview-tts");
        expect(spec).toBeDefined();
        expect(spec?.modelId).toBe("gemini-2.5-flash-preview-tts");
      });

      it("returns undefined for an unknown model", () => {
        const spec = getGeminiSpeechModelSpec("unknown-model");
        expect(spec).toBeUndefined();
      });
    });

    describe("isGeminiSpeechModel", () => {
      it("returns true for known speech models", () => {
        expect(isGeminiSpeechModel("gemini-2.5-flash-preview-tts")).toBe(true);
        expect(isGeminiSpeechModel("gemini-2.5-pro-preview-tts")).toBe(true);
      });

      it("returns false for non-speech models", () => {
        expect(isGeminiSpeechModel("gemini-2.0-flash")).toBe(false);
        expect(isGeminiSpeechModel("imagen-4.0-generate-001")).toBe(false);
        expect(isGeminiSpeechModel("")).toBe(false);
      });
    });

    describe("calculateGeminiSpeechCost", () => {
      it("calculates cost for flash model using per-minute approximation", () => {
        const cost = calculateGeminiSpeechCost("gemini-2.5-flash-preview-tts", 750, 1);
        expect(cost).toBeDefined();
        expect(cost).toBeGreaterThan(0);
        // 1 minute * $0.01/min = $0.01
        expect(cost).toBeCloseTo(0.01);
      });

      it("calculates approximate cost when minutes not provided", () => {
        // 750 chars / 750 chars_per_min = 1 minute
        const cost = calculateGeminiSpeechCost("gemini-2.5-flash-preview-tts", 750);
        expect(cost).toBeDefined();
        expect(cost).toBeGreaterThan(0);
        expect(cost).toBeCloseTo(0.01);
      });

      it("pro model costs more than flash model for same input", () => {
        const flashCost = calculateGeminiSpeechCost("gemini-2.5-flash-preview-tts", 750, 1);
        const proCost = calculateGeminiSpeechCost("gemini-2.5-pro-preview-tts", 750, 1);
        expect(flashCost).toBeDefined();
        expect(proCost).toBeDefined();
        expect(proCost!).toBeGreaterThan(flashCost!);
      });

      it("returns undefined for an unknown model", () => {
        const cost = calculateGeminiSpeechCost("unknown-model", 750);
        expect(cost).toBeUndefined();
      });
    });
  });
});
