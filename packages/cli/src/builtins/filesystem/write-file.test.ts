import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFile } from "./write-file.js";

describe("WriteFile gadget", () => {
  const testDir = join(process.cwd(), ".test-temp");
  let testFile: string;

  beforeEach(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    testFile = join(
      testDir,
      `writefile-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
    );
  });

  afterEach(() => {
    try {
      unlinkSync(testFile);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  it("writes a new file and reports byte count", () => {
    const content = "Hello, WriteFile!";
    const result = writeFile.execute({ filePath: testFile, content });

    expect(result).toContain(`path=${testFile}`);
    expect(result).toContain(`Wrote ${Buffer.byteLength(content, "utf-8")} bytes`);
    expect(readFileSync(testFile, "utf-8")).toBe(content);
  });

  it("overwrites an existing file", () => {
    const initial = "initial content";
    writeFile.execute({ filePath: testFile, content: initial });

    const updated = "updated content";
    const result = writeFile.execute({ filePath: testFile, content: updated });

    expect(result).toContain(`Wrote ${Buffer.byteLength(updated, "utf-8")} bytes`);
    expect(readFileSync(testFile, "utf-8")).toBe(updated);
  });

  it("auto-creates parent directories when they don't exist", () => {
    const nestedDir = join(testDir, `nested-${Date.now()}`);
    const nestedFile = join(nestedDir, "newfile.txt");

    try {
      const result = writeFile.execute({ filePath: nestedFile, content: "nested" });

      expect(result).toContain("created directory");
      expect(existsSync(nestedFile)).toBe(true);
      expect(readFileSync(nestedFile, "utf-8")).toBe("nested");
    } finally {
      try {
        rmSync(nestedDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  });

  it("reports correct byte count for multi-byte UTF-8 content", () => {
    // "é" is 2 bytes in UTF-8, "€" is 3 bytes
    const content = "café €1";
    const expectedBytes = Buffer.byteLength(content, "utf-8");
    const result = writeFile.execute({ filePath: testFile, content });

    expect(result).toContain(`Wrote ${expectedBytes} bytes`);
    expect(readFileSync(testFile, "utf-8")).toBe(content);
    // Verify byte count is greater than string length (multi-byte chars)
    expect(expectedBytes).toBeGreaterThan(content.length);
  });

  it("throws PathSandboxException when path is outside CWD", () => {
    expect(() =>
      writeFile.execute({ filePath: "/tmp/outside-sandbox.txt", content: "data" }),
    ).toThrow();
  });
});
