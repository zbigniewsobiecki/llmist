import { describe, expect, test } from "vitest";
import { runCommand } from "./run-command.js";

describe("RunCommand gadget", () => {
  describe("execute", () => {
    test("returns error for empty argv array", async () => {
      const result = await runCommand.execute({ argv: [], timeout: 30000 });
      expect(result).toBe("status=1\n\nerror: argv array cannot be empty");
    });

    test("executes simple command successfully", async () => {
      const result = await runCommand.execute({ argv: ["echo", "hello"], timeout: 30000 });
      expect(result).toBe("status=0\n\nhello");
    });

    test("preserves special characters in arguments", async () => {
      const result = await runCommand.execute({
        argv: ["echo", "test with `backticks` and 'quotes' and \"double quotes\""],
        timeout: 30000,
      });
      expect(result).toBe("status=0\n\ntest with `backticks` and 'quotes' and \"double quotes\"");
    });

    test("handles command that produces no output", async () => {
      const result = await runCommand.execute({ argv: ["true"], timeout: 30000 });
      expect(result).toBe("status=0\n\n(no output)");
    });

    test("returns non-zero status for failed commands", async () => {
      const result = await runCommand.execute({ argv: ["false"], timeout: 30000 });
      expect(result).toMatch(/^status=1\n\n/);
    });

    test("handles command not found error", async () => {
      const result = await runCommand.execute({
        argv: ["nonexistent-command-12345"],
        timeout: 30000,
      });
      // spawn throws when command not found (both Bun and Node.js)
      expect(result).toMatch(/status=1\n\nerror:/);
    });

    test("times out long-running commands", async () => {
      const result = await runCommand.execute({
        argv: ["sleep", "10"],
        timeout: 100, // 100ms timeout
      });
      expect(result).toMatch(/status=1\n\nerror: Command timed out after 100ms/);
    });

    test("captures stderr output", async () => {
      const result = await runCommand.execute({
        argv: ["sh", "-c", "echo error >&2"],
        timeout: 30000,
      });
      expect(result).toBe("status=0\n\nerror");
    });

    test("combines stdout and stderr", async () => {
      const result = await runCommand.execute({
        argv: ["sh", "-c", "echo out; echo err >&2"],
        timeout: 30000,
      });
      expect(result).toContain("out");
      expect(result).toContain("err");
    });

    test("respects cwd option", async () => {
      const result = await runCommand.execute({
        argv: ["pwd"],
        cwd: "/tmp",
        timeout: 30000,
      });
      // On macOS, /tmp is a symlink to /private/tmp
      expect(result).toMatch(/status=0\n\n(\/tmp|\/private\/tmp)/);
    });

    test("handles multiline output", async () => {
      const result = await runCommand.execute({
        argv: ["printf", "line1\\nline2\\nline3"],
        timeout: 30000,
      });
      expect(result).toBe("status=0\n\nline1\nline2\nline3");
    });

    test("handles arguments with newlines", async () => {
      const result = await runCommand.execute({
        argv: ["echo", "first\nsecond"],
        timeout: 30000,
      });
      expect(result).toBe("status=0\n\nfirst\nsecond");
    });
  });

  describe("schema", () => {
    test("has correct gadget name", () => {
      expect(runCommand.name).toBe("RunCommand");
    });

    test("has description", () => {
      expect(runCommand.description).toContain("argv array");
    });

    test("has examples", () => {
      expect(runCommand.examples.length).toBeGreaterThan(0);
    });
  });
});
