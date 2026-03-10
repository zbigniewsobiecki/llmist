/**
 * Unit tests for OutputLimitManager.
 *
 * Tests cover:
 * - Char limit calculation from model context window
 * - Fallback context window when model is unknown
 * - GadgetOutputViewer registration when enabled
 * - Hook chaining: limiter interceptor runs first, user interceptor runs after
 * - Output limiting: oversized results are stored and replaced with a reference
 * - GadgetOutputViewer results are not limited (recursion prevention)
 * - isEnabled() reflects config
 * - getOutputStore() returns the store
 * - Disabled mode: no viewer registered, user hooks returned unchanged
 */

import type { ILogObj, Logger } from "tslog";
import { describe, expect, it, vi } from "vitest";
import type { LLMist } from "../core/client.js";
import {
  CHARS_PER_TOKEN,
  DEFAULT_GADGET_OUTPUT_LIMIT_PERCENT,
  FALLBACK_CONTEXT_WINDOW,
} from "../core/constants.js";
import type { ModelRegistry } from "../core/model-registry.js";
import { GadgetRegistry } from "../gadgets/registry.js";
import type { AgentHooks, GadgetResultInterceptorContext } from "./hooks.js";
import { OutputLimitManager } from "./output-limit-manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLogger(): Logger<ILogObj> {
  return {
    warn: vi.fn(() => {}),
    debug: vi.fn(() => {}),
    info: vi.fn(() => {}),
    error: vi.fn(() => {}),
    trace: vi.fn(() => {}),
    fatal: vi.fn(() => {}),
    silly: vi.fn(() => {}),
  } as unknown as Logger<ILogObj>;
}

function createMockClient(contextWindow?: number): LLMist {
  const modelRegistry = {
    getModelLimits: vi.fn((_model: string) =>
      contextWindow !== undefined ? { contextWindow, maxOutputTokens: 4096 } : undefined,
    ),
    getModelSpec: vi.fn(() => undefined),
    estimateCost: vi.fn(() => undefined),
  } as unknown as ModelRegistry;

  return { modelRegistry } as unknown as LLMist;
}

