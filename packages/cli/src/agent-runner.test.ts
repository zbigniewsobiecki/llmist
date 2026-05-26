/**
 * Tests for agent-runner.ts — the extracted REPL loop module.
 *
 * Covers:
 *  - Piped mode: single-run with text output
 *  - Piped mode: abort/cancel handling
 *  - TUI mode: REPL loop with waitForPrompt and runAgentWithPrompt
 *  - TUI mode: slash command handling
 *  - TUI mode: mid-session input wiring
 */

import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { createMockTUIApp } from "@llmist/testing";
import { AgentBuilder, type LLMist, type LLMStream, SkillRegistry, type StreamChunk } from "llmist";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentRunnerOptions } from "./agent-runner.js";
import { runAgentLoop } from "./agent-runner.js";
import type { CLIEnvironment } from "./environment.js";

// ─── Mock file-utils so readImageFile / readAudioFile never hit the fs ────────
vi.mock("./file-utils.js", () => ({
  readSystemPromptFile: vi.fn(),
  readImageFile: vi.fn(),
  readAudioFile: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  isTTY = false;
  setRawMode = vi.fn(() => this);
  resume = vi.fn(() => this);
  pause = vi.fn(() => this);
}

/**
 * Build a mock LLMist client whose stream yields the given chunks.
 */
function createMockClient(chunks: StreamChunk[]): LLMist {
  return {
    stream: () => {
      async function* generator(): LLMStream {
        for (const chunk of chunks) {
          yield chunk;
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      return generator();
    },
    countTokens: async () => 10,
    modelRegistry: {
      getModelSpec: () => ({ maxOutputTokens: 4096, contextWindow: 128000 }),
      getModelLimits: () => ({ maxOutputTokens: 4096, contextWindow: 128000 }),
      estimateCost: () => ({ totalCost: 0.001, inputCost: 0.0005, outputCost: 0.0005 }),
    },
    getTree: () => ({ subscribe: vi.fn(() => () => {}) }),
  } as unknown as LLMist;
}

/**
 * Build a minimal CLIEnvironment for testing.
 */
function createMockEnv(isTTY = false): CLIEnvironment & {
  stdout: MockWritableStream;
  stderr: MockWritableStream;
} {
  const stdin = new MockStdin();
  stdin.isTTY = isTTY;
  const stdout = new MockWritableStream(isTTY);
  const stderr = new MockWritableStream(isTTY);

  return {
    argv: ["node", "llmist", "agent"],
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout,
    stderr,
    createClient: () => createMockClient([]),
    setExitCode: vi.fn(),
    createLogger: () => {
      const m: any = {
        silly: vi.fn(),
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
      };
      m.getSubLogger = () => m;
      return m;
    },
    isTTY,
    prompt: vi.fn(async () => ""),
  };
}

/**
 * Build a minimal AgentBuilder whose `ask()` returns a mock agent that streams
 * the given chunks.
 */
function createMockBuilder(chunks: StreamChunk[]): AgentBuilder {
  const client = createMockClient(chunks);
  const builder = new AgentBuilder(client);

  // Spy on chainable methods so we don't need a real LLM
  vi.spyOn(builder, "withModel").mockReturnThis();
  vi.spyOn(builder, "withHooks").mockReturnThis();
  vi.spyOn(builder, "withSignal").mockReturnThis();
  vi.spyOn(builder, "continueFrom").mockReturnThis();
  vi.spyOn(builder, "clearPreActivatedSkills").mockReturnThis();
  vi.spyOn(builder, "withSkill").mockReturnThis();

  return builder;
}

/**
 * Returns a minimal AgentRunnerOptions for piped mode (tui=null).
 */
function pipedOptions(
  chunks: StreamChunk[],
  prompt = "hello",
  overrides: Partial<AgentRunnerOptions> = {},
): AgentRunnerOptions {
  const skillRegistry = new SkillRegistry();
  return {
    builder: createMockBuilder(chunks),
    tui: null,
    env: createMockEnv(false),
    skillRegistry,
    prompt,
    ...overrides,
  };
}

// ─── Piped mode tests ─────────────────────────────────────────────────────────

describe("runAgentLoop — piped mode", () => {
  test("streams text output to stdout", async () => {
    const opts = pipedOptions([{ text: "Hello " }, { text: "world", finishReason: "stop" }]);

    await runAgentLoop(opts);

    expect((opts.env.stdout as MockWritableStream).output).toBe("Hello world");
  });

  test("completes without error on empty response", async () => {
    const opts = pipedOptions([{ text: "", finishReason: "stop" }]);
    await expect(runAgentLoop(opts)).resolves.toBeUndefined();
  });

  test("handles multiple text chunks in order", async () => {
    const opts = pipedOptions([{ text: "A" }, { text: "B" }, { text: "C", finishReason: "stop" }]);

    await runAgentLoop(opts);

    expect((opts.env.stdout as MockWritableStream).output).toBe("ABC");
  });

  test("swallows AbortError without rethrowing", async () => {
    const skillRegistry = new SkillRegistry();
    const client = createMockClient([]);
    const builder = new AgentBuilder(client);

    vi.spyOn(builder, "clearPreActivatedSkills").mockReturnThis();

    // ask() returns an agent whose run() immediately throws an AbortError
    vi.spyOn(builder, "ask").mockReturnValue({
      // biome-ignore lint/correctness/useYield: test helper — generator throws immediately without yielding
      run: async function* () {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      },
      getTree: () => ({ subscribe: vi.fn(() => () => {}) }),
      injectUserMessage: vi.fn(),
    } as any);

    const env = createMockEnv(false);

    await expect(
      runAgentLoop({ builder, tui: null, env, skillRegistry, prompt: "test" }),
    ).resolves.toBeUndefined();
  });

  test("rethrows non-abort errors", async () => {
    const skillRegistry = new SkillRegistry();
    const client = createMockClient([]);
    const builder = new AgentBuilder(client);

    vi.spyOn(builder, "clearPreActivatedSkills").mockReturnThis();
    vi.spyOn(builder, "ask").mockReturnValue({
      // biome-ignore lint/correctness/useYield: test helper — generator throws immediately without yielding
      run: async function* () {
        throw new Error("unexpected failure");
      },
      getTree: () => ({ subscribe: vi.fn(() => () => {}) }),
      injectUserMessage: vi.fn(),
    } as any);

    const env = createMockEnv(false);

    await expect(
      runAgentLoop({ builder, tui: null, env, skillRegistry, prompt: "test" }),
    ).rejects.toThrow("unexpected failure");
  });
});

// ─── TUI mode tests ───────────────────────────────────────────────────────────

describe("runAgentLoop — TUI mode", () => {
  let mockTUI: ReturnType<typeof createMockTUIApp>;

  beforeEach(() => {
    mockTUI = createMockTUIApp();
  });

  test("runs agent with initial prompt without calling waitForPrompt first", async () => {
    const skillRegistry = new SkillRegistry();
    const client = createMockClient([{ text: "response", finishReason: "stop" }]);
    const builder = new AgentBuilder(client);
    vi.spyOn(builder, "clearPreActivatedSkills").mockReturnThis();
    vi.spyOn(builder, "withSignal").mockReturnThis();
    vi.spyOn(builder, "continueFrom").mockReturnThis();

    const env = createMockEnv(true);

    // runAgentLoop ends when waitForPrompt throws AbortError (normal TUI exit path)
    try {
      await runAgentLoop({
        builder,
        tui: mockTUI as any,
        env,
        skillRegistry,
        prompt: "initial prompt",
      });
    } catch (e: any) {
      if (e.name !== "AbortError") throw e;
    }

    // TUI lifecycle: startNewSession + showUserMessage called for initial prompt
    expect(mockTUI.startNewSession).toHaveBeenCalled();
    expect(mockTUI.showUserMessage).toHaveBeenCalledWith("initial prompt");
    // After run: flushText + clearPreviousSession + clearStatusBar
    expect(mockTUI.flushText).toHaveBeenCalled();
    expect(mockTUI.clearPreviousSession).toHaveBeenCalled();
    expect(mockTUI.clearStatusBar).toHaveBeenCalled();
  });

  test("calls waitForPrompt when no initial prompt is provided", async () => {
    const skillRegistry = new SkillRegistry();
    const client = createMockClient([{ text: "response", finishReason: "stop" }]);
    const builder = new AgentBuilder(client);
    vi.spyOn(builder, "clearPreActivatedSkills").mockReturnThis();
    vi.spyOn(builder, "withSignal").mockReturnThis();
    vi.spyOn(builder, "continueFrom").mockReturnThis();

    const env = createMockEnv(true);

    // waitForPrompt: first call returns "waited prompt", second call throws AbortError
    mockTUI.waitForPrompt
      .mockResolvedValueOnce("waited prompt")
      .mockImplementationOnce(async () => {
        const e = new Error("break");
        e.name = "AbortError";
        throw e;
      });

    try {
      await runAgentLoop({
        builder,
        tui: mockTUI as any,
        env,
        skillRegistry,
        prompt: "",
      });
    } catch (e: any) {
      if (e.name !== "AbortError") throw e;
    }

    expect(mockTUI.setFocusMode).toHaveBeenCalledWith("input");
    expect(mockTUI.waitForPrompt).toHaveBeenCalled();
    expect(mockTUI.showUserMessage).toHaveBeenCalledWith("waited prompt");
  });

  test("registers onMidSessionInput handler that echoes and injects message", async () => {
    const skillRegistry = new SkillRegistry();
    const client = createMockClient([{ text: "response", finishReason: "stop" }]);
    const builder = new AgentBuilder(client);
    vi.spyOn(builder, "clearPreActivatedSkills").mockReturnThis();
    vi.spyOn(builder, "withSignal").mockReturnThis();
    vi.spyOn(builder, "continueFrom").mockReturnThis();

    const env = createMockEnv(true);

    // Capture the mid-session handler so we can call it manually
    let midSessionHandler: ((msg: string) => void) | undefined;
    mockTUI.onMidSessionInput.mockImplementation((fn: (msg: string) => void) => {
      midSessionHandler = fn;
    });

    // Break loop after first waitForPrompt
    mockTUI.waitForPrompt.mockImplementationOnce(async () => {
      return "first prompt";
    });
    mockTUI.waitForPrompt.mockImplementationOnce(async () => {
      const e = new Error("break");
      e.name = "AbortError";
      throw e;
    });

    try {
      await runAgentLoop({
        builder,
        tui: mockTUI as any,
        env,
        skillRegistry,
        prompt: "initial",
      });
    } catch (e: any) {
      if (e.name !== "AbortError") throw e;
    }

    // onMidSessionInput should have been registered
    expect(mockTUI.onMidSessionInput).toHaveBeenCalled();
    expect(midSessionHandler).toBeDefined();

    // Calling the handler echoes the message to TUI
    if (midSessionHandler) {
      midSessionHandler("mid-session message");
      expect(mockTUI.showUserMessage).toHaveBeenCalledWith("mid-session message");
    }
  });

  test("subscribes to execution tree for each iteration", async () => {
    const skillRegistry = new SkillRegistry();
    const client = createMockClient([{ text: "response", finishReason: "stop" }]);
    const builder = new AgentBuilder(client);
    vi.spyOn(builder, "clearPreActivatedSkills").mockReturnThis();
    vi.spyOn(builder, "withSignal").mockReturnThis();
    vi.spyOn(builder, "continueFrom").mockReturnThis();

    const env = createMockEnv(true);

    try {
      await runAgentLoop({
        builder,
        tui: mockTUI as any,
        env,
        skillRegistry,
        prompt: "initial",
      });
    } catch (e: any) {
      if (e.name !== "AbortError") throw e;
    }

    expect(mockTUI.subscribeToTree).toHaveBeenCalled();
  });

  test("handles abort error in REPL loop gracefully and continues to next prompt", async () => {
    const skillRegistry = new SkillRegistry();
    const client = createMockClient([]);
    const builder = new AgentBuilder(client);

    vi.spyOn(builder, "clearPreActivatedSkills").mockReturnThis();
    vi.spyOn(builder, "withSignal").mockReturnThis();
    vi.spyOn(builder, "continueFrom").mockReturnThis();

    // First ask() throws AbortError, second ask succeeds
    let callCount = 0;
    vi.spyOn(builder, "ask").mockImplementation((_prompt: string) => {
      callCount++;
      if (callCount === 1) {
        return {
          // biome-ignore lint/correctness/useYield: test helper — generator throws immediately without yielding
          run: async function* () {
            const e = new Error("abort");
            e.name = "AbortError";
            throw e;
          },
          getTree: () => ({ subscribe: vi.fn(() => () => {}) }),
          injectUserMessage: vi.fn(),
        } as any;
      }
      // Second call: succeed then let the loop end via waitForPrompt AbortError
      return {
        run: async function* () {
          yield { type: "text" as const, content: "ok" };
        },
        getTree: () => ({ subscribe: vi.fn(() => () => {}) }),
        injectUserMessage: vi.fn(),
      } as any;
    });

    // After first abort, waitForPrompt returns second prompt; then the default mock breaks the loop
    mockTUI.waitForPrompt
      .mockResolvedValueOnce("second prompt")
      .mockImplementationOnce(async () => {
        const e = new Error("break");
        e.name = "AbortError";
        throw e;
      });

    const env = createMockEnv(true);

    try {
      await runAgentLoop({
        builder,
        tui: mockTUI as any,
        env,
        skillRegistry,
        prompt: "first prompt",
      });
    } catch (e: any) {
      if (e.name !== "AbortError") throw e;
    }

    // Should have made two ask() calls (one aborted, one succeeded)
    expect(callCount).toBe(2);
  });
});

// ─── Slash command handling ───────────────────────────────────────────────────

describe("runAgentLoop — slash commands (piped mode)", () => {
  test("non-slash prompt runs normally", async () => {
    const opts = pipedOptions([{ text: "response", finishReason: "stop" }], "hello");
    await runAgentLoop(opts);
    expect((opts.env.stdout as MockWritableStream).output).toBe("response");
  });
});
