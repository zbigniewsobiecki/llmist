/**
 * CLI configuration types for the [skills] section.
 *
 * @module cli/skills/config-types
 */

/**
 * Per-skill override configuration.
 */
export interface SkillOverrideConfig {
  /** Override the model for this skill. */
  model?: string;
  /** Enable or disable this skill. Default: true. */
  enabled?: boolean;
}

/**
 * Configuration for the [skills] section in cli.toml.
 *
 * @example
 * ```toml
 * [skills]
 * sources = [
 *   "~/.llmist/skills",
 *   "./project-skills",
 * ]
 *
 * [skills.overrides.gmail-read]
 * model = "flash"
 * enabled = true
 * ```
 */
export interface SkillsConfig {
  /** External skill source directories, npm packages, or git URLs. */
  sources?: string[];
  /** Per-skill overrides. */
  overrides?: Record<string, SkillOverrideConfig>;
}

/** Valid keys for the [skills] section. */
export const SKILLS_CONFIG_KEYS = new Set(["sources", "overrides"]);

/** Valid keys for per-skill override sections. */
export const SKILL_OVERRIDE_KEYS = new Set(["model", "enabled"]);

/**
 * Validate a [skills] configuration section.
 */
export function validateSkillsConfig(value: unknown, sectionName: string): SkillsConfig {
  if (typeof value !== "object" || value === null) {
    throw new Error(`[${sectionName}] must be a table`);
  }

  const raw = value as Record<string, unknown>;
  const result: SkillsConfig = {};

  for (const [key, val] of Object.entries(raw)) {
    if (key === "sources") {
      if (!Array.isArray(val)) {
        throw new Error(`[${sectionName}].sources must be an array`);
      }
      result.sources = val.map(String);
    } else if (key === "overrides") {
      if (typeof val !== "object" || val === null) {
        throw new Error(`[${sectionName}].overrides must be a table`);
      }
      result.overrides = {};
      for (const [skillName, override] of Object.entries(val as Record<string, unknown>)) {
        if (typeof override !== "object" || override === null) {
          throw new Error(`[${sectionName}].overrides.${skillName} must be a table`);
        }
        const overrideObj = override as Record<string, unknown>;
        const skillOverride: SkillOverrideConfig = {};
        for (const [oKey, oVal] of Object.entries(overrideObj)) {
          if (!SKILL_OVERRIDE_KEYS.has(oKey)) {
            throw new Error(`[${sectionName}].overrides.${skillName}: unknown key "${oKey}"`);
          }
          if (oKey === "model") skillOverride.model = String(oVal);
          if (oKey === "enabled") skillOverride.enabled = Boolean(oVal);
        }
        result.overrides[skillName] = skillOverride;
      }
    } else if (!SKILLS_CONFIG_KEYS.has(key)) {
      throw new Error(`[${sectionName}]: unknown key "${key}"`);
    }
  }

  return result;
}
