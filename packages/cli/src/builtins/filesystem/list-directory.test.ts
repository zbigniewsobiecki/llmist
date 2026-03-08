import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { testGadget } from "@llmist/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listDirectory } from "./list-directory.js";

/**
 * Integration tests for the ListDirectory gadget using real temp directories.
 * These tests exercise the actual filesystem, complementing the unit tests in
 * filesystem.test.ts that mock the fs module.
 */
describe("ListDirectory gadget (integration with temp dirs)", () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temp directory within the OS temp folder, then point CWD there
    // so validatePathIsWithinCwd accepts paths inside it.
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "llmist-list-dir-test-"));
    // Override process.cwd() so the gadget's path sandbox accepts our temp dir
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up temp directory and all its contents
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("directory listing", () => {
    it("lists files in a directory", async () => {
      fs.writeFileSync(path.join(tempDir, "file.txt"), "hello");

      const result = await testGadget(listDirectory, { directoryPath: ".", maxDepth: 1 });

      expect(result.result).toContain("#T|N|S|A");
      expect(result.result).toContain("F|file.txt");
    });

    it("lists subdirectories", async () => {
      fs.mkdirSync(path.join(tempDir, "subdir"));

      const result = await testGadget(listDirectory, { directoryPath: ".", maxDepth: 1 });

      expect(result.result).toContain("D|subdir");
    });

    it("shows both files and directories", async () => {
      fs.writeFileSync(path.join(tempDir, "readme.txt"), "content");
      fs.mkdirSync(path.join(tempDir, "src"));

      const result = await testGadget(listDirectory, { directoryPath: ".", maxDepth: 1 });

      expect(result.result).toContain("F|readme.txt");
      expect(result.result).toContain("D|src");
    });

    it("returns #empty for an empty directory", async () => {
      const emptyDir = path.join(tempDir, "emptydir");
      fs.mkdirSync(emptyDir);

      const result = await testGadget(listDirectory, {
        directoryPath: "emptydir",
        maxDepth: 1,
      });

      expect(result.result).toContain("#empty");
    });

    it("includes path and maxDepth in header line", async () => {
      const result = await testGadget(listDirectory, { directoryPath: ".", maxDepth: 1 });

      expect(result.result).toContain("path=.");
      expect(result.result).toContain("maxDepth=1");
    });
  });

  describe("maxDepth parameter", () => {
    beforeEach(() => {
      // Create a nested structure: root/level1/level2/level3.txt
      fs.mkdirSync(path.join(tempDir, "level1"));
      fs.mkdirSync(path.join(tempDir, "level1", "level2"));
      fs.writeFileSync(path.join(tempDir, "level1", "level2", "deep.txt"), "deep content");
      fs.writeFileSync(path.join(tempDir, "level1", "mid.txt"), "mid content");
      fs.writeFileSync(path.join(tempDir, "root.txt"), "root content");
    });

    it("depth 1 shows only immediate children", async () => {
      const result = await testGadget(listDirectory, { directoryPath: ".", maxDepth: 1 });

      expect(result.result).toContain("D|level1");
      expect(result.result).toContain("F|root.txt");
      // Should NOT include deeper items
      expect(result.result).not.toContain("mid.txt");
      expect(result.result).not.toContain("deep.txt");
    });

    it("depth 2 shows one level of nesting", async () => {
      const result = await testGadget(listDirectory, { directoryPath: ".", maxDepth: 2 });

      expect(result.result).toContain("D|level1");
      expect(result.result).toContain("F|level1/mid.txt");
      expect(result.result).toContain("D|level1/level2");
      // level2 contents should NOT appear at depth 2
      expect(result.result).not.toContain("deep.txt");
    });

    it("depth 3 shows two levels of nesting", async () => {
      const result = await testGadget(listDirectory, { directoryPath: ".", maxDepth: 3 });

      expect(result.result).toContain("F|level1/level2/deep.txt");
    });
  });

  describe("path validation", () => {
    it("accepts a valid CWD-relative path", async () => {
      const subDir = path.join(tempDir, "mysubdir");
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, "file.txt"), "data");

      const result = await testGadget(listDirectory, {
        directoryPath: "mysubdir",
        maxDepth: 1,
      });

      expect(result.result).toContain("F|file.txt");
    });

    it("accepts the current directory '.'", async () => {
      const result = await testGadget(listDirectory, { directoryPath: ".", maxDepth: 1 });

      expect(result.result).toContain("path=.");
    });

    it("rejects a path outside the CWD", async () => {
      const result = await testGadget(listDirectory, {
        directoryPath: "../",
        maxDepth: 1,
      });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Path access denied");
    });

    it("throws an error when the path is not a directory", async () => {
      fs.writeFileSync(path.join(tempDir, "not-a-dir.txt"), "content");

      const result = await testGadget(listDirectory, {
        directoryPath: "not-a-dir.txt",
        maxDepth: 1,
      });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("not a directory");
    });
  });

  describe("symlinks", () => {
    it("identifies symlinks with the L type code", async () => {
      const targetFile = path.join(tempDir, "target.txt");
      const linkPath = path.join(tempDir, "link-to-target");
      fs.writeFileSync(targetFile, "target content");

      try {
        fs.symlinkSync(targetFile, linkPath);
      } catch {
        // Skip symlink tests on platforms that don't support them
        return;
      }

      const result = await testGadget(listDirectory, { directoryPath: ".", maxDepth: 1 });

      expect(result.result).toContain("L|link-to-target");
    });

    it("does not recurse into symlinked directories", async () => {
      const symlinkDir = path.join(tempDir, "symlink-dir");
      try {
        // Point the symlink to a directory outside the tempDir
        fs.symlinkSync(os.tmpdir(), symlinkDir);
      } catch {
        // Skip if symlinks not supported
        return;
      }

      const result = await testGadget(listDirectory, { directoryPath: ".", maxDepth: 2 });

      // Symlink itself should appear with L type (not recursed into)
      expect(result.result).toContain("L|symlink-dir");
      // The listing should not include items from the symlinked directory
      // (because symlinks are treated as type L, not recursed)
      const lines = (result.result ?? "").split("\n");
      const symlinkLine = lines.find((l) => l.startsWith("L|symlink-dir"));
      expect(symlinkLine).toBeDefined();
      // No entry should have symlink-dir/ as a path prefix (no recursion)
      expect(lines.filter((l) => l.includes("symlink-dir/")).length).toBe(0);
    });
  });

  describe("gadget metadata", () => {
    it("has the correct name", () => {
      expect(listDirectory.name).toBe("ListDirectory");
    });

    it("has a description", () => {
      expect(listDirectory.description).toContain("List files and directories");
    });

    it("has examples defined", () => {
      expect(listDirectory.examples).toBeDefined();
      expect(listDirectory.examples!.length).toBeGreaterThan(0);
    });

    it("accepts default parameters via testGadget", async () => {
      // directoryPath defaults to "." and maxDepth defaults to 3
      const result = await testGadget(listDirectory, {});

      expect(result.result).toBeDefined();
      expect(result.result).toContain("path=.");
      expect(result.result).toContain("maxDepth=3");
    });
  });
});
