import { describe, expect, it } from "vitest";
import { GADGET_ARG_PREFIX, GADGET_END_PREFIX, GADGET_START_PREFIX } from "../core/constants.js";
import {
  buildMultimodalContent,
  extractMessagesFromAgent,
  formatBlockParameters,
  formatGadgetCall,
  normalizeHistory,
} from "./builder-utils.js";

describe("builder-utils", () => {
  describe("formatGadgetCall()", () => {
    it("produces correct block format with start/end/arg default prefixes", () => {
      const result = formatGadgetCall("Calculator", "inv-001", { a: 5, b: 3 });
      expect(result).toContain(`${GADGET_START_PREFIX}Calculator:inv-001`);
      expect(result).toContain(GADGET_END_PREFIX);
      expect(result).toContain(`${GADGET_ARG_PREFIX}a`);
      expect(result).toContain("5");
      expect(result).toContain(`${GADGET_ARG_PREFIX}b`);
      expect(result).toContain("3");
    });

    it("uses custom start/end/arg prefixes when provided", () => {
      const result = formatGadgetCall(
        "Search",
        "inv-002",
        { query: "hello" },
        {
          start: "##START:",
          end: "##END",
          arg: "##ARG:",
        },
      );
      expect(result).toContain("##START:Search:inv-002");
      expect(result).toContain("##END");
      expect(result).toContain("##ARG:query");
      expect(result).toContain("hello");
    });

    it("formats output as start line, params, end line", () => {
      const result = formatGadgetCall("MyGadget", "id-1", { x: "val" });
      const lines = result.split("\n");
      expect(lines[0]).toBe(`${GADGET_START_PREFIX}MyGadget:id-1`);
      expect(lines.at(-1)).toBe(GADGET_END_PREFIX);
    });
  });

  describe("formatBlockParameters()", () => {
    it("handles flat key-value params", () => {
      const result = formatBlockParameters({ name: "Alice", age: 30 }, "", GADGET_ARG_PREFIX);
      expect(result).toContain(`${GADGET_ARG_PREFIX}name`);
      expect(result).toContain("Alice");
      expect(result).toContain(`${GADGET_ARG_PREFIX}age`);
      expect(result).toContain("30");
    });

    it("handles nested objects recursively using JSON Pointer paths", () => {
      const result = formatBlockParameters(
        { user: { name: "Bob", role: "admin" } },
        "",
        GADGET_ARG_PREFIX,
      );
      expect(result).toContain(`${GADGET_ARG_PREFIX}user/name`);
      expect(result).toContain("Bob");
      expect(result).toContain(`${GADGET_ARG_PREFIX}user/role`);
      expect(result).toContain("admin");
    });

    it("handles arrays with primitive items using indexed paths", () => {
      const result = formatBlockParameters(
        { tags: ["alpha", "beta", "gamma"] },
        "",
        GADGET_ARG_PREFIX,
      );
      expect(result).toContain(`${GADGET_ARG_PREFIX}tags/0`);
      expect(result).toContain("alpha");
      expect(result).toContain(`${GADGET_ARG_PREFIX}tags/1`);
      expect(result).toContain("beta");
      expect(result).toContain(`${GADGET_ARG_PREFIX}tags/2`);
      expect(result).toContain("gamma");
    });

    it("handles arrays with object items recursively", () => {
      const result = formatBlockParameters(
        { items: [{ name: "x" }, { name: "y" }] },
        "",
        GADGET_ARG_PREFIX,
      );
      expect(result).toContain(`${GADGET_ARG_PREFIX}items/0/name`);
      expect(result).toContain("x");
      expect(result).toContain(`${GADGET_ARG_PREFIX}items/1/name`);
      expect(result).toContain("y");
    });

    it("uses GADGET_ARG_PREFIX as default when arg prefix is not provided", () => {
      const result = formatBlockParameters({ key: "value" }, "");
      expect(result).toContain(`${GADGET_ARG_PREFIX}key`);
      expect(result).toContain("value");
    });

    it("incorporates the prefix in nested paths", () => {
      const result = formatBlockParameters({ count: 42 }, "root", GADGET_ARG_PREFIX);
      expect(result).toContain(`${GADGET_ARG_PREFIX}root/count`);
      expect(result).toContain("42");
    });
  });

  describe("normalizeHistory()", () => {
    it("converts { user: ... } to { role: 'user', content: ... }", () => {
      const result = normalizeHistory([{ user: "Hello" }]);
      expect(result).toEqual([{ role: "user", content: "Hello" }]);
    });

    it("converts { assistant: ... } to { role: 'assistant', content: ... }", () => {
      const result = normalizeHistory([{ assistant: "Hi there" }]);
      expect(result).toEqual([{ role: "assistant", content: "Hi there" }]);
    });

    it("converts { system: ... } to { role: 'system', content: ... }", () => {
      const result = normalizeHistory([{ system: "You are a helpful assistant." }]);
      expect(result).toEqual([{ role: "system", content: "You are a helpful assistant." }]);
    });

    it("converts multiple messages of mixed roles in order", () => {
      const result = normalizeHistory([
        { system: "System prompt" },
        { user: "User message" },
        { assistant: "Assistant reply" },
      ]);
      expect(result).toEqual([
        { role: "system", content: "System prompt" },
        { role: "user", content: "User message" },
        { role: "assistant", content: "Assistant reply" },
      ]);
    });

    it("throws an error on invalid message format", () => {
      expect(() =>
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
        normalizeHistory([{ invalid: "data" } as any]),
      ).toThrow("Invalid history message format");
    });
  });

  describe("buildMultimodalContent()", () => {
    // JPEG magic bytes (FF D8 FF)
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    // PNG magic bytes (89 50 4E 47)
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    it("returns [text, image] content parts with Buffer input and auto-detected MIME type", () => {
      const result = buildMultimodalContent("Describe this image", jpegBuffer);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ type: "text", text: "Describe this image" });
      expect(result[1]).toMatchObject({
        type: "image",
        source: {
          type: "base64",
          mediaType: "image/jpeg",
        },
      });
    });

    it("converts base64 string input to Buffer and detects MIME type", () => {
      const base64Data = jpegBuffer.toString("base64");
      const result = buildMultimodalContent("What is this?", base64Data);
      expect(result).toHaveLength(2);
      expect(result[1]).toMatchObject({
        type: "image",
        source: {
          mediaType: "image/jpeg",
        },
      });
    });

    it("uses the explicitly provided mimeType instead of auto-detection", () => {
      const result = buildMultimodalContent("Analyze this PNG", pngBuffer, "image/png");
      expect(result[1]).toMatchObject({
        type: "image",
        source: {
          mediaType: "image/png",
        },
      });
    });

    it("throws when MIME type cannot be detected and no mimeType is provided", () => {
      const unknownBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]);
      expect(() => buildMultimodalContent("text prompt", unknownBuffer)).toThrow(
        "Could not detect image MIME type",
      );
    });
  });

  describe("extractMessagesFromAgent()", () => {
    it("filters out system messages and keeps user and assistant messages", () => {
      const mockAgent = {
        getConversation: () => ({
          getConversationHistory: () => [
            { role: "system" as const, content: "System prompt" },
            { role: "user" as const, content: "Hello" },
            { role: "assistant" as const, content: "Hi there!" },
          ],
        }),
      };

      const result = extractMessagesFromAgent(mockAgent);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ role: "user", content: "Hello" });
      expect(result[1]).toEqual({ role: "assistant", content: "Hi there!" });
    });

    it("returns empty array when only system messages are present", () => {
      const mockAgent = {
        getConversation: () => ({
          getConversationHistory: () => [{ role: "system" as const, content: "You are helpful" }],
        }),
      };

      const result = extractMessagesFromAgent(mockAgent);
      expect(result).toHaveLength(0);
    });

    it("returns empty array when conversation history is empty", () => {
      const mockAgent = {
        getConversation: () => ({
          getConversationHistory: () => [],
        }),
      };

      const result = extractMessagesFromAgent(mockAgent);
      expect(result).toEqual([]);
    });

    it("preserves message order from conversation history", () => {
      const mockAgent = {
        getConversation: () => ({
          getConversationHistory: () => [
            { role: "user" as const, content: "First" },
            { role: "assistant" as const, content: "Reply" },
            { role: "user" as const, content: "Second" },
            { role: "assistant" as const, content: "Reply 2" },
          ],
        }),
      };

      const result = extractMessagesFromAgent(mockAgent);
      expect(result).toHaveLength(4);
      expect(result[0].content).toBe("First");
      expect(result[1].content).toBe("Reply");
      expect(result[2].content).toBe("Second");
      expect(result[3].content).toBe("Reply 2");
    });
  });
});
