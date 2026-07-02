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
      "Report line one. Report line two.",
    );
    expect(stdout()).not.toContain("Report line one");
    expect(stderr()).toContain("Report saved to /tmp/report.md");
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

describe("registerResearchCommand", () => {
  it("registers the command with config defaults applied", async () => {
    const { env, research } = makeEnv(fakeJob());
    const program = new Command();
    program.exitOverride();

    registerResearchCommand(program, env, { model: "openrouter:perplexity/sonar-deep-research" });

    await program.parseAsync(["node", "llmist", "research", "my question"]);

    expect(research.start).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openrouter:perplexity/sonar-deep-research" }),
    );
  });

  it("maps --timeout seconds to timeoutMs", async () => {
    const { env, research } = makeEnv(fakeJob());
    const program = new Command();
    program.exitOverride();
    registerResearchCommand(program, env, undefined);

    await program.parseAsync(["node", "llmist", "research", "q", "-m", "m", "--timeout", "900"]);

    expect(research.start).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 900_000 }));
  });
});
