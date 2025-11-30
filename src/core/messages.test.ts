import { describe, expect, it } from "bun:test";
import { MathGadget, TestGadget } from "../testing/helpers.js";
import { GADGET_END_PREFIX, GADGET_START_PREFIX } from "./constants.js";
import { isLLMMessage, LLMMessageBuilder } from "./messages.js";
import type { PromptConfig } from "./prompt-config.js";

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
      expect(messages[0]?.content).toContain("HOW TO INVOKE GADGETS");
    });

    it("includes gadget names and instructions", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgets([new TestGadget()]);

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      expect(content).toContain("GADGET: TestGadget");
      expect(content).toContain("A test gadget that echoes parameters");
    });

    it("uses constants for gadget markers", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgets([new TestGadget()]);

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      expect(content).toContain(GADGET_START_PREFIX);
      expect(content).toContain(GADGET_END_PREFIX);
    });

    it("includes invocation examples", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgets([new TestGadget()]);

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      expect(content).toContain("EXAMPLE (Single Gadget):");
      expect(content).toContain("EXAMPLE (Multiple Gadgets):");
      expect(content).toContain("!!!GADGET_START:translate");
      expect(content).toContain('"from": "English"');
      expect(content).toContain('"to": "Polish"');
    });

    it("handles empty gadget array", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgets([]);

      const messages = builder.build();

      expect(messages).toHaveLength(1);
      expect(messages[0]?.role).toBe("system");
      expect(messages[0]?.content).toContain("RESPOND ONLY WITH GADGET INVOCATIONS");
      expect(messages[0]?.content).toContain("DO NOT use function calling or tool calling");
      expect(messages[0]?.content).toContain("AVAILABLE GADGETS");
      expect(messages[0]?.content).toContain("HOW TO INVOKE GADGETS");
    });

    it("formats multiple gadgets correctly", () => {
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

    it("uses JSON format for schemas when parameterFormat is json", () => {
      const builder = new LLMMessageBuilder();
      const gadgets = [new MathGadget()];

      builder.addGadgets(gadgets, "json");

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      // Should contain JSON format examples
      expect(content).toContain("Parameters in JSON format");
      expect(content).toContain('"from": "English"');
      expect(content).toContain('"to": "Polish"');

      // Should NOT contain YAML format
      expect(content).not.toContain("Parameters in YAML format");
      expect(content).not.toContain("from: English");
    });

    it("uses YAML format for schemas when parameterFormat is yaml", () => {
      const builder = new LLMMessageBuilder();
      const gadgets = [new MathGadget()];

      builder.addGadgets(gadgets, "yaml");

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      // Should contain YAML format examples
      expect(content).toContain("Parameters in YAML format");
      expect(content).toContain("from: English");
      expect(content).toContain("to: Polish");

      // Should NOT contain JSON format
      expect(content).not.toContain("Parameters in JSON format");
      expect(content).not.toContain('"from": "English"');
    });

    it("uses JSON format for schemas when parameterFormat is auto", () => {
      const builder = new LLMMessageBuilder();
      const gadgets = [new MathGadget()];

      builder.addGadgets(gadgets, "auto");

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      // Should contain JSON format (auto defaults to JSON)
      expect(content).toContain("Parameters in JSON format");
      expect(content).toContain('"from": "English"');
    });

    it("includes schema for all gadgets when using JSON format", () => {
      const builder = new LLMMessageBuilder();
      const gadgets = [new TestGadget(), new MathGadget()];

      builder.addGadgets(gadgets, "json");

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      // Both gadgets should be present
      expect(content).toContain("GADGET: TestGadget");
      expect(content).toContain("GADGET: MathGadget");

      // Both should have their schemas rendered
      // (getInstruction is called for each gadget with 'json' format)
      expect(content).toContain("A test gadget");
      expect(content).toContain("Performs math operations");
    });

    it("includes .describe() field descriptions in prompt", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgets([new MathGadget()], "json");

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      // Verify that .describe() content from MathGadget schema appears in the prompt
      // MathGadget has: operation.describe("add or multiply"), a.describe("First number"), b.describe("Second number")
      expect(content).toContain("add or multiply");
      expect(content).toContain("First number");
      expect(content).toContain("Second number");
    });

    it("includes .describe() field descriptions in plain text format prompt", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgets([new MathGadget()], "yaml");

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      // Verify descriptions appear in plain text format (used for all formats now)
      expect(content).toContain("- operation (string) [required]: add or multiply");
      expect(content).toContain("- a (number) [required]: First number");
      expect(content).toContain("- b (number) [required]: Second number");
    });
  });

  describe("addGadgetCall", () => {
    it("adds gadget call as assistant message and result as user message", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgetCall("TestGadget", { message: "hello" }, "Echo: hello", "json", "test-id");

      const messages = builder.build();

      expect(messages).toHaveLength(2);
      expect(messages[0]?.role).toBe("assistant");
      expect(messages[1]?.role).toBe("user");
    });

    it("formats gadget call with JSON parameters and result", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgetCall(
        "MathGadget",
        { operation: "add", a: 5, b: 3 },
        "8",
        "json",
        "math-123",
      );

      const messages = builder.build();

      expect(messages).toHaveLength(2);
      const callMessage = messages[0]?.content ?? "";
      const resultMessage = messages[1]?.content ?? "";

      // Check for gadget markers (simplified format without IDs)
      expect(callMessage).toContain("!!!GADGET_START:MathGadget");
      expect(callMessage).toContain("!!!GADGET_END");
      expect(callMessage).toContain('"operation":"add"');
      expect(callMessage).toContain('"a":5');
      expect(callMessage).toContain('"b":3');

      expect(resultMessage).toBe("Result: 8");
    });

    it("formats gadget call with YAML parameters", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgetCall(
        "MathGadget",
        { operation: "add", a: 5, b: 3 },
        "8",
        "yaml",
        "math-456",
      );

      const messages = builder.build();

      expect(messages).toHaveLength(2);
      const callMessage = messages[0]?.content ?? "";

      // Check for gadget markers (simplified format)
      expect(callMessage).toContain("!!!GADGET_START:MathGadget");
      expect(callMessage).toContain("!!!GADGET_END");
      expect(callMessage).toContain("operation: add");
      expect(callMessage).toContain("a: 5");
      expect(callMessage).toContain("b: 3");
    });

    it("handles complex parameter objects in JSON", () => {
      const builder = new LLMMessageBuilder();
      const params = {
        nested: { key: "value" },
        array: [1, 2, 3],
        string: "test",
      };

      builder.addGadgetCall("ComplexGadget", params, "success", "json", "complex-1");

      const messages = builder.build();

      expect(messages).toHaveLength(2);
      const callMessage = messages[0]?.content ?? "";
      const resultMessage = messages[1]?.content ?? "";

      expect(callMessage).toContain("!!!GADGET_START:ComplexGadget");
      expect(callMessage).toContain("!!!GADGET_END");
      expect(callMessage).toContain('"nested":{"key":"value"}');
      expect(callMessage).toContain('"array":[1,2,3]');
      expect(callMessage).toContain('"string":"test"');

      expect(resultMessage).toBe("Result: success");
    });

    it("handles empty parameters", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgetCall("EmptyGadget", {}, "result", "json", "empty-1");

      const messages = builder.build();

      expect(messages).toHaveLength(2);
      const callMessage = messages[0]?.content ?? "";

      expect(callMessage).toContain("!!!GADGET_START:EmptyGadget");
      expect(callMessage).toContain("!!!GADGET_END");
      expect(callMessage).toContain("{}");

      expect(messages[1]?.content).toBe("Result: result");
    });

    it("generates invocation ID when not provided", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgetCall("TestGadget", { message: "hello" }, "Echo: hello");

      const messages = builder.build();
      const callMessage = messages[0]?.content ?? "";

      // Should have markers with some ID
      expect(callMessage).toContain("!!!GADGET_START:TestGadget");
      expect(callMessage).toContain("!!!GADGET_END");
    });
  });

  describe("chaining", () => {
    it("supports method chaining", () => {
      const builder = new LLMMessageBuilder();

      builder
        .addSystem("System prompt")
        .addUser("User message")
        .addAssistant("Assistant response")
        .addGadgetCall("Test", { param: "value" }, "result");

      const messages = builder.build();

      expect(messages).toHaveLength(5); // system, user, assistant, gadget_call (assistant), gadget_result (user)
      expect(messages[0]?.role).toBe("system");
      expect(messages[1]?.role).toBe("user");
      expect(messages[2]?.role).toBe("assistant");
      expect(messages[3]?.role).toBe("assistant"); // gadget call
      expect(messages[4]?.role).toBe("user"); // gadget result
    });

    it("builds conversation in order", () => {
      const builder = new LLMMessageBuilder();

      builder.addUser("First").addAssistant("Second").addUser("Third");

      const messages = builder.build();

      expect(messages[0]?.content).toBe("First");
      expect(messages[1]?.content).toBe("Second");
      expect(messages[2]?.content).toBe("Third");
    });
  });

  describe("build", () => {
    it("returns a copy of messages array", () => {
      const builder = new LLMMessageBuilder();
      builder.addUser("Test");

      const messages1 = builder.build();
      const messages2 = builder.build();

      expect(messages1).not.toBe(messages2);
      expect(messages1).toEqual(messages2);
    });

    it("does not mutate returned array when builder is modified", () => {
      const builder = new LLMMessageBuilder();
      builder.addUser("First");

      const messages1 = builder.build();

      builder.addUser("Second");

      const messages2 = builder.build();

      expect(messages1).toHaveLength(1);
      expect(messages2).toHaveLength(2);
    });

    it("returns empty array when no messages added", () => {
      const builder = new LLMMessageBuilder();
      const messages = builder.build();

      expect(messages).toEqual([]);
    });
  });

  describe("complex conversations", () => {
    it("builds a complete conversation with gadgets", () => {
      const builder = new LLMMessageBuilder();

      builder
        .addSystem("You are a math assistant")
        .addGadgets([new MathGadget()])
        .addUser("What is 5 + 3?")
        .addGadgetCall("MathGadget", { operation: "add", a: 5, b: 3 }, "8")
        .addAssistant("The result is 8");

      const messages = builder.build();

      expect(messages).toHaveLength(6); // system, gadgets, user, gadget_call, gadget_result, assistant
      expect(messages[0]?.role).toBe("system");
      expect(messages[1]?.role).toBe("system"); // Gadgets message
      expect(messages[2]?.role).toBe("user");
      expect(messages[3]?.role).toBe("assistant"); // Gadget call
      expect(messages[4]?.role).toBe("user"); // Gadget result
      expect(messages[5]?.role).toBe("assistant");
    });
  });

  describe("custom prompt configuration", () => {
    it("uses default prompts when no config provided", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgets([new TestGadget()]);

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      // Should contain default main instruction
      expect(content).toContain("RESPOND ONLY WITH GADGET INVOCATIONS");
      expect(content).toContain("DO NOT use function calling or tool calling");

      // Should contain default rules
      expect(content).toContain("Output ONLY plain text with the exact markers");
      expect(content).toContain("You can invoke multiple gadgets in a single response");
    });

    it("uses custom main instruction when provided", () => {
      const customConfig: PromptConfig = {
        mainInstruction: "CUSTOM MAIN INSTRUCTION: Use gadgets below",
      };

      const builder = new LLMMessageBuilder(customConfig);
      builder.addGadgets([new TestGadget()]);

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      // Should contain custom instruction
      expect(content).toContain("CUSTOM MAIN INSTRUCTION: Use gadgets below");

      // Should NOT contain default instruction
      expect(content).not.toContain("RESPOND ONLY WITH GADGET INVOCATIONS");
    });

    it("uses custom rules when provided as array", () => {
      const customConfig: PromptConfig = {
        rules: ["Custom rule 1", "Custom rule 2", "Custom rule 3"],
      };

      const builder = new LLMMessageBuilder(customConfig);
      builder.addGadgets([new TestGadget()]);

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      // Should contain custom rules
      expect(content).toContain("- Custom rule 1");
      expect(content).toContain("- Custom rule 2");
      expect(content).toContain("- Custom rule 3");

      // Should NOT contain default rules
      expect(content).not.toContain("Output ONLY plain text with the exact markers");
    });

    it("uses custom rules when provided as function", () => {
      const customConfig: PromptConfig = {
        rules: (ctx) => [
          `You have ${ctx.gadgetCount} gadgets available`,
          "Always use text markers",
        ],
      };

      const builder = new LLMMessageBuilder(customConfig);
      builder.addGadgets([new TestGadget(), new MathGadget()]);

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      // Should contain dynamic rules
      expect(content).toContain("- You have 2 gadgets available");
      expect(content).toContain("- Always use text markers");
    });

    it("uses custom critical usage instruction", () => {
      const customConfig: PromptConfig = {
        criticalUsage: "IMPORTANT: Follow the exact format shown below!",
      };

      const builder = new LLMMessageBuilder(customConfig);
      builder.addGadgets([new TestGadget()]);

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      // Should contain custom critical usage
      expect(content).toContain("CRITICAL: IMPORTANT: Follow the exact format shown below!");

      // Should NOT contain default critical usage
      expect(content).not.toContain("You MUST use the exact format below to invoke gadgets");
    });

    it("uses custom format descriptions", () => {
      const customConfig: PromptConfig = {
        formatDescriptionJson: "Custom JSON format description",
        formatDescriptionYaml: "Custom YAML format description",
      };

      const jsonBuilder = new LLMMessageBuilder(customConfig);
      jsonBuilder.addGadgets([new TestGadget()], "json");

      const jsonMessages = jsonBuilder.build();
      const jsonContent = jsonMessages[0]?.content ?? "";

      expect(jsonContent).toContain("Custom JSON format description");
      expect(jsonContent).not.toContain("Parameters in JSON format (valid JSON object)");

      const yamlBuilder = new LLMMessageBuilder(customConfig);
      yamlBuilder.addGadgets([new TestGadget()], "yaml");

      const yamlMessages = yamlBuilder.build();
      const yamlContent = yamlMessages[0]?.content ?? "";

      expect(yamlContent).toContain("Custom YAML format description");
      expect(yamlContent).not.toContain("Parameters in YAML format (one per line)");
    });

    it("supports partial configuration with defaults for missing fields", () => {
      const customConfig: PromptConfig = {
        mainInstruction: "Custom main only",
        // Other fields should use defaults
      };

      const builder = new LLMMessageBuilder(customConfig);
      builder.addGadgets([new TestGadget()]);

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      // Should have custom main instruction
      expect(content).toContain("Custom main only");

      // Should have default rules
      expect(content).toContain("Output ONLY plain text with the exact markers");

      // Should have default critical usage
      expect(content).toContain("INVOKE gadgets using the markers");
    });

    it("provides correct context to dynamic templates", () => {
      let capturedContext: any;

      const customConfig: PromptConfig = {
        rules: (ctx) => {
          capturedContext = ctx;
          return ["test"];
        },
      };

      const builder = new LLMMessageBuilder(customConfig);
      builder.addGadgets([new TestGadget(), new MathGadget()], "yaml");

      builder.build();

      expect(capturedContext).toBeDefined();
      expect(capturedContext.parameterFormat).toBe("yaml");
      expect(capturedContext.startPrefix).toBe(GADGET_START_PREFIX);
      expect(capturedContext.endPrefix).toBe(GADGET_END_PREFIX);
      expect(capturedContext.gadgetCount).toBe(2);
      expect(capturedContext.gadgetNames).toEqual(["TestGadget", "MathGadget"]);
    });

    it("supports custom examples function", () => {
      const customConfig: PromptConfig = {
        customExamples: (ctx) => `

CUSTOM EXAMPLE:

${ctx.startPrefix}myGadget
param: value
${ctx.endPrefix}`,
      };

      const builder = new LLMMessageBuilder(customConfig);
      builder.addGadgets([new TestGadget()]);

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      // Should contain custom example
      expect(content).toContain("CUSTOM EXAMPLE:");
      expect(content).toContain("myGadget");
      expect(content).toContain("param: value");

      // Should NOT contain default examples
      expect(content).not.toContain("translate");
      expect(content).not.toContain("English");
      expect(content).not.toContain("Polish");
    });

    it("uses custom prefixes with dynamic prompts", () => {
      const customConfig: PromptConfig = {
        rules: (ctx) => [`Start prefix: ${ctx.startPrefix}`, `End prefix: ${ctx.endPrefix}`],
      };

      const builder = new LLMMessageBuilder(customConfig);
      builder.addGadgets([new TestGadget()], "json", {
        startPrefix: "<<<START:",
        endPrefix: ">>>END",
      });

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      // Custom prefixes should be in the rules
      expect(content).toContain("- Start prefix: <<<START:");
      expect(content).toContain("- End prefix: >>>END");

      // And in the format section
      expect(content).toContain("Start marker: <<<START:gadget_name");
      expect(content).toContain("End marker: >>>END");
    });

    it("allows completely custom prompt for specific use cases", () => {
      const minimalConfig: PromptConfig = {
        mainInstruction: "Use tools via text markers:",
        criticalUsage: "Follow the format exactly.",
        formatDescriptionJson: "JSON parameters",
        rules: ["Use markers", "No function calls"],
      };

      const builder = new LLMMessageBuilder(minimalConfig);
      builder.addGadgets([new TestGadget()]);

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      // Should be much shorter and simpler
      expect(content).toContain("Use tools via text markers:");
      expect(content).toContain("Follow the format exactly.");
      expect(content).toContain("JSON parameters");
      expect(content).toContain("- Use markers");
      expect(content).toContain("- No function calls");

      // Should NOT contain verbose defaults
      expect(content).not.toContain("RESPOND ONLY");
      expect(content).not.toContain("⚠️ CRITICAL");
      expect(content).not.toContain("Output ONLY plain text with the exact markers");
    });
  });
});

