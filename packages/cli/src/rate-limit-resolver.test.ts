import { Command } from "commander";
import { describe, expect, it } from "vitest";
import type { CLIAgentOptions, RateLimitsConfig, RetryConfigCLI } from "./config.js";
import { OPTION_FLAGS } from "./constants.js";
import { resolveRateLimitConfig, resolveRetryConfig } from "./rate-limit-resolver.js";

describe("resolveRateLimitConfig", () => {
  describe("Provider Detection", () => {
    it("should apply Anthropic defaults for anthropic: prefix", () => {
      const options = {} as CLIAgentOptions;
      const result = resolveRateLimitConfig(options, undefined, undefined, "anthropic:sonnet");

      expect(result).toEqual({
        enabled: true,
        requestsPerMinute: 50,
        tokensPerMinute: 40_000,
        safetyMargin: 0.8,
      });
    });

    it("should apply OpenAI defaults for openai: prefix", () => {
      const options = {} as CLIAgentOptions;
      const result = resolveRateLimitConfig(options, undefined, undefined, "openai:gpt4o");

      expect(result).toEqual({
        enabled: true,
        requestsPerMinute: 3,
        tokensPerMinute: 40_000,
        safetyMargin: 0.8,
      });
    });

    it("should apply Gemini defaults for gemini: prefix", () => {
      const options = {} as CLIAgentOptions;
      const result = resolveRateLimitConfig(options, undefined, undefined, "gemini:flash");

      expect(result).toEqual({
        enabled: true,
        requestsPerMinute: 15,
        tokensPerMinute: 1_000_000,
        tokensPerDay: 1_500_000,
        safetyMargin: 0.8,
      });
    });

    it("should apply defaults for model aliases (sonnet → anthropic)", () => {
      const options = {} as CLIAgentOptions;
      const result = resolveRateLimitConfig(options, undefined, undefined, "sonnet");

      expect(result).toEqual({
        enabled: true,
        requestsPerMinute: 50,
        tokensPerMinute: 40_000,
        safetyMargin: 0.8,
      });
    });

    it("should apply defaults for model aliases (gpt4o → openai)", () => {
      const options = {} as CLIAgentOptions;
      const result = resolveRateLimitConfig(options, undefined, undefined, "gpt4o");

      expect(result).toEqual({
        enabled: true,
        requestsPerMinute: 3,
        tokensPerMinute: 40_000,
        safetyMargin: 0.8,
      });
    });

    it("should return undefined for unknown providers", () => {
      const options = {} as CLIAgentOptions;
      const result = resolveRateLimitConfig(options, undefined, undefined, "custom:model");

      expect(result).toBeUndefined();
    });

    it("should return undefined when no model is provided", () => {
      const options = {} as CLIAgentOptions;
      const result = resolveRateLimitConfig(options, undefined, undefined, undefined);

      expect(result).toBeUndefined();
    });
  });

  describe("Configuration Precedence", () => {
    it("should use global config over provider defaults", () => {
      const options = {} as CLIAgentOptions;
      const globalConfig: RateLimitsConfig = {
        "requests-per-minute": 100,
        "tokens-per-minute": 50_000,
      };
      const result = resolveRateLimitConfig(options, globalConfig, undefined, "anthropic:sonnet");

      expect(result).toEqual({
        enabled: true,
        requestsPerMinute: 100,
        tokensPerMinute: 50_000,
        safetyMargin: 0.8, // Default safety margin
      });
    });

    it("should use profile config over global config", () => {
      const options = {} as CLIAgentOptions;
      const globalConfig: RateLimitsConfig = {
        "requests-per-minute": 100,
      };
      const profileConfig: RateLimitsConfig = {
        "requests-per-minute": 200,
      };
      const result = resolveRateLimitConfig(
        options,
        globalConfig,
        profileConfig,
        "anthropic:sonnet",
      );

      expect(result?.requestsPerMinute).toBe(200);
    });

    it("should use CLI flags over all config", () => {
      const options = {
        rateLimitRpm: 500,
        rateLimitTpm: 100_000,
      } as CLIAgentOptions;
      const globalConfig: RateLimitsConfig = {
        "requests-per-minute": 100,
      };
      const profileConfig: RateLimitsConfig = {
        "requests-per-minute": 200,
      };
      const result = resolveRateLimitConfig(
        options,
        globalConfig,
        profileConfig,
        "anthropic:sonnet",
      );

      expect(result).toEqual({
        enabled: true,
        requestsPerMinute: 500,
        tokensPerMinute: 100_000,
        safetyMargin: 0.8,
      });
    });

    it("should merge partial configs with provider defaults", () => {
      const options = {} as CLIAgentOptions;
      const globalConfig: RateLimitsConfig = {
        "requests-per-minute": 100,
        // No TPM specified
      };
      const result = resolveRateLimitConfig(options, globalConfig, undefined, "anthropic:sonnet");

      expect(result).toEqual({
        enabled: true,
        requestsPerMinute: 100, // From global config
        tokensPerMinute: 40_000, // From provider defaults
        safetyMargin: 0.8,
      });
    });

    it("should use custom safety margin from config", () => {
      const options = {} as CLIAgentOptions;
      const globalConfig: RateLimitsConfig = {
        "safety-margin": 0.9,
      };
      const result = resolveRateLimitConfig(options, globalConfig, undefined, "anthropic:sonnet");

      expect(result?.safetyMargin).toBe(0.9);
    });

    it("should use safety margin from CLI flag", () => {
      const options = {
        rateLimitSafetyMargin: 0.7,
      } as CLIAgentOptions;
      const result = resolveRateLimitConfig(options, undefined, undefined, "anthropic:sonnet");

      expect(result?.safetyMargin).toBe(0.7);
    });
  });

  describe("Disable Flags", () => {
    it("should return { enabled: false } when --no-rate-limit is set", () => {
      const options = {
        rateLimit: false,
      } as CLIAgentOptions;
      const globalConfig: RateLimitsConfig = {
        "requests-per-minute": 100,
      };
      const result = resolveRateLimitConfig(options, globalConfig, undefined, "anthropic:sonnet");

      expect(result).toEqual({ enabled: false, safetyMargin: 0.8 });
    });

    it("should return { enabled: false } when enabled: false in global config", () => {
      const options = {} as CLIAgentOptions;
      const globalConfig: RateLimitsConfig = {
        enabled: false,
        "requests-per-minute": 100,
      };
      const result = resolveRateLimitConfig(options, globalConfig, undefined, "anthropic:sonnet");

      expect(result).toEqual({ enabled: false, safetyMargin: 0.8 });
    });

    it("should return { enabled: false } when enabled: false in profile config", () => {
      const options = {} as CLIAgentOptions;
      const globalConfig: RateLimitsConfig = {
        "requests-per-minute": 100,
      };
      const profileConfig: RateLimitsConfig = {
        enabled: false,
      };
      const result = resolveRateLimitConfig(
        options,
        globalConfig,
        profileConfig,
        "anthropic:sonnet",
      );

      expect(result).toEqual({ enabled: false, safetyMargin: 0.8 });
    });

    it("should prioritize --no-rate-limit over enabled: true in config", () => {
      const options = {
        rateLimit: false,
      } as CLIAgentOptions;
      const globalConfig: RateLimitsConfig = {
        enabled: true,
        "requests-per-minute": 100,
      };
      const result = resolveRateLimitConfig(options, globalConfig, undefined, "anthropic:sonnet");

      expect(result).toEqual({ enabled: false, safetyMargin: 0.8 });
    });
  });

  describe("Daily Token Limits", () => {
    it("should include tokensPerDay for Gemini", () => {
      const options = {} as CLIAgentOptions;
      const result = resolveRateLimitConfig(options, undefined, undefined, "gemini:flash");

      expect(result?.tokensPerDay).toBe(1_500_000);
    });

    it("should support tokensPerDay from config", () => {
      const options = {} as CLIAgentOptions;
      const globalConfig: RateLimitsConfig = {
        "tokens-per-day": 2_000_000,
      };
      const result = resolveRateLimitConfig(options, globalConfig, undefined, "gemini:flash");

      expect(result?.tokensPerDay).toBe(2_000_000);
    });

    it("should support tokensPerDay from CLI flag", () => {
      const options = {
        rateLimitDaily: 3_000_000,
      } as CLIAgentOptions;
      const result = resolveRateLimitConfig(options, undefined, undefined, "gemini:flash");

      expect(result?.tokensPerDay).toBe(3_000_000);
    });
  });
});

