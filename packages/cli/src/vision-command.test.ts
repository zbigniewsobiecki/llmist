import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import type { LLMist } from "llmist";
import { createLogger } from "llmist";
import type { CLIEnvironment } from "./environment.js";
import { executeVision, type VisionCommandOptions } from "./vision-command.js";

/**
 * Test suite for vision command.
 *
 * Tests the CLI vision analysis functionality including error handling
 * and option parsing.
 */

// Test fixtures directory
const TEST_DIR = join(tmpdir(), "llmist-vision-test-" + Date.now());

// Minimal valid JPEG magic bytes
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true });
  await writeFile(join(TEST_DIR, "test.jpg"), JPEG_MAGIC);
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

/**
 * Helper to create a readable stream.
 */
function createReadable(content: string, { isTTY = false } = {}): Readable & { isTTY?: boolean } {
  const stream = Readable.from([content]) as Readable & { isTTY?: boolean };
  stream.isTTY = isTTY;
  return stream;
}

/**
 * Helper to create a writable stream that captures output.
 */
function createWritable(isTTY = false) {
  let data = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      data += chunk.toString();
      callback();
    },
  });
  (stream as NodeJS.WriteStream & { isTTY: boolean }).isTTY = isTTY;
  return { stream, read: () => data };
}

/**
 * Helper to create a mock client with vision support.
 */
function createMockClient(mockResult: string = "Test analysis result"): LLMist {
  return {
    vision: {
      analyze: async () => mockResult,
    },
  } as unknown as LLMist;
}

/**
 * Helper to create a minimal CLI environment for testing.
 */
function createEnv(
  overrides: Partial<CLIEnvironment> & { createClient: () => LLMist },
): CLIEnvironment {
  const stdin = createReadable("", { isTTY: false });
  const stdout = createWritable();
  const stderr = createWritable();

  return {
    argv: ["node", "llmist"],
    stdin,
    stdout: stdout.stream,
    stderr: stderr.stream,
    setExitCode: () => {},
    createLogger: (name: string) => createLogger({ type: "hidden", name }),
    isTTY: false,
    prompt: async () => {
      throw new Error("Cannot prompt in test environment");
    },
    ...overrides,
  };
}

describe("vision command", () => {
  describe("executeVision", () => {
    it("should analyze an image and output the result", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      const mockResult = "This is a test image showing sample content.";
      const client = createMockClient(mockResult);

      const env = createEnv({
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      const options: VisionCommandOptions = {
        model: "gpt-4o",
        prompt: "Describe this image",
      };

      await executeVision(join(TEST_DIR, "test.jpg"), options, env);

      const output = stdout.read();
      expect(output).toContain(mockResult);
    });

    it("should use default prompt when not provided", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      let capturedPrompt: string | undefined;

      const client = {
        vision: {
          analyze: async (opts: { prompt: string }) => {
            capturedPrompt = opts.prompt;
            return "Result";
          },
        },
      } as unknown as LLMist;

      const env = createEnv({
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      const options: VisionCommandOptions = {
        model: "gpt-4o",
        // No prompt provided
      };

      await executeVision(join(TEST_DIR, "test.jpg"), options, env);

      expect(capturedPrompt).toBe("Describe this image in detail.");
    });

    it("should show progress message when not quiet and stderr is TTY", async () => {
      const stdout = createWritable();
      const stderr = createWritable(true); // TTY enabled
      const client = createMockClient();

      const env = createEnv({
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      const options: VisionCommandOptions = {
        model: "gpt-4o",
        quiet: false,
      };

      await executeVision(join(TEST_DIR, "test.jpg"), options, env);

      const stderrOutput = stderr.read();
      expect(stderrOutput).toContain("Analyzing image");
    });

    it("should not show progress message when quiet", async () => {
      const stdout = createWritable();
      const stderr = createWritable(true); // TTY enabled but quiet
      const client = createMockClient();

      const env = createEnv({
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      const options: VisionCommandOptions = {
        model: "gpt-4o",
        quiet: true,
      };

      await executeVision(join(TEST_DIR, "test.jpg"), options, env);

      const stderrOutput = stderr.read();
      expect(stderrOutput).not.toContain("Analyzing image");
    });

    it("should not show progress message when stderr is not TTY", async () => {
      const stdout = createWritable();
      const stderr = createWritable(false); // Not TTY
      const client = createMockClient();

      const env = createEnv({
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      const options: VisionCommandOptions = {
        model: "gpt-4o",
        quiet: false,
      };

      await executeVision(join(TEST_DIR, "test.jpg"), options, env);

      const stderrOutput = stderr.read();
      expect(stderrOutput).not.toContain("Analyzing image");
    });

    it("should throw error for non-existent file", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      const client = createMockClient();

      const env = createEnv({
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      const options: VisionCommandOptions = {
        model: "gpt-4o",
      };

      await expect(executeVision(join(TEST_DIR, "nonexistent.jpg"), options, env)).rejects.toThrow(
        /Failed to read file/,
      );
    });

    it("should pass maxTokens option to vision.analyze", async () => {
      const stdout = createWritable();
      const stderr = createWritable();
      let capturedMaxTokens: number | undefined;

      const client = {
        vision: {
          analyze: async (opts: { maxTokens?: number }) => {
            capturedMaxTokens = opts.maxTokens;
            return "Result";
          },
        },
      } as unknown as LLMist;

      const env = createEnv({
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      const options: VisionCommandOptions = {
        model: "gpt-4o",
        maxTokens: 1000,
      };

      await executeVision(join(TEST_DIR, "test.jpg"), options, env);

      expect(capturedMaxTokens).toBe(1000);
    });

    it("should resolve model shortcuts", async () => {
      const stdout = createWritable();
      const stderr = createWritable(true);
      const client = createMockClient();

      const env = createEnv({
        stdout: stdout.stream,
        stderr: stderr.stream,
        createClient: () => client,
      });

      const options: VisionCommandOptions = {
        model: "gpt4", // shortcut for gpt-4o
      };

      await executeVision(join(TEST_DIR, "test.jpg"), options, env);

      const stderrOutput = stderr.read();
      // Should resolve shortcut to full model name
      expect(stderrOutput).toContain("gpt-4o");
    });
  });
});
