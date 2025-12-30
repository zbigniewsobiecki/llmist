import { spawn } from "node:child_process";
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
        commands: `1,$p
q`,
      },
      output: "path=config.txt\n\n32\nkey=value\noption=true",
      comment: "Print entire file contents (ed shows byte count, then content)",
    },
    {
      params: {
        filePath: "data.txt",
        commands: `1,$s/foo/bar/g
w
q`,
      },
      output: "path=data.txt\n\n42\n42",
      comment: "Replace all 'foo' with 'bar' (ed shows bytes read, then bytes written)",
    },
    {
      params: {
        filePath: "list.txt",
        commands: `3d
w
q`,
      },
      output: "path=list.txt\n\n45\n28",
      comment: "Delete line 3, save and quit",
    },
    {
      params: {
        filePath: "readme.txt",
        commands: `$a
New last line
.
w
q`,
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
      const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>(
        (resolve, reject) => {
          const proc = spawn("ed", [validatedPath], {
            stdio: ["pipe", "pipe", "pipe"],
          });

          let stdout = "";
          let stderr = "";

          proc.stdout?.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
          });

          proc.stderr?.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
          });

          // Timeout after 30 seconds
          const timeout = setTimeout(() => {
            proc.kill();
            reject(new Error("ed command timed out after 30000ms"));
          }, 30000);

          proc.on("exit", (code) => {
            clearTimeout(timeout);
            resolve({ exitCode: code ?? 1, stdout, stderr });
          });

          proc.on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });

          // Write commands to ed's stdin
          proc.stdin?.write(`${safeCommands}\n`);
          proc.stdin?.end();
        },
      );

      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

      if (result.exitCode !== 0) {
        return `path=${filePath}\n\n${output || "ed exited with non-zero status"}`;
      }

      return `path=${filePath}\n\n${output || "(no output)"}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `path=${filePath}\n\nerror: ${message}`;
    }
  },
});
