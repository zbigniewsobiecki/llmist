import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MockManager, resetMocks } from "./mock-manager.js";
import type { MockMatcherContext } from "./mock-types.js";

// Helper to create a minimal MockMatcherContext
function createContext(modelName = "test-model", provider = "mock"): MockMatcherContext {
  return {
    model: `${provider}:${modelName}`,
    provider,
    modelName,
    options: { model: `${provider}:${modelName}`, messages: [] },
    messages: [],
  };
}

describe("MockManager", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    resetMocks();
  });

  describe("findMatch - strict mode + matcher error", () => {
    test("re-throws matcher error in strict mode", async () => {
      const manager = MockManager.getInstance({ strictMode: true });

      manager.register({
        id: "error-matcher",
        matcher: () => {
          throw new Error("matcher blew up");
        },
        response: { text: "should not reach" },
      });

      await expect(manager.findMatch(createContext())).rejects.toThrow(
        "Matcher error in mock error-matcher: Error: matcher blew up",
      );
    });

    test("re-throws matcher error even when other mocks follow", async () => {
      const manager = MockManager.getInstance({ strictMode: true });

      manager.register({
        id: "throwing-matcher",
        matcher: () => {
          throw new TypeError("unexpected null");
        },
        response: { text: "first" },
      });

      manager.register({
        id: "safe-matcher",
        matcher: () => true,
        response: { text: "second" },
      });

      // The first matcher throws in strict mode, so it should propagate
      await expect(manager.findMatch(createContext())).rejects.toThrow("Matcher error");
    });
  });

  describe("findMatch - non-strict mode + matcher error", () => {
    test("skips gracefully to the next mock when a matcher throws in non-strict mode", async () => {
      const manager = MockManager.getInstance({ strictMode: false });

      manager.register({
        id: "broken-matcher",
        matcher: () => {
          throw new Error("boom");
        },
        response: { text: "broken" },
      });

      manager.register({
        id: "good-matcher",
        matcher: () => true,
        response: { text: "fallback response" },
      });

      const result = await manager.findMatch(createContext());
      expect(result?.text).toBe("fallback response");
    });

    test("returns the non-strict empty response when all matchers throw", async () => {
      const manager = MockManager.getInstance({ strictMode: false });

      manager.register({
        id: "throws-always",
        matcher: () => {
          throw new Error("kaboom");
        },
        response: { text: "nope" },
      });

      const result = await manager.findMatch(createContext());
      // Non-strict mode returns an empty-ish response when nothing matches
      expect(result).not.toBeNull();
      expect(result?.text).toBe("");
      expect(result?.finishReason).toBe("stop");
    });
  });

  describe("findMatch - once mock auto-removal", () => {
    test("removes a once mock after it is matched once", async () => {
      const manager = MockManager.getInstance();

      manager.register({
        id: "single-use",
        matcher: () => true,
        response: { text: "only once" },
        once: true,
      });

      expect(manager.getCount()).toBe(1);

      const first = await manager.findMatch(createContext());
      expect(first?.text).toBe("only once");

      // The mock should have been removed after the first match
      expect(manager.getCount()).toBe(0);
    });

    test("returns fallback on second call after once mock is removed (non-strict)", async () => {
      const manager = MockManager.getInstance({ strictMode: false });

      manager.register({
        id: "once-mock",
        matcher: () => true,
        response: { text: "first and only" },
        once: true,
      });

      const first = await manager.findMatch(createContext());
      expect(first?.text).toBe("first and only");

      // Second call — mock has been removed; non-strict returns empty response
      const second = await manager.findMatch(createContext());
      expect(second?.text).toBe("");
      expect(second?.finishReason).toBe("stop");
    });

    test("non-once mock remains after multiple matches", async () => {
      const manager = MockManager.getInstance();

      manager.register({
        id: "persistent-mock",
        matcher: () => true,
        response: { text: "persistent" },
      });

      await manager.findMatch(createContext());
      await manager.findMatch(createContext());

      // Mock should still be registered
      expect(manager.getCount()).toBe(1);
    });
  });

  describe("strict mode - no match throws", () => {
    test("throws when no mocks are registered and strict mode is on", async () => {
      const manager = MockManager.getInstance({ strictMode: true });

      await expect(manager.findMatch(createContext("unknown-model"))).rejects.toThrow(
        "No mock registered for mock:unknown-model",
      );
    });
  });

  describe("non-strict mode - no match returns empty response", () => {
    test("returns empty response when no mocks registered in non-strict mode", async () => {
      const manager = MockManager.getInstance({ strictMode: false });

      const result = await manager.findMatch(createContext("any-model"));

      expect(result).not.toBeNull();
      expect(result?.text).toBe("");
      expect(result?.finishReason).toBe("stop");
      expect(result?.usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    });
  });
});
