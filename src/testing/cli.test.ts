import { describe, expect, it } from "bun:test";
import { Readable, Writable } from "node:stream";
import { InvalidArgumentError } from "commander";
import type { ILogObj, Logger } from "tslog";
import { z } from "zod";

import type { CLIEnvironment } from "../cli/environment.js";
import { extractGadgetsFromModule, loadGadgets, resolveGadgetSpecifier } from "../cli/gadgets.js";
import { runCLI } from "../cli/program.js";
import {
  createNumericParser,
  executeAction,
  renderSummary,
  resolvePrompt,
  StreamPrinter,
} from "../cli/utils.js";
import type { LLMist } from "../core/client.js";
import type { LLMStreamChunk, TokenUsage } from "../core/options.js";
import { Gadget } from "../gadgets/typed-gadget.js";
import { createLogger } from "../logging/logger.js";

class TestGadget extends Gadget({
  name: "TestGadget",
  description: "test gadget",
  schema: z.object({}),
}) {
  execute(): string {
    return "ok";
  }
}

function createReadable(content: string, { isTTY = false } = {}): Readable & { isTTY?: boolean } {
  const stream = Readable.from([content]) as Readable & { isTTY?: boolean };
  stream.isTTY = isTTY;
  return stream;
}

function createWritable(isTTY = true) {
  let data = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      data += chunk.toString();
      callback();
    },
  });
  // Cast to NodeJS.WriteStream and set isTTY property
  (stream as NodeJS.WriteStream & { isTTY: boolean }).isTTY = isTTY;
  return { stream, read: () => data };
}

function createEnv(overrides: Partial<CLIEnvironment> = {}): CLIEnvironment {
  const stdin = createReadable("", { isTTY: false });
  const stdout = createWritable();
  const stderr = createWritable();
  return {
    argv: ["node", "llmist"],
    stdin,
    stdout: stdout.stream,
    stderr: stderr.stream,
    createClient: () => {
      throw new Error("Client not provided");
    },
    setExitCode: () => {},
    createLogger: (name: string) => createLogger({ type: "hidden", name }),
    isTTY: false,
    prompt: async () => {
      throw new Error("Cannot prompt in test environment");
    },
    ...overrides,
  };
}

function createTestClient(chunks: LLMStreamChunk[]): LLMist {
  const stream = async function* () {
    for (const chunk of chunks) {
      yield chunk;
    }
  };

  return {
    stream: () => stream(),
    modelRegistry: {
      getModelLimits: () => undefined,
    },
  } as unknown as LLMist;
}

function chunk(text: string, extras: Partial<LLMStreamChunk> = {}): LLMStreamChunk {
  return { text, ...extras };
}

describe("resolvePrompt", () => {
  it("returns the provided argument when present", async () => {
    const env = createEnv();
    await expect(resolvePrompt("  hello ", env)).resolves.toBe("hello");
  });

  it("reads from stdin when not interactive", async () => {
    const env = createEnv({ stdin: createReadable(" from stdin\n", { isTTY: false }) });
    await expect(resolvePrompt(undefined, env)).resolves.toBe("from stdin");
  });

  it("throws when prompt missing in interactive mode", async () => {
    const env = createEnv({ stdin: createReadable("", { isTTY: true }) });
    await expect(resolvePrompt(undefined, env)).rejects.toThrow();
  });
});

describe("gadget loading", () => {
  it("extracts gadget instances and classes from module exports", () => {
    const instance = new TestGadget();
    const exports = {
      default: TestGadget,
      instance,
      nested: { list: [TestGadget] },
    };

    const gadgets = extractGadgetsFromModule(exports);
    expect(gadgets).toHaveLength(2);
    expect(gadgets.some((item) => item === instance)).toBe(true);
  });

  it("loads gadgets using a custom importer", async () => {
    const modules: Record<string, unknown> = {
      "test-module": { default: TestGadget },
    };

    const gadgets = await loadGadgets(["test-module"], process.cwd(), async (specifier) => {
      return modules[specifier];
    });
    expect(gadgets).toHaveLength(1);
    expect(gadgets[0]).toBeInstanceOf(TestGadget);
  });
});

