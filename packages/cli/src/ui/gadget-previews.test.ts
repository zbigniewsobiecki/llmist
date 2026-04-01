import { describe, expect, it } from "vitest";
import { getCustomPreview, truncatePreview } from "./gadget-previews.js";

describe("truncatePreview", () => {
  it("returns the string unchanged when it fits within maxLen", () => {
    expect(truncatePreview("hello", 10)).toBe("hello");
  });

  it("truncates with ellipsis when string exceeds maxLen", () => {
    const result = truncatePreview("hello world", 8);
    expect(result).toBe("hello w…");
    expect(result.length).toBe(8);
  });

  it("normalizes whitespace (collapses newlines and tabs)", () => {
    expect(truncatePreview("hello\n\nworld\there", 50)).toBe("hello world here");
  });

  it("trims leading and trailing whitespace", () => {
    expect(truncatePreview("  hello  ", 20)).toBe("hello");
  });

  it("handles maxLen of 1", () => {
    const result = truncatePreview("hello", 1);
    expect(result).toBe("…");
    expect(result.length).toBe(1);
  });

  it("handles exact-length string (no ellipsis)", () => {
    expect(truncatePreview("hi", 2)).toBe("hi");
  });
});

describe("getCustomPreview", () => {
  describe("TodoUpsert", () => {
    it("shows done emoji + content for done status", () => {
      const result = getCustomPreview(
        "TodoUpsert",
        { status: "done", content: "Write unit tests" },
        undefined,
        60,
      );
      expect(result).toBe("✅ Write unit tests");
    });

    it("shows in_progress emoji + content for in_progress status", () => {
      const result = getCustomPreview(
        "TodoUpsert",
        { status: "in_progress", content: "Implement feature" },
        undefined,
        60,
      );
      expect(result).toBe("🔄 Implement feature");
    });

    it("shows pending emoji + content for any other status (pending / undefined)", () => {
      const result = getCustomPreview(
        "TodoUpsert",
        { status: "pending", content: "Review PR" },
        undefined,
        60,
      );
      expect(result).toBe("⬜ Review PR");
    });

    it("shows pending emoji when status is undefined", () => {
      const result = getCustomPreview("TodoUpsert", { content: "No status set" }, undefined, 60);
      expect(result).toBe("⬜ No status set");
    });

    it("truncates long content to fit within maxWidth", () => {
      const longContent = "A".repeat(100);
      const result = getCustomPreview(
        "TodoUpsert",
        { status: "done", content: longContent },
        undefined,
        30,
      );
      expect(result).toBeDefined();
      // emoji (2 chars) + space (1 char) + truncated content; total should fit
      const contentPart = result?.slice(3); // remove "✅ "
      expect((contentPart ?? "").length).toBeLessThanOrEqual(27); // maxWidth - 3
    });

    it("returns undefined when content param is missing", () => {
      const result = getCustomPreview("TodoUpsert", { status: "done" }, undefined, 60);
      expect(result).toBeUndefined();
    });
  });

  describe("GoogleSearch", () => {
    it("shows search emoji, query, and result count from output pattern 1", () => {
      const result = getCustomPreview(
        "GoogleSearch",
        { query: "typescript generics" },
        "Results (10 of 36400000 results)",
        60,
      );
      expect(result).toContain("🔍");
      expect(result).toContain("typescript generics");
      expect(result).toContain("10 results");
    });

    it("shows search emoji, query, and result count from output pattern 2", () => {
      const result = getCustomPreview(
        "GoogleSearch",
        { query: "vitest mocking" },
        "5 results found for your query",
        60,
      );
      expect(result).toContain("🔍");
      expect(result).toContain("vitest mocking");
      expect(result).toContain("5 results");
    });

    it("shows search emoji, query, and result count from output pattern 3", () => {
      const result = getCustomPreview(
        "GoogleSearch",
        { query: "node.js streams" },
        "found 3 results in the database",
        60,
      );
      expect(result).toContain("🔍");
      expect(result).toContain("node.js streams");
      expect(result).toContain("3 results");
    });

    it("falls back to maxResults param when no count in output", () => {
      const result = getCustomPreview(
        "GoogleSearch",
        { query: "openai api", maxResults: 5 },
        "Some search result text with no count",
        60,
      );
      expect(result).toContain("🔍");
      expect(result).toContain("openai api");
      expect(result).toContain("5 results");
    });

    it("shows query without result count when output and maxResults are both absent", () => {
      const result = getCustomPreview("GoogleSearch", { query: "react hooks" }, undefined, 60);
      expect(result).toContain("🔍");
      expect(result).toContain("react hooks");
      expect(result).not.toContain("results");
    });

    it("returns undefined when query param is missing", () => {
      const result = getCustomPreview("GoogleSearch", { maxResults: 10 }, "some output", 60);
      expect(result).toBeUndefined();
    });
  });

  describe("unknown gadget", () => {
    it("returns undefined for an unknown gadget name", () => {
      const result = getCustomPreview("MyCustomGadget", { param: "value" }, "some output", 60);
      expect(result).toBeUndefined();
    });

    it("returns undefined for BrowseWeb gadget (no custom preview defined)", () => {
      const result = getCustomPreview(
        "BrowseWeb",
        { url: "https://example.com" },
        "page content",
        60,
      );
      expect(result).toBeUndefined();
    });

    it("returns undefined when params is undefined", () => {
      const result = getCustomPreview("UnknownGadget", undefined, "output", 60);
      expect(result).toBeUndefined();
    });
  });
});
