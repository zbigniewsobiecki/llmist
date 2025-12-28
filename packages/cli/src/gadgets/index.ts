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

// Filesystem & system gadgets (camelCase instances)
export { listDirectory, readFile, writeFile, editFile, runCommand } from "../builtins/index.js";

// PascalCase aliases (matching gadget names for convenient imports)
export { listDirectory as ListDirectory } from "../builtins/index.js";
export { readFile as ReadFile } from "../builtins/index.js";
export { writeFile as WriteFile } from "../builtins/index.js";
export { editFile as EditFile } from "../builtins/index.js";
export { runCommand as RunCommand } from "../builtins/index.js";

// Filesystem utilities for custom sandboxed gadgets
export { PathSandboxException, validatePathIsWithinCwd } from "../builtins/filesystem/utils.js";
