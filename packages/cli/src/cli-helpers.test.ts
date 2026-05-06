import { Writable } from "node:stream";
import { InvalidArgumentError } from "commander";
import { describe, expect, it, vi } from "vitest";
import { createNumericParser, executeAction, isInteractive } from "./cli-helpers.js";
import type { CLIEnvironment } from "./environment.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a writable stream that captures written output as a string.
 */
function createWritable() {
  let data = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      data += chunk.toString();
      callback();
    },
  });
  return { stream, read: () => data };
}

/**
 * Creates a minimal fake CLIEnvironment suitable for unit testing.
 */
function createFakeEnv(overrides: Partial<CLIEnvironment> = {}): {
  env: CLIEnvironment;
  stderrContent: () => string;
  setExitCode: ReturnType<typeof vi.fn>;
} {
  const stderr = createWritable();
  const setExitCode = vi.fn();

  const env: CLIEnvironment = {
    argv: ["node", "llmist"],
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: stderr.stream,
    createClient: () => {
      throw new Error("Client not provided in test");
    },
    setExitCode,
    createLogger: () => {
      throw new Error("Logger not provided in test");
    },
    isTTY: false,
    prompt: async () => {
      throw new Error("Cannot prompt in test environment");
    },
    ...overrides,
  };

  return { env, stderrContent: stderr.read, setExitCode };
}

// ─────────────────────────────────────────────────────────────────────────────
// createNumericParser
// ─────────────────────────────────────────────────────────────────────────────

