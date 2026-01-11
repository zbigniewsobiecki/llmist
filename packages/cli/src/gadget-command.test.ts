import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CLIEnvironment } from "./environment.js";

// Mock the dependencies
vi.mock("./gadgets.js", () => ({
  loadGadgets: vi.fn(),
}));

vi.mock("./gadget-prompts.js", () => ({
  promptForParameters: vi.fn(),
  readStdinJson: vi.fn(),
}));

vi.mock("llmist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("llmist")>();
  return {
    ...actual,
    schemaToJSONSchema: vi.fn(() => ({
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    })),
    validateGadgetSchema: vi.fn(),
  };
});

import { validateGadgetSchema } from "llmist";
import { promptForParameters, readStdinJson } from "./gadget-prompts.js";
import { loadGadgets } from "./gadgets.js";

/**
 * Mock writable stream that captures all output.
 */
class MockWritableStream extends Writable {
  public output = "";

  _write(chunk: Buffer | string, _encoding: string, callback: () => void): void {
    this.output += chunk.toString();
    callback();
  }

  clear(): void {
    this.output = "";
  }
}

/**
 * Mock stdin for testing.
 */
class MockStdin extends EventEmitter {
  isTTY = false;
  setRawMode = vi.fn(() => this);
  resume = vi.fn(() => this);
  pause = vi.fn(() => this);
}

/**
 * Creates a mock gadget for testing.
 */
function createMockGadget(
  overrides: Partial<{
    name: string;
    description: string;
    execute: () => string | Promise<string> | { result: string; cost?: number };
    parameterSchema: {
      safeParse: (input: unknown) => {
        success: boolean;
        data?: unknown;
        error?: { issues: Array<{ path: string[]; message: string }> };
      };
    };
    timeoutMs: number;
    examples: Array<{ params: unknown; output?: string; comment?: string }>;
  }> = {},
) {
  return {
    name: overrides.name ?? "TestGadget",
    description: overrides.description ?? "A test gadget",
    execute: overrides.execute ?? vi.fn().mockReturnValue("test result"),
    parameterSchema: overrides.parameterSchema ?? {
      safeParse: vi.fn().mockReturnValue({ success: true, data: { query: "test" } }),
    },
    timeoutMs: overrides.timeoutMs,
    examples: overrides.examples,
  };
}

/**
 * Creates a mock CLI environment.
 */
function createMockEnv(isTTY = false): CLIEnvironment & {
  stdout: MockWritableStream;
  stderr: MockWritableStream;
} {
  const stdout = new MockWritableStream();
  const stderr = new MockWritableStream();
  const stdin = new MockStdin();
  stdin.isTTY = isTTY;

  let exitCode = 0;

  return {
    stdin: stdin as unknown as NodeJS.ReadableStream,
    stdout: stdout as unknown as MockWritableStream,
    stderr: stderr as unknown as MockWritableStream,
    isTTY,
    setExitCode: (code: number) => {
      exitCode = code;
    },
    getExitCode: () => exitCode,
    exitWithError: (message: string, code = 1) => {
      exitCode = code;
      stderr.write(message + "\n");
    },
  } as unknown as CLIEnvironment & {
    stdout: MockWritableStream;
    stderr: MockWritableStream;
  };
}

