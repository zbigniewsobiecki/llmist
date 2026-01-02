import { Readable, Writable } from "node:stream";
import { createLogger } from "llmist";
import { describe, expect, it } from "vitest";
import type { CLIConfig, CustomCommandConfig } from "./config.js";
import type { CLIEnvironment } from "./environment.js";
import { runCLI } from "./program.js";

/**
 * Helper to create a readable stream.
 */
function createReadable(content: string, { isTTY = false } = {}): Readable & { isTTY?: boolean } {
  const stream = Readable.from([content]) as Readable & { isTTY?: boolean };
  stream.isTTY = isTTY;
  return stream;
}

/**
 * Helper to create a writable stream that captures output.
 */
function createWritable(isTTY = true) {
  let data = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      data += chunk.toString();
      callback();
    },
  });
  (stream as NodeJS.WriteStream & { isTTY: boolean }).isTTY = isTTY;
  return { stream, read: () => data };
}

/**
 * Helper to create a minimal CLI environment for testing.
 */
function createEnv(overrides: Partial<CLIEnvironment> = {}): CLIEnvironment {
  const stdin = createReadable("", { isTTY: false });
  const stdout = createWritable();
  const stderr = createWritable();

  return {
    argv: ["node", "llmist"],
    stdin,
    stdout: stdout.stream,
    stderr: stderr.stream,
    createClient: () => {
      throw new Error("Client not provided");
    },
    setExitCode: () => {},
    createLogger: (name: string) => createLogger({ type: "hidden", name }),
    isTTY: false,
    prompt: async () => {
      throw new Error("Cannot prompt in test environment");
    },
    ...overrides,
  };
}

