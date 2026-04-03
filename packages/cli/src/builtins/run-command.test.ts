import { describe, expect, test } from "vitest";
import { runCommand } from "./run-command.js";

describe("RunCommand gadget", () => {
  describe("execute", () => {
    test("returns error for empty command", async () => {
      const result = await runCommand.execute({ command: "", timeout: 30000 });
      expect(result).toBe("status=1\n\nerror: command cannot be empty");
    });

    test("executes simple command successfully", async () => {
      const result = await runCommand.execute({ command: "echo hello", timeout: 30000 });
      expect(result).toBe("status=0\n\nhello");
    });

    test("handles shell quoting and special characters", async () => {
      const result = await runCommand.execute({
        command: "echo 'test with `backticks` and \"double quotes\"'",
        timeout: 30000,
      });
      expect(result).toBe('status=0\n\ntest with `backticks` and "double quotes"');
    });

    test("handles command that produces no output", async () => {
      const result = await runCommand.execute({ command: "true", timeout: 30000 });
      expect(result).toBe("status=0\n\n(no output)");
    });

    test("returns non-zero status for failed commands", async () => {
      const result = await runCommand.execute({ command: "false", timeout: 30000 });
      expect(result).toMatch(/^status=1\n\n/);
    });

    test("handles command not found", async () => {
      const result = await runCommand.execute({
        command: "nonexistent-command-12345",
        timeout: 30000,
      });
      // Shell returns 127 for command not found
      expect(result).toMatch(/status=127\n\n/);
    });

    test("times out long-running commands", async () => {
      const result = await runCommand.execute({
        command: "sleep 10",
        timeout: 100,
      });
      expect(result).toMatch(/status=1\n\nerror: Command timed out after 100ms/);
    });

    test("captures stderr output", async () => {
      const result = await runCommand.execute({
        command: "echo error >&2",
        timeout: 30000,
      });
      expect(result).toBe("status=0\n\nerror");
    });

    test("combines stdout and stderr", async () => {
      const result = await runCommand.execute({
        command: "echo out; echo err >&2",
        timeout: 30000,
      });
      expect(result).toContain("out");
      expect(result).toContain("err");
    });

    test("respects cwd option", async () => {
      const result = await runCommand.execute({
        command: "pwd",
        cwd: "/tmp",
        timeout: 30000,
      });
      // On macOS, /tmp is a symlink to /private/tmp
      expect(result).toMatch(/status=0\n\n(\/tmp|\/private\/tmp)/);
    });

    test("handles multiline output", async () => {
      const result = await runCommand.execute({
        command: "printf 'line1\\nline2\\nline3'",
        timeout: 30000,
      });
      expect(result).toBe("status=0\n\nline1\nline2\nline3");
    });

    test("supports piping between commands", async () => {
      const result = await runCommand.execute({
        command: "echo 'hello world' | tr 'h' 'H'",
        timeout: 30000,
      });
      expect(result).toBe("status=0\n\nHello world");
    });

    test("supports output redirection and chaining", async () => {
      const tmpFile = "/tmp/llmist-test-redir-" + Date.now() + ".txt";
      const result = await runCommand.execute({
        command: `echo 'piped content' > ${tmpFile} && cat ${tmpFile} && rm ${tmpFile}`,
        timeout: 30000,
      });
      expect(result).toBe("status=0\n\npiped content");
    });

    test("supports environment variable expansion", async () => {
      const result = await runCommand.execute({
        command: "FOO=bar; echo $FOO",
        timeout: 30000,
      });
      expect(result).toBe("status=0\n\nbar");
    });
  });

  describe("schema", () => {
    test("has correct gadget name", () => {
      expect(runCommand.name).toBe("RunCommand");
    });

    test("has description mentioning shell features", () => {
      expect(runCommand.description).toContain("shell");
    });

    test("has examples", () => {
      expect(runCommand.examples.length).toBeGreaterThan(0);
    });
  });

  describe("instruction rendering", () => {
    test("renders command as a single string parameter, not argv array", () => {
      const instruction = runCommand.getInstruction();

      // Must use !!!ARG:command, not !!!ARG:argv/N
      expect(instruction).toContain("!!!ARG:command");
      expect(instruction).not.toMatch(/!!!ARG:argv/);
    });

    test("renders pipe example naturally", () => {
      const instruction = runCommand.getInstruction();
      expect(instruction).toMatch(/!!!ARG:command\n.*\|/);
    });
  });
});
