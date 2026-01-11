import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CLIEnvironment } from "./environment.js";
import { executeImage, type ImageCommandOptions } from "./image-command.js";

// Mock fs.writeFileSync
vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
}));

import { writeFileSync } from "node:fs";

/**
 * Mock writable stream that captures output and has optional TTY flag.
 */
class MockWritableStream extends Writable {
  public output = "";
  isTTY: boolean;

  constructor(isTTY = false) {
    super();
    this.isTTY = isTTY;
  }

  _write(chunk: Buffer | string, _encoding: string, callback: () => void): void {
    this.output += chunk.toString();
    callback();
  }

  clear(): void {
    this.output = "";
  }
}

/**
 * Creates a mock LLMist client for image generation.
 */
function createMockClient(result: {
  images: Array<{ url?: string; b64Json?: string }>;
  usage: { size: string; quality: string };
  cost?: number;
}) {
  return {
    image: {
      generate: vi.fn().mockResolvedValue(result),
    },
  };
}

/**
 * Creates a mock CLI environment.
 */
function createMockEnv(
  mockClient: ReturnType<typeof createMockClient>,
  options: { stderrTTY?: boolean; isTTY?: boolean } = {},
): CLIEnvironment & { stdout: MockWritableStream; stderr: MockWritableStream } {
  const stdout = new MockWritableStream();
  const stderr = new MockWritableStream(options.stderrTTY ?? false);

  return {
    stdin: process.stdin,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    isTTY: options.isTTY ?? false,
    createClient: () => mockClient as any,
    setExitCode: vi.fn(),
  } as unknown as CLIEnvironment & {
    stdout: MockWritableStream;
    stderr: MockWritableStream;
  };
}

describe("image-command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("executeImage", () => {
    it("should output image URL when no output file specified", async () => {
      const mockClient = createMockClient({
        images: [{ url: "https://example.com/image.png" }],
        usage: { size: "1024x1024", quality: "standard" },
      });
      const env = createMockEnv(mockClient);

      const options: ImageCommandOptions = {
        model: "dall-e-3",
        quiet: true,
      };

      await executeImage("A beautiful sunset", options, env);

      expect(mockClient.image.generate).toHaveBeenCalledWith({
        model: "dall-e-3",
        prompt: "A beautiful sunset",
        size: undefined,
        quality: undefined,
        n: 1,
        responseFormat: "url",
      });
      expect(env.stdout.output).toBe("https://example.com/image.png\n");
    });

    it("should save image to file when output option specified", async () => {
      const mockClient = createMockClient({
        images: [{ b64Json: "SGVsbG8gV29ybGQ=" }], // "Hello World" in base64
        usage: { size: "1024x1024", quality: "hd" },
      });
      const env = createMockEnv(mockClient, { stderrTTY: true });

      const options: ImageCommandOptions = {
        model: "dall-e-3",
        output: "/tmp/test-image.png",
      };

      await executeImage("A cat", options, env);

      expect(mockClient.image.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          responseFormat: "b64_json",
        }),
      );
      expect(writeFileSync).toHaveBeenCalledWith(
        "/tmp/test-image.png",
        Buffer.from("SGVsbG8gV29ybGQ=", "base64"),
      );
      expect(env.stderr.output).toContain("Image saved to /tmp/test-image.png");
    });

    it("should handle multiple images", async () => {
      const mockClient = createMockClient({
        images: [
          { url: "https://example.com/image1.png" },
          { url: "https://example.com/image2.png" },
          { url: "https://example.com/image3.png" },
        ],
        usage: { size: "512x512", quality: "standard" },
      });
      const env = createMockEnv(mockClient);

      const options: ImageCommandOptions = {
        model: "dall-e-3",
        count: "3",
        quiet: true,
      };

      await executeImage("A landscape", options, env);

      expect(mockClient.image.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          n: 3,
        }),
      );
      expect(env.stdout.output).toContain("https://example.com/image1.png");
      expect(env.stdout.output).toContain("https://example.com/image2.png");
      expect(env.stdout.output).toContain("https://example.com/image3.png");
    });

    it("should pass size and quality options", async () => {
      const mockClient = createMockClient({
        images: [{ url: "https://example.com/image.png" }],
        usage: { size: "1792x1024", quality: "hd" },
      });
      const env = createMockEnv(mockClient);

      const options: ImageCommandOptions = {
        model: "dall-e-3",
        size: "1792x1024",
        quality: "hd",
        quiet: true,
      };

      await executeImage("A portrait", options, env);

      expect(mockClient.image.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          size: "1792x1024",
          quality: "hd",
        }),
      );
    });

    it("should show summary in TTY mode", async () => {
      const mockClient = createMockClient({
        images: [{ url: "https://example.com/image.png" }],
        usage: { size: "1024x1024", quality: "standard" },
        cost: 0.04,
      });
      const env = createMockEnv(mockClient, { stderrTTY: true });

      const options: ImageCommandOptions = {
        model: "dall-e-3",
      };

      await executeImage("A mountain", options, env);

      expect(env.stderr.output).toContain("Generating image with dall-e-3");
      expect(env.stderr.output).toContain("1 image(s)");
      expect(env.stderr.output).toContain("size: 1024x1024");
      expect(env.stderr.output).toContain("quality: standard");
      expect(env.stderr.output).toContain("cost:");
    });

    it("should suppress output in quiet mode", async () => {
      const mockClient = createMockClient({
        images: [{ url: "https://example.com/image.png" }],
        usage: { size: "1024x1024", quality: "standard" },
      });
      const env = createMockEnv(mockClient, { stderrTTY: true });

      const options: ImageCommandOptions = {
        model: "dall-e-3",
        quiet: true,
      };

      await executeImage("A river", options, env);

      // stdout should have URL but stderr should be empty
      expect(env.stdout.output).toBe("https://example.com/image.png\n");
      expect(env.stderr.output).toBe("");
    });

    it("should output base64 data when no file output and b64Json returned", async () => {
      const mockClient = createMockClient({
        images: [{ b64Json: "iVBORw0KGgoAAAANSUhEUg==" }],
        usage: { size: "1024x1024", quality: "standard" },
      });
      const env = createMockEnv(mockClient);

      const options: ImageCommandOptions = {
        model: "dall-e-3",
        quiet: true,
      };

      await executeImage("A tree", options, env);

      expect(env.stdout.output).toBe("iVBORw0KGgoAAAANSUhEUg==");
    });

    it("should output URL if file output requested but only URL returned", async () => {
      const mockClient = createMockClient({
        images: [{ url: "https://example.com/fallback.png" }],
        usage: { size: "1024x1024", quality: "standard" },
      });
      const env = createMockEnv(mockClient, { stderrTTY: true });

      const options: ImageCommandOptions = {
        model: "dall-e-3",
        output: "/tmp/test.png",
      };

      await executeImage("A bird", options, env);

      // When b64Json is not available, it should output the URL to stdout
      expect(writeFileSync).not.toHaveBeenCalled();
      expect(env.stdout.output).toBe("https://example.com/fallback.png\n");
    });

    it("should not show summary when stderr is not TTY", async () => {
      const mockClient = createMockClient({
        images: [{ url: "https://example.com/image.png" }],
        usage: { size: "1024x1024", quality: "standard" },
      });
      const env = createMockEnv(mockClient, { stderrTTY: false });

      const options: ImageCommandOptions = {
        model: "dall-e-3",
        // quiet not set, but stderr is not TTY
      };

      await executeImage("A forest", options, env);

      // No status messages when not TTY
      expect(env.stderr.output).toBe("");
    });
  });
});
