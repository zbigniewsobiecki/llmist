import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createGadget } from "../../../src/index.js";
import { validatePathIsWithinCwd } from "./utils.js";

/**
 * WriteFile gadget - Writes content to a file.
 * Creates parent directories if needed. Overwrites existing files.
 * All file paths are validated to be within the current working directory.
 */
export const writeFile = createGadget({
  name: "WriteFile",
  description:
    "Write content to a file. Creates parent directories if needed. Overwrites existing files. The file path must be within the current working directory or its subdirectories.",
  schema: z.object({
    filePath: z.string().describe("Path to the file to write (relative or absolute)"),
    content: z.string().describe("Content to write to the file"),
  }),
  examples: [
    {
      params: { filePath: "output.txt", content: "Hello, World!" },
      output: "path=output.txt\n\nWrote 13 bytes",
      comment: "Write a simple text file",
    },
    {
      params: { filePath: "data/config.json", content: '{"enabled": true}' },
      output: "path=data/config.json\n\nWrote 17 bytes (created directory: data)",
      comment: "Write file with auto-created directory",
    },
  ],
  execute: ({ filePath, content }) => {
    // Validate path is within CWD
    const validatedPath = validatePathIsWithinCwd(filePath);

    // Ensure parent directory exists (create if needed)
    const parentDir = path.dirname(validatedPath);
    let createdDir = false;
    if (!fs.existsSync(parentDir)) {
      // Validate parent dir is also within CWD before creating
      validatePathIsWithinCwd(parentDir);
      fs.mkdirSync(parentDir, { recursive: true });
      createdDir = true;
    }

    // Write the file
    fs.writeFileSync(validatedPath, content, "utf-8");
    const bytesWritten = Buffer.byteLength(content, "utf-8");

    // Format output following the established pattern
    const dirNote = createdDir ? ` (created directory: ${path.dirname(filePath)})` : "";
    return `path=${filePath}\n\nWrote ${bytesWritten} bytes${dirNote}`;
  },
});
