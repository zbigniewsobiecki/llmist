/**
 * Filesystem gadgets for secure file operations.
 *
 * All operations are sandboxed to the current working directory
 * to prevent directory traversal attacks.
 */

export { readFile } from "./read-file.js";
export { writeFile } from "./write-file.js";
export { editFile } from "./edit-file.js";
export { listDirectory } from "./list-directory.js";
export { PathSandboxException, validatePathIsWithinCwd } from "./utils.js";
