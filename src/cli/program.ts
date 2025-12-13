import { Command, InvalidArgumentError } from "commander";

import packageJson from "../../package.json";

import { registerAgentCommand } from "./agent-command.js";
import { registerCompleteCommand } from "./complete-command.js";
import { registerInitCommand } from "./init-command.js";
import {
  type CLIConfig,
  type CustomCommandConfig,
  getCustomCommandNames,
  loadConfig,
} from "./config.js";
import {
  CLI_DESCRIPTION,
  CLI_NAME,
  LOG_LEVELS,
  type CLILogLevel,
  OPTION_DESCRIPTIONS,
  OPTION_FLAGS,
} from "./constants.js";
import { registerCustomCommand } from "./custom-command.js";
import type { CLIEnvironment, CLILoggerConfig } from "./environment.js";
import { createDefaultEnvironment } from "./environment.js";
import { registerGadgetCommand } from "./gadget-command.js";
import { registerImageCommand } from "./image-command.js";
import { registerModelsCommand } from "./models-command.js";
import { registerSpeechCommand } from "./speech-command.js";
import { registerVisionCommand } from "./vision-command.js";

/**
 * Parses and validates the log level option value.
 */
function parseLogLevel(value: string): CLILogLevel {
  const normalized = value.toLowerCase() as CLILogLevel;
  if (!LOG_LEVELS.includes(normalized)) {
    throw new InvalidArgumentError(`Log level must be one of: ${LOG_LEVELS.join(", ")}`);
  }
  return normalized;
}

/**
 * Global CLI options that apply to all commands.
 */
interface GlobalOptions {
  logLevel?: CLILogLevel;
  logFile?: string;
  logReset?: boolean;
}

/**
 * Creates and configures the CLI program with complete and agent commands.
 *
 * @param env - CLI environment configuration for I/O and dependencies
 * @param config - Optional CLI configuration loaded from config file
 * @returns Configured Commander program ready for parsing
 */
export function createProgram(env: CLIEnvironment, config?: CLIConfig): Command {
  const program = new Command();

  program
    .name(CLI_NAME)
    .description(CLI_DESCRIPTION)
    .version(packageJson.version)
    .option(OPTION_FLAGS.logLevel, OPTION_DESCRIPTIONS.logLevel, parseLogLevel)
    .option(OPTION_FLAGS.logFile, OPTION_DESCRIPTIONS.logFile)
    .option(OPTION_FLAGS.logReset, OPTION_DESCRIPTIONS.logReset)
    .configureOutput({
      writeOut: (str) => env.stdout.write(str),
      writeErr: (str) => env.stderr.write(str),
    });

  // Register built-in commands with config defaults
  registerCompleteCommand(program, env, config?.complete);
  registerAgentCommand(program, env, config?.agent, config?.subagents);
  registerImageCommand(program, env, config?.image);
  registerSpeechCommand(program, env, config?.speech);
  registerVisionCommand(program, env);
  registerModelsCommand(program, env);
  registerGadgetCommand(program, env);
  registerInitCommand(program, env);

  // Register custom commands from config
  if (config) {
    const customNames = getCustomCommandNames(config);
    for (const name of customNames) {
      const cmdConfig = config[name] as CustomCommandConfig;
      registerCustomCommand(program, name, cmdConfig, env, config.subagents);
    }
  }

  return program;
}

/**
 * Options for runCLI function.
 */
export interface RunCLIOptions {
  /** Environment overrides for testing or customization */
  env?: Partial<CLIEnvironment>;
  /** Config override - if provided, skips loading from file. Use {} to disable config. */
  config?: CLIConfig;
}

/**
 * Main entry point for running the CLI.
 * Creates environment, parses arguments, and executes the appropriate command.
 *
 * @param overrides - Optional environment overrides or options object
 */
export async function runCLI(
  overrides: Partial<CLIEnvironment> | RunCLIOptions = {},
): Promise<void> {
  // Handle both old signature (Partial<CLIEnvironment>) and new signature (RunCLIOptions)
  const opts: RunCLIOptions =
    "env" in overrides || "config" in overrides
      ? (overrides as RunCLIOptions)
      : { env: overrides as Partial<CLIEnvironment> };

  // Load config early (before program creation) - errors here should fail fast
  // If config is provided in options, use it instead of loading from file
  const config = opts.config !== undefined ? opts.config : loadConfig();
  const envOverrides = opts.env ?? {};

  // First pass: parse global options only (skip if help requested)
  const preParser = new Command();
  preParser
    .option(OPTION_FLAGS.logLevel, OPTION_DESCRIPTIONS.logLevel, parseLogLevel)
    .option(OPTION_FLAGS.logFile, OPTION_DESCRIPTIONS.logFile)
    .option(OPTION_FLAGS.logReset, OPTION_DESCRIPTIONS.logReset)
    .allowUnknownOption()
    .allowExcessArguments()
    .helpOption(false); // Don't intercept --help

  preParser.parse(process.argv);
  const globalOpts = preParser.opts<GlobalOptions>();

  // Create environment with logger config from global options
  // Priority: CLI flags > config file > defaults
  const loggerConfig: CLILoggerConfig = {
    logLevel: globalOpts.logLevel ?? config.global?.["log-level"],
    logFile: globalOpts.logFile ?? config.global?.["log-file"],
    logReset: globalOpts.logReset ?? config.global?.["log-reset"],
  };

  const defaultEnv = createDefaultEnvironment(loggerConfig);
  const env: CLIEnvironment = {
    ...defaultEnv,
    ...envOverrides,
    // Pass Docker config from [docker] section
    dockerConfig: config.docker,
  };
  const program = createProgram(env, config);
  await program.parseAsync(env.argv);
}
