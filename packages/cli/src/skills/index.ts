/**
 * CLI skills module.
 *
 * @module cli/skills
 */

export type { SkillOverrideConfig, SkillsConfig } from "./config-types.js";
export { SKILL_OVERRIDE_KEYS, SKILLS_CONFIG_KEYS, validateSkillsConfig } from "./config-types.js";
export { CLISkillManager } from "./skill-manager.js";
export type { SlashCommandResult } from "./slash-handler.js";
export { getSlashCompletions, parseSlashCommand } from "./slash-handler.js";