describe("gadget-command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("selectGadget", () => {
    it("should return single gadget directly", async () => {
      const mockGadget = createMockGadget({ name: "SingleGadget" });
      vi.mocked(loadGadgets).mockResolvedValue([mockGadget as any]);

      // Import the module dynamically to use mocked dependencies
      const { registerGadgetCommand } = await import("./gadget-command.js");

      // We can't test selectGadget directly (it's not exported), but we can test through the command
      // This test verifies the loadGadgets mock is working
      expect(loadGadgets).toBeDefined();
    });

    it("should throw error when no gadgets found", async () => {
      vi.mocked(loadGadgets).mockResolvedValue([]);

      const env = createMockEnv();

      // Dynamically import to get fresh module with mocks
      const { registerGadgetCommand } = await import("./gadget-command.js");
      const { Command } = await import("commander");

      const program = new Command();
      registerGadgetCommand(program, env);

      // Parse the command
      await program.parseAsync(["node", "test", "gadget", "info", "test.ts"]);

      // Should have error output
      expect(env.stderr.output).toContain("No gadgets found");
    });

    it("should require --name when multiple gadgets exported", async () => {
      const gadget1 = createMockGadget({ name: "Gadget1" });
      const gadget2 = createMockGadget({ name: "Gadget2" });
      vi.mocked(loadGadgets).mockResolvedValue([gadget1 as any, gadget2 as any]);

      const env = createMockEnv();

      const { registerGadgetCommand } = await import("./gadget-command.js");
      const { Command } = await import("commander");

      const program = new Command();
      registerGadgetCommand(program, env);

      await program.parseAsync(["node", "test", "gadget", "info", "test.ts"]);

      expect(env.stderr.output).toContain("exports 2 gadgets");
      expect(env.stderr.output).toContain("--name");
    });

    it("should find gadget by name when multiple exported", async () => {
      const gadget1 = createMockGadget({ name: "Gadget1", description: "First gadget" });
      const gadget2 = createMockGadget({ name: "Gadget2", description: "Second gadget" });
      vi.mocked(loadGadgets).mockResolvedValue([gadget1 as any, gadget2 as any]);

      const env = createMockEnv();

      const { registerGadgetCommand } = await import("./gadget-command.js");
      const { Command } = await import("commander");

      const program = new Command();
      registerGadgetCommand(program, env);

      await program.parseAsync(["node", "test", "gadget", "info", "--name", "Gadget2", "test.ts"]);

      expect(env.stdout.output).toContain("Gadget2");
      expect(env.stdout.output).toContain("Second gadget");
    });

    it("should throw error when named gadget not found", async () => {
      // Need multiple gadgets to trigger the "not found" path
      // (single gadget is returned directly without name check)
      const gadget1 = createMockGadget({ name: "Gadget1" });
      const gadget2 = createMockGadget({ name: "Gadget2" });
      vi.mocked(loadGadgets).mockResolvedValue([gadget1 as any, gadget2 as any]);

      const env = createMockEnv();

      const { registerGadgetCommand } = await import("./gadget-command.js");
      const { Command } = await import("commander");

      const program = new Command();
      registerGadgetCommand(program, env);

      await program.parseAsync([
        "node",
        "test",
        "gadget",
        "info",
        "--name",
        "NonExistent",
        "test.ts",
      ]);

      expect(env.stderr.output).toContain("Gadget 'NonExistent' not found");
    });
  });

  describe("gadget run", () => {
    it("should execute gadget with stdin JSON parameters", async () => {
      const mockGadget = createMockGadget({
        name: "TestGadget",
        execute: vi.fn().mockReturnValue("execution result"),
      });
      vi.mocked(loadGadgets).mockResolvedValue([mockGadget as any]);
      vi.mocked(readStdinJson).mockResolvedValue({ query: "test query" });

      const env = createMockEnv(false); // non-TTY mode

      const { registerGadgetCommand } = await import("./gadget-command.js");
      const { Command } = await import("commander");

      const program = new Command();
      registerGadgetCommand(program, env);

      await program.parseAsync(["node", "test", "gadget", "run", "test.ts"]);

      expect(env.stdout.output).toContain("execution result");
      expect(env.stderr.output).toContain("Running gadget: TestGadget");
      expect(env.stderr.output).toContain("Completed");
    });

    it("should use interactive prompts in TTY mode", async () => {
      const mockGadget = createMockGadget({
        name: "InteractiveGadget",
        execute: vi.fn().mockReturnValue("interactive result"),
      });
      vi.mocked(loadGadgets).mockResolvedValue([mockGadget as any]);
      vi.mocked(promptForParameters).mockResolvedValue({ query: "prompted value" });

      const env = createMockEnv(true); // TTY mode

      const { registerGadgetCommand } = await import("./gadget-command.js");
      const { Command } = await import("commander");

      const program = new Command();
      registerGadgetCommand(program, env);

      await program.parseAsync(["node", "test", "gadget", "run", "test.ts"]);

      expect(promptForParameters).toHaveBeenCalled();
      expect(env.stdout.output).toContain("interactive result");
    });

    it("should format JSON output when --json flag used", async () => {
      const mockGadget = createMockGadget({
        execute: vi.fn().mockReturnValue('{"key": "value"}'),
      });
      vi.mocked(loadGadgets).mockResolvedValue([mockGadget as any]);
      vi.mocked(readStdinJson).mockResolvedValue({});

      const env = createMockEnv(false);

      const { registerGadgetCommand } = await import("./gadget-command.js");
      const { Command } = await import("commander");

      const program = new Command();
      registerGadgetCommand(program, env);

      await program.parseAsync(["node", "test", "gadget", "run", "--json", "test.ts"]);

      // Should be pretty-printed JSON
      expect(env.stdout.output).toContain('"key": "value"');
    });

    it("should output raw result when --raw flag used", async () => {
      const mockGadget = createMockGadget({
        execute: vi.fn().mockReturnValue("raw output"),
      });
      vi.mocked(loadGadgets).mockResolvedValue([mockGadget as any]);
      vi.mocked(readStdinJson).mockResolvedValue({});

      const env = createMockEnv(false);

      const { registerGadgetCommand } = await import("./gadget-command.js");
      const { Command } = await import("commander");

      const program = new Command();
      registerGadgetCommand(program, env);

      await program.parseAsync(["node", "test", "gadget", "run", "--raw", "test.ts"]);

      expect(env.stdout.output).toBe("raw output\n");
    });

    it("should handle gadget returning object with cost", async () => {
      const mockGadget = createMockGadget({
        execute: vi.fn().mockReturnValue({ result: "with cost", cost: 0.0001 }),
      });
      vi.mocked(loadGadgets).mockResolvedValue([mockGadget as any]);
      vi.mocked(readStdinJson).mockResolvedValue({});

      const env = createMockEnv(false);

      const { registerGadgetCommand } = await import("./gadget-command.js");
      const { Command } = await import("commander");

      const program = new Command();
      registerGadgetCommand(program, env);

      await program.parseAsync(["node", "test", "gadget", "run", "test.ts"]);

      expect(env.stdout.output).toContain("with cost");
      expect(env.stderr.output).toContain("Cost: $0.000100");
    });

    it("should handle parameter validation errors", async () => {
      const mockGadget = createMockGadget({
        parameterSchema: {
          safeParse: vi.fn().mockReturnValue({
            success: false,
            error: {
              issues: [{ path: ["query"], message: "Required" }],
            },
          }),
        },
      });
      vi.mocked(loadGadgets).mockResolvedValue([mockGadget as any]);
      vi.mocked(readStdinJson).mockResolvedValue({});

      const env = createMockEnv(false);

      const { registerGadgetCommand } = await import("./gadget-command.js");
      const { Command } = await import("commander");

      const program = new Command();
      registerGadgetCommand(program, env);

      await program.parseAsync(["node", "test", "gadget", "run", "test.ts"]);

      expect(env.stderr.output).toContain("Invalid parameters");
      expect(env.stderr.output).toContain("query: Required");
    });

    it("should handle execution errors", async () => {
      const mockGadget = createMockGadget({
        execute: vi.fn().mockImplementation(() => {
          throw new Error("Execution failed!");
        }),
      });
      vi.mocked(loadGadgets).mockResolvedValue([mockGadget as any]);
      vi.mocked(readStdinJson).mockResolvedValue({ query: "test" });

      const env = createMockEnv(false);

      const { registerGadgetCommand } = await import("./gadget-command.js");
      const { Command } = await import("commander");

      const program = new Command();
      registerGadgetCommand(program, env);

      await program.parseAsync(["node", "test", "gadget", "run", "test.ts"]);

      expect(env.stderr.output).toContain("Execution failed");
    });
  });

  describe("gadget info", () => {
    it("should display gadget information in text format", async () => {
      const mockGadget = createMockGadget({
        name: "InfoGadget",
        description: "A gadget for testing info display",
        timeoutMs: 5000,
        examples: [{ params: { query: "test" }, output: "result", comment: "Example comment" }],
      });
      vi.mocked(loadGadgets).mockResolvedValue([mockGadget as any]);

      const env = createMockEnv(false);

      const { registerGadgetCommand } = await import("./gadget-command.js");
      const { Command } = await import("commander");

      const program = new Command();
      registerGadgetCommand(program, env);

      await program.parseAsync(["node", "test", "gadget", "info", "test.ts"]);

      expect(env.stdout.output).toContain("InfoGadget");
      expect(env.stdout.output).toContain("A gadget for testing info display");
      expect(env.stdout.output).toContain("5000ms");
      expect(env.stdout.output).toContain("Example comment");
    });

    it("should output JSON when --json flag used", async () => {
      const mockGadget = createMockGadget({
        name: "JsonGadget",
        description: "JSON output test",
      });
      vi.mocked(loadGadgets).mockResolvedValue([mockGadget as any]);

      const env = createMockEnv(false);

      const { registerGadgetCommand } = await import("./gadget-command.js");
      const { Command } = await import("commander");

      const program = new Command();
      registerGadgetCommand(program, env);

      await program.parseAsync(["node", "test", "gadget", "info", "--json", "test.ts"]);

      const output = JSON.parse(env.stdout.output);
      expect(output.name).toBe("JsonGadget");
      expect(output.description).toBe("JSON output test");
    });
  });

  describe("gadget validate", () => {
    it("should validate valid gadgets", async () => {
      const mockGadget = createMockGadget({
        name: "ValidGadget",
        description: "A valid gadget",
      });
      vi.mocked(loadGadgets).mockResolvedValue([mockGadget as any]);
      vi.mocked(validateGadgetSchema).mockImplementation(() => {});

      const env = createMockEnv(false);

      const { registerGadgetCommand } = await import("./gadget-command.js");
      const { Command } = await import("commander");

      const program = new Command();
      registerGadgetCommand(program, env);

      await program.parseAsync(["node", "test", "gadget", "validate", "test.ts"]);

      expect(env.stdout.output).toContain("Valid");
      expect(env.stdout.output).toContain("ValidGadget");
    });

    it("should report invalid gadgets without description", async () => {
      const mockGadget = createMockGadget({
        name: "InvalidGadget",
        description: "", // Empty description
      });
      vi.mocked(loadGadgets).mockResolvedValue([mockGadget as any]);

      const env = createMockEnv(false);

      const { registerGadgetCommand } = await import("./gadget-command.js");
      const { Command } = await import("commander");

      const program = new Command();
      registerGadgetCommand(program, env);

      await program.parseAsync(["node", "test", "gadget", "validate", "test.ts"]);

      expect(env.stdout.output).toContain("Invalid");
      expect(env.stdout.output).toContain("Missing 'description'");
    });

    it("should report schema validation errors", async () => {
      const mockGadget = createMockGadget();
      vi.mocked(loadGadgets).mockResolvedValue([mockGadget as any]);
      vi.mocked(validateGadgetSchema).mockImplementation(() => {
        throw new Error("Invalid schema: missing required field");
      });

      const env = createMockEnv(false);

      const { registerGadgetCommand } = await import("./gadget-command.js");
      const { Command } = await import("commander");

      const program = new Command();
      registerGadgetCommand(program, env);

      await program.parseAsync(["node", "test", "gadget", "validate", "test.ts"]);

      expect(env.stdout.output).toContain("Invalid");
      expect(env.stdout.output).toContain("Invalid schema");
    });

    it("should report when no gadgets found", async () => {
      vi.mocked(loadGadgets).mockResolvedValue([]);

      const env = createMockEnv(false);

      const { registerGadgetCommand } = await import("./gadget-command.js");
      const { Command } = await import("commander");

      const program = new Command();
      registerGadgetCommand(program, env);

      await program.parseAsync(["node", "test", "gadget", "validate", "test.ts"]);

      expect(env.stdout.output).toContain("Invalid");
      expect(env.stdout.output).toContain("No gadgets exported");
    });
  });

  describe("looksLikeJson helper", () => {
    it("should auto-detect and format JSON objects", async () => {
      const mockGadget = createMockGadget({
        execute: vi.fn().mockReturnValue('{"auto": "detected"}'),
      });
      vi.mocked(loadGadgets).mockResolvedValue([mockGadget as any]);
      vi.mocked(readStdinJson).mockResolvedValue({});

      const env = createMockEnv(false);

      const { registerGadgetCommand } = await import("./gadget-command.js");
      const { Command } = await import("commander");

      const program = new Command();
      registerGadgetCommand(program, env);

      await program.parseAsync(["node", "test", "gadget", "run", "test.ts"]);

      // Should be pretty-printed even without --json flag
      expect(env.stdout.output).toContain('"auto": "detected"');
    });

    it("should auto-detect and format JSON arrays", async () => {
      const mockGadget = createMockGadget({
        execute: vi.fn().mockReturnValue("[1, 2, 3]"),
      });
      vi.mocked(loadGadgets).mockResolvedValue([mockGadget as any]);
      vi.mocked(readStdinJson).mockResolvedValue({});

      const env = createMockEnv(false);

      const { registerGadgetCommand } = await import("./gadget-command.js");
      const { Command } = await import("commander");

      const program = new Command();
      registerGadgetCommand(program, env);

      await program.parseAsync(["node", "test", "gadget", "run", "test.ts"]);

      expect(env.stdout.output).toContain("1");
      expect(env.stdout.output).toContain("2");
      expect(env.stdout.output).toContain("3");
    });

    it("should not format non-JSON text", async () => {
      const mockGadget = createMockGadget({
        execute: vi.fn().mockReturnValue("plain text output"),
      });
      vi.mocked(loadGadgets).mockResolvedValue([mockGadget as any]);
      vi.mocked(readStdinJson).mockResolvedValue({});

      const env = createMockEnv(false);

      const { registerGadgetCommand } = await import("./gadget-command.js");
      const { Command } = await import("commander");

      const program = new Command();
      registerGadgetCommand(program, env);

      await program.parseAsync(["node", "test", "gadget", "run", "test.ts"]);

      expect(env.stdout.output).toBe("plain text output\n");
    });
  });
});
