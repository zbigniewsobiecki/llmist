/**
 * Proactive rate limiting for LLM API calls.
 *
 * Tracks request and token usage in sliding windows to prevent rate limit errors
 * before they occur. Works in conjunction with reactive backoff (retry.ts) for
 * comprehensive rate limit handling.
 */

/**
 * Configuration for proactive rate limiting.
 *
 * Set these values based on your API tier to prevent rate limit errors.
 * When limits are approached, requests will be automatically delayed.
 *
 * @example
 * ```typescript
 * // Gemini free tier limits
 * const agent = LLMist.createAgent()
 *   .withRateLimits({
 *     requestsPerMinute: 15,
 *     tokensPerMinute: 1_000_000,
 *     safetyMargin: 0.8,
 *   });
 *
 * // OpenAI Tier 1 limits
 * const agent = LLMist.createAgent()
 *   .withRateLimits({
 *     requestsPerMinute: 500,
 *     tokensPerMinute: 200_000,
 *   });
 * ```
 */
export interface RateLimitConfig {
  /**
   * Maximum requests per minute.
   * Set based on your API tier. If not set, RPM limiting is disabled.
   */
  requestsPerMinute?: number;

  /**
   * Maximum tokens per minute (input + output combined).
   * Set based on your API tier. If not set, TPM limiting is disabled.
   */
  tokensPerMinute?: number;

  /**
   * Maximum tokens per day (optional).
   * Useful for Gemini free tier which has daily limits.
   * If not set, daily limiting is disabled.
   */
  tokensPerDay?: number;

  /**
   * Safety margin - start throttling at this percentage of limit.
   * A value of 0.9 means throttling starts at 90% of the limit.
   * Lower values provide more safety but may reduce throughput.
   * @default 0.9
   */
  safetyMargin?: number;

  /**
   * Whether proactive rate limiting is enabled.
   * @default true (when any limit is configured)
   */
  enabled?: boolean;
}

/**
 * Resolved rate limit configuration with all defaults applied.
 */
export interface ResolvedRateLimitConfig {
  requestsPerMinute?: number;
  tokensPerMinute?: number;
  tokensPerDay?: number;
  safetyMargin: number;
  enabled: boolean;
}

/**
 * Default rate limit configuration values.
 */
export const DEFAULT_RATE_LIMIT_CONFIG: Pick<ResolvedRateLimitConfig, "safetyMargin" | "enabled"> =
  {
    safetyMargin: 0.9,
    enabled: true,
  };

/**
 * Resolves a partial rate limit configuration by applying defaults.
 *
 * @param config - Partial configuration (optional)
 * @returns Fully resolved configuration
 */
export function resolveRateLimitConfig(config?: RateLimitConfig): ResolvedRateLimitConfig {
  if (!config) {
    return { safetyMargin: DEFAULT_RATE_LIMIT_CONFIG.safetyMargin, enabled: false };
  }

  const hasLimits =
    config.requestsPerMinute !== undefined ||
    config.tokensPerMinute !== undefined ||
    config.tokensPerDay !== undefined;

  return {
    requestsPerMinute: config.requestsPerMinute,
    tokensPerMinute: config.tokensPerMinute,
    tokensPerDay: config.tokensPerDay,
    safetyMargin: config.safetyMargin ?? DEFAULT_RATE_LIMIT_CONFIG.safetyMargin,
    enabled: config.enabled ?? (hasLimits && DEFAULT_RATE_LIMIT_CONFIG.enabled),
  };
}

/**
 * Information about a triggered rate limit.
 */
export interface TriggeredLimitInfo {
  /** Current usage value */
  current: number;
  /** Configured limit value */
  limit: number;
  /** Effective limit after safety margin (limit × safetyMargin) */
  effectiveLimit: number;
}

/**
 * Usage statistics from the rate limit tracker.
 */
