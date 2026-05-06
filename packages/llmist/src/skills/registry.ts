/**
 * SkillRegistry — manages skill discovery, lookup, and metadata summaries.
 *
 * Parallel to GadgetRegistry but with different semantics: skills are not
 * executable tools registered with the LLM directly. They are available
 * for activation by the agent or user, surfaced via metadata summaries.
 *
 * @module skills/registry
 */

import { minimatch } from "minimatch";
import type { Skill } from "./skill.js";

/** Default character budget for metadata summaries (~1% of 200K context). */
const DEFAULT_CHAR_BUDGET = 8_000;

/** Maximum description length in summaries to keep them concise. */
const SUMMARY_DESCRIPTION_LIMIT = 250;

export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  /**
   * Register a skill. Overwrites any existing skill with the same name.
   *
   * Unlike GadgetRegistry (which throws on duplicates), SkillRegistry allows
   * overwriting because skills are loaded from multiple sources with intentional
   * priority ordering (project > user > default).
   */
  register(skill: Skill): void {
    this.skills.set(skill.name.toLowerCase(), skill);
  }

  /** Register multiple skills. */
  registerMany(skills: Skill[]): void {
    for (const skill of skills) {
      this.register(skill);
    }
  }

  /** Remove a skill by name (case-insensitive). Returns true if removed. */
  remove(name: string): boolean {
    return this.skills.delete(name.toLowerCase());
  }

  /** Remove all registered skills. */
  clear(): void {
    this.skills.clear();
  }

  /** Get a skill by name (case-insensitive). */
  get(name: string): Skill | undefined {
    return this.skills.get(name.toLowerCase());
  }

  /** Check if a skill exists by name (case-insensitive). */
  has(name: string): boolean {
    return this.skills.has(name.toLowerCase());
  }

  /** Get all registered skills. */
  getAll(): Skill[] {
    return [...this.skills.values()];
  }

  /** Get all skill names. */
  getNames(): string[] {
    return [...this.skills.keys()];
  }

  /** Number of registered skills. */
  get size(): number {
    return this.skills.size;
  }

  /**
   * Get skills that are visible to the LLM for auto-triggering.
   * Excludes skills with disableModelInvocation: true.
   */
  getModelInvocable(): Skill[] {
    return this.getAll().filter((s) => s.isModelInvocable);
  }

  /**
   * Get skills that the user can invoke via /skill-name.
   * Excludes skills with userInvocable: false.
   */
  getUserInvocable(): Skill[] {
    return this.getAll().filter((s) => s.isUserInvocable);
  }

  /**
   * Generate metadata summaries for system prompt injection (Tier 1).
   *
   * Each skill contributes a one-line summary: "name — description".
   * Output is truncated to fit the character budget.
   *
   * @param charBudget - Maximum characters for all summaries combined.
   */
  getMetadataSummaries(charBudget = DEFAULT_CHAR_BUDGET): string {
    const invocable = this.getModelInvocable();
    if (invocable.length === 0) return "";

    const lines: string[] = [];
    let totalChars = 0;

    for (const skill of invocable) {
      const desc =
        skill.description.length > SUMMARY_DESCRIPTION_LIMIT
          ? `${skill.description.slice(0, SUMMARY_DESCRIPTION_LIMIT - 3)}...`
          : skill.description;

      const line = `- ${skill.name}: ${desc}`;

      if (totalChars + line.length > charBudget) break;

      lines.push(line);
      totalChars += line.length + 1; // +1 for newline
    }

    return lines.join("\n");
  }

  /**
   * Find skills whose `paths` patterns match a given file path.
   * Used for auto-activation when the user is working on specific files.
   */
  findByFilePath(filePath: string): Skill[] {
    return this.getModelInvocable().filter((skill) => {
      const patterns = skill.metadata.paths;
      if (!patterns || patterns.length === 0) return false;
      return patterns.some((pattern) => minimatch(filePath, pattern));
    });
  }

  /**
   * Merge another registry into this one.
   * Skills from the other registry overwrite existing skills with the same name.
   */
  merge(other: SkillRegistry): void {
    for (const skill of other.getAll()) {
      this.register(skill);
    }
  }

  /** Create a registry from an array of skills. */
  static from(skills: Skill[]): SkillRegistry {
    const registry = new SkillRegistry();
    registry.registerMany(skills);
    return registry;
  }
}
