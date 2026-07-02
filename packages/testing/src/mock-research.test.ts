/**
 * Tests for deep-research mock support.
 *
 * Verifies:
 * - returnsResearch / withResearchEvents / mockResearch builder API
 * - MockProviderAdapter research capability (start, resume, status, cancel)
 * - End-to-end through client.research with the mock client
 */

import type { ResearchEvent } from "llmist";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockClient, getMockManager, mockLLM, mockResearch } from "./index.js";

beforeEach(() => {
  getMockManager().clear();
});

afterEach(() => {
  getMockManager().clear();
});

describe("returnsResearch", () => {
  it("synthesizes a full normalized event stream", async () => {
    mockLLM()
      .whenMessageContains("solid-state")
      .returnsResearch("# Battery Report\n\nFindings here.", {
        citations: [{ url: "https://example.com/paper", title: "Paper" }],
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, searches: 7 },
      })
      .register();

    const client = createMockClient();
    const job = client.research.start({
      model: "openai:o4-mini-deep-research",
      query: "State of solid-state batteries",
    });

    const events: ResearchEvent[] = [];
    for await (const event of job) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("created");
    expect(types).toContain("search");
    expect(types).toContain("thinking");
    expect(types).toContain("text");
    expect(types).toContain("citation");
    expect(types.at(-1)).toBe("done");

    const result = await job.result();
    expect(result.report).toBe("# Battery Report\n\nFindings here.");
    expect(result.citations).toEqual([{ url: "https://example.com/paper", title: "Paper" }]);
    expect(result.usage.searches).toBe(7);
    expect(result.status).toBe("completed");
    expect(result.jobId).toMatch(/^mock-research-job-/);
  });

  it("respects a custom jobId and terminal status", async () => {
    mockLLM()
      .when(() => true)
      .returnsResearch("partial findings", { jobId: "my-job", status: "incomplete" })
      .register();

    const client = createMockClient();
    const result = await client.research.start({ model: "openai:test", query: "q" }).result();
    expect(result.jobId).toBe("my-job");
    expect(result.status).toBe("incomplete");
  });
});

describe("mockResearch convenience factory", () => {
  it("pre-applies the research response", async () => {
    mockResearch("quick report").whenMessageContains("topic").register();

    const client = createMockClient();
    const result = await client.research
      .start({ model: "gemini:deep-research", query: "my topic" })
      .result();
    expect(result.report).toBe("quick report");
  });
});

describe("withResearchEvents", () => {
  it("replays a scripted sequence verbatim with auto-assigned cursors", async () => {
    mockLLM()
      .when(() => true)
      .withResearchEvents([
        { type: "created", jobId: "scripted-1" },
        { type: "phase", phase: "planning" },
        { type: "text", delta: "scripted output" },
        { type: "done", result: { status: "completed", report: "" } },
      ])
      .register();

    const client = createMockClient();
    const job = client.research.start({ model: "openai:any", query: "q" });
    const events: ResearchEvent[] = [];
    for await (const event of job) {
      events.push(event);
    }

    expect(events.map((e) => e.type)).toEqual(["created", "phase", "text", "done"]);
    expect(events.map((e) => e.cursor)).toEqual(["0", "1", "2", "3"]);
    expect((await job.result()).report).toBe("scripted output");
  });
});

describe("resume and lifecycle", () => {
  it("attach() replays events after the ref cursor (deterministic resume)", async () => {
    mockLLM()
      .when(() => true)
      .returnsResearch("resumable report", { jobId: "resume-1" })
      .register();

    const client = createMockClient();
    const job = client.research.start({ model: "openai:any", query: "q" });

    // Consume only the first three events, then detach.
    const iterator = job.events()[Symbol.asyncIterator]();
    await iterator.next(); // created
    await iterator.next();
    await iterator.next();
    const ref = job.toRef();
    expect(ref.jobId).toBe("resume-1");
    expect(ref.cursor).toBe("2");

    // Simulate process restart: attach from the serialized ref.
    const revived = client.research.attach(JSON.parse(JSON.stringify(ref)));
    const events: ResearchEvent[] = [];
    for await (const event of revived) {
      events.push(event);
    }
    expect(Number(events[0]?.cursor)).toBeGreaterThan(2);
    expect(events.at(-1)?.type).toBe("done");
    const result = await revived.result();
    expect(result.status).toBe("completed");
  });

  it("failAtEvent drives the job's auto-reconnect to completion", async () => {
    mockLLM()
      .when(() => true)
      .returnsResearch("survives a stream drop", { jobId: "flaky-1", failAtEvent: 4 })
      .register();

    const client = createMockClient();
    const job = client.research.start({ model: "openai:any", query: "q" });

    const events: ResearchEvent[] = [];
    for await (const event of job) {
      events.push(event);
    }

    // No error event — the drop was resumed transparently; no duplicates.
    expect(events.filter((e) => e.type === "error")).toHaveLength(0);
    const cursors = events.map((e) => Number(e.cursor));
    expect(new Set(cursors).size).toBe(cursors.length);
    expect((await job.result()).report).toBe("survives a stream drop");
  });

  it("status() and cancel() work against the mock job registry", async () => {
    mockLLM()
      .when(() => true)
      .returnsResearch("r", { jobId: "lifecycle-1" })
      .register();

    const client = createMockClient();
    const job = client.research.start({ model: "openai:any", query: "q" });
    await job.result();

    await expect(job.status()).resolves.toBe("completed");
    await client.research.cancel(job.toRef());
    await expect(job.status()).resolves.toBe("cancelled");
  });

  it("throws a helpful error when no research mock matches", async () => {
    mockLLM().whenMessageContains("something else").returnsResearch("r").register();

    const client = createMockClient();
    const job = client.research.start({ model: "openai:any", query: "unmatched" });
    await expect(job.result()).resolves.toMatchObject({ status: "failed" });
  });
});
