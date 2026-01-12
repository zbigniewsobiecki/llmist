import { join } from "node:path";
import readline from "node:readline";
import chalk from "chalk";
import type { ILogObj, Logger, LoggerOptions } from "llmist";
import { createLogger, LLMist } from "llmist";
import type { Session } from "./session.js";

/**
 * Stream type that may have TTY detection capability.
 */
export type TTYAwareStream = NodeJS.ReadableStream & { isTTY?: boolean };

/**
 * Logger configuration for CLI commands.
 */
export interface CLILoggerConfig {
  logLevel?: string;
}

/**
 * Environment abstraction for CLI dependencies and I/O.
 * Allows dependency injection for testing.
 */
export interface CLIEnvironment {
  argv: string[];
  stdin: TTYAwareStream;
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
  /** Current session with logging directory */
  session?: Session;
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
 *
 * @param config - Logger configuration (log level)
 * @param sessionLogDir - Session log directory for automatic log file
 */
export function createLoggerFactory(
  config?: CLILoggerConfig,
  sessionLogDir?: string,
): (name: string) => Logger<ILogObj> {
  return (name: string) => {
    const options: LoggerOptions = { name };

    // CLI --log-level takes priority over LLMIST_LOG_LEVEL env var
    if (config?.logLevel) {
      const level = config.logLevel.toLowerCase();
      if (level in LOG_LEVEL_MAP) {
        options.minLevel = LOG_LEVEL_MAP[level];
      }
    }

    // Auto-set log file to session directory if session exists
    if (sessionLogDir) {
      const logFile = join(sessionLogDir, "session.log.jsonl");
      const originalLogFile = process.env.LLMIST_LOG_FILE;
      process.env.LLMIST_LOG_FILE = logFile;
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
 * @param sessionLogDir - Optional session log directory for automatic log file
 * @returns Default CLI environment
 */
export function createDefaultEnvironment(
  loggerConfig?: CLILoggerConfig,
  sessionLogDir?: string,
): CLIEnvironment {
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
    createLogger: createLoggerFactory(loggerConfig, sessionLogDir),
    isTTY,
    prompt: isTTY
      ? createPromptFunction(process.stdin, process.stdout)
      : async () => {
          throw new Error("Cannot prompt for input: stdin is not a TTY");
        },
  };
}
