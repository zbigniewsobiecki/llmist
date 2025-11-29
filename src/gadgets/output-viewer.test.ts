import { describe, expect, it } from "bun:test";
import { GadgetOutputStore } from "../agent/gadget-output-store.js";
import {
  applyLineLimit,
  applyPattern,
  applyPatterns,
  createGadgetOutputViewer,
} from "./output-viewer.js";

describe("applyPattern", () => {
  const lines = ["line 1", "ERROR: something failed", "line 3", "line 4", "WARNING: low memory"];

  describe("include mode", () => {
    it("should keep only matching lines", () => {
      const result = applyPattern(lines, {
        regex: "ERROR|WARNING",
        include: true,
        before: 0,
        after: 0,
      });

      expect(result).toEqual(["ERROR: something failed", "WARNING: low memory"]);
    });

    it("should include context lines before match", () => {
      const result = applyPattern(lines, {
        regex: "ERROR",
        include: true,
        before: 1,
        after: 0,
      });

      expect(result).toEqual(["line 1", "ERROR: something failed"]);
    });

    it("should include context lines after match", () => {
      const result = applyPattern(lines, {
        regex: "ERROR",
        include: true,
        before: 0,
        after: 2,
      });

      expect(result).toEqual(["ERROR: something failed", "line 3", "line 4"]);
    });

    it("should include context before and after", () => {
      const result = applyPattern(lines, {
        regex: "line 3",
        include: true,
        before: 1,
        after: 1,
      });

      expect(result).toEqual(["ERROR: something failed", "line 3", "line 4"]);
    });

    it("should not go out of bounds with context", () => {
      const result = applyPattern(lines, {
        regex: "line 1",
        include: true,
        before: 10, // More than available
        after: 0,
      });

      expect(result).toEqual(["line 1"]);
    });

    it("should return empty array when no matches", () => {
      const result = applyPattern(lines, {
        regex: "NOTFOUND",
        include: true,
        before: 0,
        after: 0,
      });

      expect(result).toEqual([]);
    });
  });

  describe("exclude mode", () => {
    it("should remove matching lines", () => {
      const result = applyPattern(lines, {
        regex: "ERROR|WARNING",
        include: false,
        before: 0,
        after: 0,
      });

      expect(result).toEqual(["line 1", "line 3", "line 4"]);
    });

    it("should ignore before/after in exclude mode", () => {
      const result = applyPattern(lines, {
        regex: "ERROR",
        include: false,
        before: 2, // These are ignored in exclude mode
        after: 2,
      });

      expect(result).toEqual(["line 1", "line 3", "line 4", "WARNING: low memory"]);
    });

    it("should return all lines when no matches", () => {
      const result = applyPattern(lines, {
        regex: "NOTFOUND",
        include: false,
        before: 0,
        after: 0,
      });

      expect(result).toEqual(lines);
    });
  });
});

describe("applyPatterns", () => {
  const lines = [
    "file1.ts: TODO fix this",
    "file2.ts: TODO HIGH priority",
    "file3.test.ts: TODO add test",
    "file4.ts: normal code",
    "file5.test.ts: test code",
  ];

  it("should apply patterns in order (like piping through grep)", () => {
    // First find TODOs, then exclude tests
    const result = applyPatterns(lines, [
      { regex: "TODO", include: true, before: 0, after: 0 },
      { regex: "\\.test\\.ts", include: false, before: 0, after: 0 },
    ]);

    expect(result).toEqual(["file1.ts: TODO fix this", "file2.ts: TODO HIGH priority"]);
  });

  it("should chain multiple filters", () => {
    const result = applyPatterns(lines, [
      { regex: "TODO", include: true, before: 0, after: 0 },
      { regex: "HIGH", include: true, before: 0, after: 0 },
    ]);

    expect(result).toEqual(["file2.ts: TODO HIGH priority"]);
  });

  it("should return all lines when no patterns", () => {
    const result = applyPatterns(lines, []);

    expect(result).toEqual(lines);
  });
});

