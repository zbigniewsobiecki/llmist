import type { Command } from "commander";
import { executeAgent } from "./agent-command.js";
import { executeComplete } from "./complete-command.js";
import type { CustomCommandConfig } from "./config.js";
import type { CLIEnvironment } from "./environment.js";
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

    cmd.action((prompt, cliOptions) =>
      executeAction(async () => {
        // Config values are base, CLI options override
        const configDefaults = configToCompleteOptions(config);
        const options: CompleteCommandOptions = {
          ...configDefaults,
          ...(cliOptions as Partial<CompleteCommandOptions>),
        } as CompleteCommandOptions;
        await executeComplete(prompt, options, env);
      }, env),
    );
  } else {
    // Agent type command (default)
    addAgentOptions(cmd, config);

    cmd.action((prompt, cliOptions) =>
      executeAction(async () => {
        // Config values are base, CLI options override
        const configDefaults = configToAgentOptions(config);
        const options: AgentCommandOptions = {
          ...configDefaults,
          ...(cliOptions as Partial<AgentCommandOptions>),
        } as AgentCommandOptions;
        await executeAgent(prompt, options, env);
      }, env),
    );
  }
}