describe("resolveRetryConfig", () => {
  describe("Default Behavior", () => {
    it("should return full config with defaults", () => {
      const options = {} as CLIAgentOptions;
      const result = resolveRetryConfig(options, undefined, undefined);

      expect(result).toEqual({
        enabled: true,
        retries: 3,
        minTimeout: 1000,
        maxTimeout: 30000,
        factor: 2,
        randomize: true,
        respectRetryAfter: true,
        maxRetryAfterMs: 120000,
      });
    });

    it("should merge CLI options with defaults", () => {
      const options = {
        maxRetries: 5,
      } as CLIAgentOptions;
      const result = resolveRetryConfig(options, undefined, undefined);

      expect(result).toEqual({
        enabled: true,
        retries: 5,
        minTimeout: 1000,
        maxTimeout: 30000,
        factor: 2,
        randomize: true,
        respectRetryAfter: true,
        maxRetryAfterMs: 120000,
      });
    });
  });

  describe("Configuration Precedence", () => {
    it("should use global config merged with defaults", () => {
      const options = {} as CLIAgentOptions;
      const globalConfig: RetryConfigCLI = {
        retries: 5,
        "min-timeout": 2000,
      };
      const result = resolveRetryConfig(options, globalConfig, undefined);

      expect(result).toEqual({
        enabled: true,
        retries: 5,
        minTimeout: 2000,
        maxTimeout: 30000,
        factor: 2,
        randomize: true,
        respectRetryAfter: true,
        maxRetryAfterMs: 120000,
      });
    });

    it("should use profile config over global config", () => {
      const options = {} as CLIAgentOptions;
      const globalConfig: RetryConfigCLI = {
        retries: 5,
      };
      const profileConfig: RetryConfigCLI = {
        retries: 10,
      };
      const result = resolveRetryConfig(options, globalConfig, profileConfig);

      expect(result?.retries).toBe(10);
    });

    it("should use CLI flags over all config", () => {
      const options = {
        maxRetries: 7,
        retryMinTimeout: 3000,
        retryMaxTimeout: 60000,
      } as CLIAgentOptions;
      const globalConfig: RetryConfigCLI = {
        retries: 5,
      };
      const result = resolveRetryConfig(options, globalConfig, undefined);

      expect(result).toEqual({
        enabled: true,
        retries: 7,
        minTimeout: 3000,
        maxTimeout: 60000,
        factor: 2,
        randomize: true,
        respectRetryAfter: true,
        maxRetryAfterMs: 120000,
      });
    });

    it("should merge partial configs with defaults", () => {
      const options = {
        maxRetries: 5,
      } as CLIAgentOptions;
      const globalConfig: RetryConfigCLI = {
        "min-timeout": 2000,
        "max-timeout": 30000,
      };
      const result = resolveRetryConfig(options, globalConfig, undefined);

      expect(result).toEqual({
        enabled: true,
        retries: 5,
        minTimeout: 2000,
        maxTimeout: 30000,
        factor: 2,
        randomize: true,
        respectRetryAfter: true,
        maxRetryAfterMs: 120000,
      });
    });
  });

  describe("Disable Flags", () => {
    it("should return { enabled: false } when --no-retry is set", () => {
      const options = {
        retry: false,
      } as CLIAgentOptions;
      const globalConfig: RetryConfigCLI = {
        retries: 5,
      };
      const result = resolveRetryConfig(options, globalConfig, undefined);

      expect(result).toEqual({
        enabled: false,
        retries: 5,
        minTimeout: 1000,
        maxTimeout: 30000,
        factor: 2,
        randomize: true,
        respectRetryAfter: true,
        maxRetryAfterMs: 120000,
      });
    });

    it("should return { enabled: false } when enabled: false in global config", () => {
      const options = {} as CLIAgentOptions;
      const globalConfig: RetryConfigCLI = {
        enabled: false,
        retries: 5,
      };
      const result = resolveRetryConfig(options, globalConfig, undefined);

      expect(result).toEqual({
        enabled: false,
        retries: 5,
        minTimeout: 1000,
        maxTimeout: 30000,
        factor: 2,
        randomize: true,
        respectRetryAfter: true,
        maxRetryAfterMs: 120000,
      });
    });

    it("should return { enabled: false } when enabled: false in profile config", () => {
      const options = {} as CLIAgentOptions;
      const globalConfig: RetryConfigCLI = {
        retries: 5,
      };
      const profileConfig: RetryConfigCLI = {
        enabled: false,
      };
      const result = resolveRetryConfig(options, globalConfig, profileConfig);

      expect(result).toEqual({
        enabled: false,
        retries: 5,
        minTimeout: 1000,
        maxTimeout: 30000,
        factor: 2,
        randomize: true,
        respectRetryAfter: true,
        maxRetryAfterMs: 120000,
      });
    });

    it("should prioritize --no-retry over enabled: true in config", () => {
      const options = {
        retry: false,
      } as CLIAgentOptions;
      const globalConfig: RetryConfigCLI = {
        enabled: true,
        retries: 5,
      };
      const result = resolveRetryConfig(options, globalConfig, undefined);

      expect(result).toEqual({
        enabled: false,
        retries: 5,
        minTimeout: 1000,
        maxTimeout: 30000,
        factor: 2,
        randomize: true,
        respectRetryAfter: true,
        maxRetryAfterMs: 120000,
      });
    });
  });

  describe("Advanced Options", () => {
    it("should support factor and randomize options", () => {
      const options = {} as CLIAgentOptions;
      const globalConfig: RetryConfigCLI = {
        retries: 5,
        factor: 3,
        randomize: false,
      };
      const result = resolveRetryConfig(options, globalConfig, undefined);

      expect(result).toEqual({
        enabled: true,
        retries: 5,
        minTimeout: 1000,
        maxTimeout: 30000,
        factor: 3,
        randomize: false,
        respectRetryAfter: true,
        maxRetryAfterMs: 120000,
      });
    });

    it("should support respect-retry-after option", () => {
      const options = {} as CLIAgentOptions;
      const globalConfig: RetryConfigCLI = {
        retries: 5,
        "respect-retry-after": false,
      };
      const result = resolveRetryConfig(options, globalConfig, undefined);

      expect(result).toEqual({
        enabled: true,
        retries: 5,
        minTimeout: 1000,
        maxTimeout: 30000,
        factor: 2,
        randomize: true,
        respectRetryAfter: false,
        maxRetryAfterMs: 120000,
      });
    });

    it("should support max-retry-after-ms option", () => {
      const options = {} as CLIAgentOptions;
      const globalConfig: RetryConfigCLI = {
        retries: 5,
        "max-retry-after-ms": 120000,
      };
      const result = resolveRetryConfig(options, globalConfig, undefined);

      expect(result).toEqual({
        enabled: true,
        retries: 5,
        minTimeout: 1000,
        maxTimeout: 30000,
        factor: 2,
        randomize: true,
        respectRetryAfter: true,
        maxRetryAfterMs: 120000,
      });
    });
  });
});

