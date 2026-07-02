import { Writable } from "node:stream";
import { Command } from "commander";
import type { LLMist, ResearchEvent, ResearchJob, ResearchJobRef, ResearchResult } from "llmist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CLIEnvironment } from "./environment.js";
import { executeResearch, registerResearchCommand } from "./research-command.js";

vi.mock("./utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils.js")>();
  return {
    ...actual,
    resolvePrompt: vi.fn().mockResolvedValue("resolved research question"),
    executeAction: vi.fn(async (fn: () => Promise<void>) => {
      await fn();
    }),
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, writeFileSync: vi.fn() };
});

import { writeFileSync } from "node:fs";

// --- Test harness ---------------------------------------------------------

function collectStream(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  return { stream, text: () => chunks.join("") };
}

interface FakeJobConfig {
  events?: ResearchEvent[];
  result?: Partial<ResearchResult>;
  jobId?: string | null;
}

function defaultEvents(): ResearchEvent[] {
  return [
    { type: "created", jobId: "job-7", cursor: "0" },
    { type: "status", status: "in_progress", cursor: "1" },
    { type: "phase", phase: "searching", cursor: "2" },
    { type: "search", action: "search", status: "started", query: "batteries", cursor: "3" },
    { type: "text", delta: "Report line one. ", cursor: "4" },
    { type: "text", delta: "Report line two.", cursor: "5" },
    {
      type: "usage",
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, searches: 4 },
      cursor: "6",
    },
    { type: "done", result: { status: "completed", report: "" }, cursor: "7" },
  ];
}

function fakeJob(config: FakeJobConfig = {}): ResearchJob & { cancelled: boolean } {
  const events = config.events ?? defaultEvents();
  const jobId = config.jobId === undefined ? "job-7" : config.jobId;
  const result: ResearchResult = {
    jobId,
    provider: "mock",
    model: "fake-research",
    status: "completed",
    report: "Report line one. Report line two.",
    citations: [{ url: "https://a.example", title: "Source A" }],
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, searches: 4, costUSD: 0.42 },
    durationMs: 12_000,
    ...config.result,
  };

  const job = {
    jobId,
    provider: "mock",
    model: "fake-research",
    cancelled: false,
    async *[Symbol.asyncIterator]() {
      yield* events;
    },
    events() {
      return this[Symbol.asyncIterator]();
    },
    async result() {
      return result;
    },
    async status() {
      return result.status;
    },
    async cancel() {
      (this as { cancelled: boolean }).cancelled = true;
    },
    toRef(): ResearchJobRef {
      if (jobId === null) throw new Error("not resumable");
      return { provider: "mock", model: "fake-research", jobId, cursor: "0" };
    },
  };
  return job as unknown as ResearchJob & { cancelled: boolean };
}

interface FakeResearchNamespace {
  start: ReturnType<typeof vi.fn>;
  attach: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  listModels: ReturnType<typeof vi.fn>;
}

