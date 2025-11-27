import fs from "fs";
import path from "path";

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

  // Try to get the real path to handle symlinks securely
  let finalPath: string;
  try {
    finalPath = fs.realpathSync(resolvedPath);
  } catch (error) {
    // If path doesn't exist, use the resolved path for validation
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      finalPath = resolvedPath;
    } else {
      // Re-throw other errors (permission denied, etc.)
      throw error;
    }
  }

  // Ensure the path is within CWD or is CWD itself
  // Use path.sep to prevent matching partial directory names
  const cwdWithSep = cwd + path.sep;
  if (!finalPath.startsWith(cwdWithSep) && finalPath !== cwd) {
    throw new PathSandboxException(
      inputPath,
      "Path is outside the current working directory"
    );
  }

  return finalPath;
}
