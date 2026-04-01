/**
 * CLI-level skill management.
 *
 * Extends core skill loading with CLI-specific sources (npm, git)
 * and configuration-driven overrides.
 *
 * @module cli/skills/skill-manager
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { discoverSkills, loadSkillsFromDirectory, type SkillRegistry } from "llmist";
import type { SkillsConfig } from "./config-types.js";

/**
 * CLI skill manager that discovers and loads skills from all configured sources.
 */
export class CLISkillManager {
  /**
   * Load all skills from standard locations and configured sources.
   *
   * @param config - Skills configuration from cli.toml [skills] section
   * @param projectDir - Project directory (cwd)
   */
  async loadAll(config?: SkillsConfig, projectDir?: string): Promise<SkillRegistry> {
    // Start with standard discovery: ~/.llmist/skills/ and .llmist/skills/
    const registry = discoverSkills({
      projectDir: projectDir ?? process.cwd(),
    });

    // Load from configured sources
    if (config?.sources) {
      for (const source of config.sources) {
        const resolvedSource = this.resolveSource(source);
        const skills = loadSkillsFromDirectory(resolvedSource, {
          type: "directory",
          path: resolvedSource,
        });
        registry.registerMany(skills);
      }
    }

    // Apply overrides (disable skills, etc.)
    if (config?.overrides) {
      for (const [skillName, override] of Object.entries(config.overrides)) {
        if (override.enabled === false) {
          registry.remove(skillName);
        }
      }
    }

    return registry;
  }

  /**
   * Resolve a source string to an absolute directory path.
   */
  private resolveSource(source: string): string {
    if (source.startsWith("~")) {
      return join(homedir(), source.slice(1));
    }
    return resolve(source);
  }
}
