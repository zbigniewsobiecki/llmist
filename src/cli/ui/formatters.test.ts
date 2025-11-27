import { describe, expect, it } from "bun:test";
import { renderMarkdown } from "./formatters.js";

describe("renderMarkdown", () => {
  describe("basic text transformation", () => {
    it("renders plain text with reset codes", () => {
      const result = renderMarkdown("Hello, world!");
      // marked-terminal wraps output with ANSI reset codes
      expect(result).toContain("Hello, world!");
      // Verify it has ANSI codes (reset codes at minimum)
      // Using includes instead of regex to avoid biome's noControlCharactersInRegex
      expect(result.includes("\x1b[")).toBe(true);
    });

    it("removes trailing newlines", () => {
      // marked adds trailing newlines, we should trim them
      const result = renderMarkdown("Hello");
      expect(result.endsWith("\n")).toBe(false);
    });
  });

  describe("list formatting", () => {
    it("converts dash lists to bullet points", () => {
      const input = `Items:
- First item
- Second item`;
      const result = renderMarkdown(input);
      expect(result).toContain("*");
      expect(result).toContain("First item");
      expect(result).toContain("Second item");
    });

    it("handles numbered lists", () => {
      const input = `Steps:
1. Step one
2. Step two`;
      const result = renderMarkdown(input);
      expect(result).toContain("Step one");
      expect(result).toContain("Step two");
    });
  });

  describe("inline formatting", () => {
    it("renders bold text", () => {
      const input = "This is **bold** text";
      const result = renderMarkdown(input);
      // marked-terminal may or may not add ANSI codes depending on environment
      // At minimum, the text should be present
      expect(result).toContain("bold");
      expect(result).toContain("text");
    });

    it("renders italic text", () => {
      const input = "This is *italic* text";
      const result = renderMarkdown(input);
      expect(result).toContain("italic");
    });

    it("renders inline code", () => {
      const input = "Run `npm install` command";
      const result = renderMarkdown(input);
      expect(result).toContain("npm install");
    });
  });

  describe("lazy initialization", () => {
    it("produces consistent results across multiple calls", () => {
      const input = "**bold** and *italic*";
      const result1 = renderMarkdown(input);
      const result2 = renderMarkdown(input);
      expect(result1).toBe(result2);
    });
  });

  describe("complex markdown", () => {
    it("handles mixed content", () => {
      const input = `# Title

This is a **paragraph** with *formatting*.

- Item one
- Item two

\`\`\`
code block
\`\`\``;
      const result = renderMarkdown(input);
      expect(result).toContain("Title");
      expect(result).toContain("paragraph");
      expect(result).toContain("Item one");
      expect(result).toContain("code block");
    });
  });
});