export interface RateLimitStats {
  /** Current requests per minute */
  rpm: number;
  /** Current tokens per minute */
  tpm: number;
  /** Tokens used today (UTC) */
  dailyTokens: number;
  /** Whether any limit is currently being approached */
  isApproachingLimit: boolean;
  /** Delay required before next request (0 if none) */
  requiredDelayMs: number;
  /** Which limit(s) triggered throttling, if any (present when requiredDelayMs > 0) */
  triggeredBy?: {
    rpm?: TriggeredLimitInfo;
    tpm?: TriggeredLimitInfo;
    daily?: TriggeredLimitInfo;
  };
}

/**
 * Token usage entry for sliding window tracking.
 */
interface TokenUsageEntry {
  timestamp: number;
  tokens: number;
}

/**
 * Tracks API usage and calculates required delays for proactive rate limiting.
 *
 * Uses sliding windows to track requests and token usage, automatically
 * calculating delays needed to stay within configured limits.
 *
 * @example
 * ```typescript
 * const tracker = new RateLimitTracker({
 *   requestsPerMinute: 60,
 *   tokensPerMinute: 100000,
 * });
 *
 * // Before each request
 * const delay = tracker.getRequiredDelayMs();
 * if (delay > 0) {
 *   await sleep(delay);
 * }
 *
 * // After each request
 * tracker.recordUsage(inputTokens, outputTokens);
 * ```
 */
export class RateLimitTracker {
  private config: ResolvedRateLimitConfig;

  /** Timestamps of requests in the current minute window */
  private requestTimestamps: number[] = [];

  /** Token usage entries in the current minute window */
  private tokenUsage: TokenUsageEntry[] = [];

  /** Daily token count */
  private dailyTokens = 0;

  /** Date string (YYYY-MM-DD UTC) for daily reset tracking */
  private dailyResetDate: string;

  /** Count of pending reservations (for backward compatibility) */
  private pendingReservations = 0;

  constructor(config?: RateLimitConfig) {
    this.config = resolveRateLimitConfig(config);
    this.dailyResetDate = this.getCurrentDateUTC();
  }

  /**
   * Record a completed request with its token usage.
   *
   * If reserveRequest() was called before the LLM call (recommended for concurrent
   * scenarios), the request timestamp was already recorded. Otherwise, this method
   * will add it for backward compatibility.
   *
   * @param inputTokens - Number of input tokens used
   * @param outputTokens - Number of output tokens generated
   */
  recordUsage(inputTokens: number, outputTokens: number): void {
    const now = Date.now();
    const totalTokens = inputTokens + outputTokens;

    // Check if this request was pre-reserved
    if (this.pendingReservations > 0) {
      // Request already counted by reserveRequest()
      this.pendingReservations--;
    } else {
      // Legacy path: add request timestamp here (backward compatibility)
      this.requestTimestamps.push(now);
    }

    // Record token usage
    this.tokenUsage.push({ timestamp: now, tokens: totalTokens });

    // Update daily tokens
    this.checkDailyReset();
    this.dailyTokens += totalTokens;

    // Clean up old entries
    this.pruneOldEntries(now);
  }

  /**
   * Calculate the delay needed before the next request.
   *
   * Returns 0 if no delay is needed, otherwise returns the number of
   * milliseconds to wait to stay within rate limits.
   *
   * @returns Delay in milliseconds (0 if none needed)
   */
  getRequiredDelayMs(): number {
    if (!this.config.enabled) {
      return 0;
    }

    const now = Date.now();
    this.pruneOldEntries(now);
    this.checkDailyReset();

    let maxDelay = 0;

    // Check RPM limit
    if (this.config.requestsPerMinute !== undefined) {
      const delay = this.calculateRpmDelay(now);
      maxDelay = Math.max(maxDelay, delay);
    }

    // Check TPM limit
    if (this.config.tokensPerMinute !== undefined) {
      const delay = this.calculateTpmDelay(now);
      maxDelay = Math.max(maxDelay, delay);
    }

    // Check daily token limit
    if (this.config.tokensPerDay !== undefined) {
      const effectiveLimit = this.config.tokensPerDay * this.config.safetyMargin;
      if (this.dailyTokens >= effectiveLimit) {
        // Daily limit reached - return time until midnight UTC
        maxDelay = Math.max(maxDelay, this.getTimeUntilMidnightUTC());
      }
    }

    return Math.ceil(maxDelay);
  }

