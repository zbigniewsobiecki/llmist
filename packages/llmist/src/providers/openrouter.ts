/**
 * OpenRouter Provider Adapter
 *
 * Provides access to 400+ AI models from dozens of providers through
 * OpenRouter's unified API gateway.
 *
 * Environment variables:
 * - OPENROUTER_API_KEY (required) - Your OpenRouter API key
 * - OPENROUTER_SITE_URL (optional) - Your app URL for analytics
 * - OPENROUTER_APP_NAME (optional) - Your app name for analytics
 *
 * Model naming format: provider/model-name
 * Examples:
 * - anthropic/claude-sonnet-4-5
 * - openai/gpt-4o
 * - meta-llama/llama-3.3-70b-instruct
 *
 * @see https://openrouter.ai/docs
 */

import OpenAI from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import type { Stream } from "openai/streaming";
import type {
  SpeechGenerationOptions,
  SpeechGenerationResult,
  SpeechModelSpec,
} from "../core/media-types.js";
import type { LLMMessage } from "../core/messages.js";
import type { ModelSpec } from "../core/model-catalog.js";
import { getModelId } from "../core/model-shortcuts.js";
import type { LLMGenerationOptions, ModelDescriptor, ReasoningEffort } from "../core/options.js";
import { createLogger } from "../logging/logger.js";
import {
  type OpenAICompatibleConfig,
  OpenAICompatibleProvider,
} from "./openai-compatible-provider.js";
import { OPENROUTER_MODELS } from "./openrouter-models.js";
import {
  calculateOpenRouterSpeechCost,
  getOpenRouterSpeechModelSpec,
  isOpenRouterSpeechModel,
  openrouterSpeechModels,
} from "./openrouter-speech-models.js";
import { isNonEmpty, readEnvVar } from "./utils.js";

/** Logger for OpenRouter provider debugging */
const logger = createLogger({ name: "openrouter" });

/** Maps llmist reasoning effort levels to OpenRouter/OpenAI reasoning effort */
const OPENROUTER_EFFORT_MAP: Record<ReasoningEffort, string> = {
  none: "none",
  low: "low",
  medium: "medium",
  high: "high",
  maximum: "xhigh",
};

/**
 * Configuration for OpenRouter provider.
 */
export interface OpenRouterConfig extends OpenAICompatibleConfig {
  /**
   * Your app's URL for OpenRouter analytics dashboard.
   * Maps to HTTP-Referer header.
   */
  siteUrl?: string;

  /**
   * Your app's name shown in OpenRouter analytics.
   * Maps to X-Title header.
   */
  appName?: string;
}

/**
 * OpenRouter-specific routing options for model selection.
 * Pass these via the `extra` parameter in generation options.
 *
 * @example
 * ```typescript
 * agent.withExtra({
 *   routing: {
 *     models: ["anthropic/claude-sonnet-4-5", "openai/gpt-4o"],
 *     route: "cheapest",
 *   },
 * })
 * ```
 */
export interface OpenRouterRouting {
  /**
   * Ordered list of models to try as fallbacks.
   * If the first model fails or is unavailable, OpenRouter tries the next.
   */
  models?: string[];

  /**
   * Specific provider to route to for models available from multiple providers.
   */
  provider?: string;

  /**
   * Ordered list of providers to prefer.
   */
  order?: string[];

  /**
   * Routing preference for model selection.
   * - 'fastest': Route to the fastest available provider
   * - 'cheapest': Route to the cheapest provider
   * - 'quality': Route to the highest quality provider (default)
   */
  route?: "fastest" | "cheapest" | "quality";
}

export class OpenRouterProvider extends OpenAICompatibleProvider<OpenRouterConfig> {
  readonly providerId = "openrouter" as const;
  protected readonly providerAlias = "or";

  constructor(client: OpenAI, config: OpenRouterConfig = {}) {
    super(client, config);
  }

  getModelSpecs(): ModelSpec[] {
    return OPENROUTER_MODELS;
  }

  /**
   * Override buildApiRequest to inject reasoning parameters.
   * OpenRouter normalizes reasoning into the standard OpenAI format.
   */
  protected buildApiRequest(
    options: LLMGenerationOptions,
    descriptor: ModelDescriptor,
    spec: ModelSpec | undefined,
    messages: LLMMessage[],
  ): Parameters<OpenAI["chat"]["completions"]["create"]>[0] {
    const request = super.buildApiRequest(options, descriptor, spec, messages);

    // Inject reasoning parameter when reasoning is enabled
    if (options.reasoning?.enabled !== undefined) {
      const requestObj = request as unknown as Record<string, unknown>;
      requestObj.reasoning = {
        effort: OPENROUTER_EFFORT_MAP[options.reasoning.effort ?? "medium"],
      };
    }

    return request;
  }

