/**
 * SKILL.md parser for the Agent Skills open standard.
 *
 * Parses YAML frontmatter (between --- markers) and markdown body.
 * Scans skill directories for Tier 3 resources (scripts/, references/, assets/).
 *
 * @module skills/parser
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { ParsedSkill, SkillMetadata, SkillResource, SkillSource } from "./types.js";

/** Resource subdirectory categories. */
const RESOURCE_CATEGORIES = ["scripts", "references", "assets"] as const;

/** Maximum allowed length for skill name. */
const MAX_NAME_LENGTH = 64;

/** Maximum allowed length for skill description. */
const MAX_DESCRIPTION_LENGTH = 1024;

/** Pattern for valid skill names: lowercase letters, numbers, hyphens. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Parse YAML frontmatter from SKILL.md content.
 *
 * Extracts the YAML block between the first pair of `---` markers
 * and the remaining markdown body.
 */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return { frontmatter: {}, body: content };
  }

  // Find the closing ---
  const endIndex = trimmed.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  const yamlBlock = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 4).trim();

  const parsed = yaml.load(yamlBlock);
  const frontmatter =
    typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};

  return { frontmatter, body };
}

/**
 * Convert raw frontmatter to validated SkillMetadata.
 *
 * Maps kebab-case YAML keys to camelCase TypeScript properties.
 * Falls back to directory name for missing name field.
 */
export function parseMetadata(
  frontmatter: Record<string, unknown>,
  fallbackName?: string,
): SkillMetadata {
  const name = parseString(frontmatter.name) ?? fallbackName ?? "unnamed-skill";
  const description = parseString(frontmatter.description) ?? "";

  return {
    name,
    description,
    argumentHint: parseString(frontmatter["argument-hint"]),
    allowedTools: parseStringArray(frontmatter["allowed-tools"]),
    model: parseString(frontmatter.model),
    context: parseContext(frontmatter.context),
    agent: parseString(frontmatter.agent),
    paths: parseStringArray(frontmatter.paths),
    gadgets: parseStringArray(frontmatter.gadgets),
    disableModelInvocation: parseBool(frontmatter["disable-model-invocation"]),
    userInvocable: parseBool(frontmatter["user-invocable"]),
    shell: parseShell(frontmatter.shell),
    version: parseString(frontmatter.version),
  };
}

/**
 * Scan a skill directory for Tier 3 resource files.
 */
export function scanResources(skillDir: string): SkillResource[] {
  const resources: SkillResource[] = [];

  for (const category of RESOURCE_CATEGORIES) {
    const categoryDir = path.join(skillDir, category);
    if (!fs.existsSync(categoryDir)) continue;

    const stat = fs.statSync(categoryDir);
    if (!stat.isDirectory()) continue;

    for (const file of walkDirectory(categoryDir)) {
      resources.push({
        relativePath: path.relative(skillDir, file),
        absolutePath: file,
        category,
      });
    }
  }

  return resources;
}

/**
 * Parse a SKILL.md file from disk.
 *
 * This performs Tier 1 parsing (metadata) and optionally Tier 2 (instructions).
 * Resources are discovered but not loaded.
 *
 * @param skillMdPath - Absolute path to SKILL.md
 * @param source - Where this skill was discovered from
 * @param loadInstructions - Whether to load Tier 2 body (default: false for lazy loading)
 */
export function parseSkillFile(
  skillMdPath: string,
  source: SkillSource,
  loadInstructions = false,
): ParsedSkill {
  const content = fs.readFileSync(skillMdPath, "utf-8");
  return parseSkillContent(content, skillMdPath, source, loadInstructions);
}

/**
 * Parse SKILL.md content from a string.
 *
 * Useful for testing without filesystem access.
 */
export function parseSkillContent(
  content: string,
  sourcePath: string,
  source: SkillSource,
  loadInstructions = false,
): ParsedSkill {
  const sourceDir = path.dirname(sourcePath);
  const fallbackName = path.basename(sourceDir);

  const { frontmatter, body } = parseFrontmatter(content);
  const metadata = parseMetadata(frontmatter, fallbackName);
  const resources = fs.existsSync(sourceDir) ? scanResources(sourceDir) : [];

  return {
    metadata,
    instructions: loadInstructions ? body : null,
    resources,
    sourcePath,
    sourceDir,
    source,
  };
}

/**
 * Validate skill metadata.
 * Returns an array of validation issues (empty if valid).
 */
export function validateMetadata(metadata: SkillMetadata): string[] {
  const issues: string[] = [];

  if (!metadata.name) {
    issues.push("Skill name is required");
  } else {
    if (metadata.name.length > MAX_NAME_LENGTH) {
      issues.push(`Skill name exceeds ${MAX_NAME_LENGTH} characters`);
    }
    if (!NAME_PATTERN.test(metadata.name)) {
      issues.push(
        "Skill name must contain only lowercase letters, numbers, and hyphens, " +
          "and must start with a letter or number",
      );
    }
  }

  if (!metadata.description) {
    issues.push("Skill description is required");
  } else if (metadata.description.length > MAX_DESCRIPTION_LENGTH) {
    issues.push(`Skill description exceeds ${MAX_DESCRIPTION_LENGTH} characters`);
  }

  if (metadata.context && metadata.context !== "fork" && metadata.context !== "inline") {
    issues.push('Skill context must be "fork" or "inline"');
  }

  return issues;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Safely extract a string value, rejecting objects/arrays. */
function parseString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined; // Reject objects, arrays, etc. instead of "[object Object]"
}

function parseStringArray(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v === "string" || typeof v === "number").map(String);
  }
  if (typeof value === "string") return [value];
  return undefined;
}

function parseContext(value: unknown): "fork" | "inline" | undefined {
  if (value === "fork" || value === "inline") return value;
  return undefined;
}

function parseShell(value: unknown): "bash" | "powershell" | undefined {
  if (value === "bash" || value === "powershell") return value;
  return undefined;
}

function parseBool(value: unknown): boolean | undefined {
  if (value === true || value === false) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/** Recursively walk a directory and yield file paths. */
function* walkDirectory(dir: string): Generator<string> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkDirectory(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}