function makeEnv(job: ResearchJob): {
  env: CLIEnvironment;
  research: FakeResearchNamespace;
  stdout: () => string;
  stderr: () => string;
  exitCodes: number[];
} {
  const out = collectStream();
  const err = collectStream();
  const exitCodes: number[] = [];
  const research: FakeResearchNamespace = {
    start: vi.fn(() => job),
    attach: vi.fn(() => job),
    cancel: vi.fn(async () => {}),
    listModels: vi.fn(() => [
      { provider: "openai", modelId: "gpt-5.5-pro" },
      { provider: "openrouter", modelId: "perplexity/sonar-deep-research" },
    ]),
  };
  const env = {
    argv: [],
    stdin: Object.assign(new Writable(), { isTTY: false }),
    stdout: out.stream,
    stderr: err.stream,
    createClient: () => ({ research }) as unknown as LLMist,
    setExitCode: (code: number) => {
      exitCodes.push(code);
    },
    createLogger: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
    isTTY: false,
    prompt: async () => "",
  } as unknown as CLIEnvironment;
  return { env, research, stdout: out.text, stderr: err.text, exitCodes };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// --- Tests -----------------------------------------------------------------

describe("executeResearch — formatted mode", () => {
  it("streams the report to stdout and progress to stderr, with citations and summary", async () => {
    const { env, research, stdout, stderr, exitCodes } = makeEnv(fakeJob());

    await executeResearch("q", { model: "openai:gpt-5.5-pro" }, env);

    expect(research.start).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openai:gpt-5.5-pro", query: "resolved research question" }),
    );
    const out = stdout();
    expect(out).toContain("Report line one. Report line two.");
    expect(out).toContain("Sources:");
    expect(out).toContain("[1] https://a.example — Source A");

    const err = stderr();
    expect(err).toContain("Status: in_progress");
    expect(err).toContain("Phase: searching");
    expect(err).toContain("Searching: batteries");
    expect(err).toContain("status: completed");
    expect(err).toContain("4 searches");

    expect(exitCodes).toEqual([]);
  });

  it("requires --model and lists research-capable models in the error", async () => {
    const { env } = makeEnv(fakeJob());
    await expect(executeResearch("q", {}, env)).rejects.toThrow(
      /--model is required[\s\S]*openai:gpt-5\.5-pro/,
    );
  });

  it("sets exit code 1 on failed runs and 2 on partial runs", async () => {
    const failed = makeEnv(fakeJob({ result: { status: "failed" } }));
    await executeResearch("q", { model: "m" }, failed.env);
    expect(failed.exitCodes).toEqual([1]);

    const partial = makeEnv(fakeJob({ result: { status: "incomplete" } }));
    await executeResearch("q", { model: "m" }, partial.env);
    expect(partial.exitCodes).toEqual([2]);
  });

  it("writes the report to a file with --output", async () => {
    const { env, stdout, stderr } = makeEnv(fakeJob());
    await executeResearch("q", { model: "m", output: "/tmp/report.md" }, env);
    expect(writeFileSync).toHaveBeenCalledWith(
      "/tmp/report.md",
      expect.stringContaining("Report line one. Report line two."),
    );
    const written = vi.mocked(writeFileSync).mock.calls[0]?.[1] as string;
    expect(written).toContain("Sources:");
    expect(written).toContain("[1] https://a.example — Source A");
    expect(stdout()).not.toContain("Report line one");
    expect(stderr()).toContain("Report saved to /tmp/report.md");
  });

  it("persists the partial and exits 2 when a run times out (--output)", async () => {
    // A client-side timeout yields a partial: an "incomplete" status, a timeout
    // error event, and the report collected so far. The partial must still be
    // written to --output, the timeout printed once, and the exit code 2.
    const events: ResearchEvent[] = [
      { type: "created", jobId: "job-7" },
      { type: "status", status: "in_progress" },
      { type: "text", delta: "Partial report so far." },
      { type: "status", status: "incomplete" },
      { type: "error", error: { message: "research timed out after 5000ms", retryable: false } },
    ];
    const { env, stderr, exitCodes } = makeEnv(
      fakeJob({
        events,
        result: { status: "incomplete", report: "Partial report so far.", citations: [] },
      }),
    );

    await executeResearch("q", { model: "m", output: "/tmp/partial.md" }, env);

    expect(writeFileSync).toHaveBeenCalledWith(
      "/tmp/partial.md",
      expect.stringContaining("Partial report so far."),
    );
    expect(exitCodes).toEqual([2]);
    const err = stderr();
    expect(err).toContain("Error: research timed out");
    // Printed once — no double-print from a re-thrown failure.
    expect(err.match(/timed out/g)?.length).toBe(1);
    expect(err).toContain("Report saved to /tmp/partial.md");
  });

  it("prints a wholesale report from poll-only runs (no text deltas)", async () => {
    const events: ResearchEvent[] = [
      { type: "created", jobId: "job-9" },
      { type: "status", status: "in_progress" },
      { type: "done", result: { status: "completed", report: "" } },
    ];
    const { env, stdout } = makeEnv(
      fakeJob({ events, result: { report: "Wholesale report body." } }),
    );
    await executeResearch("q", { model: "m" }, env);
    expect(stdout()).toContain("Wholesale report body.");
  });
});

describe("executeResearch — NDJSON mode", () => {
  it("emits one JSON event per line without rawEvent", async () => {
    const events = defaultEvents().map((event) => ({ ...event, rawEvent: { huge: true } }));
    const { env, stdout, stderr } = makeEnv(fakeJob({ events }));

    await executeResearch("q", { model: "m", json: true }, env);

    const lines = stdout().trim().split("\n");
    expect(lines).toHaveLength(events.length);
    const parsed = lines.map((line) => JSON.parse(line));
    expect(parsed[0]).toEqual({ type: "created", jobId: "job-7", cursor: "0" });
    for (const event of parsed) {
      expect(event.rawEvent).toBeUndefined();
    }
    expect(stderr()).toBe("");
  });
});

describe("executeResearch — background workflow", () => {
  it("--background prints the serialized ref to stdout and exits cleanly", async () => {
    const { env, research, stdout, stderr } = makeEnv(fakeJob());

    await executeResearch("q", { model: "m", background: true }, env);

    expect(research.start).toHaveBeenCalledWith(
      expect.objectContaining({ background: true, signal: expect.any(AbortSignal) }),
    );
    const ref = JSON.parse(stdout().trim());
    expect(ref).toMatchObject({ provider: "mock", jobId: "job-7" });
    expect(stderr()).toContain("Resume with");
  });

  it("--background on a provider without job ids fails with guidance", async () => {
    const events: ResearchEvent[] = [{ type: "created", jobId: null }];
    const { env } = makeEnv(fakeJob({ events, jobId: null }));
    await expect(executeResearch("q", { model: "m", background: true }, env)).rejects.toThrow(
      /does not support background/,
    );
  });

  it("--resume attaches from the ref JSON", async () => {
    const { env, research, stdout } = makeEnv(fakeJob());
    const ref = JSON.stringify({ provider: "mock", model: "fake-research", jobId: "job-7" });

    await executeResearch(undefined, { resume: ref }, env);

    expect(research.attach).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "mock", jobId: "job-7" }),
    );
    expect(stdout()).toContain("Report line one.");
  });

  it("--resume rejects malformed refs", async () => {
    const { env } = makeEnv(fakeJob());
    await expect(executeResearch(undefined, { resume: "not json" }, env)).rejects.toThrow(
      /--resume expects the JSON ref/,
    );
    await expect(executeResearch(undefined, { resume: '{"nope": 1}' }, env)).rejects.toThrow(
      /missing required/,
    );
  });

  it("--cancel cancels through the namespace", async () => {
    const { env, research, stderr } = makeEnv(fakeJob());
    const ref = JSON.stringify({ provider: "mock", model: "fake-research", jobId: "job-7" });

    await executeResearch(undefined, { cancel: ref }, env);

    expect(research.cancel).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-7" }));
    expect(stderr()).toContain("Cancelled research job job-7");
  });
});

