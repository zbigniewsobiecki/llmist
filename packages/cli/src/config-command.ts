import type { Command } from "commander";
import type { CLIConfig, CustomCommandConfig } from "./config.js";
import { COMMANDS } from "./constants.js";
import type { CLIEnvironment } from "./environment.js";
import { executeAction } from "./utils.js";

/**
 * Registers the config command for displaying resolved profile configurations.
 */
export function registerConfigCommand(
  program: Command,
  env: CLIEnvironment,
  config: CLIConfig | undefined,
): void {
  program
    .command(`${COMMANDS.config} [profile]`)
    .description("Display resolved configuration for a profile or list all profiles")
    .action((profileName?: string) =>
      executeAction(() => executeConfigCommand(profileName, config, env), env),
    );
}

/**
 * Executes the config command - lists profiles or shows profile details.
 */
async function executeConfigCommand(
  profileName: string | undefined,
  config: CLIConfig | undefined,
  env: CLIEnvironment,
): Promise<void> {
  if (!config || Object.keys(config).length === 0) {
    env.stdout.write("No configuration file found at ~/.llmist/cli.toml\n");
    env.stdout.write("Run 'llmist init' to create one.\n");
    return;
  }

  if (!profileName) {
    listProfiles(config, env);
  } else {
    showProfile(profileName, config, env);
  }
}

/**
 * Lists all available profiles with their descriptions or inheritance info.
 */
function listProfiles(config: CLIConfig, env: CLIEnvironment): void {
  const reserved = new Set(["global", "prompts", "subagents"]);
  const profiles = Object.keys(config).filter((k) => !reserved.has(k));

  if (profiles.length === 0) {
    env.stdout.write("No profiles defined in configuration.\n");
    return;
  }

  env.stdout.write("Available Profiles:\n\n");
  for (const name of profiles) {
    const section = config[name] as CustomCommandConfig;
    const inherits = section?.inherits;
    const desc = section?.description;

    let line = `  ${name.padEnd(22)}`;
    if (desc) {
      line += desc;
    } else if (inherits) {
      line += `inherits: ${Array.isArray(inherits) ? inherits.join(", ") : inherits}`;
    }

    env.stdout.write(line + "\n");
  }
}

/**
 * Shows detailed configuration for a specific profile.
 */
function showProfile(name: string, config: CLIConfig, env: CLIEnvironment): void {
  const reserved = new Set(["global", "prompts", "subagents"]);
  if (reserved.has(name)) {
    env.stderr.write(`"${name}" is a reserved section, not a profile.\n`);
    return;
  }

  const section = config[name] as CustomCommandConfig | undefined;
  if (!section) {
    env.stderr.write(`Profile "${name}" not found.\n`);
    env.stderr.write("Run 'llmist config' to see available profiles.\n");
    return;
  }

  const separator = "─".repeat(60);

  // Header
  env.stdout.write(`\nProfile: ${name}\n`);
  if (section.inherits) {
    const chain = Array.isArray(section.inherits) ? section.inherits.join(" → ") : section.inherits;
    env.stdout.write(`Inherits: ${chain}\n`);
  }
  if (section.description) {
    env.stdout.write(`Description: ${section.description}\n`);
  }
  env.stdout.write(separator + "\n\n");

  // Basic options
  env.stdout.write("Options:\n");
  env.stdout.write(`  Model:           ${section.model ?? "(default)"}\n`);
  env.stdout.write(`  Max Iterations:  ${section["max-iterations"] ?? "(default)"}\n`);
  env.stdout.write(
    `  Temperature:     ${section.temperature !== undefined ? section.temperature : "(default)"}\n`,
  );

  // Gadgets
  const gadgets = section.gadgets ?? section.gadget;
  if (gadgets && gadgets.length > 0) {
    env.stdout.write("\nGadgets:\n");
    for (const g of gadgets) {
      env.stdout.write(`  • ${g}\n`);
    }
  }

  // Gadget approval
  const approval = section["gadget-approval"];
  if (approval && Object.keys(approval).length > 0) {
    env.stdout.write("\nGadget Approval:\n");
    for (const [gadget, policy] of Object.entries(approval)) {
      env.stdout.write(`  • ${gadget}: ${policy}\n`);
    }
  }

  // Subagents
  if (section.subagents && Object.keys(section.subagents).length > 0) {
    env.stdout.write("\nSubagents:\n");
    for (const [subagent, subConfig] of Object.entries(section.subagents)) {
      env.stdout.write(`  ${subagent}:\n`);
      if (subConfig.model) env.stdout.write(`    model: ${subConfig.model}\n`);
      if (subConfig.maxIterations)
        env.stdout.write(`    maxIterations: ${subConfig.maxIterations}\n`);
      if (subConfig.timeoutMs) env.stdout.write(`    timeoutMs: ${subConfig.timeoutMs}\n`);
    }
  }

  // System prompt
  if (section.system) {
    const chars = section.system.length;
    const lines = section.system.split("\n").length;
    env.stdout.write(`\nSystem Prompt (${chars.toLocaleString()} chars, ${lines} lines):\n`);
    env.stdout.write(separator + "\n");
    env.stdout.write(section.system);
    if (!section.system.endsWith("\n")) {
      env.stdout.write("\n");
    }
    env.stdout.write(separator + "\n");
  } else {
    env.stdout.write("\nSystem Prompt: (none)\n");
  }
}
