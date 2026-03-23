import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the file-logging module before importing HookComposer
vi.mock("./file-logging.js", () => ({
  getEnvFileLoggingHooks: vi.fn().mockReturnValue(null),
}));

import { getEnvFileLoggingHooks } from "./file-logging.js";
import { HookComposer } from "./hook-composer.js";
import type { LLMCallControllerContext } from "./hooks.js";

// Helper to create a minimal LLMCallControllerContext
function makeLLMCallControllerContext(
  overrides: Partial<LLMCallControllerContext> = {},
): LLMCallControllerContext {
  return {
    iteration: 1,
    maxIterations: 10,
    budget: 1.0,
    totalCost: 0,
    options: {
      model: "gpt-4o",
      messages: [],
    },
    logger: {} as never,
    ...overrides,
  };
}

describe("HookComposer", () => {
  beforeEach(() => {
    vi.mocked(getEnvFileLoggingHooks).mockReturnValue(null);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("compose()", () => {
    it("returns undefined when called with no arguments", () => {
      const result = HookComposer.compose();
      expect(result).toBeUndefined();
    });

    it("returns user hooks as-is when no trailing message and no env logging", () => {
      const userHooks = {
        observers: {
          onLLMCallStart: vi.fn(),
        },
      };
      const result = HookComposer.compose(userHooks);
      expect(result).toBe(userHooks);
    });

    it("appends static trailing message as ephemeral user message via beforeLLMCall", async () => {
      const result = HookComposer.compose(undefined, "Remember to be concise.");
      expect(result).toBeDefined();
      expect(result?.controllers?.beforeLLMCall).toBeDefined();

      const ctx = makeLLMCallControllerContext({
        options: {
          model: "gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
      });
      const action = await result!.controllers!.beforeLLMCall!(ctx);

      expect(action.action).toBe("proceed");
      if (action.action === "proceed") {
        const messages = action.modifiedOptions?.messages;
        expect(messages).toBeDefined();
        expect(messages?.at(-1)).toEqual({ role: "user", content: "Remember to be concise." });
      }
    });

    it("calls function trailing message with iteration context fields", async () => {
      const trailingMessageFn = vi.fn().mockReturnValue("Iteration 2 of 10");
      const result = HookComposer.compose(undefined, trailingMessageFn);
      expect(result).toBeDefined();

      const ctx = makeLLMCallControllerContext({
        iteration: 2,
        maxIterations: 10,
        budget: 5.0,
        totalCost: 1.5,
      });
      await result!.controllers!.beforeLLMCall!(ctx);

      expect(trailingMessageFn).toHaveBeenCalledWith({
        iteration: 2,
        maxIterations: 10,
        budget: 5.0,
        totalCost: 1.5,
      });
    });

    it("preserves 'skip' action from existing beforeLLMCall and does not inject trailing message", async () => {
      const existingController = vi.fn().mockResolvedValue({
        action: "skip",
        syntheticResponse: "Cached response",
      });

      const userHooks = {
        controllers: {
          beforeLLMCall: existingController,
        },
      };

      const result = HookComposer.compose(userHooks, "Should not be injected");
      expect(result).toBeDefined();

      const ctx = makeLLMCallControllerContext({
        options: {
          model: "gpt-4o",
          messages: [{ role: "user", content: "Query" }],
        },
      });
      const action = await result!.controllers!.beforeLLMCall!(ctx);

      expect(action.action).toBe("skip");
      if (action.action === "skip") {
        expect(action.syntheticResponse).toBe("Cached response");
      }
    });

    it("merges env file logging hooks with user hooks when env logging is active", () => {
      const envObserver = vi.fn();
      const userObserver = vi.fn();

      vi.mocked(getEnvFileLoggingHooks).mockReturnValue({
        observers: {
          onLLMCallStart: envObserver,
        },
      });

      const userHooks = {
        observers: {
          onLLMCallComplete: userObserver,
        },
      };

      const result = HookComposer.compose(userHooks);
      expect(result).toBeDefined();
      // Both hooks should be present in the merged result
      expect(result?.observers?.onLLMCallStart).toBeDefined();
      expect(result?.observers?.onLLMCallComplete).toBeDefined();
    });

    it("uses env hooks alone when no user hooks provided and env logging is active", () => {
      const envObserver = vi.fn();

      vi.mocked(getEnvFileLoggingHooks).mockReturnValue({
        observers: {
          onLLMCallStart: envObserver,
        },
      });

      const result = HookComposer.compose();
      expect(result).toBeDefined();
      expect(result?.observers?.onLLMCallStart).toBeDefined();
    });

    it("runs existing beforeLLMCall first, then injects trailing message", async () => {
      const callOrder: string[] = [];

      const existingController = vi.fn().mockImplementation(async () => {
        callOrder.push("existing");
        return { action: "proceed" };
      });

      const userHooks = {
        controllers: {
          beforeLLMCall: existingController,
        },
      };

      const result = HookComposer.compose(userHooks, "Trailing message");
      const ctx = makeLLMCallControllerContext({
        options: {
          model: "gpt-4o",
          messages: [],
        },
      });
      const action = await result!.controllers!.beforeLLMCall!(ctx);

      // Existing controller must have run
      expect(existingController).toHaveBeenCalledOnce();
      // Trailing message should be in the modified options
      expect(action.action).toBe("proceed");
      if (action.action === "proceed") {
        const lastMessage = action.modifiedOptions?.messages?.at(-1);
        expect(lastMessage).toEqual({ role: "user", content: "Trailing message" });
      }
      // Existing controller ran before trailing injection
      expect(callOrder[0]).toBe("existing");
    });
  });
});
