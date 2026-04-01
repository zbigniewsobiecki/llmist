/**
 * Skills system — Agent Skills open standard (agentskills.io) support.
 *
 * Skills are markdown-based instruction packages that extend agent capabilities
 * through prompt injection and context management. They use three-tier
 * progressive disclosure to manage context window budget.
 *
 * @module skills
 */

// Activation logic
export {
  preprocessShellCommands,
  resolveInstructions,
  substituteArguments,
  substituteVariables,
} from "./activation.js";
// Filesystem loader
export { discoverSkills, loadSkillsFromDirectory } from "./loader.js";

// SKILL.md parser
export {
  parseFrontmatter,
  parseMetadata,
  parseSkillContent,
  parseSkillFile,
  scanResources,
  validateMetadata,
} from "./parser.js";
// Registry
export { SkillRegistry } from "./registry.js";
// Skill class
export { Skill } from "./skill.js";
// Core types
export type {
  ParsedSkill,
  SkillActivation,
  SkillActivationOptions,
  SkillMetadata,
  SkillResource,
  SkillSource,
} from "./types.js";

// UseSkill meta-gadget
export { createUseSkillGadget, USE_SKILL_GADGET_NAME } from "./use-skill-gadget.js";
