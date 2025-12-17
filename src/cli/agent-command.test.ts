import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import type { LLMist } from "../core/client.js";
import type { LLMStream, StreamChunk } from "../core/options.js";
import { type CLIAgentOptions, executeAgent } from "./agent-command.js";
import type { CLIEnvironment } from "./environment.js";

/**
 * Mock writable stream that captures all output.
 */
class MockWritableStream extends Writable {
  public output = "";

  _write(chunk: Buffer | string, _encoding: string, callback: () => void): void {
    this.output += chunk.toString();
    callback();
  }

  clear(): void {
    this.output = "";
  }
}

/**
 * Mock stdin that simulates keyboard input and TTY capabilities.
 */
class MockStdin extends EventEmitter {
  isTTY = true;
  setRawMode = mock(() => this);
  resume = mock(() => this);
  pause = mock(() => this);

  pressKey(bytes: number[]): void {
    this.emit("data", Buffer.from(bytes));
  }
}

/**
 * Creates a mock LLMist client with configurable streaming behavior.
 *
 * @param chunks - Stream chunks to yield
 * @param options - Configuration options
 */
function createMockClient(
  chunks: StreamChunk[],
  options: {
    delayBetweenChunks?: number;
    shouldCheckAbort?: boolean;
  } = {},
): LLMist {
  const { delayBetweenChunks = 0, shouldCheckAbort = true } = options;

  return {
    stream: (streamOptions) => {
      async function* generator(): LLMStream {
        for (const chunk of chunks) {
          // Check abort signal before yielding
          if (shouldCheckAbort && streamOptions.signal?.aborted) {
            return;
          }

          yield chunk;

          // Allow microtasks to run (enables abort signal checking)
          if (delayBetweenChunks > 0) {
            await new Promise((r) => setTimeout(r, delayBetweenChunks));
          } else {
            await new Promise((r) => setTimeout(r, 0));
          }

          // Check abort signal after delay
          if (shouldCheckAbort && streamOptions.signal?.aborted) {
            return;
          }
        }
      }
      return generator();
    },
    countTokens: async () => 10,
    modelRegistry: {
      getModelSpec: () => ({
        maxOutputTokens: 4096,
        contextWindow: 128000,
      }),
      getModelLimits: () => ({
        maxOutputTokens: 4096,
        contextWindow: 128000,
      }),
      estimateCost: () => ({
        totalCost: 0.001,
        inputCost: 0.0005,
        outputCost: 0.0005,
      }),
    },
  } as unknown as LLMist;
}

/**
 * Creates a mock CLIEnvironment for testing.
 * Note: Uses isTTY=false by default to test piped mode (non-TUI).
 * TUI mode is tested separately with the TUI components.
 */
function createMockEnv(
  mockClient: LLMist,
  options: {
    isTTY?: boolean;
    stdin?: MockStdin;
  } = {},
): CLIEnvironment & {
  stdin: MockStdin;
  stdout: MockWritableStream;
  stderr: MockWritableStream;
} {
  const { isTTY = false, stdin = new MockStdin() } = options;
  stdin.isTTY = isTTY;

  const stdout = new MockWritableStream();
  const stderr = new MockWritableStream();

  return {
    argv: ["node", "llmist", "agent"],
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout,
    stderr,
    createClient: () => mockClient,
    setExitCode: mock(),
    createLogger: () => {
      const mockLogger: Record<string, unknown> = {
        silly: mock(),
        trace: mock(),
        debug: mock(),
        info: mock(),
        warn: mock(),
        error: mock(),
        fatal: mock(),
      };
      // getSubLogger returns the same mock logger
      mockLogger.getSubLogger = () => mockLogger;
      return mockLogger as never;
    },
    isTTY,
    prompt: mock(async () => "test input"),
  };
}

/**
 * Default options for agent command tests.
 */
const defaultOptions: CLIAgentOptions = {
  model: "test:mock-model",
  maxIterations: 1,
  builtins: false, // Disable built-in gadgets for simpler testing
  quiet: true, // Suppress non-essential output
};

