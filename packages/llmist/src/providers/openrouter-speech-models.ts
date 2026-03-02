/**
 * OpenRouter Speech (TTS) Model Catalog
 *
 * OpenRouter provides TTS through audio-capable models using chat completions
 * with the `modalities: ["text", "audio"]` parameter.
 *
 * Pricing as of March 2026:
 * - openai/gpt-audio: $2.50/M input, $10/M output, $32-64/M audio
 * - openai/gpt-audio-mini: $0.60/M input, $2.40/M output, $0.60/M audio
 *
 * @see https://openrouter.ai/docs/guides/overview/multimodal/audio
 */

import type { AudioFormat, SpeechModelSpec } from "../core/media-types.js";

/** OpenRouter TTS voices (same as OpenAI) */
export const OPENROUTER_TTS_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;

export type OpenRouterTTSVoice = (typeof OPENROUTER_TTS_VOICES)[number];

/**
 * OpenRouter supported audio formats for TTS via streaming.
 *
 * IMPORTANT: OpenRouter audio output requires streaming (stream: true),
 * and streaming only supports pcm16 format. Other formats like mp3, wav,
 * opus are NOT supported when streaming is enabled.
 *
 * If you need mp3/wav output, you must convert from pcm16 after receiving.
 */
export const OPENROUTER_TTS_FORMATS: AudioFormat[] = ["pcm16"];

/**
 * OpenRouter Speech Model Specifications
 *
 * Note: OpenRouter TTS works via chat completions with audio modality,
 * not a dedicated TTS endpoint like OpenAI's `/audio/speech`.
 */
export const openrouterSpeechModels: SpeechModelSpec[] = [
  {
    provider: "openrouter",
    modelId: "openai/gpt-4o-audio-preview",
    displayName: "GPT-4o Audio Preview (via OpenRouter)",
    pricing: {
      perInputToken: 0.0000025,
      perAudioOutputToken: 0.00001,
      perMinute: 0.06,
    },
    voices: [...OPENROUTER_TTS_VOICES],
    formats: OPENROUTER_TTS_FORMATS,
    maxInputLength: 128000,
    defaultVoice: "alloy",
    defaultFormat: "pcm16",
    features: {
      voiceInstructions: true,
    },
  },
  {
    provider: "openrouter",
    modelId: "openai/gpt-audio",
    displayName: "GPT Audio (via OpenRouter)",
    pricing: {
      // Token-based pricing with audio output
      perInputToken: 0.0000025, // $2.50 per 1M
      perAudioOutputToken: 0.000064, // ~$64 per 1M audio tokens
      // Approximate per-minute cost for estimation
      perMinute: 0.08,
    },
    voices: [...OPENROUTER_TTS_VOICES],
    formats: OPENROUTER_TTS_FORMATS,
    maxInputLength: 128000, // 128K context
    defaultVoice: "alloy",
    defaultFormat: "pcm16",
    features: {
      voiceInstructions: true,
    },
  },
  {
    provider: "openrouter",
    modelId: "openai/gpt-audio-mini",
    displayName: "GPT Audio Mini (via OpenRouter)",
    pricing: {
      // More affordable option
      perInputToken: 0.0000006, // $0.60 per 1M
      perAudioOutputToken: 0.0000006, // $0.60 per 1M audio tokens
      // Approximate per-minute cost for estimation
      perMinute: 0.015,
    },
    voices: [...OPENROUTER_TTS_VOICES],
    formats: OPENROUTER_TTS_FORMATS,
    maxInputLength: 128000, // 128K context
    defaultVoice: "alloy",
    defaultFormat: "pcm16",
    features: {
      voiceInstructions: true,
    },
  },
];

/**
 * Get speech model spec by model ID.
 */
export function getOpenRouterSpeechModelSpec(modelId: string): SpeechModelSpec | undefined {
  return openrouterSpeechModels.find((m) => m.modelId === modelId);
}

/**
 * Check if a model ID is an OpenRouter speech model.
 */
export function isOpenRouterSpeechModel(modelId: string): boolean {
  return openrouterSpeechModels.some((m) => m.modelId === modelId);
}

/**
 * Calculate cost for OpenRouter speech generation.
 *
 * Uses per-minute pricing when available, falling back to token-based
 * estimation when per-minute pricing is not defined.
 *
 * @param modelId - The model ID
 * @param characterCount - Number of characters in the input
 * @param estimatedMinutes - Optional: estimated audio duration (improves accuracy)
 * @returns Cost in USD, or undefined if model not found
 */
export function calculateOpenRouterSpeechCost(
  modelId: string,
  characterCount: number,
  estimatedMinutes?: number,
): number | undefined {
  const spec = getOpenRouterSpeechModelSpec(modelId);
  if (!spec) return undefined;

  // Primary: per-minute approximation (most accurate for TTS)
  if (spec.pricing.perMinute !== undefined) {
    // Estimate duration: ~150 words/min, ~5 chars/word = ~750 chars/min
    const minutes = estimatedMinutes ?? characterCount / 750;
    return minutes * spec.pricing.perMinute;
  }

  // Fallback: token-based calculation
  // Estimate ~4 characters per token for English text
  if (spec.pricing.perInputToken !== undefined) {
    const estimatedTokens = Math.ceil(characterCount / 4);
    const inputCost = estimatedTokens * spec.pricing.perInputToken;

    // If we have audio output token pricing and can estimate audio duration,
    // include that in the calculation
    if (spec.pricing.perAudioOutputToken !== undefined && estimatedMinutes !== undefined) {
      // Very rough estimate: ~100 audio tokens per second of speech
      const audioTokens = estimatedMinutes * 60 * 100;
      return inputCost + audioTokens * spec.pricing.perAudioOutputToken;
    }

    return inputCost;
  }

  return undefined;
}
