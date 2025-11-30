import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { Gadget } from "../gadgets/typed-gadget.js";
import { MathGadget, TestGadget } from "../testing/helpers.js";
import { GADGET_ARG_PREFIX, GADGET_END_PREFIX, GADGET_START_PREFIX } from "./constants.js";
import { isLLMMessage, LLMMessageBuilder } from "./messages.js";
import type { PromptConfig } from "./prompt-config.js";

/** Test gadget with examples for testing argPrefix propagation */
class ExampleGadget extends Gadget({
  name: "ExampleGadget",
  description: "A gadget with examples",
  schema: z.object({
    query: z.string().describe("Search query"),
  }),
  examples: [
    { params: { query: "test search" }, output: "Result: found", comment: "Basic search" },
  ],
}) {
  execute(params: this["params"]): string {
    return `Searched: ${params.query}`;
  }
}

describe("LLMMessageBuilder", () => {
  describe("addSystem", () => {
    it("adds system message", () => {
      const builder = new LLMMessageBuilder();
      builder.addSystem("You are a helpful assistant.");

      const messages = builder.build();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        role: "system",
        content: "You are a helpful assistant.",
        metadata: undefined,
      });
    });

    it("adds system message with metadata", () => {
      const builder = new LLMMessageBuilder();
      builder.addSystem("System prompt", { source: "test" });

      const messages = builder.build();

      expect(messages[0]).toMatchObject({
        role: "system",
        content: "System prompt",
        metadata: { source: "test" },
      });
    });

    it("allows multiple system messages", () => {
      const builder = new LLMMessageBuilder();
      builder.addSystem("First system");
      builder.addSystem("Second system");

      const messages = builder.build();

      expect(messages).toHaveLength(2);
      expect(messages[0]?.role).toBe("system");
      expect(messages[1]?.role).toBe("system");
    });
  });

  describe("addUser", () => {
    it("adds user message", () => {
      const builder = new LLMMessageBuilder();
      builder.addUser("Hello, how are you?");

      const messages = builder.build();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        role: "user",
        content: "Hello, how are you?",
        metadata: undefined,
      });
    });

    it("adds user message with metadata", () => {
      const builder = new LLMMessageBuilder();
      builder.addUser("Question", { timestamp: "2024-01-01" });

      const messages = builder.build();

      expect(messages[0]).toMatchObject({
        role: "user",
        content: "Question",
        metadata: { timestamp: "2024-01-01" },
      });
    });
  });

  describe("addAssistant", () => {
    it("adds assistant message", () => {
      const builder = new LLMMessageBuilder();
      builder.addAssistant("I am doing well, thank you!");

      const messages = builder.build();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        role: "assistant",
        content: "I am doing well, thank you!",
        metadata: undefined,
      });
    });

    it("adds assistant message with metadata", () => {
      const builder = new LLMMessageBuilder();
      builder.addAssistant("Response", { model: "test-model" });

      const messages = builder.build();

      expect(messages[0]).toMatchObject({
        role: "assistant",
        content: "Response",
        metadata: { model: "test-model" },
      });
    });
  });

  describe("addGadgets", () => {
    it("adds gadget instructions as system message", () => {
      const builder = new LLMMessageBuilder();
      const gadgets = [new TestGadget(), new MathGadget()];

      builder.addGadgets(gadgets);

      const messages = builder.build();

      expect(messages).toHaveLength(1);
      expect(messages[0]?.role).toBe("system");
      expect(messages[0]?.content).toContain("RESPOND ONLY WITH GADGET INVOCATIONS");
      expect(messages[0]?.content).toContain("DO NOT use function calling or tool calling");
      expect(messages[0]?.content).toContain("AVAILABLE GADGETS");
    });

    it("includes gadget names in the prompt", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgets([new TestGadget()]);

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      expect(content).toContain("GADGET: TestGadget");
      expect(content).toContain("A test gadget");
    });

    it("includes block format examples", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgets([new TestGadget()]);

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      expect(content).toContain(GADGET_ARG_PREFIX);
      expect(content).toContain("BLOCK FORMAT SYNTAX");
    });

    it("handles empty gadgets array", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgets([]);

      const messages = builder.build();

      expect(messages).toHaveLength(1);
      expect(messages[0]?.content).toContain("AVAILABLE GADGETS");
    });

    it("includes multiple gadgets", () => {
      const builder = new LLMMessageBuilder();
      const gadgets = [new TestGadget(), new MathGadget()];

      builder.addGadgets(gadgets);

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      expect(content).toContain("GADGET: TestGadget");
      expect(content).toContain("GADGET: MathGadget");
      expect(content).toContain("A test gadget");
      expect(content).toContain("Performs math operations");
    });

    it("includes .describe() field descriptions in prompt", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgets([new MathGadget()]);

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      // Verify that .describe() content from MathGadget schema appears in the prompt
      expect(content).toContain("add or multiply");
      expect(content).toContain("First number");
      expect(content).toContain("Second number");
    });
  });

  describe("addGadgetCall", () => {
    it("adds gadget call as assistant message and result as user message", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgetCall("TestGadget", { message: "hello" }, "Echo: hello");

      const messages = builder.build();

      expect(messages).toHaveLength(2);
      expect(messages[0]?.role).toBe("assistant");
      expect(messages[1]?.role).toBe("user");
    });

    it("formats gadget call with block format parameters", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgetCall("MathGadget", { operation: "add", a: 5, b: 3 }, "8");

      const messages = builder.build();

      expect(messages).toHaveLength(2);
      const callMessage = messages[0]?.content ?? "";
      const resultMessage = messages[1]?.content ?? "";

      // Check for gadget markers
      expect(callMessage).toContain(`${GADGET_START_PREFIX}MathGadget`);
      expect(callMessage).toContain(GADGET_END_PREFIX);
      expect(callMessage).toContain(`${GADGET_ARG_PREFIX}operation`);
      expect(callMessage).toContain("add");
      expect(callMessage).toContain(`${GADGET_ARG_PREFIX}a`);
      expect(callMessage).toContain("5");

      expect(resultMessage).toBe("Result: 8");
    });

    it("handles complex parameter objects", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgetCall(
        "ComplexGadget",
        {
          nested: { value: 42 },
          items: ["a", "b"],
        },
        "result",
      );

      const messages = builder.build();
      const callMessage = messages[0]?.content ?? "";

      // Check nested paths and array indices
      expect(callMessage).toContain(`${GADGET_ARG_PREFIX}nested/value`);
      expect(callMessage).toContain("42");
      expect(callMessage).toContain(`${GADGET_ARG_PREFIX}items/0`);
      expect(callMessage).toContain("a");
    });

    it("handles empty parameters", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgetCall("EmptyGadget", {}, "done");

      const messages = builder.build();
      const callMessage = messages[0]?.content ?? "";

      expect(callMessage).toContain(`${GADGET_START_PREFIX}EmptyGadget`);
      expect(callMessage).toContain(GADGET_END_PREFIX);
    });
  });

  describe("build", () => {
    it("returns immutable copy of messages", () => {
      const builder = new LLMMessageBuilder();
      builder.addUser("Test");

      const messages1 = builder.build();
      const messages2 = builder.build();

      expect(messages1).not.toBe(messages2);
      expect(messages1).toEqual(messages2);
    });

    it("preserves message order", () => {
      const builder = new LLMMessageBuilder();
      builder.addSystem("System");
      builder.addUser("User");
      builder.addAssistant("Assistant");

      const messages = builder.build();

      expect(messages[0]?.role).toBe("system");
      expect(messages[1]?.role).toBe("user");
      expect(messages[2]?.role).toBe("assistant");
    });
  });

  describe("custom prompt configuration", () => {
    it("allows custom main instruction", () => {
      const customConfig: PromptConfig = {
        mainInstruction: "CUSTOM INSTRUCTION: Use gadgets only",
      };

      const builder = new LLMMessageBuilder(customConfig);
      builder.addGadgets([new TestGadget()]);

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      expect(content).toContain("CUSTOM INSTRUCTION: Use gadgets only");
    });

    it("allows custom rules", () => {
      const customConfig: PromptConfig = {
        rules: ["Custom rule 1", "Custom rule 2"],
      };

      const builder = new LLMMessageBuilder(customConfig);
      builder.addGadgets([new TestGadget()]);

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      expect(content).toContain("Custom rule 1");
      expect(content).toContain("Custom rule 2");
    });

    it("uses custom prefixes with dynamic prompts", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgets([new TestGadget()], {
        startPrefix: "<<BEGIN>>",
        endPrefix: "<<END>>",
      });

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      expect(content).toContain("<<BEGIN>>");
      expect(content).toContain("<<END>>");
    });
  });

  describe("withPrefixes", () => {
    it("configures custom prefixes for history building", () => {
      const builder = new LLMMessageBuilder();
      builder.withPrefixes("<<<START:", "<<<END:");
      builder.addGadgetCall("TestGadget", { message: "hello" }, "done");

      const messages = builder.build();
      const callMessage = messages[0]?.content ?? "";

      expect(callMessage).toContain("<<<START:TestGadget");
      expect(callMessage).toContain("<<<END:");
    });
  });
});

