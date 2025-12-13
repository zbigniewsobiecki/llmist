/**
 * Subagent configuration resolution.
 *
 * Handles merging and resolving subagent configurations from multiple sources:
 * - Global `[subagents]` section
 * - Profile-level `[profile.subagents]` sections
 * - "inherit" keyword for model inheritance
 */

import type { SubagentConfig, SubagentConfigMap } from "../gadgets/types.js";

/**
 * Special model value indicating the subagent should inherit from parent agent.
 */
export const INHERIT_MODEL = "inherit";

/**
 * Global subagent configuration section from cli.toml.
 * Contains default-model and per-subagent configs.
 */
export interface GlobalSubagentConfig {
  /** Default model for all subagents ("inherit" or specific model) */
  "default-model"?: string;
  /** Per-subagent configurations */
  [subagentName: string]: SubagentConfig | string | undefined;
}

/**
 * Resolves a subagent's configuration by merging global and profile-level configs.
 *
 * Resolution priority (highest to lowest):
 * 1. Profile-level subagent config (`[profile.subagents.Name]`)
 * 2. Global subagent config (`[subagents.Name]`)
 * 3. Global default-model (`[subagents] default-model`)
 * 4. "inherit" (use parent model)
 *
 * @param subagentName - Name of the subagent (e.g., "BrowseWeb")
 * @param parentModel - Model used by the parent agent
 * @param profileConfig - Profile-level subagent config (from `[profile.subagents]`)
 * @param globalConfig - Global subagent config (from `[subagents]`)
 * @returns Resolved configuration with model resolved to actual value
 *
 * @example
 * ```typescript
 * const config = resolveSubagentConfig(
 *   "BrowseWeb",
 *   "gemini-2.5-flash",
 *   { BrowseWeb: { maxIterations: 30 } },
 *   { BrowseWeb: { model: "inherit", headless: true } }
 * );
 * // Result: { model: "gemini-2.5-flash", maxIterations: 30, headless: true }
 * ```
 */
export function resolveSubagentConfig(
  subagentName: string,
  parentModel: string,
  profileConfig?: SubagentConfigMap,
  globalConfig?: GlobalSubagentConfig,
): SubagentConfig {
  const resolved: SubagentConfig = {};

  // Get global defaults
  const globalDefaultModel = globalConfig?.["default-model"];
  const globalSubagent = extractSubagentConfig(globalConfig, subagentName);
  const profileSubagent = profileConfig?.[subagentName] ?? {};

  // Merge configs (profile overrides global)
  const merged = { ...globalSubagent, ...profileSubagent };

  // Resolve model with priority: merged > globalDefault > "inherit"
  const configModel = merged.model ?? globalDefaultModel ?? INHERIT_MODEL;

  // Apply "inherit" resolution
  resolved.model = configModel === INHERIT_MODEL ? parentModel : configModel;

  // Copy all other options (excluding model which we just resolved)
  for (const [key, value] of Object.entries(merged)) {
    if (key !== "model") {
      resolved[key] = value;
    }
  }

  return resolved;
}

/**
 * Builds a complete SubagentConfigMap with all subagents resolved.
 *
 * @param parentModel - Model used by the parent agent
 * @param profileConfig - Profile-level subagent configs
 * @param globalConfig - Global subagent configs
 * @returns Map of all resolved subagent configurations
 */
export function buildSubagentConfigMap(
  parentModel: string,
  profileConfig?: SubagentConfigMap,
  globalConfig?: GlobalSubagentConfig,
): SubagentConfigMap {
  // Collect all subagent names from both sources
  const subagentNames = new Set<string>();

  if (globalConfig) {
    for (const key of Object.keys(globalConfig)) {
      if (key !== "default-model" && typeof globalConfig[key] === "object") {
        subagentNames.add(key);
      }
    }
  }

  if (profileConfig) {
    for (const key of Object.keys(profileConfig)) {
      subagentNames.add(key);
    }
  }

  // Resolve each subagent
  const result: SubagentConfigMap = {};
  for (const name of subagentNames) {
    result[name] = resolveSubagentConfig(name, parentModel, profileConfig, globalConfig);
  }

  return result;
}

/**
 * Extracts SubagentConfig from GlobalSubagentConfig for a specific subagent.
 * Handles the fact that GlobalSubagentConfig has mixed types (string for default-model).
 */
function extractSubagentConfig(
  globalConfig: GlobalSubagentConfig | undefined,
  subagentName: string,
): SubagentConfig {
  if (!globalConfig) {
    return {};
  }

  const value = globalConfig[subagentName];
  if (typeof value === "object" && value !== null) {
    return value as SubagentConfig;
  }

  return {};
}
