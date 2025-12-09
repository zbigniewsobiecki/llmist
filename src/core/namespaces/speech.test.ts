/**
 * Tests for SpeechNamespace
 *
 * Verifies speech generation routing to providers and model listing.
 */

import { describe, expect, it, mock } from "bun:test";
import type { SpeechGenerationOptions, SpeechGenerationResult, SpeechModelSpec } from "../media-types.js";
import type { ProviderAdapter } from "../../providers/provider.js";
import { SpeechNamespace } from "./speech.js";

/**
 * Creates a mock provider adapter for testing.
 */
function createMockAdapter(opts: {
  providerId: string;
  supportsSpeech?: boolean;
  speechModels?: SpeechModelSpec[];
  generateSpeechResult?: SpeechGenerationResult;
}): ProviderAdapter {
  const { providerId, supportsSpeech = false, speechModels = [], generateSpeechResult } = opts;

  return {
    providerId,
    supports: () => false,
    stream: () => (async function* () {})(),
    supportsSpeechGeneration: supportsSpeech ? (modelId: string) => speechModels.some(m => m.modelId === modelId) : undefined,
    getSpeechModelSpecs: speechModels.length > 0 ? () => speechModels : undefined,
    generateSpeech: supportsSpeech
      ? mock(async (_options: SpeechGenerationOptions): Promise<SpeechGenerationResult> => {
          return generateSpeechResult ?? {
            audio: new ArrayBuffer(1000),
            model: _options.model,
            usage: { characterCount: _options.input.length },
            cost: _options.input.length * 0.000015,
            format: "mp3",
          };
        })
      : undefined,
  };
}

const mockSpeechSpec: SpeechModelSpec = {
  provider: "test",
  modelId: "test-tts",
  displayName: "Test TTS Model",
  pricing: { perCharacter: 0.000015 },
  voices: ["voice1", "voice2", "voice3"],
  formats: ["mp3", "wav", "opus"],
  maxInputLength: 4096,
  defaultVoice: "voice1",
  defaultFormat: "mp3",
};

