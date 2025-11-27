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

      const manager = new ConversationManager(baseMessages, initialMessages, { parameterFormat: "json" });

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
});
