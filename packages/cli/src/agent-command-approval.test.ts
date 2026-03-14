import { createMockClient, createMockTUIApp, mockLLM, resetMocks } from "@llmist/testing";
import { AgentBuilder, createGadget, type LLMist, type StreamChunk } from "llmist";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { executeAgent } from "./agent-command.js";
import type { CLIEnvironment } from "./environment.js";
import { loadGadgets } from "./gadgets.js";
import type { CLIAgentOptions } from "./option-helpers.js";
import { TUIApp } from "./tui/index.js";
import * as utils from "./utils.js";

vi.mock("./tui/index.js", () => ({
  TUIApp: {
    create: vi.fn(),
  },
  StatusBar: {
    estimateTokens: vi.fn(() => 10),
  },
}));

vi.mock("./utils.js", async () => {
  const actual = await vi.importActual("./utils.js");
  return {
    ...(actual as any),
    isInteractive: vi.fn(),
    resolvePrompt: vi.fn(async (p) => p || "test prompt"),
  };
});

// Mock writable stream
class MockWritableStream {
  public output = "";
  public isTTY = false;
  constructor(isTTY = false) {
    this.isTTY = isTTY;
  }
  write(chunk: any) {
    this.output += chunk.toString();
    return true;
  }
  end() {}
}

function createMockEnv(mockClient: LLMist, isTTY = false): CLIEnvironment {
  const stdout = new MockWritableStream(isTTY);
  const stderr = new MockWritableStream(isTTY);
  return {
    argv: ["node", "llmist", "agent"],
    stdin: { isTTY } as any,
    stdout: stdout as any,
    stderr: stderr as any,
    createClient: () => mockClient,
    setExitCode: vi.fn(),
    createLogger: () =>
      ({
        silly: vi.fn(),
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        getSubLogger: function () {
          return this;
        },
      }) as any,
    isTTY,
    prompt: vi.fn(async () => "test response"),
  };
}

const defaultOptions: CLIAgentOptions = {
  model: "mock:test-model",
  maxIterations: 2,
  builtins: false,
  builtinInteraction: false,
  quiet: true,
};

// We need to mock loadGadgets to return our mock gadgets
vi.mock("./gadgets.js", () => ({
  loadGadgets: vi.fn(async () => [
    createGadget({
      name: "RunCommand",
      description: "Run a command",
      schema: z.object({ command: z.string() }),
      execute: async () => "success",
    }),
    createGadget({
      name: "DeleteFile",
      description: "Delete a file",
      schema: z.object({ filePath: z.string() }),
      execute: async () => "success",
    }),
  ]),
}));

describe("executeAgent approval logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  test("piped mode: auto-denies dangerous gadgets", async () => {
    const executeSpy = vi.fn().mockResolvedValue("success");
    vi.mocked(loadGadgets).mockResolvedValueOnce([
      createGadget({
        name: "RunCommand",
        description: "Run a command",
        schema: z.object({ command: z.string() }),
        execute: executeSpy,
      }),
    ]);

    mockLLM()
      .forModel("test-model")
      .returnsGadgetCall("RunCommand", { command: "rm -rf /" })
      .register();

    const mockClient = createMockClient();
    vi.mocked(utils.isInteractive).mockReturnValue(false);
    const env = createMockEnv(mockClient, false);

    await executeAgent("test prompt", { ...defaultOptions, gadget: ["mock-path"] }, env);

    expect(executeSpy).not.toHaveBeenCalled();
    expect(TUIApp.create).not.toHaveBeenCalled();
  });

  test("TUI mode: persists 'always' response", async () => {
    mockLLM()
      .forModel("test-model")
      .returnsGadgetCall("RunCommand", { command: "ls" })
      .returnsGadgetCall("RunCommand", { command: "pwd" })
      .register();

    const mockClient = createMockClient();
    const mockTui = createMockTUIApp();
    vi.mocked(TUIApp.create).mockResolvedValue(mockTui as any);
    vi.mocked(utils.isInteractive).mockReturnValue(true);

    const env = createMockEnv(mockClient, true);
    (env.stdout as any).isTTY = true;
    (env.stderr as any).isTTY = true;

    // First call returns "always"
    mockTui.showApproval.mockResolvedValueOnce("always");

    try {
      await executeAgent(
        "test prompt",
        { ...defaultOptions, quiet: false, gadget: ["mock-path"] },
        env,
      );
    } catch (e: any) {
      if (e.name !== "AbortError") throw e;
    }

    // Should only be called once even though there are two gadget calls
    expect(mockTui.showApproval).toHaveBeenCalledTimes(1);
  });

  test("TUI mode: calls tui.showApproval for dangerous gadgets", async () => {
    mockLLM().forModel("test-model").returnsGadgetCall("RunCommand", { command: "ls" }).register();

    const mockClient = createMockClient();
    const mockTui = createMockTUIApp();
    vi.mocked(TUIApp.create).mockResolvedValue(mockTui as any);
    vi.mocked(utils.isInteractive).mockReturnValue(true);

    const env = createMockEnv(mockClient, true);
    (env.stdout as any).isTTY = true;
    (env.stderr as any).isTTY = true;

    mockTui.showApproval.mockResolvedValue("yes");

    try {
      await executeAgent(
        "test prompt",
        { ...defaultOptions, quiet: false, gadget: ["mock-path"] },
        env,
      );
    } catch (e: any) {
      if (e.name !== "AbortError") throw e;
    }

    expect(TUIApp.create).toHaveBeenCalled();
    expect(mockTui.showApproval).toHaveBeenCalled();
  });

  test("Config overrides: respects gadgetApproval record", async () => {
    mockLLM().forModel("test-model").returnsGadgetCall("RunCommand", { command: "ls" }).register();

    const mockClient = createMockClient();
    vi.mocked(utils.isInteractive).mockReturnValue(true);
    const env = createMockEnv(mockClient, true);
    (env.stdout as any).isTTY = true;
    (env.stderr as any).isTTY = true;

    const mockTui = createMockTUIApp();
    vi.mocked(TUIApp.create).mockResolvedValue(mockTui as any);

    const optionsWithOverride = {
      ...defaultOptions,
      quiet: false,
      gadget: ["mock-path"],
      gadgetApproval: { RunCommand: "allowed" as const },
    };

    try {
      await executeAgent("test prompt", optionsWithOverride, env);
    } catch (e: any) {
      if (e.name !== "AbortError") throw e;
    }

    expect(mockTui.showApproval).not.toHaveBeenCalled();
  });

  test("TUI mode: handles DeleteFile as dangerous", async () => {
    mockLLM()
      .forModel("test-model")
      .returnsGadgetCall("DeleteFile", { filePath: "test.txt" })
      .register();

    const mockClient = createMockClient();
    const mockTui = createMockTUIApp();
    vi.mocked(TUIApp.create).mockResolvedValue(mockTui as any);
    vi.mocked(utils.isInteractive).mockReturnValue(true);

    const env = createMockEnv(mockClient, true);
    (env.stdout as any).isTTY = true;
    (env.stderr as any).isTTY = true;

    mockTui.showApproval.mockResolvedValue("yes");

    try {
      await executeAgent(
        "test prompt",
        { ...defaultOptions, quiet: false, gadget: ["mock-path"] },
        env,
      );
    } catch (e: any) {
      if (e.name !== "AbortError") throw e;
    }

    expect(mockTui.showApproval).toHaveBeenCalled();
  });
});
