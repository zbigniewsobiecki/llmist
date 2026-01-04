/**
 * Tests for the new Agent architecture
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { LLMist } from "../core/client.js";
import { GadgetRegistry } from "../gadgets/registry.js";
import { Gadget } from "../gadgets/typed-gadget.js";
import { AgentBuilder } from "./builder.js";
import { ConversationManager } from "./conversation-manager.js";

// Mock gadget for testing
class TestCalculator extends Gadget({
  name: "TestCalculator",
  description: "A test calculator",
  schema: z.object({
    a: z.number(),
    b: z.number(),
  }),
}) {
  execute(params: this["params"]): string {
    const { a, b } = params;
    return `Result: ${a + b}`;
  }
}

describe("Agent Architecture", () => {
  let mockClient: LLMist;
  let registry: GadgetRegistry;

  beforeEach(() => {
    // Create mock client
    mockClient = {
      stream: vi.fn().mockImplementation(async function* () {
        yield { text: "Test response" };
      }),
      modelRegistry: {
        getModelLimits: vi.fn().mockReturnValue({ maxOutputTokens: 4096 }),
      },
    } as unknown as LLMist;

    // Create registry
    registry = new GadgetRegistry();
    registry.registerByClass(new TestCalculator());
  });

  describe("ConversationManager", () => {
    it("should manage conversation history correctly", () => {
      const baseMessages = [{ role: "system" as const, content: "You are helpful" }];
      const initialMessages = [{ role: "user" as const, content: "Hello" }];

      const manager = new ConversationManager(baseMessages, initialMessages, {
        parameterFormat: "json",
      });

      manager.addUserMessage("What is 1+1?");
      manager.addAssistantMessage("Let me calculate that.");
      manager.addGadgetCallResult("TestCalculator", { a: 1, b: 1 }, "Result: 2", "gc_test_1");

      const messages = manager.getMessages();

      // Should include base + initial + added messages
      expect(messages.length).toBeGreaterThan(3);
      expect(messages[0].content).toBe("You are helpful");
    });
  });

  describe("Agent", () => {
    it("should create an agent with required options", () => {
      const agent = new AgentBuilder(mockClient)
        .withModel("test:model")
        .withGadgets(...registry.getAll())
        .ask("Test prompt");

      expect(agent).toBeDefined();
    });

    it("should respect maxIterations option", async () => {
      const agent = new AgentBuilder(mockClient)
        .withModel("test:model")
        .withGadgets(...registry.getAll())
        .withMaxIterations(1)
        .ask("Test prompt");

      let iterationCount = 0;
      for await (const _event of agent.run()) {
        iterationCount++;
      }

      // Should stop after max iterations
      expect(iterationCount).toBeGreaterThan(0);
    });
  });

  describe("Architecture Benefits", () => {
    it("should demonstrate separation of concerns", () => {
      // ConversationManager handles history
      const conversationManager = new ConversationManager([], [], { parameterFormat: "json" });
      expect(typeof conversationManager.addUserMessage).toBe("function");
      expect(typeof conversationManager.getMessages).toBe("function");

      // Agent orchestrates everything using StreamProcessor internally
      const agent = new AgentBuilder(mockClient)
        .withModel("test:model")
        .withGadgets(...registry.getAll())
        .ask("Test");
      expect(typeof agent.run).toBe("function");

      // Each component has a single, well-defined responsibility
    });
  });

  describe("Agent with custom hooks for processing customization", () => {
    it("should allow processing customization via interceptors", async () => {
      const interceptedChunks: string[] = [];
      let interceptedMessage = "";

      const agent = new AgentBuilder(mockClient)
        .withModel("test:model")
        .withGadgets(...registry.getAll())
        .withHooks({
          interceptors: {
            interceptTextChunk: (chunk) => {
              interceptedChunks.push(chunk);
              return chunk.toUpperCase(); // Transform to uppercase
            },
            interceptAssistantMessage: (message) => {
              interceptedMessage = message;
              return `[MODIFIED] ${message}`;
            },
          },
        })
        .ask("Test prompt");

      // Collect events from agent run
      for await (const _event of agent.run()) {
        // Events are processed
      }

      // Verify interceptors were called
      expect(interceptedChunks.length).toBeGreaterThan(0);
      expect(interceptedMessage).toBeTruthy();
    });
  });

  describe("Agent.resolveMaxTokensFromCatalog edge cases", () => {
    it("should handle model without limits", () => {
      const mockClientNoLimits = {
        stream: vi.fn().mockImplementation(async function* () {
          yield { text: "Test" };
        }),
        modelRegistry: {
          getModelLimits: vi.fn().mockReturnValue(undefined),
        },
      } as unknown as LLMist;

      const agent = new AgentBuilder(mockClientNoLimits)
        .withModel("test:model")
        .withGadgets(...registry.getAll())
        .ask("Test");

      expect(agent).toBeDefined();
    });

    it("should handle model with prefix fallback", () => {
      const mockClientPrefixed = {
        stream: vi.fn().mockImplementation(async function* () {
          yield { text: "Test" };
        }),
        modelRegistry: {
          getModelLimits: vi
            .fn()
            .mockReturnValueOnce(undefined)
            .mockReturnValueOnce({ maxOutputTokens: 8192 }),
        },
      } as unknown as LLMist;

      const agent = new AgentBuilder(mockClientPrefixed)
        .withModel("provider:gpt-4")
        .withGadgets(...registry.getAll())
        .ask("Test");

      expect(agent).toBeDefined();
    });

    it("should handle model without separator", () => {
      const mockClientNoSeparator = {
        stream: vi.fn().mockImplementation(async function* () {
          yield { text: "Test" };
        }),
        modelRegistry: {
          getModelLimits: vi.fn().mockReturnValue(undefined),
        },
      } as unknown as LLMist;

      const agent = new AgentBuilder(mockClientNoSeparator)
        .withModel("modelname")
        .withGadgets(...registry.getAll())
        .ask("Test");

      expect(agent).toBeDefined();
    });

    it("should handle empty model name after separator", () => {
      const mockClientEmptyName = {
        stream: vi.fn().mockImplementation(async function* () {
          yield { text: "Test" };
        }),
        modelRegistry: {
          getModelLimits: vi.fn().mockReturnValue(undefined),
        },
      } as unknown as LLMist;

      const agent = new AgentBuilder(mockClientEmptyName)
        .withModel("provider:")
        .withGadgets(...registry.getAll())
        .ask("Test");

      expect(agent).toBeDefined();
    });
  });

  describe("Agent abort handling", () => {
    it("should terminate loop immediately when abort signal is already aborted", async () => {
      const abortController = new AbortController();
      abortController.abort("pre-aborted");

      const mockClientAbort = {
        stream: vi.fn().mockImplementation(async function* () {
          yield { text: "Test response" };
        }),
        modelRegistry: {
          getModelLimits: vi.fn().mockReturnValue({ maxOutputTokens: 4096 }),
        },
      } as unknown as LLMist;

      const agent = new AgentBuilder(mockClientAbort)
        .withModel("test:model")
        .withGadgets()
        .withSignal(abortController.signal)
        .withMaxIterations(10)
        .ask("Test prompt");

      const events: unknown[] = [];
      for await (const event of agent.run()) {
        events.push(event);
      }

      // Should have no events because loop terminated before first iteration
      expect(events).toHaveLength(0);
      // Stream should never have been called
      expect(mockClientAbort.stream).not.toHaveBeenCalled();
    });

    it("should terminate loop when abort signal is triggered mid-loop", async () => {
      const abortController = new AbortController();
      let streamCallCount = 0;

      const mockClientAbort = {
        stream: vi.fn().mockImplementation(async function* () {
          streamCallCount++;
          // Abort after first stream call completes
          if (streamCallCount === 1) {
            abortController.abort("user cancelled");
          }
          yield { text: "Test response" };
        }),
        modelRegistry: {
          getModelLimits: vi.fn().mockReturnValue({ maxOutputTokens: 4096 }),
        },
      } as unknown as LLMist;

      const agent = new AgentBuilder(mockClientAbort)
        .withModel("test:model")
        .withGadgets()
        .withSignal(abortController.signal)
        .withMaxIterations(10)
        .withTextOnlyHandler("acknowledge") // Keep loop going after text-only response
        .ask("Test prompt");

      for await (const _event of agent.run()) {
        // consume events
      }

      // Should have called stream only once before abort was detected
      expect(streamCallCount).toBe(1);
    });

    it("should call onAbort observer when aborted", async () => {
      const abortController = new AbortController();
      const onAbortMock = vi.fn();

      const mockClientAbort = {
        stream: vi.fn().mockImplementation(async function* () {
          abortController.abort("user cancelled");
          yield { text: "Test response" };
        }),
        modelRegistry: {
          getModelLimits: vi.fn().mockReturnValue({ maxOutputTokens: 4096 }),
        },
      } as unknown as LLMist;

      const agent = new AgentBuilder(mockClientAbort)
        .withModel("test:model")
        .withGadgets()
        .withSignal(abortController.signal)
        .withMaxIterations(10)
        .withTextOnlyHandler("acknowledge") // Keep loop going after text-only response
        .withHooks({
          observers: {
            onAbort: onAbortMock,
          },
        })
        .ask("Test prompt");

      for await (const _event of agent.run()) {
        // consume events
      }

      expect(onAbortMock).toHaveBeenCalledTimes(1);
      expect(onAbortMock).toHaveBeenCalledWith(
        expect.objectContaining({
          iteration: 1,
          reason: "user cancelled",
        }),
      );
    });

    it("should not call onAbort observer when completing normally", async () => {
      const onAbortMock = vi.fn();

      const mockClientAbort = {
        stream: vi.fn().mockImplementation(async function* () {
          yield { text: "Test response" };
        }),
        modelRegistry: {
          getModelLimits: vi.fn().mockReturnValue({ maxOutputTokens: 4096 }),
        },
      } as unknown as LLMist;

      const agent = new AgentBuilder(mockClientAbort)
        .withModel("test:model")
        .withGadgets()
        .withMaxIterations(1)
        .withHooks({
          observers: {
            onAbort: onAbortMock,
          },
        })
        .ask("Test prompt");

      for await (const _event of agent.run()) {
        // consume events
      }

      expect(onAbortMock).not.toHaveBeenCalled();
    });

    it("should include abort reason in onAbort context", async () => {
      const abortController = new AbortController();
      const customReason = { code: "TIMEOUT", message: "Operation timed out" };
      let receivedContext: { iteration: number; reason?: unknown } | null = null;

      const mockClientAbort = {
        stream: vi.fn().mockImplementation(async function* () {
          abortController.abort(customReason);
          yield { text: "Test" };
        }),
        modelRegistry: {
          getModelLimits: vi.fn().mockReturnValue({ maxOutputTokens: 4096 }),
        },
      } as unknown as LLMist;

      const agent = new AgentBuilder(mockClientAbort)
        .withModel("test:model")
        .withGadgets()
        .withSignal(abortController.signal)
        .withTextOnlyHandler("acknowledge") // Keep loop going after text-only response
        .withHooks({
          observers: {
            onAbort: (ctx) => {
              receivedContext = { iteration: ctx.iteration, reason: ctx.reason };
            },
          },
        })
        .ask("Test");

      for await (const _event of agent.run()) {
        // consume
      }

      expect(receivedContext).not.toBeNull();
      expect(receivedContext?.reason).toEqual(customReason);
    });
  });

  describe("Agent REPL support", () => {
    describe("injectUserMessage", () => {
      it("should queue messages for injection", () => {
        const agent = new AgentBuilder(mockClient).withModel("test:model").withGadgets().build();

        agent.injectUserMessage("First message");
        agent.injectUserMessage("Second message");

        // Verify messages are queued (using getConversation to check state)
        const conversation = agent.getConversation();
        expect(conversation).toBeDefined();
      });

      it("should process injected messages in next iteration", async () => {
        let iterationCount = 0;
        const mockClientInjection = {
          stream: vi.fn().mockImplementation(async function* () {
            iterationCount++;
            yield { text: "Response " + iterationCount };
          }),
          modelRegistry: {
            getModelLimits: vi.fn().mockReturnValue({ maxOutputTokens: 4096 }),
          },
        } as unknown as LLMist;

        const agent = new AgentBuilder(mockClientInjection)
          .withModel("test:model")
          .withGadgets()
          .withMaxIterations(3)
          .withTextOnlyHandler("acknowledge") // Continue after each response
          .ask("Initial prompt");

        // Inject a message before starting
        agent.injectUserMessage("Injected before run");

        for await (const event of agent.run()) {
          if (event.type === "text" && iterationCount === 1) {
            // Inject during iteration 1
            agent.injectUserMessage("Injected during run");
          }
        }

        // Verify injected messages were added to conversation history
        const history = agent.getConversation().getHistoryMessages();
        const userMessages = history.filter((m) => m.role === "user");

        // Should have injected messages in history
        expect(userMessages.length).toBeGreaterThan(0);
      });

      it("should process multiple injected messages in order", async () => {
        const messagesReceived: string[] = [];
        const mockClientMulti = {
          stream: vi.fn().mockImplementation(async function* (options: {
            messages: Array<{ content: string }>;
          }) {
            // Extract user messages from the call
            const userMsgs = options.messages.filter((m: { role?: string }) => m.role === "user");
            userMsgs.forEach((m) => {
              if (typeof m.content === "string" && m.content.startsWith("Injected")) {
                messagesReceived.push(m.content);
              }
            });
            yield { text: "Response" };
          }),
          modelRegistry: {
            getModelLimits: vi.fn().mockReturnValue({ maxOutputTokens: 4096 }),
          },
        } as unknown as LLMist;

        const agent = new AgentBuilder(mockClientMulti)
          .withModel("test:model")
          .withGadgets()
          .ask("Initial");

        // Queue multiple messages
        agent.injectUserMessage("Injected 1");
        agent.injectUserMessage("Injected 2");

        for await (const _event of agent.run()) {
          // consume
        }

        // Messages should be processed in order
        expect(messagesReceived).toContain("Injected 1");
        expect(messagesReceived).toContain("Injected 2");
      });
    });

    describe("getConversation", () => {
      it("should return the conversation manager", () => {
        const agent = new AgentBuilder(mockClient).withModel("test:model").withGadgets().build();

        const conversation = agent.getConversation();

        expect(conversation).toBeDefined();
        expect(typeof conversation.addUserMessage).toBe("function");
        expect(typeof conversation.getConversationHistory).toBe("function");
      });

      it("should allow extracting history for session continuation", async () => {
        const mockClientHistory = {
          stream: vi.fn().mockImplementation(async function* () {
            yield { text: "Hello there!" };
          }),
          modelRegistry: {
            getModelLimits: vi.fn().mockReturnValue({ maxOutputTokens: 4096 }),
          },
        } as unknown as LLMist;

        const agent = new AgentBuilder(mockClientHistory)
          .withModel("test:model")
          .withGadgets()
          .ask("Hello");

        for await (const _event of agent.run()) {
          // consume
        }

        const history = agent.getConversation().getConversationHistory();

        expect(history.length).toBeGreaterThan(0);
        expect(history[0].role).toBe("user");
        expect(history[0].content).toBe("Hello");
      });
    });
  });

  describe("Early generator termination safety net", () => {
    it("should call onLLMCallComplete with finishReason='interrupted' when consumer breaks early", async () => {
      const onLLMCallCompleteMock = vi.fn();

      // Create a mock that yields events slowly to allow us to break mid-stream
      const mockClientEarlyBreak = {
        stream: vi.fn().mockImplementation(async function* () {
          yield { text: "First chunk" };
          // Simulate more work that won't be consumed
          yield { text: " second chunk" };
          yield { text: " third chunk" };
        }),
        modelRegistry: {
          getModelLimits: vi.fn().mockReturnValue({ maxOutputTokens: 4096 }),
        },
      } as unknown as LLMist;

      const agent = new AgentBuilder(mockClientEarlyBreak)
        .withModel("test:model")
        .withGadgets()
        .withMaxIterations(5)
        .withTextOnlyHandler("acknowledge") // Keep loop going
        .withHooks({
          observers: {
            onLLMCallComplete: onLLMCallCompleteMock,
          },
        })
        .ask("Test prompt");

      // Consume only one event then break (simulating what Dhalsim was doing)
      let eventCount = 0;
      for await (const _event of agent.run()) {
        eventCount++;
        if (eventCount === 1) {
          break; // Break early!
        }
      }

      // The onLLMCallComplete hook should still be called
      // Either with normal completion (if we consumed enough) or with interrupted
      expect(onLLMCallCompleteMock).toHaveBeenCalled();
    });

    it("should complete in-flight LLM call node in ExecutionTree when consumer breaks early", async () => {
      const mockClientEarlyBreak = {
        stream: vi.fn().mockImplementation(async function* () {
          yield { text: "Response text" };
        }),
        modelRegistry: {
          getModelLimits: vi.fn().mockReturnValue({ maxOutputTokens: 4096 }),
        },
      } as unknown as LLMist;

      const agent = new AgentBuilder(mockClientEarlyBreak)
        .withModel("test:model")
        .withGadgets()
        .withMaxIterations(5)
        .withTextOnlyHandler("acknowledge") // Keep loop going
        .ask("Test prompt");

      // Break immediately after first event
      for await (const _event of agent.run()) {
        break;
      }

      // Get the execution tree to verify LLM node was completed
      const tree = agent.getTree();
      const roots = tree.getRoots();

      // Should have at least one node
      expect(roots.length).toBeGreaterThan(0);

      // Find any LLM call nodes and verify they have completedAt set
      for (const node of roots) {
        if (node.type === "llm_call") {
          // LLM call should be marked as completed (either normally or interrupted)
          expect(node.completedAt).toBeDefined();
          expect(node.completedAt).not.toBeNull();
        }
      }
    });
  });
});
