import { Command, InvalidArgumentError } from "commander";

import packageJson from "../../package.json";

import { registerAgentCommand } from "./agent-command.js";
import { registerCompleteCommand } from "./complete-command.js";
import { registerModelsCommand } from "./models-command.js";
import {
  CLI_DESCRIPTION,
  CLI_NAME,
  LOG_LEVELS,
  type LogLevelName,
  OPTION_DESCRIPTIONS,
  OPTION_FLAGS,
} from "./constants.js";
import type { CLIEnvironment, CLILoggerConfig } from "./environment.js";
import { createDefaultEnvironment } from "./environment.js";

/**
 * Parses and validates the log level option value.
 */
function parseLogLevel(value: string): LogLevelName {
  const normalized = value.toLowerCase() as LogLevelName;
  if (!LOG_LEVELS.includes(normalized)) {
    throw new InvalidArgumentError(`Log level must be one of: ${LOG_LEVELS.join(", ")}`);
  }
  return normalized;
}

/**
 * Global CLI options that apply to all commands.
 */
interface GlobalOptions {
  logLevel?: LogLevelName;
  logFile?: string;
}

/**
 * Creates and configures the CLI program with complete and agent commands.
 *
 * @param env - CLI environment configuration for I/O and dependencies
 * @returns Configured Commander program ready for parsing
 */
export function createProgram(env: CLIEnvironment): Command {
  const program = new Command();

  program
    .name(CLI_NAME)
    .description(CLI_DESCRIPTION)
    .version(packageJson.version)
    .option(OPTION_FLAGS.logLevel, OPTION_DESCRIPTIONS.logLevel, parseLogLevel)
    .option(OPTION_FLAGS.logFile, OPTION_DESCRIPTIONS.logFile)
    .configureOutput({
      writeOut: (str) => env.stdout.write(str),
      writeErr: (str) => env.stderr.write(str),
    });

  registerCompleteCommand(program, env);
  registerAgentCommand(program, env);
  registerModelsCommand(program, env);

  return program;
}

/**
 * Main entry point for running the CLI.
 * Creates environment, parses arguments, and executes the appropriate command.
 *
 * @param overrides - Optional environment overrides for testing or customization
 */
export async function runCLI(overrides: Partial<CLIEnvironment> = {}): Promise<void> {
  // First pass: parse global options only (skip if help requested)
  const preParser = new Command();
  preParser
    .option(OPTION_FLAGS.logLevel, OPTION_DESCRIPTIONS.logLevel, parseLogLevel)
    .option(OPTION_FLAGS.logFile, OPTION_DESCRIPTIONS.logFile)
    .allowUnknownOption()
    .allowExcessArguments()
    .helpOption(false); // Don't intercept --help

  preParser.parse(process.argv);
  const globalOpts = preParser.opts<GlobalOptions>();

  // Create environment with logger config from global options
  const loggerConfig: CLILoggerConfig = {
    logLevel: globalOpts.logLevel,
    logFile: globalOpts.logFile,
  };

  const defaultEnv = createDefaultEnvironment(loggerConfig);
  const env: CLIEnvironment = { ...defaultEnv, ...overrides };
  const program = createProgram(env);
  await program.parseAsync(env.argv);
}
