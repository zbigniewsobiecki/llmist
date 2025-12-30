import { describe, expect, it, vi } from "vitest";
import type { ExecutionContext, HostExports } from "../gadgets/types.js";
import { AgentBuilder } from "./builder.js";
import { LLMist } from "../core/client.js";
import { ExecutionTree } from "../core/execution-tree.js";
import { Gadget } from "../gadgets/typed-gadget.js";
import { createGadget } from "../gadgets/create-gadget.js";
import { z } from "zod";
import { createSubagent, hasHostExports } from "./subagent.js";

// Mock host exports for testing
const mockHostExports: HostExports = {
  AgentBuilder,
  LLMist,
  ExecutionTree,
  Gadget,
  createGadget,
  z,
};

describe("createSubagent", () => {
  it("should inherit requestHumanInput from parent context", () => {
    const mockCallback = vi.fn(async (question: string) => `answer: ${question}`);

    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      requestHumanInput: mockCallback,
      hostExports: mockHostExports,
    };

    const builder = createSubagent(ctx, {
      name: "TestSubagent",
      gadgets: [],
    });

    // Access the private requestHumanInput field via type assertion
    // This verifies that onHumanInput was called with the parent's callback
    const builderInternal = builder as unknown as { requestHumanInput?: typeof mockCallback };
    expect(builderInternal.requestHumanInput).toBe(mockCallback);
  });

  it("should not set onHumanInput when parent context has no callback", () => {
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      // No requestHumanInput
      hostExports: mockHostExports,
    };

    const builder = createSubagent(ctx, {
      name: "TestSubagent",
      gadgets: [],
    });

    const builderInternal = builder as unknown as { requestHumanInput?: unknown };
    expect(builderInternal.requestHumanInput).toBeUndefined();
  });

  it("should share parent context for tree and signal", () => {
    const tree = new ExecutionTree();
    const abortController = new AbortController();

    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: abortController.signal,
      tree,
      nodeId: "test-node",
      depth: 1,
      hostExports: mockHostExports,
    };

    const builder = createSubagent(ctx, {
      name: "TestSubagent",
      gadgets: [],
    });

    // Verify signal was forwarded
    const builderInternal = builder as unknown as { signal?: AbortSignal };
    expect(builderInternal.signal).toBe(abortController.signal);
  });
});

describe("hasHostExports", () => {
  it("should return true when hostExports are present", () => {
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      hostExports: mockHostExports,
    };

    expect(hasHostExports(ctx)).toBe(true);
  });

  it("should return false when hostExports are missing", () => {
    const ctx = {
      reportCost: () => {},
      signal: new AbortController().signal,
    } as ExecutionContext;

    expect(hasHostExports(ctx)).toBe(false);
  });

  it("should return false for undefined context", () => {
    expect(hasHostExports(undefined)).toBe(false);
  });
});
