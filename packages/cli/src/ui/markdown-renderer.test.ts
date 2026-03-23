import chalk from "chalk";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  formatUserMessage,
  renderMarkdown,
  renderMarkdownWithSeparators,
} from "./markdown-renderer.js";

// Force chalk to output colors in non-TTY test environments
beforeAll(() => {
  chalk.level = 3;
});

describe("renderMarkdown", () => {
  it("renders bold markdown with ANSI bold codes", () => {
    const result = renderMarkdown("**bold**");

    // chalk.bold produces ANSI bold escape sequence
    expect(result).toContain("\x1b[1m");
  });

  it("renders italic markdown with ANSI italic codes", () => {
    const result = renderMarkdown("*italic*");

    // chalk.italic produces ANSI italic escape sequence
    expect(result).toContain("\x1b[3m");
  });

  it("renders inline code with ANSI styling", () => {
    const result = renderMarkdown("`code`");

    // Should contain some ANSI codes for code styling
    expect(result).toContain("\x1b[");
  });

  it("renders code blocks with the code content", () => {
    const result = renderMarkdown("```\nconst x = 1;\n```");

    // Code block content should be present in output
    expect(result).toContain("const x = 1;");
  });

  it("trims trailing newlines from output", () => {
    const result = renderMarkdown("hello");

    expect(result).not.toMatch(/\n$/);
  });

  describe("lazy initialization", () => {
    it("produces consistent output on repeated calls", () => {
      // Calling renderMarkdown multiple times should produce the same result
      // (verifies lazy init doesn't break on subsequent calls)
      const result1 = renderMarkdown("**bold**");
      const result2 = renderMarkdown("**bold**");

      expect(result1).toBe(result2);
    });
  });

  describe("NO_COLOR support", () => {
    let originalLevel: typeof chalk.level;

    beforeEach(() => {
      originalLevel = chalk.level;
    });

    afterEach(() => {
      chalk.level = originalLevel;
      delete process.env.NO_COLOR;
    });

    it("disables ANSI styling when chalk.level is 0 (simulates NO_COLOR)", () => {
      process.env.NO_COLOR = "1";
      chalk.level = 0;

      const result = renderMarkdown("**bold text**");

      // With chalk.level = 0, no ANSI escape codes should be present
      expect(result).not.toContain("\x1b[");
    });
  });
});

describe("renderMarkdownWithSeparators", () => {
  it("includes separator lines above and below content", () => {
    const result = renderMarkdownWithSeparators("hello world");

    // Should start with newline + separator
    expect(result).toMatch(/^\n/);
    // Should end with separator + newline
    expect(result).toMatch(/\n$/);
  });

  it("includes the rendered markdown content", () => {
    const result = renderMarkdownWithSeparators("hello world");

    expect(result).toContain("hello");
  });

  it("includes separator characters (─) in output", () => {
    const result = renderMarkdownWithSeparators("some text");

    expect(result).toContain("─");
  });

  it("wraps content between two separators", () => {
    const rendered = renderMarkdown("test");
    const withSeps = renderMarkdownWithSeparators("test");

    // The rendered content should appear between the two separators
    expect(withSeps).toContain(rendered);
    // Structure: \n + sep + \n + content + \n + sep + \n
    const parts = withSeps.split(rendered);
    expect(parts).toHaveLength(2);
  });
});

describe("formatUserMessage", () => {
  it("includes the user icon (👤)", () => {
    const result = formatUserMessage("hello");

    expect(result).toContain("👤");
  });

  it("includes the message text", () => {
    const result = formatUserMessage("hello world");

    expect(result).toContain("hello world");
  });

  it("applies inverse styling (ANSI inverse codes)", () => {
    const result = formatUserMessage("hello");

    // chalk.inverse produces ANSI inverse escape sequence \x1b[7m
    expect(result).toContain("\x1b[7m");
  });

  it("wraps output with leading and trailing newlines", () => {
    const result = formatUserMessage("hello");

    expect(result).toMatch(/^\n/);
    expect(result).toMatch(/\n$/);
  });
});