  /**
   * Check if we're approaching any configured limits.
   *
   * @returns true if any limit is at or above the safety margin threshold
   */
  isApproachingLimit(): boolean {
    if (!this.config.enabled) {
      return false;
    }

    const now = Date.now();
    this.pruneOldEntries(now);
    this.checkDailyReset();

    // Check RPM
    if (this.config.requestsPerMinute !== undefined) {
      const currentRpm = this.requestTimestamps.length;
      const threshold = this.config.requestsPerMinute * this.config.safetyMargin;
      if (currentRpm >= threshold) {
        return true;
      }
    }

    // Check TPM
    if (this.config.tokensPerMinute !== undefined) {
      const currentTpm = this.tokenUsage.reduce((sum, entry) => sum + entry.tokens, 0);
      const threshold = this.config.tokensPerMinute * this.config.safetyMargin;
      if (currentTpm >= threshold) {
        return true;
      }
    }

    // Check daily tokens
    if (this.config.tokensPerDay !== undefined) {
      const threshold = this.config.tokensPerDay * this.config.safetyMargin;
      if (this.dailyTokens >= threshold) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get current usage statistics.
   *
   * @returns Current usage stats for monitoring/logging
   */
  getUsageStats(): RateLimitStats {
    const now = Date.now();
    this.pruneOldEntries(now);
    this.checkDailyReset();

    const currentRpm = this.requestTimestamps.length;
    const currentTpm = this.tokenUsage.reduce((sum, entry) => sum + entry.tokens, 0);

    // Determine which limits triggered throttling
    const triggeredBy: RateLimitStats["triggeredBy"] = {};

    if (this.config.requestsPerMinute !== undefined) {
      const effectiveLimit = this.config.requestsPerMinute * this.config.safetyMargin;
      if (currentRpm >= effectiveLimit) {
        triggeredBy.rpm = {
          current: currentRpm,
          limit: this.config.requestsPerMinute,
          effectiveLimit,
        };
      }
    }

    if (this.config.tokensPerMinute !== undefined) {
      const effectiveLimit = this.config.tokensPerMinute * this.config.safetyMargin;
      if (currentTpm >= effectiveLimit) {
        triggeredBy.tpm = {
          current: currentTpm,
          limit: this.config.tokensPerMinute,
          effectiveLimit,
        };
      }
    }

    if (this.config.tokensPerDay !== undefined) {
      const effectiveLimit = this.config.tokensPerDay * this.config.safetyMargin;
      if (this.dailyTokens >= effectiveLimit) {
        triggeredBy.daily = {
          current: this.dailyTokens,
          limit: this.config.tokensPerDay,
          effectiveLimit,
        };
      }
    }

    return {
      rpm: currentRpm,
      tpm: currentTpm,
      dailyTokens: this.dailyTokens,
      isApproachingLimit: this.isApproachingLimit(),
      requiredDelayMs: this.getRequiredDelayMs(),
      triggeredBy: Object.keys(triggeredBy).length > 0 ? triggeredBy : undefined,
    };
  }

  /**
   * Reset all tracking state.
   * Useful for testing or when switching API keys/tiers.
   */
  reset(): void {
    this.requestTimestamps = [];
    this.tokenUsage = [];
    this.dailyTokens = 0;
    this.dailyResetDate = this.getCurrentDateUTC();
    this.pendingReservations = 0;
  }

  /**
   * Update configuration dynamically.
   * Useful when API tier changes or for testing.
   *
   * @param config - New configuration to apply
   */
  updateConfig(config: RateLimitConfig): void {
    this.config = resolveRateLimitConfig(config);
  }

  /**
   * Reserve a request slot before making an LLM call.
   *
   * This is critical for concurrent subagents sharing a rate limiter.
   * Without reservation, multiple subagents checking getRequiredDelayMs()
   * simultaneously would all see zero usage and proceed, causing rate limit errors.
   *
   * Call this AFTER waiting for getRequiredDelayMs() but BEFORE making the LLM call.
   * The reservation ensures subsequent concurrent checks see the pending request.
   *
   * @example
   * ```typescript
   * // Proactive rate limiting with reservation
   * const delay = tracker.getRequiredDelayMs();
   * if (delay > 0) await sleep(delay);
   *
   * tracker.reserveRequest(); // Claim slot BEFORE making call
   * try {
   *   const result = await llm.call();
   *   tracker.recordUsage(result.inputTokens, result.outputTokens);
   * } catch (error) {
   *   // Request already reserved; recordUsage updates token count
   *   throw error;
   * }
   * ```
   */
  reserveRequest(): void {
    const now = Date.now();
    this.requestTimestamps.push(now);
    this.pendingReservations++;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private methods
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Calculate delay needed based on RPM limit.
   */
  private calculateRpmDelay(now: number): number {
    const effectiveLimit = this.config.requestsPerMinute! * this.config.safetyMargin;
    const currentRpm = this.requestTimestamps.length;

    if (currentRpm < effectiveLimit) {
      return 0;
    }

    // Find the oldest request and calculate when it will expire from the window
    const oldestTimestamp = this.requestTimestamps[0];
    if (oldestTimestamp === undefined) {
      return 0;
    }

    // Wait until the oldest request expires from the 1-minute window
    const expiryTime = oldestTimestamp + 60000;
    return Math.max(0, expiryTime - now);
  }

  /**
   * Calculate delay needed based on TPM limit.
   */
  private calculateTpmDelay(now: number): number {
    const effectiveLimit = this.config.tokensPerMinute! * this.config.safetyMargin;
    const currentTpm = this.tokenUsage.reduce((sum, entry) => sum + entry.tokens, 0);

    if (currentTpm < effectiveLimit) {
      return 0;
    }

    // Find when enough tokens will expire to be under the limit
    // Sort by timestamp (should already be sorted, but be safe)
    const sorted = [...this.tokenUsage].sort((a, b) => a.timestamp - b.timestamp);

    let tokensToFree = currentTpm - effectiveLimit;
    let delay = 0;

    for (const entry of sorted) {
      tokensToFree -= entry.tokens;
      if (tokensToFree <= 0) {
        delay = entry.timestamp + 60000 - now;
        break;
      }
    }

    return Math.max(0, delay);
  }

  /**
   * Remove entries older than 1 minute from the sliding window.
   */
  private pruneOldEntries(now: number): void {
    const cutoff = now - 60000;

    // Prune request timestamps
    while (this.requestTimestamps.length > 0 && this.requestTimestamps[0]! < cutoff) {
      this.requestTimestamps.shift();
    }

    // Prune token usage entries
    while (this.tokenUsage.length > 0 && this.tokenUsage[0]!.timestamp < cutoff) {
      this.tokenUsage.shift();
    }
  }

  /**
   * Check if the day has changed (UTC) and reset daily counters.
   */
  private checkDailyReset(): void {
    const currentDate = this.getCurrentDateUTC();
    if (currentDate !== this.dailyResetDate) {
      this.dailyTokens = 0;
      this.dailyResetDate = currentDate;
    }
  }

  /**
   * Get current date in YYYY-MM-DD format (UTC).
   */
  private getCurrentDateUTC(): string {
    return new Date().toISOString().split("T")[0]!;
  }

  /**
   * Calculate milliseconds until midnight UTC.
   */
  private getTimeUntilMidnightUTC(): number {
    const now = new Date();
    const midnight = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    return midnight.getTime() - now.getTime();
  }
}
