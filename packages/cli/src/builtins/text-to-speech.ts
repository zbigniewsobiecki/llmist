/**
 * TextToSpeech gadget - Generates speech audio from text.
 *
 * Uses OpenAI's TTS models to convert text to speech. Config-driven defaults
 * can be set via ~/.llmist/cli.toml [speech] section, and the LLM can override
 * any parameter when calling the gadget.
 *
 * Output is returned as media output via resultWithAudio(), which:
 * - Gets stored by MediaStore in ~/.llmist/tmp/media-{sessionId}/
 * - Displays file path in TUI
 * - Tracks cost automatically
 */

import { createGadget, getErrorMessage, resultWithAudio } from "llmist";
import { z } from "zod";

/** Available TTS voices */
const TTS_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
export type TTSVoice = (typeof TTS_VOICES)[number];

/** Available audio output formats (pcm16 required for OpenRouter TTS) */
const TTS_FORMATS = ["mp3", "opus", "aac", "flac", "wav", "pcm16"] as const;
export type TTSFormat = (typeof TTS_FORMATS)[number];

/**
 * Configuration options for TextToSpeech gadget.
 * These can be set in ~/.llmist/cli.toml under [speech].
 *
 * Note: This is intentionally separate from SpeechConfig in config.ts.
 * - SpeechConfig includes CLI-specific options (output, quiet)
 * - TextToSpeechConfig is gadget-specific (model, voice, format, speed)
 *
 * We use string types here since config comes from TOML files where we can't
 * constrain values at compile time. The Zod schema handles runtime validation.
 */
export interface TextToSpeechConfig {
  /** Default TTS model (tts-1, tts-1-hd) */
  model?: string;
  /** Default voice (alloy, echo, fable, onyx, nova, shimmer) */
  voice?: string;
  /** Default audio format (mp3, opus, aac, flac, wav, pcm16). Use pcm16 for OpenRouter. */
  format?: string;
  /** Default speed (0.25 - 4.0) */
  speed?: number;
}

/**
 * Factory function to create a TextToSpeech gadget with config-driven defaults.
 *
 * @param config - Optional configuration for default values
 * @returns A configured TextToSpeech gadget
 * @throws Error if config contains invalid voice, format, or speed values
 *
 * @example
 * ```typescript
 * // With defaults from config
 * const tts = createTextToSpeech({ model: "tts-1-hd", voice: "nova" });
 *
 * // Default configuration
 * const tts = createTextToSpeech();
 * ```
 */
export function createTextToSpeech(config?: TextToSpeechConfig) {
  // Validate config values at factory time (config from TOML files is not type-safe)
  if (config?.voice && !TTS_VOICES.includes(config.voice as TTSVoice)) {
    throw new Error(`Invalid TTS voice "${config.voice}". Valid voices: ${TTS_VOICES.join(", ")}`);
  }
  if (config?.format && !TTS_FORMATS.includes(config.format as TTSFormat)) {
    throw new Error(
      `Invalid TTS format "${config.format}". Valid formats: ${TTS_FORMATS.join(", ")}`,
    );
  }
  if (config?.speed !== undefined && (config.speed < 0.25 || config.speed > 4.0)) {
    throw new Error(`Invalid TTS speed "${config.speed}". Must be between 0.25 and 4.0`);
  }

  const defaultModel = config?.model ?? "tts-1";
  const defaultVoice = (config?.voice as TTSVoice) ?? "nova";
  const defaultFormat = (config?.format as TTSFormat) ?? "mp3";
  const defaultSpeed = config?.speed ?? 1.0;

  return createGadget({
    name: "TextToSpeech",
    description: `Convert text to speech audio. Uses configured TTS model. Defaults: ${defaultVoice} voice, ${defaultFormat} format.`,
    schema: z.object({
      text: z.string().min(1).describe("Text to convert to speech"),
      voice: z.enum(TTS_VOICES).optional().describe(`Voice to use (default: ${defaultVoice})`),
      format: z.enum(TTS_FORMATS).optional().describe(`Output format (default: ${defaultFormat})`),
      speed: z
        .number()
        .min(0.25)
        .max(4.0)
        .optional()
        .describe(`Speech speed 0.25-4.0 (default: ${defaultSpeed})`),
    }),
    examples: [
      {
        comment: "Generate speech with default settings",
        params: { text: "Hello, welcome to our application!" },
        output: "Generated audio (mp3, 35 chars, $0.000525)",
      },
      {
        comment: "Use a specific voice",
        params: {
          text: "This is an important announcement.",
          voice: "onyx",
        },
        output: "Generated audio (mp3, 35 chars, $0.001050)",
      },
      {
        comment: "Generate slower speech in WAV format",
        params: {
          text: "Please listen carefully to these instructions.",
          format: "wav",
          speed: 0.8,
        },
        output: "Generated audio (wav, 46 chars, $0.000690)",
      },
      {
        comment: "Result when cost is unavailable (some providers)",
        params: { text: "Hello there!" },
        output: "Generated audio (mp3, 12 chars, $N/A)",
      },
    ],
    execute: async ({ text, voice, format, speed }, ctx) => {
      // Require LLMist client context with speech capability
      if (!ctx?.llmist?.speech?.generate) {
        return "status=1\n\nerror: Speech generation requires LLMist client with speech capability.";
      }

      // Always use config model - LLM shouldn't choose TTS provider
      const selectedModel = defaultModel;
      const selectedVoice = voice ?? defaultVoice;
      const selectedFormat = format ?? defaultFormat;
      // Only include speed if explicitly set (not using default) - some providers don't support it
      const selectedSpeed = speed ?? (defaultSpeed !== 1.0 ? defaultSpeed : undefined);

      // Retry logic for transient API errors (e.g., HTTP 400/500 from OpenRouter)
      const maxRetries = 2;
      let lastError: unknown;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = await ctx.llmist.speech.generate({
            model: selectedModel,
            input: text,
            voice: selectedVoice,
            // Cast is safe: Zod validates LLM input, config values validated at factory time
            responseFormat: selectedFormat as TTSFormat,
            ...(selectedSpeed !== undefined ? { speed: selectedSpeed } : {}),
          });

          // Return as media result with audio data
          return resultWithAudio(
            `Generated audio (${result.format}, ${result.usage.characterCount} chars, $${result.cost?.toFixed(6) ?? "N/A"})`,
            Buffer.from(result.audio),
            {
              mimeType: `audio/${result.format}`,
              cost: result.cost,
              description: `TTS: "${text.slice(0, 50)}${text.length > 50 ? "..." : ""}"`,
            },
          );
        } catch (error) {
          lastError = error;
          // Only retry on potentially transient errors (HTTP 4xx/5xx)
          const errorMsg = getErrorMessage(error);
          const isRetryable = errorMsg.includes("HTTP 4") || errorMsg.includes("HTTP 5");
          if (!isRetryable || attempt === maxRetries) {
            break;
          }
          // Exponential backoff: 500ms, 1000ms
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }

      return `status=1\n\nerror: ${getErrorMessage(lastError)}`;
    },
  });
}

/**
 * Default TextToSpeech gadget instance with standard defaults.
 * Use createTextToSpeech() for custom configuration.
 */
export const textToSpeech = createTextToSpeech();
