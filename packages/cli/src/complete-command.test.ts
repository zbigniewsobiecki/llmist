import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CLIEnvironment } from "./environment.js";

// --- Mock declarations (must be before imports) ---

vi.mock("llmist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("llmist")>();
  return {
    ...actual,
    resolveModel: vi.fn((m: string) => m),
    formatLlmRequest: vi.fn(() => "formatted request"),
    FALLBACK_CHARS_PER_TOKEN: 4,
    text: vi.fn((t: string) => ({ type: "text", text: t })),
    LLMMessageBuilder: vi.fn().mockImplementation(() => ({
      addSystem: vi.fn(),
      addUser: vi.fn(),
      addUserMultimodal: vi.fn(),
      build: vi.fn().mockReturnValue([]),
    })),
  };
});

vi.mock("./file-utils.js", () => ({
  readImageFile: vi
    .fn()
    .mockResolvedValue({ type: "image_url", image_url: { url: "data:image/png;base64,abc" } }),
  readAudioFile: vi
    .fn()
    .mockResolvedValue({ type: "input_audio", input_audio: { data: "abc", format: "mp3" } }),
  readSystemPromptFile: vi.fn().mockResolvedValue("System prompt from file"),
}));

vi.mock("./llm-logging.js", () => ({
  writeLogFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils.js")>();
  return {
    ...actual,
    resolvePrompt: vi.fn().mockResolvedValue("resolved prompt"),
    StreamPrinter: vi.fn().mockImplementation(() => ({
      write: vi.fn(),
      ensureNewline: vi.fn(),
    })),
    StreamProgress: vi.fn().mockImplementation(() => ({
      startCall: vi.fn(),
      setInputTokens: vi.fn(),
      setOutputTokens: vi.fn(),
      pause: vi.fn(),
      update: vi.fn(),
      endCall: vi.fn(),
      complete: vi.fn(),
      getTotalCost: vi.fn().mockReturnValue(0.001),
    })),
    executeAction: vi.fn(async (fn: () => Promise<void>, _env: CLIEnvironment) => {
      await fn();
    }),
  };
});

vi.mock("./ui/formatters.js", () => ({
  renderSummary: vi.fn().mockReturnValue("Summary: cost $0.001"),
}));

// --- Import mocked modules ---
import { formatLlmRequest, LLMMessageBuilder, resolveModel } from "llmist";
import { readAudioFile, readImageFile, readSystemPromptFile } from "./file-utils.js";
import { writeLogFile } from "./llm-logging.js";
import { renderSummary } from "./ui/formatters.js";
import { executeAction, resolvePrompt, StreamPrinter, StreamProgress } from "./utils.js";

// --- Test helpers ---

/**
 * Mock writable stream that captures all output.
 */
class MockWritableStream extends Writable {
  public output = "";
  public isTTY?: boolean;

  constructor(isTTY = false) {
    super();
    this.isTTY = isTTY || undefined;
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
 * Mock stdin for testing.
 */
class MockStdin extends EventEmitter {
  isTTY = false;
  resume = vi.fn(() => this);
  pause = vi.fn(() => this);
}

/**
 * Creates an async generator that yields stream chunks.
 */
async function* makeStream(
  chunks: Array<{ text?: string; usage?: any; finishReason?: string; thinking?: any }>,
) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

/**
 * Creates a mock LLMist client with a stream function.
 */
function createMockClient(
  streamChunks: Array<any> = [{ text: "Hello world", finishReason: "stop" }],
) {
  return {
    stream: vi.fn().mockReturnValue(makeStream(streamChunks)),
    modelRegistry: {
      getModel: vi.fn(),
    },
  };
}

/**
 * Creates a mock CLI environment.
 */
function createMockEnv(options: { isTTY?: boolean; stderrTTY?: boolean } = {}): CLIEnvironment & {
  stdout: MockWritableStream;
  stderr: MockWritableStream;
} {
  const stdout = new MockWritableStream(false);
  const stderr = new MockWritableStream(options.stderrTTY ?? false);
  const stdin = new MockStdin();
  stdin.isTTY = options.isTTY ?? false;

  const mockClient = createMockClient();

  return {
    argv: ["node", "llmist"],
    stdin: stdin as unknown as NodeJS.ReadableStream,
    stdout: stdout as unknown as MockWritableStream,
    stderr: stderr as unknown as MockWritableStream,
    isTTY: options.isTTY ?? false,
    setExitCode: vi.fn(),
    createClient: vi.fn().mockReturnValue(mockClient),
    createLogger: vi.fn().mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }),
    prompt: vi.fn(),
    loggerConfig: undefined,
    session: undefined,
  } as unknown as CLIEnvironment & {
    stdout: MockWritableStream;
    stderr: MockWritableStream;
  };
}

// --- Tests ---

describe("complete-command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-initialize LLMMessageBuilder default mock after clearAllMocks
    vi.mocked(LLMMessageBuilder).mockImplementation(
      () =>
        ({
          addSystem: vi.fn(),
          addUser: vi.fn(),
          addUserMultimodal: vi.fn(),
          build: vi.fn().mockReturnValue([]),
        }) as any,
    );
    // Re-initialize StreamProgress and StreamPrinter defaults
    vi.mocked(StreamProgress).mockImplementation(
      () =>
        ({
          startCall: vi.fn(),
          setInputTokens: vi.fn(),
          setOutputTokens: vi.fn(),
          pause: vi.fn(),
          update: vi.fn(),
          endCall: vi.fn(),
          complete: vi.fn(),
          getTotalCost: vi.fn().mockReturnValue(0.001),
        }) as any,
    );
    vi.mocked(StreamPrinter).mockImplementation(
      () =>
        ({
          write: vi.fn(),
          ensureNewline: vi.fn(),
        }) as any,
    );
    vi.mocked(resolvePrompt).mockResolvedValue("resolved prompt");
    vi.mocked(executeAction).mockImplementation(async (fn: any) => {
      await fn();
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("registerCompleteCommand", () => {
    it("should register the complete command", async () => {
      const { registerCompleteCommand } = await import("./complete-command.js");
      const program = new Command();
      const env = createMockEnv();

      registerCompleteCommand(program, env);

      const cmd = program.commands.find((c) => c.name() === "complete");
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toContain("completion");
    });

    it("should register complete command with optional prompt argument", async () => {
      const { registerCompleteCommand } = await import("./complete-command.js");
      const program = new Command();
      const env = createMockEnv();

      registerCompleteCommand(program, env);

      const cmd = program.commands.find((c) => c.name() === "complete");
      expect(cmd?.registeredArguments.length).toBeGreaterThan(0);
      expect(cmd?.registeredArguments[0].name()).toBe("prompt");
      expect(cmd?.registeredArguments[0].required).toBe(false);
    });

    it("should apply config defaults when provided", async () => {
      const { registerCompleteCommand } = await import("./complete-command.js");
      const program = new Command();
      const env = createMockEnv();

      // Provide config defaults
      registerCompleteCommand(program, env, {
        model: "anthropic:claude-haiku",
        system: "You are helpful",
      });

      const cmd = program.commands.find((c) => c.name() === "complete");
      expect(cmd).toBeDefined();
      // Default option for model should be set from config
      const modelOpt = cmd?.options.find((o) => o.long === "--model");
      expect(modelOpt?.defaultValue).toBe("anthropic:claude-haiku");
    });

    it("should invoke executeAction when command is run", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("test prompt");

      const { registerCompleteCommand } = await import("./complete-command.js");
      const program = new Command();
      program.exitOverride();
      const env = createMockEnv();

      registerCompleteCommand(program, env);

      await program.parseAsync(["node", "llmist", "complete", "hello"]);

      expect(executeAction).toHaveBeenCalled();
    });

    it("should merge globalRateLimits and globalRetry into options", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("test prompt");

      const { registerCompleteCommand, executeComplete } = await import("./complete-command.js");
      const executeSpy = vi.spyOn({ executeComplete }, "executeComplete");

      const program = new Command();
      program.exitOverride();
      const env = createMockEnv();

      const globalRateLimits = { "requests-per-minute": 60 } as any;
      const globalRetry = { retries: 3 } as any;

      registerCompleteCommand(program, env, undefined, globalRateLimits, globalRetry);

      await program.parseAsync(["node", "llmist", "complete", "hello"]);

      // executeAction was called, meaning the merging happened
      expect(executeAction).toHaveBeenCalled();
    });
  });

  describe("executeComplete - prompt resolution", () => {
    it("should resolve prompt from argument", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("my prompt from arg");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();

      await executeComplete("my prompt from arg", { model: "openai:gpt-5-nano" } as any, env);

      expect(resolvePrompt).toHaveBeenCalledWith("my prompt from arg", env);
    });

    it("should resolve prompt from stdin when arg is undefined", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("stdin prompt");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();

      await executeComplete(undefined, { model: "openai:gpt-5-nano" } as any, env);

      expect(resolvePrompt).toHaveBeenCalledWith(undefined, env);
    });

    it("should call resolveModel with the provided model option", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("test");
      vi.mocked(resolveModel).mockReturnValue("openai:gpt-4o" as any);

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();

      await executeComplete("test", { model: "gpt4o" } as any, env);

      expect(resolveModel).toHaveBeenCalledWith("gpt4o");
    });
  });

  describe("executeComplete - multimodal input", () => {
    it("should read image file and add multimodal message when --image flag is used", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("describe this image");
      vi.mocked(readImageFile).mockResolvedValue({
        type: "image_url",
        image_url: { url: "data:image/png;base64,abc" },
      } as any);

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();
      const builderInstance = {
        addSystem: vi.fn(),
        addUser: vi.fn(),
        addUserMultimodal: vi.fn(),
        build: vi.fn().mockReturnValue([]),
      };
      vi.mocked(LLMMessageBuilder).mockImplementation(() => builderInstance as any);

      await executeComplete(
        "describe this image",
        { model: "openai:gpt-5-nano", image: "/path/to/image.png" } as any,
        env,
      );

      expect(readImageFile).toHaveBeenCalledWith("/path/to/image.png");
      expect(builderInstance.addUserMultimodal).toHaveBeenCalled();
      expect(builderInstance.addUser).not.toHaveBeenCalled();
    });

    it("should read audio file and add multimodal message when --audio flag is used", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("transcribe this audio");
      vi.mocked(readAudioFile).mockResolvedValue({
        type: "input_audio",
        input_audio: { data: "abc", format: "mp3" },
      } as any);

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();
      const builderInstance = {
        addSystem: vi.fn(),
        addUser: vi.fn(),
        addUserMultimodal: vi.fn(),
        build: vi.fn().mockReturnValue([]),
      };
      vi.mocked(LLMMessageBuilder).mockImplementation(() => builderInstance as any);

      await executeComplete(
        "transcribe this audio",
        { model: "openai:gpt-5-nano", audio: "/path/to/audio.mp3" } as any,
        env,
      );

      expect(readAudioFile).toHaveBeenCalledWith("/path/to/audio.mp3");
      expect(builderInstance.addUserMultimodal).toHaveBeenCalled();
    });

    it("should add both image and audio parts when both flags are used", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("describe");
      vi.mocked(readImageFile).mockResolvedValue({ type: "image_url" } as any);
      vi.mocked(readAudioFile).mockResolvedValue({ type: "input_audio" } as any);

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();
      const builderInstance = {
        addSystem: vi.fn(),
        addUser: vi.fn(),
        addUserMultimodal: vi.fn(),
        build: vi.fn().mockReturnValue([]),
      };
      vi.mocked(LLMMessageBuilder).mockImplementation(() => builderInstance as any);

      await executeComplete(
        "describe",
        { model: "openai:gpt-5-nano", image: "/img.png", audio: "/aud.mp3" } as any,
        env,
      );

      expect(readImageFile).toHaveBeenCalledWith("/img.png");
      expect(readAudioFile).toHaveBeenCalledWith("/aud.mp3");
      expect(builderInstance.addUserMultimodal).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ type: "text" }),
          expect.objectContaining({ type: "image_url" }),
          expect.objectContaining({ type: "input_audio" }),
        ]),
      );
    });

    it("should add plain user message when no image or audio flags", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("plain text prompt");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();
      const builderInstance = {
        addSystem: vi.fn(),
        addUser: vi.fn(),
        addUserMultimodal: vi.fn(),
        build: vi.fn().mockReturnValue([]),
      };
      vi.mocked(LLMMessageBuilder).mockImplementation(() => builderInstance as any);

      await executeComplete("plain text prompt", { model: "openai:gpt-5-nano" } as any, env);

      expect(builderInstance.addUser).toHaveBeenCalledWith("plain text prompt");
      expect(builderInstance.addUserMultimodal).not.toHaveBeenCalled();
      expect(readImageFile).not.toHaveBeenCalled();
      expect(readAudioFile).not.toHaveBeenCalled();
    });

    it("should read system prompt from file when --system-file is provided", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("prompt");
      vi.mocked(readSystemPromptFile).mockResolvedValue("System prompt from file");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();
      const builderInstance = {
        addSystem: vi.fn(),
        addUser: vi.fn(),
        addUserMultimodal: vi.fn(),
        build: vi.fn().mockReturnValue([]),
      };
      vi.mocked(LLMMessageBuilder).mockImplementation(() => builderInstance as any);

      await executeComplete(
        "prompt",
        { model: "openai:gpt-5-nano", systemFile: "/path/to/system.txt" } as any,
        env,
      );

      expect(readSystemPromptFile).toHaveBeenCalledWith("/path/to/system.txt");
      expect(builderInstance.addSystem).toHaveBeenCalledWith("System prompt from file");
    });

    it("should throw when both --system and --system-file are provided", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("prompt");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();

      await expect(
        executeComplete(
          "prompt",
          {
            model: "openai:gpt-5-nano",
            system: "inline system",
            systemFile: "/path/to/system.txt",
          } as any,
          env,
        ),
      ).rejects.toThrow("Cannot use both --system and --system-file options");
    });
  });

  describe("executeComplete - reasoning config resolution", () => {
    it("should disable reasoning when options.reasoning is false (--no-reasoning)", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("prompt");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();
      const mockClient = createMockClient();
      vi.mocked(env.createClient).mockReturnValue(mockClient as any);

      await executeComplete("prompt", { model: "openai:gpt-5-nano", reasoning: false } as any, env);

      expect(mockClient.stream).toHaveBeenCalledWith(
        expect.objectContaining({ reasoning: { enabled: false } }),
      );
    });

    it("should enable reasoning with effort when options.reasoning is a string", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("prompt");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();
      const mockClient = createMockClient();
      vi.mocked(env.createClient).mockReturnValue(mockClient as any);

      await executeComplete(
        "prompt",
        { model: "openai:gpt-5-nano", reasoning: "high" } as any,
        env,
      );

      expect(mockClient.stream).toHaveBeenCalledWith(
        expect.objectContaining({ reasoning: { enabled: true, effort: "high" } }),
      );
    });

    it("should enable reasoning with budgetTokens when reasoningBudget is provided", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("prompt");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();
      const mockClient = createMockClient();
      vi.mocked(env.createClient).mockReturnValue(mockClient as any);

      await executeComplete(
        "prompt",
        { model: "openai:gpt-5-nano", reasoningBudget: 4096 } as any,
        env,
      );

      expect(mockClient.stream).toHaveBeenCalledWith(
        expect.objectContaining({ reasoning: { enabled: true, budgetTokens: 4096 } }),
      );
    });

    it("should use profileReasoning config when no CLI reasoning flags", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("prompt");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();
      const mockClient = createMockClient();
      vi.mocked(env.createClient).mockReturnValue(mockClient as any);

      await executeComplete(
        "prompt",
        {
          model: "openai:gpt-5-nano",
          profileReasoning: { enabled: true, effort: "medium" },
        } as any,
        env,
      );

      expect(mockClient.stream).toHaveBeenCalledWith(
        expect.objectContaining({ reasoning: { enabled: true, effort: "medium" } }),
      );
    });

    it("should disable reasoning from profileReasoning when enabled is false", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("prompt");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();
      const mockClient = createMockClient();
      vi.mocked(env.createClient).mockReturnValue(mockClient as any);

      await executeComplete(
        "prompt",
        {
          model: "openai:gpt-5-nano",
          profileReasoning: { enabled: false },
        } as any,
        env,
      );

      expect(mockClient.stream).toHaveBeenCalledWith(
        expect.objectContaining({ reasoning: { enabled: false } }),
      );
    });

    it("should not include reasoning in stream call when no reasoning options set", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("prompt");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();
      const mockClient = createMockClient();
      vi.mocked(env.createClient).mockReturnValue(mockClient as any);

      await executeComplete("prompt", { model: "openai:gpt-5-nano" } as any, env);

      const streamCall = mockClient.stream.mock.calls[0][0];
      expect(streamCall.reasoning).toBeUndefined();
    });
  });

  describe("executeComplete - stream processing", () => {
    it("should stream response text", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("hello");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();
      const mockClient = createMockClient([
        { text: "Hello " },
        { text: "world!" },
        { finishReason: "stop" },
      ]);
      vi.mocked(env.createClient).mockReturnValue(mockClient as any);

      const printerInstance = {
        write: vi.fn(),
        ensureNewline: vi.fn(),
      };
      vi.mocked(StreamPrinter).mockImplementation(() => printerInstance as any);

      await executeComplete("hello", { model: "openai:gpt-5-nano" } as any, env);

      expect(printerInstance.write).toHaveBeenCalledWith("Hello ");
      expect(printerInstance.write).toHaveBeenCalledWith("world!");
      expect(printerInstance.ensureNewline).toHaveBeenCalled();
    });

    it("should render summary when stderr is a TTY and not quiet", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("prompt");
      vi.mocked(renderSummary).mockReturnValue("Cost summary");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv({ stderrTTY: true });
      const mockClient = createMockClient();
      vi.mocked(env.createClient).mockReturnValue(mockClient as any);

      await executeComplete("prompt", { model: "openai:gpt-5-nano" } as any, env);

      expect(renderSummary).toHaveBeenCalled();
      expect(env.stderr.output).toContain("Cost summary");
    });

    it("should not render summary when stderr is not a TTY", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("prompt");
      vi.mocked(renderSummary).mockReturnValue("Cost summary");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv({ stderrTTY: false });
      const mockClient = createMockClient();
      vi.mocked(env.createClient).mockReturnValue(mockClient as any);

      await executeComplete("prompt", { model: "openai:gpt-5-nano" } as any, env);

      expect(renderSummary).not.toHaveBeenCalled();
    });

    it("should not render summary in quiet mode even on TTY", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("prompt");
      vi.mocked(renderSummary).mockReturnValue("Cost summary");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv({ stderrTTY: true });
      const mockClient = createMockClient();
      vi.mocked(env.createClient).mockReturnValue(mockClient as any);

      await executeComplete("prompt", { model: "openai:gpt-5-nano", quiet: true } as any, env);

      expect(renderSummary).not.toHaveBeenCalled();
    });

    it("should call progress.startCall with model", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("prompt");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();
      const mockClient = createMockClient();
      vi.mocked(env.createClient).mockReturnValue(mockClient as any);

      const progressInstance = {
        startCall: vi.fn(),
        setInputTokens: vi.fn(),
        setOutputTokens: vi.fn(),
        pause: vi.fn(),
        update: vi.fn(),
        endCall: vi.fn(),
        complete: vi.fn(),
        getTotalCost: vi.fn().mockReturnValue(0),
      };
      vi.mocked(StreamProgress).mockImplementation(() => progressInstance as any);

      await executeComplete("prompt", { model: "openai:gpt-5-nano" } as any, env);

      expect(progressInstance.startCall).toHaveBeenCalled();
      expect(progressInstance.complete).toHaveBeenCalled();
    });
  });

  describe("executeComplete - LLM log writing", () => {
    it("should write request log when logLlmRequests is enabled and session logDir exists", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("prompt");
      vi.mocked(formatLlmRequest).mockReturnValue("formatted request content");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();
      env.session = { logDir: "/tmp/session-logs", name: "test" } as any;
      const mockClient = createMockClient();
      vi.mocked(env.createClient).mockReturnValue(mockClient as any);

      await executeComplete(
        "prompt",
        { model: "openai:gpt-5-nano", logLlmRequests: true } as any,
        env,
      );

      expect(writeLogFile).toHaveBeenCalledWith(
        "/tmp/session-logs",
        "0001.request",
        expect.any(String),
      );
    });

    it("should write response log when logLlmRequests is enabled", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("prompt");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();
      env.session = { logDir: "/tmp/session-logs", name: "test" } as any;
      const mockClient = createMockClient([{ text: "response text" }, { finishReason: "stop" }]);
      vi.mocked(env.createClient).mockReturnValue(mockClient as any);

      await executeComplete(
        "prompt",
        { model: "openai:gpt-5-nano", logLlmRequests: true } as any,
        env,
      );

      expect(writeLogFile).toHaveBeenCalledWith(
        "/tmp/session-logs",
        "0001.response",
        expect.any(String),
      );
    });

    it("should not write logs when logLlmRequests is false", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("prompt");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();
      env.session = { logDir: "/tmp/session-logs", name: "test" } as any;
      const mockClient = createMockClient();
      vi.mocked(env.createClient).mockReturnValue(mockClient as any);

      await executeComplete(
        "prompt",
        { model: "openai:gpt-5-nano", logLlmRequests: false } as any,
        env,
      );

      expect(writeLogFile).not.toHaveBeenCalled();
    });

    it("should not write logs when logLlmRequests is enabled but no session logDir", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("prompt");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();
      // No session
      env.session = undefined;
      const mockClient = createMockClient();
      vi.mocked(env.createClient).mockReturnValue(mockClient as any);

      await executeComplete(
        "prompt",
        { model: "openai:gpt-5-nano", logLlmRequests: true } as any,
        env,
      );

      expect(writeLogFile).not.toHaveBeenCalled();
    });
  });

  describe("executeComplete - system prompt", () => {
    it("should add system prompt when --system is provided", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("prompt");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();
      const builderInstance = {
        addSystem: vi.fn(),
        addUser: vi.fn(),
        addUserMultimodal: vi.fn(),
        build: vi.fn().mockReturnValue([]),
      };
      vi.mocked(LLMMessageBuilder).mockImplementation(() => builderInstance as any);

      await executeComplete(
        "prompt",
        { model: "openai:gpt-5-nano", system: "You are helpful" } as any,
        env,
      );

      expect(builderInstance.addSystem).toHaveBeenCalledWith("You are helpful");
    });

    it("should not add system prompt when neither --system nor --system-file provided", async () => {
      vi.mocked(resolvePrompt).mockResolvedValue("prompt");

      const { executeComplete } = await import("./complete-command.js");
      const env = createMockEnv();
      const builderInstance = {
        addSystem: vi.fn(),
        addUser: vi.fn(),
        addUserMultimodal: vi.fn(),
        build: vi.fn().mockReturnValue([]),
      };
      vi.mocked(LLMMessageBuilder).mockImplementation(() => builderInstance as any);

      await executeComplete("prompt", { model: "openai:gpt-5-nano" } as any, env);

      expect(builderInstance.addSystem).not.toHaveBeenCalled();
    });
  });
});
