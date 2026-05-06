/**
 * Slash command handler for /skill-name invocation in CLI/TUI.
 *
 * @module cli/skills/slash-handler
 */

import type { SkillRegistry } from "llmist";

/**
 * Result of parsing a slash command.
 */
export interface SlashCommandResult {
  /** Whether the input is a skill invocation. */
  isSkillInvocation: boolean;
  /** Whether this is the special /skills list command. */
  isListCommand?: boolean;
  /** Name of the skill to invoke. */
  skillName?: string;
  /** Arguments passed to the skill. */
  arguments?: string;
}

/**
 * Parse user input to check if it's a /skill-name invocation.
 *
 * Special cases:
 * - `/skills` returns { isListCommand: true } to show available skills
 * - `/skill-name [args]` activates the named skill
 *
 * @param input - Raw user input
 * @param registry - Skill registry for validation
 * @returns Parsed result
 */
export function parseSlashCommand(input: string, registry: SkillRegistry): SlashCommandResult {
  const trimmed = input.trim();

  if (!trimmed.startsWith("/")) {
    return { isSkillInvocation: false };
  }

  const match = trimmed.match(/^\/(\S+)(?:\s+(.*))?$/);
  if (!match) {
    return { isSkillInvocation: false };
  }

  const [, commandName, args] = match;

  // /skills — list available skills
  if (commandName === "skills") {
    return { isSkillInvocation: true, isListCommand: true };
  }

  // /skill-name — invoke a specific skill
  const skill = registry.get(commandName);
  if (!skill || !skill.isUserInvocable) {
    return { isSkillInvocation: false };
  }

  return {
    isSkillInvocation: true,
    skillName: commandName,
    arguments: args?.trim(),
  };
}

/**
 * Get a list of skill names for autocomplete.
 *
 * @param registry - Skill registry
 * @returns Array of skill names that can be invoked by the user
 */
export function getSlashCompletions(registry: SkillRegistry): string[] {
  return registry.getUserInvocable().map((s) => s.name);
}