describe("SpeechNamespace", () => {
  describe("generate()", () => {
    it("routes generation to the correct provider", async () => {
      const adapter = createMockAdapter({
        providerId: "test",
        supportsSpeech: true,
        speechModels: [mockSpeechSpec],
      });
      const namespace = new SpeechNamespace([adapter], "test");

      const result = await namespace.generate({
        model: "test-tts",
        input: "Hello, world!",
        voice: "voice1",
      });

      expect(result.audio).toBeInstanceOf(ArrayBuffer);
      expect(result.usage.characterCount).toBe(13);
      expect(result.cost).toBeCloseTo(13 * 0.000015, 8);
      expect(adapter.generateSpeech).toHaveBeenCalledTimes(1);
    });

    it("passes all options to the provider", async () => {
      const adapter = createMockAdapter({
        providerId: "test",
        supportsSpeech: true,
        speechModels: [mockSpeechSpec],
      });
      const namespace = new SpeechNamespace([adapter], "test");

      await namespace.generate({
        model: "test-tts",
        input: "Test message",
        voice: "voice2",
        responseFormat: "opus",
        speed: 1.5,
      });

      expect(adapter.generateSpeech).toHaveBeenCalledWith({
        model: "test-tts",
        input: "Test message",
        voice: "voice2",
        responseFormat: "opus",
        speed: 1.5,
      });
    });

    it("throws error when no provider supports the model", async () => {
      const adapter = createMockAdapter({
        providerId: "test",
        supportsSpeech: false,
      });
      const namespace = new SpeechNamespace([adapter], "test");

      await expect(namespace.generate({
        model: "unknown-model",
        input: "Test",
        voice: "any",
      })).rejects.toThrow(/No provider supports speech generation for model "unknown-model"/);
    });

    it("selects correct provider when multiple are available", async () => {
      const adapter1 = createMockAdapter({
        providerId: "provider1",
        supportsSpeech: true,
        speechModels: [{ ...mockSpeechSpec, modelId: "model-a" }],
      });
      const adapter2 = createMockAdapter({
        providerId: "provider2",
        supportsSpeech: true,
        speechModels: [{ ...mockSpeechSpec, modelId: "model-b" }],
      });
      const namespace = new SpeechNamespace([adapter1, adapter2], "provider1");

      await namespace.generate({ model: "model-b", input: "Test", voice: "voice1" });

      expect(adapter1.generateSpeech).not.toHaveBeenCalled();
      expect(adapter2.generateSpeech).toHaveBeenCalledTimes(1);
    });

    it("returns correct format in result", async () => {
      const adapter = createMockAdapter({
        providerId: "test",
        supportsSpeech: true,
        speechModels: [mockSpeechSpec],
        generateSpeechResult: {
          audio: new ArrayBuffer(500),
          model: "test-tts",
          usage: { characterCount: 10 },
          cost: 0.00015,
          format: "wav",
        },
      });
      const namespace = new SpeechNamespace([adapter], "test");

      const result = await namespace.generate({
        model: "test-tts",
        input: "Short text",
        voice: "voice1",
        responseFormat: "wav",
      });

      expect(result.format).toBe("wav");
    });

    it("calculates cost based on character count", async () => {
      const adapter = createMockAdapter({
        providerId: "test",
        supportsSpeech: true,
        speechModels: [mockSpeechSpec],
      });
      const namespace = new SpeechNamespace([adapter], "test");

      const result = await namespace.generate({
        model: "test-tts",
        input: "A".repeat(1000), // 1000 characters
        voice: "voice1",
      });

      // Cost should be 1000 * $0.000015 = $0.015
      expect(result.usage.characterCount).toBe(1000);
      expect(result.cost).toBeCloseTo(0.015, 8);
    });
  });

  describe("listModels()", () => {
    it("returns empty array when no adapters have speech models", () => {
      const adapter = createMockAdapter({ providerId: "test" });
      const namespace = new SpeechNamespace([adapter], "test");

      expect(namespace.listModels()).toEqual([]);
    });

    it("returns all speech models from all providers", () => {
      const spec1: SpeechModelSpec = { ...mockSpeechSpec, modelId: "tts-1" };
      const spec2: SpeechModelSpec = { ...mockSpeechSpec, modelId: "tts-2" };
      const spec3: SpeechModelSpec = { ...mockSpeechSpec, modelId: "tts-hd" };

      const adapter1 = createMockAdapter({
        providerId: "p1",
        supportsSpeech: true,
        speechModels: [spec1, spec2],
      });
      const adapter2 = createMockAdapter({
        providerId: "p2",
        supportsSpeech: true,
        speechModels: [spec3],
      });
      const namespace = new SpeechNamespace([adapter1, adapter2], "p1");

      const models = namespace.listModels();

      expect(models).toHaveLength(3);
      expect(models.map(m => m.modelId)).toEqual(["tts-1", "tts-2", "tts-hd"]);
    });

    it("includes voice information in model specs", () => {
      const adapter = createMockAdapter({
        providerId: "test",
        supportsSpeech: true,
        speechModels: [mockSpeechSpec],
      });
      const namespace = new SpeechNamespace([adapter], "test");

      const models = namespace.listModels();

      expect(models[0].voices).toEqual(["voice1", "voice2", "voice3"]);
    });
  });

  describe("supportsModel()", () => {
    it("returns true when a provider supports the model", () => {
      const adapter = createMockAdapter({
        providerId: "test",
        supportsSpeech: true,
        speechModels: [mockSpeechSpec],
      });
      const namespace = new SpeechNamespace([adapter], "test");

      expect(namespace.supportsModel("test-tts")).toBe(true);
    });

    it("returns false when no provider supports the model", () => {
      const adapter = createMockAdapter({
        providerId: "test",
        supportsSpeech: true,
        speechModels: [mockSpeechSpec],
      });
      const namespace = new SpeechNamespace([adapter], "test");

      expect(namespace.supportsModel("unknown-model")).toBe(false);
    });

    it("returns false when no adapters support speech generation", () => {
      const adapter = createMockAdapter({ providerId: "test" });
      const namespace = new SpeechNamespace([adapter], "test");

      expect(namespace.supportsModel("any-model")).toBe(false);
    });
  });
});
