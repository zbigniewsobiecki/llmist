/**
 * Package manifest utilities.
 *
 * @module package
 */

export type {
  GadgetFactoryExports,
  LLMistPackageManifest,
  PresetDefinition,
  SessionManifestEntry,
  SubagentManifestEntry,
} from "./manifest.js";

export {
  getPresetGadgets,
  getSubagent,
  hasPreset,
  hasSubagents,
  listPresets,
  listSubagents,
  parseManifest,
} from "./manifest.js";
