/**
 * Retry configuration for LLM API calls.
 *
 * Provides exponential backoff with jitter to handle transient failures
 * like rate limits (429), server errors (5xx), and connection issues.
 */

/**
 * Configuration options for retry behavior.
 *
 * @example
 * ```typescript
 * // Custom retry with monitoring
 * const agent = LLMist.createAgent()
 *   .withRetry({
 *     retries: 5,
 *     minTimeout: 2000,
 *     onRetry: (error, attempt) => console.log(`Retry ${attempt}`),
 *   })
 *   .ask("Hello");
 * ```
 */
export interface RetryConfig {
  /**
   * Whether retry is enabled.
   * @default true
   */
  enabled?: boolean;

  /**
   * Maximum number of retry attempts.
   * @default 3
   */
  retries?: number;

  /**
   * Minimum delay before the first retry in milliseconds.
   * @default 1000
   */
  minTimeout?: number;

  /**
   * Maximum delay between retries in milliseconds.
   * @default 30000
   */
  maxTimeout?: number;

  /**
   * Exponential factor for backoff calculation.
   * @default 2
   */
  factor?: number;

  /**
   * Whether to add random jitter to prevent thundering herd.
   * @default true
   */
  randomize?: boolean;

  /**
   * Called before each retry attempt.
   * Use for logging or metrics.
   */
  onRetry?: (error: Error, attempt: number) => void;

  /**
   * Called when all retries are exhausted and the operation fails.
   * The error will still be thrown after this callback.
   */
  onRetriesExhausted?: (error: Error, attempts: number) => void;

  /**
   * Custom function to determine if an error should trigger a retry.
   * If not provided, uses the default `isRetryableError` classification.
   *
   * @returns true to retry, false to fail immediately
   */
  shouldRetry?: (error: Error) => boolean;
}

/**
 * Resolved retry configuration with all defaults applied.
 */
export interface ResolvedRetryConfig {
  enabled: boolean;
  retries: number;
  minTimeout: number;
  maxTimeout: number;
  factor: number;
  randomize: boolean;
  onRetry?: (error: Error, attempt: number) => void;
  onRetriesExhausted?: (error: Error, attempts: number) => void;
  shouldRetry?: (error: Error) => boolean;
}

/**
 * Default retry configuration values.
 * Conservative defaults: 3 retries with up to 30s delay.
 */
export const DEFAULT_RETRY_CONFIG: Omit<
  ResolvedRetryConfig,
  "onRetry" | "onRetriesExhausted" | "shouldRetry"
> = {
  enabled: true,
  retries: 3,
  minTimeout: 1000,
  maxTimeout: 30000,
  factor: 2,
  randomize: true,
};

/**
 * Resolves a partial retry configuration by applying defaults.
 *
 * @param config - Partial configuration (optional)
 * @returns Fully resolved configuration with defaults applied
 */
export function resolveRetryConfig(config?: RetryConfig): ResolvedRetryConfig {
  if (!config) {
    return { ...DEFAULT_RETRY_CONFIG };
  }

  return {
    enabled: config.enabled ?? DEFAULT_RETRY_CONFIG.enabled,
    retries: config.retries ?? DEFAULT_RETRY_CONFIG.retries,
    minTimeout: config.minTimeout ?? DEFAULT_RETRY_CONFIG.minTimeout,
    maxTimeout: config.maxTimeout ?? DEFAULT_RETRY_CONFIG.maxTimeout,
    factor: config.factor ?? DEFAULT_RETRY_CONFIG.factor,
    randomize: config.randomize ?? DEFAULT_RETRY_CONFIG.randomize,
    onRetry: config.onRetry,
    onRetriesExhausted: config.onRetriesExhausted,
    shouldRetry: config.shouldRetry,
  };
}

/**
 * Determines if an error is retryable based on common LLM API error patterns.
 *
 * Retryable errors include:
 * - Rate limits (429)
 * - Server errors (500, 502, 503, 504)
 * - Timeouts and connection errors
 * - Provider-specific transient errors
 *
 * Non-retryable errors include:
 * - Authentication errors (401, 403)
 * - Bad request errors (400)
 * - Not found errors (404)
 * - Content policy violations
 *
 * @param error - The error to classify
 * @returns true if the error is retryable
 */
export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  const name = error.name;

  // Rate limits (429) - always retry
  if (message.includes("429") || message.includes("rate limit") || message.includes("rate_limit")) {
    return true;
  }

  // Server errors (5xx) - retry
  if (
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("internal server error") ||
    message.includes("bad gateway") ||
    message.includes("service unavailable") ||
    message.includes("gateway timeout")
  ) {
    return true;
  }

  // Timeouts - retry
  if (
    message.includes("timeout") ||
    message.includes("etimedout") ||
    message.includes("timed out")
  ) {
    return true;
  }

  // Connection errors - retry
  if (
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("connection") ||
    message.includes("network")
  ) {
    return true;
  }

  // Provider-specific error names (from Anthropic, OpenAI SDKs)
  if (
    name === "APIConnectionError" ||
    name === "RateLimitError" ||
    name === "InternalServerError" ||
    name === "ServiceUnavailableError" ||
    name === "APITimeoutError"
  ) {
    return true;
  }

  // Overloaded errors (common with Claude)
  if (message.includes("overloaded") || message.includes("capacity")) {
    return true;
  }

  // Don't retry authentication, bad requests, or content policy errors
  if (
    message.includes("401") ||
    message.includes("403") ||
    message.includes("400") ||
    message.includes("404") ||
    message.includes("authentication") ||
    message.includes("unauthorized") ||
    message.includes("forbidden") ||
    message.includes("invalid") ||
    message.includes("content policy") ||
    name === "AuthenticationError" ||
    name === "BadRequestError" ||
    name === "NotFoundError" ||
    name === "PermissionDeniedError"
  ) {
    return false;
  }

  // Default: don't retry unknown errors
  return false;
}
