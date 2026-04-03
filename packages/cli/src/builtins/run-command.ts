import { createGadget } from "llmist";
import { z } from "zod";
import { spawn } from "../spawn.js";

/**
 * RunCommand gadget - Executes a shell command and returns its output.
 *
 * Runs commands through `sh -c` so pipes, redirects, chaining,
 * and all shell features work naturally. LLMs write commands
 * exactly as they would type them in a terminal.
 *
 * Safety should be added externally via the hook system (see example 10).
 *
 * Output format follows the established pattern: `status=N\n\n<output>`
 */
export const runCommand = createGadget({
  name: "RunCommand",
  description:
    "Execute a shell command and return its output. Supports pipes (|), redirects (>, >>), chaining (&&, ||), and all shell features. Returns stdout/stderr combined with exit status.",
  schema: z.object({
    command: z
      .string()
      .describe("Shell command to execute (e.g., 'ls -la', 'echo hello | grep h')"),
    cwd: z
      .string()
      .optional()
      .describe("Working directory for the command (default: current directory)"),
    timeout: z.number().default(30000).describe("Timeout in milliseconds (default: 30000)"),
  }),
  examples: [
    {
      params: { command: "ls -la", timeout: 30000 },
      output:
        "status=0\n\ntotal 24\ndrwxr-xr-x  5 user  staff   160 Nov 27 10:00 .\ndrwxr-xr-x  3 user  staff    96 Nov 27 09:00 ..\n-rw-r--r--  1 user  staff  1024 Nov 27 10:00 package.json",
      comment: "List directory contents",
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
    {
      params: {
        command:
          'curl -X POST --header \'Content-Type: application/json\' --data \'{"key": "value", "count": 42}\' https://api.example.com/items',
        timeout: 30000,
      },
      output: 'status=0\n\n{"id": "abc123", "created": true}',
      comment: "Complex flags with JSON data - just write the command naturally",
    },
    {
      params: { command: "echo 'hello world' | tr 'h' 'H'", timeout: 30000 },
      output: "status=0\n\nHello world",
      comment: "Piping output between commands",
    },
    {
      params: {
        command: "echo 'content' > /tmp/test.txt && cat /tmp/test.txt",
        timeout: 30000,
      },
      output: "status=0\n\ncontent",
      comment: "File redirection and chaining with &&",
    },
  ],
  execute: async ({ command, cwd, timeout }) => {
    const workingDir = cwd ?? process.cwd();

    if (!command) {
      return "status=1\n\nerror: command cannot be empty";
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      // Run through shell so pipes, redirects, and chaining work
      const proc = spawn(["sh", "-c", command], {
        cwd: workingDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Create a timeout promise with cleanup
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          proc.kill();
          reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);
      });

      // Wait for process and consume streams concurrently to prevent deadlock.
      // If we await proc.exited first, large output can fill pipe buffers,
      // causing the process to block on write while we block on exit.
      const [exitCode, stdout, stderr] = await Promise.race([
        Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]),
        timeoutPromise,
      ]);

      // Clear timeout on normal exit to prevent dangling timer
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Combine output (stdout first, then stderr if any)
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();

      return `status=${exitCode}\n\n${output || "(no output)"}`;
    } catch (error) {
      // Clear timeout on error path too
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      const message = error instanceof Error ? error.message : String(error);
      return `status=1\n\nerror: ${message}`;
    }
  },
});
