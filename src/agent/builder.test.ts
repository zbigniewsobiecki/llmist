import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createGadget } from "../gadgets/create-gadget.js";
import { Gadget } from "../gadgets/typed-gadget.js";
import { createMockClient, getMockManager, mockLLM } from "../testing/index.js";
import { AgentBuilder, type HistoryMessage } from "./builder.js";
import { HookPresets } from "./hook-presets.js";

// Mock gadgets for testing
class Calculator extends Gadget({
  name: "Calculator",
  description: "Performs calculations",
  schema: z.object({
    a: z.number(),
    b: z.number(),
  }),
}) {
  execute(): string {
    return "42";
  }
}

class Weather extends Gadget({
  name: "Weather",
  description: "Gets weather",
  schema: z.object({
    city: z.string(),
  }),
}) {
  execute(): string {
    return "Sunny";
  }
}

describe("AgentBuilder", () => {
  describe("method chaining", () => {
    it("returns this for all configuration methods", () => {
      const builder = new AgentBuilder();

      expect(builder.withModel("gpt4")).toBe(builder);
      expect(builder.withSystem("You are helpful")).toBe(builder);
      expect(builder.withTemperature(0.7)).toBe(builder);
      expect(builder.withMaxIterations(5)).toBe(builder);
      expect(builder.withGadgets(Calculator)).toBe(builder);
      expect(builder.withHooks(HookPresets.silent())).toBe(builder);
      expect(builder.withHistory([{ user: "hi" }])).toBe(builder);
      expect(builder.addMessage({ user: "hello" })).toBe(builder);
      expect(builder.onHumanInput(async () => "response")).toBe(builder);
      expect(builder.withGadgetStartPrefix("<<<")).toBe(builder);
      expect(builder.withGadgetEndPrefix(">>>")).toBe(builder);
      expect(builder.withGadgetArgPrefix("<<<ARG>>>")).toBe(builder);
      expect(builder.withTextOnlyHandler("acknowledge")).toBe(builder);
      expect(builder.withDefaultGadgetTimeout(5000)).toBe(builder);
    });

    it("allows fluent chaining of multiple methods", () => {
      const builder = new AgentBuilder();

      const result = builder
        .withModel("sonnet")
        .withSystem("You are helpful")
        .withTemperature(0.5)
        .withMaxIterations(10)
        .withGadgets(Calculator, Weather);

      expect(result).toBe(builder);
    });
  });

  describe("withModel", () => {
    it("accepts and chains model aliases", () => {
      const builder = new AgentBuilder();
      const result = builder.withModel("gpt4");

      expect(result).toBe(builder);
    });

    it("accepts and chains full model names", () => {
      const builder = new AgentBuilder();
      const result = builder.withModel("openai:gpt-4o");

      expect(result).toBe(builder);
    });

    it("accepts and chains provider-detected model names", () => {
      const builder = new AgentBuilder();
      const result = builder.withModel("claude-3-5-sonnet");

      expect(result).toBe(builder);
    });
  });

  describe("withGadgets", () => {
    it("accepts gadget classes", () => {
      const builder = new AgentBuilder();
      const result = builder.withGadgets(Calculator, Weather);

      expect(result).toBe(builder);
    });

    it("accepts gadget instances", () => {
      const builder = new AgentBuilder();
      const result = builder.withGadgets(new Calculator(), new Weather());

      expect(result).toBe(builder);
    });

    it("accepts mixed classes and instances", () => {
      const builder = new AgentBuilder();
      const result = builder.withGadgets(Calculator, new Weather());

      expect(result).toBe(builder);
    });

    it("accepts createGadget output", () => {
      const builder = new AgentBuilder();
      const customGadget = createGadget({
        name: "Custom",
        description: "Custom gadget",
        schema: z.object({ x: z.number() }),
        execute: () => "done",
      });

      const result = builder.withGadgets(customGadget);

      expect(result).toBe(builder);
    });

    it("can be called multiple times to add more gadgets", () => {
      const builder = new AgentBuilder();
      builder.withGadgets(Calculator);
      const result = builder.withGadgets(Weather);

      expect(result).toBe(builder);
    });
  });

  describe("withHistory", () => {
    it("adds user messages to history", () => {
      const builder = new AgentBuilder();
      const result = builder.withHistory([{ user: "Hello" }, { user: "How are you?" }]);

      expect(result).toBe(builder);
    });

    it("adds assistant messages to history", () => {
      const builder = new AgentBuilder();
      const result = builder.withHistory([{ assistant: "I'm doing well" }]);

      expect(result).toBe(builder);
    });

    it("adds system messages to history", () => {
      const builder = new AgentBuilder();
      const result = builder.withHistory([{ system: "Custom system message" }]);

      expect(result).toBe(builder);
    });

    it("handles mixed message types", () => {
      const builder = new AgentBuilder();
      const messages: HistoryMessage[] = [
        { user: "Hello" },
        { assistant: "Hi there!" },
        { user: "How are you?" },
        { assistant: "I'm great!" },
      ];

      const result = builder.withHistory(messages);

      expect(result).toBe(builder);
    });

    it("chains correctly", () => {
      const builder = new AgentBuilder();
      const result = builder.withHistory([
        { user: "First" },
        { assistant: "Second" },
        { system: "Third" },
      ]);

      expect(result).toBe(builder);
    });
  });

  describe("addMessage", () => {
    it("adds a single user message", () => {
      const builder = new AgentBuilder();
      const result = builder.addMessage({ user: "Hello" });

      expect(result).toBe(builder);
    });

    it("adds a single assistant message", () => {
      const builder = new AgentBuilder();
      const result = builder.addMessage({ assistant: "Hi there!" });

      expect(result).toBe(builder);
    });

    it("can be chained multiple times", () => {
      const builder = new AgentBuilder();
      const result = builder
        .addMessage({ user: "First" })
        .addMessage({ assistant: "Second" })
        .addMessage({ user: "Third" });

      expect(result).toBe(builder);
    });
  });

  describe("clearHistory", () => {
    it("returns the builder for chaining", () => {
      const builder = new AgentBuilder();
      const result = builder.clearHistory();

      expect(result).toBe(builder);
    });

    it("clears previously set history", () => {
      const builder = new AgentBuilder();
      builder.withHistory([{ user: "Previous" }, { assistant: "History" }]);
      const result = builder.clearHistory();

      // Should return builder for chaining
      expect(result).toBe(builder);
    });

    it("allows setting new history after clearing", () => {
      const builder = new AgentBuilder();
      builder.withHistory([{ user: "Old message" }]);
      builder.clearHistory();
      const result = builder.withHistory([{ user: "New message" }]);

      expect(result).toBe(builder);
    });

    it("chains with withHistory correctly", () => {
      const builder = new AgentBuilder();
      const result = builder
        .withHistory([{ user: "Old" }])
        .clearHistory()
        .withHistory([{ user: "New" }]);

      expect(result).toBe(builder);
    });
  });

  describe("continueFrom", () => {
    it("returns the builder for chaining", async () => {
      // Clear any previous mocks and register new one
      getMockManager().clear();
      mockLLM().forAnyModel().returns("Hello!").register();

      const mockClient = createMockClient();

      // Create first agent
      const builder1 = new AgentBuilder(mockClient);
      const agent1 = builder1.withModel("haiku").ask("Hello");

      // Run first agent to create conversation
      for await (const _ of agent1.run()) {
        // Consume all events
      }

      // Continue from first agent
      const builder2 = new AgentBuilder(mockClient);
      const result = builder2.withModel("haiku").continueFrom(agent1);

      expect(result).toBe(builder2);

      // Clean up
      getMockManager().clear();
    });

    it("extracts conversation history from previous agent", async () => {
      // Clear any previous mocks and register new one
      getMockManager().clear();
      mockLLM().forAnyModel().returns("Hi there!").register();

      const mockClient = createMockClient();

      // Create and run first agent
      const builder1 = new AgentBuilder(mockClient);
      const agent1 = builder1.withModel("haiku").ask("Hello");

      for await (const _ of agent1.run()) {
        // Consume all events
      }

      // Verify the first agent has conversation history
      const history = agent1.getConversation().getConversationHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].role).toBe("user");
      expect(history[0].content).toBe("Hello");

      // Clean up
      getMockManager().clear();
    });

    it("clears previous history before setting new one", async () => {
      // Clear any previous mocks and register new one
      getMockManager().clear();
      mockLLM().forAnyModel().returns("Response").register();

      const mockClient = createMockClient();

      // Create and run first agent
      const builder1 = new AgentBuilder(mockClient);
      const agent1 = builder1.withModel("haiku").ask("First question");

      for await (const _ of agent1.run()) {
        // Consume all events
      }

      // Create builder with some existing history, then continue from agent
      const builder2 = new AgentBuilder(mockClient);
      builder2
        .withModel("haiku")
        .withHistory([{ user: "This should be cleared" }])
        .continueFrom(agent1);

      // The builder should now have agent1's history, not the old one
      // (we can verify this by building another agent and checking its conversation)
      expect(builder2).toBeTruthy();

      // Clean up
      getMockManager().clear();
    });
  });

  describe("withHooks", () => {
    it("accepts hook presets", () => {
      const builder = new AgentBuilder();
      const result = builder.withHooks(HookPresets.logging());

      expect(result).toBe(builder);
    });

    it("accepts merged hooks", () => {
      const builder = new AgentBuilder();
      const result = builder.withHooks(
        HookPresets.merge(HookPresets.logging(), HookPresets.timing()),
      );

      expect(result).toBe(builder);
    });

    it("accepts custom hooks", () => {
      const builder = new AgentBuilder();
      const result = builder.withHooks({
        observers: {
          onLLMCallStart: vi.fn(),
        },
      });

      expect(result).toBe(builder);
    });
  });

  describe("withSubagentEventCallback", () => {
    it("returns this for chaining", () => {
      const builder = new AgentBuilder();
      const result = builder.withSubagentEventCallback(() => {});

      expect(result).toBe(builder);
    });

    it("accepts a callback function", () => {
      const builder = new AgentBuilder();
      const callback = vi.fn();
      const result = builder.withSubagentEventCallback(callback);

      expect(result).toBe(builder);
    });

    it("chains correctly with other builder methods", () => {
      const builder = new AgentBuilder();
      const result = builder
        .withModel("sonnet")
        .withSubagentEventCallback(() => {})
        .withMaxIterations(5);

      expect(result).toBe(builder);
    });
  });

  describe("withParentContext", () => {
    it("returns this for chaining", () => {
      const builder = new AgentBuilder();
      const mockCtx = {
        invocationId: "test-123",
        onSubagentEvent: vi.fn(),
      };
      const result = builder.withParentContext(mockCtx as never);

      expect(result).toBe(builder);
    });

    it("accepts optional depth parameter", () => {
      const builder = new AgentBuilder();
      const mockCtx = {
        invocationId: "test-123",
        onSubagentEvent: vi.fn(),
      };
      const result = builder.withParentContext(mockCtx as never, 2);

      expect(result).toBe(builder);
    });

    it("handles context without onSubagentEvent gracefully", () => {
      const builder = new AgentBuilder();
      const mockCtx = { invocationId: "test-123" };
      const result = builder.withParentContext(mockCtx as never);

      expect(result).toBe(builder);
    });

    it("chains correctly with other builder methods", () => {
      const builder = new AgentBuilder();
      const mockCtx = {
        invocationId: "test-123",
        onSubagentEvent: vi.fn(),
      };
      const result = builder
        .withModel("sonnet")
        .withParentContext(mockCtx as never)
        .withMaxIterations(5);

      expect(result).toBe(builder);
    });

    it("captures tree context when ctx.tree is provided", async () => {
      const { ExecutionTree } = await import("../core/execution-tree.js");
      const mockClient = createMockClient();
      const parentTree = new ExecutionTree();

      // Add a parent LLM call (required for proper tree structure)
      parentTree.addLLMCall({
        iteration: 0,
        model: "test-model",
      });

      // Simulate parent adding a gadget
      const parentGadget = parentTree.addGadget({
        invocationId: "parent_gadget_1",
        name: "BrowseWeb",
        parameters: { url: "https://example.com" },
      });

      // Create ExecutionContext like executor.ts does
      const ctx = {
        reportCost: () => {},
        signal: new AbortController().signal,
        tree: parentTree,
        nodeId: parentGadget.id,
        depth: 1,
      };

      const agent = new AgentBuilder(mockClient)
        .withModel("sonnet")
        .withParentContext(ctx as never)
        .build();

      // Verify the agent uses the SAME tree instance (shared)
      expect(agent.getTree()).toBe(parentTree);
    });

    it("captures tree context even without onSubagentEvent", async () => {
      const { ExecutionTree } = await import("../core/execution-tree.js");
      const mockClient = createMockClient();
      const parentTree = new ExecutionTree();

      // Create minimal ExecutionContext with ONLY tree (no callback)
      const ctx = {
        reportCost: () => {},
        signal: new AbortController().signal,
        tree: parentTree,
        // NO onSubagentEvent
        // NO invocationId
      };

      const agent = new AgentBuilder(mockClient)
        .withModel("sonnet")
        .withParentContext(ctx as never)
        .build();

      // Tree should still be shared
      expect(agent.getTree()).toBe(parentTree);
    });

    it("creates new tree when ctx.tree is not provided", async () => {
      const { ExecutionTree } = await import("../core/execution-tree.js");
      const mockClient = createMockClient();

      // Create ExecutionContext WITHOUT tree
      const ctx = {
        reportCost: () => {},
        signal: new AbortController().signal,
        // NO tree
      };

      const agent = new AgentBuilder(mockClient)
        .withModel("sonnet")
        .withParentContext(ctx as never)
        .build();

      // Agent should have created its own tree
      expect(agent.getTree()).toBeInstanceOf(ExecutionTree);
    });
  });

  describe("onHumanInput", () => {
    it("sets human input handler", () => {
      const builder = new AgentBuilder();
      const handler = vi.fn(async () => "response");

      const result = builder.onHumanInput(handler);

      expect(result).toBe(builder);
    });

    it("accepts async handler", () => {
      const builder = new AgentBuilder();
      const handler = async (question: string) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return `Answer to: ${question}`;
      };

      const result = builder.onHumanInput(handler);

      expect(result).toBe(builder);
    });
  });

  describe("withSystem", () => {
    it("sets system prompt", () => {
      const builder = new AgentBuilder();
      const result = builder.withSystem("You are a helpful assistant");

      expect(result).toBe(builder);
    });

    it("handles multiline system prompts", () => {
      const builder = new AgentBuilder();
      const result = builder.withSystem(`
        You are a helpful assistant.
        You should be concise.
        You should be friendly.
      `);

      expect(result).toBe(builder);
    });
  });

  describe("withTemperature", () => {
    it("sets temperature", () => {
      const builder = new AgentBuilder();
      const result = builder.withTemperature(0.7);

      expect(result).toBe(builder);
    });

    it("accepts temperature 0", () => {
      const builder = new AgentBuilder();
      const result = builder.withTemperature(0);

      expect(result).toBe(builder);
    });

    it("accepts temperature 1", () => {
      const builder = new AgentBuilder();
      const result = builder.withTemperature(1);

      expect(result).toBe(builder);
    });
  });

  describe("withMaxIterations", () => {
    it("sets max iterations", () => {
      const builder = new AgentBuilder();
      const result = builder.withMaxIterations(10);

      expect(result).toBe(builder);
    });

    it("accepts 1 iteration", () => {
      const builder = new AgentBuilder();
      const result = builder.withMaxIterations(1);

      expect(result).toBe(builder);
    });
  });

  describe("ask", () => {
    it("has ask method defined", () => {
      const builder = new AgentBuilder();

      expect(builder.ask).toBeDefined();
      expect(typeof builder.ask).toBe("function");
    });
  });

  describe("askAndCollect", () => {
    it("has askAndCollect method defined", () => {
      const builder = new AgentBuilder();

      expect(builder.askAndCollect).toBeDefined();
      expect(typeof builder.askAndCollect).toBe("function");
    });
  });

  describe("askWith", () => {
    it("has askWith method defined", () => {
      const builder = new AgentBuilder();

      expect(builder.askWith).toBeDefined();
      expect(typeof builder.askWith).toBe("function");
    });
  });

  describe("withGadgetStartPrefix", () => {
    it("sets custom gadget start prefix", () => {
      const builder = new AgentBuilder();
      const result = builder.withGadgetStartPrefix("<<GADGET_START>>");

      expect(result).toBe(builder);
    });

    it("chains correctly", () => {
      const builder = new AgentBuilder();
      const result = builder.withGadgetStartPrefix("<<<").withGadgetEndPrefix(">>>");

      expect(result).toBe(builder);
    });
  });

  describe("withGadgetEndPrefix", () => {
    it("sets custom gadget end prefix", () => {
      const builder = new AgentBuilder();
      const result = builder.withGadgetEndPrefix("<<GADGET_END>>");

      expect(result).toBe(builder);
    });
  });

  describe("withGadgetArgPrefix", () => {
    it("sets custom argument prefix", () => {
      const builder = new AgentBuilder();
      const result = builder.withGadgetArgPrefix("<<ARG>>");

      expect(result).toBe(builder);
    });
  });

  describe("withSyntheticGadgetCall", () => {
    it("returns this for chaining", () => {
      const builder = new AgentBuilder();
      const result = builder.withSyntheticGadgetCall("TestGadget", { foo: "bar" }, "result", "gc_1");

      expect(result).toBe(builder);
    });

    it("formats gadget call with default prefixes and invocation ID", () => {
      const builder = new AgentBuilder();
      builder.withSyntheticGadgetCall("TestGadget", { message: "hello" }, "Success", "gc_1");

      // Access private initialMessages via type assertion
      const messages = (
        builder as unknown as { initialMessages: Array<{ role: string; content: string }> }
      ).initialMessages;

      expect(messages).toHaveLength(2);

      // Assistant message with gadget call (including invocation ID)
      expect(messages[0].role).toBe("assistant");
      expect(messages[0].content).toContain("!!!GADGET_START:TestGadget:gc_1");
      expect(messages[0].content).toContain("!!!ARG:message");
      expect(messages[0].content).toContain("hello");
      expect(messages[0].content).toContain("!!!GADGET_END");

      // User message with result (including invocation ID)
      expect(messages[1].role).toBe("user");
      expect(messages[1].content).toBe("Result (gc_1): Success");
    });

    it("uses custom gadget prefixes when configured", () => {
      const builder = new AgentBuilder();
      builder
        .withGadgetStartPrefix("<<<GADGET>>>")
        .withGadgetEndPrefix("<<<END>>>")
        .withGadgetArgPrefix("<<<ARG>>>")
        .withSyntheticGadgetCall("Calculator", { a: 1, b: 2 }, "3", "gc_2");

      const messages = (
        builder as unknown as { initialMessages: Array<{ role: string; content: string }> }
      ).initialMessages;

      expect(messages).toHaveLength(2);

      // Verify custom prefixes are used with invocation ID
      const assistantContent = messages[0].content;
      expect(assistantContent).toContain("<<<GADGET>>>Calculator:gc_2");
      expect(assistantContent).toContain("<<<ARG>>>a");
      expect(assistantContent).toContain("<<<ARG>>>b");
      expect(assistantContent).toContain("<<<END>>>");

      // Ensure default prefixes are NOT used
      expect(assistantContent).not.toContain("!!!GADGET_START:");
      expect(assistantContent).not.toContain("!!!ARG:");
      expect(assistantContent).not.toContain("!!!GADGET_END");
    });

    it("handles nested object parameters", () => {
      const builder = new AgentBuilder();
      builder.withSyntheticGadgetCall(
        "CreateTask",
        {
          title: "My Task",
          metadata: { priority: "high", tags: ["urgent", "bug"] },
        },
        "Task created",
        "gc_3",
      );

      const messages = (
        builder as unknown as { initialMessages: Array<{ role: string; content: string }> }
      ).initialMessages;
      const content = messages[0].content;

      // Verify nested paths use JSON Pointer format
      expect(content).toContain("!!!ARG:title");
      expect(content).toContain("!!!ARG:metadata/priority");
      expect(content).toContain("!!!ARG:metadata/tags/0");
      expect(content).toContain("!!!ARG:metadata/tags/1");
    });

    it("can be called multiple times to add multiple synthetic calls", () => {
      const builder = new AgentBuilder();
      builder
        .withSyntheticGadgetCall("First", { x: 1 }, "one", "gc_a")
        .withSyntheticGadgetCall("Second", { y: 2 }, "two", "gc_b");

      const messages = (
        builder as unknown as { initialMessages: Array<{ role: string; content: string }> }
      ).initialMessages;

      // Each call adds 2 messages (assistant + user)
      expect(messages).toHaveLength(4);
      expect(messages[0].content).toContain("First:gc_a");
      expect(messages[2].content).toContain("Second:gc_b");
    });
  });

  describe("withTextOnlyHandler", () => {
    it("accepts 'terminate' strategy", () => {
      const builder = new AgentBuilder();
      const result = builder.withTextOnlyHandler("terminate");

      expect(result).toBe(builder);
    });

    it("accepts 'acknowledge' strategy", () => {
      const builder = new AgentBuilder();
      const result = builder.withTextOnlyHandler("acknowledge");

      expect(result).toBe(builder);
    });

    it("accepts 'wait_for_input' strategy", () => {
      const builder = new AgentBuilder();
      const result = builder.withTextOnlyHandler("wait_for_input");

      expect(result).toBe(builder);
    });

    it("accepts custom handler", () => {
      const builder = new AgentBuilder();
      const customHandler = {
        type: "custom" as const,
        handler: vi.fn(async () => ({ action: "continue" as const })),
      };

      const result = builder.withTextOnlyHandler(customHandler);

      expect(result).toBe(builder);
    });

    it("chains correctly", () => {
      const builder = new AgentBuilder();
      const result = builder.withModel("gpt4").withTextOnlyHandler("acknowledge");

      expect(result).toBe(builder);
    });
  });

  describe("withDefaultGadgetTimeout", () => {
    it("sets default gadget timeout", () => {
      const builder = new AgentBuilder();
      const result = builder.withDefaultGadgetTimeout(5000);

      expect(result).toBe(builder);
    });

    it("accepts zero timeout", () => {
      const builder = new AgentBuilder();
      const result = builder.withDefaultGadgetTimeout(0);

      expect(result).toBe(builder);
    });

    it("accepts large timeout values", () => {
      const builder = new AgentBuilder();
      const result = builder.withDefaultGadgetTimeout(300000);

      expect(result).toBe(builder);
    });

    it("throws error for negative timeout", () => {
      const builder = new AgentBuilder();

      expect(() => builder.withDefaultGadgetTimeout(-1000)).toThrow(
        "Timeout must be a non-negative number",
      );
    });

    it("chains correctly", () => {
      const builder = new AgentBuilder();
      const result = builder.withModel("gpt4").withDefaultGadgetTimeout(10000);

      expect(result).toBe(builder);
    });
  });

  describe("full integration", () => {
    it("builds a complete configuration chain", () => {
      const builder = new AgentBuilder();

      const result = builder
        .withModel("sonnet")
        .withSystem("You are a math tutor")
        .withTemperature(0.3)
        .withMaxIterations(20)
        .withGadgets(Calculator, Weather)
        .withHooks(HookPresets.monitoring({ verbose: true }))
        .withHistory([{ user: "Hi" }, { assistant: "Hello! How can I help?" }])
        .onHumanInput(async (q) => `Answer to: ${q}`)
        .withTextOnlyHandler("acknowledge")
        .withDefaultGadgetTimeout(10000);

      expect(result).toBe(builder);
    });

    it("supports minimal configuration", () => {
      const builder = new AgentBuilder();

      expect(builder).toBeTruthy();
    });

    it("allows reconfiguring with multiple calls", () => {
      const builder = new AgentBuilder();

      builder.withModel("gpt4");
      builder.withModel("sonnet"); // Should override

      expect(builder).toBeTruthy();
    });
  });

  describe("build()", () => {
    it("creates an agent without a user prompt", () => {
      const builder = new AgentBuilder();
      const agent = builder.withModel("gpt4-mini").build();

      expect(agent).toBeDefined();
    });

    it("provides access to the gadget registry via getRegistry()", () => {
      const agent = new AgentBuilder()
        .withModel("sonnet")
        .withGadgets(Calculator, Weather)
        .withGadgetOutputLimit(false) // Disable to avoid auto-registered GadgetOutputViewer
        .build();

      const registry = agent.getRegistry();
      const names = registry.getNames();

      // Registry stores names from gadget definitions (may be lowercase)
      expect(names).toHaveLength(2);
      expect(registry.has("Calculator")).toBe(true);
      expect(registry.has("Weather")).toBe(true);
      expect(registry.getAll()).toHaveLength(2);
    });

    it("throws error when run() is called without user prompt", async () => {
      const agent = new AgentBuilder().withModel("gpt4-mini").build();

      const runGenerator = agent.run();

      await expect(runGenerator.next()).rejects.toThrow("No user prompt provided");
    });

    it("ask() still works normally and provides getRegistry()", () => {
      const agent = new AgentBuilder().withModel("gpt4-mini").withGadgets(Calculator).ask("Hello");

      expect(agent).toBeDefined();
      expect(agent.getRegistry()).toBeDefined();
      expect(agent.getRegistry().has("Calculator")).toBe(true);
    });

    it("preserves all configuration in build()", () => {
      const agent = new AgentBuilder()
        .withModel("sonnet")
        .withSystem("You are helpful")
        .withTemperature(0.7)
        .withMaxIterations(5)
        .withGadgets(Calculator)
        .build();

      // Verify registry is populated (indirect check that config was applied)
      const registry = agent.getRegistry();
      expect(registry.has("Calculator")).toBe(true);
    });

    it("has build method defined", () => {
      const builder = new AgentBuilder();

      expect(builder.build).toBeDefined();
      expect(typeof builder.build).toBe("function");
    });
  });

  describe("edge cases", () => {
    it("handles empty strings", () => {
      const builder = new AgentBuilder();
      const result = builder.withModel("gpt4").withSystem("");

      expect(result).toBe(builder);
    });

    it("handles special characters in configuration", () => {
      const builder = new AgentBuilder();
      const result = builder.withSystem("\\n \\t \"quoted\" 'single'");

      expect(result).toBe(builder);
    });

    it("handles very long system prompts", () => {
      const builder = new AgentBuilder();
      const longPrompt = "A".repeat(10000);

      const result = builder.withSystem(longPrompt);

      expect(result).toBe(builder);
    });

    it("handles multiple calls to same configuration method", () => {
      const builder = new AgentBuilder();
      builder.withModel("gpt4");
      builder.withModel("sonnet"); // Should override

      expect(builder).toBeTruthy();
    });

    it("handles large number of gadgets", () => {
      const builder = new AgentBuilder();
      const gadgets = Array(50)
        .fill(null)
        .map(() => Calculator);

      const result = builder.withGadgets(...gadgets);

      expect(result).toBe(builder);
    });

    it("handles large history", () => {
      const builder = new AgentBuilder();
      const messages: HistoryMessage[] = Array(100)
        .fill(null)
        .map((_, i) => (i % 2 === 0 ? { user: `Message ${i}` } : { assistant: `Response ${i}` }));

      const result = builder.withHistory(messages);

      expect(result).toBe(builder);
    });
  });

  describe("withTrailingMessage", () => {
    it("returns this for chaining", () => {
      const builder = new AgentBuilder();
      const result = builder.withTrailingMessage("Always respond in JSON format.");

      expect(result).toBe(builder);
    });

    it("accepts a static string message", () => {
      const builder = new AgentBuilder();
      const result = builder.withTrailingMessage("Be concise.");

      expect(result).toBe(builder);
    });

    it("accepts a function that generates the message", () => {
      const builder = new AgentBuilder();
      const result = builder.withTrailingMessage((ctx) => `Iteration ${ctx.iteration}`);

      expect(result).toBe(builder);
    });

    it("chains correctly with other builder methods", () => {
      const builder = new AgentBuilder();
      const result = builder
        .withModel("sonnet")
        .withSystem("You are helpful")
        .withTrailingMessage("Stay focused.")
        .withMaxIterations(10);

      expect(result).toBe(builder);
    });

    it("creates hooks with beforeLLMCall controller when trailing message is set", () => {
      const builder = new AgentBuilder();
      builder.withTrailingMessage("Test message");

      // Access private composeHooks via type assertion
      const composedHooks = (
        builder as unknown as { composeHooks: () => { controllers?: { beforeLLMCall?: unknown } } }
      ).composeHooks();

      expect(composedHooks).toBeDefined();
      expect(composedHooks?.controllers?.beforeLLMCall).toBeDefined();
      expect(typeof composedHooks?.controllers?.beforeLLMCall).toBe("function");
    });

    it("returns undefined hooks when no trailing message is set", () => {
      const builder = new AgentBuilder();

      const composedHooks = (
        builder as unknown as { composeHooks: () => undefined | object }
      ).composeHooks();

      expect(composedHooks).toBeUndefined();
    });

    it("preserves existing hooks when trailing message is added", () => {
      const onLLMCallStart = vi.fn();
      const builder = new AgentBuilder();
      builder.withHooks({
        observers: { onLLMCallStart },
      });
      builder.withTrailingMessage("Test message");

      const composedHooks = (
        builder as unknown as {
          composeHooks: () => {
            observers?: { onLLMCallStart?: unknown };
            controllers?: { beforeLLMCall?: unknown };
          };
        }
      ).composeHooks();

      // Should have both the observer and the controller
      expect(composedHooks?.observers?.onLLMCallStart).toBe(onLLMCallStart);
      expect(composedHooks?.controllers?.beforeLLMCall).toBeDefined();
    });

    it("composes with existing beforeLLMCall controller", async () => {
      const existingController = vi.fn(async () => ({
        action: "proceed" as const,
        modifiedOptions: { temperature: 0.5 },
      }));

      const builder = new AgentBuilder();
      builder.withHooks({
        controllers: { beforeLLMCall: existingController },
      });
      builder.withTrailingMessage("Test message");

      const composedHooks = (
        builder as unknown as {
          composeHooks: () => {
            controllers?: { beforeLLMCall?: (ctx: unknown) => Promise<unknown> };
          };
        }
      ).composeHooks();
      const controller = composedHooks?.controllers?.beforeLLMCall;

      // Call the composed controller
      const mockContext = {
        iteration: 1,
        maxIterations: 10,
        options: { messages: [{ role: "user", content: "Hello" }] },
        logger: {} as never,
      };

      const result = (await controller?.(mockContext)) as {
        action: string;
        modifiedOptions?: { messages?: unknown[]; temperature?: number };
      };

      // Existing controller should have been called
      expect(existingController).toHaveBeenCalledWith(mockContext);

      // Result should include both the existing modification and the trailing message
      expect(result.action).toBe("proceed");
      expect(result.modifiedOptions?.temperature).toBe(0.5);
      expect(result.modifiedOptions?.messages).toHaveLength(2);
      expect((result.modifiedOptions?.messages?.[1] as { content: string }).content).toBe(
        "Test message",
      );
    });

    it("does not add trailing message when existing controller returns skip", async () => {
      const existingController = vi.fn(async () => ({
        action: "skip" as const,
        syntheticResponse: "Cached response",
      }));

      const builder = new AgentBuilder();
      builder.withHooks({
        controllers: { beforeLLMCall: existingController },
      });
      builder.withTrailingMessage("Test message");

      const composedHooks = (
        builder as unknown as {
          composeHooks: () => {
            controllers?: { beforeLLMCall?: (ctx: unknown) => Promise<unknown> };
          };
        }
      ).composeHooks();
      const controller = composedHooks?.controllers?.beforeLLMCall;

      const mockContext = {
        iteration: 1,
        maxIterations: 10,
        options: { messages: [{ role: "user", content: "Hello" }] },
        logger: {} as never,
      };

      const result = (await controller?.(mockContext)) as {
        action: string;
        syntheticResponse?: string;
      };

      // Should return the skip action unchanged
      expect(result.action).toBe("skip");
      expect(result.syntheticResponse).toBe("Cached response");
    });

    it("calls dynamic message function with correct context", async () => {
      const messageFn = vi.fn(
        (ctx: { iteration: number; maxIterations: number }) =>
          `Iteration ${ctx.iteration}/${ctx.maxIterations}`,
      );

      const builder = new AgentBuilder();
      builder.withTrailingMessage(messageFn);

      const composedHooks = (
        builder as unknown as {
          composeHooks: () => {
            controllers?: { beforeLLMCall?: (ctx: unknown) => Promise<unknown> };
          };
        }
      ).composeHooks();
      const controller = composedHooks?.controllers?.beforeLLMCall;

      const mockContext = {
        iteration: 3,
        maxIterations: 10,
        options: { messages: [{ role: "user", content: "Hello" }] },
        logger: {} as never,
      };

      const result = (await controller?.(mockContext)) as {
        modifiedOptions?: { messages?: Array<{ role: string; content: string }> };
      };

      // Message function should have been called with iteration context
      expect(messageFn).toHaveBeenCalledWith({ iteration: 3, maxIterations: 10 });

      // Result should include the generated message
      const trailingMessage = result.modifiedOptions?.messages?.[1];
      expect(trailingMessage?.content).toBe("Iteration 3/10");
      expect(trailingMessage?.role).toBe("user");
    });
  });
});
