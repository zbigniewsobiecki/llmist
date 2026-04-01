/**
 * Filesystem-based skill discovery and loading.
 *
 * Scans directories for subdirectories containing SKILL.md files.
 * Supports standard discovery locations and custom directories.
 *
 * @module skills/loader
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSkillFile } from "./parser.js";
import { SkillRegistry } from "./registry.js";
import { Skill } from "./skill.js";
import type { SkillSource } from "./types.js";

/** Standard skill directory name within project or user config. */
const SKILLS_DIR_NAME = "skills";

/** Project config directory name. */
const CONFIG_DIR_NAME = ".llmist";

/**
 * Load skills from a directory.
 *
 * Recursively scans for subdirectories containing a SKILL.md file.
 * Each such directory is treated as a single skill.
 *
 * @param dir - Directory to scan
 * @param source - Origin for all discovered skills
 */
export function loadSkillsFromDirectory(
  dir: string,
  source: SkillSource,
  onWarning?: (msg: string) => void,
): Skill[] {
  if (!fs.existsSync(dir)) return [];

  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) return [];

  const skills: Skill[] = [];
  scanForSkills(dir, source, skills, onWarning);
  return skills;
}

/**
 * Discover skills from standard locations.
 *
 * Discovery order (later sources overwrite earlier on name collision):
 * 1. User skills: ~/.llmist/skills/
 * 2. Project skills: <projectDir>/.llmist/skills/
 * 3. Additional directories (explicit)
 */
export function discoverSkills(options?: {
  projectDir?: string;
  userDir?: string;
  additionalDirs?: string[];
}): SkillRegistry {
  const registry = new SkillRegistry();

  // 1. User-level skills
  const userSkillsDir =
    options?.userDir ?? path.join(os.homedir(), CONFIG_DIR_NAME, SKILLS_DIR_NAME);
  const userSkills = loadSkillsFromDirectory(userSkillsDir, {
    type: "user",
    path: userSkillsDir,
  });
  registry.registerMany(userSkills);

  // 2. Project-level skills (override user-level)
  if (options?.projectDir) {
    const projectSkillsDir = path.join(options.projectDir, CONFIG_DIR_NAME, SKILLS_DIR_NAME);
    const projectSkills = loadSkillsFromDirectory(projectSkillsDir, {
      type: "project",
      path: projectSkillsDir,
    });
    registry.registerMany(projectSkills);
  }

  // 3. Additional directories (override both)
  if (options?.additionalDirs) {
    for (const dir of options.additionalDirs) {
      const resolvedDir = dir.startsWith("~") ? path.join(os.homedir(), dir.slice(1)) : dir;
      const skills = loadSkillsFromDirectory(resolvedDir, {
        type: "directory",
        path: resolvedDir,
      });
      registry.registerMany(skills);
    }
  }

  return registry;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Recursively scan a directory for SKILL.md files.
 */
function scanForSkills(
  dir: string,
  source: SkillSource,
  results: Skill[],
  onWarning?: (msg: string) => void,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error: unknown) {
    onWarning?.(
      `Cannot read skill directory ${dir}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  // Check if this directory itself contains a SKILL.md
  const skillMdPath = path.join(dir, "SKILL.md");
  if (fs.existsSync(skillMdPath)) {
    try {
      const parsed = parseSkillFile(skillMdPath, source, false);
      results.push(new Skill(parsed));
    } catch (error: unknown) {
      onWarning?.(
        `Failed to parse ${skillMdPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      scanForSkills(path.join(dir, entry.name), source, results, onWarning);
    }
  }
}