  /**
   * Get custom headers for OpenRouter analytics.
   */
  protected getCustomHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    if (this.config.siteUrl) {
      headers["HTTP-Referer"] = this.config.siteUrl;
    }
    if (this.config.appName) {
      headers["X-Title"] = this.config.appName;
    }

    return headers;
  }

  /**
   * Build OpenRouter-specific request parameters from `extra.routing`.
   */
  protected buildProviderSpecificParams(
    extra: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    const routing = extra?.routing as OpenRouterRouting | undefined;
    if (!routing) {
      return {};
    }

    const params: Record<string, unknown> = {};

    // Model fallback chain
    if (routing.models && routing.models.length > 0) {
      params.models = routing.models;
    }

    // Routing preference
    if (routing.route) {
      params.route = routing.route;
    }

    // Provider routing
    if (routing.provider) {
      params.provider = { order: [routing.provider] };
    } else if (routing.order && routing.order.length > 0) {
      params.provider = { order: routing.order };
    }

    return params;
  }

  /**
   * Filter out the 'routing' key from extra passthrough.
   */
  protected isProviderSpecificKey(key: string): boolean {
    return key === "routing";
  }

  /**
   * Enhance error messages with OpenRouter-specific guidance.
   */
  protected enhanceError(error: unknown): Error {
    if (!(error instanceof Error)) {
      return new Error(String(error));
    }

    const message = error.message.toLowerCase();

    // 402: Insufficient credits
    if (message.includes("402") || message.includes("insufficient")) {
      return new Error(
        `OpenRouter: Insufficient credits. Add funds at https://openrouter.ai/credits\n` +
          `Original error: ${error.message}`,
      );
    }

    // 429: Rate limit exceeded
    if (message.includes("429") || message.includes("rate limit")) {
      return new Error(
        `OpenRouter: Rate limit exceeded. Consider upgrading your plan or reducing request frequency.\n` +
          `Original error: ${error.message}`,
      );
    }

    // 503: Model unavailable
    if (message.includes("503") || message.includes("unavailable")) {
      return new Error(
        `OpenRouter: Model temporarily unavailable. Try a different model or use the 'models' ` +
          `fallback option for automatic retry.\n` +
          `Original error: ${error.message}`,
      );
    }

    // 401: Authentication failed
    if (
      message.includes("401") ||
      message.includes("unauthorized") ||
      message.includes("invalid")
    ) {
      return new Error(
        `OpenRouter: Authentication failed. Check that OPENROUTER_API_KEY is set correctly.\n` +
          `Original error: ${error.message}`,
      );
    }

    return error;
  }

  // =========================================================================
  // Speech Generation (TTS via Chat Completions with Audio Modality)
  // =========================================================================

  /**
   * Get speech model specifications for OpenRouter.
   */
  getSpeechModelSpecs(): SpeechModelSpec[] {
    return openrouterSpeechModels;
  }

  /**
   * Check if this provider supports speech generation for a given model.
   * Handles both prefixed (openrouter:openai/gpt-audio-mini) and unprefixed model IDs.
   */
  supportsSpeechGeneration(modelId: string): boolean {
    // Strip provider prefix if present (e.g., "openrouter:openai/gpt-audio-mini" → "openai/gpt-audio-mini")
    const bareModelId = getModelId(modelId);
    return isOpenRouterSpeechModel(bareModelId);
  }

  /**
   * Generate speech audio from text using OpenRouter's audio-capable models.
   *
   * OpenRouter TTS works via chat completions with audio modality, not a
   * dedicated TTS endpoint. The model receives a prompt asking it to say
   * the text, and returns audio data via streaming.
   *
   * @param options - Speech generation options
   * @returns Promise resolving to the generation result with audio and cost
   * @throws Error if model is unknown, voice/format are invalid, or no audio is returned
   */
  async generateSpeech(options: SpeechGenerationOptions): Promise<SpeechGenerationResult> {
    const client = this.client as OpenAI;
    // Strip provider prefix if present (e.g., "openrouter:openai/gpt-audio-mini" → "openai/gpt-audio-mini")
    const bareModelId = getModelId(options.model);
    const spec = getOpenRouterSpeechModelSpec(bareModelId);

    if (!spec) {
      throw new Error(`Unknown OpenRouter TTS model: ${options.model}`);
    }

    const voice = options.voice ?? spec.defaultVoice ?? "alloy";
    if (!spec.voices.includes(voice)) {
      throw new Error(
        `Invalid voice "${voice}" for ${options.model}. Valid voices: ${spec.voices.join(", ")}`,
      );
    }

    const format = options.responseFormat ?? spec.defaultFormat ?? "mp3";
    if (!spec.formats.includes(format)) {
      throw new Error(
        `Invalid format "${format}" for ${options.model}. Valid formats: ${spec.formats.join(", ")}`,
      );
    }

    // OpenRouter TTS uses chat completions with audio modality
    // The response comes as streaming chunks with base64-encoded audio
    logger.debug("TTS request", {
      model: bareModelId,
      voice,
      format,
      inputLength: options.input.length,
    });

    try {
      const response = (await client.chat.completions.create({
        model: bareModelId,
        messages: [
          {
            role: "user",
            content: `Please say the following text exactly: "${options.input}"`,
          },
        ],
        // OpenRouter-specific parameters for audio output
        // Note: OpenRouter TTS via chat completions does NOT support the speed parameter
        // (unlike OpenAI's dedicated /audio/speech endpoint which does)
        modalities: ["text", "audio"],
        audio: {
          voice,
          format,
        },
        stream: true,
      } as Parameters<typeof client.chat.completions.create>[0])) as Stream<ChatCompletionChunk>;

      // Collect audio chunks from streaming response with runtime type validation
      const audioChunks: Buffer[] = [];

      for await (const chunk of response) {
        // Runtime type narrowing for streaming audio data
        const delta = chunk.choices[0]?.delta;
        if (!delta || typeof delta !== "object") continue;

        const audioObj = (delta as Record<string, unknown>).audio;
        if (!audioObj || typeof audioObj !== "object") continue;

        const audioData = (audioObj as Record<string, unknown>).data;
        if (typeof audioData !== "string" || audioData.length === 0) continue;

        // Validate and decode base64 audio data
        const decoded = Buffer.from(audioData, "base64");
        if (decoded.length === 0) {
          throw new Error("Invalid base64 audio data received from OpenRouter");
        }
        audioChunks.push(decoded);
      }

      // Concatenate all audio chunks and extract ArrayBuffer safely
      const audioBuffer = Buffer.concat(audioChunks);

      // Validate that we received audio data
      if (audioBuffer.length === 0) {
        throw new Error(
          "OpenRouter TTS returned no audio data. The model may have failed to generate audio or the stream was interrupted.",
        );
      }
      const cost = calculateOpenRouterSpeechCost(bareModelId, options.input.length);

      return {
        // Use Uint8Array for clean ArrayBuffer extraction (safer than buffer.slice for Node.js Buffer)
        audio: new Uint8Array(audioBuffer).buffer,
        model: options.model,
        usage: {
          characterCount: options.input.length,
        },
        cost,
        format,
      };
    } catch (error: unknown) {
      // Enhance error message with more context for debugging
      const err = error as Error & {
        status?: number;
        error?: { message?: string; code?: string; type?: string };
        response?: { data?: unknown };
        body?: unknown;
      };
      const apiError = err.error?.message || err.error?.code || "";
      const bodyInfo = err.body ? JSON.stringify(err.body) : "";
      const details = apiError || bodyInfo || err.message || "Unknown error";

      // Log detailed error for debugging (visible with LLMIST_LOG_LEVEL=debug)
      logger.debug("TTS error", {
        model: bareModelId,
        voice,
        format,
        status: err.status,
        error: err.error,
        body: err.body,
        message: err.message,
      });

      throw new Error(
        `OpenRouter TTS failed for model ${bareModelId}: ${details}` +
          (err.status ? ` (HTTP ${err.status})` : ""),
      );
    }
  }
}

