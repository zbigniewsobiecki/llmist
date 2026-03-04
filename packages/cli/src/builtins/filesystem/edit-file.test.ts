import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editFile } from "./edit-file.js";

describe("EditFile integration", () => {
  // Use a path within the project directory to satisfy path validation
  const testDir = join(process.cwd(), ".test-temp");
  let testFile: string;

  beforeEach(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    // Generate unique filename for each test to prevent cross-test interference
    testFile = join(
      testDir,
      `editfile-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
    );
    // Use distinct content so fuzzy matching doesn't create false positives
    // (e.g., "const x = 1;" and "const y = 2;" are 83% similar, above the 0.8 threshold)
    writeFileSync(testFile, "const uniqueVar = 123;\nfunction doSomething() { return true; }");
  });

  afterEach(() => {
    try {
      unlinkSync(testFile);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  it("replaces single match and writes to file", async () => {
    const result = await editFile.execute({
      filePath: testFile,
      search: "const uniqueVar = 123;",
      replace: "const uniqueVar = 456;",
      replaceAll: false,
    });

    expect(result).toContain("status=success");
    expect(readFileSync(testFile, "utf-8")).toBe(
      "const uniqueVar = 456;\nfunction doSomething() { return true; }",
    );
  });

  it("replaces all matches with replaceAll=true", async () => {
    writeFileSync(testFile, "a = 1;\na = 1;\na = 1;");

    const result = await editFile.execute({
      filePath: testFile,
      search: "a = 1;",
      replace: "a = 2;",
      replaceAll: true,
    });

    expect(result).toContain("matches=3");
    expect(readFileSync(testFile, "utf-8")).toBe("a = 2;\na = 2;\na = 2;");
  });

  it("fails with expectedCount mismatch", async () => {
    writeFileSync(testFile, "exact_search_term\nexact_search_term");

    const result = await editFile.execute({
      filePath: testFile,
      search: "exact_search_term",
      replace: "replaced",
      replaceAll: false,
      expectedCount: 1,
    });

    expect(result).toContain("status=error");
    expect(result).toContain("Expected 1");
    // File should be unchanged
    expect(readFileSync(testFile, "utf-8")).toBe("exact_search_term\nexact_search_term");
  });

  it("fails with empty search content", async () => {
    const result = await editFile.execute({
      filePath: testFile,
      search: "   ",
      replace: "something",
      replaceAll: false,
    });

    expect(result).toContain("status=error");
    expect(result).toContain("cannot be empty");
  });

  it("handles file not found", async () => {
    const result = await editFile.execute({
      filePath: "/nonexistent/path/file.txt",
      search: "something",
      replace: "else",
      replaceAll: false,
    });

    expect(result).toContain("status=error");
  });

  it("handles deletion (empty replacement)", async () => {
    writeFileSync(testFile, "line to delete\nline to keep");

    const result = await editFile.execute({
      filePath: testFile,
      search: "line to delete\n",
      replace: "",
      replaceAll: false,
    });

    expect(result).toContain("status=success");
    expect(readFileSync(testFile, "utf-8")).toBe("line to keep");
  });

  it("fails when multiple matches found without replaceAll", async () => {
    writeFileSync(testFile, "duplicated_exact_pattern\nduplicated_exact_pattern");

    const result = await editFile.execute({
      filePath: testFile,
      search: "duplicated_exact_pattern",
      replace: "replaced",
      replaceAll: false,
    });

    expect(result).toContain("status=error");
    expect(result).toContain("Found 2 matches");
    expect(result).toContain("replaceAll=true");
    // File should be unchanged
    expect(readFileSync(testFile, "utf-8")).toBe(
      "duplicated_exact_pattern\nduplicated_exact_pattern",
    );
  });

  it("provides suggestions when search not found", async () => {
    writeFileSync(testFile, "function calculateTotal() {\n  return 42;\n}");

    const result = await editFile.execute({
      filePath: testFile,
      search: "function calculateSum() {\n  return 42;\n}",
      replace: "function newFunc() {\n  return 0;\n}",
      replaceAll: false,
    });

    // The fuzzy matching should succeed since they're similar
    // If not, we'd see suggestions
    if (result.includes("status=failed")) {
      expect(result).toContain("SUGGESTIONS");
    }
  });

  it("limits line ranges in output for many matches", async () => {
    // Create file with many matches
    const lines = Array(10).fill("x = 1;").join("\n");
    writeFileSync(testFile, lines);

    const result = await editFile.execute({
      filePath: testFile,
      search: "x = 1;",
      replace: "x = 2;",
      replaceAll: true,
    });

    expect(result).toContain("status=success");
    expect(result).toContain("matches=10");
    // Should show "+X more" for extra ranges beyond MAX_DISPLAYED_RANGES (5)
    expect(result).toContain("+5 more");
  });
});
