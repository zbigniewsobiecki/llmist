import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createGadget } from "../gadgets/create-gadget.js";
import { Gadget } from "../gadgets/typed-gadget.js";
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
      expect(builder.withStopOnGadgetError(false)).toBe(builder);
      expect(builder.withErrorHandler(() => true)).toBe(builder);
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

  describe("withStopOnGadgetError", () => {
    it("sets stop on gadget error to true", () => {
      const builder = new AgentBuilder();
      const result = builder.withStopOnGadgetError(true);

      expect(result).toBe(builder);
    });

    it("sets stop on gadget error to false", () => {
      const builder = new AgentBuilder();
      const result = builder.withStopOnGadgetError(false);

      expect(result).toBe(builder);
    });

    it("chains correctly", () => {
      const builder = new AgentBuilder();
      const result = builder.withModel("gpt4").withStopOnGadgetError(false);

      expect(result).toBe(builder);
    });
  });

  describe("withErrorHandler", () => {
    it("sets custom error handler function", () => {
      const builder = new AgentBuilder();
      const handler = vi.fn(() => true);

      const result = builder.withErrorHandler(handler);

      expect(result).toBe(builder);
    });

    it("accepts async error handler", () => {
      const builder = new AgentBuilder();
      const handler = vi.fn(async () => false);

      const result = builder.withErrorHandler(handler);

      expect(result).toBe(builder);
    });

    it("accepts handler with context parameter", () => {
      const builder = new AgentBuilder();
      const handler = vi.fn((context) => {
        return context.errorType !== "parse";
      });

      const result = builder.withErrorHandler(handler);

      expect(result).toBe(builder);
    });

    it("chains correctly", () => {
      const builder = new AgentBuilder();
      const result = builder.withModel("gpt4").withErrorHandler(() => true);

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
        .withStopOnGadgetError(false)
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
});
