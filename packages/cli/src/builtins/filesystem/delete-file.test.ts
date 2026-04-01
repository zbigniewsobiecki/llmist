import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteFile } from "./delete-file.js";

describe("DeleteFile gadget", () => {
  const testDir = join(process.cwd(), ".test-temp");
  let testFile: string;

  beforeEach(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    testFile = join(
      testDir,
      `deletefile-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
    );
    writeFileSync(testFile, "to be deleted");
  });

  afterEach(() => {
    try {
      unlinkSync(testFile);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  it("deletes an existing file successfully", () => {
    const result = deleteFile.execute({ filePath: testFile, recursive: false });

    expect(result).toContain(`path=${testFile}`);
    expect(result).toContain("Deleted file successfully");
    expect(existsSync(testFile)).toBe(false);
  });

  it("returns error message for non-existent path", () => {
    const nonExistentPath = join(testDir, "ghost-file.txt");
    const result = deleteFile.execute({ filePath: nonExistentPath, recursive: false });

    expect(result).toContain("Error");
    expect(result).toContain("does not exist");
  });

  it("returns error message for directory without recursive=true", () => {
    const subDir = join(testDir, `subdir-${Date.now()}`);
    mkdirSync(subDir, { recursive: true });

    try {
      const result = deleteFile.execute({ filePath: subDir, recursive: false });

      expect(result).toContain("Error");
      expect(result).toContain("recursive=true");
    } finally {
      try {
        mkdirSync(subDir, { recursive: true }); // recreate for cleanup
      } catch {
        // Ignore
      }
    }
  });

  it("recursively deletes a directory when recursive=true", () => {
    const subDir = join(testDir, `subdir-recursive-${Date.now()}`);
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "nested.txt"), "nested content");

    const result = deleteFile.execute({ filePath: subDir, recursive: true });

    expect(result).toContain("Deleted directory successfully");
    expect(existsSync(subDir)).toBe(false);
  });

  it("throws PathSandboxException when path is outside CWD", () => {
    expect(() =>
      deleteFile.execute({ filePath: "/tmp/outside-sandbox-file.txt", recursive: false }),
    ).toThrow();
  });
});
