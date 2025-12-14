import { afterEach, describe, expect, it } from "bun:test";
import {
  formatGadgetLine,
  formatGadgetStarted,
  formatGadgetSummary,
  formatLLMCallLine,
  formatTokens,
  renderMarkdown,
} from "./formatters.js";

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

describe("width-aware parameter truncation", () => {
  const originalColumns = process.stdout.columns;

  afterEach(() => {
    // Restore original columns value
    Object.defineProperty(process.stdout, "columns", {
      value: originalColumns,
      writable: true,
    });
  });

  describe("formatGadgetSummary with wide terminal", () => {
    it("shows more parameter content on wider terminals", () => {
      // Set wide terminal
      Object.defineProperty(process.stdout, "columns", {
        value: 200,
        writable: true,
      });

      const longTask = "Extract the core features and key selling points from the README";
      const longUrl = "https://github.com/vadimdemedes/ink";

      const result = formatGadgetSummary({
        gadgetName: "BrowseWeb",
        executionTimeMs: 22900,
        parameters: { task: longTask, url: longUrl },
        result: "content",
        tokenCount: 883,
      });

      // On a 200-column terminal, should show more content
      expect(result).toContain("Extract");
      expect(result).toContain("github.com");
      // Full URL should be visible on wide terminal
      expect(result).toContain("vadimdemedes/ink");
    });
  });

  describe("formatGadgetSummary with narrow terminal", () => {
    it("truncates more aggressively on narrow terminals", () => {
      // Set narrow terminal
      Object.defineProperty(process.stdout, "columns", {
        value: 80,
        writable: true,
      });

      const longTask = "Extract the core features and key selling points from the README";
      const longUrl = "https://github.com/vadimdemedes/ink";

      const result = formatGadgetSummary({
        gadgetName: "BrowseWeb",
        executionTimeMs: 22900,
        parameters: { task: longTask, url: longUrl },
        result: "content",
        tokenCount: 883,
      });

      // Should have ellipsis for truncated content
      expect(result).toContain("…");
      // Should NOT show the full URL
      expect(result).not.toContain("vadimdemedes/ink");
    });
  });

  describe("formatGadgetStarted with terminal width", () => {
    it("expands parameters on wide terminals", () => {
      Object.defineProperty(process.stdout, "columns", {
        value: 150,
        writable: true,
      });

      const result = formatGadgetStarted("BrowseWeb", {
        task: "Extract the core features and key selling points",
        url: "https://github.com/vadimdemedes/ink",
      });

      expect(result).toContain("Extract");
      expect(result).toContain("github.com");
    });
  });
});

