import { describe, expect, it } from "vitest";
import {
  adjustIndentation,
  applyReplacement,
  findAllMatches,
  findMatch,
  formatEditContext,
  formatMultipleMatches,
  getMatchFailure,
} from "./matcher.js";

describe("Matcher", () => {
  describe("findMatch", () => {
    describe("exact match", () => {
      it("finds exact match", () => {
        const content = "const x = 1;\nconst y = 2;";
        const search = "const x = 1;";

        const result = findMatch(content, search);

        expect(result).not.toBeNull();
        expect(result?.found).toBe(true);
        expect(result?.strategy).toBe("exact");
        expect(result?.confidence).toBe(1.0);
        expect(result?.matchedContent).toBe("const x = 1;");
        expect(result?.startIndex).toBe(0);
        expect(result?.endIndex).toBe(12);
      });

      it("finds match in middle of content", () => {
        const content = "line1\nconst x = 1;\nline3";
        const search = "const x = 1;";

        const result = findMatch(content, search);

        expect(result).not.toBeNull();
        expect(result?.strategy).toBe("exact");
        expect(result?.startLine).toBe(2);
      });

      it("returns null when no match", () => {
        const content = "const x = 1;";
        const search = "something completely different that wont match";

        const result = findMatch(content, search);

        expect(result).toBeNull();
      });
    });

    describe("whitespace-insensitive match", () => {
      it("matches with different spacing", () => {
        const content = "const   x   =   1;";
        const search = "const x = 1;";

        const result = findMatch(content, search);

        expect(result).not.toBeNull();
        expect(result?.strategy).toBe("whitespace");
        expect(result?.confidence).toBe(0.95);
      });

      it("matches with tabs vs spaces", () => {
        const content = "const\tx\t=\t1;";
        const search = "const x = 1;";

        const result = findMatch(content, search);

        expect(result).not.toBeNull();
        expect(result?.strategy).toBe("whitespace");
      });
    });

    describe("indentation-preserving match", () => {
      it("matches with different indentation", () => {
        const content = "    function foo() {\n        return 1;\n    }";
        const search = "function foo() {\n    return 1;\n}";

        const result = findMatch(content, search);

        expect(result).not.toBeNull();
        expect(result?.strategy).toBe("indentation");
        expect(result?.confidence).toBe(0.9);
      });

      it("matches when search is substring (exact match takes precedence)", () => {
        const content = "\t\tconst x = 1;";
        const search = "const x = 1;";

        const result = findMatch(content, search);

        expect(result).not.toBeNull();
        // Exact match works because search is a substring of content
        expect(result?.strategy).toBe("exact");
        expect(result?.startIndex).toBe(2); // After the two tabs
      });
    });

    describe("fuzzy match", () => {
      it("matches with minor differences", () => {
        const content = "function oldName() {\n  return value + 1;\n}";
        const search = "function oldName() {\n  return value;\n}";

        const result = findMatch(content, search, { fuzzyThreshold: 0.7 });

        expect(result).not.toBeNull();
        expect(result?.strategy).toBe("fuzzy");
        expect(result?.confidence).toBeGreaterThanOrEqual(0.7);
      });

      it("respects fuzzy threshold", () => {
        const content = "function foo() { return 1; }";
        const search = "function bar() { return 2; }";

        const result = findMatch(content, search, { fuzzyThreshold: 0.95 });

        // With high threshold, should not match
        expect(result).toBeNull();
      });
    });
  });

  describe("applyReplacement", () => {
    it("replaces content at matched location", () => {
      const content = "const x = 1;\nconst y = 2;";
      const match = findMatch(content, "const x = 1;");
      expect(match).not.toBeNull();
      if (!match) return;

      const newContent = applyReplacement(content, match, "const x = 42;");

      expect(newContent).toBe("const x = 42;\nconst y = 2;");
    });

    it("handles deletion (empty replacement)", () => {
      const content = "const x = 1;\nconst y = 2;";
      const match = findMatch(content, "const x = 1;\n");
      expect(match).not.toBeNull();
      if (!match) return;

      const newContent = applyReplacement(content, match, "");

      expect(newContent).toBe("const y = 2;");
    });

    it("handles multiline replacement", () => {
      const content = "function foo() {\n  return 1;\n}";
      const match = findMatch(content, "return 1;");
      expect(match).not.toBeNull();
      if (!match) return;

      const newContent = applyReplacement(content, match, "const x = 1;\n  return x;");

      expect(newContent).toBe("function foo() {\n  const x = 1;\n  return x;\n}");
    });
  });

  describe("getMatchFailure", () => {
    it("returns suggestions for similar content", () => {
      const content = "function oldName() {\n  return value + 1;\n}";
      const search = "function oldName() {\n  return value;\n}";

      const failure = getMatchFailure(content, search);

      expect(failure.reason).toContain("not found");
      expect(failure.suggestions.length).toBeGreaterThan(0);
      expect(failure.suggestions[0].similarity).toBeGreaterThan(0.5);
    });

    it("returns empty suggestions when no similar content", () => {
      const content = "const x = 1;";
      const search = "completely different content that does not match at all";

      const failure = getMatchFailure(content, search);

      expect(failure.suggestions.length).toBe(0);
    });

    it("includes nearby context when suggestions exist", () => {
      const content = "line1\nline2\nfunction foo() { return 1; }\nline4\nline5";
      const search = "function foo() { return 2; }";

      const failure = getMatchFailure(content, search);

      if (failure.suggestions.length > 0) {
        expect(failure.nearbyContext).toBeTruthy();
        expect(failure.nearbyContext).toContain("function");
      }
    });

    it("respects maxSuggestions option", () => {
      const content = "const x = 1;\nconst y = 1;\nconst z = 1;";
      const search = "const w = 1;";

      const failure = getMatchFailure(content, search, { maxSuggestions: 2 });

      expect(failure.suggestions.length).toBeLessThanOrEqual(2);
    });
  });

  describe("line number calculation", () => {
    it("returns correct 1-based line numbers", () => {
      const content = "line1\nline2\nline3\nline4";
      const search = "line3";

      const result = findMatch(content, search);

      expect(result).not.toBeNull();
      expect(result?.startLine).toBe(3);
      expect(result?.endLine).toBe(3);
    });

    it("handles multiline matches", () => {
      const content = "line1\nline2\nline3\nline4\nline5";
      const search = "line2\nline3\nline4";

      const result = findMatch(content, search);

      expect(result).not.toBeNull();
      expect(result?.startLine).toBe(2);
      expect(result?.endLine).toBe(4);
    });
  });

  describe("DMP (diff-match-patch) match", () => {
    it("matches short patterns with minor typos", () => {
      const content = "const myVariable = 42;";
      const search = "const myVarable = 42;"; // typo: missing 'i'

      const result = findMatch(content, search, { fuzzyThreshold: 0.85 });

      // Should find a match through DMP or fuzzy
      expect(result).not.toBeNull();
      expect(result?.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("skips very long patterns", () => {
      const longPattern = "x".repeat(1001);
      const content = "some content";

      const result = findMatch(content, longPattern);

      // Should gracefully handle long patterns
      expect(result).toBeNull();
    });

    it("matches when pattern has been slightly refactored", () => {
      const content =
        "function calculateTotal(items) {\n  return items.reduce((a, b) => a + b, 0);\n}";
      const search =
        "function calculateSum(items) {\n  return items.reduce((a, b) => a + b, 0);\n}";

      const result = findMatch(content, search, { fuzzyThreshold: 0.7 });

      expect(result).not.toBeNull();
      expect(result?.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it("returns null for empty search string", () => {
      const content = "some content";
      const result = findMatch(content, "", { fuzzyThreshold: 0.8 });
      expect(result).toBeNull();
    });

    it("returns null for empty content string", () => {
      const search = "some search";
      const result = findMatch("", search, { fuzzyThreshold: 0.8 });
      expect(result).toBeNull();
    });

    it("handles patterns with > 20 lines via fuzzy instead of DMP", () => {
      const manyLines = Array(21).fill("line content here").join("\n");
      const content = manyLines + "\nextra line";
      // DMP skips patterns > 20 lines, fuzzy will handle it
      const result = findMatch(content, manyLines, { fuzzyThreshold: 0.9 });
      // Should still find via fuzzy, or null if not similar enough
      if (result) {
        expect(result.strategy).not.toBe("dmp");
      }
    });

    it("uses bitap algorithm for patterns ≤32 chars", () => {
      const content = "const myVariable = 42;";
      const search = "const myVarable = 42;"; // 21 chars, typo
      const result = findMatch(content, search, { fuzzyThreshold: 0.8 });
      expect(result).not.toBeNull();
      // Should match via one of the strategies
      expect(result?.matchedContent).toBe("const myVariable = 42;");
    });

    it("uses prefix matching for patterns >32 chars", () => {
      const content = "function calculateTotal(items) { return items.reduce((a,b) => a+b, 0); }";
      const search = "function calculateSum(items) { return items.reduce((a,b) => a+b, 0); }";
      const result = findMatch(content, search, { fuzzyThreshold: 0.7 });
      expect(result).not.toBeNull();
      expect(result?.confidence).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe("findAllMatches", () => {
    it("finds multiple occurrences of the same pattern", () => {
      const content = "const x = 1;\nconst y = 2;\nconst x = 1;";
      const search = "const x = 1;";

      const matches = findAllMatches(content, search);

      expect(matches.length).toBe(2);
      expect(matches[0].startLine).toBe(1);
      expect(matches[1].startLine).toBe(3);
    });

    it("returns empty array when no matches", () => {
      const content = "const x = 1;";
      const search = "nonexistent";

      const matches = findAllMatches(content, search);

      expect(matches.length).toBe(0);
    });

    it("returns single match correctly", () => {
      const content = "const x = 1;\nfunction doSomething() { return true; }";
      const search = "const x = 1;";

      const matches = findAllMatches(content, search);

      expect(matches.length).toBe(1);
      expect(matches[0].strategy).toBe("exact");
    });

    it("finds matches with correct adjusted indices", () => {
      const content = "foo\nbar\nfoo\nbaz\nfoo";
      const search = "foo";

      const matches = findAllMatches(content, search);

      expect(matches.length).toBe(3);
      expect(matches[0].startIndex).toBe(0);
      expect(matches[1].startIndex).toBe(8); // After "foo\nbar\n"
      expect(matches[2].startIndex).toBe(16); // After "foo\nbar\nfoo\nbaz\n"
    });

    it("handles adjacent patterns correctly", () => {
      const content = "abab";
      const search = "ab";

      const matches = findAllMatches(content, search);

      expect(matches.length).toBe(2);
      expect(matches[0].startIndex).toBe(0);
      expect(matches[1].startIndex).toBe(2);
    });

    it("does not return overlapping matches", () => {
      // "aa" in "aaa" should find 1 match (at 0), then skip past it
      const content = "aaa";
      const search = "aa";

      const matches = findAllMatches(content, search);

      // After finding "aa" at 0, the next search starts at index 2, so no more matches
      expect(matches.length).toBe(1);
      expect(matches[0].startIndex).toBe(0);
    });

    it("handles empty search gracefully", () => {
      const content = "some content";
      const matches = findAllMatches(content, "");
      // Empty search should not match anything
      expect(matches.length).toBe(0);
    });
  });

  describe("indentation delta", () => {
    it("computes indentation delta for indentation match", () => {
      const content = "    function foo() {\n        return 1;\n    }";
      const search = "function foo() {\n    return 1;\n}";

      const result = findMatch(content, search);

      expect(result).not.toBeNull();
      expect(result?.strategy).toBe("indentation");
      expect(result?.indentationDelta).toBe("    "); // 4 spaces delta
    });

    it("returns undefined delta for non-indentation strategies", () => {
      const content = "const x = 1;";
      const search = "const x = 1;";

      const result = findMatch(content, search);

      expect(result).not.toBeNull();
      expect(result?.strategy).toBe("exact");
      expect(result?.indentationDelta).toBeUndefined();
    });
  });

  describe("adjustIndentation", () => {
    it("adds delta to each line", () => {
      const replacement = "line1\nline2\nline3";
      const delta = "    ";

      const adjusted = adjustIndentation(replacement, delta);

      expect(adjusted).toBe("    line1\n    line2\n    line3");
    });

    it("preserves empty lines without adding indent", () => {
      const replacement = "line1\n\nline3";
      const delta = "  ";

      const adjusted = adjustIndentation(replacement, delta);

      expect(adjusted).toBe("  line1\n\n  line3");
    });

    it("returns original when delta is empty", () => {
      const replacement = "line1\nline2";
      const delta = "";

      const adjusted = adjustIndentation(replacement, delta);

      expect(adjusted).toBe(replacement);
    });

    it("handles tab delta", () => {
      const result = adjustIndentation("line1\nline2", "\t");
      expect(result).toBe("\tline1\n\tline2");
    });

    it("handles mixed tabs and spaces", () => {
      const result = adjustIndentation("line1", "\t  ");
      expect(result).toBe("\t  line1");
    });

    it("handles multiline with tabs and nested indentation", () => {
      const replacement = "if (true) {\n  console.log('hi');\n}";
      const delta = "\t";

      const adjusted = adjustIndentation(replacement, delta);

      expect(adjusted).toBe("\tif (true) {\n\t  console.log('hi');\n\t}");
    });
  });

  describe("formatEditContext", () => {
    it("formats single line edit with context", () => {
      const content = "line1\nline2\nline3\nline4\nline5";
      const match = findMatch(content, "line3");
      expect(match).not.toBeNull();
      if (!match) return;

      const formatted = formatEditContext(content, match, "LINE3", 2);

      expect(formatted).toContain("Edit (lines 3-3)");
      expect(formatted).toContain("< ");
      expect(formatted).toContain("> ");
      expect(formatted).toContain("line3");
      expect(formatted).toContain("LINE3");
    });

    it("shows context lines around the edit", () => {
      const content = "a\nb\nc\nd\ne\nf\ng";
      const match = findMatch(content, "d");
      expect(match).not.toBeNull();
      if (!match) return;

      const formatted = formatEditContext(content, match, "D", 2);

      expect(formatted).toContain("b");
      expect(formatted).toContain("c");
      expect(formatted).toContain("e");
      expect(formatted).toContain("f");
    });

    it("handles match on first line", () => {
      const content = "line1\nline2\nline3";
      const match = findMatch(content, "line1");
      expect(match).not.toBeNull();
      if (!match) return;

      const formatted = formatEditContext(content, match, "LINE1", 5);

      expect(formatted).not.toContain("undefined");
      expect(formatted).toContain("line1");
      expect(formatted).toContain("LINE1");
    });

    it("handles match on last line", () => {
      const content = "line1\nline2\nline3";
      const match = findMatch(content, "line3");
      expect(match).not.toBeNull();
      if (!match) return;

      const formatted = formatEditContext(content, match, "LINE3", 5);

      expect(formatted).not.toContain("undefined");
      expect(formatted).toContain("line3");
      expect(formatted).toContain("LINE3");
    });

    it("handles single-line file", () => {
      const content = "only";
      const match = findMatch(content, "only");
      expect(match).not.toBeNull();
      if (!match) return;

      const formatted = formatEditContext(content, match, "ONLY", 5);

      expect(formatted).toContain("only");
      expect(formatted).toContain("ONLY");
      expect(formatted).not.toContain("undefined");
    });
  });

  describe("formatMultipleMatches", () => {
    it("shows summary of multiple matches", () => {
      const content = "const x = 1;\nconst y = 2;\nconst x = 1;";
      const matches = findAllMatches(content, "const x = 1;");

      const formatted = formatMultipleMatches(content, matches);

      expect(formatted).toContain("Found 2 matches");
      expect(formatted).toContain("Match 1");
      expect(formatted).toContain("Match 2");
    });

    it("limits displayed matches", () => {
      const content = "a\na\na\na\na\na\na";
      const matches = findAllMatches(content, "a");

      const formatted = formatMultipleMatches(content, matches, 3);

      expect(formatted).toContain("Match 1");
      expect(formatted).toContain("Match 2");
      expect(formatted).toContain("Match 3");
      expect(formatted).toContain("... and");
    });
  });
});
