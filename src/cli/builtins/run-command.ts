import { z } from "zod";
import { createGadget } from "../../index.js";

/**
 * RunCommand gadget - Executes a command with arguments and returns its output.
 *
 * Uses argv array to bypass shell interpretation entirely - arguments are
 * passed directly to the process without any escaping or shell expansion.
 * This allows special characters (quotes, backticks, newlines) to work correctly.
 *
 * Safety should be added externally via the hook system (see example 10).
 *
 * Output format follows the established pattern: `status=N\n\n<output>`
 */
export const runCommand = createGadget({
  name: "RunCommand",
  description:
    "Execute a command with arguments and return its output. Uses argv array to bypass shell - arguments are passed directly without interpretation. Returns stdout/stderr combined with exit status.",
  schema: z.object({
    argv: z
      .array(z.string())
      .describe("Command and arguments as array (e.g., ['git', 'commit', '-m', 'message'])"),
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
      params: { argv: ["ls", "-la"], timeout: 30000 },
      output:
        "status=0\n\ntotal 24\ndrwxr-xr-x  5 user  staff   160 Nov 27 10:00 .\ndrwxr-xr-x  3 user  staff    96 Nov 27 09:00 ..\n-rw-r--r--  1 user  staff  1024 Nov 27 10:00 package.json",
      comment: "List directory contents with details",
    },
    {
      params: { argv: ["echo", "Hello World"], timeout: 30000 },
      output: "status=0\n\nHello World",
      comment: "Echo without shell - argument passed directly",
    },
    {
      params: { argv: ["cat", "nonexistent.txt"], timeout: 30000 },
      output: "status=1\n\ncat: nonexistent.txt: No such file or directory",
      comment: "Command that fails returns non-zero status",
    },
    {
      params: { argv: ["pwd"], cwd: "/tmp", timeout: 30000 },
      output: "status=0\n\n/tmp",
      comment: "Execute command in a specific directory",
    },
    {
      params: { argv: ["gh", "pr", "review", "123", "--comment", "--body", "Review with `backticks` and 'quotes'"], timeout: 30000 },
      output: "status=0\n\n(no output)",
      comment: "Complex arguments with special characters - no escaping needed",
    },
  ],
  execute: async ({ argv, cwd, timeout }) => {
    const workingDir = cwd ?? process.cwd();

    if (argv.length === 0) {
      return "status=1\n\nerror: argv array cannot be empty";
    }

    try {
      // Spawn process directly without shell - arguments passed as-is
      const proc = Bun.spawn(argv, {
        cwd: workingDir,
        stdout: "pipe",
        stderr: "pipe",
      });

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
