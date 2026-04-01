/**
 * Core type definitions for the Skills system.
 *
 * Skills follow the Agent Skills open standard (agentskills.io) — markdown-based
 * instruction packages that extend agent capabilities through prompt injection
 * and context management, not code execution.
 *
 * Three-tier progressive disclosure:
 * - Tier 1 (metadata): ~100 tokens, always loaded for discovery
 * - Tier 2 (instructions): <5K tokens, loaded on activation
 * - Tier 3 (resources): unlimited, loaded on demand
 *
 * @module skills/types
 */

import type { AbstractGadget } from "../gadgets/gadget.js";

/**
 * Parsed YAML frontmatter from a SKILL.md file.
 * Follows the Agent Skills open standard with llmist-specific extensions.
 */
export interface SkillMetadata {
  /** Skill identifier. Lowercase letters, numbers, hyphens only. Max 64 chars. */
  name: string;

  /** What the skill does and when to use it. Max 1024 chars. Used for auto-triggering. */
  description: string;

  /** Hint shown during autocomplete, e.g., "[issue-number]" or "<filename> [format]". */
  argumentHint?: string;

  /** Tools the agent can use when this skill is active. */
  allowedTools?: string[];

  /** Model override when skill is active, e.g., "sonnet", "flash". */
  model?: string;

  /** Execution context. "fork" runs in an isolated subagent. */
  context?: "fork" | "inline";

  /** Subagent type for fork mode, e.g., "Explore", "Plan", "general-purpose". */
  agent?: string;

  /** Glob patterns for auto-activation based on files being worked on. */
  paths?: string[];

  /** Bundled gadget specifiers loaded when skill activates. */
  gadgets?: string[];

  /** If true, only the user can invoke this skill (LLM cannot auto-trigger). */
  disableModelInvocation?: boolean;

  /** If false, skill is background knowledge only — hidden from user invocation. */
  userInvocable?: boolean;

  /** Shell for !`command` preprocessing. */
  shell?: "bash" | "powershell";

  /** Semantic version number. */
  version?: string;
}

/**
 * A resource file within a skill's directory (Tier 3).
 */
export interface SkillResource {
  /** Path relative to the skill directory. */
  relativePath: string;

  /** Absolute path on disk. */
  absolutePath: string;

  /** Category based on parent directory. */
  category: "scripts" | "references" | "assets";
}

/**
 * Where a skill was discovered from.
 */
export type SkillSource =
  | { type: "project"; path: string }
  | { type: "user"; path: string }
  | { type: "npm"; package: string }
  | { type: "git"; url: string }
  | { type: "directory"; path: string };

/**
 * Fully parsed skill representation (all three tiers).
 */
export interface ParsedSkill {
  /** Tier 1: Always-loaded metadata from frontmatter. */
  metadata: SkillMetadata;

  /** Tier 2: Full SKILL.md body. null if not yet loaded. */
  instructions: string | null;

  /** Tier 3: Discovered resource manifests. */
  resources: SkillResource[];

  /** Absolute path to the SKILL.md file. */
  sourcePath: string;

  /** Directory containing the skill. */
  sourceDir: string;

  /** Origin for debugging and priority resolution. */
  source: SkillSource;
}

/**
 * Result of activating a skill.
 */
export interface SkillActivation {
  /** The skill that was activated. */
  skillName: string;

  /** Resolved instructions after $ARGUMENTS substitution and !`command` preprocessing. */
  resolvedInstructions: string;

  /** Gadgets made available by this skill (if any). */
  gadgets: AbstractGadget[];

  /** Resources loaded for this activation (Tier 3). Keyed by relative path. */
  loadedResources: Map<string, string>;
}

/**
 * Options for skill activation.
 */
export interface SkillActivationOptions {
  /** Arguments passed to the skill (substituted into $ARGUMENTS, $0, $1, etc.). */
  arguments?: string;

  /** Whether to load Tier 3 resources eagerly. Default: false. */
  eagerResources?: boolean;

  /** Working directory for !`command` preprocessing. */
  cwd?: string;

  /** Whether to execute !`command` preprocessing. Default: true. */
  enableShellPreprocessing?: boolean;

  /** Timeout for !`command` execution in milliseconds. Default: 10000. */
  shellTimeoutMs?: number;
}
