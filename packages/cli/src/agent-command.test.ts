import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { createMockTUIApp } from "@llmist/testing";
import type { LLMist, LLMStream, StreamChunk } from "llmist";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type CLIAgentOptions, executeAgent } from "./agent-command.js";
import type { CLIEnvironment } from "./environment.js";
import { TUIApp } from "./tui/index.js";

vi.mock("./tui/index.js", () => ({
  TUIApp: {
    create: vi.fn(),
  },
  StatusBar: {
    estimateTokens: vi.fn(() => 10),
  },
}));

/**
 * Mock writable stream that captures all output.
 */
class MockWritableStream extends Writable {
  public output = "";
  public isTTY = false;

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
 * Mock stdin that simulates keyboard input and TTY capabilities.
 */
class MockStdin extends EventEmitter {
  isTTY = true;
  setRawMode = vi.fn(() => this);
  resume = vi.fn(() => this);
  pause = vi.fn(() => this);

  pressKey(bytes: number[]): void {
    this.emit("data", Buffer.from(bytes));
  }
}

/**
 * Creates a mock LLMist client with configurable streaming behavior.
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
          if (shouldCheckAbort && streamOptions.signal?.aborted) {
            return;
          }

          yield chunk;

          if (delayBetweenChunks > 0) {
            await new Promise((r) => setTimeout(r, delayBetweenChunks));
          } else {
            await new Promise((r) => setTimeout(r, 0));
          }

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
    getTree: () => ({
      subscribe: vi.fn(() => () => {}),
    }),
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
  const { isTTY = false, stdin = new MockStdin() } = options;
  stdin.isTTY = isTTY;

  const stdout = new MockWritableStream(isTTY);
  const stderr = new MockWritableStream(isTTY);

  return {
    argv: ["node", "llmist", "agent"],
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout,
    stderr,
    createClient: () => mockClient,
    setExitCode: vi.fn(),
    createLogger: () => {
      const mockLogger: any = {
        silly: vi.fn(),
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
      };
      mockLogger.getSubLogger = () => mockLogger;
      return mockLogger;
    },
    isTTY,
    prompt: vi.fn(async () => "test input"),
  };
}

const defaultOptions: CLIAgentOptions = {
  model: "test:mock-model",
  maxIterations: 1,
  builtins: false,
  quiet: true,
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
  });
});

describe("executeAgent TUI mode", () => {
  test("initializes TUI when isTTY=true", async () => {
    const chunks: StreamChunk[] = [{ text: "TUI response", finishReason: "stop" }];
    const mockClient = createMockClient(chunks);
    const mockTUI = createMockTUIApp();
    vi.mocked(TUIApp.create).mockResolvedValue(mockTUI as any);

    const env = createMockEnv(mockClient, { isTTY: true });

    // Mock prompt resolver to avoid hanging
    try {
      await executeAgent("tui prompt", { ...defaultOptions, quiet: false }, env);
    } catch (e: any) {
      if (e.name !== "AbortError") throw e;
    }

    expect(TUIApp.create).toHaveBeenCalled();
    expect(mockTUI.subscribeToTree).toHaveBeenCalled();
    expect(mockTUI.handleEvent).toHaveBeenCalled();
  });
});
