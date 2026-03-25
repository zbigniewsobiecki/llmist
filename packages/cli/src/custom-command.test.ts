import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CLIEnvironment } from "./environment.js";

// Mock all external dependencies
vi.mock("./agent-command.js", () => ({
  executeAgent: vi.fn(),
}));

vi.mock("./complete-command.js", () => ({
  executeComplete: vi.fn(),
}));

vi.mock("./option-helpers.js", () => ({
  addAgentOptions: vi.fn((cmd) => cmd),
  addCompleteOptions: vi.fn((cmd) => cmd),
  configToAgentOptions: vi.fn(() => ({})),
  configToCompleteOptions: vi.fn(() => ({})),
}));

vi.mock("./utils.js", () => ({
  executeAction: vi.fn(async (fn: () => Promise<void>, _env: CLIEnvironment) => {
    await fn();
  }),
}));

vi.mock("./environment.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./environment.js")>();
  return {
    ...actual,
    createLoggerFactory: vi.fn(() => vi.fn()),
  };
});

import { executeAgent } from "./agent-command.js";
import { executeComplete } from "./complete-command.js";
import {
  addAgentOptions,
  addCompleteOptions,
  configToAgentOptions,
  configToCompleteOptions,
} from "./option-helpers.js";
import { executeAction } from "./utils.js";

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
 * Mock stdin for testing.
 */
class MockStdin extends EventEmitter {
  isTTY = false;
  resume = vi.fn(() => this);
  pause = vi.fn(() => this);
}

/**
 * Creates a mock CLI environment.
 */
