import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Command } from "commander";

import { getConfigPath } from "./config.js";
import { COMMANDS } from "./constants.js";
import type { CLIEnvironment } from "./environment.js";
import { executeAction } from "./utils.js";

/**
 * Options for the init command.
 * Empty for now, but structured for future extensibility (e.g., --force flag).
 */
export type InitCommandOptions = Record<string, never>;

/**
 * Starter configuration template with helpful comments.
 * Points users to the comprehensive example for more options.
 */
const STARTER_CONFIG = `# ~/.llmist/cli.toml
# llmist CLI configuration file
#
# This is a minimal starter config. For a comprehensive example with all options:
#   https://github.com/zbigniewsobiecki/llmist/blob/main/examples/cli.example.toml
#
# Key concepts:
#   - Any section can inherit from others using: inherits = "section-name"
#   - Prompts can use templates with Eta syntax: <%~ include("@prompt-name") %>
#   - Custom sections become CLI commands: [my-command] -> llmist my-command

#──────────────────────────────────────────────────────────────────────────────
# GLOBAL OPTIONS
# These apply to all commands. CLI flags override these settings.
#──────────────────────────────────────────────────────────────────────────────
[global]
# log-level = "info"              # silly, trace, debug, info, warn, error, fatal
# log-file = "/tmp/llmist.log"    # Enable file logging (JSON format)

#──────────────────────────────────────────────────────────────────────────────
# COMPLETE COMMAND DEFAULTS
# For single LLM responses: llmist complete "prompt"
# Model format: provider:model (e.g., openai:gpt-4o, anthropic:claude-sonnet-4-5)
#──────────────────────────────────────────────────────────────────────────────
[complete]
# model = "openai:gpt-4o"
# temperature = 0.7               # 0-2, higher = more creative
# max-tokens = 4096               # Maximum response length

#──────────────────────────────────────────────────────────────────────────────
# AGENT COMMAND DEFAULTS
# For tool-using agents: llmist agent "prompt"
#──────────────────────────────────────────────────────────────────────────────
[agent]
# model = "anthropic:claude-sonnet-4-5"
# max-iterations = 15             # Max tool-use loops before stopping
# budget = 0.50                  # Max USD spend per agent run
# gadgets = [                     # Tools the agent can use
#   "ListDirectory",
#   "ReadFile",
#   "WriteFile",
# ]

#──────────────────────────────────────────────────────────────────────────────
# CUSTOM COMMANDS
# Any other section becomes a new CLI command!
# Uncomment below to create: llmist summarize "your text"
#──────────────────────────────────────────────────────────────────────────────
# [summarize]
# type = "complete"               # "complete" or "agent"
# description = "Summarize text concisely."
# system = "Summarize the following text in 2-3 bullet points."
# temperature = 0.3
`;

/**
 * Executes the init command - creates ~/.llmist/cli.toml with a starter config.
 */
export async function executeInit(
  _options: InitCommandOptions,
  env: CLIEnvironment,
): Promise<void> {
  const configPath = getConfigPath();
  const configDir = dirname(configPath);

  // Check if config already exists
  if (existsSync(configPath)) {
    env.stderr.write(`Configuration already exists at ${configPath}\n`);
    env.stderr.write("\n");
    env.stderr.write(`To view it:  cat ${configPath}\n`);
    env.stderr.write(`To reset:    rm ${configPath} && llmist init\n`);
    return;
  }

  // Create directory if needed
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  // Write starter config
  writeFileSync(configPath, STARTER_CONFIG, "utf-8");

  // Success message with next steps
  env.stderr.write(`Created ${configPath}\n`);
  env.stderr.write("\n");
  env.stderr.write("Next steps:\n");
  env.stderr.write("  1. Set your API key:\n");
  env.stderr.write("       export OPENAI_API_KEY=sk-...\n");
  env.stderr.write("       export ANTHROPIC_API_KEY=sk-...\n");
  env.stderr.write("       export GEMINI_API_KEY=...\n");
  env.stderr.write("\n");
  env.stderr.write(`  2. Customize your config:\n`);
  env.stderr.write(`       $EDITOR ${configPath}\n`);
  env.stderr.write("\n");
  env.stderr.write("  3. See all options:\n");
  env.stderr.write(
    "       https://github.com/zbigniewsobiecki/llmist/blob/main/examples/cli.example.toml\n",
  );
  env.stderr.write("\n");
  env.stderr.write('Try it: llmist complete "Hello, world!"\n');
}

/**
 * Registers the init command with the program.
 */
export function registerInitCommand(program: Command, env: CLIEnvironment): void {
  program
    .command(COMMANDS.init)
    .description("Initialize llmist configuration at ~/.llmist/cli.toml")
    .action((options: InitCommandOptions) => executeAction(() => executeInit(options, env), env));
}
