import { describe, expect, it } from "vitest";
import {
  calculateOpenAISpeechCost,
  getOpenAISpeechModelSpec,
  isOpenAISpeechModel,
  OPENAI_TTS_EXTENDED_VOICES,
  OPENAI_TTS_VOICES,
  openaiSpeechModels,
} from "./openai-speech-models.js";

describe("openaiSpeechModels", () => {
  it("exports an array of model specifications", () => {
    expect(Array.isArray(openaiSpeechModels)).toBe(true);
    expect(openaiSpeechModels.length).toBeGreaterThan(0);
  });

  describe("model specifications", () => {
    it.each(openaiSpeechModels)("$modelId has valid provider and modelId", (model) => {
      expect(model.provider).toBe("openai");
      expect(typeof model.modelId).toBe("string");
      expect(model.modelId.length).toBeGreaterThan(0);
      expect(typeof model.displayName).toBe("string");
      expect(model.displayName.length).toBeGreaterThan(0);
    });

    it.each(openaiSpeechModels)("$modelId has valid pricing (non-negative)", (model) => {
      const { pricing } = model;

      if (pricing.perCharacter !== undefined) {
        expect(pricing.perCharacter).toBeGreaterThanOrEqual(0);
      }

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
        pricing.perCharacter !== undefined ||
        pricing.perInputToken !== undefined ||
        pricing.perMinute !== undefined;
      expect(hasPricing).toBe(true);
    });

    it.each(openaiSpeechModels)("$modelId has valid voices and formats", (model) => {
      expect(Array.isArray(model.voices)).toBe(true);
      expect(model.voices.length).toBeGreaterThan(0);
      expect(Array.isArray(model.formats)).toBe(true);
      expect(model.formats.length).toBeGreaterThan(0);
    });

    it.each(openaiSpeechModels)("$modelId has valid defaults and input constraints", (model) => {
      expect(typeof model.defaultVoice).toBe("string");
      expect(model.defaultVoice.length).toBeGreaterThan(0);
      expect(typeof model.defaultFormat).toBe("string");
      expect(model.defaultFormat.length).toBeGreaterThan(0);
      expect(model.maxInputLength).toBeGreaterThan(0);
    });

    it.each(openaiSpeechModels)("$modelId default voice is in voices list", (model) => {
      expect(model.voices).toContain(model.defaultVoice);
    });

    it.each(openaiSpeechModels)("$modelId default format is in formats list", (model) => {
      expect(model.formats).toContain(model.defaultFormat);
    });
  });

  describe("voice constants", () => {
    it("OPENAI_TTS_VOICES contains expected standard voices", () => {
      expect(OPENAI_TTS_VOICES).toContain("alloy");
      expect(OPENAI_TTS_VOICES).toContain("echo");
      expect(OPENAI_TTS_VOICES).toContain("fable");
      expect(OPENAI_TTS_VOICES).toContain("onyx");
      expect(OPENAI_TTS_VOICES).toContain("nova");
      expect(OPENAI_TTS_VOICES).toContain("shimmer");
    });

    it("OPENAI_TTS_EXTENDED_VOICES is a superset of OPENAI_TTS_VOICES", () => {
      for (const voice of OPENAI_TTS_VOICES) {
        expect(OPENAI_TTS_EXTENDED_VOICES).toContain(voice);
      }
      expect(OPENAI_TTS_EXTENDED_VOICES.length).toBeGreaterThan(OPENAI_TTS_VOICES.length);
    });
  });

  describe("specific models", () => {
    it("includes tts-1 with character-based pricing", () => {
      const model = openaiSpeechModels.find((m) => m.modelId === "tts-1");
      expect(model).toBeDefined();
      expect(model?.pricing.perCharacter).toBeDefined();
      expect(model?.pricing.perCharacter).toBeGreaterThan(0);
      expect(model?.features.voiceInstructions).toBe(false);
    });

    it("includes tts-1-hd with higher pricing than tts-1", () => {
      const tts1 = openaiSpeechModels.find((m) => m.modelId === "tts-1");
      const tts1hd = openaiSpeechModels.find((m) => m.modelId === "tts-1-hd");
      expect(tts1).toBeDefined();
      expect(tts1hd).toBeDefined();
      expect(tts1hd?.pricing.perCharacter).toBeGreaterThan(tts1?.pricing.perCharacter ?? 0);
    });

    it("includes gpt-4o-mini-tts with token-based pricing and voice instructions", () => {
      const model = openaiSpeechModels.find((m) => m.modelId === "gpt-4o-mini-tts");
      expect(model).toBeDefined();
      expect(model?.pricing.perInputToken).toBeDefined();
      expect(model?.pricing.perAudioOutputToken).toBeDefined();
      expect(model?.features.voiceInstructions).toBe(true);
    });

    it("gpt-4o-mini-tts uses extended voices", () => {
      const model = openaiSpeechModels.find((m) => m.modelId === "gpt-4o-mini-tts");
      expect(model).toBeDefined();
      // Extended voices include additional ones beyond the standard set
      for (const voice of OPENAI_TTS_EXTENDED_VOICES) {
        expect(model?.voices).toContain(voice);
      }
    });
  });

  describe("helper functions", () => {
    describe("getOpenAISpeechModelSpec", () => {
      it("returns spec for a known model", () => {
        const spec = getOpenAISpeechModelSpec("tts-1");
        expect(spec).toBeDefined();
        expect(spec?.modelId).toBe("tts-1");
      });

      it("returns undefined for an unknown model", () => {
        const spec = getOpenAISpeechModelSpec("unknown-model");
        expect(spec).toBeUndefined();
      });
    });

    describe("isOpenAISpeechModel", () => {
      it("returns true for known speech models", () => {
        expect(isOpenAISpeechModel("tts-1")).toBe(true);
        expect(isOpenAISpeechModel("tts-1-hd")).toBe(true);
        expect(isOpenAISpeechModel("gpt-4o-mini-tts")).toBe(true);
      });

      it("returns false for non-speech models", () => {
        expect(isOpenAISpeechModel("gpt-4o")).toBe(false);
        expect(isOpenAISpeechModel("dall-e-3")).toBe(false);
        expect(isOpenAISpeechModel("")).toBe(false);
      });
    });

    describe("calculateOpenAISpeechCost", () => {
      it("calculates character-based cost for tts-1", () => {
        const cost = calculateOpenAISpeechCost("tts-1", 1000);
        expect(cost).toBeDefined();
        expect(cost).toBeGreaterThan(0);
        // 1000 chars * $0.000015/char = $0.015
        expect(cost).toBeCloseTo(0.015);
      });

      it("calculates cost for tts-1-hd at double the rate of tts-1", () => {
        const costTts1 = calculateOpenAISpeechCost("tts-1", 1000);
        const costTts1hd = calculateOpenAISpeechCost("tts-1-hd", 1000);
        expect(costTts1).toBeDefined();
        expect(costTts1hd).toBeDefined();
        expect(costTts1hd!).toBeCloseTo(costTts1! * 2);
      });

      it("calculates minute-based cost for gpt-4o-mini-tts when minutes provided", () => {
        const cost = calculateOpenAISpeechCost("gpt-4o-mini-tts", 750, 1);
        expect(cost).toBeDefined();
        expect(cost).toBeGreaterThan(0);
        // 1 minute * $0.015/min = $0.015
        expect(cost).toBeCloseTo(0.015);
      });

      it("returns undefined for an unknown model", () => {
        const cost = calculateOpenAISpeechCost("unknown-model", 1000);
        expect(cost).toBeUndefined();
      });
    });
  });
});
