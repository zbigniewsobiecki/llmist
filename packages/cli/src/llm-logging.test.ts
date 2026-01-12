import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { formatCallNumber, formatLlmRequest, writeLogFile } from "./llm-logging.js";

describe("llm-logging", () => {
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
        "=== SYSTEM ===\nYou are helpful\n\n=== USER ===\nHi\n\n=== ASSISTANT ===\nHello!\n",
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
