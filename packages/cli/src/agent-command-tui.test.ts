import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { createMockTUIApp } from "@llmist/testing";
import type { LLMist, StreamChunk } from "llmist";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { executeAgent } from "./agent-command.js";
import { loadConfig } from "./config.js";
import type { CLIAgentOptions } from "./option-helpers.js";
import { TUIApp } from "./tui/index.js";

vi.mock("./tui/index.js", () => ({
  TUIApp: {
    create: vi.fn(),
  },
  StatusBar: {
    estimateTokens: vi.fn(() => 10),
  },
}));

vi.mock("./config.js", async (importOriginal) => {
  const mod = await importOriginal<any>();
  return {
    ...mod,
    loadConfig: vi.fn(),
  };
});

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
}

class MockStdin extends EventEmitter {
  isTTY = true;
  setRawMode = vi.fn().mockReturnThis();
  resume = vi.fn().mockReturnThis();
  pause = vi.fn().mockReturnThis();
}

function createMockClient(): LLMist {
  return {
    stream: async function* () {
      yield { text: "TUI response", finishReason: "stop" } as StreamChunk;
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

function createMockEnv(mockClient: LLMist, options: { isTTY?: boolean } = {}): any {
  const { isTTY = false } = options;
  const stdin = new MockStdin();
  stdin.isTTY = isTTY;

  const stdout = new MockWritableStream(isTTY);
  const stderr = new MockWritableStream(isTTY);

  return {
    argv: ["node", "llmist", "agent"],
    stdin,
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
  quiet: false,
  builtinInteraction: true,
};

describe("executeAgent TUI Mode Initialization and REPL", () => {
  let originalProcessExit: typeof process.exit;
  let exitCode: number | undefined;

  beforeEach(() => {
    originalProcessExit = process.exit;
    exitCode = undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`process.exit called with ${code}`);
    }) as any;

    vi.mocked(loadConfig).mockReturnValue({
      coding: { model: "gpt-4" },
      writing: { model: "claude-3" },
    } as any);
  });

  afterEach(() => {
    process.exit = originalProcessExit;
    vi.restoreAllMocks();
  });

  test("initializes TUIApp with correct options when stdin/stdout are TTY", async () => {
    const mockClient = createMockClient();
    const mockTUI = createMockTUIApp();
    vi.mocked(TUIApp.create).mockResolvedValue(mockTUI as any);

    mockTUI.waitForPrompt.mockImplementationOnce(async () => {
      const error = new Error("Abort");
      (error as any).name = "AbortError";
      throw error;
    });

    const env = createMockEnv(mockClient, { isTTY: true });

    await expect(executeAgent("tui prompt", defaultOptions, env)).rejects.toThrow();

    expect(TUIApp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: defaultOptions.model,
        stdin: env.stdin,
        stdout: env.stdout,
      }),
    );
  });

  test("loads and sets profiles from config in TUI mode", async () => {
    const mockClient = createMockClient();
    const mockTUI = createMockTUIApp();
    vi.mocked(TUIApp.create).mockResolvedValue(mockTUI as any);

    mockTUI.waitForPrompt.mockImplementationOnce(async () => {
      const error = new Error("Abort");
      (error as any).name = "AbortError";
      throw error;
    });

    const env = createMockEnv(mockClient, { isTTY: true });

    await expect(executeAgent("tui prompt", defaultOptions, env, "agent")).rejects.toThrow();

    expect(mockTUI.setProfiles).toHaveBeenCalledWith(["agent", "coding", "writing"], "agent");
  });

  test("REPL loop waits for user prompts via tui.waitForPrompt()", async () => {
    const mockClient = createMockClient();
    const mockTUI = createMockTUIApp();
    vi.mocked(TUIApp.create).mockResolvedValue(mockTUI as any);

    mockTUI.waitForPrompt
      .mockImplementationOnce(async () => "first prompt")
      .mockImplementationOnce(async () => {
        const error = new Error("Abort");
        (error as any).name = "AbortError";
        throw error;
      });

    const env = createMockEnv(mockClient, { isTTY: true });

    await expect(executeAgent("tui prompt", defaultOptions, env)).rejects.toThrow();

    expect(mockTUI.waitForPrompt).toHaveBeenCalledTimes(2);
  });

  test("tui.destroy() is called on exit", async () => {
    const mockClient = createMockClient();
    const mockTUI = createMockTUIApp();
    vi.mocked(TUIApp.create).mockResolvedValue(mockTUI as any);

    mockTUI.waitForPrompt.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const error = new Error("Abort");
      (error as any).name = "AbortError";
      throw error;
    });

    const env = createMockEnv(mockClient, { isTTY: true });

    let quitHandler: (() => void) | undefined;
    mockTUI.onQuit.mockImplementation((handler: () => void) => {
      quitHandler = handler;
    });

    const agentPromise = executeAgent("tui prompt", defaultOptions, env);
    // Immediately catch to avoid unhandled rejection
    agentPromise.catch(() => {});

    await new Promise((r) => setTimeout(r, 20));

    if (quitHandler) {
      try {
        quitHandler();
      } catch (e: any) {
        if (!e.message.includes("process.exit called")) throw e;
      }
    }

    expect(mockTUI.destroy).toHaveBeenCalled();
    expect(exitCode).toBe(130);

    // Ensure the promise is settled
    await agentPromise.catch(() => {});
  });
});