describe("executeAgent piped mode", () => {
  describe("basic streaming", () => {
    test("streams text output to stdout in piped mode", async () => {
      const chunks: StreamChunk[] = [
        { text: "Hello " },
        { text: "world" },
        { text: "!", finishReason: "stop" },
      ];
      const mockClient = createMockClient(chunks);
      const env = createMockEnv(mockClient);

      await executeAgent("test prompt", defaultOptions, env);

      expect(env.stdout.output).toContain("Hello world!");
    });

    test("completes successfully with empty response", async () => {
      const chunks: StreamChunk[] = [{ text: "", finishReason: "stop" }];
      const mockClient = createMockClient(chunks);
      const env = createMockEnv(mockClient);

      await executeAgent("test prompt", defaultOptions, env);

      // Should complete without error
      expect(env.stderr.output).not.toContain("Error");
    });

    test("handles multiple chunks correctly", async () => {
      const chunks: StreamChunk[] = [
        { text: "Part 1, " },
        { text: "Part 2, " },
        { text: "Part 3" },
        { text: ".", finishReason: "stop" },
      ];
      const mockClient = createMockClient(chunks);
      const env = createMockEnv(mockClient);

      await executeAgent("test prompt", defaultOptions, env);

      expect(env.stdout.output).toBe("Part 1, Part 2, Part 3.");
    });
  });

  describe("SIGINT handling in piped mode", () => {
    let originalProcessOnce: typeof process.once;
    let originalProcessExit: typeof process.exit;
    let sigintHandler: (() => void) | null;
    let exitCode: number | undefined;
    let exitCalled: boolean;

    beforeEach(() => {
      originalProcessOnce = process.once;
      originalProcessExit = process.exit;
      sigintHandler = null;
      exitCode = undefined;
      exitCalled = false;

      // Capture SIGINT handler
      process.once = ((event: string, handler: () => void) => {
        if (event === "SIGINT") {
          sigintHandler = handler;
        }
        return process;
      }) as typeof process.once;

      // Mock process.exit
      process.exit = ((code?: number) => {
        exitCode = code;
        exitCalled = true;
        throw new Error("process.exit called");
      }) as typeof process.exit;
    });

    afterEach(() => {
      process.once = originalProcessOnce;
      process.exit = originalProcessExit;
    });

    test("registers SIGINT handler in piped mode", async () => {
      const chunks: StreamChunk[] = [{ text: "Response", finishReason: "stop" }];
      const mockClient = createMockClient(chunks);
      const env = createMockEnv(mockClient);

      await executeAgent("test prompt", defaultOptions, env);

      // SIGINT handler should be registered
      expect(sigintHandler).not.toBeNull();
    });

    test("SIGINT exits with code 130 in piped mode", async () => {
      const chunks: StreamChunk[] = [
        { text: "Response " },
        { text: "text", finishReason: "stop" },
      ];
      const mockClient = createMockClient(chunks, { delayBetweenChunks: 500 });
      const env = createMockEnv(mockClient);

      const promise = executeAgent("test prompt", defaultOptions, env);

      // Wait for SIGINT handler to be registered
      await new Promise((r) => setTimeout(r, 50));

      try {
        // Trigger SIGINT
        if (sigintHandler) {
          sigintHandler();
        }
        await promise;
      } catch (e) {
        // Expected: process.exit throws
        expect((e as Error).message).toBe("process.exit called");
      }

      expect(exitCalled).toBe(true);
      expect(exitCode).toBe(130);
    });
  });
});

describe("executeAgent with gadgets", () => {
  test("streams text output even when gadget calls are present", async () => {
    // Test that text output works alongside gadget calls
    // Note: Full gadget execution requires the complete agent machinery
    // which isn't available with the simplified mock client
    const chunks: StreamChunk[] = [
      { text: "Processing your request..." },
      {
        text: "",
        gadgetCalls: [
          {
            invocationId: "tell-1",
            gadgetName: "TellUser",
            parameters: { message: "Hello from gadget!", done: false, type: "info" },
            dependencies: [],
          },
        ],
      },
      { text: " Done!", finishReason: "stop" },
    ];
    const mockClient = createMockClient(chunks);
    const env = createMockEnv(mockClient);

    await executeAgent("test prompt", { ...defaultOptions, builtins: true }, env);

    // Text output should appear in stdout
    expect(env.stdout.output).toContain("Processing your request...");
    expect(env.stdout.output).toContain("Done!");
  });
});
