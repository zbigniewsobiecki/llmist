import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CLIEnvironment } from "./environment.js";
import { executeInit, type InitCommandOptions } from "./init-command.js";

// Mock node:fs module to avoid actual filesystem operations
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Mock getConfigPath so we control the path used during tests
vi.mock("./config.js", () => ({
  getConfigPath: vi.fn(),
}));

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { getConfigPath } from "./config.js";

/**
 * Mock writable stream that captures output.
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
 * Creates a minimal mock CLI environment for init-command tests.
 */
function createMockEnv(): CLIEnvironment & {
  stdout: MockWritableStream;
  stderr: MockWritableStream;
} {
  const stdout = new MockWritableStream();
  const stderr = new MockWritableStream();

  return {
    argv: [],
    stdin: process.stdin,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    isTTY: false,
    createClient: vi.fn() as unknown as CLIEnvironment["createClient"],
    setExitCode: vi.fn(),
    createLogger: vi.fn() as unknown as CLIEnvironment["createLogger"],
    prompt: vi.fn() as unknown as CLIEnvironment["prompt"],
  } as unknown as CLIEnvironment & {
    stdout: MockWritableStream;
    stderr: MockWritableStream;
  };
}

const MOCK_CONFIG_PATH = "/home/user/.llmist/cli.toml";
const MOCK_CONFIG_DIR = "/home/user/.llmist";

describe("init-command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: getConfigPath returns a fixed path
    vi.mocked(getConfigPath).mockReturnValue(MOCK_CONFIG_PATH);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("executeInit", () => {
    describe("when config already exists", () => {
      beforeEach(() => {
        // Both the config file and its directory exist
        vi.mocked(existsSync).mockReturnValue(true);
      });

      it("writes a message to stderr indicating config already exists", async () => {
        const env = createMockEnv();
        const options: InitCommandOptions = {};

        await executeInit(options, env);

        expect(env.stderr.output).toContain(`Configuration already exists at ${MOCK_CONFIG_PATH}`);
      });

      it("does not call writeFileSync when config already exists", async () => {
        const env = createMockEnv();
        const options: InitCommandOptions = {};

        await executeInit(options, env);

        expect(writeFileSync).not.toHaveBeenCalled();
      });

      it("does not call mkdirSync when config already exists", async () => {
        const env = createMockEnv();
        const options: InitCommandOptions = {};

        await executeInit(options, env);

        expect(mkdirSync).not.toHaveBeenCalled();
      });

      it("includes hint to view or reset the config in stderr output", async () => {
        const env = createMockEnv();
        const options: InitCommandOptions = {};

        await executeInit(options, env);

        expect(env.stderr.output).toContain(`cat ${MOCK_CONFIG_PATH}`);
        expect(env.stderr.output).toContain(`rm ${MOCK_CONFIG_PATH}`);
      });
    });

    describe("when config does not exist", () => {
      beforeEach(() => {
        // Config file does not exist; directory does not exist either
        vi.mocked(existsSync).mockReturnValue(false);
      });

      it("calls mkdirSync with the config directory and recursive:true", async () => {
        const env = createMockEnv();
        const options: InitCommandOptions = {};

        await executeInit(options, env);

        expect(mkdirSync).toHaveBeenCalledWith(MOCK_CONFIG_DIR, { recursive: true });
      });

      it("calls writeFileSync with the config path and starter config content", async () => {
        const env = createMockEnv();
        const options: InitCommandOptions = {};

        await executeInit(options, env);

        expect(writeFileSync).toHaveBeenCalledWith(
          MOCK_CONFIG_PATH,
          expect.stringContaining("[global]"),
          "utf-8",
        );
      });

      it("writes a STARTER_CONFIG that contains key TOML sections", async () => {
        const env = createMockEnv();
        const options: InitCommandOptions = {};

        await executeInit(options, env);

        const [, writtenContent] = vi.mocked(writeFileSync).mock.calls[0] as [
          string,
          string,
          string,
        ];
        expect(writtenContent).toContain("[complete]");
        expect(writtenContent).toContain("[agent]");
      });

      it("writes a success message to stderr including the config path", async () => {
        const env = createMockEnv();
        const options: InitCommandOptions = {};

        await executeInit(options, env);

        expect(env.stderr.output).toContain(`Created ${MOCK_CONFIG_PATH}`);
      });

      it("writes API key setup instructions to stderr", async () => {
        const env = createMockEnv();
        const options: InitCommandOptions = {};

        await executeInit(options, env);

        expect(env.stderr.output).toContain("OPENAI_API_KEY");
        expect(env.stderr.output).toContain("ANTHROPIC_API_KEY");
        expect(env.stderr.output).toContain("GEMINI_API_KEY");
      });

      it("writes next steps including editor instruction to stderr", async () => {
        const env = createMockEnv();
        const options: InitCommandOptions = {};

        await executeInit(options, env);

        expect(env.stderr.output).toContain("Next steps:");
        expect(env.stderr.output).toContain(`$EDITOR ${MOCK_CONFIG_PATH}`);
      });

      it("writes example link to stderr", async () => {
        const env = createMockEnv();
        const options: InitCommandOptions = {};

        await executeInit(options, env);

        expect(env.stderr.output).toContain("cli.example.toml");
      });

      it("does not call mkdirSync when directory already exists", async () => {
        // Config file doesn't exist but directory does
        vi.mocked(existsSync)
          .mockReturnValueOnce(false) // first call: config file check
          .mockReturnValueOnce(true); // second call: config dir check

        const env = createMockEnv();
        const options: InitCommandOptions = {};

        await executeInit(options, env);

        expect(mkdirSync).not.toHaveBeenCalled();
      });

      it("calls getConfigPath to determine config location", async () => {
        const env = createMockEnv();
        const options: InitCommandOptions = {};

        await executeInit(options, env);

        expect(getConfigPath).toHaveBeenCalled();
      });
    });
  });
});
