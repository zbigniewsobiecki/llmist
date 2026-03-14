import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { createMockTUIApp } from "@llmist/testing";
import { AgentBuilder, type LLMist, type LLMStream, type StreamChunk } from "llmist";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { executeAgent } from "./agent-command.js";
import type { CLIEnvironment } from "./environment.js";
import { readSystemPromptFile } from "./file-utils.js";
import type { CLIAgentOptions } from "./option-helpers.js";
import { TUIApp } from "./tui/index.js";

vi.mock("./file-utils.js", () => ({
  readSystemPromptFile: vi.fn(),
  readImageFile: vi.fn(),
  readAudioFile: vi.fn(),
}));

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
  builtinInteraction: false,
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
      const chunks: StreamChunk[] = [{ text: "Response " }, { text: "text", finishReason: "stop" }];
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

describe("executeAgent configuration mapping", () => {
  beforeEach(() => {
    vi.spyOn(AgentBuilder.prototype, "withSystem").mockReturnThis();
    vi.spyOn(AgentBuilder.prototype, "withReasoning").mockReturnThis();
    vi.spyOn(AgentBuilder.prototype, "withoutReasoning").mockReturnThis();
  });

  test("--system-file content is correctly passed to AgentBuilder.withSystem()", async () => {
    const systemContent = "You are a helpful assistant from a file.";
    vi.mocked(readSystemPromptFile).mockResolvedValue(systemContent);

    const options: CLIAgentOptions = {
      ...defaultOptions,
      systemFile: "system.txt",
    };

    const mockClient = createMockClient([{ text: "Response", finishReason: "stop" }]);
    const env = createMockEnv(mockClient);

    await executeAgent("test prompt", options, env);

    expect(readSystemPromptFile).toHaveBeenCalledWith("system.txt");
    expect(AgentBuilder.prototype.withSystem).toHaveBeenCalledWith(systemContent);
  });

  test("--reasoning effort is correctly passed to AgentBuilder.withReasoning()", async () => {
    const options: CLIAgentOptions = {
      ...defaultOptions,
      reasoning: "high",
    };

    const mockClient = createMockClient([{ text: "Response", finishReason: "stop" }]);
    const env = createMockEnv(mockClient);

    await executeAgent("test prompt", options, env);

    expect(AgentBuilder.prototype.withReasoning).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        effort: "high",
      }),
    );
  });

  test("--reasoning-budget is correctly passed to AgentBuilder.withReasoning()", async () => {
    const options: CLIAgentOptions = {
      ...defaultOptions,
      reasoningBudget: 1000,
    };

    const mockClient = createMockClient([{ text: "Response", finishReason: "stop" }]);
    const env = createMockEnv(mockClient);

    await executeAgent("test prompt", options, env);

    expect(AgentBuilder.prototype.withReasoning).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        budgetTokens: 1000,
      }),
    );
  });

  test("both --reasoning and --reasoning-budget are correctly passed together", async () => {
    const options: CLIAgentOptions = {
      ...defaultOptions,
      reasoning: "low",
      reasoningBudget: 500,
    };

    const mockClient = createMockClient([{ text: "Response", finishReason: "stop" }]);
    const env = createMockEnv(mockClient);

    await executeAgent("test prompt", options, env);

    expect(AgentBuilder.prototype.withReasoning).toHaveBeenCalledWith({
      enabled: true,
      effort: "low",
      budgetTokens: 500,
    });
  });

  test("--no-reasoning correctly calls builder.withoutReasoning()", async () => {
    const options: CLIAgentOptions = {
      ...defaultOptions,
      reasoning: false,
    };

    const mockClient = createMockClient([{ text: "Response", finishReason: "stop" }]);
    const env = createMockEnv(mockClient);

    await executeAgent("test prompt", options, env);

    expect(AgentBuilder.prototype.withoutReasoning).toHaveBeenCalled();
  });
});
