import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const READY_MS = 5_000;
const PARSE_MS = 2_000;
const REAP_MS = 1_000;
const ABSOLUTE_MS = 8_000;
const OUTPUT_LIMIT = 16_384;
const cwd = fileURLToPath(new URL("..", import.meta.url));

const parserProgram = `
import { load, SyntaxParseError } from "js-toml";
process.send({ kind: "ready" });
process.once("message", ({ input, captureValue }) => {
  let result;
  try {
    const parsed = load(input);
    // Never serialize unbounded values (in particular oversized bigint literals).
    result = { kind: "accepted", ...(captureValue ? { value: parsed.x } : {}) };
  } catch (error) {
    result = error instanceof SyntaxParseError
      ? { kind: "rejected", name: error.name, message: error.message.slice(0, 2048) }
      : { kind: "infrastructure", message: String(error).slice(0, 2048) };
  }
  process.send(result, () => process.disconnect());
});
`;

type ProbeOutcome =
  | { kind: "accepted"; value?: unknown }
  | { kind: "rejected"; name: string; message: string }
  | { kind: "timeout"; phase: "ready" | "parse" | "absolute" }
  | { kind: "infrastructure"; message: string };
type ProbeResult = ProbeOutcome & {
  elapsedMs: number;
  parseMs?: number;
  reaped: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
};

function runParserProbe(
  input: string,
  options: { program?: string; captureValue?: boolean } = {},
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", options.program ?? parserProgram],
      {
        cwd,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    let dispatched: number | undefined;
    let parseMs: number | undefined;
    let outcome: ProbeOutcome | undefined;
    let ready = false;
    let settled = false;
    let outputBytes = 0;
    let reapTimer: ReturnType<typeof setTimeout> | undefined;
    const absoluteTimer = setTimeout(
      () => stop({ kind: "timeout", phase: "absolute" }),
      ABSOLUTE_MS - REAP_MS,
    );
    let phaseTimer = setTimeout(() => stop({ kind: "timeout", phase: "ready" }), READY_MS);

    function finish(reaped: boolean, code: number | null, signal: NodeJS.Signals | null) {
      if (settled) return;
      settled = true;
      clearTimeout(absoluteTimer);
      clearTimeout(phaseTimer);
      clearTimeout(reapTimer);
      child.removeAllListeners();
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      resolve({
        ...(outcome ?? { kind: "infrastructure", message: "Child exited without a result" }),
        elapsedMs: performance.now() - started,
        parseMs,
        reaped,
        code,
        signal,
      });
    }

    function awaitReap() {
      reapTimer = setTimeout(() => {
        child.kill("SIGKILL");
        outcome = { kind: "infrastructure", message: "Child did not reap within budget" };
        finish(false, child.exitCode, child.signalCode);
      }, REAP_MS);
    }

    function stop(reason: ProbeOutcome) {
      if (settled) return;
      outcome = reason;
      if (dispatched !== undefined && parseMs === undefined)
        parseMs = performance.now() - dispatched;
      clearTimeout(phaseTimer);
      clearTimeout(absoluteTimer);
      clearTimeout(reapTimer);
      child.kill("SIGKILL");
      awaitReap();
    }

    const drain = (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > OUTPUT_LIMIT)
        stop({ kind: "infrastructure", message: "Child output limit exceeded" });
    };
    child.stdout.on("data", drain);
    child.stderr.on("data", drain);
    child.on("error", (error) => stop({ kind: "infrastructure", message: error.message }));
    child.on("message", (message) => {
      if (outcome || settled) return;
      if (typeof message !== "object" || message === null || !("kind" in message)) {
        stop({ kind: "infrastructure", message: "Malformed child message" });
        return;
      }
      if (message.kind === "ready" && !ready) {
        ready = true;
        clearTimeout(phaseTimer);
        dispatched = performance.now();
        phaseTimer = setTimeout(() => stop({ kind: "timeout", phase: "parse" }), PARSE_MS);
        child.send({ input, captureValue: options.captureValue ?? false }, (error) => {
          if (error) stop({ kind: "infrastructure", message: error.message });
        });
        return;
      }
      if (!ready || dispatched === undefined || performance.now() - dispatched > PARSE_MS) {
        stop({ kind: "infrastructure", message: "Result without timely ready/input handshake" });
        return;
      }
      parseMs = performance.now() - dispatched;
      if (message.kind === "accepted") {
        outcome = { kind: "accepted", value: "value" in message ? message.value : undefined };
      } else if (
        message.kind === "rejected" &&
        "name" in message &&
        message.name === "SyntaxParseError" &&
        "message" in message &&
        typeof message.message === "string" &&
        message.message.length > 0
      ) {
        outcome = { kind: "rejected", name: message.name, message: message.message };
      } else {
        stop({ kind: "infrastructure", message: "Invalid parser result" });
        return;
      }
      clearTimeout(phaseTimer);
      awaitReap();
    });
    child.once("close", (code, signal) => {
      if (outcome?.kind !== "timeout" && (code !== 0 || signal !== null)) {
        outcome = { kind: "infrastructure", message: `Child terminated: ${code}/${signal}` };
      }
      finish(true, code, signal);
    });
  });
}

