/**
 * Hugging Face Provider Adapter
 *
 * Supports both serverless inference (router.huggingface.co) and
 * dedicated inference endpoints. Uses OpenAI SDK for API compatibility
 * since HF APIs follow OpenAI's chat completions format.
 *
 * Environment variables:
 * - HF_TOKEN (primary) or HUGGING_FACE_API_KEY (fallback)
 * - HF_ENDPOINT_URL (optional) - for dedicated endpoints
 *
 * Provider selection syntax (serverless only):
 * - model:fastest - route to fastest available provider
 * - model:cheapest - route to cheapest provider
 * - model:sambanova, model:groq, etc. - route to specific provider
 */

import OpenAI from "openai";
import type { LLMMessage } from "../core/messages.js";
import type { ModelSpec } from "../core/model-catalog.js";
import type { LLMGenerationOptions, ModelDescriptor } from "../core/options.js";
import { HUGGINGFACE_MODELS } from "./huggingface-models.js";
import {
  type OpenAICompatibleConfig,
  OpenAICompatibleProvider,
} from "./openai-compatible-provider.js";
import { isNonEmpty, readEnvVar } from "./utils.js";

/**
 * Configuration for HuggingFace provider.
 */
export interface HuggingFaceConfig extends OpenAICompatibleConfig {
  /**
   * Endpoint type for HuggingFace inference.
   * - 'serverless': Use HF serverless inference (default)
   * - 'dedicated': Use dedicated inference endpoint
   */
  endpointType?: "serverless" | "dedicated";
}

export class HuggingFaceProvider extends OpenAICompatibleProvider<HuggingFaceConfig> {
  readonly providerId = "huggingface" as const;
  protected readonly providerAlias = "hf";

  constructor(client: OpenAI, config: HuggingFaceConfig = {}) {
    super(client, { endpointType: "serverless", ...config });
  }

  getModelSpecs(): ModelSpec[] {
    return HUGGINGFACE_MODELS;
  }

  /**
   * Override buildApiRequest to inject DeepSeek-specific thinking parameters.
   * DeepSeek models use `extra_body: { thinking: { type: "enabled" } }` for reasoning.
   */
  protected buildApiRequest(
    options: LLMGenerationOptions,
    descriptor: ModelDescriptor,
    spec: ModelSpec | undefined,
    messages: LLMMessage[],
  ): Parameters<OpenAI["chat"]["completions"]["create"]>[0] {
    const request = super.buildApiRequest(options, descriptor, spec, messages);

    // Inject DeepSeek thinking mode when reasoning is enabled for DeepSeek models
    if (options.reasoning?.enabled && descriptor.name.toLowerCase().includes("deepseek")) {
      const requestObj = request as unknown as Record<string, unknown>;
      requestObj.extra_body = {
        ...(requestObj.extra_body as Record<string, unknown> | undefined),
        thinking: { type: "enabled" },
      };
    }

    return request;
  }

  /**
   * Enhance error messages with HuggingFace-specific guidance.
   */
  protected enhanceError(error: unknown): Error {
    if (!(error instanceof Error)) {
      return new Error(String(error));
    }

    const message = error.message.toLowerCase();

    // Rate limit exceeded
    if (message.includes("rate limit") || message.includes("429")) {
      return new Error(
        `HF rate limit exceeded. Free tier has limits. Consider upgrading or using a dedicated endpoint.\n` +
          `Original error: ${error.message}`,
      );
    }

    // Model not found
    if (message.includes("model not found") || message.includes("404")) {
      return new Error(
        `Model not available on HF ${this.config.endpointType} inference. ` +
          `Check model name or try a different endpoint type.\n` +
          `Original error: ${error.message}`,
      );
    }

    // Authentication failed
    if (message.includes("401") || message.includes("unauthorized")) {
      return new Error(
        `HF authentication failed. Check that HF_TOKEN or HUGGING_FACE_API_KEY ` +
          `is set correctly and starts with 'hf_'.\n` +
          `Original error: ${error.message}`,
      );
    }

    // HF serverless inference often returns 400 for transient capacity/loading issues
    // Wrap these to make them identifiable and allow retry logic to treat them as rate limits
    if (message.includes("400") || message.includes("bad request")) {
      return new Error(
        `HF bad request (often transient on serverless). ` + `Original error: ${error.message}`,
      );
    }

    return error;
  }
}

/**
 * Create a Hugging Face provider from environment variables.
 *
 * Environment variables:
 * - HF_TOKEN (primary) or HUGGING_FACE_API_KEY (fallback) - Required for authentication
 * - HF_ENDPOINT_URL (optional) - Custom endpoint URL for dedicated deployments
 *
 * @returns HuggingFaceProvider instance or null if no API key is found
 *
 * @example
 * ```bash
 * # Serverless inference (default)
 * export HF_TOKEN="hf_..."
 *
 * # Dedicated endpoint
 * export HF_TOKEN="hf_..."
 * export HF_ENDPOINT_URL="https://xxx.endpoints.huggingface.cloud"
 * ```
 */
export function createHuggingFaceProviderFromEnv(): HuggingFaceProvider | null {
  // Try HF_TOKEN first (official HF environment variable), then fallback to HUGGING_FACE_API_KEY
  const token = readEnvVar("HF_TOKEN") || readEnvVar("HUGGING_FACE_API_KEY");

  if (!isNonEmpty(token)) {
    return null;
  }

  // Validate token format (HF tokens should start with "hf_")
  if (!token.startsWith("hf_")) {
    console.warn(
      "Warning: HF token should start with 'hf_'. Authentication may fail if token format is incorrect.",
    );
  }

  // Check for custom endpoint URL (for dedicated deployments)
  const endpointUrl = readEnvVar("HF_ENDPOINT_URL");
  const baseURL = endpointUrl || "https://router.huggingface.co/v1";
  const endpointType = endpointUrl ? "dedicated" : "serverless";

  const config: HuggingFaceConfig = {
    endpointType,
  };

  // Create OpenAI SDK client with HF base URL
  const client = new OpenAI({
    apiKey: token.trim(),
    baseURL,
    timeout: 60_000, // 60s timeout - HF free tier can be slower than OpenAI
    maxRetries: 0, // Disable SDK retries - llmist handles all retries at application level
  });

  return new HuggingFaceProvider(client, config);
}