describe("formatLLMCallLine", () => {
  describe("basic formatting", () => {
    it("shows iteration number and model name", () => {
      const result = formatLLMCallLine({
        iteration: 1,
        model: "gemini-2.5-flash",
        elapsedSeconds: 1.5,
      });
      expect(result).toContain("#1");
      expect(result).toContain("gemini-2.5-flash");
      expect(result).toContain("1.5s");
    });

    it("formats iteration 0 correctly", () => {
      const result = formatLLMCallLine({
        iteration: 0,
        model: "claude-sonnet-4-20250514",
        elapsedSeconds: 0.5,
      });
      expect(result).toContain("#0");
      expect(result).toContain("claude-sonnet-4-20250514");
    });
  });

  describe("token display", () => {
    it("shows input tokens with arrow indicator", () => {
      const result = formatLLMCallLine({
        iteration: 1,
        model: "test",
        inputTokens: 5200,
        elapsedSeconds: 1.0,
      });
      expect(result).toContain("↑");
      expect(result).toContain("5.2k");
    });

    it("shows output tokens with arrow indicator", () => {
      const result = formatLLMCallLine({
        iteration: 1,
        model: "test",
        outputTokens: 150,
        elapsedSeconds: 1.0,
      });
      expect(result).toContain("↓");
      expect(result).toContain("150");
    });

    it("shows cached tokens with recycle indicator", () => {
      const result = formatLLMCallLine({
        iteration: 1,
        model: "test",
        inputTokens: 10000,
        cachedInputTokens: 8000,
        elapsedSeconds: 1.0,
      });
      expect(result).toContain("⟳");
      expect(result).toContain("8.0k");
    });

    it("does not show cached tokens when zero", () => {
      const result = formatLLMCallLine({
        iteration: 1,
        model: "test",
        inputTokens: 5000,
        cachedInputTokens: 0,
        elapsedSeconds: 1.0,
      });
      expect(result).not.toContain("⟳");
    });

    it("shows estimated prefix for input tokens", () => {
      const result = formatLLMCallLine({
        iteration: 1,
        model: "test",
        inputTokens: 1000,
        elapsedSeconds: 1.0,
        estimated: { input: true },
      });
      expect(result).toContain("~1.0k");
    });

    it("shows estimated prefix for output tokens", () => {
      const result = formatLLMCallLine({
        iteration: 1,
        model: "test",
        outputTokens: 500,
        elapsedSeconds: 1.0,
        estimated: { output: true },
      });
      expect(result).toContain("~500");
    });
  });

  describe("context percentage", () => {
    it("shows green for low usage (< 50%)", () => {
      const result = formatLLMCallLine({
        iteration: 1,
        model: "test",
        elapsedSeconds: 1.0,
        contextPercent: 25,
      });
      expect(result).toContain("25%");
    });

    it("shows yellow for medium usage (50-80%)", () => {
      const result = formatLLMCallLine({
        iteration: 1,
        model: "test",
        elapsedSeconds: 1.0,
        contextPercent: 65,
      });
      expect(result).toContain("65%");
    });

    it("shows red for high usage (>= 80%)", () => {
      const result = formatLLMCallLine({
        iteration: 1,
        model: "test",
        elapsedSeconds: 1.0,
        contextPercent: 85,
      });
      expect(result).toContain("85%");
    });

    it("does not show percentage when undefined", () => {
      const result = formatLLMCallLine({
        iteration: 1,
        model: "test",
        elapsedSeconds: 1.0,
      });
      expect(result).not.toContain("%");
    });

    it("does not show percentage when null", () => {
      const result = formatLLMCallLine({
        iteration: 1,
        model: "test",
        elapsedSeconds: 1.0,
        contextPercent: null,
      });
      expect(result).not.toContain("%");
    });
  });

  describe("cost display", () => {
    it("shows cost with dollar sign", () => {
      const result = formatLLMCallLine({
        iteration: 1,
        model: "test",
        elapsedSeconds: 1.0,
        cost: 0.0032,
      });
      expect(result).toContain("$0.0032");
    });

    it("does not show cost when zero", () => {
      const result = formatLLMCallLine({
        iteration: 1,
        model: "test",
        elapsedSeconds: 1.0,
        cost: 0,
      });
      expect(result).not.toContain("$");
    });

    it("does not show cost when undefined", () => {
      const result = formatLLMCallLine({
        iteration: 1,
        model: "test",
        elapsedSeconds: 1.0,
      });
      expect(result).not.toContain("$");
    });
  });

  describe("status indicators", () => {
    it("shows spinner when streaming", () => {
      const result = formatLLMCallLine({
        iteration: 1,
        model: "test",
        elapsedSeconds: 1.0,
        isStreaming: true,
        spinner: "⠧",
      });
      expect(result).toContain("⠧");
    });

    it("shows checkmark for stop finish reason", () => {
      const result = formatLLMCallLine({
        iteration: 1,
        model: "test",
        elapsedSeconds: 1.0,
        finishReason: "stop",
      });
      expect(result).toContain("✓");
    });

    it("shows checkmark for end_turn finish reason", () => {
      const result = formatLLMCallLine({
        iteration: 1,
        model: "test",
        elapsedSeconds: 1.0,
        finishReason: "end_turn",
      });
      expect(result).toContain("✓");
    });

    it("shows checkmark for null finish reason", () => {
      const result = formatLLMCallLine({
        iteration: 1,
        model: "test",
        elapsedSeconds: 1.0,
        finishReason: null,
      });
      expect(result).toContain("✓");
    });

    it("shows actual reason for non-standard finish", () => {
      const result = formatLLMCallLine({
        iteration: 1,
        model: "test",
        elapsedSeconds: 1.0,
        finishReason: "max_tokens",
      });
      expect(result).toContain("max_tokens");
      expect(result).not.toContain("✓");
    });
  });

  describe("complete example", () => {
    it("formats a complete streaming call correctly", () => {
      const result = formatLLMCallLine({
        iteration: 3,
        model: "gemini-2.5-flash",
        inputTokens: 10400,
        cachedInputTokens: 9100,
        outputTokens: 104,
        elapsedSeconds: 3.2,
        cost: 0.00080,
        isStreaming: true,
        spinner: "⠧",
        contextPercent: 1,
      });
      expect(result).toContain("#3");
      expect(result).toContain("gemini-2.5-flash");
      expect(result).toContain("1%");
      expect(result).toContain("↑");
      expect(result).toContain("10.4k");
      expect(result).toContain("⟳");
      expect(result).toContain("9.1k");
      expect(result).toContain("↓");
      expect(result).toContain("104");
      expect(result).toContain("3.2s");
      expect(result).toContain("$0.00080");
      expect(result).toContain("⠧");
    });

    it("formats a complete finished call correctly", () => {
      const result = formatLLMCallLine({
        iteration: 0,
        model: "claude-sonnet-4-20250514",
        inputTokens: 5200,
        outputTokens: 36,
        elapsedSeconds: 3.7,
        cost: 0.00009,
        finishReason: "stop",
      });
      expect(result).toContain("#0");
      expect(result).toContain("claude-sonnet-4-20250514");
      expect(result).toContain("5.2k");
      expect(result).toContain("36");
      expect(result).toContain("3.7s");
      expect(result).toContain("$0.00009");
      expect(result).toContain("✓");
    });
  });
});