describe("config command", () => {
  describe("no configuration", () => {
    it("should show helpful message when no config exists", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const env = createEnv({
        argv: ["node", "llmist", "config"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      // Pass {} to simulate no config (undefined would trigger loadConfig() from file)
      await runCLI({ config: {}, env });

      const output = stdout.read();

      expect(output).toContain("No configuration file found");
      expect(output).toContain("llmist init");
    });
  });

  describe("list profiles", () => {
    it("should list available profiles", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const config: CLIConfig = {
        code: {
          model: "openai:gpt-5-nano",
          description: "Code assistant profile",
        } as CustomCommandConfig,
        research: {
          model: "anthropic:claude-sonnet-4-5",
          inherits: "code",
        } as CustomCommandConfig,
      };

      const env = createEnv({
        argv: ["node", "llmist", "config"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config, env });

      const output = stdout.read();

      expect(output).toContain("Available Profiles");
      expect(output).toContain("code");
      expect(output).toContain("research");
      expect(output).toContain("Code assistant profile");
      expect(output).toContain("inherits: code");
    });

    it("should skip reserved sections when listing profiles", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const config: CLIConfig = {
        global: { model: "default" } as unknown as CustomCommandConfig,
        prompts: {} as unknown as CustomCommandConfig,
        subagents: {} as unknown as CustomCommandConfig,
        myprofile: { model: "gpt-5-nano" } as CustomCommandConfig,
      };

      const env = createEnv({
        argv: ["node", "llmist", "config"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config, env });

      const output = stdout.read();

      expect(output).toContain("myprofile");
      // Reserved sections should not appear as profiles
      const lines = output.split("\n").filter((l) => l.trim().startsWith("global"));
      expect(lines).toHaveLength(0);
    });

    it("should show message when no profiles defined", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const config: CLIConfig = {
        global: { model: "default" } as unknown as CustomCommandConfig,
      };

      const env = createEnv({
        argv: ["node", "llmist", "config"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config, env });

      const output = stdout.read();

      expect(output).toContain("No profiles defined");
    });
  });

  describe("show profile details", () => {
    it("should show detailed profile information", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const config: CLIConfig = {
        code: {
          model: "openai:gpt-5-nano",
          description: "Code assistant profile",
          "max-iterations": 10,
          temperature: 0.7,
          system: "You are a helpful coding assistant.",
          gadgets: ["filesystem", "execute"],
        } as CustomCommandConfig,
      };

      const env = createEnv({
        argv: ["node", "llmist", "config", "code"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config, env });

      const output = stdout.read();

      expect(output).toContain("Profile: code");
      expect(output).toContain("Description: Code assistant profile");
      expect(output).toContain("Model:");
      expect(output).toContain("openai:gpt-5-nano");
      expect(output).toContain("Max Iterations:");
      expect(output).toContain("10");
      expect(output).toContain("Temperature:");
      expect(output).toContain("0.7");
      expect(output).toContain("Gadgets:");
      expect(output).toContain("filesystem");
      expect(output).toContain("execute");
      expect(output).toContain("System Prompt");
      expect(output).toContain("You are a helpful coding assistant");
    });

    it("should show inheritance chain", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const config: CLIConfig = {
        base: { model: "gpt-5-nano" } as CustomCommandConfig,
        extended: {
          inherits: ["base", "another"],
          model: "gpt-5-mini",
        } as CustomCommandConfig,
      };

      const env = createEnv({
        argv: ["node", "llmist", "config", "extended"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config, env });

      const output = stdout.read();

      expect(output).toContain("Inherits: base → another");
    });

    it("should show gadget approval settings", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const config: CLIConfig = {
        secure: {
          model: "gpt-5-nano",
          "gadget-approval": {
            Execute: "always",
            FileWrite: "once",
          },
        } as CustomCommandConfig,
      };

      const env = createEnv({
        argv: ["node", "llmist", "config", "secure"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config, env });

      const output = stdout.read();

      expect(output).toContain("Gadget Approval:");
      expect(output).toContain("Execute: always");
      expect(output).toContain("FileWrite: once");
    });

    it("should show subagent configurations", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const config: CLIConfig = {
        agent: {
          model: "gpt-5-nano",
          subagents: {
            researcher: {
              model: "claude-sonnet-4-5",
              maxIterations: 5,
              timeoutMs: 30000,
            },
          },
        } as CustomCommandConfig,
      };

      const env = createEnv({
        argv: ["node", "llmist", "config", "agent"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config, env });

      const output = stdout.read();

      expect(output).toContain("Subagents:");
      expect(output).toContain("researcher:");
      expect(output).toContain("model: claude-sonnet-4-5");
      expect(output).toContain("maxIterations: 5");
      expect(output).toContain("timeoutMs: 30000");
    });

    it("should show (none) when no system prompt", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const config: CLIConfig = {
        simple: { model: "gpt-5-nano" } as CustomCommandConfig,
      };

      const env = createEnv({
        argv: ["node", "llmist", "config", "simple"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config, env });

      const output = stdout.read();

      expect(output).toContain("System Prompt: (none)");
    });

    it("should show (default) for unset options", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const config: CLIConfig = {
        minimal: {} as CustomCommandConfig,
      };

      const env = createEnv({
        argv: ["node", "llmist", "config", "minimal"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config, env });

      const output = stdout.read();

      expect(output).toContain("Model:           (default)");
      expect(output).toContain("Max Iterations:  (default)");
      expect(output).toContain("Temperature:     (default)");
    });
  });

  describe("error handling", () => {
    it("should error when profile not found", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const config: CLIConfig = {
        existing: { model: "gpt-5-nano" } as CustomCommandConfig,
      };

      const env = createEnv({
        argv: ["node", "llmist", "config", "nonexistent"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config, env });

      const output = stderr.read();

      expect(output).toContain('Profile "nonexistent" not found');
      expect(output).toContain("llmist config");
    });

    it("should error when trying to show reserved section", async () => {
      const stdout = createWritable();
      const stderr = createWritable();

      const config: CLIConfig = {
        global: { model: "default" } as unknown as CustomCommandConfig,
        myprofile: { model: "gpt-5-nano" } as CustomCommandConfig,
      };

      const env = createEnv({
        argv: ["node", "llmist", "config", "global"],
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      await runCLI({ config, env });

      const output = stderr.read();

      expect(output).toContain('"global" is a reserved section');
    });
  });
});
