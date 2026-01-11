/**
 * Built-in CLI gadgets for programmatic use.
 *
 * @example
 * ```typescript
 * import { ReadFile, WriteFile, RunCommand } from '@llmist/cli/gadgets';
 * import { AgentBuilder } from 'llmist';
 *
 * const agent = new AgentBuilder()
 *   .withGadgets(ReadFile, WriteFile, RunCommand)
 *   .ask('Read the config file');
 * ```
 *
 * @module @llmist/cli/gadgets
 */

// Filesystem utilities for custom sandboxed gadgets
export { PathSandboxException, validatePathIsWithinCwd } from "../builtins/filesystem/utils.js";
// Filesystem & system gadgets (camelCase instances)
// PascalCase aliases (matching gadget names for convenient imports)
export {
  editFile,
  editFile as EditFile,
  listDirectory,
  listDirectory as ListDirectory,
  readFile,
  readFile as ReadFile,
  runCommand,
  runCommand as RunCommand,
  writeFile,
  writeFile as WriteFile,
} from "../builtins/index.js";