/**
 * Integration tests that verify Commander.js actually produces the property names
 * our resolver code expects. This catches the class of bug where Commander's --no-*
 * flag naming convention (e.g. --no-rate-limit → options.rateLimit = false) doesn't
 * match the property name the resolver checks.
 */
describe("Commander --no-* flag integration", () => {
  it("--no-rate-limit sets rateLimit=false (not noRateLimit=true)", () => {
    const cmd = new Command();
    cmd.option(OPTION_FLAGS.noRateLimit, "Disable rate limiting");
    cmd.parse(["node", "test", "--no-rate-limit"]);
    const opts = cmd.opts();

    expect(opts.rateLimit).toBe(false);
    expect(opts).not.toHaveProperty("noRateLimit");

    // Verify the resolver accepts what Commander produces
    const result = resolveRateLimitConfig(opts as CLIAgentOptions);
    expect(result).toEqual({ enabled: false, safetyMargin: 0.8 });
  });

  it("--no-retry sets retry=false (not noRetry=true)", () => {
    const cmd = new Command();
    cmd.option(OPTION_FLAGS.noRetry, "Disable retry");
    cmd.parse(["node", "test", "--no-retry"]);
    const opts = cmd.opts();

    expect(opts.retry).toBe(false);
    expect(opts).not.toHaveProperty("noRetry");

    // Verify the resolver accepts what Commander produces
    const result = resolveRetryConfig(opts as CLIAgentOptions);
    expect(result.enabled).toBe(false);
  });

  it("omitting --no-rate-limit leaves rate limiting unaffected", () => {
    const cmd = new Command();
    cmd.option(OPTION_FLAGS.noRateLimit, "Disable rate limiting");
    cmd.parse(["node", "test"]);
    const opts = cmd.opts();

    // Commander sets default to true for --no-* flags (implied --rate-limit)
    expect(opts.rateLimit).toBe(true);

    // Resolver should NOT treat rateLimit=true as disabled
    const result = resolveRateLimitConfig(opts as CLIAgentOptions);
    expect(result).not.toEqual(expect.objectContaining({ enabled: false }));
  });
});
