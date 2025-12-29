import { describe, expect, test } from "vitest";
import { spawn } from "./spawn.js";

describe("spawn utility", () => {
  describe("basic command execution", () => {
    test("executes simple command successfully", async () => {
      const proc = spawn(["echo", "hello"], { stdout: "pipe" });
      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
    });

    test("returns non-zero exit code for failing command", async () => {
      const proc = spawn(["false"], { stdout: "pipe", stderr: "pipe" });
      const exitCode = await proc.exited;
      expect(exitCode).toBe(1);
    });
  });

  describe("stdout capturing", () => {
    test("captures stdout correctly", async () => {
      const proc = spawn(["echo", "hello world"], { stdout: "pipe" });
      const stdout = await new Response(proc.stdout).text();
      expect(stdout.trim()).toBe("hello world");
      await proc.exited;
    });

    test("captures multiline stdout", async () => {
      const proc = spawn(["printf", "line1\\nline2\\nline3"], { stdout: "pipe" });
      const stdout = await new Response(proc.stdout).text();
      expect(stdout).toBe("line1\nline2\nline3");
      await proc.exited;
    });

    test("stdout is null when not piped", async () => {
      const proc = spawn(["echo", "hello"], { stdout: "ignore" });
      // Adapter normalizes undefined to null for consistent API
      expect(proc.stdout).toBeNull();
      await proc.exited;
    });
  });

  describe("stderr capturing", () => {
    test("captures stderr from failing command", async () => {
      const proc = spawn(["sh", "-c", "echo error message >&2; exit 1"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stderr = await new Response(proc.stderr).text();
      expect(stderr.trim()).toBe("error message");
      const exitCode = await proc.exited;
      expect(exitCode).toBe(1);
    });

    test("stderr is null when not piped", async () => {
      const proc = spawn(["echo", "hello"], { stderr: "ignore" });
      // Adapter normalizes undefined to null for consistent API
      expect(proc.stderr).toBeNull();
      await proc.exited;
    });
  });

  describe("exit codes", () => {
    test("exited resolves with 0 for successful command", async () => {
      const proc = spawn(["true"], {});
      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
    });

    test("exited resolves with 1 for failed command", async () => {
      const proc = spawn(["false"], {});
      const exitCode = await proc.exited;
      expect(exitCode).toBe(1);
    });

    test("exited resolves with custom exit code", async () => {
      const proc = spawn(["sh", "-c", "exit 42"], {});
      const exitCode = await proc.exited;
      expect(exitCode).toBe(42);
    });
  });

  describe("stdin piping", () => {
    test("pipes data to stdin correctly", async () => {
      const proc = spawn(["cat"], {
        stdin: "pipe",
        stdout: "pipe",
      });

      expect(proc.stdin).not.toBeNull();
      proc.stdin!.write("hello from stdin");
      proc.stdin!.end();

      const stdout = await new Response(proc.stdout).text();
      expect(stdout).toBe("hello from stdin");

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
    });

    test("stdin is null when not piped", async () => {
      const proc = spawn(["echo", "hello"], { stdin: "ignore" });
      expect(proc.stdin).toBeNull();
      await proc.exited;
    });
  });

  describe("working directory", () => {
    test("respects cwd option", async () => {
      const proc = spawn(["pwd"], { cwd: "/tmp", stdout: "pipe" });
      const stdout = await new Response(proc.stdout).text();
      // On macOS, /tmp is a symlink to /private/tmp
      expect(stdout.trim()).toMatch(/^(\/tmp|\/private\/tmp)$/);
      await proc.exited;
    });
  });

  describe("process control", () => {
    test("kill terminates the process", async () => {
      const proc = spawn(["sleep", "10"], {});

      // Kill immediately
      proc.kill();

      const exitCode = await proc.exited;
      // Killed processes typically exit with non-zero code
      expect(exitCode).not.toBe(0);
    });
  });

  describe("error handling", () => {
    test("handles command not found", async () => {
      // Bun throws immediately when command not found
      // Node.js spawns the process which then fails
      try {
        const proc = spawn(["nonexistent-command-xyz123"], {
          stdout: "pipe",
          stderr: "pipe",
        });

        // If spawn didn't throw, wait for exit
        const exitCode = await proc.exited;
        // Should have non-zero exit
        expect(exitCode).not.toBe(0);
      } catch (error) {
        // Bun throws ENOENT immediately - this is expected
        expect(error).toBeDefined();
        expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
      }
    });
  });
});
