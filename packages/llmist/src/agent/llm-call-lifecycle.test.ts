/**
 * Unit tests for LLMCallLifecycle.
 *
 * Tests cover:
 * - prepareLLMCall: observer call order (onLLMCallStart before onLLMCallReady)
 * - prepareLLMCall: beforeLLMCall controller "skip" action returns skipWithSynthetic
 * - prepareLLMCall: beforeLLMCall controller "proceed" modifies options
 * - prepareLLMCall: returns llmNodeId from execution tree
 * - prepareLLMCall: no controller invocation when no controller defined
 * - completeLLMCall: fires onLLMCallComplete observer
 * - completeLLMCall: updates execution tree via completeLLMCall
 * - completeLLMCall: afterLLMCall controller "modify_and_continue" modifies message
 * - completeLLMCall: afterLLMCall controller "append_messages" adds messages to conversation
 * - completeLLMCall: afterLLMCall controller "append_and_modify" does both
 * - completeLLMCall: skips afterLLMCall controller for interrupted finishReason
 * - notifyLLMCallReady: fires onLLMCallReady observer
 * - notifyLLMError: fires onLLMCallError observer
 * - notifyLLMError: invokes afterLLMError controller
 * - notifyLLMError: returns "rethrow" when no controller defined
 * - notifyLLMError: observer "recovered" field reflects controller decision
 */

import type { ILogObj, Logger } from "tslog";
import { describe, expect, it, vi } from "vitest";
import type { LLMist } from "../core/client.js";
import { ExecutionTree } from "../core/execution-tree.js";
import type { ModelRegistry } from "../core/model-registry.js";
import type { LLMGenerationOptions } from "../core/options.js";
import type { StreamCompletionEvent } from "../gadgets/types.js";
import type { ConversationManager } from "./conversation-manager.js";
import type {
  AfterLLMCallAction,
  AfterLLMErrorAction,
  AgentHooks,
  BeforeLLMCallAction,
  ObserveLLMCallContext,
  ObserveLLMCallReadyContext,
  ObserveLLMCompleteContext,
  ObserveLLMErrorContext,
} from "./hooks.js";
import { LLMCallLifecycle, type LLMCallLifecycleOptions } from "./llm-call-lifecycle.js";

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

function createMockClient(): LLMist {
  const modelRegistry = {
    getModelLimits: vi.fn(() => ({ contextWindow: 128_000, maxOutputTokens: 4096 })),
    getModelSpec: vi.fn(() => undefined),
    estimateCost: vi.fn(() => undefined),
  } as unknown as ModelRegistry;

  return { modelRegistry } as unknown as LLMist;
}

function createMockConversation(
  messages: LLMGenerationOptions["messages"] = [],
): ConversationManager {
  return {
    addAssistantMessage: vi.fn(),
    addGadgetCallResult: vi.fn(),
    addUserMessage: vi.fn(),
    getMessages: vi.fn().mockReturnValue(messages),
    getHistoryMessages: vi.fn().mockReturnValue([]),
    getBaseMessages: vi.fn().mockReturnValue([]),
    replaceHistory: vi.fn(),
    getConversationHistory: vi.fn().mockReturnValue([]),
  } as unknown as ConversationManager;
}

function makeStreamCompletionEvent(
  overrides: Partial<StreamCompletionEvent> = {},
): StreamCompletionEvent {
  return {
    type: "stream_complete",
    finishReason: "stop",
    usage: { inputTokens: 10, outputTokens: 20 },
    rawResponse: "raw-response",
    finalMessage: "Hello from LLM",
    didExecuteGadgets: false,
    shouldBreakLoop: false,
    ...overrides,
  };
}