function expectRejection(result: ProbeResult) {
  expect(result).toMatchObject({
    kind: "rejected",
    name: "SyntaxParseError",
    reaped: true,
    code: 0,
    signal: null,
  });
  expect(result.parseMs).toBeLessThan(PARSE_MS);
  expect(result.elapsedMs).toBeLessThan(ABSOLUTE_MS);
}

describe("bounded TOML parser probes", { timeout: 12_000 }, () => {
  it("accepts a valid control value", async () => {
    expect(await runParserProbe("x = 1", { captureValue: true })).toMatchObject({
      kind: "accepted",
      value: 1,
      reaped: true,
      code: 0,
      signal: null,
    });
  });

  it("identifies a genuine syntax error", async () => {
    expectRejection(await runParserProbe('x = "unterminated'));
  });

  it("kills and reaps a nonresponsive child", async () => {
    const result = await runParserProbe("", {
      program: 'process.send({ kind: "ready" }); process.on("message", () => { while (true) {} });',
    });
    expect(result).toMatchObject({
      kind: "timeout",
      phase: "parse",
      reaped: true,
      signal: "SIGKILL",
    });
    expect(result.elapsedMs).toBeLessThan(ABSOLUTE_MS);
  });

  it.each([
    ["crashed child", "process.exit(2)"],
    ["missing import", 'import "nonexistent-parser-probe-control";'],
    ["missing result", 'process.send({ kind: "ready" }, () => process.disconnect());'],
  ])("reports %s as infrastructure failure", async (_label, program) => {
    expect(await runParserProbe("", { program })).toMatchObject({
      kind: "infrastructure",
      reaped: true,
    });
  });

  it("rejects unterminated multiline whitespace within budget", async () => {
    const input = 'x = """\\\n' + " ".repeat(256);
    const result = await runParserProbe(input);
    console.info("multiline probe", {
      bytes: Buffer.byteLength(input),
      sha256: createHash("sha256").update(input).digest("hex"),
      ...result,
    });
    expectRejection(result);
  });

  it("preserves valid escaped-newline multiline text", async () => {
    expect(
      await runParserProbe('x = """\nHello\\\n    world"""', { captureValue: true }),
    ).toMatchObject({ kind: "accepted", value: "Helloworld", reaped: true, code: 0, signal: null });
  });

  it("rejects oversized decimal literals", async () => {
    expectRejection(await runParserProbe(`x = ${"1".repeat(1001)}`));
  });

  it.each(["+25:00", "+12:60"])("rejects invalid UTC offsets (%s)", async (offset) => {
    expectRejection(await runParserProbe(`x = 2000-01-01T00:00:00${offset}`));
  });

  it("rejects a duplicate super-table header", async () => {
    expectRejection(await runParserProbe("[a.b]\nx=1\n[a]\ny=2\n[a]\nz=3\n"));
  });
});
