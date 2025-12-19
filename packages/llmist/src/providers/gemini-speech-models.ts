/**
 * Google Gemini Speech (TTS) Model Catalog
 *
 * Pricing as of December 2025 (per 1M tokens):
 *
 * Gemini 2.5 Flash Preview TTS:
 * - Input (text): $0.50
 * - Output (audio): $10.00
 *
 * Gemini 2.5 Pro Preview TTS:
 * - Input (text): $1.00
 * - Output (audio): $20.00
 *
 * @see https://ai.google.dev/gemini-api/docs/pricing
 * @see https://ai.google.dev/gemini-api/docs/speech-generation
 */

import type { AudioFormat, SpeechModelSpec } from "../core/media-types.js";

/**
 * Gemini TTS voices (30 prebuilt voices)
 * Each has distinct characteristics like "Bright", "Upbeat", "Breathy", "Warm", etc.
 */
export const GEMINI_TTS_VOICES = [
  "Zephyr", // Bright
  "Puck", // Upbeat
  "Charon", // Informative
  "Kore", // Firm
  "Fenrir", // Excitable
  "Leda", // Youthful
  "Orus", // Firm
  "Aoede", // Breezy
  "Callirrhoe", // Easy-going
  "Autonoe", // Bright
  "Enceladus", // Breathy
  "Iapetus", // Clear
  "Umbriel", // Easy-going
  "Algieba", // Smooth
  "Despina", // Smooth
  "Erinome", // Clear
  "Algenib", // Gravelly
  "Rasalgethi", // Informative
  "Laomedeia", // Upbeat
  "Achernar", // Soft
  "Alnilam", // Firm
  "Schedar", // Even
  "Gacrux", // Mature
  "Pulcherrima", // Forward
  "Achird", // Friendly
  "Zubenelgenubi", // Casual
  "Vindemiatrix", // Gentle
  "Sadachbia", // Lively
  "Sadaltager", // Knowledgeable
  "Sulafat", // Warm
] as const;

export type GeminiTTSVoice = (typeof GEMINI_TTS_VOICES)[number];

/** Gemini TTS supported audio format (PCM only, converted to WAV) */
export const GEMINI_TTS_FORMATS: AudioFormat[] = ["pcm", "wav"];

/**
 * Gemini Speech Model Specifications
 */
export const geminiSpeechModels: SpeechModelSpec[] = [
  {
    provider: "gemini",
    modelId: "gemini-2.5-flash-preview-tts",
    displayName: "Gemini 2.5 Flash TTS (Preview)",
    pricing: {
      // $0.50 per 1M input tokens = $0.0000005 per token
      perInputToken: 0.0000005,
      // $10.00 per 1M audio output tokens = $0.00001 per token
      perAudioOutputToken: 0.00001,
      // Rough estimate: ~$0.01 per minute of audio
      perMinute: 0.01,
    },
    voices: [...GEMINI_TTS_VOICES],
    formats: GEMINI_TTS_FORMATS,
    maxInputLength: 8000, // bytes (text + prompt combined)
    defaultVoice: "Zephyr",
    defaultFormat: "wav",
    features: {
      multiSpeaker: true,
      languages: 24,
      voiceInstructions: true,
    },
  },
  {
    provider: "gemini",
    modelId: "gemini-2.5-pro-preview-tts",
    displayName: "Gemini 2.5 Pro TTS (Preview)",
    pricing: {
      // $1.00 per 1M input tokens = $0.000001 per token
      perInputToken: 0.000001,
      // $20.00 per 1M audio output tokens = $0.00002 per token
      perAudioOutputToken: 0.00002,
      // Rough estimate: ~$0.02 per minute of audio
      perMinute: 0.02,
    },
    voices: [...GEMINI_TTS_VOICES],
    formats: GEMINI_TTS_FORMATS,
    maxInputLength: 8000, // bytes
    defaultVoice: "Zephyr",
    defaultFormat: "wav",
    features: {
      multiSpeaker: true,
      languages: 24,
      voiceInstructions: true,
    },
  },
];

/**
 * Get speech model spec by model ID.
 */
export function getGeminiSpeechModelSpec(modelId: string): SpeechModelSpec | undefined {
  return geminiSpeechModels.find((m) => m.modelId === modelId);
}

/**
 * Check if a model ID is a Gemini speech model.
 */
export function isGeminiSpeechModel(modelId: string): boolean {
  return geminiSpeechModels.some((m) => m.modelId === modelId);
}

/**
 * Calculate cost for speech generation.
 *
 * Uses per-minute approximation since exact token counts are hard to predict.
 *
 * @param modelId - The model ID
 * @param characterCount - Number of characters in the input
 * @param estimatedMinutes - Optional: estimated audio duration
 * @returns Cost in USD, or undefined if model not found
 */
export function calculateGeminiSpeechCost(
  modelId: string,
  characterCount: number,
  estimatedMinutes?: number,
): number | undefined {
  const spec = getGeminiSpeechModelSpec(modelId);
  if (!spec) return undefined;

  // Use per-minute approximation
  if (spec.pricing.perMinute !== undefined) {
    if (estimatedMinutes !== undefined) {
      return estimatedMinutes * spec.pricing.perMinute;
    }
    // Fallback: rough estimate based on ~150 words/min, ~5 chars/word
    // ~750 chars/min of audio
    const approxMinutes = characterCount / 750;
    return approxMinutes * spec.pricing.perMinute;
  }

  return undefined;
}
