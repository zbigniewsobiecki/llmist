import type { RateLimitConfig, RetryConfig } from "llmist";
import { getProvider, resolveModel } from "llmist";
import type { RateLimitsConfig, RetryConfigCLI } from "./config.js";
import type { CLIAgentOptions, CLICompleteOptions } from "./option-helpers.js";

/**
 * Provider-specific default rate limits based on documented free/Tier 1 limits.
 */
const PROVIDER_DEFAULTS: Record<string, Partial<RateLimitConfig>> = {
  anthropic: {
    requestsPerMinute: 50, // Tier 1 safe
    tokensPerMinute: 40_000, // Tier 1 for claude-3-5-sonnet
    safetyMargin: 0.8,
  },
  openai: {
    requestsPerMinute: 3, // Free tier minimum (very conservative)
    tokensPerMinute: 40_000,
    safetyMargin: 0.8,
  },
  gemini: {
    requestsPerMinute: 15, // Free tier documented
    tokensPerMinute: 1_000_000, // Free tier documented
    tokensPerDay: 1_500_000, // Free tier daily limit
    safetyMargin: 0.8,
  },
};

/**
 * Detects provider from model string.
 *
 * @param model - Model identifier (e.g., "sonnet", "gpt-4o", "gemini:flash")
 * @returns Provider ID ("anthropic", "openai", "gemini") or null if unknown
 */
