/**
 * Package manifest types for llmist gadget packages.
 *
 * These types define the structure of the `llmist` field in package.json
 * for gadget packages. This enables:
 * - Preset-based gadget loading
 * - Subagent discovery
 * - Factory function support
 * - Session management metadata
 *
 * @module package/manifest
 *
 * @example package.json
 * ```json
 * {
 *   "name": "dhalsim",
 *   "llmist": {
 *     "gadgets": "./dist/index.js",
 *     "factory": "./dist/index.js",
 *     "presets": {
 *       "minimal": ["Navigate", "GetFullPageContent"],
 *       "readonly": ["Navigate", "GetFullPageContent", "Screenshot"],
 *       "all": "*"
 *     },
 *     "subagents": {
 *       "BrowseWeb": {
 *         "entryPoint": "./dist/index.js",
 *         "export": "Dhalsim",
 *         "description": "Autonomous web browser agent",
 *         "defaultModel": "sonnet",
 *         "maxIterations": 15
 *       }
 *     },
 *     "session": {
 *       "factory": "getSessionManager",
 *       "type": "browser"
 *     }
 *   }
 * }
 * ```
 */

/**
 * Subagent definition in the manifest.
 */
export interface SubagentManifestEntry {
  /**
   * Entry point file path relative to package root.
   * @example "./dist/index.js"
   */
  entryPoint: string;

  /**
   * Export name from the entry point.
   * @example "Dhalsim" or "BrowseWeb"
   */
  export: string;

  /**
   * Human-readable description of what this subagent does.
   */
  description?: string;

  /**
   * List of gadget names this subagent uses internally.
   * Useful for documentation and dependency tracking.
   */
  uses?: string[];

  /**
   * Default model for this subagent.
   * Can be "inherit" to use parent's model.
   * @default "inherit"
   */
  defaultModel?: string;

  /**
   * Default maximum iterations.
   * @default 15
   */
  maxIterations?: number;
}

/**
 * Session factory metadata in the manifest.
 */
export interface SessionManifestEntry {
  /**
   * Export name of the session factory function.
   * @example "getSessionManager"
   */
  factory: string;

  /**
   * Type of session for categorization.
   * @example "browser", "api", "database"
   */
  type: string;
}

/**
 * Preset definition - either an array of gadget names or "*" for all.
 */
export type PresetDefinition = string[] | "*";

/**
 * llmist package manifest structure.
 *
 * This is the shape of the `llmist` field in package.json
 * for gadget packages.
 */
export interface LLMistPackageManifest {
  /**
   * Entry point for all gadgets.
   * The module should export gadgets or a gadgets array.
   * @example "./dist/index.js"
   */
  gadgets?: string;

  /**
   * Entry point for factory functions.
   * Should export `createGadgetsByPreset(preset)` and/or `createGadgetsByName(names)`.
   * @example "./dist/index.js"
   */
  factory?: string;

  /**
   * Subagent definitions.
   * Key is the subagent name as it appears in CLI config.
   */
  subagents?: Record<string, SubagentManifestEntry>;

  /**
   * Preset definitions.
   * Key is preset name, value is array of gadget names or "*" for all.
   * @example { "minimal": ["Navigate", "Screenshot"], "all": "*" }
   */
  presets?: Record<string, PresetDefinition>;

  /**
   * Session factory metadata.
   */
  session?: SessionManifestEntry;
}

/**
 * Factory function types that packages can export.
 */
export interface GadgetFactoryExports {
  /**
   * Create gadgets by preset name.
   */
  createGadgetsByPreset?: (preset: string, config?: unknown) => unknown;

  /**
   * Create gadgets by specific names.
   */
  createGadgetsByName?: (names: string[], config?: unknown) => unknown;

  /**
   * Create all gadgets with optional config.
   */
  createGadgets?: (config?: unknown) => unknown;
}

/**
 * Read and parse the llmist manifest from a package.json object.
 *
 * @param packageJson - Parsed package.json object
 * @returns Manifest or undefined if not present
 *
 * @example
 * ```typescript
 * import { readFileSync } from "fs";
 *
 * const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
 * const manifest = parseManifest(pkg);
 *
 * if (manifest?.presets?.minimal) {
 *   console.log("Minimal preset:", manifest.presets.minimal);
 * }
 * ```
 */
export function parseManifest(
  packageJson: Record<string, unknown>,
): LLMistPackageManifest | undefined {
  const llmist = packageJson.llmist;
  if (!llmist || typeof llmist !== "object") {
    return undefined;
  }
  return llmist as LLMistPackageManifest;
}

/**
 * Check if a manifest has a specific preset.
 */
export function hasPreset(
  manifest: LLMistPackageManifest | undefined,
  presetName: string,
): boolean {
  return manifest?.presets?.[presetName] !== undefined;
}

/**
 * Get gadget names for a preset.
 * Returns undefined if preset not found, empty array if preset is invalid.
 */
export function getPresetGadgets(
  manifest: LLMistPackageManifest | undefined,
  presetName: string,
): string[] | "*" | undefined {
  const preset = manifest?.presets?.[presetName];
  if (preset === undefined) return undefined;
  return preset;
}

/**
 * Check if a manifest has subagent definitions.
 */
export function hasSubagents(manifest: LLMistPackageManifest | undefined): boolean {
  return manifest?.subagents !== undefined && Object.keys(manifest.subagents).length > 0;
}

/**
 * Get subagent entry by name.
 */
export function getSubagent(
  manifest: LLMistPackageManifest | undefined,
  name: string,
): SubagentManifestEntry | undefined {
  return manifest?.subagents?.[name];
}

/**
 * List all subagent names in a manifest.
 */
export function listSubagents(manifest: LLMistPackageManifest | undefined): string[] {
  if (!manifest?.subagents) return [];
  return Object.keys(manifest.subagents);
}

/**
 * List all preset names in a manifest.
 */
export function listPresets(manifest: LLMistPackageManifest | undefined): string[] {
  if (!manifest?.presets) return [];
  return Object.keys(manifest.presets);
}
