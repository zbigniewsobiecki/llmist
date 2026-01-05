import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RATE_LIMIT_CONFIG,
  type RateLimitConfig,
  RateLimitTracker,
  resolveRateLimitConfig,
} from "./rate-limit.js";

describe("rate limit configuration", () => {
  describe("DEFAULT_RATE_LIMIT_CONFIG", () => {
    it("should have sensible defaults", () => {
      expect(DEFAULT_RATE_LIMIT_CONFIG).toEqual({
        safetyMargin: 0.9,
        enabled: true,
      });
    });
  });

  describe("resolveRateLimitConfig", () => {
    it("should return disabled config when no config provided", () => {
      const resolved = resolveRateLimitConfig();
      expect(resolved.enabled).toBe(false);
      expect(resolved.safetyMargin).toBe(0.9);
    });

    it("should enable when limits are configured", () => {
      const resolved = resolveRateLimitConfig({ requestsPerMinute: 60 });
      expect(resolved.enabled).toBe(true);
      expect(resolved.requestsPerMinute).toBe(60);
    });

    it("should enable with tokensPerMinute", () => {
      const resolved = resolveRateLimitConfig({ tokensPerMinute: 100000 });
      expect(resolved.enabled).toBe(true);
      expect(resolved.tokensPerMinute).toBe(100000);
    });

    it("should enable with tokensPerDay", () => {
      const resolved = resolveRateLimitConfig({ tokensPerDay: 1000000 });
      expect(resolved.enabled).toBe(true);
      expect(resolved.tokensPerDay).toBe(1000000);
    });

    it("should respect explicit enabled=false", () => {
      const resolved = resolveRateLimitConfig({
        requestsPerMinute: 60,
        enabled: false,
      });
      expect(resolved.enabled).toBe(false);
    });

    it("should apply custom safety margin", () => {
      const resolved = resolveRateLimitConfig({
        requestsPerMinute: 60,
        safetyMargin: 0.8,
      });
      expect(resolved.safetyMargin).toBe(0.8);
    });
  });
});

