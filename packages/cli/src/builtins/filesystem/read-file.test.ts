import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "./read-file.js";

describe("ReadFile gadget", () => {
  const testDir = join(process.cwd(), ".test-temp");
  let testFile: string;

  beforeEach(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    testFile = join(
      testDir,
      `readfile-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
    );
    writeFileSync(testFile, "Hello, ReadFile!");
  });

  afterEach(() => {
    try {
      unlinkSync(testFile);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  it("reads an existing file and returns path=... format", () => {
    const result = readFile.execute({ filePath: testFile });

    expect(result).toContain(`path=${testFile}`);
    expect(result).toContain("Hello, ReadFile!");
    // Check separator: first line is path=..., then blank line, then content
    const lines = result.split("\n");
    expect(lines[0]).toBe(`path=${testFile}`);
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("Hello, ReadFile!");
  });

  it("throws when file does not exist", () => {
    const nonExistentPath = join(testDir, "does-not-exist.txt");
    expect(() => readFile.execute({ filePath: nonExistentPath })).toThrow();
  });

  it("throws PathSandboxException when path is outside CWD", () => {
    expect(() => readFile.execute({ filePath: "/tmp/outside-sandbox.txt" })).toThrow();
  });
});