describe("formatGadgetLine", () => {
  describe("in-progress state", () => {
    it("shows running indicator for in-progress gadget", () => {
      const result = formatGadgetLine({
        name: "BrowseWeb",
        elapsedSeconds: 5.2,
        isComplete: false,
      });
      expect(result).toContain("⏵");
      expect(result).toContain("BrowseWeb");
      expect(result).toContain("5.2s");
    });

    it("shows parameters for in-progress gadget", () => {
      const result = formatGadgetLine({
        name: "ReadFile",
        parameters: { path: "/test.txt" },
        elapsedSeconds: 1.0,
        isComplete: false,
      });
      expect(result).toContain("path");
      expect(result).toContain("/test.txt");
    });

    it("handles empty parameters", () => {
      const result = formatGadgetLine({
        name: "Finish",
        parameters: {},
        elapsedSeconds: 0.5,
        isComplete: false,
      });
      expect(result).toContain("Finish");
      expect(result).not.toContain("undefined");
    });
  });

  describe("completed state", () => {
    it("shows checkmark for successful completion", () => {
      const result = formatGadgetLine({
        name: "ReadFile",
        elapsedSeconds: 0.5,
        isComplete: true,
      });
      expect(result).toContain("✓");
      expect(result).toContain("ReadFile");
    });

    it("shows token count when available", () => {
      const result = formatGadgetLine({
        name: "Search",
        elapsedSeconds: 2.3,
        isComplete: true,
        tokenCount: 1500,
      });
      expect(result).toContain("1.5k tokens");
    });

    it("shows bytes when no token count", () => {
      const result = formatGadgetLine({
        name: "Echo",
        elapsedSeconds: 0.1,
        isComplete: true,
        outputBytes: 256,
      });
      expect(result).toContain("256 bytes");
    });

    it("shows KB for larger outputs", () => {
      const result = formatGadgetLine({
        name: "ReadFile",
        elapsedSeconds: 0.5,
        isComplete: true,
        outputBytes: 2048,
      });
      expect(result).toContain("KB");
    });
  });

  describe("error state", () => {
    it("shows X indicator for error", () => {
      const result = formatGadgetLine({
        name: "BadGadget",
        elapsedSeconds: 0.1,
        isComplete: true,
        error: "Something went wrong",
      });
      expect(result).toContain("✗");
      expect(result).toContain("error:");
      expect(result).toContain("Something went wrong");
    });

    it("truncates long error messages", () => {
      const longError = "This is a very long error message that should be truncated to prevent display issues";
      const result = formatGadgetLine({
        name: "BadGadget",
        elapsedSeconds: 0.1,
        isComplete: true,
        error: longError,
      });
      expect(result).toContain("…");
    });
  });

  describe("breaksLoop state", () => {
    it("shows stop indicator for breaksLoop", () => {
      const result = formatGadgetLine({
        name: "Finish",
        elapsedSeconds: 0.1,
        isComplete: true,
        breaksLoop: true,
      });
      expect(result).toContain("⏹");
    });
  });

  describe("parameter formatting", () => {
    it("truncates long parameter values", () => {
      const result = formatGadgetLine({
        name: "BrowseWeb",
        parameters: {
          url: "https://very-long-domain-name.example.com/path/to/resource",
        },
        elapsedSeconds: 1.0,
        isComplete: false,
      });
      expect(result).toContain("url");
      // Should be truncated
      expect(result).toContain("…");
    });

    it("shows multiple parameters", () => {
      const result = formatGadgetLine({
        name: "Search",
        parameters: { query: "test", limit: 10 },
        elapsedSeconds: 1.0,
        isComplete: false,
      });
      expect(result).toContain("query");
      expect(result).toContain("test");
      expect(result).toContain("limit");
      expect(result).toContain("10");
    });
  });
});