describe("RateLimitTracker", () => {
  let tracker: RateLimitTracker;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("basic functionality", () => {
    it("should track request timestamps", () => {
      tracker = new RateLimitTracker({ requestsPerMinute: 10 });

      tracker.recordUsage(100, 50);
      tracker.recordUsage(200, 100);

      const stats = tracker.getUsageStats();
      expect(stats.rpm).toBe(2);
    });

    it("should track token usage", () => {
      tracker = new RateLimitTracker({ tokensPerMinute: 10000 });

      tracker.recordUsage(100, 50);
      tracker.recordUsage(200, 100);

      const stats = tracker.getUsageStats();
      expect(stats.tpm).toBe(450); // 100+50 + 200+100
    });

    it("should return 0 delay when under limits", () => {
      tracker = new RateLimitTracker({ requestsPerMinute: 60 });

      tracker.recordUsage(100, 50);
      expect(tracker.getRequiredDelayMs()).toBe(0);
    });

    it("should return 0 delay when disabled", () => {
      tracker = new RateLimitTracker(); // No limits configured

      tracker.recordUsage(1000000, 1000000);
      expect(tracker.getRequiredDelayMs()).toBe(0);
    });
  });

  describe("RPM limiting", () => {
    it("should not throttle when under safety margin", () => {
      tracker = new RateLimitTracker({
        requestsPerMinute: 10,
        safetyMargin: 0.9,
      });

      // 9 requests = exactly at 90% safety margin
      for (let i = 0; i < 8; i++) {
        tracker.recordUsage(10, 10);
      }

      expect(tracker.getRequiredDelayMs()).toBe(0);
      expect(tracker.isApproachingLimit()).toBe(false);
    });

    it("should throttle when at safety margin", () => {
      tracker = new RateLimitTracker({
        requestsPerMinute: 10,
        safetyMargin: 0.9,
      });

      // 9 requests = exactly at 90% safety margin
      for (let i = 0; i < 9; i++) {
        tracker.recordUsage(10, 10);
      }

      expect(tracker.isApproachingLimit()).toBe(true);
      // Should wait until first request expires from window
      expect(tracker.getRequiredDelayMs()).toBe(60000);
    });

    it("should clear old requests after window expires", () => {
      tracker = new RateLimitTracker({ requestsPerMinute: 10 });

      for (let i = 0; i < 10; i++) {
        tracker.recordUsage(10, 10);
      }

      expect(tracker.getUsageStats().rpm).toBe(10);

      // Advance time by 61 seconds
      vi.advanceTimersByTime(61000);

      expect(tracker.getUsageStats().rpm).toBe(0);
      expect(tracker.getRequiredDelayMs()).toBe(0);
    });
  });

  describe("TPM limiting", () => {
    it("should throttle when token limit approached", () => {
      tracker = new RateLimitTracker({
        tokensPerMinute: 1000,
        safetyMargin: 0.9,
      });

      // Use 900 tokens = exactly at 90% safety margin
      tracker.recordUsage(800, 100);

      expect(tracker.isApproachingLimit()).toBe(true);
      expect(tracker.getRequiredDelayMs()).toBe(60000);
    });

    it("should calculate delay based on token expiration", () => {
      tracker = new RateLimitTracker({
        tokensPerMinute: 1000,
        safetyMargin: 1.0, // No safety margin for easier testing
      });

      tracker.recordUsage(600, 0);
      vi.advanceTimersByTime(30000); // 30 seconds
      tracker.recordUsage(600, 0); // Now at 1200 tokens, over limit

      // Should wait until first 600 tokens expire (30 more seconds)
      const delay = tracker.getRequiredDelayMs();
      expect(delay).toBeGreaterThan(29000);
      expect(delay).toBeLessThanOrEqual(30000);
    });
  });

  describe("daily token limiting", () => {
    it("should track daily tokens", () => {
      tracker = new RateLimitTracker({ tokensPerDay: 10000 });

      tracker.recordUsage(1000, 500);
      tracker.recordUsage(2000, 1000);

      const stats = tracker.getUsageStats();
      expect(stats.dailyTokens).toBe(4500);
    });

    it("should flag when approaching daily limit", () => {
      tracker = new RateLimitTracker({
        tokensPerDay: 10000,
        safetyMargin: 0.9,
      });

      // Use 9000 tokens = 90% of daily limit
      tracker.recordUsage(9000, 0);

      expect(tracker.isApproachingLimit()).toBe(true);
    });
  });

  describe("combined limits", () => {
    it("should enforce the most restrictive limit", () => {
      tracker = new RateLimitTracker({
        requestsPerMinute: 100, // Very generous
        tokensPerMinute: 500, // More restrictive
        safetyMargin: 1.0,
      });

      // Only 2 requests but 600 tokens
      tracker.recordUsage(300, 0);
      tracker.recordUsage(300, 0);

      const stats = tracker.getUsageStats();
      expect(stats.rpm).toBe(2);
      expect(stats.tpm).toBe(600);
      expect(stats.isApproachingLimit).toBe(true);
      expect(tracker.getRequiredDelayMs()).toBeGreaterThan(0);
    });
  });

  describe("reset functionality", () => {
    it("should reset all tracking state", () => {
      tracker = new RateLimitTracker({
        requestsPerMinute: 60,
        tokensPerMinute: 10000,
      });

      tracker.recordUsage(1000, 500);
      tracker.recordUsage(2000, 1000);

      expect(tracker.getUsageStats().rpm).toBe(2);
      expect(tracker.getUsageStats().tpm).toBe(4500);

      tracker.reset();

      expect(tracker.getUsageStats().rpm).toBe(0);
      expect(tracker.getUsageStats().tpm).toBe(0);
      expect(tracker.getUsageStats().dailyTokens).toBe(0);
    });
  });

  describe("config update", () => {
    it("should allow dynamic config updates", () => {
      tracker = new RateLimitTracker({ requestsPerMinute: 10 });

      for (let i = 0; i < 10; i++) {
        tracker.recordUsage(10, 10);
      }

      expect(tracker.isApproachingLimit()).toBe(true);

      // Upgrade to higher tier
      tracker.updateConfig({ requestsPerMinute: 100 });

      expect(tracker.isApproachingLimit()).toBe(false);
    });
  });
});
