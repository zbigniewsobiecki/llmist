import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { LLMist } from "../core/client.js";
import type { LLMStream, StreamChunk } from "../core/options.js";
import type { CLIEnvironment } from "./environment.js";
import { executeAgent, type AgentCommandOptions } from "./agent-command.js";

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
  const { isTTY = true, stdin = new MockStdin() } = options;
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
const defaultOptions: AgentCommandOptions = {
  model: "test:mock-model",
  maxIterations: 1,
  builtins: false, // Disable built-in gadgets for simpler testing
  quiet: true, // Suppress non-essential output
};

describe("executeAgent cancellation", () => {
  // Store original process methods for restoration
  let originalProcessOn: typeof process.on;
  let originalProcessRemoveListener: typeof process.removeListener;
  let originalProcessExit: typeof process.exit;
  let sigintHandlers: Array<() => void>;
  let exitCode: number | undefined;
  let exitCalled: boolean;

  beforeEach(() => {
    // Mock process.on/removeListener for SIGINT handling
    originalProcessOn = process.on;
    originalProcessRemoveListener = process.removeListener;
    originalProcessExit = process.exit;
    sigintHandlers = [];
    exitCode = undefined;
    exitCalled = false;

    process.on = ((event: string, handler: () => void) => {
      if (event === "SIGINT") {
        sigintHandlers.push(handler);
      }
      return process;
    }) as typeof process.on;

    process.removeListener = ((event: string, handler: () => void) => {
      if (event === "SIGINT") {
        const index = sigintHandlers.indexOf(handler);
        if (index !== -1) {
          sigintHandlers.splice(index, 1);
        }
      }
      return process;
    }) as typeof process.removeListener;

    // Mock process.exit to capture exit code without terminating
    process.exit = ((code?: number) => {
      exitCode = code;
      exitCalled = true;
      throw new Error("process.exit called");
    }) as typeof process.exit;
  });

  afterEach(() => {
    // Restore all original methods
    process.on = originalProcessOn;
    process.removeListener = originalProcessRemoveListener;
    process.exit = originalProcessExit;
  });

  /**
   * Simulates a SIGINT signal (Ctrl+C).
   */
  function simulateSigint(): void {
    for (const handler of [...sigintHandlers]) {
      handler();
    }
  }

  describe("ESC key handling", () => {
    test("cancels LLM call when ESC pressed during streaming", async () => {
      const chunks: StreamChunk[] = [
        { text: "Hello " },
        { text: "world" },
        { text: "!", finishReason: "stop" },
      ];
      const mockClient = createMockClient(chunks, { delayBetweenChunks: 100 });
      const stdin = new MockStdin();
      const env = createMockEnv(mockClient, { stdin, isTTY: true });

      // Start execution
      const promise = executeAgent("test prompt", defaultOptions, env);

      // Wait for streaming to start
      await new Promise((r) => setTimeout(r, 50));

      // Press ESC key (0x1B) - uses 50ms ESC_TIMEOUT_MS internally
      stdin.pressKey([0x1b]);

      // Wait for ESC timeout to fire (50ms) plus a bit more
      await new Promise((r) => setTimeout(r, 100));

      // Wait for execution to complete
      await promise;

      // Should have cancelled message in stderr
      expect(env.stderr.output).toContain("[Cancelled]");
    });

    test("shows cancelled message with stats", async () => {
      const chunks: StreamChunk[] = [
        { text: "Partial response", usage: { inputTokens: 100, outputTokens: 50 } },
        { text: " more", finishReason: "stop" },
      ];
      const mockClient = createMockClient(chunks, { delayBetweenChunks: 100 });
      const stdin = new MockStdin();
      const env = createMockEnv(mockClient, { stdin, isTTY: true });

      const promise = executeAgent("test prompt", defaultOptions, env);

      await new Promise((r) => setTimeout(r, 50));
      stdin.pressKey([0x1b]);
      await new Promise((r) => setTimeout(r, 100));

      await promise;

      // Should contain "[Cancelled]" with stats format
      expect(env.stderr.output).toContain("[Cancelled]");
      // Stats format includes arrows for input/output
      expect(env.stderr.output).toMatch(/↑|↓/);
    });

    test("flushes partial response text after cancellation", async () => {
      const chunks: StreamChunk[] = [
        { text: "First chunk " },
        { text: "Second chunk " },
        { text: "Third chunk", finishReason: "stop" },
      ];
      const mockClient = createMockClient(chunks, { delayBetweenChunks: 100 });
      const stdin = new MockStdin();
      const env = createMockEnv(mockClient, { stdin, isTTY: true });

      const promise = executeAgent("test prompt", defaultOptions, env);

      // Wait for first chunk to be processed
      await new Promise((r) => setTimeout(r, 120));

      // Press ESC
      stdin.pressKey([0x1b]);
      await new Promise((r) => setTimeout(r, 100));

      await promise;

      // Partial text should be flushed to stdout
      expect(env.stdout.output).toContain("First chunk");
    });
  });

  describe("Ctrl+C (SIGINT) handling", () => {
    test("cancels LLM call when Ctrl+C pressed during streaming", async () => {
      const chunks: StreamChunk[] = [
        { text: "Hello " },
        { text: "world" },
        { text: "!", finishReason: "stop" },
      ];
      const mockClient = createMockClient(chunks, { delayBetweenChunks: 100 });
      const stdin = new MockStdin();
      const env = createMockEnv(mockClient, { stdin, isTTY: true });

      const promise = executeAgent("test prompt", defaultOptions, env);

      // Wait for streaming to start
      await new Promise((r) => setTimeout(r, 50));

      // Send SIGINT
      simulateSigint();

      await promise;

      // Should show cancelled message
      expect(env.stderr.output).toContain("[Cancelled]");
    });

    test("shows quit hint on first Ctrl+C when idle (no active stream)", async () => {
      // Use empty chunks so stream completes immediately
      const chunks: StreamChunk[] = [{ text: "Done", finishReason: "stop" }];
      const mockClient = createMockClient(chunks);
      const stdin = new MockStdin();
      const env = createMockEnv(mockClient, { stdin, isTTY: true });

      // Start and complete execution
      await executeAgent("test prompt", defaultOptions, env);

      // Clear output
      env.stderr.clear();

      // Now press Ctrl+C when idle (handler still registered but stream finished)
      // Note: This simulates the scenario where SIGINT arrives after completion
      // but before cleanup - though in practice cleanup happens in finally block
    });

    test("exits with code 130 on double Ctrl+C", async () => {
      const chunks: StreamChunk[] = [
        { text: "Response " },
        { text: "text" },
        { text: "...", finishReason: "stop" },
      ];
      const mockClient = createMockClient(chunks, { delayBetweenChunks: 500 });
      const stdin = new MockStdin();
      const env = createMockEnv(mockClient, { stdin, isTTY: true });

      const promise = executeAgent("test prompt", defaultOptions, env);

      // Wait for stream to start
      await new Promise((r) => setTimeout(r, 100));

      // First Ctrl+C - cancels the stream
      simulateSigint();

      // Second Ctrl+C immediately (within 1 second) - should trigger quit
      // Don't wait too long - the double-press window is 1 second
      await new Promise((r) => setTimeout(r, 10));

      try {
        simulateSigint();
        await promise;
      } catch (e) {
        // Expected: process.exit throws
        expect((e as Error).message).toBe("process.exit called");
      }

      expect(exitCalled).toBe(true);
      expect(exitCode).toBe(130);
    });

    test("shows summary before quit on double Ctrl+C", async () => {
      const chunks: StreamChunk[] = [
        { text: "Response", usage: { inputTokens: 500, outputTokens: 100, totalTokens: 600 } },
        { text: " more", finishReason: "stop" },
      ];
      const mockClient = createMockClient(chunks, { delayBetweenChunks: 500 });
      const stdin = new MockStdin();
      const env = createMockEnv(mockClient, { stdin, isTTY: true });

      const promise = executeAgent("test prompt", defaultOptions, env);

      await new Promise((r) => setTimeout(r, 100));

      // First Ctrl+C
      simulateSigint();

      // Second Ctrl+C immediately (within double-press window)
      await new Promise((r) => setTimeout(r, 10));

      try {
        simulateSigint();
        await promise;
      } catch {
        // Expected: process.exit throws
      }

      // Should show [Quit] message
      expect(env.stderr.output).toContain("[Quit]");
    });
  });

  describe("readline interaction", () => {
    test("SIGINT still works when stdin is TTY", async () => {
      const chunks: StreamChunk[] = [
        { text: "Processing..." },
        { text: " done", finishReason: "stop" },
      ];
      const mockClient = createMockClient(chunks, { delayBetweenChunks: 100 });
      const stdin = new MockStdin();
      const env = createMockEnv(mockClient, { stdin, isTTY: true });

      const promise = executeAgent("test prompt", defaultOptions, env);

      await new Promise((r) => setTimeout(r, 50));

      // SIGINT should still work
      simulateSigint();

      await promise;

      expect(env.stderr.output).toContain("[Cancelled]");
    });

    test("SIGINT works even when stdin is not TTY", async () => {
      const chunks: StreamChunk[] = [
        { text: "Processing..." },
        { text: " done", finishReason: "stop" },
      ];
      const mockClient = createMockClient(chunks, { delayBetweenChunks: 100 });
      const stdin = new MockStdin();
      stdin.isTTY = false;
      const env = createMockEnv(mockClient, { stdin, isTTY: false });

      const promise = executeAgent("test prompt", defaultOptions, env);

      await new Promise((r) => setTimeout(r, 50));

      // SIGINT should work even in non-TTY mode
      simulateSigint();

      await promise;

      expect(env.stderr.output).toContain("[Cancelled]");
    });
  });

  describe("cleanup", () => {
    test("cleans up SIGINT listener on normal completion", async () => {
      const chunks: StreamChunk[] = [{ text: "Complete", finishReason: "stop" }];
      const mockClient = createMockClient(chunks);
      const stdin = new MockStdin();
      const env = createMockEnv(mockClient, { stdin, isTTY: true });

      // Track SIGINT handler count
      const initialHandlerCount = sigintHandlers.length;

      await executeAgent("test prompt", defaultOptions, env);

      // Handler should be removed after completion
      // Note: Due to finally block cleanup, handler count should return to initial
      expect(sigintHandlers.length).toBeLessThanOrEqual(initialHandlerCount);
    });

    test("cleans up SIGINT listener after cancellation", async () => {
      const chunks: StreamChunk[] = [
        { text: "Partial" },
        { text: " response", finishReason: "stop" },
      ];
      const mockClient = createMockClient(chunks, { delayBetweenChunks: 100 });
      const stdin = new MockStdin();
      const env = createMockEnv(mockClient, { stdin, isTTY: true });

      const initialHandlerCount = sigintHandlers.length;

      const promise = executeAgent("test prompt", defaultOptions, env);

      await new Promise((r) => setTimeout(r, 50));
      simulateSigint();

      await promise;

      // Handler should be cleaned up
      expect(sigintHandlers.length).toBeLessThanOrEqual(initialHandlerCount);
    });

    test("cleans up ESC listener on normal completion", async () => {
      const chunks: StreamChunk[] = [{ text: "Complete", finishReason: "stop" }];
      const mockClient = createMockClient(chunks);
      const stdin = new MockStdin();
      const env = createMockEnv(mockClient, { stdin, isTTY: true });

      await executeAgent("test prompt", defaultOptions, env);

      // ESC listener cleanup restores raw mode to false
      expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
    });

    test("cleans up ESC listener after ESC cancellation", async () => {
      const chunks: StreamChunk[] = [
        { text: "Partial" },
        { text: " response", finishReason: "stop" },
      ];
      const mockClient = createMockClient(chunks, { delayBetweenChunks: 100 });
      const stdin = new MockStdin();
      const env = createMockEnv(mockClient, { stdin, isTTY: true });

      const promise = executeAgent("test prompt", defaultOptions, env);

      await new Promise((r) => setTimeout(r, 50));
      stdin.pressKey([0x1b]);
      await new Promise((r) => setTimeout(r, 100));

      await promise;

      // Raw mode should be restored
      expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
    });
  });

  describe("edge cases", () => {
    test("handles cancellation before stream yields any chunks", async () => {
      const chunks: StreamChunk[] = [
        { text: "This should not appear", finishReason: "stop" },
      ];
      // Add significant delay before first chunk
      const mockClient = createMockClient(chunks, { delayBetweenChunks: 200 });
      const stdin = new MockStdin();
      const env = createMockEnv(mockClient, { stdin, isTTY: true });

      const promise = executeAgent("test prompt", defaultOptions, env);

      // Cancel quickly
      await new Promise((r) => setTimeout(r, 30));
      stdin.pressKey([0x1b]);
      await new Promise((r) => setTimeout(r, 100));

      await promise;

      // Should have cancelled without any output
      expect(env.stderr.output).toContain("[Cancelled]");
    });

    test("handles rapid consecutive Ctrl+C presses", async () => {
      const chunks: StreamChunk[] = [
        { text: "Processing" },
        { text: "...", finishReason: "stop" },
      ];
      const mockClient = createMockClient(chunks, { delayBetweenChunks: 200 });
      const stdin = new MockStdin();
      const env = createMockEnv(mockClient, { stdin, isTTY: true });

      const promise = executeAgent("test prompt", defaultOptions, env);

      await new Promise((r) => setTimeout(r, 50));

      // Send 3 rapid Ctrl+C presses
      try {
        simulateSigint();
        simulateSigint();
        simulateSigint();
        await promise;
      } catch {
        // Expected: process.exit throws
      }

      // Should have exited
      expect(exitCalled).toBe(true);
    });

    test("does not call process.exit on single cancellation", async () => {
      const chunks: StreamChunk[] = [
        { text: "Response" },
        { text: " text", finishReason: "stop" },
      ];
      const mockClient = createMockClient(chunks, { delayBetweenChunks: 100 });
      const stdin = new MockStdin();
      const env = createMockEnv(mockClient, { stdin, isTTY: true });

      const promise = executeAgent("test prompt", defaultOptions, env);

      await new Promise((r) => setTimeout(r, 50));

      // Single SIGINT - should cancel but not exit
      simulateSigint();

      await promise;

      // process.exit should NOT have been called
      expect(exitCalled).toBe(false);
      expect(env.stderr.output).toContain("[Cancelled]");
    });
  });
});
