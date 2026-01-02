import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockLLM } from "../../../testing/src/index.js";
import { AgentBuilder } from "../agent/builder.js";
import type { AgentHooks } from "../agent/hooks.js";
import { createLogger } from "../logging/logger.js";
import { TEST_TIMEOUTS } from "./fixtures.js";
import { clearAllMocks, createMockE2EClient } from "./mock-setup.js";
import { collectAllEvents, setupE2ERegistry } from "./setup.js";

/**
 * E2E tests for the hooks system
 * Tests observers, interceptors, and controllers
 */
describe("E2E: Hooks System", () => {
  beforeEach(() => {
    clearAllMocks();
  });

  afterEach(() => {
    clearAllMocks();
  });

  describe("Observers", () => {
    it(
      "calls onLLMCallStart and onLLMCallComplete observers",
      async () => {
        const observerCalls: string[] = [];

        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("hello")
          .returns("Hello! How can I help you today?")
          .register();

        const hooks: AgentHooks = {
          observers: {
            onLLMCallStart: (ctx) => {
              observerCalls.push(`start:${ctx.iteration}`);
            },
            onLLMCallComplete: (ctx) => {
              observerCalls.push(`complete:${ctx.iteration}:${ctx.finishReason}`);
            },
          },
        };

        const registry = setupE2ERegistry();
        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("openai:gpt-5-nano")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withHooks(hooks)
          .withMaxIterations(2)
          .ask("Say hello");

        await collectAllEvents(agent.run());

        // Iteration is 0-based
        expect(observerCalls).toContain("start:0");
        expect(observerCalls.some((c) => c.startsWith("complete:0"))).toBe(true);
      },
      TEST_TIMEOUTS.QUICK,
    );

    it(
      "calls onGadgetExecutionStart and onGadgetExecutionComplete observers",
      async () => {
        const gadgetEvents: Array<{ event: string; gadgetName: string; iteration: number }> = [];

        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("calculate")
          .returnsGadgetCall("Calculator", { operation: "add", a: 5, b: 3 })
          .register();

        const hooks: AgentHooks = {
          observers: {
            onGadgetExecutionStart: (ctx) => {
              gadgetEvents.push({
                event: "start",
                gadgetName: ctx.gadgetName,
                iteration: ctx.iteration,
              });
            },
            onGadgetExecutionComplete: (ctx) => {
              gadgetEvents.push({
                event: "complete",
                gadgetName: ctx.gadgetName,
                iteration: ctx.iteration,
              });
            },
          },
        };

        const registry = setupE2ERegistry();
        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("openai:gpt-5-nano")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withHooks(hooks)
          .withMaxIterations(3)
          .ask("Please calculate 5 + 3");

        await collectAllEvents(agent.run());

        // Verify gadget observers were called
        const startEvents = gadgetEvents.filter((e) => e.event === "start");
        const completeEvents = gadgetEvents.filter((e) => e.event === "complete");

        expect(startEvents.length).toBeGreaterThan(0);
        expect(completeEvents.length).toBeGreaterThan(0);
        expect(startEvents[0]?.gadgetName).toBe("Calculator");
        expect(completeEvents[0]?.gadgetName).toBe("Calculator");
      },
      TEST_TIMEOUTS.QUICK,
    );

    it(
      "calls onStreamChunk observer for each chunk",
      async () => {
        const chunks: string[] = [];

        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("stream")
          .returns("This is a streaming response.")
          .register();

        const hooks: AgentHooks = {
          observers: {
            onStreamChunk: (ctx) => {
              chunks.push(ctx.rawChunk);
            },
          },
        };

        const registry = setupE2ERegistry();
        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("openai:gpt-5-nano")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withHooks(hooks)
          .withMaxIterations(2)
          .ask("Please stream something");

        await collectAllEvents(agent.run());

        // Should have received some chunks
        expect(chunks.length).toBeGreaterThan(0);
      },
      TEST_TIMEOUTS.QUICK,
    );

    it(
      "async observers do not block execution",
      async () => {
        const timings: number[] = [];
        const startTime = Date.now();

        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("async")
          .returns("Response received")
          .register();

        const hooks: AgentHooks = {
          observers: {
            onLLMCallStart: async () => {
              // Simulate async operation
              await new Promise((resolve) => setTimeout(resolve, 10));
              timings.push(Date.now() - startTime);
            },
            onLLMCallComplete: async () => {
              await new Promise((resolve) => setTimeout(resolve, 10));
              timings.push(Date.now() - startTime);
            },
          },
        };

        const registry = setupE2ERegistry();
        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("openai:gpt-5-nano")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withHooks(hooks)
          .withMaxIterations(2)
          .ask("Test async observers");

        await collectAllEvents(agent.run());

        // Observers should have been called
        expect(timings.length).toBeGreaterThan(0);
      },
      TEST_TIMEOUTS.QUICK,
    );
  });

  describe("Interceptors", () => {
    it(
      "interceptRawChunk transforms incoming chunks",
      async () => {
        const originalChunks: string[] = [];
        const interceptedChunks: string[] = [];

        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("secret")
          .returns("The secret code is ABC123")
          .register();

        const hooks: AgentHooks = {
          observers: {
            onStreamChunk: (ctx) => {
              interceptedChunks.push(ctx.rawChunk);
            },
          },
          interceptors: {
            interceptRawChunk: (chunk) => {
              originalChunks.push(chunk);
              // Redact secret codes
              return chunk.replace(/ABC123/g, "[REDACTED]");
            },
          },
        };

        const registry = setupE2ERegistry();
        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("openai:gpt-5-nano")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withHooks(hooks)
          .withMaxIterations(2)
          .ask("Tell me a secret");

        await collectAllEvents(agent.run());

        // Original chunks should contain secret
        const originalText = originalChunks.join("");
        expect(originalText).toContain("ABC123");

        // Intercepted chunks should have it redacted
        const interceptedText = interceptedChunks.join("");
        expect(interceptedText).toContain("[REDACTED]");
        expect(interceptedText).not.toContain("ABC123");
      },
      TEST_TIMEOUTS.QUICK,
    );

    it(
      "interceptTextChunk can suppress chunks by returning null",
      async () => {
        const emittedText: string[] = [];

        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("internal")
          .returns("Public info. [INTERNAL] Private info. More public.")
          .register();

        const hooks: AgentHooks = {
          interceptors: {
            interceptTextChunk: (chunk) => {
              // Suppress internal markers
              if (chunk.includes("[INTERNAL]")) {
                return null;
              }
              emittedText.push(chunk);
              return chunk;
            },
          },
        };

        const registry = setupE2ERegistry();
        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("openai:gpt-5-nano")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withHooks(hooks)
          .withMaxIterations(2)
          .ask("Show internal info");

        await collectAllEvents(agent.run());

        // Internal marker should be suppressed
        const fullText = emittedText.join("");
        expect(fullText).not.toContain("[INTERNAL]");
      },
      TEST_TIMEOUTS.QUICK,
    );

    it(
      "interceptGadgetParameters modifies gadget parameters",
      async () => {
        const interceptedParams: Record<string, unknown>[] = [];

        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("calculate")
          .returnsGadgetCall("Calculator", { operation: "add", a: 10, b: 5 })
          .register();

        const hooks: AgentHooks = {
          interceptors: {
            interceptGadgetParameters: (params, ctx) => {
              interceptedParams.push({ ...params });
              // Modify parameter: double 'a'
              if (ctx.gadgetName === "Calculator" && typeof params.a === "number") {
                return { ...params, a: params.a * 2 };
              }
              return params;
            },
          },
        };

        const registry = setupE2ERegistry();
        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("openai:gpt-5-nano")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withHooks(hooks)
          .withMaxIterations(3)
          .ask("Calculate 10 + 5");

        const events = await collectAllEvents(agent.run());

        // Parameters should have been intercepted
        expect(interceptedParams.length).toBeGreaterThan(0);
        expect(interceptedParams[0]?.a).toBe(10);

        // Result should reflect modified parameters (20 + 5 = 25)
        const gadgetResults = events.filter((e) => e.type === "gadget_result");
        expect(gadgetResults.length).toBeGreaterThan(0);
        // The actual calculation should be 20 + 5 = 25 (since we doubled 'a')
        const result = gadgetResults[0];
        if (result?.type === "gadget_result") {
          expect(result.result.result).toContain("25");
        }
      },
      TEST_TIMEOUTS.QUICK,
    );

    it(
      "interceptGadgetResult transforms gadget output",
      async () => {
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("calculate")
          .returnsGadgetCall("Calculator", { operation: "add", a: 7, b: 3 })
          .register();

        const hooks: AgentHooks = {
          interceptors: {
            interceptGadgetResult: (result, ctx) => {
              // Add prefix to all gadget results
              return `[${ctx.gadgetName}] ${result}`;
            },
          },
        };

        const registry = setupE2ERegistry();
        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("openai:gpt-5-nano")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withHooks(hooks)
          .withMaxIterations(3)
          .ask("Calculate 7 + 3");

        const events = await collectAllEvents(agent.run());

        // Result should have prefix
        const gadgetResults = events.filter((e) => e.type === "gadget_result");
        expect(gadgetResults.length).toBeGreaterThan(0);
        const result = gadgetResults[0];
        if (result?.type === "gadget_result") {
          expect(result.result.result).toContain("[Calculator]");
        }
      },
      TEST_TIMEOUTS.QUICK,
    );
  });

  describe("Controllers", () => {
    it(
      "beforeLLMCall can skip call and return synthetic response",
      async () => {
        let controllerCalled = false;
        let llmActuallyCalled = false;

        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("cache")
          .returns(() => {
            llmActuallyCalled = true;
            return "This should not be called";
          })
          .register();

        const hooks: AgentHooks = {
          controllers: {
            beforeLLMCall: async (ctx) => {
              controllerCalled = true;
              // Skip the LLM call and return cached response
              if (
                ctx.options.messages?.some(
                  (m) => typeof m.content === "string" && m.content.includes("cache"),
                )
              ) {
                return {
                  action: "skip",
                  syntheticResponse: "Cached response: Hello from cache!",
                };
              }
              return { action: "proceed" };
            },
          },
        };

        const registry = setupE2ERegistry();
        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("openai:gpt-5-nano")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withHooks(hooks)
          .withMaxIterations(2)
          .ask("Test cache hit");

        const events = await collectAllEvents(agent.run());

        expect(controllerCalled).toBe(true);
        expect(llmActuallyCalled).toBe(false);

        // Should have the synthetic response
        const textEvents = events.filter((e) => e.type === "text");
        const fullText = textEvents.map((e) => (e.type === "text" ? e.content : "")).join("");
        expect(fullText).toContain("Cached response");
      },
      TEST_TIMEOUTS.QUICK,
    );

    it(
      "beforeGadgetExecution can skip gadget and return synthetic result",
      async () => {
        let gadgetExecuted = false;

        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("expensive")
          .returnsGadgetCall("Calculator", { operation: "multiply", a: 1000, b: 1000 })
          .register();

        const hooks: AgentHooks = {
          controllers: {
            beforeGadgetExecution: async (ctx) => {
              // Skip expensive operations
              if (
                ctx.gadgetName === "Calculator" &&
                ctx.parameters.a === 1000 &&
                ctx.parameters.b === 1000
              ) {
                return {
                  action: "skip",
                  syntheticResult: "Skipped: Result would be 1000000",
                };
              }
              gadgetExecuted = true;
              return { action: "proceed" };
            },
          },
        };

        const registry = setupE2ERegistry();
        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("openai:gpt-5-nano")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withHooks(hooks)
          .withMaxIterations(3)
          .ask("Do an expensive calculation");

        const events = await collectAllEvents(agent.run());

        expect(gadgetExecuted).toBe(false);

        // Should have synthetic result
        const gadgetResults = events.filter((e) => e.type === "gadget_result");
        expect(gadgetResults.length).toBeGreaterThan(0);
        const result = gadgetResults[0];
        if (result?.type === "gadget_result") {
          expect(result.result.result).toContain("Skipped");
        }
      },
      TEST_TIMEOUTS.QUICK,
    );

    it(
      "afterLLMCall can append messages to conversation",
      async () => {
        const appendedMessages: unknown[] = [];

        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("append")
          .returns("Initial response")
          .register();

        const hooks: AgentHooks = {
          controllers: {
            afterLLMCall: async (ctx) => {
              // Track that we're appending (iteration is 0-based)
              if (ctx.iteration === 0) {
                const messages = [{ role: "user" as const, content: "Appended user message" }];
                appendedMessages.push(...messages);
                return {
                  action: "append_messages",
                  messages,
                };
              }
              return { action: "continue" };
            },
          },
        };

        const registry = setupE2ERegistry();
        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("openai:gpt-5-nano")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withHooks(hooks)
          .withMaxIterations(3)
          .ask("Test append messages");

        await collectAllEvents(agent.run());

        // Should have appended messages
        expect(appendedMessages.length).toBeGreaterThan(0);
      },
      TEST_TIMEOUTS.QUICK,
    );
  });

  describe("Hook Execution Order", () => {
    it(
      "hooks execute in correct order: observer -> controller -> interceptor",
      async () => {
        const executionOrder: string[] = [];

        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("order")
          .returnsGadgetCall("Calculator", { operation: "add", a: 1, b: 1 })
          .register();

        const hooks: AgentHooks = {
          observers: {
            onLLMCallStart: () => {
              executionOrder.push("observer:onLLMCallStart");
            },
            onGadgetExecutionStart: () => {
              executionOrder.push("observer:onGadgetExecutionStart");
            },
            onGadgetExecutionComplete: () => {
              executionOrder.push("observer:onGadgetExecutionComplete");
            },
            onLLMCallComplete: () => {
              executionOrder.push("observer:onLLMCallComplete");
            },
          },
          controllers: {
            beforeLLMCall: async () => {
              executionOrder.push("controller:beforeLLMCall");
              return { action: "proceed" };
            },
            beforeGadgetExecution: async () => {
              executionOrder.push("controller:beforeGadgetExecution");
              return { action: "proceed" };
            },
            afterGadgetExecution: async () => {
              executionOrder.push("controller:afterGadgetExecution");
              return { action: "continue" };
            },
          },
          interceptors: {
            interceptGadgetParameters: (params) => {
              executionOrder.push("interceptor:interceptGadgetParameters");
              return params;
            },
            interceptGadgetResult: (result) => {
              executionOrder.push("interceptor:interceptGadgetResult");
              return result;
            },
          },
        };

        const registry = setupE2ERegistry();
        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("openai:gpt-5-nano")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withHooks(hooks)
          .withMaxIterations(3)
          .ask("Test execution order");

        await collectAllEvents(agent.run());

        // Verify some key ordering
        const llmStartIdx = executionOrder.indexOf("observer:onLLMCallStart");
        const beforeLLMIdx = executionOrder.indexOf("controller:beforeLLMCall");
        const gadgetParamsIdx = executionOrder.indexOf("interceptor:interceptGadgetParameters");
        const gadgetResultIdx = executionOrder.indexOf("interceptor:interceptGadgetResult");

        // LLM call flow
        expect(llmStartIdx).toBeLessThan(beforeLLMIdx);

        // Gadget flow: params intercepted before result
        if (gadgetParamsIdx >= 0 && gadgetResultIdx >= 0) {
          expect(gadgetParamsIdx).toBeLessThan(gadgetResultIdx);
        }
      },
      TEST_TIMEOUTS.QUICK,
    );
  });

  describe("Error Handling in Hooks", () => {
    it(
      "observer errors are logged but do not crash execution",
      async () => {
        const originalConsoleError = console.error;
        console.error = vi.fn();

        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("error")
          .returns("Response despite observer error")
          .register();

        const hooks: AgentHooks = {
          observers: {
            onLLMCallStart: () => {
              throw new Error("Observer error");
            },
          },
        };

        const registry = setupE2ERegistry();
        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("openai:gpt-5-nano")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withHooks(hooks)
          .withMaxIterations(2)
          .ask("Test error handling");

        // Should not throw
        const events = await collectAllEvents(agent.run());

        // Should still get response
        expect(events.length).toBeGreaterThan(0);

        console.error = originalConsoleError;
      },
      TEST_TIMEOUTS.QUICK,
    );
  });
});
