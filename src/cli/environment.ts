import readline from "node:readline";
import chalk from "chalk";
import type { ILogObj, Logger } from "tslog";
import { LLMist } from "../core/client.js";
import type { LoggerOptions } from "../logging/logger.js";
import { createLogger } from "../logging/logger.js";

/**
 * Stream type that may have TTY capabilities.
 */
export type TTYStream = NodeJS.ReadableStream & { isTTY?: boolean };

/**
 * Logger configuration for CLI commands.
 */
export interface CLILoggerConfig {
  logLevel?: string;
  logFile?: string;
}

/**
 * Environment abstraction for CLI dependencies and I/O.
 * Allows dependency injection for testing.
 */
export interface CLIEnvironment {
  argv: string[];
  stdin: TTYStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  createClient: () => LLMist;
  setExitCode: (code: number) => void;
  loggerConfig?: CLILoggerConfig;
  createLogger: (name: string) => Logger<ILogObj>;
  /** Whether stdin is a TTY (interactive terminal) */
  isTTY: boolean;
  /** Prompt the user for input (only works when isTTY is true) */
  prompt: (question: string) => Promise<string>;
}

const LOG_LEVEL_MAP: Record<string, number> = {
  silly: 0,
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
  fatal: 6,
};

/**
 * Creates a logger factory based on CLI configuration.
 * Priority: CLI options > environment variables > defaults
 */
function createLoggerFactory(config?: CLILoggerConfig): (name: string) => Logger<ILogObj> {
  return (name: string) => {
    const options: LoggerOptions = { name };

    // CLI --log-level takes priority over LLMIST_LOG_LEVEL env var
    if (config?.logLevel) {
      const level = config.logLevel.toLowerCase();
      if (level in LOG_LEVEL_MAP) {
        options.minLevel = LOG_LEVEL_MAP[level];
      }
    }

    // CLI --log-file takes priority over LLMIST_LOG_FILE env var
    // When log file is set via CLI, we temporarily set the env var
    // so createLogger picks it up
    if (config?.logFile) {
      const originalLogFile = process.env.LLMIST_LOG_FILE;
      process.env.LLMIST_LOG_FILE = config.logFile;
      const logger = createLogger(options);
      // Restore original (or delete if it wasn't set)
      if (originalLogFile === undefined) {
        delete process.env.LLMIST_LOG_FILE;
      } else {
        process.env.LLMIST_LOG_FILE = originalLogFile;
      }
      return logger;
    }

    // If no log file, default to pretty output (not hidden)
    if (!process.env.LLMIST_LOG_FILE) {
      options.type = "pretty";
    }

    return createLogger(options);
  };
}

/**
 * Creates a readline-based prompt function for user input.
 */
function createPromptFunction(
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
): (question: string) => Promise<string> {
  return (question: string) => {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: stdin,
        output: stdout,
      });
      // Display question with visual styling
      stdout.write("\n");
      stdout.write(`${chalk.cyan("─".repeat(60))}\n`);
      stdout.write(chalk.cyan.bold("🤖 Agent asks:\n"));
      stdout.write(`${question}\n`);
      stdout.write(`${chalk.cyan("─".repeat(60))}\n`);
      rl.question(chalk.green.bold("You: "), (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  };
}

/**
 * Creates the default CLI environment using Node.js process globals.
 * Uses process.argv, process.stdin/stdout/stderr, and creates a new LLMist client.
 *
 * @param loggerConfig - Optional logger configuration from CLI options
 * @returns Default CLI environment
 */
export function createDefaultEnvironment(loggerConfig?: CLILoggerConfig): CLIEnvironment {
  const isTTY = Boolean(process.stdin.isTTY);

  return {
    argv: process.argv,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    createClient: () => new LLMist(),
    setExitCode: (code: number) => {
      process.exitCode = code;
    },
    loggerConfig,
    createLogger: createLoggerFactory(loggerConfig),
    isTTY,
    prompt: isTTY
      ? createPromptFunction(process.stdin, process.stdout)
      : async () => {
          throw new Error("Cannot prompt for input: stdin is not a TTY");
        },
  };
}