describe("executeResearch — input validation", () => {
  it("rejects a non-numeric --timeout instead of forwarding NaN", async () => {
    const { env, research } = makeEnv(fakeJob());
    await expect(executeResearch("q", { model: "m", timeout: "notanumber" }, env)).rejects.toThrow(
      /--timeout expects a positive integer/,
    );
    expect(research.start).not.toHaveBeenCalled();
  });

  it("rejects a zero or negative --timeout", async () => {
    const { env } = makeEnv(fakeJob());
    await expect(executeResearch("q", { model: "m", timeout: "0" }, env)).rejects.toThrow(
      /--timeout expects a positive integer/,
    );
    await expect(executeResearch("q", { model: "m", timeout: "-5" }, env)).rejects.toThrow(
      /--timeout expects a positive integer/,
    );
  });

  it("rejects a non-numeric --max-tool-calls instead of forwarding NaN", async () => {
    const { env, research } = makeEnv(fakeJob());
    await expect(executeResearch("q", { model: "m", maxToolCalls: "xyz" }, env)).rejects.toThrow(
      /--max-tool-calls expects a positive integer/,
    );
    expect(research.start).not.toHaveBeenCalled();
  });

  it("rejects a ref missing the required model field", async () => {
    const { env } = makeEnv(fakeJob());
    await expect(
      executeResearch(undefined, { resume: '{"provider":"mock","jobId":"job-7"}' }, env),
    ).rejects.toThrow(/missing required/);
  });
});

describe("executeResearch — ignored flag warnings", () => {
  it("warns that --output is ignored in --json mode", async () => {
    const { env, stderr } = makeEnv(fakeJob());
    await executeResearch("q", { model: "m", json: true, output: "/tmp/report.md" }, env);
    expect(stderr()).toContain("--output is ignored in --json mode");
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("warns that --timeout is ignored with --resume and does not forward it", async () => {
    const { env, research, stderr } = makeEnv(fakeJob());
    const ref = JSON.stringify({ provider: "mock", model: "fake-research", jobId: "job-7" });
    await executeResearch(undefined, { resume: ref, timeout: "900" }, env, {
      timeoutFromCli: true,
    });
    expect(stderr()).toContain("--timeout is ignored with --resume");
    expect(research.attach).toHaveBeenCalled();
    expect(research.start).not.toHaveBeenCalled();
  });

  it("does not warn when --timeout came from a config default, only when explicit", async () => {
    // registerResearchCommand feeds `[deep-research].timeout` as commander's
    // default, so options.timeout is defined even when the user never typed
    // --timeout. The warning must key on the CLI source, not mere presence.
    const ref = JSON.stringify({ provider: "mock", model: "fake-research", jobId: "job-7" });
    const configEnv = makeEnv(fakeJob());
    await executeResearch(undefined, { resume: ref, timeout: "900" }, configEnv.env, {
      timeoutFromCli: false,
    });
    expect(configEnv.stderr()).not.toContain("--timeout is ignored");
  });
});

describe("registerResearchCommand", () => {
  it("registers the command with config defaults applied", async () => {
    const { env, research } = makeEnv(fakeJob());
    const program = new Command();
    program.exitOverride();

    registerResearchCommand(program, env, { model: "openrouter:perplexity/sonar-deep-research" });

    await program.parseAsync(["node", "llmist", "deep-research", "my question"]);

    expect(research.start).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openrouter:perplexity/sonar-deep-research" }),
    );
  });

  it("maps --max-tool-calls to maxToolCalls", async () => {
    const { env, research } = makeEnv(fakeJob());
    const program = new Command();
    program.exitOverride();
    registerResearchCommand(program, env, undefined);

    await program.parseAsync([
      "node",
      "llmist",
      "deep-research",
      "q",
      "-m",
      "m",
      "--max-tool-calls",
      "8",
    ]);

    expect(research.start).toHaveBeenCalledWith(expect.objectContaining({ maxToolCalls: 8 }));
  });

  it("maps --timeout seconds to timeoutMs", async () => {
    const { env, research } = makeEnv(fakeJob());
    const program = new Command();
    program.exitOverride();
    registerResearchCommand(program, env, undefined);

    await program.parseAsync([
      "node",
      "llmist",
      "deep-research",
      "q",
      "-m",
      "m",
      "--timeout",
      "900",
    ]);

    expect(research.start).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 900_000 }));
  });
});
