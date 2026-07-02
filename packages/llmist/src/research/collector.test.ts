import { describe, expect, it } from "vitest";
import { ResearchResultCollector } from "./collector.js";
import type { ResearchModelSpec } from "./model-spec.js";
import type { ResearchEvent } from "./types.js";

const CONTEXT = { provider: "mock", model: "test-model", jobId: "job-1" as string | null };

function collect(events: ResearchEvent[], context = CONTEXT, spec?: ResearchModelSpec) {
  const collector = new ResearchResultCollector(spec);
  for (const event of events) {
    collector.ingest(event);
  }
  return collector.toResult(context);
}

const SPEC: ResearchModelSpec = {
  provider: "mock",
  modelId: "test-model",
  kind: "model",
  displayName: "Test Model",
  pricing: { input: 2, output: 8, perThousandSearches: 5 },
  capabilities: { streaming: true, background: true, resumable: true, tools: ["web_search"] },
};

describe("ResearchResultCollector", () => {
  it("accumulates text deltas into the report", () => {
    const result = collect([
      { type: "text", delta: "Solid-state batteries " },
      { type: "text", delta: "are advancing." },
      { type: "done", result: { status: "completed", report: "" } },
    ]);
    expect(result.report).toBe("Solid-state batteries are advancing.");
    expect(result.status).toBe("completed");
  });

  it("prefers a wholesale report from done over accumulated deltas", () => {
    const result = collect([
      { type: "text", delta: "partial" },
      { type: "done", result: { status: "completed", report: "The full final report." } },
    ]);
    expect(result.report).toBe("The full final report.");
  });

  it("collects citations and dedupes by url + startIndex", () => {
    const result = collect([
      { type: "citation", citation: { url: "https://a.example", startIndex: 0, endIndex: 10 } },
      { type: "citation", citation: { url: "https://a.example", startIndex: 0, endIndex: 10 } },
      { type: "citation", citation: { url: "https://a.example", startIndex: 50, endIndex: 60 } },
      { type: "citation", citation: { url: "https://b.example", title: "B" } },
      { type: "done", result: { status: "completed", report: "r" } },
    ]);
    expect(result.citations).toHaveLength(3);
    expect(result.citations.map((c) => c.url)).toEqual([
      "https://a.example",
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("merges citations from the done payload with streamed ones", () => {
    const result = collect([
      { type: "citation", citation: { url: "https://a.example" } },
      {
        type: "done",
        result: {
          status: "completed",
          report: "r",
          citations: [{ url: "https://a.example" }, { url: "https://c.example" }],
        },
      },
    ]);
    expect(result.citations.map((c) => c.url)).toEqual(["https://a.example", "https://c.example"]);
  });

  it("merges usage events — later token fields win, searches take the max", () => {
    const result = collect([
      { type: "usage", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, searches: 3 } },
      {
        type: "usage",
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, searches: 8 },
      },
      { type: "done", result: { status: "completed", report: "r" } },
    ]);
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);
    expect(result.usage.searches).toBe(8);
  });

  it("falls back to the last status event when the stream ends without done", () => {
    const result = collect([
      { type: "status", status: "in_progress" },
      { type: "status", status: "failed" },
    ]);
    expect(result.status).toBe("failed");
  });

  it("records duration between first and terminal event", () => {
    const collector = new ResearchResultCollector(undefined, () => 1_000);
    collector.ingest({ type: "status", status: "in_progress" });
    const later = new ResearchResultCollector(undefined);
    // deterministic clock: first tick 1000, second tick 61_000
    let tick = 0;
    const clock = () => (tick++ === 0 ? 1_000 : 61_000);
    const timed = new ResearchResultCollector(undefined, clock);
    timed.ingest({ type: "status", status: "in_progress" });
    timed.ingest({ type: "done", result: { status: "completed", report: "r" } });
    expect(timed.toResult(CONTEXT).durationMs).toBe(60_000);
    expect(collector.toResult(CONTEXT).durationMs).toBeUndefined(); // no terminal event
    expect(later).toBeDefined();
  });

  it("computes costUSD from spec pricing", () => {
    const result = collect(
      [
        {
          type: "usage",
          usage: {
            inputTokens: 1_000_000,
            outputTokens: 500_000,
            totalTokens: 1_500_000,
            searches: 40,
          },
        },
        { type: "done", result: { status: "completed", report: "r" } },
      ],
      CONTEXT,
      SPEC,
    );
    // 1M input * $2/M + 0.5M output * $8/M + 40 searches * $5/1k = 2 + 4 + 0.2
    expect(result.usage.costUSD).toBeCloseTo(6.2, 6);
  });

  it("keeps a provider-reported costUSD over the catalog estimate", () => {
    const result = collect(
      [
        {
          type: "usage",
          usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200, costUSD: 0.55 },
        },
        { type: "done", result: { status: "completed", report: "r" } },
      ],
      CONTEXT,
      SPEC,
    );
    expect(result.usage.costUSD).toBe(0.55);
  });

  it("leaves costUSD undefined without a spec", () => {
    const result = collect([
      { type: "usage", usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } },
      { type: "done", result: { status: "completed", report: "r" } },
    ]);
    expect(result.usage.costUSD).toBeUndefined();
  });

  it("records the terminal error for result() consumers", () => {
    const collector = new ResearchResultCollector();
    collector.ingest({ type: "error", error: { message: "boom", retryable: false } });
    expect(collector.terminalError?.message).toBe("boom");
    const result = collector.toResult(CONTEXT);
    expect(result.status).toBe("failed");
  });

  it("treats an error after a non-terminal status as a failure", () => {
    // The common failure shape: progress, then an error with no terminal
    // status — the run failed.
    const result = collect([
      { type: "status", status: "in_progress" },
      { type: "text", delta: "partial" },
      { type: "error", error: { message: "provider exploded", retryable: false } },
    ]);
    expect(result.status).toBe("failed");
    expect(result.report).toBe("partial");
  });

  it("keeps an explicit terminal status (e.g. a timeout's incomplete) over the error→failed default", () => {
    // A client-side timeout emits an explicit "incomplete" status *before* the
    // timeout error — the run is a partial, not a failure. The explicit
    // terminal status must win.
    const result = collect([
      { type: "status", status: "in_progress" },
      { type: "text", delta: "partial" },
      { type: "status", status: "incomplete" },
      { type: "error", error: { message: "timed out", code: "timeout", retryable: false } },
    ]);
    expect(result.status).toBe("incomplete");
    expect(result.report).toBe("partial");
  });
});
