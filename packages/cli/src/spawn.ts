/**
 * Spawn utility for Node.js child processes.
 *
 * Provides a consistent API for spawning child processes using Node.js
 * child_process module with ReadableStream output.
 *
 * @module cli/spawn
 */

import { spawn as nodeSpawn } from "node:child_process";
import type { Readable } from "node:stream";

/**
 * Stdio configuration for spawn.
 */
type StdioOption = "pipe" | "inherit" | "ignore";

/**
 * Options for spawn function.
 */
export interface SpawnOptions {
  /** Working directory for the child process */
  cwd?: string;
  /** stdin configuration */
  stdin?: StdioOption;
  /** stdout configuration */
  stdout?: StdioOption;
  /** stderr configuration */
  stderr?: StdioOption;
}

/**
 * Writable stdin interface for child processes.
 */
export interface SpawnStdin {
  write(data: string): void;
  end(): void;
}

/**
 * Result from spawn function with ReadableStream output.
 */
export interface SpawnResult {
  /** Promise that resolves to exit code when process exits */
  exited: Promise<number>;
  /** stdout stream (null if not piped) */
  stdout: ReadableStream<Uint8Array> | null;
  /** stderr stream (null if not piped) */
  stderr: ReadableStream<Uint8Array> | null;
  /** stdin writer (null if not piped) */
  stdin: SpawnStdin | null;
  /** Kill the child process */
  kill(): void;
}

/**
 * Convert a Node.js Readable stream to a web ReadableStream.
 */
function nodeStreamToReadableStream(
  nodeStream: Readable | null,
): ReadableStream<Uint8Array> | null {
  if (!nodeStream) return null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      nodeStream.on("end", () => {
        controller.close();
      });
      nodeStream.on("error", (err) => {
        controller.error(err);
      });
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

/**
 * Spawn a child process with ReadableStream output.
 *
 * @param argv - Command and arguments as array (first element is the command)
 * @param options - Spawn options (cwd, stdin, stdout, stderr)
 * @returns SpawnResult with exited promise, streams, and kill function
 */
export function spawn(argv: string[], options: SpawnOptions = {}): SpawnResult {
  const [command, ...args] = argv;
  const proc = nodeSpawn(command, args, {
    cwd: options.cwd,
    stdio: [
      options.stdin === "pipe" ? "pipe" : (options.stdin ?? "ignore"),
      options.stdout === "pipe" ? "pipe" : (options.stdout ?? "ignore"),
      options.stderr === "pipe" ? "pipe" : (options.stderr ?? "ignore"),
    ],
  });

  // Create exited promise
  const exited = new Promise<number>((resolve, reject) => {
    proc.on("exit", (code) => {
      resolve(code ?? 1);
    });
    proc.on("error", (err) => {
      reject(err);
    });
  });

  // Create stdin wrapper
  const stdin: SpawnStdin | null = proc.stdin
    ? {
        write(data: string) {
          proc.stdin?.write(data);
        },
        end() {
          proc.stdin?.end();
        },
      }
    : null;

  return {
    exited,
    stdout: nodeStreamToReadableStream(proc.stdout),
    stderr: nodeStreamToReadableStream(proc.stderr),
    stdin,
    kill() {
      proc.kill();
    },
  };
}