/**
 * Create an OpenRouter provider from environment variables.
 *
 * Environment variables:
 * - OPENROUTER_API_KEY (required) - Your OpenRouter API key
 * - OPENROUTER_SITE_URL (optional) - Your app URL for analytics
 * - OPENROUTER_APP_NAME (optional) - Your app name for analytics
 *
 * @returns OpenRouterProvider instance or null if no API key is found
 *
 * @example
 * ```bash
 * # Basic usage
 * export OPENROUTER_API_KEY="sk-or-..."
 *
 * # With analytics tracking
 * export OPENROUTER_API_KEY="sk-or-..."
 * export OPENROUTER_SITE_URL="https://myapp.com"
 * export OPENROUTER_APP_NAME="MyApp"
 * ```
 */
export function createOpenRouterProviderFromEnv(): OpenRouterProvider | null {
  const apiKey = readEnvVar("OPENROUTER_API_KEY");

  if (!isNonEmpty(apiKey)) {
    return null;
  }

  const config: OpenRouterConfig = {
    siteUrl: readEnvVar("OPENROUTER_SITE_URL"),
    appName: readEnvVar("OPENROUTER_APP_NAME") || "llmist",
  };

  const client = new OpenAI({
    apiKey: apiKey.trim(),
    baseURL: "https://openrouter.ai/api/v1",
    timeout: 120_000, // 2 minute timeout
    maxRetries: 0, // Disable SDK retries - llmist handles all retries at application level
  });

  return new OpenRouterProvider(client, config);
}
