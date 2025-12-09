/**
 * OpenAI Speech (TTS) Model Catalog
 *
 * Pricing as of December 2025:
 * - tts-1: $15.00 per 1M characters
 * - tts-1-hd: $30.00 per 1M characters
 * - gpt-4o-mini-tts: $0.60/1M input tokens + $12/1M audio output tokens (~$0.015/min)
 *
 * @see https://platform.openai.com/docs/guides/text-to-speech
 */

import type { AudioFormat, SpeechModelSpec } from "../core/media-types.js";

/** OpenAI TTS voices for standard models (tts-1, tts-1-hd) */
export const OPENAI_TTS_VOICES = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
] as const;

/** Additional voices available in gpt-4o-mini-tts */
export const OPENAI_TTS_EXTENDED_VOICES = [
  ...OPENAI_TTS_VOICES,
  "ash",
  "ballad",
  "coral",
  "sage",
  "verse",
] as const;

export type OpenAITTSVoice = (typeof OPENAI_TTS_VOICES)[number];
export type OpenAITTSExtendedVoice = (typeof OPENAI_TTS_EXTENDED_VOICES)[number];

/** OpenAI supported audio formats */
export const OPENAI_TTS_FORMATS: AudioFormat[] = ["mp3", "opus", "aac", "flac", "wav", "pcm"];

/**
 * OpenAI Speech Model Specifications
 */
export const openaiSpeechModels: SpeechModelSpec[] = [
  // Standard TTS models (character-based pricing)
  {
    provider: "openai",
    modelId: "tts-1",
    displayName: "TTS-1",
    pricing: {
      // $15 per 1M characters = $0.000015 per character
      perCharacter: 0.000015,
    },
    voices: [...OPENAI_TTS_VOICES],
    formats: OPENAI_TTS_FORMATS,
    maxInputLength: 4096,
    defaultVoice: "alloy",
    defaultFormat: "mp3",
    features: {
      voiceInstructions: false,
    },
  },
  {
    provider: "openai",
    modelId: "tts-1-1106",
    displayName: "TTS-1 (Nov 2023)",
    pricing: {
      perCharacter: 0.000015,
    },
    voices: [...OPENAI_TTS_VOICES],
    formats: OPENAI_TTS_FORMATS,
    maxInputLength: 4096,
    defaultVoice: "alloy",
    defaultFormat: "mp3",
    features: {
      voiceInstructions: false,
    },
  },
  {
    provider: "openai",
    modelId: "tts-1-hd",
    displayName: "TTS-1 HD",
    pricing: {
      // $30 per 1M characters = $0.00003 per character
      perCharacter: 0.00003,
    },
    voices: [...OPENAI_TTS_VOICES],
    formats: OPENAI_TTS_FORMATS,
    maxInputLength: 4096,
    defaultVoice: "alloy",
    defaultFormat: "mp3",
    features: {
      voiceInstructions: false,
    },
  },
  {
    provider: "openai",
    modelId: "tts-1-hd-1106",
    displayName: "TTS-1 HD (Nov 2023)",
    pricing: {
      perCharacter: 0.00003,
    },
    voices: [...OPENAI_TTS_VOICES],
    formats: OPENAI_TTS_FORMATS,
    maxInputLength: 4096,
    defaultVoice: "alloy",
    defaultFormat: "mp3",
    features: {
      voiceInstructions: false,
    },
  },
  // Token-based TTS model with voice instructions support
  {
    provider: "openai",
    modelId: "gpt-4o-mini-tts",
    displayName: "GPT-4o Mini TTS",
    pricing: {
      // $0.60 per 1M input tokens = $0.0000006 per token
      perInputToken: 0.0000006,
      // $12 per 1M audio output tokens = $0.000012 per token
      perAudioOutputToken: 0.000012,
      // ~$0.015 per minute of audio
      perMinute: 0.015,
    },
    voices: [...OPENAI_TTS_EXTENDED_VOICES],
    formats: OPENAI_TTS_FORMATS,
    maxInputLength: 2000, // tokens, not characters
    defaultVoice: "alloy",
    defaultFormat: "mp3",
    features: {
      voiceInstructions: true,
    },
  },
];

/**
 * Get speech model spec by model ID.
 */
export function getOpenAISpeechModelSpec(modelId: string): SpeechModelSpec | undefined {
  return openaiSpeechModels.find((m) => m.modelId === modelId);
}

/**
 * Check if a model ID is an OpenAI speech model.
 */
export function isOpenAISpeechModel(modelId: string): boolean {
  return openaiSpeechModels.some((m) => m.modelId === modelId);
}

/**
 * Calculate cost for speech generation.
 *
 * For character-based models (tts-1, tts-1-hd): cost = characters * perCharacter
 * For token-based models (gpt-4o-mini-tts): uses perMinute approximation
 *
 * @param modelId - The model ID
 * @param characterCount - Number of characters in the input
 * @param estimatedMinutes - Optional: estimated audio duration for token-based models
 * @returns Cost in USD, or undefined if model not found
 */
export function calculateOpenAISpeechCost(
  modelId: string,
  characterCount: number,
  estimatedMinutes?: number,
): number | undefined {
  const spec = getOpenAISpeechModelSpec(modelId);
  if (!spec) return undefined;

  // Character-based pricing (tts-1, tts-1-hd)
  if (spec.pricing.perCharacter !== undefined) {
    return characterCount * spec.pricing.perCharacter;
  }

  // Token-based pricing (gpt-4o-mini-tts) - use per-minute approximation
  if (spec.pricing.perMinute !== undefined && estimatedMinutes !== undefined) {
    return estimatedMinutes * spec.pricing.perMinute;
  }

  // Fallback: rough estimate based on ~150 words/min, ~5 chars/word
  // ~750 chars/min of audio
  if (spec.pricing.perMinute !== undefined) {
    const approxMinutes = characterCount / 750;
    return approxMinutes * spec.pricing.perMinute;
  }

  return undefined;
}
