import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentBuilder } from "../agent/builder.js";
import { LLMist } from "../core/client.js";
import { ExecutionTree } from "../core/execution-tree.js";
import { getHostExports } from "../index.js";
import { createGadget } from "./create-gadget.js";
import { Gadget } from "./typed-gadget.js";
import type { ExecutionContext, HostExports } from "./types.js";

describe("getHostExports", () => {
  // Create a valid hostExports object for testing
  const validHostExports: HostExports = {
    AgentBuilder,
    Gadget,
    createGadget,
    ExecutionTree,
    LLMist,
    z,
  };

  it("returns hostExports when context has them", () => {
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      hostExports: validHostExports,
    };

    const result = getHostExports(ctx);

    expect(result).toBe(validHostExports);
    expect(result.AgentBuilder).toBe(AgentBuilder);
    expect(result.Gadget).toBe(Gadget);
    expect(result.createGadget).toBe(createGadget);
    expect(result.ExecutionTree).toBe(ExecutionTree);
    expect(result.LLMist).toBe(LLMist);
    expect(result.z).toBe(z);
  });

  it("throws error when context is undefined", () => {
    expect(() => {
      // @ts-expect-error Testing undefined context
      getHostExports(undefined);
    }).toThrow("hostExports not available");
  });

  it("throws error when context has no hostExports", () => {
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      // No hostExports
    };

    expect(() => {
      getHostExports(ctx);
    }).toThrow("hostExports not available");
  });

  it("error message mentions llmist version requirement", () => {
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
    };

    expect(() => {
      getHostExports(ctx);
    }).toThrow("llmist >= 6.2.0");
  });
});
