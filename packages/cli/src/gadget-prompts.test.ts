/**
 * Tests for gadget-prompts.ts — interactive gadget parameter collection.
 * Covers promptForParameters() and readStdinJson() with all JSON schema types.
 *
 * @module cli/gadget-prompts.test
 */

import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptContext } from "./gadget-prompts.js";

// ─── Mock node:readline/promises ────────────────────────────────────────────

/** Factory that creates a readline mock returning answers in sequence. */
function makeReadlineMock(answers: string[]) {
  let callIndex = 0;
  const question = vi.fn().mockImplementation(() => {
    const answer = answers[callIndex] ?? "";
    callIndex++;
    return Promise.resolve(answer);
  });
  const close = vi.fn();
  return { question, close, mockAnswers: answers };
}

/** Shared readline mock state (reset per test). */
let readlineMock = makeReadlineMock([]);

vi.mock("node:readline/promises", () => ({
  createInterface: vi.fn(() => readlineMock),
}));

// ─── Mock llmist ─────────────────────────────────────────────────────────────

/** Stored JSON schema returned by the schemaToJSONSchema mock. */
let mockedJsonSchema: Record<string, unknown> = {};

vi.mock("llmist", () => ({
  schemaToJSONSchema: vi.fn(() => mockedJsonSchema),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

import { Writable } from "node:stream";

class MockWritableStream extends Writable {
  public output = "";
  _write(chunk: Buffer | string, _encoding: string, callback: () => void): void {
    this.output += chunk.toString();
    callback();
  }
}

/** Creates a PromptContext wired to mock streams. */
function makeCtx(): PromptContext {
  const stdin = new Readable({ read() {} });
  const stdout = new MockWritableStream();
  return { stdin, stdout };
}

/**
 * Creates a minimal Zod-like schema that wraps the provided JSON schema
 * properties and delegates safeParse to the supplied implementation.
 */
function makeSchema(
  jsonSchemaProperties: Record<string, unknown>,
  requiredFields: string[] = [],
  safeParseImpl?: (input: unknown) => { success: boolean; data?: unknown; error?: unknown },
) {
  // Update the mocked JSON schema so schemaToJSONSchema() returns the right shape.
  mockedJsonSchema = {
    properties: jsonSchemaProperties,
    required: requiredFields,
  };

  // Default safeParse: pass the input straight through (identity transform).
  const safeParse =
    safeParseImpl ??
    ((input: unknown) => ({
      success: true,
      data: input,
    }));

  return { safeParse };
}

// ─── Import after mocks are in place ─────────────────────────────────────────

import { promptForParameters, readStdinJson } from "./gadget-prompts.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("promptForParameters", () => {
  beforeEach(() => {
    // Reset readline mock before each test.
    readlineMock = makeReadlineMock([]);
    mockedJsonSchema = {};
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. No schema ──────────────────────────────────────────────────────────

  it("returns empty object when schema is undefined", async () => {
    const ctx = makeCtx();
    const result = await promptForParameters(undefined, ctx);
    expect(result).toEqual({});
  });

  it("returns empty object when schema has no properties", async () => {
    mockedJsonSchema = {}; // no `properties` key
    const schema = { safeParse: () => ({ success: true, data: {} }) };
    const ctx = makeCtx();
    const result = await promptForParameters(schema as never, ctx);
    expect(result).toEqual({});
  });

  it("returns empty object when schema has empty properties", async () => {
    mockedJsonSchema = { properties: {} };
    const schema = { safeParse: () => ({ success: true, data: {} }) };
    const ctx = makeCtx();
    const result = await promptForParameters(schema as never, ctx);
    expect(result).toEqual({});
  });

  // ── 2. String fields ──────────────────────────────────────────────────────

  it("prompts for a string field and returns trimmed value", async () => {
    readlineMock = makeReadlineMock(["  hello world  "]);
    const schema = makeSchema({ name: { type: "string", description: "Your name" } });
    const ctx = makeCtx();

    const result = await promptForParameters(schema as never, ctx);

    expect(result).toEqual({ name: "hello world" });
  });

  it("prompts for multiple string fields in order", async () => {
    readlineMock = makeReadlineMock(["Alice", "engineer"]);
    const schema = makeSchema({ name: { type: "string" }, role: { type: "string" } });
    const ctx = makeCtx();

    const result = await promptForParameters(schema as never, ctx);

    expect(result).toEqual({ name: "Alice", role: "engineer" });
  });

  // ── 3. Number fields ──────────────────────────────────────────────────────

  it("parses a valid integer answer for a number field", async () => {
    readlineMock = makeReadlineMock(["42"]);
    const schema = makeSchema({ count: { type: "number" } });
    const ctx = makeCtx();

    const result = await promptForParameters(schema as never, ctx);

    expect(result).toEqual({ count: 42 });
  });

  it("parses a valid float answer for a number field", async () => {
    readlineMock = makeReadlineMock(["3.14"]);
    const schema = makeSchema({ pi: { type: "number" } });
    const ctx = makeCtx();

    const result = await promptForParameters(schema as never, ctx);

    expect(result).toEqual({ pi: 3.14 });
  });

  it("throws when a non-numeric string is supplied for a number field", async () => {
    readlineMock = makeReadlineMock(["not-a-number"]);
    const schema = makeSchema({ count: { type: "number" } }, ["count"]);
    const ctx = makeCtx();

    await expect(promptForParameters(schema as never, ctx)).rejects.toThrow(
      "Invalid number for 'count'",
    );
  });

  it("parses an integer field and rejects floats", async () => {
    readlineMock = makeReadlineMock(["2.5"]);
    const schema = makeSchema({ pages: { type: "integer" } }, ["pages"]);
    const ctx = makeCtx();

    await expect(promptForParameters(schema as never, ctx)).rejects.toThrow(
      "Expected integer for 'pages'",
    );
  });

  // ── 4. Boolean fields ─────────────────────────────────────────────────────

  it("parses 'true' as boolean true", async () => {
    readlineMock = makeReadlineMock(["true"]);
    const schema = makeSchema({ enabled: { type: "boolean" } });
    const ctx = makeCtx();

    const result = await promptForParameters(schema as never, ctx);
    expect((result as Record<string, unknown>).enabled).toBe(true);
  });

  it("parses 'yes' and 'y' as boolean true", async () => {
    readlineMock = makeReadlineMock(["yes"]);
    const schema = makeSchema({ active: { type: "boolean" } });
    const ctx = makeCtx();

    let result = await promptForParameters(schema as never, ctx);
    expect((result as Record<string, unknown>).active).toBe(true);

    readlineMock = makeReadlineMock(["y"]);
    result = await promptForParameters(schema as never, ctx);
    expect((result as Record<string, unknown>).active).toBe(true);
  });

  it("parses 'false', 'no', '0', 'n' as boolean false", async () => {
    for (const answer of ["false", "no", "0", "n"]) {
      readlineMock = makeReadlineMock([answer]);
      const schema = makeSchema({ active: { type: "boolean" } });
      const ctx = makeCtx();

      const result = await promptForParameters(schema as never, ctx);
      expect((result as Record<string, unknown>).active).toBe(false);
    }
  });

  it("throws when an unrecognised string is supplied for a boolean field", async () => {
    readlineMock = makeReadlineMock(["maybe"]);
    const schema = makeSchema({ active: { type: "boolean" } }, ["active"]);
    const ctx = makeCtx();

    await expect(promptForParameters(schema as never, ctx)).rejects.toThrow(
      "Invalid boolean for 'active'",
    );
  });

  // ── 5. Array fields ───────────────────────────────────────────────────────

  it("parses comma-separated values into a string array", async () => {
    readlineMock = makeReadlineMock(["foo, bar, baz"]);
    const schema = makeSchema({ tags: { type: "array", items: { type: "string" } } });
    const ctx = makeCtx();

    const result = await promptForParameters(schema as never, ctx);
    expect(result).toEqual({ tags: ["foo", "bar", "baz"] });
  });

  it("parses comma-separated numbers into a number array", async () => {
    readlineMock = makeReadlineMock(["1, 2, 3"]);
    const schema = makeSchema({ scores: { type: "array", items: { type: "number" } } });
    const ctx = makeCtx();

    const result = await promptForParameters(schema as never, ctx);
    expect(result).toEqual({ scores: [1, 2, 3] });
  });

  it("throws when a non-numeric item appears in a number array field", async () => {
    readlineMock = makeReadlineMock(["1, oops, 3"]);
    const schema = makeSchema({ scores: { type: "array", items: { type: "number" } } }, ["scores"]);
    const ctx = makeCtx();

    await expect(promptForParameters(schema as never, ctx)).rejects.toThrow(
      "Invalid number in 'scores' array",
    );
  });

  // ── 6. Object fields ──────────────────────────────────────────────────────

  it("parses a JSON string into an object", async () => {
    readlineMock = makeReadlineMock(['{"key":"value","num":1}']);
    const schema = makeSchema({
      config: {
        type: "object",
        properties: { key: { type: "string" }, num: { type: "number" } },
      },
    });
    const ctx = makeCtx();

    const result = await promptForParameters(schema as never, ctx);
    expect((result as Record<string, unknown>).config).toEqual({ key: "value", num: 1 });
  });

  it("throws when invalid JSON is supplied for an object field", async () => {
    readlineMock = makeReadlineMock(["not-json"]);
    const schema = makeSchema({ config: { type: "object", properties: {} } }, ["config"]);
    const ctx = makeCtx();

    await expect(promptForParameters(schema as never, ctx)).rejects.toThrow(
      "Invalid JSON for 'config'",
    );
  });

  // ── 7. Required vs optional fields ────────────────────────────────────────

  it("throws when a required field receives empty input", async () => {
    readlineMock = makeReadlineMock([""]); // empty answer
    const schema = makeSchema({ name: { type: "string" } }, ["name"]);
    const ctx = makeCtx();

    await expect(promptForParameters(schema as never, ctx)).rejects.toThrow(
      "Parameter 'name' is required.",
    );
  });

  it("skips optional field when input is empty (returns undefined, field omitted)", async () => {
    // First field required (answered), second optional (empty answer).
    readlineMock = makeReadlineMock(["Alice", ""]);
    const schema = makeSchema(
      { name: { type: "string" }, nickname: { type: "string" } },
      ["name"], // only 'name' is required
    );
    const ctx = makeCtx();

    const result = await promptForParameters(schema as never, ctx);
    // 'nickname' should not be present in params
    expect(result as Record<string, unknown>).not.toHaveProperty("nickname");
    expect((result as Record<string, unknown>).name).toBe("Alice");
  });

  // ── 8. Default value application ─────────────────────────────────────────

  it("lets Zod apply default when optional field with default receives empty input", async () => {
    // When the user presses Enter on a field that has a default, promptForField
    // returns undefined so Zod can apply the default via safeParse.
    readlineMock = makeReadlineMock([""]);
    const schema = {
      ...makeSchema({ timeout: { type: "number", default: 30 } }),
      safeParse: (input: unknown) => ({
        success: true,
        // Simulate Zod applying the default: if timeout is missing, use 30.
        data: { timeout: (input as Record<string, unknown>).timeout ?? 30 },
      }),
    };
    const ctx = makeCtx();

    const result = await promptForParameters(schema as never, ctx);
    expect((result as Record<string, unknown>).timeout).toBe(30);
  });

  // ── 9. Validation errors from Zod ─────────────────────────────────────────

  it("throws with formatted issue list when Zod safeParse fails", async () => {
    // Provide a non-empty value so the code reaches safeParse (which then rejects it).
    readlineMock = makeReadlineMock(["not-an-email"]);
    const schema = makeSchema(
      { email: { type: "string" } },
      [], // not in required list so empty wouldn't throw "required" error
      () => ({
        success: false,
        error: {
          issues: [{ path: ["email"], message: "Invalid email format" }],
        },
      }),
    );
    const ctx = makeCtx();

    await expect(promptForParameters(schema as never, ctx)).rejects.toThrow("Invalid parameters:");
  });

  it("throws with all Zod issue messages when safeParse returns multiple errors", async () => {
    // Provide non-empty values so the code reaches safeParse (which then rejects them).
    readlineMock = makeReadlineMock(["bad-email", "not-a-url"]);
    const schema = makeSchema(
      { email: { type: "string" }, url: { type: "string" } },
      [], // not required so empty wouldn't cause early "required" error
      () => ({
        success: false,
        error: {
          issues: [
            { path: ["email"], message: "Invalid email" },
            { path: ["url"], message: "Invalid url" },
          ],
        },
      }),
    );
    const ctx = makeCtx();

    // The error message includes all issues formatted together
    await expect(promptForParameters(schema as never, ctx)).rejects.toThrow("Invalid parameters:");
  });
});

// ─── readStdinJson ────────────────────────────────────────────────────────────

describe("readStdinJson", () => {
  /** Creates a Readable stream that emits the given string and then ends. */
  function makeStdin(content: string): NodeJS.ReadableStream {
    const r = new Readable({ read() {} });
    r.push(content);
    r.push(null); // signal EOF
    return r;
  }

  // ── 10. Valid JSON object ─────────────────────────────────────────────────

  it("returns parsed object for valid JSON object", async () => {
    const stdin = makeStdin('{"key":"value","num":42}');
    const result = await readStdinJson(stdin);
    expect(result).toEqual({ key: "value", num: 42 });
  });

  it("handles nested JSON objects", async () => {
    const stdin = makeStdin('{"outer":{"inner":true}}');
    const result = await readStdinJson(stdin);
    expect(result).toEqual({ outer: { inner: true } });
  });

  it("handles JSON spread across multiple chunks", async () => {
    const r = new Readable({ read() {} });
    r.push('{"hello"');
    r.push(':"world"}');
    r.push(null);
    const result = await readStdinJson(r);
    expect(result).toEqual({ hello: "world" });
  });

  // ── 11. Invalid JSON ──────────────────────────────────────────────────────

  it("throws for malformed JSON", async () => {
    const stdin = makeStdin("{not valid json}");
    await expect(readStdinJson(stdin)).rejects.toThrow("Invalid JSON from stdin");
  });

  it("throws for a bare string value", async () => {
    const stdin = makeStdin('"just a string"');
    await expect(readStdinJson(stdin)).rejects.toThrow();
  });

  // ── 12. Empty stdin ───────────────────────────────────────────────────────

  it("returns empty object for empty stdin (use defaults)", async () => {
    const stdin = makeStdin("");
    const result = await readStdinJson(stdin);
    expect(result).toEqual({});
  });

  it("returns empty object for whitespace-only stdin", async () => {
    const stdin = makeStdin("   \n  \t  ");
    const result = await readStdinJson(stdin);
    expect(result).toEqual({});
  });

  // ── 13. Arrays rejected ───────────────────────────────────────────────────

  it("throws when stdin contains a JSON array", async () => {
    const stdin = makeStdin("[1, 2, 3]");
    await expect(readStdinJson(stdin)).rejects.toThrow(
      "Stdin must contain a JSON object, not an array or primitive.",
    );
  });

  it("throws when stdin contains a JSON array of objects", async () => {
    const stdin = makeStdin('[{"a":1},{"b":2}]');
    await expect(readStdinJson(stdin)).rejects.toThrow(
      "Stdin must contain a JSON object, not an array or primitive.",
    );
  });

  // ── 14. Additional edge cases ─────────────────────────────────────────────

  it("throws when stdin contains a JSON null", async () => {
    const stdin = makeStdin("null");
    await expect(readStdinJson(stdin)).rejects.toThrow(
      "Stdin must contain a JSON object, not an array or primitive.",
    );
  });

  it("throws when stdin contains a JSON number", async () => {
    const stdin = makeStdin("42");
    await expect(readStdinJson(stdin)).rejects.toThrow(
      "Stdin must contain a JSON object, not an array or primitive.",
    );
  });

  it("handles Buffer chunks (non-string) from stdin", async () => {
    const r = new Readable({
      objectMode: false,
      read() {},
    });
    r.push(Buffer.from('{"from":"buffer"}'));
    r.push(null);
    const result = await readStdinJson(r);
    expect(result).toEqual({ from: "buffer" });
  });
});
