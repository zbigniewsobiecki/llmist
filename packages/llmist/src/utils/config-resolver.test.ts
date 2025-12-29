/**
 * Tests for config-resolver utility - helps subagent gadgets resolve
 * configuration from multiple sources with proper priority.
 */

import { describe, expect, test } from "vitest";
import type { ExecutionContext } from "../gadgets/types.js";
import {
  resolveConfig,
  resolveSubagentModel,
  resolveSubagentTimeout,
  resolveValue,
} from "./config-resolver.js";

// Helper to create a minimal ExecutionContext for testing
function createTestContext(
  opts: {
    agentConfig?: { model?: string; temperature?: number };
    subagentConfig?: Record<string, Record<string, unknown>>;
  } = {},
): ExecutionContext {
  return {
    reportCost: () => {},
    agentConfig: opts.agentConfig,
    subagentConfig: opts.subagentConfig,
  };
}

describe("config-resolver", () => {
  describe("resolveValue", () => {
    test("returns runtime value when provided (highest priority)", () => {
      const ctx = createTestContext({
        agentConfig: { model: "opus" },
        subagentConfig: { MyGadget: { model: "haiku" } },
      });

      const result = resolveValue(ctx, "MyGadget", {
        runtime: "sonnet",
        subagentKey: "model",
        parentKey: "model",
        defaultValue: "flash",
      });

      expect(result).toBe("sonnet");
    });

    test("returns subagent config when runtime not provided", () => {
      const ctx = createTestContext({
        agentConfig: { model: "opus" },
        subagentConfig: { MyGadget: { model: "haiku" } },
      });

      const result = resolveValue(ctx, "MyGadget", {
        runtime: undefined,
        subagentKey: "model",
        parentKey: "model",
        defaultValue: "flash",
      });

      expect(result).toBe("haiku");
    });

    test("returns parent config when subagent config not available", () => {
      const ctx = createTestContext({
        agentConfig: { model: "opus" },
        subagentConfig: {}, // No config for MyGadget
      });

      const result = resolveValue(ctx, "MyGadget", {
        runtime: undefined,
        subagentKey: "model",
        parentKey: "model",
        defaultValue: "flash",
      });

      expect(result).toBe("opus");
    });

    test("returns default when no other values available", () => {
      const ctx = createTestContext();

      const result = resolveValue(ctx, "MyGadget", {
        runtime: undefined,
        subagentKey: "model",
        parentKey: "model",
        defaultValue: "flash",
      });

      expect(result).toBe("flash");
    });

    test("handles 'inherit' string in runtime - falls through to subagent config", () => {
      const ctx = createTestContext({
        agentConfig: { model: "opus" },
        subagentConfig: { MyGadget: { model: "haiku" } },
      });

      const result = resolveValue(ctx, "MyGadget", {
        runtime: "inherit",
        subagentKey: "model",
        parentKey: "model",
        defaultValue: "flash",
        handleInherit: true,
      });

      expect(result).toBe("haiku");
    });

    test("handles 'inherit' string in subagent config - falls through to parent", () => {
      const ctx = createTestContext({
        agentConfig: { model: "opus" },
        subagentConfig: { MyGadget: { model: "inherit" } },
      });

      const result = resolveValue(ctx, "MyGadget", {
        runtime: undefined,
        subagentKey: "model",
        parentKey: "model",
        defaultValue: "flash",
        handleInherit: true,
      });

      expect(result).toBe("opus");
    });

    test("inherit handling disabled by default", () => {
      const ctx = createTestContext({
        agentConfig: { model: "opus" },
      });

      const result = resolveValue(ctx, "MyGadget", {
        runtime: "inherit", // String literal, not handled specially
        subagentKey: "model",
        parentKey: "model",
        defaultValue: "flash",
        // handleInherit defaults to false
      });

      expect(result).toBe("inherit"); // Returned as-is
    });

    test("works without parentKey - skips parent config", () => {
      const ctx = createTestContext({
        agentConfig: { model: "opus" },
        subagentConfig: {},
      });

      const result = resolveValue(ctx, "MyGadget", {
        runtime: undefined,
        subagentKey: "maxIterations",
        // No parentKey
        defaultValue: 10,
      });

      expect(result).toBe(10);
    });

    test("works without subagentKey - skips subagent config", () => {
      const ctx = createTestContext({
        agentConfig: { model: "opus" },
        subagentConfig: { MyGadget: { model: "haiku" } },
      });

      const result = resolveValue(ctx, "MyGadget", {
        runtime: undefined,
        // No subagentKey
        parentKey: "model",
        defaultValue: "flash",
      });

      expect(result).toBe("opus"); // Goes straight to parent
    });

    test("handles non-string values correctly", () => {
      const ctx = createTestContext({
        subagentConfig: {
          BrowseWeb: {
            maxIterations: 20,
            headless: false,
            timeout: 30000,
          },
        },
      });

      const iterations = resolveValue(ctx, "BrowseWeb", {
        runtime: undefined,
        subagentKey: "maxIterations",
        defaultValue: 15,
      });
      expect(iterations).toBe(20);

      const headless = resolveValue(ctx, "BrowseWeb", {
        runtime: undefined,
        subagentKey: "headless",
        defaultValue: true,
      });
      expect(headless).toBe(false);

      const timeout = resolveValue(ctx, "BrowseWeb", {
        runtime: 60000,
        subagentKey: "timeout",
        defaultValue: 15000,
      });
      expect(timeout).toBe(60000);
    });

    test("handles null subagentConfig gracefully", () => {
      const ctx = createTestContext({
        agentConfig: { model: "opus" },
        // subagentConfig is undefined
      });

      const result = resolveValue(ctx, "MyGadget", {
        runtime: undefined,
        subagentKey: "model",
        parentKey: "model",
        defaultValue: "flash",
      });

      expect(result).toBe("opus"); // Falls through to parent
    });

    test("handles null agentConfig gracefully", () => {
      const ctx = createTestContext({
        // agentConfig is undefined
        subagentConfig: {},
      });

      const result = resolveValue(ctx, "MyGadget", {
        runtime: undefined,
        subagentKey: "model",
        parentKey: "model",
        defaultValue: "flash",
      });

      expect(result).toBe("flash"); // Falls through to default
    });
  });

  describe("resolveConfig", () => {
    test("resolves multiple config values at once", () => {
      const ctx = createTestContext({
        agentConfig: { model: "opus" },
        subagentConfig: {
          BrowseWeb: {
            maxIterations: 25,
            headless: false,
          },
        },
      });

      const config = resolveConfig<{
        model: string;
        maxIterations: number;
        headless: boolean;
        timeout: number;
      }>(ctx, "BrowseWeb", {
        model: {
          runtime: undefined,
          subagentKey: "model",
          parentKey: "model",
          defaultValue: "sonnet",
          handleInherit: true,
        },
        maxIterations: {
          runtime: undefined,
          subagentKey: "maxIterations",
          defaultValue: 15,
        },
        headless: {
          runtime: true, // Runtime override
          subagentKey: "headless",
          defaultValue: true,
        },
        timeout: {
          runtime: undefined,
          subagentKey: "timeout",
          defaultValue: 30000,
        },
      });

      expect(config.model).toBe("opus"); // From parent (no subagent config)
      expect(config.maxIterations).toBe(25); // From subagent config
      expect(config.headless).toBe(true); // From runtime override
      expect(config.timeout).toBe(30000); // From default
    });

    test("returns typed config object", () => {
      const ctx = createTestContext();

      const config = resolveConfig<{
        enabled: boolean;
        count: number;
        name: string;
      }>(ctx, "TestGadget", {
        enabled: { runtime: true, defaultValue: false },
        count: { runtime: undefined, defaultValue: 5 },
        name: { runtime: "test", defaultValue: "default" },
      });

      // TypeScript should know these types
      const enabled: boolean = config.enabled;
      const count: number = config.count;
      const name: string = config.name;

      expect(enabled).toBe(true);
      expect(count).toBe(5);
      expect(name).toBe("test");
    });
  });

  describe("resolveSubagentModel", () => {
    test("returns runtime model when provided", () => {
      const ctx = createTestContext({
        agentConfig: { model: "opus" },
        subagentConfig: { BrowseWeb: { model: "haiku" } },
      });

      const model = resolveSubagentModel(ctx, "BrowseWeb", "flash", "sonnet");
      expect(model).toBe("flash");
    });

    test("returns subagent config model when no runtime", () => {
      const ctx = createTestContext({
        agentConfig: { model: "opus" },
        subagentConfig: { BrowseWeb: { model: "haiku" } },
      });

      const model = resolveSubagentModel(ctx, "BrowseWeb", undefined, "sonnet");
      expect(model).toBe("haiku");
    });

    test("returns parent model when subagent config is 'inherit'", () => {
      const ctx = createTestContext({
        agentConfig: { model: "opus" },
        subagentConfig: { BrowseWeb: { model: "inherit" } },
      });

      const model = resolveSubagentModel(ctx, "BrowseWeb", undefined, "sonnet");
      expect(model).toBe("opus");
    });

    test("returns parent model when no subagent config", () => {
      const ctx = createTestContext({
        agentConfig: { model: "opus" },
      });

      const model = resolveSubagentModel(ctx, "BrowseWeb", undefined, "sonnet");
      expect(model).toBe("opus");
    });

    test("returns default when nothing else available", () => {
      const ctx = createTestContext();

      const model = resolveSubagentModel(ctx, "BrowseWeb", undefined, "sonnet");
      expect(model).toBe("sonnet");
    });

    test("handles runtime 'inherit' string", () => {
      const ctx = createTestContext({
        agentConfig: { model: "opus" },
        subagentConfig: { BrowseWeb: { model: "haiku" } },
      });

      // Even with subagent config, 'inherit' should fall through to parent
      const model = resolveSubagentModel(ctx, "BrowseWeb", "inherit", "sonnet");
      expect(model).toBe("haiku"); // Falls to subagent config first
    });
  });

  describe("resolveSubagentTimeout", () => {
    test("returns runtime timeout when provided (highest priority)", () => {
      const ctx = createTestContext({
        subagentConfig: { BrowseWeb: { timeoutMs: 60000 } },
      });

      const timeout = resolveSubagentTimeout(ctx, "BrowseWeb", 120000, 30000);
      expect(timeout).toBe(120000); // Runtime takes precedence
    });

    test("returns subagent config timeout when no runtime", () => {
      const ctx = createTestContext({
        subagentConfig: { BrowseWeb: { timeoutMs: 600000 } },
      });

      const timeout = resolveSubagentTimeout(ctx, "BrowseWeb", undefined, 300000);
      expect(timeout).toBe(600000); // From subagent config
    });

    test("returns default when no subagent config timeout", () => {
      const ctx = createTestContext({
        subagentConfig: { BrowseWeb: { model: "haiku" } }, // No timeoutMs
      });

      const timeout = resolveSubagentTimeout(ctx, "BrowseWeb", undefined, 300000);
      expect(timeout).toBe(300000); // Default value
    });

    test("returns default when no context config at all", () => {
      const ctx = createTestContext();

      const timeout = resolveSubagentTimeout(ctx, "BrowseWeb", undefined, 300000);
      expect(timeout).toBe(300000); // Default value
    });

    test("allows timeout of 0 to disable timeout", () => {
      const ctx = createTestContext({
        subagentConfig: { BrowseWeb: { timeoutMs: 0 } },
      });

      const timeout = resolveSubagentTimeout(ctx, "BrowseWeb", undefined, 300000);
      expect(timeout).toBe(0); // Explicitly disabled
    });

    test("runtime timeout of 0 takes precedence", () => {
      const ctx = createTestContext({
        subagentConfig: { BrowseWeb: { timeoutMs: 600000 } },
      });

      const timeout = resolveSubagentTimeout(ctx, "BrowseWeb", 0, 300000);
      expect(timeout).toBe(0); // Runtime 0 overrides subagent config
    });
  });

  describe("Real-world usage patterns", () => {
    test("Dhalsim-style config resolution", () => {
      // Simulates how Dhalsim (BrowseWeb) would use this
      const ctx = createTestContext({
        agentConfig: { model: "opus", temperature: 0.7 },
        subagentConfig: {
          Dhalsim: {
            model: "haiku",
            maxIterations: 20,
            headless: true,
            viewport: { width: 1920, height: 1080 },
          },
        },
      });

      // Params that might come from the gadget call
      const params = {
        model: undefined as string | undefined,
        maxIterations: 30, // Override from params
        headless: undefined as boolean | undefined,
      };

      const model = resolveSubagentModel(ctx, "Dhalsim", params.model, "sonnet");
      expect(model).toBe("haiku");

      const config = resolveConfig<{
        maxIterations: number;
        headless: boolean;
        viewport: { width: number; height: number };
      }>(ctx, "Dhalsim", {
        maxIterations: {
          runtime: params.maxIterations,
          subagentKey: "maxIterations",
          defaultValue: 15,
        },
        headless: {
          runtime: params.headless,
          subagentKey: "headless",
          defaultValue: true,
        },
        viewport: {
          runtime: undefined,
          subagentKey: "viewport",
          defaultValue: { width: 1280, height: 720 },
        },
      });

      expect(config.maxIterations).toBe(30); // From params
      expect(config.headless).toBe(true); // From subagent config
      expect(config.viewport).toEqual({ width: 1920, height: 1080 }); // From subagent config
    });

    test("model inheritance from parent agent", () => {
      // Parent agent is using opus, subagent should inherit by default
      const ctx = createTestContext({
        agentConfig: { model: "opus" },
        subagentConfig: {
          SearchWeb: {}, // No model override - should inherit
        },
      });

      const model = resolveSubagentModel(ctx, "SearchWeb", undefined, "sonnet");
      expect(model).toBe("opus"); // Inherited from parent
    });

    test("explicit model override in subagent config", () => {
      // Parent uses opus, but we want subagent to use cheaper haiku
      const ctx = createTestContext({
        agentConfig: { model: "opus" },
        subagentConfig: {
          SearchWeb: { model: "haiku" },
        },
      });

      const model = resolveSubagentModel(ctx, "SearchWeb", undefined, "sonnet");
      expect(model).toBe("haiku"); // Explicitly set in subagent config
    });
  });
});
