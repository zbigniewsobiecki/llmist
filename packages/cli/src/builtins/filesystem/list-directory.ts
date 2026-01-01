import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createGadget } from "llmist";
import { validatePathIsWithinCwd } from "./utils.js";

/**
 * Represents metadata for a file system entry
 */
interface FileEntry {
  name: string;
  relativePath: string;
  type: "file" | "directory" | "symlink";
  size: number;
  modified: number; // Unix epoch seconds
}

/**
 * Lists all files and directories in a given path with optional recursion.
 * Skips entries that cannot be accessed due to permissions.
 *
 * @param dirPath - Absolute path to the directory
 * @param basePath - Base path for calculating relative paths (defaults to dirPath)
 * @param maxDepth - Maximum depth to recurse (1 = immediate children only)
 * @param currentDepth - Current recursion depth (internal use)
 * @returns Array of file entries with metadata
 */
function listFiles(
  dirPath: string,
  basePath: string = dirPath,
  maxDepth: number = 1,
  currentDepth: number = 1,
): FileEntry[] {
  const entries: FileEntry[] = [];

  try {
    const items = fs.readdirSync(dirPath);

    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const relativePath = path.relative(basePath, fullPath);

      try {
        const stats = fs.lstatSync(fullPath);
        let type: "file" | "directory" | "symlink";
        let size: number;

        if (stats.isSymbolicLink()) {
          type = "symlink";
          size = 0;
        } else if (stats.isDirectory()) {
          type = "directory";
          size = 0;
        } else {
          type = "file";
          size = stats.size;
        }

        entries.push({
          name: item,
          relativePath,
          type,
          size,
          modified: Math.floor(stats.mtime.getTime() / 1000),
        });

        // Recurse into directories if we haven't reached max depth
        if (type === "directory" && currentDepth < maxDepth) {
          // Validate subdirectory is still within CWD (security check)
          try {
            validatePathIsWithinCwd(fullPath);
            const subEntries = listFiles(fullPath, basePath, maxDepth, currentDepth + 1);
            entries.push(...subEntries);
          } catch {
            // Skip directories outside CWD or inaccessible
          }
        }
      } catch {
        // Skip entries that can't be accessed (permission denied, etc.)
      }
    }
  } catch {
    // If we can't read the directory, return empty array
    return [];
  }

  return entries;
}

/**
 * Formats age from Unix epoch timestamp to human-readable string.
 * Uses compact format: 5m, 2h, 3d, 2w, 4mo, 1y
 *
 * @param epochSeconds - Unix timestamp in seconds
 * @returns Compact age string
 */
function formatAge(epochSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const seconds = now - epochSeconds;

  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(days / 365);
  return `${years}y`;
}

/**
 * Formats file entries as a compact pipe-separated DSL.
 * Format: #T|N|S|A header (Type, Name, Size, Age)
 * Optimized for LLM token efficiency (~70% savings vs table format).
 *
 * @param entries - Array of file entries to format
 * @returns Compact DSL string
 */
function formatEntriesAsString(entries: FileEntry[]): string {
  if (entries.length === 0) {
    return "#empty";
  }

  // Sort: directories first, then files, then symlinks, alphabetically within each
  const sortedEntries = [...entries].sort((a, b) => {
    const typeOrder = { directory: 0, file: 1, symlink: 2 };
    const typeCompare = typeOrder[a.type] - typeOrder[b.type];
    if (typeCompare !== 0) return typeCompare;
    return a.relativePath.localeCompare(b.relativePath);
  });

  // Type code mapping
  const typeCode: Record<FileEntry["type"], string> = {
    directory: "D",
    file: "F",
    symlink: "L",
  };

  // URL-encode special chars that would break parsing
  const encodeName = (name: string) => name.replace(/\|/g, "%7C").replace(/\n/g, "%0A");

  // Build compact output
  const header = "#T|N|S|A";
  const rows = sortedEntries.map(
    (e) => `${typeCode[e.type]}|${encodeName(e.relativePath)}|${e.size}|${formatAge(e.modified)}`,
  );

  return [header, ...rows].join("\n");
}

/**
 * ListDirectory gadget - Lists files and directories with full metadata.
 * All directory paths are validated to be within the current working directory.
 */
export const listDirectory = createGadget({
  name: "ListDirectory",
  description:
    "List files and directories in a directory with full details (names, types, sizes, modification dates). Use maxDepth to explore subdirectories recursively. The directory path must be within the current working directory or its subdirectories.",
  schema: z.object({
    directoryPath: z.string().default(".").describe("Path to the directory to list"),
    maxDepth: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(2)
      .describe(
        "Maximum depth to recurse (1 = immediate children only, 2 = include grandchildren, etc.)",
      ),
  }),
  examples: [
    {
      params: { directoryPath: ".", maxDepth: 1 },
      output: "path=. maxDepth=1\n\n#T|N|S|A\nD|src|0|2h\nD|tests|0|1d\nF|package.json|2841|3h",
      comment: "List current directory",
    },
    {
      params: { directoryPath: "src", maxDepth: 2 },
      output:
        "path=src maxDepth=2\n\n#T|N|S|A\nD|components|0|1d\nD|utils|0|2d\nF|index.ts|512|1h\nF|components/Button.tsx|1024|3h",
      comment: "List src directory recursively",
    },
  ],
  execute: ({ directoryPath, maxDepth }) => {
    // Validate path is within CWD
    const validatedPath = validatePathIsWithinCwd(directoryPath);

    // Verify it's actually a directory
    const stats = fs.statSync(validatedPath);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${directoryPath}`);
    }

    // List files and format output
    const entries = listFiles(validatedPath, validatedPath, maxDepth);
    const formattedList = formatEntriesAsString(entries);

    // Show params on first line, listing follows
    return `path=${directoryPath} maxDepth=${maxDepth}\n\n${formattedList}`;
  },
});
