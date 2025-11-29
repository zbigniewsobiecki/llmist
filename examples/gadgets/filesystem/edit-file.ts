import { z } from "zod";
import { createGadget } from "../../../src/index.js";
import { validatePathIsWithinCwd } from "./utils.js";

/**
 * EditFile gadget - Edit files using ed commands.
 * Shell escape commands (!) are filtered for security.
 */
function filterDangerousCommands(commands: string): string {
  return commands
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("!"))
    .join("\n");
}

export const editFile = createGadget({
  name: "EditFile",
  description:
    "Edit a file using ed commands. Ed is a line-oriented text editor - pipe commands to it for precise file modifications. Commands are executed in sequence. Remember to end with 'w' (write) and 'q' (quit). Shell escape commands (!) are filtered for security.",
  schema: z.object({
    filePath: z.string().describe("Path to the file to edit (relative or absolute)"),
    commands: z.string().describe("Ed commands to execute, one per line"),
  }),
  examples: [
    {
      params: {
        filePath: "config.txt",
        commands: "1,$p\nq",
      },
      output: "path=config.txt\n\n32\nkey=value\noption=true",
      comment: "Print entire file contents (ed shows byte count, then content)",
    },
    {
      params: {
        filePath: "data.txt",
        commands: "1,$s/foo/bar/g\nw\nq",
      },
      output: "path=data.txt\n\n42\n42",
      comment: "Replace all 'foo' with 'bar' (ed shows bytes read, then bytes written)",
    },
    {
      params: {
        filePath: "list.txt",
        commands: "3d\nw\nq",
      },
      output: "path=list.txt\n\n45\n28",
      comment: "Delete line 3, save and quit",
    },
    {
      params: {
        filePath: "readme.txt",
        commands: "$a\nNew last line\n.\nw\nq",
      },
      output: "path=readme.txt\n\n40\n56",
      comment: "Append text after last line ($ = last line, . = end input mode)",
    },
  ],
  timeoutMs: 30000,
  execute: async ({ filePath, commands }) => {
    const validatedPath = validatePathIsWithinCwd(filePath);
    const safeCommands = filterDangerousCommands(commands);

    try {
      const proc = Bun.spawn(["ed", validatedPath], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      // Write commands to ed's stdin
      proc.stdin.write(`${safeCommands}\n`);
      proc.stdin.end();

      // Create timeout promise (30 seconds)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          proc.kill();
          reject(new Error("ed command timed out after 30000ms"));
        }, 30000);
      });

      // Wait for process to complete or timeout
      const exitCode = await Promise.race([proc.exited, timeoutPromise]);

      // Collect output
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();

      if (exitCode !== 0) {
        return `path=${filePath}\n\n${output || "ed exited with non-zero status"}`;
      }

      return `path=${filePath}\n\n${output || "(no output)"}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `path=${filePath}\n\nerror: ${message}`;
    }
  },
});
