import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MathGadget, TestGadget } from "../../../testing/src/helpers.js";
import { Gadget } from "../gadgets/typed-gadget.js";
import { GADGET_ARG_PREFIX, GADGET_END_PREFIX, GADGET_START_PREFIX } from "./constants.js";
import { audioFromBase64, imageFromBase64, imageFromUrl, text } from "./input-content.js";
import {
  extractMessageText,
  isLLMMessage,
  LLMMessageBuilder,
  normalizeMessageContent,
} from "./messages.js";
import type { PromptTemplateConfig } from "./prompt-config.js";

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

  describe("addGadgetCallResult", () => {
    it("adds gadget call as assistant message and result as user message", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgetCallResult("TestGadget", { message: "hello" }, "Echo: hello");

      const messages = builder.build();

      expect(messages).toHaveLength(2);
      expect(messages[0]?.role).toBe("assistant");
      expect(messages[1]?.role).toBe("user");
    });

    it("formats gadget call with block format parameters", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgetCallResult("MathGadget", { operation: "add", a: 5, b: 3 }, "8", "gc_1");

      const messages = builder.build();

      expect(messages).toHaveLength(2);
      const callMessage = messages[0]?.content ?? "";
      const resultMessage = messages[1]?.content ?? "";

      // Check for gadget markers with invocation ID
      expect(callMessage).toContain(`${GADGET_START_PREFIX}MathGadget:gc_1`);
      expect(callMessage).toContain(GADGET_END_PREFIX);
      expect(callMessage).toContain(`${GADGET_ARG_PREFIX}operation`);
      expect(callMessage).toContain("add");
      expect(callMessage).toContain(`${GADGET_ARG_PREFIX}a`);
      expect(callMessage).toContain("5");

      // Result includes invocation ID for LLM reference
      expect(resultMessage).toBe("Result (gc_1): 8");
    });

    it("handles complex parameter objects", () => {
      const builder = new LLMMessageBuilder();
      builder.addGadgetCallResult(
        "ComplexGadget",
        {
          nested: { value: 42 },
          items: ["a", "b"],
        },
        "result",
        "gc_2",
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
      builder.addGadgetCallResult("EmptyGadget", {}, "done", "gc_3");

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
      const customConfig: PromptTemplateConfig = {
        mainInstruction: "CUSTOM INSTRUCTION: Use gadgets only",
      };

      const builder = new LLMMessageBuilder(customConfig);
      builder.addGadgets([new TestGadget()]);

      const messages = builder.build();
      const content = messages[0]?.content ?? "";

      expect(content).toContain("CUSTOM INSTRUCTION: Use gadgets only");
    });

    it("allows custom rules", () => {
      const customConfig: PromptTemplateConfig = {
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
      builder.addGadgetCallResult("TestGadget", { message: "hello" }, "done");

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

  it("propagates custom argPrefix to addGadgetCallResult via withPrefixes", () => {
    const builder = new LLMMessageBuilder();
    builder.withPrefixes("<<<START:", "<<<END:", "@param:");
    builder.addGadgetCallResult("TestGadget", { message: "hello" }, "done");

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

  it("passes all three custom prefixes to gadget.getInstruction() for gadget examples", () => {
    // This test verifies the fix for: custom gadget-start-prefix and gadget-end-prefix
    // not being applied to gadget-specific examples in the AVAILABLE GADGETS section
    const builder = new LLMMessageBuilder();
    builder.addGadgets([new ExampleGadget()], {
      startPrefix: "<<GADGET>>:",
      endPrefix: "<</GADGET>>",
      argPrefix: "@@ARG:",
    });

    const messages = builder.build();
    const content = messages[0]?.content ?? "";

    // Gadget-specific examples should use ALL custom prefixes
    // The ExampleGadget has an example with params: { query: "test search" }
    expect(content).toContain("<<GADGET>>:ExampleGadget");
    expect(content).toContain("@@ARG:query");
    expect(content).toContain("<</GADGET>>");

    // Should NOT contain any default prefixes
    expect(content).not.toContain("!!!GADGET_START:");
    expect(content).not.toContain("!!!GADGET_END");
    expect(content).not.toContain("!!!ARG:");
  });
});

describe("Multimodal Content Support", () => {
  describe("addUser with multimodal content", () => {
    it("accepts ContentPart array", () => {
      const builder = new LLMMessageBuilder();
      builder.addUser([text("What's in this image?"), imageFromBase64("SGVsbG8=", "image/jpeg")]);

      const messages = builder.build();

      expect(messages).toHaveLength(1);
      expect(messages[0]?.role).toBe("user");
      expect(Array.isArray(messages[0]?.content)).toBe(true);

      const content = messages[0]?.content as unknown[];
      expect(content).toHaveLength(2);
      expect(content[0]).toEqual({ type: "text", text: "What's in this image?" });
      expect(content[1]).toMatchObject({
        type: "image",
        source: { type: "base64", mediaType: "image/jpeg" },
      });
    });
  });

  describe("addUserWithImage", () => {
    it("creates a message with text and base64 image from Buffer", () => {
      const builder = new LLMMessageBuilder();
      // JPEG magic bytes
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      builder.addUserWithImage("Describe this", jpegBuffer);

      const messages = builder.build();

      expect(messages).toHaveLength(1);
      expect(messages[0]?.role).toBe("user");
      expect(Array.isArray(messages[0]?.content)).toBe(true);

      const content = messages[0]?.content as unknown[];
      expect(content).toHaveLength(2);
      expect(content[0]).toEqual({ type: "text", text: "Describe this" });
      expect(content[1]).toMatchObject({
        type: "image",
        source: { type: "base64", mediaType: "image/jpeg" },
      });
    });

    it("uses explicit mediaType when provided", () => {
      const builder = new LLMMessageBuilder();
      const buffer = Buffer.from([0x00, 0x00, 0x00]);
      builder.addUserWithImage("Test", buffer, "image/png");

      const messages = builder.build();
      const content = messages[0]?.content as unknown[];
      expect(content[1]).toMatchObject({
        type: "image",
        source: { type: "base64", mediaType: "image/png" },
      });
    });
  });

  describe("addUserWithImageUrl", () => {
    it("creates a message with text and image URL", () => {
      const builder = new LLMMessageBuilder();
      builder.addUserWithImageUrl("What's in this?", "https://example.com/image.jpg");

      const messages = builder.build();

      expect(messages).toHaveLength(1);
      expect(messages[0]?.role).toBe("user");
      expect(Array.isArray(messages[0]?.content)).toBe(true);

      const content = messages[0]?.content as unknown[];
      expect(content).toHaveLength(2);
      expect(content[0]).toEqual({ type: "text", text: "What's in this?" });
      expect(content[1]).toEqual({
        type: "image",
        source: { type: "url", url: "https://example.com/image.jpg" },
      });
    });
  });

  describe("addUserWithAudio", () => {
    it("creates a message with text and base64 audio from Buffer", () => {
      const builder = new LLMMessageBuilder();
      // MP3 magic bytes (ID3 tag)
      const mp3Buffer = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00]);
      builder.addUserWithAudio("Transcribe this", mp3Buffer);

      const messages = builder.build();

      expect(messages).toHaveLength(1);
      expect(messages[0]?.role).toBe("user");
      expect(Array.isArray(messages[0]?.content)).toBe(true);

      const content = messages[0]?.content as unknown[];
      expect(content).toHaveLength(2);
      expect(content[0]).toEqual({ type: "text", text: "Transcribe this" });
      expect(content[1]).toMatchObject({
        type: "audio",
        source: { type: "base64", mediaType: "audio/mp3" },
      });
    });

    it("uses explicit mediaType when provided", () => {
      const builder = new LLMMessageBuilder();
      const buffer = Buffer.from([0x00, 0x00, 0x00]);
      builder.addUserWithAudio("Test", buffer, "audio/wav");

      const messages = builder.build();
      const content = messages[0]?.content as unknown[];
      expect(content[1]).toMatchObject({
        type: "audio",
        source: { type: "base64", mediaType: "audio/wav" },
      });
    });
  });

  describe("addUserMultimodal", () => {
    it("creates a message with multiple content parts", () => {
      const builder = new LLMMessageBuilder();
      builder.addUserMultimodal([
        text("Part 1"),
        text("Part 2"),
        imageFromUrl("https://example.com/img.png"),
      ]);

      const messages = builder.build();

      expect(messages).toHaveLength(1);
      const content = messages[0]?.content as unknown[];
      expect(content).toHaveLength(3);
    });

    it("handles single content part", () => {
      const builder = new LLMMessageBuilder();
      builder.addUserMultimodal([text("Just text")]);

      const messages = builder.build();
      const content = messages[0]?.content as unknown[];
      expect(content).toHaveLength(1);
      expect(content[0]).toEqual({ type: "text", text: "Just text" });
    });
  });
});

describe("extractText", () => {
  it("returns string content as-is", () => {
    expect(extractMessageText("Hello, world!")).toBe("Hello, world!");
  });

  it("extracts text from ContentPart array", () => {
    const content = [text("First "), imageFromBase64("abc", "image/png"), text("Second")];
    expect(extractMessageText(content)).toBe("First Second");
  });

  it("handles array with no text parts", () => {
    const content = [imageFromBase64("abc", "image/png"), audioFromBase64("xyz", "audio/mp3")];
    expect(extractMessageText(content)).toBe("");
  });

  it("handles empty array", () => {
    expect(extractMessageText([])).toBe("");
  });

  it("handles empty string", () => {
    expect(extractMessageText("")).toBe("");
  });
});

describe("normalizeContent", () => {
  it("wraps string in text part array", () => {
    const result = normalizeMessageContent("Hello");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "text", text: "Hello" });
  });

  it("passes through ContentPart array unchanged", () => {
    const parts = [text("Hello"), imageFromUrl("https://example.com/img.jpg")];
    const result = normalizeMessageContent(parts);
    expect(result).toBe(parts);
  });

  it("handles empty string", () => {
    const result = normalizeMessageContent("");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "text", text: "" });
  });

  it("handles empty array", () => {
    const result = normalizeMessageContent([]);
    expect(result).toHaveLength(0);
  });
});

describe("isLLMMessage with multimodal content", () => {
  it("returns true for messages with array content", () => {
    expect(
      isLLMMessage({
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      }),
    ).toBe(true);
  });

  it("returns true for messages with string content", () => {
    expect(
      isLLMMessage({
        role: "user",
        content: "Hello",
      }),
    ).toBe(true);
  });

  it("returns false for invalid content types", () => {
    expect(
      isLLMMessage({
        role: "user",
        content: 123,
      }),
    ).toBe(false);
    expect(
      isLLMMessage({
        role: "user",
        content: { invalid: true },
      }),
    ).toBe(false);
  });
});