function createLifecycle(overrides: Partial<LLMCallLifecycleOptions> = {}): LLMCallLifecycle {
  const defaults: LLMCallLifecycleOptions = {
    client: createMockClient(),
    conversation: createMockConversation(),
    tree: new ExecutionTree(),
    hooks: {},
    logger: createMockLogger(),
    model: "gpt-4o",
    maxIterations: 10,
    parentNodeId: null,
  };

  return new LLMCallLifecycle({ ...defaults, ...overrides });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LLMCallLifecycle", () => {
  // =========================================================================
  // prepareLLMCall
  // =========================================================================

  describe("prepareLLMCall", () => {
    it("should return options with model and messages", async () => {
      const lifecycle = createLifecycle({ model: "claude-3-5-sonnet" });
      const { options } = await lifecycle.prepareLLMCall(1);

      expect(options.model).toBe("claude-3-5-sonnet");
    });

    it("should return a non-empty llmNodeId", async () => {
      const lifecycle = createLifecycle();
      const { llmNodeId } = await lifecycle.prepareLLMCall(1);

      expect(typeof llmNodeId).toBe("string");
      expect(llmNodeId.length).toBeGreaterThan(0);
    });

    it("should create a node in the execution tree", async () => {
      const tree = new ExecutionTree();
      const lifecycle = createLifecycle({ tree });

      const { llmNodeId } = await lifecycle.prepareLLMCall(1);

      expect(tree.getNode(llmNodeId)).toBeDefined();
    });

    it("should fire onLLMCallStart observer before beforeLLMCall controller", async () => {
      const order: string[] = [];

      const hooks: AgentHooks = {
        observers: {
          onLLMCallStart: async () => {
            order.push("onLLMCallStart");
          },
        },
        controllers: {
          beforeLLMCall: async () => {
            order.push("beforeLLMCall");
            return { action: "proceed" } as BeforeLLMCallAction;
          },
        },
      };

      const lifecycle = createLifecycle({ hooks });
      await lifecycle.prepareLLMCall(1);

      expect(order).toEqual(["onLLMCallStart", "beforeLLMCall"]);
    });

    it("should fire onLLMCallReady observer after beforeLLMCall controller", async () => {
      const order: string[] = [];

      const hooks: AgentHooks = {
        observers: {
          onLLMCallReady: async () => {
            order.push("onLLMCallReady");
          },
        },
        controllers: {
          beforeLLMCall: async () => {
            order.push("beforeLLMCall");
            return { action: "proceed" } as BeforeLLMCallAction;
          },
        },
      };

      const lifecycle = createLifecycle({ hooks });
      await lifecycle.prepareLLMCall(1);

      expect(order).toEqual(["beforeLLMCall", "onLLMCallReady"]);
    });

    it("should pass correct iteration to onLLMCallStart observer", async () => {
      const capturedContexts: ObserveLLMCallContext[] = [];

      const hooks: AgentHooks = {
        observers: {
          onLLMCallStart: (ctx) => {
            capturedContexts.push(ctx);
          },
        },
      };

      const lifecycle = createLifecycle({ hooks });
      await lifecycle.prepareLLMCall(3);

      expect(capturedContexts[0].iteration).toBe(3);
    });

    it("should pass correct iteration to onLLMCallReady observer", async () => {
      const capturedContexts: ObserveLLMCallReadyContext[] = [];

      const hooks: AgentHooks = {
        observers: {
          onLLMCallReady: (ctx) => {
            capturedContexts.push(ctx);
          },
        },
      };

      const lifecycle = createLifecycle({ hooks });
      await lifecycle.prepareLLMCall(5);

      expect(capturedContexts[0].iteration).toBe(5);
    });

    it("should pass logger to observers", async () => {
      const logger = createMockLogger();
      const capturedContexts: ObserveLLMCallContext[] = [];

      const hooks: AgentHooks = {
        observers: {
          onLLMCallStart: (ctx) => {
            capturedContexts.push(ctx);
          },
        },
      };

      const lifecycle = createLifecycle({ hooks, logger });
      await lifecycle.prepareLLMCall(1);

      expect(capturedContexts[0].logger).toBe(logger);
    });

    describe("beforeLLMCall controller", () => {
      it("should return skipWithSynthetic when controller returns 'skip'", async () => {
        const hooks: AgentHooks = {
          controllers: {
            beforeLLMCall: async () =>
              ({
                action: "skip",
                syntheticResponse: "cached response",
              }) as BeforeLLMCallAction,
          },
        };

        const lifecycle = createLifecycle({ hooks });
        const { skipWithSynthetic } = await lifecycle.prepareLLMCall(1);

        expect(skipWithSynthetic).toBe("cached response");
      });

      it("should return skipWithSynthetic as undefined when controller returns 'proceed'", async () => {
        const hooks: AgentHooks = {
          controllers: {
            beforeLLMCall: async () => ({ action: "proceed" }) as BeforeLLMCallAction,
          },
        };

        const lifecycle = createLifecycle({ hooks });
        const { skipWithSynthetic } = await lifecycle.prepareLLMCall(1);

        expect(skipWithSynthetic).toBeUndefined();
      });

      it("should merge modifiedOptions into llmOptions when controller returns 'proceed' with modifiedOptions", async () => {
        const hooks: AgentHooks = {
          controllers: {
            beforeLLMCall: async () =>
              ({
                action: "proceed",
                modifiedOptions: { temperature: 0.5, maxTokens: 512 },
              }) as BeforeLLMCallAction,
          },
        };

        const lifecycle = createLifecycle({ hooks, model: "gpt-4o" });
        const { options } = await lifecycle.prepareLLMCall(1);

        expect(options.temperature).toBe(0.5);
        expect(options.maxTokens).toBe(512);
        expect(options.model).toBe("gpt-4o"); // original preserved
      });

      it("should not invoke onLLMCallReady when controller returns 'skip'", async () => {
        const onLLMCallReady = vi.fn();

        const hooks: AgentHooks = {
          observers: { onLLMCallReady },
          controllers: {
            beforeLLMCall: async () =>
              ({
                action: "skip",
                syntheticResponse: "synthetic",
              }) as BeforeLLMCallAction,
          },
        };

        const lifecycle = createLifecycle({ hooks });
        await lifecycle.prepareLLMCall(1);

        expect(onLLMCallReady).not.toHaveBeenCalled();
      });
    });
  });

  // =========================================================================
  // completeLLMCall
  // =========================================================================

  describe("completeLLMCall", () => {
    it("should fire onLLMCallComplete observer", async () => {
      const capturedContexts: ObserveLLMCompleteContext[] = [];
      const hooks: AgentHooks = {
        observers: {
          onLLMCallComplete: (ctx) => {
            capturedContexts.push(ctx);
          },
        },
      };

      const tree = new ExecutionTree();
      const lifecycle = createLifecycle({ hooks, tree });
      const { llmNodeId, options } = await lifecycle.prepareLLMCall(1);
      const result = makeStreamCompletionEvent({ finalMessage: "hello" });

      await lifecycle.completeLLMCall(llmNodeId, result, 1, options, 0);

      expect(capturedContexts).toHaveLength(1);
      expect(capturedContexts[0].finalMessage).toBe("hello");
    });

    it("should pass iteration, finishReason, and usage to onLLMCallComplete", async () => {
      const capturedContexts: ObserveLLMCompleteContext[] = [];
      const hooks: AgentHooks = {
        observers: {
          onLLMCallComplete: (ctx) => capturedContexts.push(ctx),
        },
      };

      const lifecycle = createLifecycle({ hooks });
      const { llmNodeId, options } = await lifecycle.prepareLLMCall(2);
      const result = makeStreamCompletionEvent({
        finishReason: "max_tokens",
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      await lifecycle.completeLLMCall(llmNodeId, result, 2, options, 0);

      expect(capturedContexts[0].iteration).toBe(2);
      expect(capturedContexts[0].finishReason).toBe("max_tokens");
      expect(capturedContexts[0].usage?.inputTokens).toBe(100);
    });

    it("should complete the LLM call node in execution tree", async () => {
      const tree = new ExecutionTree();
      const lifecycle = createLifecycle({ tree });
      const { llmNodeId, options } = await lifecycle.prepareLLMCall(1);

      const result = makeStreamCompletionEvent();
      await lifecycle.completeLLMCall(llmNodeId, result, 1, options, 0);

      const node = tree.getNode(llmNodeId) as { completedAt: number | null };
      expect(node.completedAt).not.toBeNull();
    });

    it("should return finalMessage from result when no afterLLMCall controller", async () => {
      const lifecycle = createLifecycle();
      const { llmNodeId, options } = await lifecycle.prepareLLMCall(1);
      const result = makeStreamCompletionEvent({ finalMessage: "original message" });

      const finalMessage = await lifecycle.completeLLMCall(llmNodeId, result, 1, options, 0);

      expect(finalMessage).toBe("original message");
    });

    describe("afterLLMCall controller", () => {
      it("should return original finalMessage when controller returns 'continue'", async () => {
        const hooks: AgentHooks = {
          controllers: {
            afterLLMCall: async () => ({ action: "continue" }) as AfterLLMCallAction,
          },
        };

        const lifecycle = createLifecycle({ hooks });
        const { llmNodeId, options } = await lifecycle.prepareLLMCall(1);
        const result = makeStreamCompletionEvent({ finalMessage: "original" });

        const finalMessage = await lifecycle.completeLLMCall(llmNodeId, result, 1, options, 0);

        expect(finalMessage).toBe("original");
      });

      it("should return modifiedMessage when controller returns 'modify_and_continue'", async () => {
        const hooks: AgentHooks = {
          controllers: {
            afterLLMCall: async () =>
              ({
                action: "modify_and_continue",
                modifiedMessage: "modified message",
              }) as AfterLLMCallAction,
          },
        };

        const lifecycle = createLifecycle({ hooks });
        const { llmNodeId, options } = await lifecycle.prepareLLMCall(1);
        const result = makeStreamCompletionEvent({ finalMessage: "original" });

        const finalMessage = await lifecycle.completeLLMCall(llmNodeId, result, 1, options, 0);

        expect(finalMessage).toBe("modified message");
      });

      it("should add user messages to conversation when controller returns 'append_messages'", async () => {
        const conversation = createMockConversation();
        const hooks: AgentHooks = {
          controllers: {
            afterLLMCall: async () =>
              ({
                action: "append_messages",
                messages: [{ role: "user", content: "extra context" }],
              }) as AfterLLMCallAction,
          },
        };

        const lifecycle = createLifecycle({ hooks, conversation });
        const { llmNodeId, options } = await lifecycle.prepareLLMCall(1);
        const result = makeStreamCompletionEvent();

        await lifecycle.completeLLMCall(llmNodeId, result, 1, options, 0);

        expect(conversation.addUserMessage).toHaveBeenCalledWith("extra context");
      });

      it("should add assistant messages to conversation when controller returns 'append_messages'", async () => {
        const conversation = createMockConversation();
        const hooks: AgentHooks = {
          controllers: {
            afterLLMCall: async () =>
              ({
                action: "append_messages",
                messages: [{ role: "assistant", content: "assistant follow-up" }],
              }) as AfterLLMCallAction,
          },
        };

        const lifecycle = createLifecycle({ hooks, conversation });
        const { llmNodeId, options } = await lifecycle.prepareLLMCall(1);
        const result = makeStreamCompletionEvent();

        await lifecycle.completeLLMCall(llmNodeId, result, 1, options, 0);

        expect(conversation.addAssistantMessage).toHaveBeenCalledWith("assistant follow-up");
      });

      it("should do both modify and append when controller returns 'append_and_modify'", async () => {
        const conversation = createMockConversation();
        const hooks: AgentHooks = {
          controllers: {
            afterLLMCall: async () =>
              ({
                action: "append_and_modify",
                modifiedMessage: "modified",
                messages: [{ role: "user", content: "appended" }],
              }) as AfterLLMCallAction,
          },
        };

        const lifecycle = createLifecycle({ hooks, conversation });
        const { llmNodeId, options } = await lifecycle.prepareLLMCall(1);
        const result = makeStreamCompletionEvent({ finalMessage: "original" });

        const finalMessage = await lifecycle.completeLLMCall(llmNodeId, result, 1, options, 0);

        expect(finalMessage).toBe("modified");
        expect(conversation.addUserMessage).toHaveBeenCalledWith("appended");
      });

      it("should skip afterLLMCall controller when finishReason is 'interrupted'", async () => {
        const afterLLMCall = vi.fn(async () => ({ action: "continue" }) as AfterLLMCallAction);
        const hooks: AgentHooks = {
          controllers: { afterLLMCall },
        };

        const lifecycle = createLifecycle({ hooks });
        const { llmNodeId, options } = await lifecycle.prepareLLMCall(1);
        const result = makeStreamCompletionEvent({
          finishReason: "interrupted",
          finalMessage: "original",
        });

        const finalMessage = await lifecycle.completeLLMCall(llmNodeId, result, 1, options, 0);

        expect(afterLLMCall).not.toHaveBeenCalled();
        expect(finalMessage).toBe("original");
      });

      it("should pass gadgetCallCount to afterLLMCall controller context", async () => {
        let capturedGadgetCallCount: number | undefined;
        const hooks: AgentHooks = {
          controllers: {
            afterLLMCall: async (ctx) => {
              capturedGadgetCallCount = ctx.gadgetCallCount;
              return { action: "continue" } as AfterLLMCallAction;
            },
          },
        };

        const lifecycle = createLifecycle({ hooks });
        const { llmNodeId, options } = await lifecycle.prepareLLMCall(1);
        const result = makeStreamCompletionEvent();

        await lifecycle.completeLLMCall(llmNodeId, result, 1, options, 7);

        expect(capturedGadgetCallCount).toBe(7);
      });
    });
  });

  // =========================================================================
  // notifyLLMCallReady
  // =========================================================================

  describe("notifyLLMCallReady", () => {
    it("should fire onLLMCallReady observer with given options", async () => {
      const capturedContexts: ObserveLLMCallReadyContext[] = [];
      const hooks: AgentHooks = {
        observers: {
          onLLMCallReady: (ctx) => capturedContexts.push(ctx),
        },
      };

      const lifecycle = createLifecycle({ hooks });
      const options = { model: "gpt-4o", messages: [] } as LLMGenerationOptions;

      await lifecycle.notifyLLMCallReady(2, "node-123", options);

      expect(capturedContexts).toHaveLength(1);
      expect(capturedContexts[0].iteration).toBe(2);
      expect(capturedContexts[0].options).toBe(options);
    });

    it("should do nothing when no onLLMCallReady observer is defined", async () => {
      const lifecycle = createLifecycle({ hooks: {} });
      const options = { model: "gpt-4o", messages: [] } as LLMGenerationOptions;

      await expect(lifecycle.notifyLLMCallReady(1, "node-1", options)).resolves.toBeUndefined();
    });

    it("should pass maxIterations to observer context", async () => {
      const capturedContexts: ObserveLLMCallReadyContext[] = [];
      const hooks: AgentHooks = {
        observers: {
          onLLMCallReady: (ctx) => capturedContexts.push(ctx),
        },
      };

      const lifecycle = createLifecycle({ hooks, maxIterations: 15 });
      const options = { model: "gpt-4o", messages: [] } as LLMGenerationOptions;

      await lifecycle.notifyLLMCallReady(1, "node-1", options);

      expect(capturedContexts[0].maxIterations).toBe(15);
    });

    it("should pass budget to observer context when configured", async () => {
      const capturedContexts: ObserveLLMCallReadyContext[] = [];
      const hooks: AgentHooks = {
        observers: {
          onLLMCallReady: (ctx) => capturedContexts.push(ctx),
        },
      };

      const lifecycle = createLifecycle({ hooks, budget: 1.5 });
      const options = { model: "gpt-4o", messages: [] } as LLMGenerationOptions;

      await lifecycle.notifyLLMCallReady(1, "node-1", options);

      expect(capturedContexts[0].budget).toBe(1.5);
    });
  });

  // =========================================================================
  // notifyLLMError
  // =========================================================================

  describe("notifyLLMError", () => {
    it("should return 'rethrow' when no afterLLMError controller is defined", async () => {
      const lifecycle = createLifecycle({ hooks: {} });
      const error = new Error("API error");

      const action = await lifecycle.notifyLLMError(1, "node-1", error);

      expect(action.action).toBe("rethrow");
    });

    it("should call afterLLMError controller and return its action", async () => {
      const hooks: AgentHooks = {
        controllers: {
          afterLLMError: async () =>
            ({
              action: "recover",
              fallbackResponse: "I had an error, here is a fallback",
            }) as AfterLLMErrorAction,
        },
      };

      const lifecycle = createLifecycle({ hooks });
      const error = new Error("LLM failed");

      const action = await lifecycle.notifyLLMError(1, "node-1", error);

      expect(action.action).toBe("recover");
      if (action.action === "recover") {
        expect(action.fallbackResponse).toBe("I had an error, here is a fallback");
      }
    });

    it("should fire onLLMCallError observer after controller", async () => {
      const capturedContexts: ObserveLLMErrorContext[] = [];
      const order: string[] = [];

      const hooks: AgentHooks = {
        observers: {
          onLLMCallError: (ctx) => {
            capturedContexts.push(ctx);
            order.push("observer");
          },
        },
        controllers: {
          afterLLMError: async () => {
            order.push("controller");
            return { action: "rethrow" } as AfterLLMErrorAction;
          },
        },
      };

      const lifecycle = createLifecycle({ hooks });
      const error = new Error("test error");

      await lifecycle.notifyLLMError(1, "node-1", error);

      expect(order).toEqual(["controller", "observer"]);
      expect(capturedContexts[0].error).toBe(error);
    });

    it("should set recovered=false when controller returns 'rethrow'", async () => {
      const capturedContexts: ObserveLLMErrorContext[] = [];
      const hooks: AgentHooks = {
        observers: {
          onLLMCallError: (ctx) => capturedContexts.push(ctx),
        },
        controllers: {
          afterLLMError: async () => ({ action: "rethrow" }) as AfterLLMErrorAction,
        },
      };

      const lifecycle = createLifecycle({ hooks });
      await lifecycle.notifyLLMError(1, "node-1", new Error("err"));

      expect(capturedContexts[0].recovered).toBe(false);
    });

    it("should set recovered=true when controller returns 'recover'", async () => {
      const capturedContexts: ObserveLLMErrorContext[] = [];
      const hooks: AgentHooks = {
        observers: {
          onLLMCallError: (ctx) => capturedContexts.push(ctx),
        },
        controllers: {
          afterLLMError: async () =>
            ({
              action: "recover",
              fallbackResponse: "fallback",
            }) as AfterLLMErrorAction,
        },
      };

      const lifecycle = createLifecycle({ hooks });
      await lifecycle.notifyLLMError(1, "node-1", new Error("err"));

      expect(capturedContexts[0].recovered).toBe(true);
    });

    it("should fire onLLMCallError observer even when no controller defined", async () => {
      const capturedContexts: ObserveLLMErrorContext[] = [];
      const hooks: AgentHooks = {
        observers: {
          onLLMCallError: (ctx) => capturedContexts.push(ctx),
        },
      };

      const lifecycle = createLifecycle({ hooks });
      const error = new Error("no controller");

      await lifecycle.notifyLLMError(1, "node-1", error);

      expect(capturedContexts).toHaveLength(1);
      expect(capturedContexts[0].error).toBe(error);
      expect(capturedContexts[0].recovered).toBe(false);
    });

    it("should pass iteration and error to onLLMCallError context", async () => {
      const capturedContexts: ObserveLLMErrorContext[] = [];
      const hooks: AgentHooks = {
        observers: {
          onLLMCallError: (ctx) => capturedContexts.push(ctx),
        },
      };

      const lifecycle = createLifecycle({ hooks });
      const error = new Error("iteration error");

      await lifecycle.notifyLLMError(4, "node-1", error);

      expect(capturedContexts[0].iteration).toBe(4);
      expect(capturedContexts[0].error).toBe(error);
    });

    it("should handle undefined nodeId gracefully", async () => {
      const capturedContexts: ObserveLLMErrorContext[] = [];
      const hooks: AgentHooks = {
        observers: {
          onLLMCallError: (ctx) => capturedContexts.push(ctx),
        },
      };

      const lifecycle = createLifecycle({ hooks });
      const error = new Error("early error");

      await expect(lifecycle.notifyLLMError(1, undefined, error)).resolves.not.toThrow();

      expect(capturedContexts).toHaveLength(1);
      expect(capturedContexts[0].subagentContext).toBeUndefined();
    });

    it("should log the error message", async () => {
      const logger = createMockLogger();
      const lifecycle = createLifecycle({ hooks: {}, logger });
      const error = new Error("something went wrong");

      await lifecycle.notifyLLMError(1, "node-1", error);

      expect(logger.error).toHaveBeenCalledWith(
        "LLM call failed",
        expect.objectContaining({
          error: "something went wrong",
        }),
      );
    });
  });

  // =========================================================================
  // Observer error isolation
  // =========================================================================

  describe("observer error isolation", () => {
    it("should not throw when onLLMCallStart observer throws", async () => {
      const hooks: AgentHooks = {
        observers: {
          onLLMCallStart: () => {
            throw new Error("observer crash");
          },
        },
      };

      const lifecycle = createLifecycle({ hooks });

      await expect(lifecycle.prepareLLMCall(1)).resolves.not.toThrow();
    });

    it("should not throw when onLLMCallReady observer throws", async () => {
      const hooks: AgentHooks = {
        observers: {
          onLLMCallReady: () => {
            throw new Error("ready observer crash");
          },
        },
      };

      const lifecycle = createLifecycle({ hooks });

      await expect(lifecycle.prepareLLMCall(1)).resolves.not.toThrow();
    });

    it("should not throw when onLLMCallComplete observer throws", async () => {
      const hooks: AgentHooks = {
        observers: {
          onLLMCallComplete: () => {
            throw new Error("complete observer crash");
          },
        },
      };

      const lifecycle = createLifecycle({ hooks });
      const { llmNodeId, options } = await lifecycle.prepareLLMCall(1);
      const result = makeStreamCompletionEvent();

      await expect(
        lifecycle.completeLLMCall(llmNodeId, result, 1, options, 0),
      ).resolves.not.toThrow();
    });

    it("should not throw when onLLMCallError observer throws", async () => {
      const hooks: AgentHooks = {
        observers: {
          onLLMCallError: () => {
            throw new Error("error observer crash");
          },
        },
      };

      const lifecycle = createLifecycle({ hooks });
      const error = new Error("original error");

      await expect(lifecycle.notifyLLMError(1, "node-1", error)).resolves.not.toThrow();
    });
  });

  // =========================================================================
  // Cost tracking
  // =========================================================================

  describe("cost tracking", () => {
    it("should call estimateCost with model and token usage", async () => {
      const modelRegistry = {
        getModelLimits: vi.fn(() => ({ contextWindow: 128_000, maxOutputTokens: 4096 })),
        getModelSpec: vi.fn(() => undefined),
        estimateCost: vi.fn(() => ({ totalCost: 0.001 })),
      };

      const client = { modelRegistry } as unknown as LLMist;
      const lifecycle = createLifecycle({ client, model: "gpt-4o" });

      const { llmNodeId, options } = await lifecycle.prepareLLMCall(1);
      const result = makeStreamCompletionEvent({
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      await lifecycle.completeLLMCall(llmNodeId, result, 1, options, 0);

      expect(modelRegistry.estimateCost).toHaveBeenCalledWith("gpt-4o", 100, 50, 0, 0, 0);
    });

    it("should update tree cost after completeLLMCall", async () => {
      const modelRegistry = {
        getModelLimits: vi.fn(() => ({ contextWindow: 128_000, maxOutputTokens: 4096 })),
        getModelSpec: vi.fn(() => undefined),
        estimateCost: vi.fn(() => ({ totalCost: 0.005 })),
      };

      const client = { modelRegistry } as unknown as LLMist;
      const tree = new ExecutionTree();
      const lifecycle = createLifecycle({ client, tree, model: "gpt-4o" });

      const { llmNodeId, options } = await lifecycle.prepareLLMCall(1);
      const result = makeStreamCompletionEvent({
        usage: { inputTokens: 500, outputTokens: 200 },
      });

      await lifecycle.completeLLMCall(llmNodeId, result, 1, options, 0);

      expect(tree.getTotalCost()).toBeCloseTo(0.005);
    });
  });
});
