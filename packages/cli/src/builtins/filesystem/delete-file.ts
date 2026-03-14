import fs from "node:fs";
import { createGadget } from "llmist";
import { z } from "zod";
import { validatePathIsWithinCwd } from "./utils.js";

/**
 * DeleteFile gadget - Deletes a file or directory.
 * All paths are validated to be within the current working directory.
 */
export const deleteFile = createGadget({
  name: "DeleteFile",
  description:
    "Delete a file or directory from the local filesystem. The path must be within the current working directory or its subdirectories.",
  maxConcurrent: 1, // Sequential execution to prevent race conditions
  schema: z.object({
    filePath: z.string().describe("Path to the file or directory to delete (relative or absolute)"),
    recursive: z
      .boolean()
      .optional()
      .default(false)
      .describe("If true, perform a recursive deletion (required for directories)"),
  }),
  examples: [
    {
      params: { filePath: "temp.txt", recursive: false },
      output: "path=temp.txt\n\nDeleted file successfully",
      comment: "Delete a single file",
    },
    {
      params: { filePath: "tmp-dir", recursive: true },
      output: "path=tmp-dir\n\nDeleted directory successfully",
      comment: "Delete a directory and its contents",
    },
  ],
  execute: ({ filePath, recursive }) => {
    // Validate path is within CWD
    const validatedPath = validatePathIsWithinCwd(filePath);

    // Check if it exists
    if (!fs.existsSync(validatedPath)) {
      return `Error: Path does not exist: ${filePath}`;
    }

    const stats = fs.statSync(validatedPath);
    const isDirectory = stats.isDirectory();

    if (isDirectory && !recursive) {
      return `Error: ${filePath} is a directory. Set recursive=true to delete it.`;
    }

    // Delete the file or directory
    fs.rmSync(validatedPath, { recursive, force: true });

    // Format output following the established pattern
    const type = isDirectory ? "directory" : "file";
    return `path=${filePath}\n\nDeleted ${type} successfully`;
  },
});
