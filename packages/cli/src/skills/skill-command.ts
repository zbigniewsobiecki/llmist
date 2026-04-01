/**
 * CLI `llmist skill` subcommand for skill management.
 *
 * @module cli/skills/skill-command
 */

import type { Command } from "commander";
import { loadConfig } from "../config.js";
import type { CLIEnvironment } from "../environment.js";
import { CLISkillManager } from "./skill-manager.js";

/**
 * Register the `skill` command with the CLI program.
 */
export function registerSkillCommand(program: Command, env: CLIEnvironment): void {
  const skillCmd = program.command("skill").description("Manage Agent Skills (SKILL.md)");

  skillCmd
    .command("list")
    .description("List available skills")
    .action(async () => {
      const config = safeLoadConfig();
      const manager = new CLISkillManager();
      const registry = await manager.loadAll(config?.skills);

      const skills = registry.getAll();
      if (skills.length === 0) {
        env.stdout.write("No skills found.\n");
        env.stdout.write(
          "Add skills to ~/.llmist/skills/ or configure [skills].sources in ~/.llmist/cli.toml\n",
        );
        return;
      }

      env.stdout.write(`Found ${skills.length} skill(s):\n\n`);
      for (const skill of skills) {
        const flags: string[] = [];
        if (!skill.isModelInvocable) flags.push("user-only");
        if (!skill.isUserInvocable) flags.push("background");
        if (skill.metadata.context === "fork") flags.push("fork");
        if (skill.metadata.model) flags.push(`model:${skill.metadata.model}`);

        const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
        const desc =
          skill.description.length > 80
            ? `${skill.description.slice(0, 77)}...`
            : skill.description;

        env.stdout.write(`  /${skill.name}${flagStr}\n`);
        env.stdout.write(`    ${desc}\n\n`);
      }
    });

  skillCmd
    .command("info <name>")
    .description("Show detailed skill information")
    .action(async (name: string) => {
      const config = safeLoadConfig();
      const manager = new CLISkillManager();
      const registry = await manager.loadAll(config?.skills);

      const skill = registry.get(name);
      if (!skill) {
        env.stderr.write(`Skill not found: ${name}\n`);
        env.stderr.write(`Available skills: ${registry.getNames().join(", ") || "(none)"}\n`);
        process.exitCode = 1;
        return;
      }

      env.stdout.write(`Skill: ${skill.name}\n`);
      env.stdout.write(`Description: ${skill.description}\n`);
      env.stdout.write(`Source: ${skill.sourcePath}\n`);

      if (skill.metadata.model) env.stdout.write(`Model: ${skill.metadata.model}\n`);
      if (skill.metadata.context) env.stdout.write(`Context: ${skill.metadata.context}\n`);
      if (skill.metadata.agent) env.stdout.write(`Agent: ${skill.metadata.agent}\n`);
      if (skill.metadata.allowedTools) {
        env.stdout.write(`Allowed tools: ${skill.metadata.allowedTools.join(", ")}\n`);
      }
      if (skill.metadata.paths) {
        env.stdout.write(`Paths: ${skill.metadata.paths.join(", ")}\n`);
      }

      const resources = skill.getResources();
      if (resources.length > 0) {
        env.stdout.write(`Resources: ${resources.length}\n`);
        for (const r of resources) {
          env.stdout.write(`  ${r.category}/${r.relativePath}\n`);
        }
      }

      env.stdout.write("\n--- Instructions ---\n\n");
      const instructions = await skill.getInstructions();
      env.stdout.write(`${instructions}\n`);
    });
}

function safeLoadConfig() {
  try {
    return loadConfig();
  } catch {
    return undefined;
  }
}