function detectProvider(model: string): string | null {
  try {
    const resolved = resolveModel(model, { silent: true });
    return getProvider(resolved) ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolves rate limit configuration from CLI options, TOML config, and provider defaults.
 *
 * Precedence (highest to lowest):
 * 1. CLI flags (--rate-limit-rpm, --no-rate-limit, etc.)
 * 2. Profile TOML config ([agent.rate-limits], [complete.rate-limits])
 * 3. Global TOML config ([rate-limits])
 * 4. Provider-specific defaults (based on model)
 * 5. Disabled (for unknown providers)
 *
 * @param options - CLI options (may contain CLI flags)
 * @param globalConfig - Global [rate-limits] from TOML
 * @param profileConfig - Profile-specific rate-limits from TOML
 * @param model - Model identifier for provider detection
 * @returns Resolved rate limit config, or undefined if disabled
 */
export function resolveRateLimitConfig(
  options: CLIAgentOptions | CLICompleteOptions,
  globalConfig?: RateLimitsConfig,
  profileConfig?: RateLimitsConfig,
  model?: string,
): RateLimitConfig | undefined {
  // Explicit disable via CLI flag
  if (options.noRateLimit === true) {
    return { enabled: false, safetyMargin: 0.8 };
  }

  // Start with provider-specific defaults (if model is known)
  let resolved: Partial<RateLimitConfig> | undefined;
  if (model) {
    const provider = detectProvider(model);
    if (provider && PROVIDER_DEFAULTS[provider]) {
      resolved = { ...PROVIDER_DEFAULTS[provider] };
    }
  }

  // If no provider defaults, start with empty config (will be disabled)
  if (!resolved) {
    resolved = {};
  }

  // Apply global TOML config
  if (globalConfig) {
    if (globalConfig["requests-per-minute"] !== undefined) {
      resolved.requestsPerMinute = globalConfig["requests-per-minute"];
    }
    if (globalConfig["tokens-per-minute"] !== undefined) {
      resolved.tokensPerMinute = globalConfig["tokens-per-minute"];
    }
    if (globalConfig["tokens-per-day"] !== undefined) {
      resolved.tokensPerDay = globalConfig["tokens-per-day"];
    }
    if (globalConfig["safety-margin"] !== undefined) {
      resolved.safetyMargin = globalConfig["safety-margin"];
    }
    if (globalConfig.enabled !== undefined) {
      resolved.enabled = globalConfig.enabled;
    }
  }

  // Apply profile-specific TOML config (overrides global)
  if (profileConfig) {
    if (profileConfig["requests-per-minute"] !== undefined) {
      resolved.requestsPerMinute = profileConfig["requests-per-minute"];
    }
    if (profileConfig["tokens-per-minute"] !== undefined) {
      resolved.tokensPerMinute = profileConfig["tokens-per-minute"];
    }
    if (profileConfig["tokens-per-day"] !== undefined) {
      resolved.tokensPerDay = profileConfig["tokens-per-day"];
    }
    if (profileConfig["safety-margin"] !== undefined) {
      resolved.safetyMargin = profileConfig["safety-margin"];
    }
    if (profileConfig.enabled !== undefined) {
      resolved.enabled = profileConfig.enabled;
    }
  }

  // Apply CLI flags (highest precedence)
  if (options.rateLimitRpm !== undefined) {
    resolved.requestsPerMinute = options.rateLimitRpm;
  }
  if (options.rateLimitTpm !== undefined) {
    resolved.tokensPerMinute = options.rateLimitTpm;
  }
  if (options.rateLimitDaily !== undefined) {
    resolved.tokensPerDay = options.rateLimitDaily;
  }
  if (options.rateLimitSafetyMargin !== undefined) {
    resolved.safetyMargin = options.rateLimitSafetyMargin;
  }

  // Check if rate limiting should be enabled
  // Enabled if: explicit enabled=true OR any limit is configured
  const hasLimits =
    resolved.requestsPerMinute !== undefined ||
    resolved.tokensPerMinute !== undefined ||
    resolved.tokensPerDay !== undefined;

  if (resolved.enabled === false) {
    // Explicitly disabled
    return { enabled: false, safetyMargin: resolved.safetyMargin ?? 0.8 };
  }

  if (!hasLimits) {
    // No limits configured, return undefined (rate limiting disabled)
    return undefined;
  }

  // Enable rate limiting with resolved config
  return {
    ...resolved,
    enabled: true,
    safetyMargin: resolved.safetyMargin ?? 0.8,
  } as RateLimitConfig;
}

/**
 * Default retry configuration.
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  enabled: true,
  retries: 3,
  minTimeout: 1000,
  maxTimeout: 30000,
  factor: 2,
  randomize: true,
  respectRetryAfter: true,
  maxRetryAfterMs: 120000,
};

/**
 * Resolves retry configuration from CLI options, TOML config, and defaults.
 *
 * Precedence (highest to lowest):
 * 1. CLI flags (--max-retries, --no-retry, etc.)
 * 2. Profile TOML config ([agent.retry], [complete.retry])
 * 3. Global TOML config ([retry])
 * 4. Default retry config (3 retries, exponential backoff)
 *
 * @param options - CLI options (may contain CLI flags)
 * @param globalConfig - Global [retry] from TOML
 * @param profileConfig - Profile-specific retry from TOML
 * @returns Resolved retry config (always returns a config, defaults to enabled)
 */
export function resolveRetryConfig(
  options: CLIAgentOptions | CLICompleteOptions,
  globalConfig?: RetryConfigCLI,
  profileConfig?: RetryConfigCLI,
): RetryConfig {
  // Start with defaults
  const resolved: RetryConfig = { ...DEFAULT_RETRY_CONFIG };

  // Apply global TOML config
  if (globalConfig) {
    if (globalConfig.enabled !== undefined) resolved.enabled = globalConfig.enabled;
    if (globalConfig.retries !== undefined) resolved.retries = globalConfig.retries;
    if (globalConfig["min-timeout"] !== undefined)
      resolved.minTimeout = globalConfig["min-timeout"];
    if (globalConfig["max-timeout"] !== undefined)
      resolved.maxTimeout = globalConfig["max-timeout"];
    if (globalConfig.factor !== undefined) resolved.factor = globalConfig.factor;
    if (globalConfig.randomize !== undefined) resolved.randomize = globalConfig.randomize;
    if (globalConfig["respect-retry-after"] !== undefined) {
      resolved.respectRetryAfter = globalConfig["respect-retry-after"];
    }
    if (globalConfig["max-retry-after-ms"] !== undefined) {
      resolved.maxRetryAfterMs = globalConfig["max-retry-after-ms"];
    }
  }

  // Apply profile-specific TOML config (overrides global)
  if (profileConfig) {
    if (profileConfig.enabled !== undefined) resolved.enabled = profileConfig.enabled;
    if (profileConfig.retries !== undefined) resolved.retries = profileConfig.retries;
    if (profileConfig["min-timeout"] !== undefined)
      resolved.minTimeout = profileConfig["min-timeout"];
    if (profileConfig["max-timeout"] !== undefined)
      resolved.maxTimeout = profileConfig["max-timeout"];
    if (profileConfig.factor !== undefined) resolved.factor = profileConfig.factor;
    if (profileConfig.randomize !== undefined) resolved.randomize = profileConfig.randomize;
    if (profileConfig["respect-retry-after"] !== undefined) {
      resolved.respectRetryAfter = profileConfig["respect-retry-after"];
    }
    if (profileConfig["max-retry-after-ms"] !== undefined) {
      resolved.maxRetryAfterMs = profileConfig["max-retry-after-ms"];
    }
  }

  // Apply CLI flags (highest precedence)
  if (options.maxRetries !== undefined) {
    resolved.retries = options.maxRetries;
  }
  if (options.retryMinTimeout !== undefined) {
    resolved.minTimeout = options.retryMinTimeout;
  }
  if (options.retryMaxTimeout !== undefined) {
    resolved.maxTimeout = options.retryMaxTimeout;
  }
  if (options.noRetry === true) {
    resolved.enabled = false;
  }

  return resolved;
}