describe("isLLMMessage", () => {
  it("returns true for valid LLM messages", () => {
    expect(isLLMMessage({ role: "system", content: "test" })).toBe(true);
    expect(isLLMMessage({ role: "user", content: "test" })).toBe(true);
    expect(isLLMMessage({ role: "assistant", content: "test" })).toBe(true);
  });

  it("returns false for invalid messages", () => {
    expect(isLLMMessage(null)).toBe(false);
    expect(isLLMMessage(undefined)).toBe(false);
    expect(isLLMMessage({})).toBe(false);
    expect(isLLMMessage({ role: "invalid", content: "test" })).toBe(false);
    expect(isLLMMessage({ role: "system" })).toBe(false);
    expect(isLLMMessage({ content: "test" })).toBe(false);
  });
});

describe("custom argPrefix propagation", () => {
  it("propagates custom argPrefix to gadget examples", () => {
    const builder = new LLMMessageBuilder();
    builder.addGadgets([new ExampleGadget()], {
      argPrefix: "@param:",
    });

    const messages = builder.build();
    const content = messages[0]?.content ?? "";

    // Gadget examples should use custom prefix
    expect(content).toContain("@param:query");
    // Should not contain default prefix in gadget examples
    // Note: generic examples also use this.argPrefix, so all should use @param:
    expect(content).not.toContain("!!!ARG:query");
  });

  it("propagates custom argPrefix to format description", () => {
    const builder = new LLMMessageBuilder();
    builder.addGadgets([new TestGadget()], {
      argPrefix: "<<<GADGET_ARG>>>:",
    });

    const messages = builder.build();
    const content = messages[0]?.content ?? "";

    // Format description should use custom prefix
    expect(content).toContain("Parameters using <<<GADGET_ARG>>>:name markers");
    expect(content).not.toContain("Parameters using !!!ARG:name markers");
  });

  it("propagates custom argPrefix to generic examples", () => {
    const builder = new LLMMessageBuilder();
    builder.addGadgets([new TestGadget()], {
      argPrefix: "$ARG$",
    });

    const messages = builder.build();
    const content = messages[0]?.content ?? "";

    // Generic examples should use custom prefix
    expect(content).toContain("$ARG$from");
    expect(content).toContain("$ARG$to");
    expect(content).toContain("$ARG$content");
  });

  it("propagates custom argPrefix to addGadgetCall via withPrefixes", () => {
    const builder = new LLMMessageBuilder();
    builder.withPrefixes("<<<START:", "<<<END:", "@param:");
    builder.addGadgetCall("TestGadget", { message: "hello" }, "done");

    const messages = builder.build();
    const callMessage = messages[0]?.content ?? "";

    expect(callMessage).toContain("<<<START:TestGadget");
    expect(callMessage).toContain("@param:message");
    expect(callMessage).toContain("<<<END:");
    expect(callMessage).not.toContain("!!!ARG:");
  });

  it("uses consistent argPrefix across all sections when custom prefix is set", () => {
    const customPrefix = "[[ARG]]:";
    const builder = new LLMMessageBuilder();
    builder.addGadgets([new ExampleGadget()], {
      argPrefix: customPrefix,
    });

    const messages = builder.build();
    const content = messages[0]?.content ?? "";

    // Count occurrences of custom prefix vs default prefix
    const customMatches = content.match(/\[\[ARG\]\]:/g) ?? [];
    const defaultMatches = content.match(/!!!ARG:/g) ?? [];

    // All ARG markers should use custom prefix
    expect(customMatches.length).toBeGreaterThan(0);
    expect(defaultMatches.length).toBe(0);
  });
});
