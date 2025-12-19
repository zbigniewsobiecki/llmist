import chalk from "chalk";

/**
 * Renders a unified diff with ANSI colors.
 *
 * Color scheme:
 * - Added lines (+): green
 * - Removed lines (-): red
 * - Hunk headers (@@): cyan
 * - File headers (---/+++): bold
 * - Context lines: dim
 *
 * @param diff - Unified diff string
 * @returns Colorized diff string
 */
export function renderColoredDiff(diff: string): string {
  return diff
    .split("\n")
    .map((line) => {
      // File headers
      if (line.startsWith("---") || line.startsWith("+++")) {
        return chalk.bold(line);
      }
      // Added lines (but not +++ header)
      if (line.startsWith("+")) {
        return chalk.green(line);
      }
      // Removed lines (but not --- header)
      if (line.startsWith("-")) {
        return chalk.red(line);
      }
      // Hunk headers
      if (line.startsWith("@@")) {
        return chalk.cyan(line);
      }
      // Context lines and everything else
      return chalk.dim(line);
    })
    .join("\n");
}

/**
 * Formats a new file as a pseudo-diff showing all lines as additions.
 *
 * @param filePath - Path to the new file
 * @param content - Content of the new file
 * @returns Formatted pseudo-diff string
 */
export function formatNewFileDiff(filePath: string, content: string): string {
  const lines = content.split("\n");
  const header = `+++ ${filePath} (new file)`;
  const addedLines = lines.map((line) => `+ ${line}`).join("\n");
  return `${header}\n${addedLines}`;
}
