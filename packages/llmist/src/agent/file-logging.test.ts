import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFileLoggingHooks,
  ENV_LOG_RAW_DIRECTORY,
  formatCallNumber,
  formatLlmRequest,
  getEnvFileLoggingHooks,
} from "./file-logging.js";
import type { ObserveLLMCallCompleteContext, ObserveLLMCallReadyContext } from "./hooks.js";

describe("file-logging", () => {
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
    it("zero-pads single digit to 4 digits by default", () => {
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

    it("supports custom padding", () => {
      expect(formatCallNumber(1, 6)).toBe("000001");
      expect(formatCallNumber(42, 6)).toBe("000042");
      expect(formatCallNumber(1, 2)).toBe("01");
    });
  });

  describe("createFileLoggingHooks", () => {
    let testDir: string;
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      testDir = join(tmpdir(), `llmist-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(async () => {
      consoleWarnSpy.mockRestore();
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it("writes request file on onLLMCallReady", async () => {
      const hooks = createFileLoggingHooks({ directory: testDir });

      const ctx: ObserveLLMCallReadyContext = {
        iteration: 0,
        options: {
          model: "gpt-4o",
          messages: [
            { role: "system", content: "You are helpful" },
            { role: "user", content: "Hello!" },
          ],
        },
      };

      await hooks.observers?.onLLMCallReady?.(ctx);

      const content = await readFile(join(testDir, "0001.request"), "utf-8");
      expect(content).toContain("=== SYSTEM ===");
      expect(content).toContain("You are helpful");
      expect(content).toContain("=== USER ===");
      expect(content).toContain("Hello!");
    });

    it("writes response file on onLLMCallComplete", async () => {
      const hooks = createFileLoggingHooks({ directory: testDir });

      // First trigger onLLMCallReady to set up counter
      const readyCtx: ObserveLLMCallReadyContext = {
        iteration: 0,
        options: {
          model: "gpt-4o",
          messages: [{ role: "user", content: "Hello!" }],
        },
      };
      await hooks.observers?.onLLMCallReady?.(readyCtx);

      // Then trigger onLLMCallComplete
      const completeCtx: ObserveLLMCallCompleteContext = {
        iteration: 0,
        options: { model: "gpt-4o" },
        messages: [{ role: "user", content: "Hello!" }],
        response: { role: "assistant", content: "Hi there!" },
        rawResponse: "Hi there! How can I help you today?",
        finalMessage: "Hi there! How can I help you today?",
      };

      await hooks.observers?.onLLMCallComplete?.(completeCtx);

      const content = await readFile(join(testDir, "0001.response"), "utf-8");
      expect(content).toBe("Hi there! How can I help you today?");
    });

    it("increments counter correctly across multiple calls", async () => {
      const hooks = createFileLoggingHooks({ directory: testDir });

      // First LLM call
      await hooks.observers?.onLLMCallReady?.({
        iteration: 0,
        options: {
          model: "gpt-4o",
          messages: [{ role: "user", content: "Call 1" }],
        },
      });

      // Second LLM call
      await hooks.observers?.onLLMCallReady?.({
        iteration: 1,
        options: {
          model: "gpt-4o",
          messages: [{ role: "user", content: "Call 2" }],
        },
      });

      const content1 = await readFile(join(testDir, "0001.request"), "utf-8");
      const content2 = await readFile(join(testDir, "0002.request"), "utf-8");

      expect(content1).toContain("Call 1");
      expect(content2).toContain("Call 2");
    });

    it("skips subagent calls when skipSubagents: true (default)", async () => {
      const hooks = createFileLoggingHooks({ directory: testDir });

      // Main agent call
      await hooks.observers?.onLLMCallReady?.({
        iteration: 0,
        options: {
          model: "gpt-4o",
          messages: [{ role: "user", content: "Main call" }],
        },
      });

      // Subagent call
      await hooks.observers?.onLLMCallReady?.({
        iteration: 0,
        options: {
          model: "gpt-4o",
          messages: [{ role: "user", content: "Subagent call" }],
        },
        subagentContext: {
          parentGadgetInvocationId: "browse-123",
          depth: 1,
        },
      });

      const content = await readFile(join(testDir, "0001.request"), "utf-8");
      expect(content).toContain("Main call");

      // Verify only one file was created
      await expect(readFile(join(testDir, "0002.request"), "utf-8")).rejects.toThrow();
    });

    it("includes subagent calls when skipSubagents: false", async () => {
      const hooks = createFileLoggingHooks({ directory: testDir, skipSubagents: false });

      // Main agent call
      await hooks.observers?.onLLMCallReady?.({
        iteration: 0,
        options: {
          model: "gpt-4o",
          messages: [{ role: "user", content: "Main call" }],
        },
      });

      // Subagent call
      await hooks.observers?.onLLMCallReady?.({
        iteration: 0,
        options: {
          model: "gpt-4o",
          messages: [{ role: "user", content: "Subagent call" }],
        },
        subagentContext: {
          parentGadgetInvocationId: "browse-123",
          depth: 1,
        },
      });

      const content1 = await readFile(join(testDir, "0001.request"), "utf-8");
      const content2 = await readFile(join(testDir, "0002.request"), "utf-8");

      expect(content1).toContain("Main call");
      expect(content2).toContain("Subagent call");
    });

    it("uses custom formatter when provided", async () => {
      const customFormatter = (messages: any[]) =>
        messages.map((m) => `[${m.role}] ${m.content}`).join("\n");

      const hooks = createFileLoggingHooks({
        directory: testDir,
        formatRequest: customFormatter,
      });

      await hooks.observers?.onLLMCallReady?.({
        iteration: 0,
        options: {
          model: "gpt-4o",
          messages: [
            { role: "system", content: "System message" },
            { role: "user", content: "User message" },
          ],
        },
      });

      const content = await readFile(join(testDir, "0001.request"), "utf-8");
      expect(content).toBe("[system] System message\n[user] User message");
    });

    it("calls onFileWritten callback", async () => {
      const onFileWritten = vi.fn();
      const hooks = createFileLoggingHooks({
        directory: testDir,
        onFileWritten,
      });

      await hooks.observers?.onLLMCallReady?.({
        iteration: 0,
        options: {
          model: "gpt-4o",
          messages: [{ role: "user", content: "Hello!" }],
        },
      });

      expect(onFileWritten).toHaveBeenCalledWith({
        filePath: join(testDir, "0001.request"),
        type: "request",
        callNumber: 1,
        contentLength: expect.any(Number),
      });

      await hooks.observers?.onLLMCallComplete?.({
        iteration: 0,
        options: { model: "gpt-4o" },
        messages: [{ role: "user", content: "Hello!" }],
        response: { role: "assistant", content: "Hi!" },
        rawResponse: "Hi there!",
        finalMessage: "Hi there!",
      });

      expect(onFileWritten).toHaveBeenCalledWith({
        filePath: join(testDir, "0001.response"),
        type: "response",
        callNumber: 1,
        contentLength: expect.any(Number),
      });
    });

    it("creates directory if not exists", async () => {
      const nestedDir = join(testDir, "nested", "deep", "path");
      const hooks = createFileLoggingHooks({ directory: nestedDir });

      await hooks.observers?.onLLMCallReady?.({
        iteration: 0,
        options: {
          model: "gpt-4o",
          messages: [{ role: "user", content: "Hello!" }],
        },
      });

      const content = await readFile(join(nestedDir, "0001.request"), "utf-8");
      expect(content).toContain("Hello!");
    });

    it("handles write errors gracefully", async () => {
      // Use an invalid directory path that will fail
      const invalidDir = "/dev/null/invalid/path";
      const hooks = createFileLoggingHooks({ directory: invalidDir });

      // Should not throw, just warn
      await expect(
        hooks.observers?.onLLMCallReady?.({
          iteration: 0,
          options: {
            model: "gpt-4o",
            messages: [{ role: "user", content: "Hello!" }],
          },
        }),
      ).resolves.toBeUndefined();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[file-logging] Failed to write"),
        expect.any(Error),
      );
    });

    it("supports custom starting counter", async () => {
      const hooks = createFileLoggingHooks({
        directory: testDir,
        startingCounter: 10,
      });

      await hooks.observers?.onLLMCallReady?.({
        iteration: 0,
        options: {
          model: "gpt-4o",
          messages: [{ role: "user", content: "Hello!" }],
        },
      });

      const content = await readFile(join(testDir, "0010.request"), "utf-8");
      expect(content).toContain("Hello!");
    });

    it("supports custom counter padding", async () => {
      const hooks = createFileLoggingHooks({
        directory: testDir,
        counterPadding: 6,
      });

      await hooks.observers?.onLLMCallReady?.({
        iteration: 0,
        options: {
          model: "gpt-4o",
          messages: [{ role: "user", content: "Hello!" }],
        },
      });

      const content = await readFile(join(testDir, "000001.request"), "utf-8");
      expect(content).toContain("Hello!");
    });
  });

  describe("getEnvFileLoggingHooks", () => {
    const originalEnv = process.env[ENV_LOG_RAW_DIRECTORY];

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env[ENV_LOG_RAW_DIRECTORY] = originalEnv;
      } else {
        delete process.env[ENV_LOG_RAW_DIRECTORY];
      }
    });

    it("returns undefined when env var not set", () => {
      delete process.env[ENV_LOG_RAW_DIRECTORY];
      const result = getEnvFileLoggingHooks();
      expect(result).toBeUndefined();
    });

    it("returns hooks when LLMIST_LOG_RAW_DIRECTORY is set", () => {
      process.env[ENV_LOG_RAW_DIRECTORY] = "/tmp/test-logs";
      const result = getEnvFileLoggingHooks();

      expect(result).toBeDefined();
      expect(result?.observers?.onLLMCallReady).toBeDefined();
      expect(result?.observers?.onLLMCallComplete).toBeDefined();
    });

    it("trims whitespace from directory path", () => {
      process.env[ENV_LOG_RAW_DIRECTORY] = "  /tmp/test-logs  ";
      const result = getEnvFileLoggingHooks();
      expect(result).toBeDefined();
    });

    it("returns undefined for empty string after trim", () => {
      process.env[ENV_LOG_RAW_DIRECTORY] = "   ";
      const result = getEnvFileLoggingHooks();
      expect(result).toBeUndefined();
    });
  });
});