describe("createNumericParser", () => {
  describe("valid values", () => {
    it("accepts whole numbers in default (float) mode", () => {
      const parse = createNumericParser({ label: "Count" });
      expect(parse("42")).toBe(42);
    });

    it("accepts decimal values in default (float) mode", () => {
      const parse = createNumericParser({ label: "Temperature" });
      expect(parse("0.7")).toBe(0.7);
    });

    it("accepts whole numbers in integer mode", () => {
      const parse = createNumericParser({ label: "Iterations", integer: true });
      expect(parse("10")).toBe(10);
    });

    it("accepts negative numbers in float mode", () => {
      const parse = createNumericParser({ label: "Offset" });
      expect(parse("-3.5")).toBe(-3.5);
    });

    it("accepts zero", () => {
      const parse = createNumericParser({ label: "Value" });
      expect(parse("0")).toBe(0);
    });

    it("treats empty string as 0 (Number('') === 0)", () => {
      const parse = createNumericParser({ label: "Value" });
      expect(parse("")).toBe(0);
    });
  });

  describe("non-numeric input", () => {
    it("throws InvalidArgumentError with label message for 'abc'", () => {
      const parse = createNumericParser({ label: "Count" });
      expect(() => parse("abc")).toThrow(InvalidArgumentError);
      expect(() => parse("abc")).toThrow("Count must be a number.");
    });

    it("throws InvalidArgumentError for 'NaN' string", () => {
      const parse = createNumericParser({ label: "Value" });
      // 'NaN' converts to NaN via Number()
      expect(() => parse("NaN")).toThrow(InvalidArgumentError);
      expect(() => parse("NaN")).toThrow("Value must be a number.");
    });
  });

  describe("integer violation", () => {
    it("throws InvalidArgumentError when 1.5 is given with integer: true", () => {
      const parse = createNumericParser({ label: "MaxTokens", integer: true });
      expect(() => parse("1.5")).toThrow(InvalidArgumentError);
      expect(() => parse("1.5")).toThrow("MaxTokens must be an integer.");
    });

    it("throws for any decimal with integer: true", () => {
      const parse = createNumericParser({ label: "Limit", integer: true });
      expect(() => parse("100.001")).toThrow(InvalidArgumentError);
      expect(() => parse("100.001")).toThrow("Limit must be an integer.");
    });

    it("does NOT throw for float when integer is not set", () => {
      const parse = createNumericParser({ label: "Temperature" });
      expect(() => parse("1.5")).not.toThrow();
    });
  });

  describe("min/max bounds", () => {
    it("throws when value is below min", () => {
      const parse = createNumericParser({ label: "Temperature", min: 0 });
      expect(() => parse("-1")).toThrow(InvalidArgumentError);
      expect(() => parse("-1")).toThrow("Temperature must be greater than or equal to 0.");
    });

    it("accepts value equal to min (boundary)", () => {
      const parse = createNumericParser({ label: "Temperature", min: 0 });
      expect(parse("0")).toBe(0);
    });

    it("throws when value is above max", () => {
      const parse = createNumericParser({ label: "Temperature", max: 2 });
      expect(() => parse("3")).toThrow(InvalidArgumentError);
      expect(() => parse("3")).toThrow("Temperature must be less than or equal to 2.");
    });

    it("accepts value equal to max (boundary)", () => {
      const parse = createNumericParser({ label: "Temperature", max: 2 });
      expect(parse("2")).toBe(2);
    });

    it("works with only min specified (no max)", () => {
      const parse = createNumericParser({ label: "Budget", min: 0.01 });
      expect(() => parse("0")).toThrow(InvalidArgumentError);
      expect(parse("0.01")).toBe(0.01);
      expect(parse("999999")).toBe(999999);
    });

    it("works with only max specified (no min)", () => {
      const parse = createNumericParser({ label: "Retries", max: 10 });
      expect(() => parse("11")).toThrow(InvalidArgumentError);
      expect(parse("-100")).toBe(-100);
      expect(parse("10")).toBe(10);
    });

    it("accepts value within [min, max] range", () => {
      const parse = createNumericParser({ label: "Temperature", min: 0, max: 2 });
      expect(parse("1")).toBe(1);
      expect(parse("0.5")).toBe(0.5);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isInteractive
// ─────────────────────────────────────────────────────────────────────────────

describe("isInteractive", () => {
  it("returns true when isTTY is true", () => {
    expect(isInteractive({ isTTY: true } as NodeJS.ReadableStream & { isTTY?: boolean })).toBe(
      true,
    );
  });

  it("returns false when isTTY is false", () => {
    expect(isInteractive({ isTTY: false } as NodeJS.ReadableStream & { isTTY?: boolean })).toBe(
      false,
    );
  });

  it("returns false when isTTY is absent (coerced via Boolean)", () => {
    expect(isInteractive({} as NodeJS.ReadableStream & { isTTY?: boolean })).toBe(false);
  });

  it("returns false when isTTY is undefined", () => {
    expect(isInteractive({ isTTY: undefined } as NodeJS.ReadableStream & { isTTY?: boolean })).toBe(
      false,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// executeAction
// ─────────────────────────────────────────────────────────────────────────────

describe("executeAction", () => {
  describe("success", () => {
    it("awaits the action and resolves without errors", async () => {
      const { env, stderrContent, setExitCode } = createFakeEnv();
      let ran = false;

      await executeAction(async () => {
        ran = true;
      }, env);

      expect(ran).toBe(true);
      expect(stderrContent()).toBe("");
      expect(setExitCode).not.toHaveBeenCalled();
    });

    it("does not write to stderr on success", async () => {
      const { env, stderrContent } = createFakeEnv();

      await executeAction(async () => {
        // no-op
      }, env);

      expect(stderrContent()).toBe("");
    });
  });

  describe("Error thrown", () => {
    it("writes an 'Error:' prefix to stderr", async () => {
      const { env, stderrContent } = createFakeEnv();

      await executeAction(async () => {
        throw new Error("something went wrong");
      }, env);

      expect(stderrContent()).toContain("Error:");
    });

    it("includes the error message in stderr output", async () => {
      const { env, stderrContent } = createFakeEnv();

      await executeAction(async () => {
        throw new Error("something went wrong");
      }, env);

      expect(stderrContent()).toContain("something went wrong");
    });

    it("calls setExitCode(1) when an Error is thrown", async () => {
      const { env, setExitCode } = createFakeEnv();

      await executeAction(async () => {
        throw new Error("oops");
      }, env);

      expect(setExitCode).toHaveBeenCalledWith(1);
      expect(setExitCode).toHaveBeenCalledTimes(1);
    });
  });

  describe("non-Error thrown", () => {
    it("uses String(error) fallback for non-Error values", async () => {
      const { env, stderrContent } = createFakeEnv();

      await executeAction(async () => {
        // eslint-disable-next-line no-throw-literal
        throw "raw string error";
      }, env);

      expect(stderrContent()).toContain("raw string error");
    });

    it("calls setExitCode(1) for non-Error thrown values", async () => {
      const { env, setExitCode } = createFakeEnv();

      await executeAction(async () => {
        throw 42;
      }, env);

      expect(setExitCode).toHaveBeenCalledWith(1);
    });

    it("handles thrown objects via String()", async () => {
      const { env, stderrContent } = createFakeEnv();

      await executeAction(async () => {
        throw { toString: () => "custom object error" };
      }, env);

      expect(stderrContent()).toContain("custom object error");
    });
  });
});