describe("isLLMMessage", () => {
  it("validates valid system message", () => {
    expect(isLLMMessage({ role: "system", content: "test" })).toBe(true);
  });

  it("validates valid user message", () => {
    expect(isLLMMessage({ role: "user", content: "test" })).toBe(true);
  });

  it("validates valid assistant message", () => {
    expect(isLLMMessage({ role: "assistant", content: "test" })).toBe(true);
  });

  it("rejects null", () => {
    expect(isLLMMessage(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isLLMMessage(undefined)).toBe(false);
  });

  it("rejects non-object", () => {
    expect(isLLMMessage("string")).toBe(false);
    expect(isLLMMessage(123)).toBe(false);
    expect(isLLMMessage(true)).toBe(false);
  });

  it("rejects invalid role", () => {
    expect(isLLMMessage({ role: "invalid", content: "test" })).toBe(false);
  });

  it("rejects missing content", () => {
    expect(isLLMMessage({ role: "user" })).toBe(false);
  });

  it("rejects non-string content", () => {
    expect(isLLMMessage({ role: "user", content: 123 })).toBe(false);
  });

  it("accepts message with metadata", () => {
    expect(
      isLLMMessage({
        role: "user",
        content: "test",
        metadata: { key: "value" },
      }),
    ).toBe(true);
  });

  it("accepts message with name", () => {
    expect(
      isLLMMessage({
        role: "assistant",
        content: "test",
        name: "bot",
      }),
    ).toBe(true);
  });
});
