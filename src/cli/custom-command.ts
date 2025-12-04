import type { Command } from "commander";
import { executeAgent } from "./agent-command.js";
import { executeComplete } from "./complete-command.js";
import type { CustomCommandConfig } from "./config.js";
import { createDefaultEnvironment, type CLIEnvironment, type CLILoggerConfig } from "./environment.js";
import {
  addAgentOptions,
  addCompleteOptions,
  type AgentCommandOptions,
  type CompleteCommandOptions,
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
  const hasLoggingConfig =
    config["log-level"] !== undefined ||
    config["log-file"] !== undefined ||
    config["log-reset"] !== undefined;

  if (!hasLoggingConfig) {
    return baseEnv;
  }

  // Merge per-command logging config with base environment's config
  const loggerConfig: CLILoggerConfig = {
    logLevel: config["log-level"] ?? baseEnv.loggerConfig?.logLevel,
    logFile: config["log-file"] ?? baseEnv.loggerConfig?.logFile,
    logReset: config["log-reset"] ?? baseEnv.loggerConfig?.logReset,
  };

  // Create new environment with merged logging config, preserving dockerConfig
  const newEnv = createDefaultEnvironment(loggerConfig);
  return {
    ...newEnv,
    dockerConfig: baseEnv.dockerConfig,
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
        const options: CompleteCommandOptions = {
          ...configDefaults,
          ...(cliOptions as Partial<CompleteCommandOptions>),
        } as CompleteCommandOptions;
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
        const options: AgentCommandOptions = {
          ...configDefaults,
          ...(cliOptions as Partial<AgentCommandOptions>),
        } as AgentCommandOptions;
        await executeAgent(prompt, options, cmdEnv);
      }, cmdEnv);
    });
  }
}
