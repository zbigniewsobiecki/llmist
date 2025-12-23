import { homedir } from "node:os";

/**
 * Expands tilde (~) to the user's home directory in a path string.
 * Only expands tildes at the start of the path.
 *
 * @param path - Path that may start with ~
 * @returns Path with leading ~ expanded to home directory
 *
 * @example
 * expandTildePath("~/.config/app") // "/Users/john/.config/app"
 * expandTildePath("/var/log")      // "/var/log" (unchanged)
 * expandTildePath("./relative")    // "./relative" (unchanged)
 */
export function expandTildePath(path: string): string {
  if (!path.startsWith("~")) {
    return path;
  }
  return path.replace(/^~/, homedir());
}
