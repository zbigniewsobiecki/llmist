import fs from "node:fs";
import path from "node:path";

/**
 * Exception thrown when a path validation fails due to sandbox constraints.
 * This ensures all file operations are restricted to the current working directory.
 */
export class PathSandboxException extends Error {
  constructor(inputPath: string, reason: string) {
    super(`Path access denied: ${inputPath}. ${reason}`);
    this.name = "PathSandboxException";
  }
}

/**
 * Validates that a given path is within the current working directory.
 * This prevents directory traversal attacks and ensures all file operations
 * are sandboxed to the CWD and its subdirectories.
 *
 * @param inputPath - Path to validate (can be relative or absolute)
 * @returns The validated absolute path
 * @throws PathSandboxException if the path is outside the CWD
 * @throws Error for other file system errors
 */
export function validatePathIsWithinCwd(inputPath: string): string {
  const cwd = process.cwd();
  const resolvedPath = path.resolve(cwd, inputPath);

  // Resolve CWD through realpathSync to handle platform symlinks
  // (e.g. macOS: /var → /private/var) so the comparison is consistent
  let realCwd: string;
  try {
    realCwd = fs.realpathSync(cwd);
  } catch {
    realCwd = cwd;
  }

  // Try to get the real path to handle symlinks securely
  let finalPath: string;
  try {
    finalPath = fs.realpathSync(resolvedPath);
  } catch (error) {
    // If path doesn't exist, resolve against realCwd so the comparison is
    // consistent on platforms where CWD itself contains symlinks (e.g. macOS
    // /var → /private/var).  Using the raw `resolvedPath` (based on `cwd`)
    // would produce a path that doesn't start with `realCwd`, falsely
    // rejecting valid new-file paths.
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      finalPath = path.resolve(realCwd, inputPath);
    } else {
      // Re-throw other errors (permission denied, etc.)
      throw error;
    }
  }

  // Ensure the path is within CWD or is CWD itself
  // Use path.sep to prevent matching partial directory names
  const cwdWithSep = realCwd + path.sep;
  if (!finalPath.startsWith(cwdWithSep) && finalPath !== realCwd) {
    throw new PathSandboxException(inputPath, "Path is outside the current working directory");
  }

  return finalPath;
}