describe("applyLineLimit", () => {
  const lines = ["line 1", "line 2", "line 3", "line 4", "line 5", "line 6", "line 7", "line 8"];

  describe('first N lines format ("N-")', () => {
    it("should return first N lines", () => {
      expect(applyLineLimit(lines, "3-")).toEqual(["line 1", "line 2", "line 3"]);
    });

    it("should return all lines when N exceeds length", () => {
      expect(applyLineLimit(lines, "100-")).toEqual(lines);
    });

    it("should return first 1 line", () => {
      expect(applyLineLimit(lines, "1-")).toEqual(["line 1"]);
    });
  });

  describe('last N lines format ("-N")', () => {
    it("should return last N lines", () => {
      expect(applyLineLimit(lines, "-3")).toEqual(["line 6", "line 7", "line 8"]);
    });

    it("should return all lines when N exceeds length", () => {
      expect(applyLineLimit(lines, "-100")).toEqual(lines);
    });

    it("should return last 1 line", () => {
      expect(applyLineLimit(lines, "-1")).toEqual(["line 8"]);
    });
  });

  describe('range format ("start-end", 1-indexed)', () => {
    it("should return lines in range", () => {
      expect(applyLineLimit(lines, "2-4")).toEqual(["line 2", "line 3", "line 4"]);
    });

    it("should handle start at 1", () => {
      expect(applyLineLimit(lines, "1-3")).toEqual(["line 1", "line 2", "line 3"]);
    });

    it("should handle end exceeding length", () => {
      expect(applyLineLimit(lines, "6-100")).toEqual(["line 6", "line 7", "line 8"]);
    });

    it("should handle single line range", () => {
      expect(applyLineLimit(lines, "3-3")).toEqual(["line 3"]);
    });
  });

  describe("invalid formats", () => {
    it("should return unchanged for invalid format", () => {
      expect(applyLineLimit(lines, "invalid")).toEqual(lines);
      expect(applyLineLimit(lines, "abc-")).toEqual(lines);
      expect(applyLineLimit(lines, "-abc")).toEqual(lines);
      expect(applyLineLimit(lines, "")).toEqual(lines);
    });

    it("should return unchanged for invalid range", () => {
      expect(applyLineLimit(lines, "5-3")).toEqual(lines); // start > end
      expect(applyLineLimit(lines, "0-5")).toEqual(lines); // start < 1
    });
  });

  describe("whitespace handling", () => {
    it("should trim whitespace", () => {
      expect(applyLineLimit(lines, "  3-  ")).toEqual(["line 1", "line 2", "line 3"]);
      expect(applyLineLimit(lines, "  -2  ")).toEqual(["line 7", "line 8"]);
      expect(applyLineLimit(lines, " 2-4 ")).toEqual(["line 2", "line 3", "line 4"]);
    });
  });
});

describe("createGadgetOutputViewer", () => {
  it("should return error for non-existent ID", () => {
    const store = new GadgetOutputStore();
    const viewer = createGadgetOutputViewer(store);

    const result = viewer.execute({ id: "nonexistent_12345678" });

    expect(result).toContain('Error: No stored output with id "nonexistent_12345678"');
    expect(result).toContain("Available IDs: (none)");
  });

  it("should list available IDs in error message", () => {
    const store = new GadgetOutputStore();
    const id1 = store.store("A", "content");
    const id2 = store.store("B", "content");
    const viewer = createGadgetOutputViewer(store);

    const result = viewer.execute({ id: "nonexistent_12345678" });

    expect(result).toContain("Available IDs:");
    expect(result).toContain(id1);
    expect(result).toContain(id2);
  });

  it("should return all lines with header when no filters", () => {
    const store = new GadgetOutputStore();
    const content = "line 1\nline 2\nline 3";
    const id = store.store("Test", content);
    const viewer = createGadgetOutputViewer(store);

    const result = viewer.execute({ id });

    expect(result).toContain("[Showing all 3 lines]");
    expect(result).toContain("line 1");
    expect(result).toContain("line 2");
    expect(result).toContain("line 3");
  });

  it("should apply patterns", () => {
    const store = new GadgetOutputStore();
    const content = "line 1\nERROR: fail\nline 3";
    const id = store.store("Test", content);
    const viewer = createGadgetOutputViewer(store);

    const result = viewer.execute({
      id,
      patterns: [{ regex: "ERROR", include: true, before: 0, after: 0 }],
    });

    expect(result).toContain("[Showing 1 of 3 lines]");
    expect(result).toContain("ERROR: fail");
    expect(result).not.toContain("line 1");
    expect(result).not.toContain("line 3");
  });

  it("should apply limit after patterns", () => {
    const store = new GadgetOutputStore();
    const content = "TODO 1\nTODO 2\nTODO 3\nnormal\nTODO 4\nTODO 5";
    const id = store.store("Test", content);
    const viewer = createGadgetOutputViewer(store);

    const result = viewer.execute({
      id,
      patterns: [{ regex: "TODO", include: true, before: 0, after: 0 }],
      limit: "2-",
    });

    expect(result).toContain("[Showing 2 of 6 lines]");
    expect(result).toContain("TODO 1");
    expect(result).toContain("TODO 2");
    expect(result).not.toContain("TODO 3");
  });

  it("should return message when no lines match", () => {
    const store = new GadgetOutputStore();
    const content = "line 1\nline 2\nline 3";
    const id = store.store("Test", content);
    const viewer = createGadgetOutputViewer(store);

    const result = viewer.execute({
      id,
      patterns: [{ regex: "NOTFOUND", include: true, before: 0, after: 0 }],
    });

    expect(result).toContain("No lines matched the filters");
    expect(result).toContain("3 lines");
  });
});
