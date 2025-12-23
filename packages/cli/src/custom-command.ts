import type { Command } from "commander";
import { executeAgent } from "./agent-command.js";
import { executeComplete } from "./complete-command.js";
import type { CustomCommandConfig, GlobalSubagentConfig } from "./config.js";
import { type CLIEnvironment, type CLILoggerConfig, createLoggerFactory } from "./environment.js";
import {
  type CLIAgentOptions,
  addAgentOptions,
  addCompleteOptions,
  type CLICompleteOptions,
  configToAgentOptions,
  configToCompleteOptions,
} from "./option-helpers.js";
import { executeAction } from "./utils.js";

/**
 * Creates an environment with per-command logging config merged in.
 * If the command has logging options, creates a new environment; otherwise returns the original.
 */
function createCommandEnvironment(
  baseEnv: CLIEnvironment,
  config: CustomCommandConfig,
): CLIEnvironment {
  // Check if command has any logging overrides
  const hasLoggingConfig = config["log-level"] !== undefined;

  if (!hasLoggingConfig) {
    return baseEnv;
  }

  // Merge per-command logging config with base environment's config
  const loggerConfig: CLILoggerConfig = {
    logLevel: config["log-level"] ?? baseEnv.loggerConfig?.logLevel,
  };

  // Preserve all baseEnv properties, only override logging config
  return {
    ...baseEnv,
    loggerConfig,
    createLogger: createLoggerFactory(loggerConfig, baseEnv.session?.logDir),
  };
}

/**
 * Registers a custom command from config file.
 *
 * Custom commands are defined in ~/.llmist/cli.toml as sections like [code-review].
 * Each section can specify `type = "agent"` (default) or `type = "complete"` to
 * determine the execution behavior.
 *
 * @param program - Commander program to register the command with
 * @param name - Command name (e.g., "code-review")
 * @param config - Command configuration from TOML file
 * @param env - CLI environment for I/O operations
 */
export function registerCustomCommand(
  program: Command,
  name: string,
  config: CustomCommandConfig,
  env: CLIEnvironment,
  globalSubagents?: GlobalSubagentConfig,
): void {
  const type = config.type ?? "agent";
  const description = config.description ?? `Custom ${type} command`;

  const cmd = program
    .command(name)
    .description(description)
    .argument("[prompt]", "Prompt for the command. Falls back to stdin when available.");

  if (type === "complete") {
    // Complete type command
    addCompleteOptions(cmd, config);

    cmd.action((prompt, cliOptions) => {
      // Create environment with per-command logging config
      const cmdEnv = createCommandEnvironment(env, config);
      return executeAction(async () => {
        // Config values are base, CLI options override
        const configDefaults = configToCompleteOptions(config);
        const options: CLICompleteOptions = {
          ...configDefaults,
          ...(cliOptions as Partial<CLICompleteOptions>),
        } as CLICompleteOptions;
        await executeComplete(prompt, options, cmdEnv);
      }, cmdEnv);
    });
  } else {
    // Agent type command (default)
    addAgentOptions(cmd, config);

    cmd.action((prompt, cliOptions) => {
      // Create environment with per-command logging config
      const cmdEnv = createCommandEnvironment(env, config);
      return executeAction(async () => {
        // Config values are base, CLI options override
        const configDefaults = configToAgentOptions(config);
        const options: CLIAgentOptions = {
          ...configDefaults,
          ...(cliOptions as Partial<CLIAgentOptions>),
          globalSubagents,
        } as CLIAgentOptions;
        await executeAgent(prompt, options, cmdEnv);
      }, cmdEnv);
    });
  }
}