function createMockEnv(isTTY = false): CLIEnvironment & {
  stdout: MockWritableStream;
  stderr: MockWritableStream;
} {
  const stdout = new MockWritableStream();
  const stderr = new MockWritableStream();
  const stdin = new MockStdin();
  stdin.isTTY = isTTY;

  return {
    argv: ["node", "llmist"],
    stdin: stdin as unknown as NodeJS.ReadableStream,
    stdout: stdout as unknown as MockWritableStream,
    stderr: stderr as unknown as MockWritableStream,
    isTTY,
    setExitCode: vi.fn(),
    createClient: vi.fn(),
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

describe("custom-command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("registerCustomCommand - agent type", () => {
    it("should register agent-type command with correct name and default description", async () => {
      const { registerCustomCommand } = await import("./custom-command.js");
      const program = new Command();
      const env = createMockEnv();

      registerCustomCommand(program, "code-review", { type: "agent" }, env);

      const cmd = program.commands.find((c) => c.name() === "code-review");
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toBe("Custom agent command");
    });

    it("should use config description when provided", async () => {
      const { registerCustomCommand } = await import("./custom-command.js");
      const program = new Command();
      const env = createMockEnv();

      registerCustomCommand(
        program,
        "code-review",
        { type: "agent", description: "Review code changes" },
        env,
      );

      const cmd = program.commands.find((c) => c.name() === "code-review");
      expect(cmd?.description()).toBe("Review code changes");
    });

    it("should call addAgentOptions for agent-type commands", async () => {
      const { registerCustomCommand } = await import("./custom-command.js");
      const program = new Command();
      const env = createMockEnv();
      const config = { type: "agent" as const };

      registerCustomCommand(program, "my-agent", config, env);

      expect(addAgentOptions).toHaveBeenCalled();
      expect(addCompleteOptions).not.toHaveBeenCalled();
    });

    it("should call executeAgent when agent-type command is invoked", async () => {
      vi.mocked(executeAgent).mockResolvedValue(undefined);
      vi.mocked(configToAgentOptions).mockReturnValue({ model: "openai:gpt-5-nano" });

      const { registerCustomCommand } = await import("./custom-command.js");
      const program = new Command();
      program.exitOverride();
      const env = createMockEnv();

      registerCustomCommand(
        program,
        "my-agent",
        { type: "agent", model: "openai:gpt-5-nano" },
        env,
      );

      await program.parseAsync(["node", "llmist", "my-agent", "hello world"]);

      expect(executeAgent).toHaveBeenCalledWith(
        "hello world",
        expect.objectContaining({ model: "openai:gpt-5-nano" }),
        expect.anything(),
        "my-agent",
      );
    });

    it("should default to agent type when type is not specified", async () => {
      const { registerCustomCommand } = await import("./custom-command.js");
      const program = new Command();
      const env = createMockEnv();

      registerCustomCommand(program, "my-command", {}, env);

      expect(addAgentOptions).toHaveBeenCalled();
      expect(addCompleteOptions).not.toHaveBeenCalled();
    });

    it("should include prompt argument for agent command", async () => {
      const { registerCustomCommand } = await import("./custom-command.js");
      const program = new Command();
      const env = createMockEnv();

      registerCustomCommand(program, "my-agent", { type: "agent" }, env);

      const cmd = program.commands.find((c) => c.name() === "my-agent");
      expect(cmd?.registeredArguments.length).toBeGreaterThan(0);
      expect(cmd?.registeredArguments[0].name()).toBe("prompt");
    });

    it("should pass globalSubagents and globalRateLimits and globalRetry to executeAgent", async () => {
      vi.mocked(executeAgent).mockResolvedValue(undefined);
      vi.mocked(configToAgentOptions).mockReturnValue({});

      const { registerCustomCommand } = await import("./custom-command.js");
      const program = new Command();
      program.exitOverride();
      const env = createMockEnv();

      const globalSubagents = { default: { model: "openai:gpt-5-nano" } } as any;
      const globalRateLimits = { "requests-per-minute": 60 } as any;
      const globalRetry = { retries: 3 } as any;

      registerCustomCommand(
        program,
        "my-agent",
        { type: "agent" },
        env,
        globalSubagents,
        globalRateLimits,
        globalRetry,
      );

      await program.parseAsync(["node", "llmist", "my-agent"]);

      expect(executeAgent).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          globalSubagents,
          globalRateLimits,
          globalRetry,
        }),
        expect.anything(),
        "my-agent",
      );
    });
  });

  describe("registerCustomCommand - complete type", () => {
    it("should register complete-type command with correct name and default description", async () => {
      const { registerCustomCommand } = await import("./custom-command.js");
      const program = new Command();
      const env = createMockEnv();

      registerCustomCommand(program, "summarize", { type: "complete" }, env);

      const cmd = program.commands.find((c) => c.name() === "summarize");
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toBe("Custom complete command");
    });

    it("should call addCompleteOptions for complete-type commands", async () => {
      const { registerCustomCommand } = await import("./custom-command.js");
      const program = new Command();
      const env = createMockEnv();
      const config = { type: "complete" as const };

      registerCustomCommand(program, "summarize", config, env);

      expect(addCompleteOptions).toHaveBeenCalled();
      expect(addAgentOptions).not.toHaveBeenCalled();
    });

    it("should call executeComplete when complete-type command is invoked", async () => {
      vi.mocked(executeComplete).mockResolvedValue(undefined);
      vi.mocked(configToCompleteOptions).mockReturnValue({ model: "anthropic:claude-haiku" });

      const { registerCustomCommand } = await import("./custom-command.js");
      const program = new Command();
      program.exitOverride();
      const env = createMockEnv();

      registerCustomCommand(
        program,
        "summarize",
        { type: "complete", model: "anthropic:claude-haiku" },
        env,
      );

      await program.parseAsync(["node", "llmist", "summarize", "tell me a joke"]);

      expect(executeComplete).toHaveBeenCalledWith(
        "tell me a joke",
        expect.objectContaining({ model: "anthropic:claude-haiku" }),
        expect.anything(),
      );
    });

    it("should pass globalRateLimits and globalRetry to executeComplete", async () => {
      vi.mocked(executeComplete).mockResolvedValue(undefined);
      vi.mocked(configToCompleteOptions).mockReturnValue({});

      const { registerCustomCommand } = await import("./custom-command.js");
      const program = new Command();
      program.exitOverride();
      const env = createMockEnv();

      const globalRateLimits = { "requests-per-minute": 60 } as any;
      const globalRetry = { retries: 3 } as any;

      registerCustomCommand(
        program,
        "summarize",
        { type: "complete" },
        env,
        undefined,
        globalRateLimits,
        globalRetry,
      );

      await program.parseAsync(["node", "llmist", "summarize"]);

      expect(executeComplete).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          globalRateLimits,
          globalRetry,
        }),
        expect.anything(),
      );
    });
  });

  describe("createCommandEnvironment - per-command logging config", () => {
    it("should return base env unchanged when no logging config on command", async () => {
      vi.mocked(executeAgent).mockResolvedValue(undefined);
      vi.mocked(configToAgentOptions).mockReturnValue({});

      const { registerCustomCommand } = await import("./custom-command.js");
      const program = new Command();
      program.exitOverride();
      const env = createMockEnv();

      // No log-level in config
      registerCustomCommand(program, "my-agent", { type: "agent" }, env);

      await program.parseAsync(["node", "llmist", "my-agent"]);

      // Should use same env (createLogger is env's own)
      expect(executeAgent).toHaveBeenCalledWith(undefined, expect.anything(), env, "my-agent");
    });

    it("should create new environment with merged logging config when log-level specified", async () => {
      vi.mocked(executeAgent).mockResolvedValue(undefined);
      vi.mocked(configToAgentOptions).mockReturnValue({});

      const { registerCustomCommand } = await import("./custom-command.js");
      const program = new Command();
      program.exitOverride();
      const env = createMockEnv();
      env.loggerConfig = { logLevel: "warn" };

      // Command-level log-level override
      registerCustomCommand(program, "my-agent", { type: "agent", "log-level": "debug" }, env);

      await program.parseAsync(["node", "llmist", "my-agent"]);

      // Should create a new env, not use the original
      expect(executeAgent).toHaveBeenCalledWith(
        undefined,
        expect.anything(),
        expect.not.objectContaining({ loggerConfig: { logLevel: "warn" } }),
        "my-agent",
      );

      const callEnv = vi.mocked(executeAgent).mock.calls[0][2];
      expect(callEnv.loggerConfig?.logLevel).toBe("debug");
    });

    it("should preserve all baseEnv properties when creating command environment", async () => {
      vi.mocked(executeComplete).mockResolvedValue(undefined);
      vi.mocked(configToCompleteOptions).mockReturnValue({});

      const { registerCustomCommand } = await import("./custom-command.js");
      const program = new Command();
      program.exitOverride();
      const env = createMockEnv();
      const session = { logDir: "/tmp/logs", name: "test-session" };
      env.session = session as any;

      registerCustomCommand(program, "summarize", { type: "complete", "log-level": "info" }, env);

      await program.parseAsync(["node", "llmist", "summarize"]);

      const callEnv = vi.mocked(executeComplete).mock.calls[0][2];
      // Session should be preserved
      expect(callEnv.session).toEqual(session);
      // New loggerConfig should be applied
      expect(callEnv.loggerConfig?.logLevel).toBe("info");
    });

    it("should use executeAction to run command actions", async () => {
      vi.mocked(executeAgent).mockResolvedValue(undefined);
      vi.mocked(configToAgentOptions).mockReturnValue({});

      const { registerCustomCommand } = await import("./custom-command.js");
      const program = new Command();
      program.exitOverride();
      const env = createMockEnv();

      registerCustomCommand(program, "my-agent", { type: "agent" }, env);

      await program.parseAsync(["node", "llmist", "my-agent"]);

      expect(executeAction).toHaveBeenCalled();
    });
  });

  describe("config merging", () => {
    it("should merge configToAgentOptions with CLI options for agent commands", async () => {
      vi.mocked(executeAgent).mockResolvedValue(undefined);
      vi.mocked(configToAgentOptions).mockReturnValue({
        model: "anthropic:claude-sonnet",
        temperature: 0.5,
      });

      const { registerCustomCommand } = await import("./custom-command.js");
      const program = new Command();
      program.exitOverride();
      const env = createMockEnv();

      registerCustomCommand(
        program,
        "my-agent",
        { type: "agent", model: "anthropic:claude-sonnet", temperature: 0.5 },
        env,
      );

      await program.parseAsync(["node", "llmist", "my-agent"]);

      expect(configToAgentOptions).toHaveBeenCalledWith(
        expect.objectContaining({ type: "agent", model: "anthropic:claude-sonnet" }),
      );

      expect(executeAgent).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ model: "anthropic:claude-sonnet", temperature: 0.5 }),
        expect.anything(),
        "my-agent",
      );
    });

    it("should merge configToCompleteOptions with CLI options for complete commands", async () => {
      vi.mocked(executeComplete).mockResolvedValue(undefined);
      vi.mocked(configToCompleteOptions).mockReturnValue({
        model: "openai:gpt-4o",
        system: "You are helpful",
      });

      const { registerCustomCommand } = await import("./custom-command.js");
      const program = new Command();
      program.exitOverride();
      const env = createMockEnv();

      registerCustomCommand(
        program,
        "ask",
        { type: "complete", model: "openai:gpt-4o", system: "You are helpful" },
        env,
      );

      await program.parseAsync(["node", "llmist", "ask"]);

      expect(configToCompleteOptions).toHaveBeenCalledWith(
        expect.objectContaining({ type: "complete", model: "openai:gpt-4o" }),
      );

      expect(executeComplete).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ model: "openai:gpt-4o", system: "You are helpful" }),
        expect.anything(),
      );
    });
  });
});
