import type { LLMMessage } from "./messages.js";

// =============================================================================
// Reasoning / Thinking Types
// =============================================================================

/**
 * Provider-agnostic reasoning effort level.
 *
 * Maps to provider-specific values:
 * - **OpenAI**: "none"|"low"|"medium"|"high"|"xhigh"
 * - **Anthropic**: budget_tokens (1024–32768)
 * - **Gemini 3**: thinkingLevel "minimal"|"low"|"medium"|"high"
 * - **Gemini 2.5**: thinkingBudget (0–24576)
 * - **DeepSeek**: binary (enabled/disabled)
 */
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "maximum";

/**
 * Configuration for reasoning/thinking mode on supported models.
 *
 * When `enabled` is true, the provider will be instructed to use
 * extended reasoning before generating its response.
 */
export interface ReasoningConfig {
  /** Whether reasoning is enabled */
  enabled: boolean;
  /** Reasoning effort level (default: "medium") */
  effort?: ReasoningEffort;
  /** Explicit token budget for thinking (Anthropic/Gemini 2.5, overrides effort) */
  budgetTokens?: number;
  /** Whether to surface thinking content in the stream (default: true) */
  includeThinking?: boolean;
  /** Enable interleaved thinking for multi-turn tool use (Anthropic only) */
  interleaved?: boolean;
}

/**
 * A chunk of thinking/reasoning content from a reasoning model.
 *
 * Emitted during streaming when a reasoning model produces thinking output.
 * The `type` field distinguishes actual thinking from redacted content
 * (e.g., Anthropic may redact thinking in certain scenarios).
 */
export interface ThinkingChunk {
  /** The thinking text content */
  content: string;
  /** Whether this is actual thinking or redacted content */
  type: "thinking" | "redacted";
  /** Verification signature (Anthropic/Gemini) */
  signature?: string;
}

// =============================================================================
// Context Caching Types
// =============================================================================

/**
 * What content to include in the cache.
 *
 * - `"system"`: Cache only system prompt (lowest cost, highest reuse)
 * - `"conversation"`: Cache system prompt + all conversation turns except the latest user message
 */
export type CachingScope = "system" | "conversation";

/**
 * Configuration for context caching across providers.
 *
 * Context caching allows reusing previously computed key-value pairs across
 * requests, reducing latency and cost for repeated context.
 *
 * Provider behavior:
 * - **Anthropic**: Automatic ephemeral caching via `cache_control` markers (always-on by default).
 *   Use `enabled: false` to disable markers and opt out of caching.
 * - **Gemini**: Explicit cache lifecycle via `caches.create()`. Requires `scope` and `ttl`.
 * - **OpenAI**: Server-side automatic caching (no-op, but respects the unified API).
 */
export interface CachingConfig {
  /** Whether context caching is enabled */
  enabled: boolean;
  /**
   * What to cache (Gemini only, default: "conversation").
   * - `"system"`: Cache only system-derived messages
   * - `"conversation"`: Cache system + all turns except the latest user message
   */
  scope?: CachingScope;
  /** TTL for cache entries (Gemini only, format: "3600s", default: "3600s", min: "300s") */
  ttl?: string;
  /** Minimum token count for content to be eligible for caching (Gemini default: 32768) */
  minTokenThreshold?: number;
}

export interface LLMGenerationOptions {
  model: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  responseFormat?: "text";
  metadata?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  /**
   * Optional abort signal for cancelling the request mid-flight.
   *
   * When the signal is aborted, the provider will attempt to cancel
   * the underlying HTTP request and the stream will terminate with
   * an abort error. Use `isAbortError()` from `@/core/errors` to
   * detect cancellation in error handling.
   *
   * @example
   * ```typescript
   * const controller = new AbortController();
   *
   * const stream = client.stream({
   *   model: "claude-3-5-sonnet-20241022",
   *   messages: [{ role: "user", content: "Tell me a long story" }],
   *   signal: controller.signal,
   * });
   *
   * // Cancel after 5 seconds
   * setTimeout(() => controller.abort(), 5000);
   *
   * try {
   *   for await (const chunk of stream) {
   *     process.stdout.write(chunk.text);
   *   }
   * } catch (error) {
   *   if (isAbortError(error)) {
   *     console.log("\nRequest was cancelled");
   *   } else {
   *     throw error;
   *   }
   * }
   * ```
   */
  signal?: AbortSignal;
  /** Reasoning/thinking configuration for reasoning-capable models */
  reasoning?: ReasoningConfig;
  /** Context caching configuration for supported providers */
  caching?: CachingConfig;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Number of input tokens served from cache (subset of inputTokens) */
  cachedInputTokens?: number;
  /** Number of input tokens written to cache (subset of inputTokens, Anthropic only) */
  cacheCreationInputTokens?: number;
  /** Number of reasoning/thinking tokens used (subset of outputTokens) */
  reasoningTokens?: number;
}

export interface LLMStreamChunk {
  text: string;
  /**
   * Indicates that the provider has finished producing output and includes the reason if available.
   */
  finishReason?: string | null;
  /**
   * Token usage information, typically available in the final chunk when the stream completes.
   */
  usage?: TokenUsage;
  /**
   * Provider specific payload emitted at the same time as the text chunk. This is useful for debugging and tests.
   */
  rawEvent?: unknown;
  /** Thinking/reasoning content from reasoning models */
  thinking?: ThinkingChunk;
}

export interface LLMStream extends AsyncIterable<LLMStreamChunk> {}

export type ProviderIdentifier = string;

export interface ModelDescriptor {
  provider: string;
  name: string;
}

export class ModelIdentifierParser {
  constructor(private readonly defaultProvider: string = "openai") {}

  parse(identifier: string): ModelDescriptor {
    const trimmed = identifier.trim();
    if (!trimmed) {
      throw new Error("Model identifier cannot be empty");
    }

    const [maybeProvider, ...rest] = trimmed.split(":");
    if (rest.length === 0) {
      return { provider: this.defaultProvider, name: maybeProvider };
    }

    const provider = maybeProvider;
    const name = rest.join(":");
    if (!name) {
      throw new Error("Model name cannot be empty");
    }

    return { provider, name };
  }
}
