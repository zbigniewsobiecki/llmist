import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { CLIEnvironment } from "./environment.js";
import { resolvePrompt } from "./prompt-resolver.js";

/**
 * Creates a minimal CLIEnvironment stub for resolvePrompt tests.
 * Only stdin is relevant here; other fields are set to never-called stubs.
 */
function makeEnv(stdin: CLIEnvironment["stdin"]): CLIEnvironment {
  return {
    argv: [],
    stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    createClient: () => {
      throw new Error("not needed");
    },
    setExitCode: () => {},
    createLogger: () => {
      throw new Error("not needed");
    },
    isTTY: false,
    prompt: async () => {
      throw new Error("not needed");
    },
  } as CLIEnvironment;
}

/**
 * Creates a non-TTY readable stream that emits the given content.
 */
function makePipedStdin(content: string): CLIEnvironment["stdin"] {
  const stream = Readable.from([content]);
  // Readable.from() streams do not set isTTY, so this simulates piped input.
  return stream as CLIEnvironment["stdin"];
}

/**
 * Creates a TTY-like stream (simulates interactive terminal with no piped data).
 */
function makeTTYStdin(): CLIEnvironment["stdin"] {
  const stream = new Readable({
    read() {},
  }) as CLIEnvironment["stdin"] & { isTTY: boolean };
  stream.isTTY = true;
  return stream;
}

describe("resolvePrompt", () => {
  describe("promptArg priority (highest)", () => {
    it("uses promptArg when provided and stdin is not piped", async () => {
      const env = makeEnv(makeTTYStdin());
      const result = await resolvePrompt("Hello from arg", env);
      expect(result).toBe("Hello from arg");
    });

    it("uses promptArg even when stdin is piped", async () => {
      const env = makeEnv(makePipedStdin("stdin content"));
      const result = await resolvePrompt("Hello from arg", env);
      expect(result).toBe("Hello from arg");
    });

    it("trims whitespace from promptArg", async () => {
      const env = makeEnv(makeTTYStdin());
      const result = await resolvePrompt("  trimmed  ", env);
      expect(result).toBe("trimmed");
    });

    it("treats whitespace-only promptArg as absent (falls through to stdin check)", async () => {
      // A whitespace-only promptArg should be treated as empty, so it falls
      // through to the stdin path and throws because stdin is a TTY.
      const env = makeEnv(makeTTYStdin());
      await expect(resolvePrompt("   ", env)).rejects.toThrow(
        "Prompt is required. Provide an argument or pipe content via stdin.",
      );
    });
  });

  describe("stdin fallback (when no promptArg)", () => {
    it("reads from stdin when no promptArg and stdin is piped", async () => {
      const env = makeEnv(makePipedStdin("piped prompt content"));
      const result = await resolvePrompt(undefined, env);
      expect(result).toBe("piped prompt content");
    });

    it("trims whitespace from stdin content", async () => {
      const env = makeEnv(makePipedStdin("  spaces around  "));
      const result = await resolvePrompt(undefined, env);
      expect(result).toBe("spaces around");
    });

    it("handles multiline stdin content", async () => {
      const env = makeEnv(makePipedStdin("line one\nline two\nline three"));
      const result = await resolvePrompt(undefined, env);
      expect(result).toBe("line one\nline two\nline three");
    });
  });

  describe("error cases", () => {
    it("throws when TTY stdin and no promptArg provided", async () => {
      const env = makeEnv(makeTTYStdin());
      await expect(resolvePrompt(undefined, env)).rejects.toThrow(
        "Prompt is required. Provide an argument or pipe content via stdin.",
      );
    });

    it("throws when stdin is empty after normalization", async () => {
      const env = makeEnv(makePipedStdin("   \n   "));
      await expect(resolvePrompt(undefined, env)).rejects.toThrow(
        "Received empty stdin payload. Provide a prompt to continue.",
      );
    });

    it("throws when stdin is completely empty", async () => {
      const env = makeEnv(makePipedStdin(""));
      await expect(resolvePrompt(undefined, env)).rejects.toThrow(
        "Received empty stdin payload. Provide a prompt to continue.",
      );
    });
  });
});
