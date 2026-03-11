import type { ILogObj, Logger } from "tslog";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LLMist } from "../core/client.js";
import { ExecutionTree } from "../core/execution-tree.js";
import { createGadget } from "../gadgets/create-gadget.js";
import { Gadget } from "../gadgets/typed-gadget.js";
import type { ExecutionContext, HostExports } from "../gadgets/types.js";
import { AgentBuilder } from "./builder.js";
import type { AgentHooks } from "./hooks.js";
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

  it("should forward systemPrompt from options to builder", () => {
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      hostExports: mockHostExports,
    };

    const systemPrompt = "You are a specialized subagent for testing.";

    const builder = createSubagent(ctx, {
      name: "TestSubagent",
      gadgets: [],
      systemPrompt,
    });

    // Verify systemPrompt was forwarded to the builder
    const builderInternal = builder as unknown as { systemPrompt?: string };
    expect(builderInternal.systemPrompt).toBe(systemPrompt);
  });

  it("should not set systemPrompt when not provided in options", () => {
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      hostExports: mockHostExports,
    };

    const builder = createSubagent(ctx, {
      name: "TestSubagent",
      gadgets: [],
      // No systemPrompt
    });

    const builderInternal = builder as unknown as { systemPrompt?: string };
    expect(builderInternal.systemPrompt).toBeUndefined();
  });

  it("should forward hooks from options to builder", () => {
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      hostExports: mockHostExports,
    };

    const hooks: AgentHooks = {
      observers: {
        onLLMCallStart: vi.fn(),
      },
    };

    const builder = createSubagent(ctx, {
      name: "TestSubagent",
      gadgets: [],
      hooks,
    });

    // Verify hooks were forwarded to the builder
    const builderInternal = builder as unknown as { hooks?: AgentHooks };
    expect(builderInternal.hooks).toBe(hooks);
  });

  it("should not set hooks when not provided in options", () => {
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      hostExports: mockHostExports,
    };

    const builder = createSubagent(ctx, {
      name: "TestSubagent",
      gadgets: [],
      // No hooks
    });

    const builderInternal = builder as unknown as { hooks?: AgentHooks };
    expect(builderInternal.hooks).toBeUndefined();
  });

  it("should forward temperature from options to builder", () => {
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      hostExports: mockHostExports,
    };

    const temperature = 0.7;

    const builder = createSubagent(ctx, {
      name: "TestSubagent",
      gadgets: [],
      temperature,
    });

    // Verify temperature was forwarded to the builder
    const builderInternal = builder as unknown as { temperature?: number };
    expect(builderInternal.temperature).toBe(temperature);
  });

  it("should not set temperature when not provided in options", () => {
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      hostExports: mockHostExports,
    };

    const builder = createSubagent(ctx, {
      name: "TestSubagent",
      gadgets: [],
      // No temperature
    });

    const builderInternal = builder as unknown as { temperature?: number };
    expect(builderInternal.temperature).toBeUndefined();
  });

  it("should forward logger from context to builder", () => {
    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger<ILogObj>;

    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      hostExports: mockHostExports,
      logger: mockLogger,
    };

    const builder = createSubagent(ctx, {
      name: "TestSubagent",
      gadgets: [],
    });

    // Verify logger was forwarded from context to the builder
    const builderInternal = builder as unknown as { logger?: Logger<ILogObj> };
    expect(builderInternal.logger).toBe(mockLogger);
  });

  it("should not set logger when context has no logger", () => {
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      hostExports: mockHostExports,
      // No logger
    };

    const builder = createSubagent(ctx, {
      name: "TestSubagent",
      gadgets: [],
    });

    const builderInternal = builder as unknown as { logger?: Logger<ILogObj> };
    expect(builderInternal.logger).toBeUndefined();
  });

  it("should correctly resolve model with inherit support - uses parent model when inherit keyword", () => {
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      hostExports: mockHostExports,
      // Parent agent is using sonnet
      agentConfig: {
        model: "anthropic:claude-sonnet-4-5",
      },
    };

    const builder = createSubagent(ctx, {
      name: "TestSubagent",
      gadgets: [],
      model: "inherit", // Should fall through to parent model
      defaultModel: "anthropic:claude-haiku-4-5",
    });

    // When model is "inherit", should use parent's model from agentConfig
    const builderInternal = builder as unknown as { model?: string };
    expect(builderInternal.model).toBe("anthropic:claude-sonnet-4-5");
  });

  it("should correctly resolve model - uses runtime model when explicitly provided", () => {
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      hostExports: mockHostExports,
      agentConfig: {
        model: "anthropic:claude-sonnet-4-5",
      },
    };

    const runtimeModel = "anthropic:claude-haiku-4-5";

    const builder = createSubagent(ctx, {
      name: "TestSubagent",
      gadgets: [],
      model: runtimeModel, // Explicit runtime model takes priority
    });

    // Runtime model should take precedence over parent model
    const builderInternal = builder as unknown as { model?: string };
    expect(builderInternal.model).toBe(runtimeModel);
  });

  it("should correctly resolve model - falls back to defaultModel when no parent config", () => {
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      hostExports: mockHostExports,
      // No agentConfig - no parent model available
    };

    const builder = createSubagent(ctx, {
      name: "TestSubagent",
      gadgets: [],
      defaultModel: "anthropic:claude-haiku-4-5",
    });

    // Should fall back to defaultModel
    const builderInternal = builder as unknown as { model?: string };
    expect(builderInternal.model).toBe("anthropic:claude-haiku-4-5");
  });

  it("should correctly resolve model from subagentConfig when available", () => {
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      hostExports: mockHostExports,
      subagentConfig: {
        TestSubagent: {
          model: "anthropic:claude-haiku-4-5",
        },
      },
    };

    const builder = createSubagent(ctx, {
      name: "TestSubagent",
      gadgets: [],
      defaultModel: "anthropic:claude-sonnet-4-5",
    });

    // subagentConfig model should override defaultModel
    const builderInternal = builder as unknown as { model?: string };
    expect(builderInternal.model).toBe("anthropic:claude-haiku-4-5");
  });

  it("should verify builder methods called via spies", () => {
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      hostExports: mockHostExports,
    };

    const withSystemSpy = vi.spyOn(AgentBuilder.prototype, "withSystem");
    const withHooksSpy = vi.spyOn(AgentBuilder.prototype, "withHooks");
    const withTemperatureSpy = vi.spyOn(AgentBuilder.prototype, "withTemperature");

    const hooks: AgentHooks = { observers: {} };
    const systemPrompt = "System prompt for spy test";
    const temperature = 0.5;

    createSubagent(ctx, {
      name: "TestSubagent",
      gadgets: [],
      systemPrompt,
      hooks,
      temperature,
    });

    expect(withSystemSpy).toHaveBeenCalledWith(systemPrompt);
    expect(withHooksSpy).toHaveBeenCalledWith(hooks);
    expect(withTemperatureSpy).toHaveBeenCalledWith(temperature);

    withSystemSpy.mockRestore();
    withHooksSpy.mockRestore();
    withTemperatureSpy.mockRestore();
  });
});

describe("getHostExports (via createSubagent error path)", () => {
  it("should throw descriptive error when ctx.hostExports is undefined", () => {
    const ctx = {
      reportCost: () => {},
      signal: new AbortController().signal,
      // No hostExports!
    } as ExecutionContext;

    expect(() =>
      createSubagent(ctx, {
        name: "TestSubagent",
        gadgets: [],
      }),
    ).toThrowError(
      "hostExports not available. Subagent gadgets must be run via llmist agent. " +
        "Ensure you are using llmist >= 6.2.0 and running through the CLI or AgentBuilder.",
    );
  });

  it("should throw error mentioning hostExports when ctx is bare object without hostExports", () => {
    const ctx = {
      reportCost: () => {},
      signal: new AbortController().signal,
    } as ExecutionContext;

    expect(() =>
      createSubagent(ctx, {
        name: "AnotherSubagent",
        gadgets: [],
      }),
    ).toThrowError("hostExports not available");
  });

  it("should throw error with guidance about llmist version", () => {
    const ctx = {} as ExecutionContext;

    expect(() =>
      createSubagent(ctx, {
        name: "TestSubagent",
        gadgets: [],
      }),
    ).toThrowError("llmist >= 6.2.0");
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
