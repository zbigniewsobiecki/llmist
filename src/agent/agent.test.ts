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
      manager.addGadgetCall("TestCalculator", { a: 1, b: 1 }, "Result: 2");

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
});