function createGadgetResultCtx(
  gadgetName: string,
  overrides: Partial<GadgetResultInterceptorContext> = {},
): GadgetResultInterceptorContext {
  return {
    gadgetName,
    invocationId: "inv-001",
    iteration: 1,
    parameters: {},
    executionTimeMs: 1,
    logger: createMockLogger(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OutputLimitManager", () => {
  // =========================================================================
  // Construction
  // =========================================================================

  describe("constructor", () => {
    it("should be enabled by default when config.enabled is undefined", () => {
      const client = createMockClient(128_000);
      const registry = new GadgetRegistry();

      const manager = new OutputLimitManager(client, "gpt-4o", {}, registry);

      expect(manager.isEnabled()).toBe(true);
    });

    it("should be disabled when config.enabled is false", () => {
      const client = createMockClient(128_000);
      const registry = new GadgetRegistry();

      const manager = new OutputLimitManager(client, "gpt-4o", { enabled: false }, registry);

      expect(manager.isEnabled()).toBe(false);
    });

    it("should register GadgetOutputViewer when enabled", () => {
      const client = createMockClient(128_000);
      const registry = new GadgetRegistry();

      new OutputLimitManager(client, "gpt-4o", { enabled: true }, registry);

      // GadgetOutputViewer should be registered
      expect(registry.has("GadgetOutputViewer")).toBe(true);
    });

    it("should NOT register GadgetOutputViewer when disabled", () => {
      const client = createMockClient(128_000);
      const registry = new GadgetRegistry();

      new OutputLimitManager(client, "gpt-4o", { enabled: false }, registry);

      expect(registry.has("GadgetOutputViewer")).toBe(false);
    });
  });

  // =========================================================================
  // Char limit calculation
  // =========================================================================

  describe("char limit calculation", () => {
    it("should calculate char limit from model context window", () => {
      const contextWindow = 200_000;
      const limitPercent = 10;
      const client = createMockClient(contextWindow);
      const registry = new GadgetRegistry();

      const manager = new OutputLimitManager(client, "claude-3-opus", { limitPercent }, registry);

      // charLimit = floor(contextWindow * (limitPercent / 100) * CHARS_PER_TOKEN)
      const expectedCharLimit = Math.floor(contextWindow * (limitPercent / 100) * CHARS_PER_TOKEN);

      // Generate a string just at the limit (should NOT be stored)
      const hooks = manager.getHooks();
      const ctx = createGadgetResultCtx("TestGadget");
      const result = "x".repeat(expectedCharLimit);
      const intercepted = hooks.interceptors?.interceptGadgetResult?.(result, ctx);
      expect(intercepted).toBe(result); // not exceeded
    });

    it("should use FALLBACK_CONTEXT_WINDOW when model has no limits", () => {
      const client = createMockClient(undefined); // no limits for this model
      const registry = new GadgetRegistry();

      const manager = new OutputLimitManager(client, "unknown-model", {}, registry);

      // charLimit = floor(FALLBACK_CONTEXT_WINDOW * (DEFAULT_LIMIT_PERCENT / 100) * CHARS_PER_TOKEN)
      const expectedCharLimit = Math.floor(
        FALLBACK_CONTEXT_WINDOW * (DEFAULT_GADGET_OUTPUT_LIMIT_PERCENT / 100) * CHARS_PER_TOKEN,
      );

      const hooks = manager.getHooks();
      const ctx = createGadgetResultCtx("TestGadget");

      // Just at the limit — not truncated
      const atLimit = "x".repeat(expectedCharLimit);
      const result = hooks.interceptors?.interceptGadgetResult?.(atLimit, ctx);
      expect(result).toBe(atLimit);

      // One over the limit — truncated
      const overLimit = "x".repeat(expectedCharLimit + 1);
      const limitedResult = hooks.interceptors?.interceptGadgetResult?.(overLimit, ctx);
      expect(limitedResult).not.toBe(overLimit);
      expect(limitedResult).toContain("GadgetOutputViewer");
    });

    it("should use DEFAULT_GADGET_OUTPUT_LIMIT_PERCENT when limitPercent is not provided", () => {
      const contextWindow = 128_000;
      const client = createMockClient(contextWindow);
      const registry = new GadgetRegistry();

      const manager = new OutputLimitManager(client, "gpt-4o", {}, registry);

      const expectedCharLimit = Math.floor(
        contextWindow * (DEFAULT_GADGET_OUTPUT_LIMIT_PERCENT / 100) * CHARS_PER_TOKEN,
      );

      const hooks = manager.getHooks();
      const ctx = createGadgetResultCtx("TestGadget");

      // Just at the limit
      const atLimit = "x".repeat(expectedCharLimit);
      expect(hooks.interceptors?.interceptGadgetResult?.(atLimit, ctx)).toBe(atLimit);

      // One over the limit
      const overLimit = "x".repeat(expectedCharLimit + 1);
      const result = hooks.interceptors?.interceptGadgetResult?.(overLimit, ctx);
      expect(result).not.toBe(overLimit);
    });
  });

  // =========================================================================
  // Output limiting interceptor
  // =========================================================================

  describe("output limiting interceptor", () => {
    it("should return result unchanged when it is within the limit", () => {
      const client = createMockClient(128_000);
      const registry = new GadgetRegistry();
      const manager = new OutputLimitManager(client, "gpt-4o", { limitPercent: 15 }, registry);

      const hooks = manager.getHooks();
      const ctx = createGadgetResultCtx("TestGadget");
      const shortResult = "This is a short result";

      const intercepted = hooks.interceptors?.interceptGadgetResult?.(shortResult, ctx);
      expect(intercepted).toBe(shortResult);
    });

    it("should replace oversized result with reference message", () => {
      const client = createMockClient(100); // tiny context window for easy testing
      const registry = new GadgetRegistry();
      const manager = new OutputLimitManager(client, "small-model", { limitPercent: 10 }, registry);

      // charLimit = floor(100 * 0.10 * 4) = 40 chars
      const oversizedResult = "x".repeat(1000); // way over limit
      const hooks = manager.getHooks();
      const ctx = createGadgetResultCtx("MyGadget");
      const intercepted = hooks.interceptors?.interceptGadgetResult?.(oversizedResult, ctx);

      expect(intercepted).not.toBe(oversizedResult);
      expect(intercepted).toContain('Gadget "MyGadget" returned too much data');
      expect(intercepted).toContain("GadgetOutputViewer");
    });

    it("should store oversized output in the output store", () => {
      const client = createMockClient(100); // tiny context window
      const registry = new GadgetRegistry();
      const manager = new OutputLimitManager(client, "small-model", { limitPercent: 10 }, registry);

      const oversizedResult = "y".repeat(1000);
      const hooks = manager.getHooks();
      const ctx = createGadgetResultCtx("SearchGadget");
      hooks.interceptors?.interceptGadgetResult?.(oversizedResult, ctx);

      expect(manager.getOutputStore().size).toBe(1);
    });

    it("should include the storage ID in the reference message", () => {
      const client = createMockClient(100);
      const registry = new GadgetRegistry();
      const manager = new OutputLimitManager(client, "small-model", { limitPercent: 10 }, registry);

      const oversizedResult = "z".repeat(500);
      const hooks = manager.getHooks();
      const ctx = createGadgetResultCtx("FileReader");
      const intercepted = hooks.interceptors?.interceptGadgetResult?.(oversizedResult, ctx);

      const storedIds = manager.getOutputStore().getIds();
      expect(storedIds).toHaveLength(1);
      expect(intercepted).toContain(storedIds[0]);
    });

    it("should not limit GadgetOutputViewer results (recursion prevention)", () => {
      const client = createMockClient(100); // tiny context window
      const registry = new GadgetRegistry();
      const manager = new OutputLimitManager(client, "small-model", { limitPercent: 10 }, registry);

      // A large result from GadgetOutputViewer itself
      const largeViewerResult = "v".repeat(1000);
      const hooks = manager.getHooks();
      const ctx = createGadgetResultCtx("GadgetOutputViewer");

      const intercepted = hooks.interceptors?.interceptGadgetResult?.(largeViewerResult, ctx);

      // Should be returned unchanged — no storage, no reference message
      expect(intercepted).toBe(largeViewerResult);
      expect(manager.getOutputStore().size).toBe(0);
    });

    it("should log info when output is stored", () => {
      const client = createMockClient(100);
      const registry = new GadgetRegistry();
      const logger = createMockLogger();
      const manager = new OutputLimitManager(
        client,
        "small-model",
        { limitPercent: 10 },
        registry,
        logger,
      );

      const oversizedResult = "a".repeat(1000);
      const hooks = manager.getHooks();
      const ctx = createGadgetResultCtx("BigGadget");
      hooks.interceptors?.interceptGadgetResult?.(oversizedResult, ctx);

      expect(logger.info).toHaveBeenCalledWith(
        "Gadget output exceeded limit, stored for browsing",
        expect.objectContaining({ gadgetName: "BigGadget" }),
      );
    });
  });

  // =========================================================================
  // Hook chaining
  // =========================================================================

  describe("hook chaining", () => {
    it("should return limiter-only interceptor when no user hooks are provided", () => {
      const client = createMockClient(128_000);
      const registry = new GadgetRegistry();
      const manager = new OutputLimitManager(client, "gpt-4o", {}, registry);

      const hooks = manager.getHooks();

      expect(hooks.interceptors?.interceptGadgetResult).toBeDefined();
    });

    it("should preserve user interceptor and chain it after limiter", () => {
      const client = createMockClient(128_000);
      const registry = new GadgetRegistry();
      const manager = new OutputLimitManager(client, "gpt-4o", {}, registry);

      const userInterceptor = vi.fn((result: string) => `[USER] ${result}`);
      const userHooks: AgentHooks = {
        interceptors: { interceptGadgetResult: userInterceptor },
      };

      const hooks = manager.getHooks(userHooks);
      const ctx = createGadgetResultCtx("TestGadget");

      const intercepted = hooks.interceptors?.interceptGadgetResult?.("hello", ctx);

      // User interceptor should have been called
      expect(userInterceptor).toHaveBeenCalledWith("hello", ctx);
      expect(intercepted).toBe("[USER] hello");
    });

    it("should run limiter before user interceptor (limiter output fed to user interceptor)", () => {
      const client = createMockClient(100); // tiny context window
      const registry = new GadgetRegistry();
      const manager = new OutputLimitManager(client, "small-model", { limitPercent: 10 }, registry);

      const callOrder: string[] = [];
      let receivedByUser: string | undefined;

      const userInterceptor = vi.fn((result: string) => {
        callOrder.push("user");
        receivedByUser = result;
        return result;
      });

      const userHooks: AgentHooks = {
        interceptors: { interceptGadgetResult: userInterceptor },
      };

      const hooks = manager.getHooks(userHooks);
      const ctx = createGadgetResultCtx("BigGadget");
      const oversizedResult = "x".repeat(1000);

      hooks.interceptors?.interceptGadgetResult?.(oversizedResult, ctx);

      // User interceptor was called
      expect(callOrder).toContain("user");
      // User interceptor received the reference message (limiter output), not the original
      expect(receivedByUser).not.toBe(oversizedResult);
      expect(receivedByUser).toContain("GadgetOutputViewer");
    });

    it("should preserve other user interceptors unchanged when chaining", () => {
      const client = createMockClient(128_000);
      const registry = new GadgetRegistry();
      const manager = new OutputLimitManager(client, "gpt-4o", {}, registry);

      const rawChunkInterceptor = vi.fn((chunk: string) => chunk);
      const userHooks: AgentHooks = {
        interceptors: {
          interceptRawChunk: rawChunkInterceptor,
          interceptGadgetResult: (result: string) => `[USER] ${result}`,
        },
      };

      const hooks = manager.getHooks(userHooks);

      // The rawChunk interceptor should still be present
      expect(hooks.interceptors?.interceptRawChunk).toBe(rawChunkInterceptor);
    });

    it("should preserve user observers when chaining hooks", () => {
      const client = createMockClient(128_000);
      const registry = new GadgetRegistry();
      const manager = new OutputLimitManager(client, "gpt-4o", {}, registry);

      const onLLMCallStart = vi.fn();
      const userHooks: AgentHooks = {
        observers: { onLLMCallStart },
      };

      const hooks = manager.getHooks(userHooks);

      expect(hooks.observers?.onLLMCallStart).toBe(onLLMCallStart);
    });

    it("should preserve user controllers when chaining hooks", () => {
      const client = createMockClient(128_000);
      const registry = new GadgetRegistry();
      const manager = new OutputLimitManager(client, "gpt-4o", {}, registry);

      const beforeLLMCall = vi.fn();
      const userHooks: AgentHooks = {
        controllers: { beforeLLMCall } as AgentHooks["controllers"],
      };

      const hooks = manager.getHooks(userHooks);

      expect(hooks.controllers?.beforeLLMCall).toBe(beforeLLMCall);
    });
  });

  // =========================================================================
  // Disabled mode
  // =========================================================================

  describe("disabled mode", () => {
    it("should return user hooks unchanged when disabled", () => {
      const client = createMockClient(128_000);
      const registry = new GadgetRegistry();
      const manager = new OutputLimitManager(client, "gpt-4o", { enabled: false }, registry);

      const userInterceptor = vi.fn((result: string) => result);
      const userHooks: AgentHooks = {
        interceptors: { interceptGadgetResult: userInterceptor },
      };

      const hooks = manager.getHooks(userHooks);

      // Should be the original user hooks object, not wrapped
      expect(hooks).toBe(userHooks);
    });

    it("should return empty hooks when disabled and no user hooks", () => {
      const client = createMockClient(128_000);
      const registry = new GadgetRegistry();
      const manager = new OutputLimitManager(client, "gpt-4o", { enabled: false }, registry);

      const hooks = manager.getHooks();

      // Should be an empty object {}
      expect(hooks).toEqual({});
    });

    it("should NOT apply output limiting when disabled", () => {
      const client = createMockClient(100); // tiny context window
      const registry = new GadgetRegistry();
      const manager = new OutputLimitManager(
        client,
        "small-model",
        { enabled: false, limitPercent: 10 },
        registry,
      );

      const oversizedResult = "x".repeat(1000);
      const userHooks: AgentHooks = {};
      const hooks = manager.getHooks(userHooks);

      // No interceptor at all when disabled
      const intercepted = hooks.interceptors?.interceptGadgetResult?.(oversizedResult, {
        gadgetName: "TestGadget",
        invocationId: "inv-001",
        iteration: 1,
        parameters: {},
        executionTimeMs: 1,
        logger: createMockLogger(),
      });

      // interceptGadgetResult should not be defined (or not called)
      expect(manager.getOutputStore().size).toBe(0);
      expect(intercepted).toBeUndefined();
    });
  });

  // =========================================================================
  // getOutputStore
  // =========================================================================

  describe("getOutputStore", () => {
    it("should return the same store instance on multiple calls", () => {
      const client = createMockClient(128_000);
      const registry = new GadgetRegistry();
      const manager = new OutputLimitManager(client, "gpt-4o", {}, registry);

      const store1 = manager.getOutputStore();
      const store2 = manager.getOutputStore();

      expect(store1).toBe(store2);
    });

    it("should start empty", () => {
      const client = createMockClient(128_000);
      const registry = new GadgetRegistry();
      const manager = new OutputLimitManager(client, "gpt-4o", {}, registry);

      expect(manager.getOutputStore().size).toBe(0);
    });
  });

  // =========================================================================
  // Multiple oversized outputs
  // =========================================================================

  describe("multiple oversized outputs", () => {
    it("should store multiple oversized results separately", () => {
      const client = createMockClient(100);
      const registry = new GadgetRegistry();
      const manager = new OutputLimitManager(client, "small-model", { limitPercent: 10 }, registry);

      const hooks = manager.getHooks();
      const ctx1 = createGadgetResultCtx("Gadget1");
      const ctx2 = createGadgetResultCtx("Gadget2");

      hooks.interceptors?.interceptGadgetResult?.("x".repeat(1000), ctx1);
      hooks.interceptors?.interceptGadgetResult?.("y".repeat(1000), ctx2);

      expect(manager.getOutputStore().size).toBe(2);
    });

    it("should generate unique storage IDs for each oversized output", () => {
      const client = createMockClient(100);
      const registry = new GadgetRegistry();
      const manager = new OutputLimitManager(client, "small-model", { limitPercent: 10 }, registry);

      const hooks = manager.getHooks();
      const ctx = createGadgetResultCtx("SameGadget");

      hooks.interceptors?.interceptGadgetResult?.("a".repeat(1000), ctx);
      hooks.interceptors?.interceptGadgetResult?.("b".repeat(1000), ctx);

      const ids = manager.getOutputStore().getIds();
      expect(ids.length).toBe(2);
      expect(ids[0]).not.toBe(ids[1]);
    });
  });
});
