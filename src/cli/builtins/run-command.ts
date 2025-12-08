import { z } from "zod";
import { createGadget } from "../../index.js";

/**
 * RunCommand gadget - Executes a shell command and returns its output.
 *
 * This gadget is intentionally simple with NO built-in safety measures.
 * Safety should be added externally via the hook system (see example 10).
 *
 * Output format follows the established pattern: `status=N\n\n<output>`
 */
export const runCommand = createGadget({
  name: "RunCommand",
  description:
    "Execute a shell command and return its output. Returns both stdout and stderr combined with the exit status.",
  schema: z.object({
    command: z.string().describe("The shell command to execute"),
    cwd: z
      .string()
      .optional()
      .describe("Working directory for the command (default: current directory)"),
    timeout: z
      .number()
      .default(30000)
      .describe("Timeout in milliseconds (default: 30000)"),
  }),
  examples: [
    {
      params: { command: "ls -la", timeout: 30000 },
      output:
        "status=0\n\ntotal 24\ndrwxr-xr-x  5 user  staff   160 Nov 27 10:00 .\ndrwxr-xr-x  3 user  staff    96 Nov 27 09:00 ..\n-rw-r--r--  1 user  staff  1024 Nov 27 10:00 package.json",
      comment: "List directory contents with details",
    },
    {
      params: { command: "echo 'Hello World'", timeout: 30000 },
      output: "status=0\n\nHello World",
      comment: "Simple echo command",
    },
    {
      params: { command: "cat nonexistent.txt", timeout: 30000 },
      output: "status=1\n\ncat: nonexistent.txt: No such file or directory",
      comment: "Command that fails returns non-zero status",
    },
    {
      params: { command: "pwd", cwd: "/tmp", timeout: 30000 },
      output: "status=0\n\n/tmp",
      comment: "Execute command in a specific directory",
    },
  ],
  execute: async ({ command, cwd, timeout }) => {
    const workingDir = cwd ?? process.cwd();

    try {
      // Use stdin-based execution to handle all special characters correctly
      // (quotes, backticks, newlines, parentheses) without shell escaping issues
      const proc = Bun.spawn(["sh"], {
        cwd: workingDir,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      // Write command to stdin (shell reads and executes it)
      const cmdWithNewline = command.endsWith("\n") ? command : command + "\n";
      proc.stdin.write(cmdWithNewline);
      proc.stdin.end();

      // Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          proc.kill();
          reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);
      });

      // Wait for process to complete or timeout
      const exitCode = await Promise.race([proc.exited, timeoutPromise]);

      // Collect output
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      // Combine output (stdout first, then stderr if any)
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();

      return `status=${exitCode}\n\n${output || "(no output)"}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `status=1\n\nerror: ${message}`;
    }
  },
});
