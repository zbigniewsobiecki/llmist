import { describe, expect, it } from "bun:test";
import { formatGadgetSummary, formatTokens, renderMarkdown } from "./formatters.js";

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

describe("formatTokens", () => {
  it("returns number as-is for small values", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(100)).toBe("100");
    expect(formatTokens(999)).toBe("999");
  });

  it("formats thousands with 'k' suffix", () => {
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(11500)).toBe("11.5k");
  });

  it("handles edge cases", () => {
    expect(formatTokens(1234)).toBe("1.2k");
    expect(formatTokens(100000)).toBe("100.0k");
  });
});

describe("formatGadgetSummary", () => {
  describe("success case", () => {
    it("shows checkmark with gadget name and timing", () => {
      const result = formatGadgetSummary({
        gadgetName: "ReadFile",
        executionTimeMs: 123,
        result: "file content",
      });
      expect(result).toContain("✓");
      expect(result).toContain("ReadFile");
      expect(result).toContain("123ms");
    });

    it("shows token count when available", () => {
      const result = formatGadgetSummary({
        gadgetName: "ListDirectory",
        executionTimeMs: 4,
        result: "some output",
        tokenCount: 248,
      });
      expect(result).toContain("248 tokens");
    });

    it("shows 'k' suffix for large token counts", () => {
      const result = formatGadgetSummary({
        gadgetName: "Search",
        executionTimeMs: 100,
        result: "lots of output",
        tokenCount: 2500,
      });
      expect(result).toContain("2.5k tokens");
    });
  });

  describe("error case", () => {
    it("shows X with error message", () => {
      const result = formatGadgetSummary({
        gadgetName: "ReadFile",
        executionTimeMs: 2,
        error: "File not found",
      });
      expect(result).toContain("✗");
      expect(result).toContain("ReadFile");
      expect(result).toContain("error:");
      expect(result).toContain("File not found");
      expect(result).toContain("2ms");
    });

    it("truncates long error messages", () => {
      const longError = "This is a very long error message that should be truncated to 50 chars";
      const result = formatGadgetSummary({
        gadgetName: "Test",
        executionTimeMs: 1,
        error: longError,
      });
      expect(result).toContain("…");
      expect(result).not.toContain("truncated to 50 chars");
    });
  });

  describe("break-loop case", () => {
    it("shows stop icon for breaksLoop", () => {
      const result = formatGadgetSummary({
        gadgetName: "TellUser",
        executionTimeMs: 1,
        result: "Done!",
        breaksLoop: true,
      });
      expect(result).toContain("⏹");
    });
  });

  describe("parameters formatting", () => {
    it("shows parameters inline", () => {
      const result = formatGadgetSummary({
        gadgetName: "ReadFile",
        executionTimeMs: 5,
        parameters: { path: "/test.txt" },
        result: "content",
      });
      expect(result).toContain("path");
      expect(result).toContain("/test.txt");
    });

    it("shows multiple parameters", () => {
      const result = formatGadgetSummary({
        gadgetName: "ListDirectory",
        executionTimeMs: 4,
        parameters: { path: ".", recursive: true },
        result: "files",
      });
      expect(result).toContain("path");
      expect(result).toContain("recursive");
      expect(result).toContain("true");
    });

    it("truncates long string values", () => {
      const longPath = "/this/is/a/very/long/path/that/exceeds/thirty/characters.txt";
      const result = formatGadgetSummary({
        gadgetName: "ReadFile",
        executionTimeMs: 1,
        parameters: { path: longPath },
        result: "",
      });
      expect(result).toContain("…");
      expect(result).not.toContain("characters.txt");
    });

    it("shows empty parens when no parameters", () => {
      const result = formatGadgetSummary({
        gadgetName: "CoinFlip",
        executionTimeMs: 1,
        parameters: {},
        result: "heads",
      });
      // Should not have parameter content between parens
      expect(result).not.toContain("path");
    });
  });

  describe("output formatting (bytes fallback)", () => {
    it("shows bytes for small outputs without token count", () => {
      const result = formatGadgetSummary({
        gadgetName: "Echo",
        executionTimeMs: 1,
        result: "hello",
        // No tokenCount - should fall back to bytes
      });
      expect(result).toContain("5 bytes");
    });

    it("shows KB for larger outputs", () => {
      const largeResult = "x".repeat(2048);
      const result = formatGadgetSummary({
        gadgetName: "Echo",
        executionTimeMs: 1,
        result: largeResult,
      });
      expect(result).toContain("KB");
    });

    it("shows 'no output' for empty results", () => {
      const result = formatGadgetSummary({
        gadgetName: "Delete",
        executionTimeMs: 1,
        result: "",
      });
      expect(result).toContain("no output");
    });
  });

  describe("TellUser special handling", () => {
    it("renders markdown message below summary", () => {
      const result = formatGadgetSummary({
        gadgetName: "TellUser",
        executionTimeMs: 1,
        parameters: { message: "**Done!** Task completed." },
        result: "✅ Done! Task completed.",
      });
      // Should have summary line AND rendered message
      expect(result).toContain("TellUser");
      expect(result).toContain("Done!");
      expect(result).toContain("Task completed");
    });
  });
});
