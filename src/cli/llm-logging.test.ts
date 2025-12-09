import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "bun:test";

import {
  createSessionDir,
  DEFAULT_LLM_LOG_DIR,
  formatCallNumber,
  formatLlmRequest,
  formatSessionTimestamp,
  resolveLogDir,
  writeLogFile,
} from "./llm-logging.js";

describe("llm-logging", () => {
  describe("resolveLogDir", () => {
    it("returns default directory with subdir when option is true", () => {
      const result = resolveLogDir(true, "requests");
      expect(result).toBe(join(DEFAULT_LLM_LOG_DIR, "requests"));
    });

    it("returns provided path when option is a string", () => {
      const customPath = "/custom/log/path";
      const result = resolveLogDir(customPath, "requests");
      expect(result).toBe(customPath);
    });

    it("returns undefined when option is undefined", () => {
      const result = resolveLogDir(undefined, "requests");
      expect(result).toBeUndefined();
    });

    it("returns undefined when option is false", () => {
      const result = resolveLogDir(false, "requests");
      expect(result).toBeUndefined();
    });
  });

  describe("formatLlmRequest", () => {
    it("formats single message correctly", () => {
      const messages = [{ role: "user" as const, content: "Hello" }];
      const result = formatLlmRequest(messages);
      expect(result).toBe("=== USER ===\nHello\n");
    });

    it("formats multiple messages correctly", () => {
      const messages = [
        { role: "system" as const, content: "You are helpful" },
        { role: "user" as const, content: "Hi" },
        { role: "assistant" as const, content: "Hello!" },
      ];
      const result = formatLlmRequest(messages);
      expect(result).toBe(
        "=== SYSTEM ===\nYou are helpful\n\n=== USER ===\nHi\n\n=== ASSISTANT ===\nHello!\n"
      );
    });

    it("handles empty content", () => {
      const messages = [{ role: "user" as const, content: "" }];
      const result = formatLlmRequest(messages);
      expect(result).toBe("=== USER ===\n\n");
    });

    it("handles undefined content", () => {
      const messages = [{ role: "user" as const, content: undefined }];
      const result = formatLlmRequest(messages);
      expect(result).toBe("=== USER ===\n\n");
    });

    it("handles empty messages array", () => {
      const result = formatLlmRequest([]);
      expect(result).toBe("");
    });
  });

  describe("formatSessionTimestamp", () => {
    it("returns correct format YYYY-MM-DD_HH-MM-SS", () => {
      const date = new Date(2025, 11, 9, 14, 30, 45); // Dec 9, 2025 14:30:45
      const result = formatSessionTimestamp(date);
      expect(result).toBe("2025-12-09_14-30-45");
    });

    it("zero-pads single-digit month and day", () => {
      const date = new Date(2025, 0, 5, 9, 5, 3); // Jan 5, 2025 09:05:03
      const result = formatSessionTimestamp(date);
      expect(result).toBe("2025-01-05_09-05-03");
    });

    it("handles midnight correctly", () => {
      const date = new Date(2025, 5, 15, 0, 0, 0); // June 15, 2025 00:00:00
      const result = formatSessionTimestamp(date);
      expect(result).toBe("2025-06-15_00-00-00");
    });

    it("handles end of day correctly", () => {
      const date = new Date(2025, 11, 31, 23, 59, 59); // Dec 31, 2025 23:59:59
      const result = formatSessionTimestamp(date);
      expect(result).toBe("2025-12-31_23-59-59");
    });

    it("uses current date when no argument provided", () => {
      const before = new Date();
      const result = formatSessionTimestamp();
      const after = new Date();

      // Parse result back to date components
      const [datePart, timePart] = result.split("_");
      const [year, month, day] = datePart.split("-").map(Number);
      const [hours, minutes, seconds] = timePart.split("-").map(Number);

      // Verify it's between before and after
      const resultDate = new Date(year, month - 1, day, hours, minutes, seconds);
      expect(resultDate.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      expect(resultDate.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    });
  });

  describe("formatCallNumber", () => {
    it("zero-pads single digit to 4 digits", () => {
      expect(formatCallNumber(1)).toBe("0001");
      expect(formatCallNumber(9)).toBe("0009");
    });

    it("zero-pads double digit to 4 digits", () => {
      expect(formatCallNumber(10)).toBe("0010");
      expect(formatCallNumber(42)).toBe("0042");
      expect(formatCallNumber(99)).toBe("0099");
    });

    it("zero-pads triple digit to 4 digits", () => {
      expect(formatCallNumber(100)).toBe("0100");
      expect(formatCallNumber(999)).toBe("0999");
    });

    it("handles 4-digit numbers without padding", () => {
      expect(formatCallNumber(1000)).toBe("1000");
      expect(formatCallNumber(9999)).toBe("9999");
    });

    it("handles zero", () => {
      expect(formatCallNumber(0)).toBe("0000");
    });

    it("handles numbers larger than 4 digits", () => {
      expect(formatCallNumber(10000)).toBe("10000");
      expect(formatCallNumber(99999)).toBe("99999");
    });
  });

  describe("createSessionDir", () => {
    let testBaseDir: string;

    beforeEach(async () => {
      testBaseDir = join(tmpdir(), `llmist-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await mkdir(testBaseDir, { recursive: true });
    });

    afterEach(async () => {
      try {
        await rm(testBaseDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it("creates a directory with timestamped name", async () => {
      const result = await createSessionDir(testBaseDir);

      // Result should be a path under testBaseDir
      expect(result).toBeDefined();
      expect(result!.startsWith(testBaseDir)).toBe(true);

      // Verify the directory was created by trying to write to it
      const testFile = join(result!, "test.txt");
      await writeLogFile(result!, "test.txt", "test content");
      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("test content");
    });

    it("returns full path including timestamp", async () => {
      const before = new Date();
      const result = await createSessionDir(testBaseDir);
      const after = new Date();

      expect(result).toBeDefined();

      // Extract the timestamp part from the path
      const timestampPart = result!.replace(testBaseDir + "/", "");

      // Verify format matches YYYY-MM-DD_HH-MM-SS
      expect(timestampPart).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);

      // Verify timestamp is within expected range
      const [datePart, timePart] = timestampPart.split("_");
      const [year, month, day] = datePart.split("-").map(Number);
      const [hours, minutes, seconds] = timePart.split("-").map(Number);
      const resultDate = new Date(year, month - 1, day, hours, minutes, seconds);

      expect(resultDate.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      expect(resultDate.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    });

    it("creates nested directories if base doesn't exist", async () => {
      const nestedBase = join(testBaseDir, "deeply", "nested", "path");
      const result = await createSessionDir(nestedBase);

      expect(result?.startsWith(nestedBase)).toBe(true);

      // Verify directory was created
      await writeLogFile(result!, "test.txt", "nested test");
      const content = await readFile(join(result!, "test.txt"), "utf-8");
      expect(content).toBe("nested test");
    });

    it("returns undefined and logs warning on permission error", async () => {
      // Use an invalid path that will fail on most systems
      const invalidPath = "/root/definitely-no-permission/llmist-test";

      // Capture console.warn
      const originalWarn = console.warn;
      let warnCalled = false;
      console.warn = () => { warnCalled = true; };

      try {
        const result = await createSessionDir(invalidPath);
        expect(result).toBeUndefined();
        expect(warnCalled).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe("writeLogFile", () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = join(tmpdir(), `llmist-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    });

    afterEach(async () => {
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it("creates directory and writes file", async () => {
      const filename = "test.request";
      const content = "=== USER ===\nHello world\n";

      await writeLogFile(testDir, filename, content);

      const result = await readFile(join(testDir, filename), "utf-8");
      expect(result).toBe(content);
    });

    it("handles UTF-8 content correctly", async () => {
      const content = "=== USER ===\n日本語テスト 🎉\n";

      await writeLogFile(testDir, "unicode.txt", content);

      const result = await readFile(join(testDir, "unicode.txt"), "utf-8");
      expect(result).toBe(content);
    });

    it("overwrites existing file", async () => {
      await writeLogFile(testDir, "file.txt", "original");
      await writeLogFile(testDir, "file.txt", "updated");

      const result = await readFile(join(testDir, "file.txt"), "utf-8");
      expect(result).toBe("updated");
    });
  });
});