describe("runCLI", () => {
  it("streams complete output and renders summary", async () => {
    const stdout = createWritable();
    const stderr = createWritable();
    const env = createEnv({
      argv: ["node", "llmist", "complete", "--model", "test:model", "Hello?"],
      stdin: createReadable("", { isTTY: true }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      createClient: () =>
        createTestClient([
          chunk("Hello "),
          chunk("world", {
            finishReason: "stop",
            usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
          }),
        ]),
    });

    await runCLI({ env, config: {} });

    expect(stdout.read()).toBe("Hello world\n");
    // New compact format: ↑ 2 | ↓ 3 | stop
    expect(stderr.read()).toContain("stop");
    expect(stderr.read()).toContain("↑");
    expect(stderr.read()).toContain("↓");
  });

  it("runs agent loop and prints summaries", async () => {
    const stdout = createWritable();
    const stderr = createWritable();
    const usage: TokenUsage = { inputTokens: 1, outputTokens: 2, totalTokens: 3 };
    const env = createEnv({
      // Use --max-iterations 1 since CLI uses "acknowledge" for text-only responses
      argv: [
        "node",
        "llmist",
        "agent",
        "--model",
        "test:model",
        "--max-iterations",
        "1",
        "Do the thing",
      ],
      stdin: createReadable("", { isTTY: true }),
      stdout: stdout.stream,
      stderr: stderr.stream,
      createClient: () =>
        createTestClient([
          chunk("Agent response", {
            finishReason: "stop",
            usage,
          }),
        ]),
    });

    await runCLI({ env, config: {} });

    // Content is rendered with markdown (includes ANSI codes)
    expect(stdout.read()).toContain("Agent response");
    // New compact format: #1 | ↑ 1 | ↓ 2 | stop
    expect(stderr.read()).toContain("#1");
    expect(stderr.read()).toContain("↑");
    expect(stderr.read()).toContain("↓");
  });

  it("handles agent with no gadget calls", async () => {
    const stdout = createWritable();
    const stderr = createWritable();
    const usage: TokenUsage = { inputTokens: 5, outputTokens: 10, totalTokens: 15 };
    const env = createEnv({
      // Use --max-iterations 1 since CLI uses "acknowledge" for text-only responses
      argv: ["node", "llmist", "agent", "--model", "test:model", "--max-iterations", "1", "Test"],
      stdout: stdout.stream,
      stderr: stderr.stream,
      createClient: () =>
        createTestClient([
          chunk("Agent completed task without using any tools.", {
            finishReason: "stop",
            usage,
          }),
        ]),
    });

    await runCLI({ env, config: {} });

    // Agent output goes to stdout (rendered with markdown, includes ANSI codes)
    expect(stdout.read()).toContain("Agent completed task without using any tools.");
    // Summary goes to stderr
    expect(stderr.read()).toContain("stop");
  });
});

describe("createNumericParser", () => {
  it("throws error for NaN values", () => {
    const parser = createNumericParser({ label: "Test" });
    expect(() => parser("not-a-number")).toThrow(InvalidArgumentError);
    expect(() => parser("not-a-number")).toThrow("Test must be a number");
  });

  it("throws error for non-integer when integer is required", () => {
    const parser = createNumericParser({ label: "Count", integer: true });
    expect(() => parser("3.14")).toThrow(InvalidArgumentError);
    expect(() => parser("3.14")).toThrow("Count must be an integer");
  });

  it("throws error when value is below minimum", () => {
    const parser = createNumericParser({ label: "Value", min: 10 });
    expect(() => parser("5")).toThrow(InvalidArgumentError);
    expect(() => parser("5")).toThrow("Value must be greater than or equal to 10");
  });

  it("throws error when value is above maximum", () => {
    const parser = createNumericParser({ label: "Percentage", max: 100 });
    expect(() => parser("150")).toThrow(InvalidArgumentError);
    expect(() => parser("150")).toThrow("Percentage must be less than or equal to 100");
  });

  it("accepts valid values", () => {
    const parser = createNumericParser({ label: "Test", min: 0, max: 10, integer: true });
    expect(parser("5")).toBe(5);
  });
});

describe("StreamPrinter", () => {
  it("does not write empty strings", () => {
    const writable = createWritable();
    const printer = new StreamPrinter(writable.stream);
    printer.write("");
    expect(writable.read()).toBe("");
  });

  it("tracks newline status correctly", () => {
    const writable = createWritable();
    const printer = new StreamPrinter(writable.stream);
    printer.write("hello");
    printer.ensureNewline();
    expect(writable.read()).toBe("hello\n");

    printer.write("world\n");
    printer.ensureNewline();
    expect(writable.read()).toBe("hello\nworld\n");
  });
});

describe("renderSummary", () => {
  it("includes finishReason in summary", () => {
    const summary = renderSummary({
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    });
    // New compact format: ↑ 1 | ↓ 2 | stop
    expect(summary).toContain("stop");
    expect(summary).toContain("↑");
    expect(summary).toContain("↓");
  });

  it("returns null when no metadata is provided", () => {
    const summary = renderSummary({});
    expect(summary).toBeNull();
  });

  it("includes iterations when provided", () => {
    const summary = renderSummary({ iterations: 5 });
    // New compact format: #5
    expect(summary).toContain("#5");
  });
});

describe("executeAction", () => {
  it("handles errors and sets exit code", async () => {
    const stderr = createWritable();
    let exitCode = 0;
    const env = createEnv({
      stderr: stderr.stream,
      setExitCode: (code) => {
        exitCode = code;
      },
    });

    await executeAction(async () => {
      throw new Error("Test error");
    }, env);

    // Error output may include ANSI codes which break substring matching
    expect(stderr.read()).toContain("Test error");
    expect(exitCode).toBe(1);
  });

  it("handles non-Error exceptions", async () => {
    const stderr = createWritable();
    const env = createEnv({ stderr: stderr.stream });

    await executeAction(async () => {
      throw "string error";
    }, env);

    // Error output may include ANSI codes which break substring matching
    expect(stderr.read()).toContain("string error");
  });
});

describe("resolvePrompt edge cases", () => {
  it("throws error for empty stdin", async () => {
    const env = createEnv({ stdin: createReadable("   \n", { isTTY: false }) });
    await expect(resolvePrompt(undefined, env)).rejects.toThrow("Received empty stdin payload");
  });
});

describe("gadget loading edge cases", () => {
  it("handles arrays in module exports", () => {
    const gadgets = extractGadgetsFromModule({
      gadgets: [TestGadget, new TestGadget()],
    });
    expect(gadgets).toHaveLength(2);
  });

  it("handles null and undefined in module exports", () => {
    const gadgets = extractGadgetsFromModule({
      nothing: null,
      missing: undefined,
      gadget: TestGadget,
    });
    expect(gadgets).toHaveLength(1);
  });

  it("avoids infinite loops with circular references", () => {
    const circular: { gadget: typeof TestGadget; self?: unknown } = {
      gadget: TestGadget,
    };
    circular.self = circular;

    const gadgets = extractGadgetsFromModule(circular);
    expect(gadgets).toHaveLength(1);
  });

  it("throws error when file not found", () => {
    expect(() => resolveGadgetSpecifier("./nonexistent.js", process.cwd())).toThrow(
      "Gadget module not found",
    );
  });

  it("handles import errors", async () => {
    await expect(
      loadGadgets(["test-module"], process.cwd(), async () => {
        throw new Error("Import failed");
      }),
    ).rejects.toThrow("Failed to load gadget module");
  });

  it("handles module with no gadgets", async () => {
    await expect(
      loadGadgets(["empty-module"], process.cwd(), async () => ({
        default: {},
      })),
    ).rejects.toThrow("does not export any Gadget instances");
  });

  it("handles gadget initialization errors", async () => {
    class BrokenGadget extends Gadget({
      name: "BrokenGadget",
      description: "broken",
      schema: z.object({}),
    }) {
      constructor() {
        super();
        throw new Error("Initialization failed");
      }
      execute(): string {
        return "ok";
      }
    }

    await expect(
      loadGadgets(["broken-module"], process.cwd(), async () => ({
        default: BrokenGadget,
      })),
    ).rejects.toThrow("Failed to initialize gadgets");
  });
});
