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
import type { LLMMessage } from "../core/messages.js";
import type { ModelSpec } from "../core/model-catalog.js";
import type { LLMGenerationOptions, ModelDescriptor, ReasoningEffort } from "../core/options.js";
import {
  type OpenAICompatibleConfig,
  OpenAICompatibleProvider,
} from "./openai-compatible-provider.js";
import { OPENROUTER_MODELS } from "./openrouter-models.js";
import { isNonEmpty, readEnvVar } from "./utils.js";

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
