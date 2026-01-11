import fs from "node:fs";
import { createGadget } from "llmist";
import { z } from "zod";
import { validatePathIsWithinCwd } from "./utils.js";

/**
 * ReadFile gadget - Reads the entire content of a file and returns it as text.
 * All file paths are validated to be within the current working directory.
 */
export const readFile = createGadget({
  name: "ReadFile",
  description:
    "Read the entire content of a file and return it as text. The file path must be within the current working directory or its subdirectories.",
  schema: z.object({
    filePath: z.string().describe("Path to the file to read (relative or absolute)"),
  }),
  examples: [
    {
      params: { filePath: "package.json" },
      output: 'path=package.json\n\n{\n  "name": "my-project",\n  "version": "1.0.0"\n  ...\n}',
      comment: "Read a JSON config file",
    },
    {
      params: { filePath: "src/index.ts" },
      output: "path=src/index.ts\n\nexport function main() { ... }",
      comment: "Read a source file",
    },
  ],
  execute: ({ filePath }) => {
    // Validate path is within CWD
    const validatedPath = validatePathIsWithinCwd(filePath);

    // Read and return file content
    const content = fs.readFileSync(validatedPath, "utf-8");

    // Show params on first line, content follows
    return `path=${filePath}\n\n${content}`;
  },
});
