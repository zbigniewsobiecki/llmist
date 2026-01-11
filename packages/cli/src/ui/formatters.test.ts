import { afterEach, describe, expect, it } from "vitest";
import {
  formatGadgetLine,
  formatGadgetOpening,
  formatGadgetSummary,
  formatLLMCallLine,
  formatLLMCallOpening,
  formatNestedGadgetResult,
  formatTokens,
  formatUserMessage,
  renderMarkdown,
  truncateValue,
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
      // Uses same format as LLM calls: "↓ 248"
      expect(result).toContain("↓");
      expect(result).toContain("248");
    });

    it("shows 'k' suffix for large token counts", () => {
      const result = formatGadgetSummary({
        gadgetName: "Search",
        executionTimeMs: 100,
        result: "lots of output",
        tokenCount: 2500,
      });
      // Uses same format as LLM calls: "↓ 2.5k"
      expect(result).toContain("↓");
      expect(result).toContain("2.5k");
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

  describe("result line formatting", () => {
    // Note: formatGadgetSummary now only returns the RESULT line
    // The opening line with parameters is printed separately on gadget_call

    it("shows gadget name and result preview", () => {
      const result = formatGadgetSummary({
        gadgetName: "ReadFile",
        executionTimeMs: 5,
        parameters: { path: "/test.txt" },
        result: "content",
      });
      expect(result).toContain("ReadFile");
      expect(result).toContain("content"); // preview
      expect(result).toContain("5ms"); // timing
    });

    it("shows bytes for output without tokenCount", () => {
      const result = formatGadgetSummary({
        gadgetName: "ListDirectory",
        executionTimeMs: 4,
        parameters: { path: ".", recursive: true },
        result: "files",
      });
      expect(result).toContain("ListDirectory");
      expect(result).toContain("5 bytes");
    });

    it("returns single line for result (no opening line)", () => {
      const result = formatGadgetSummary({
        gadgetName: "ReadFile",
        executionTimeMs: 1,
        parameters: { path: "/test.txt" },
        result: "content",
      });
      // Result is now single line (opening line printed separately)
      const lines = result.split("\n");
      expect(lines.length).toBe(1);
      expect(result).toContain("ReadFile");
    });

    it("shows timing without parameters on result line", () => {
      const result = formatGadgetSummary({
        gadgetName: "CoinFlip",
        executionTimeMs: 1,
        parameters: {},
        result: "heads",
      });
      // Result line: ✓ CoinFlip time: preview
      expect(result).toContain("CoinFlip");
      expect(result).toContain("1ms");
      expect(result).not.toContain("path"); // no parameters in result line
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

    it("shows single-line format without preview for empty results", () => {
      const result = formatGadgetSummary({
        gadgetName: "Delete",
        executionTimeMs: 1,
        result: "",
      });
      // Single-line format: result line only (opening line printed separately)
      const lines = result.split("\n");
      expect(lines.length).toBe(1);
      expect(result).toContain("Delete"); // gadget name
      expect(result).toContain("1ms"); // timing
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

  describe("subagentMetrics display", () => {
    it("shows aggregated metrics on line 2 when subagentMetrics provided", () => {
      const result = formatGadgetSummary({
        gadgetName: "BrowseWeb",
        executionTimeMs: 15000,
        result: "Found the information",
        subagentMetrics: {
          inputTokens: 15000,
          outputTokens: 250,
          cachedInputTokens: 3000,
          cost: 0.0024,
          callCount: 3,
        },
      });
      // Should show subagent metrics with arrows
      expect(result).toContain("↑"); // input tokens indicator
      expect(result).toContain("↓"); // output tokens indicator
      expect(result).toContain("⟳"); // cached tokens indicator
      expect(result).toContain("$"); // cost indicator
    });

    it("does not show gadget output tokens when subagentMetrics present", () => {
      const result = formatGadgetSummary({
        gadgetName: "BrowseWeb",
        executionTimeMs: 15000,
        result: "Found the information",
        tokenCount: 500, // Gadget's own output tokens
        subagentMetrics: {
          inputTokens: 15000,
          outputTokens: 250,
          cachedInputTokens: 0,
          cost: 0.002,
          callCount: 2,
        },
      });
      // Should NOT show two ↓ indicators (only subagent's)
      const downArrowCount = (result.match(/↓/g) || []).length;
      expect(downArrowCount).toBe(1);
    });

    it("skips subagentMetrics display when callCount is 0", () => {
      const result = formatGadgetSummary({
        gadgetName: "SimpleGadget",
        executionTimeMs: 100,
        result: "done",
        tokenCount: 50,
        subagentMetrics: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          cost: 0,
          callCount: 0,
        },
      });
      // Should fall back to showing gadget's own output tokens
      expect(result).toContain("↓");
      expect(result).toContain("50");
    });

    it("omits zero-value metrics from display", () => {
      const result = formatGadgetSummary({
        gadgetName: "BrowseWeb",
        executionTimeMs: 5000,
        result: "result",
        subagentMetrics: {
          inputTokens: 1000,
          outputTokens: 50,
          cachedInputTokens: 0, // Should not show ⟳
          cost: 0, // Should not show $
          callCount: 1,
        },
      });
      expect(result).toContain("↑"); // input tokens
      expect(result).toContain("↓"); // output tokens
      expect(result).not.toContain("⟳"); // no cached tokens
      // Cost of 0 should not appear (no $0.00)
      expect(result).not.toMatch(/\$0\.0+\s/);
    });
  });

  describe("custom gadget previews", () => {
    it("shows status emoji + content for TodoUpsert", () => {
      const result = formatGadgetSummary({
        gadgetName: "TodoUpsert",
        executionTimeMs: 10,
        parameters: { content: "Fix the bug", status: "done" },
        result: "Todo updated",
      });
      // Should show ✓ for done status + content
      expect(result).toContain("✓");
      expect(result).toContain("Fix the bug");
    });

    it("shows pending emoji for TodoUpsert pending status", () => {
      const result = formatGadgetSummary({
        gadgetName: "TodoUpsert",
        executionTimeMs: 10,
        parameters: { content: "Review PR", status: "pending" },
        result: "Todo created",
      });
      // Should show ⬜ for pending status
      expect(result).toContain("⬜");
      expect(result).toContain("Review PR");
    });

    it("shows in_progress emoji for TodoUpsert", () => {
      const result = formatGadgetSummary({
        gadgetName: "TodoUpsert",
        executionTimeMs: 10,
        parameters: { content: "Working on it", status: "in_progress" },
        result: "Todo updated",
      });
      // Should show 🔄 for in_progress
      expect(result).toContain("🔄");
    });

    it("shows query icon and result count for GoogleSearch", () => {
      const result = formatGadgetSummary({
        gadgetName: "GoogleSearch",
        executionTimeMs: 500,
        parameters: { query: "typescript best practices", maxResults: 5 },
        result: "Found 5 results...",
      });
      // Should show search icon in preview
      expect(result).toContain("🔍");
      expect(result).toContain("GoogleSearch");
    });

    it("extracts result count from GoogleSearch output", () => {
      const result = formatGadgetSummary({
        gadgetName: "GoogleSearch",
        executionTimeMs: 500,
        parameters: { query: "test query" },
        result: "(3 of 100 results)",
      });
      // Should show results count extracted from output
      expect(result).toContain("3 results");
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

  describe("formatGadgetSummary result line", () => {
    // Note: formatGadgetSummary now only returns the result line
    // Parameters are shown separately via formatGadgetOpening on gadget_call

    it("shows token count and timing", () => {
      Object.defineProperty(process.stdout, "columns", {
        value: 200,
        writable: true,
      });

      const result = formatGadgetSummary({
        gadgetName: "BrowseWeb",
        executionTimeMs: 22900,
        parameters: { task: "some task", url: "https://example.com" },
        result: "content",
        tokenCount: 883,
      });

      // Should show token count and timing on result line
      expect(result).toContain("BrowseWeb");
      expect(result).toContain("883"); // token count
      expect(result).toContain("22.9s"); // timing
      expect(result).toContain("content"); // preview
    });

    it("shows preview on result line", () => {
      Object.defineProperty(process.stdout, "columns", {
        value: 80,
        writable: true,
      });

      const result = formatGadgetSummary({
        gadgetName: "BrowseWeb",
        executionTimeMs: 22900,
        parameters: { task: "some task" },
        result: "content",
        tokenCount: 883,
      });

      // Should show preview content
      expect(result).toContain("BrowseWeb");
      expect(result).toContain("content");
    });
  });

  describe("formatGadgetOpening", () => {
    it("formats gadget name with arrow indicator", () => {
      const result = formatGadgetOpening("Navigate", { url: "https://example.com" });
      expect(result).toContain("→");
      expect(result).toContain("Navigate");
      expect(result).toContain("url");
      expect(result).toContain("example.com");
    });

    it("handles gadget with no parameters", () => {
      const result = formatGadgetOpening("GetPageContent");
      expect(result).toContain("→");
      expect(result).toContain("GetPageContent");
      // No parentheses when no params
      expect(result).not.toContain("()");
    });

    it("handles gadget with empty parameters object", () => {
      const result = formatGadgetOpening("ReadFile", {});
      expect(result).toContain("→");
      expect(result).toContain("ReadFile");
    });

    it("truncates long parameter values", () => {
      Object.defineProperty(process.stdout, "columns", {
        value: 80,
        writable: true,
      });
      const result = formatGadgetOpening("WriteFile", {
        path: "/very/long/path/that/should/be/truncated/because/it/is/too/long.txt",
        content: "a".repeat(200),
      });
      expect(result).toContain("WriteFile");
      expect(result).toContain("…"); // Unicode ellipsis
    });

    it("expands parameters on wide terminals", () => {
      Object.defineProperty(process.stdout, "columns", {
        value: 150,
        writable: true,
      });

      const result = formatGadgetOpening("BrowseWeb", {
        task: "Extract the core features and key selling points",
        url: "https://github.com/vadimdemedes/ink",
      });

      expect(result).toContain("Extract");
      expect(result).toContain("github.com");
    });
  });

  describe("formatNestedGadgetResult", () => {
    it("formats basic success result with time", () => {
      const result = formatNestedGadgetResult({
        name: "Navigate",
        elapsedSeconds: 0.5,
      });
      expect(result).toContain("✓");
      expect(result).toContain("Navigate");
      expect(result).toContain("0.5s");
    });

    it("shows input tokens when provided", () => {
      const result = formatNestedGadgetResult({
        name: "BrowseWeb",
        elapsedSeconds: 2.5,
        inputTokens: 5200,
      });
      expect(result).toContain("✓");
      expect(result).toContain("BrowseWeb");
      expect(result).toContain("↑");
      expect(result).toContain("5.2k");
    });

    it("shows output tokens when provided", () => {
      const result = formatNestedGadgetResult({
        name: "ReadFile",
        elapsedSeconds: 0.1,
        outputTokens: 1500,
      });
      expect(result).toContain("✓");
      expect(result).toContain("↓");
      expect(result).toContain("1.5k");
    });

    it("shows cost when provided", () => {
      const result = formatNestedGadgetResult({
        name: "APICall",
        elapsedSeconds: 1.0,
        cost: 0.005,
      });
      expect(result).toContain("✓");
      expect(result).toContain("$0.005");
    });

    it("shows all metrics together", () => {
      const result = formatNestedGadgetResult({
        name: "BrowseWeb",
        elapsedSeconds: 45.2,
        inputTokens: 50000,
        outputTokens: 300,
        cost: 0.01,
      });
      expect(result).toContain("✓");
      expect(result).toContain("BrowseWeb");
      expect(result).toContain("↑");
      expect(result).toContain("50.0k");
      expect(result).toContain("↓");
      expect(result).toContain("300");
      expect(result).toContain("$0.01");
      expect(result).toContain("45.2s");
    });

    it("shows error indicator for failed gadgets", () => {
      const result = formatNestedGadgetResult({
        name: "FailedGadget",
        elapsedSeconds: 0.1,
        error: "Connection failed",
      });
      expect(result).toContain("✗");
      expect(result).toContain("FailedGadget");
    });

    it("does not show metrics when zero", () => {
      const result = formatNestedGadgetResult({
        name: "QuickGadget",
        elapsedSeconds: 0.0,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
      });
      expect(result).toContain("✓");
      expect(result).not.toContain("↑");
      expect(result).not.toContain("↓");
      expect(result).not.toContain("$");
    });
  });
});

describe("formatLLMCallOpening", () => {
  it("formats basic opening line", () => {
    const result = formatLLMCallOpening(1, "gemini:gemini-2.5-flash");
    expect(result).toContain("→");
    expect(result).toContain("#1");
    expect(result).toContain("gemini:gemini-2.5-flash");
  });

  it("formats nested call with parent number", () => {
    const result = formatLLMCallOpening(2, "gemini:gemini-2.5-flash", 1);
    expect(result).toContain("→");
    expect(result).toContain("#1.2");
    expect(result).toContain("gemini:gemini-2.5-flash");
  });

  it("handles iteration 0", () => {
    const result = formatLLMCallOpening(0, "openai:gpt-4o");
    expect(result).toContain("#0");
    expect(result).toContain("openai:gpt-4o");
  });

  it("formats deeply nested call", () => {
    const result = formatLLMCallOpening(3, "anthropic:claude-sonnet", 5);
    expect(result).toContain("#5.3");
  });

  it("formats call with gadget invocation ID for unique subagent identification", () => {
    const result = formatLLMCallOpening(2, "gemini:gemini-2.5-flash", 6, "browse_web_1");
    expect(result).toContain("→");
    expect(result).toContain("#6.browse_web_1.2");
    expect(result).toContain("gemini:gemini-2.5-flash");
  });

  it("uses gadget invocation ID to distinguish parallel subagents", () => {
    const result1 = formatLLMCallOpening(1, "gemini:gemini-2.5-flash", 6, "browse_web_github");
    const result2 = formatLLMCallOpening(1, "gemini:gemini-2.5-flash", 6, "browse_web_npm");
    // Both have same parent (6) and iteration (1), but different gadget IDs
    expect(result1).toContain("#6.browse_web_github.1");
    expect(result2).toContain("#6.browse_web_npm.1");
    expect(result1).not.toEqual(result2);
  });

  it("falls back to legacy format when gadgetInvocationId is not provided", () => {
    const result = formatLLMCallOpening(2, "gemini:gemini-2.5-flash", 1, undefined);
    expect(result).toContain("#1.2");
    expect(result).not.toContain("undefined");
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

    it("formats subagent call with gadget invocation ID", () => {
      const result = formatLLMCallLine({
        iteration: 2,
        parentCallNumber: 6,
        gadgetInvocationId: "browse_web_1",
        model: "gemini-2.5-flash",
        elapsedSeconds: 1.5,
      });
      expect(result).toContain("#6.browse_web_1.2");
      expect(result).toContain("gemini-2.5-flash");
    });

    it("distinguishes parallel subagents by gadget invocation ID", () => {
      const result1 = formatLLMCallLine({
        iteration: 1,
        parentCallNumber: 6,
        gadgetInvocationId: "browse_web_github",
        model: "gemini-2.5-flash",
        elapsedSeconds: 1.0,
      });
      const result2 = formatLLMCallLine({
        iteration: 1,
        parentCallNumber: 6,
        gadgetInvocationId: "browse_web_npm",
        model: "gemini-2.5-flash",
        elapsedSeconds: 1.0,
      });
      expect(result1).toContain("#6.browse_web_github.1");
      expect(result2).toContain("#6.browse_web_npm.1");
      expect(result1).not.toEqual(result2);
    });

    it("falls back to legacy format without gadgetInvocationId", () => {
      const result = formatLLMCallLine({
        iteration: 2,
        parentCallNumber: 1,
        model: "test",
        elapsedSeconds: 1.0,
      });
      expect(result).toContain("#1.2");
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
      // Non-standard finish reason shown uppercase at end
      expect(result).toContain("MAX_TOKENS");
      // All completed calls get ✓ prefix
      expect(result).toContain("✓");
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
        cost: 0.0008,
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
    it("shows running indicator and elapsed time for in-progress gadget", () => {
      const result = formatGadgetLine({
        name: "BrowseWeb",
        elapsedSeconds: 5.2,
        isComplete: false,
      });
      expect(result).toContain("⏵");
      expect(result).toContain("BrowseWeb");
      // In-progress gadgets now show elapsed time
      expect(result).toContain("5.2s");
    });

    it("shows subagent metrics for in-progress gadget that runs LLM calls", () => {
      const result = formatGadgetLine({
        name: "BrowseWeb",
        elapsedSeconds: 12.5,
        isComplete: false,
        subagentInputTokens: 5200,
        subagentOutputTokens: 800,
        subagentCost: 0.004,
      });
      expect(result).toContain("⏵");
      expect(result).toContain("BrowseWeb");
      expect(result).toContain("↑"); // Input token indicator
      expect(result).toContain("5.2k"); // Input tokens
      expect(result).toContain("↓"); // Output token indicator
      expect(result).toContain("800"); // Output tokens
      expect(result).toContain("$0.004"); // Cost
      expect(result).toContain("12.5s"); // Time
    });

    it("shows only elapsed time when no subagent metrics present", () => {
      const result = formatGadgetLine({
        name: "Navigate",
        elapsedSeconds: 0.5,
        isComplete: false,
        // No subagent metrics - simple gadget
      });
      expect(result).toContain("⏵");
      expect(result).toContain("Navigate");
      expect(result).toContain("0.5s");
      expect(result).not.toContain("↑"); // No input tokens
      expect(result).not.toContain("↓"); // No output tokens
      expect(result).not.toContain("$"); // No cost
    });

    it("does NOT show parameters for in-progress gadget (params shown on opening line)", () => {
      const result = formatGadgetLine({
        name: "ReadFile",
        parameters: { path: "/test.txt" },
        elapsedSeconds: 1.0,
        isComplete: false,
      });
      // In-progress line should be compact - no parameters
      expect(result).toContain("ReadFile");
      expect(result).toContain("1.0s");
      expect(result).not.toContain("path");
      expect(result).not.toContain("/test.txt");
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
      // Uses same format as LLM calls: "↓ 1.5k"
      expect(result).toContain("↓");
      expect(result).toContain("1.5k");
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
      const longError =
        "This is a very long error message that should be truncated to prevent display issues";
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

  describe("parameter formatting (completed state only)", () => {
    // Parameters are only shown in completed state - in-progress is compact
    it("truncates long parameter values", () => {
      const result = formatGadgetLine({
        name: "BrowseWeb",
        parameters: {
          url: "https://very-long-domain-name.example.com/path/to/resource",
        },
        elapsedSeconds: 1.0,
        isComplete: true,
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
        isComplete: true,
      });
      expect(result).toContain("query");
      expect(result).toContain("test");
      expect(result).toContain("limit");
      expect(result).toContain("10");
    });
  });
});

describe("truncateValue", () => {
  it("returns empty string for maxLen <= 0", () => {
    expect(truncateValue("test", 0)).toBe("");
    expect(truncateValue("test", -1)).toBe("");
  });

  it("returns original string when shorter than maxLen", () => {
    expect(truncateValue("hi", 5)).toBe("hi");
    expect(truncateValue("hello", 5)).toBe("hello");
  });

  it("truncates with ellipsis included in maxLen budget", () => {
    // "hello" is 5 chars, maxLen=5 should return "hello" (not truncated)
    expect(truncateValue("hello", 5)).toBe("hello");

    // "hello world" is 11 chars, maxLen=5 should return "hell…" (4 chars + 1 ellipsis = 5)
    const result = truncateValue("hello world", 5);
    expect(result).toBe("hell…");
    expect(result.length).toBe(5);
  });

  it("handles exactly maxLen length strings", () => {
    // String of exactly maxLen should not be truncated
    expect(truncateValue("12345", 5)).toBe("12345");
    expect(truncateValue("123456", 5)).toBe("1234…");
  });

  it("always produces result <= maxLen", () => {
    const longString = "This is a very long string that should be truncated";
    for (const maxLen of [1, 2, 5, 10, 20]) {
      const result = truncateValue(longString, maxLen);
      expect(result.length).toBeLessThanOrEqual(maxLen);
    }
  });
});

describe("formatUserMessage", () => {
  it("renders user message with person icon", () => {
    const result = formatUserMessage("Hello!");
    expect(result).toContain("👤");
    expect(result).toContain("Hello!");
  });

  it("includes ANSI codes for inverse styling", () => {
    const result = formatUserMessage("Test message");
    // Check for ANSI escape sequence (inverse mode: \x1b[7m)
    expect(result.includes("\x1b[")).toBe(true);
  });

  it("renders plain text (not markdown) for clean inverse styling", () => {
    // User input is plain text - markdown syntax should appear as-is
    const result = formatUserMessage("**Bold** and *italic*");
    // The asterisks should be preserved (not rendered as markdown)
    expect(result).toContain("**Bold**");
    expect(result).toContain("*italic*");
  });

  it("adds newlines for visual separation", () => {
    const result = formatUserMessage("test");
    expect(result.startsWith("\n")).toBe(true);
    expect(result.endsWith("\n")).toBe(true);
  });

  it("handles empty message", () => {
    const result = formatUserMessage("");
    expect(result).toContain("👤");
    expect(result.startsWith("\n")).toBe(true);
  });

  it("preserves multiline messages as-is", () => {
    const result = formatUserMessage("Line 1\nLine 2\nLine 3");
    // All lines should be in the single inverse block
    expect(result).toContain("Line 1");
    expect(result).toContain("Line 2");
    expect(result).toContain("Line 3");
  });

  it("has visual padding with spaces around content", () => {
    const result = formatUserMessage("test");
    // The inverse block should have padding: " 👤 test "
    expect(result).toContain(" 👤 test ");
  });
});
