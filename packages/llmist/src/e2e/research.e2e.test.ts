/**
 * E2E: deep research surface with the mock provider.
 *
 * Exercises the full public path: client construction → client.research.start
 * → normalized event stream → result aggregation → toRef/attach roundtrip →
 * cancel. No network; uses @llmist/testing mocks (same as other e2e suites).
 */

import { createMockAdapter, getMockManager, mockLLM } from "@llmist/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResearchEvent } from "../index.js";
import { LLMist } from "../index.js";

function createClient(): LLMist {
  return new LLMist({ adapters: [createMockAdapter()], autoDiscoverProviders: false });
}

beforeEach(() => {
  getMockManager().clear();
});

afterEach(() => {
  getMockManager().clear();
});

describe("research e2e (mocked)", () => {
  it("runs a research job end-to-end: events → result with citations and cost", async () => {
    mockLLM()
      .whenMessageContains("quantum")
      .returnsResearch("# Quantum Report\n\nEntanglement is useful.", {
        citations: [
          { url: "https://arxiv.org/abs/1234.5678", title: "Q Paper", startIndex: 0, endIndex: 10 },
        ],
        usage: { inputTokens: 1000, outputTokens: 400, totalTokens: 1400, searches: 5 },
        jobId: "e2e-job-1",
      })
      .register();

    const client = createClient();
    const job = client.research.start({
      model: "openai:o4-mini-deep-research",
      query: "quantum networking state of the art",
    });

    const phases: string[] = [];
    const searches: string[] = [];
    let textLength = 0;
    for await (const event of job) {
      if (event.type === "phase") phases.push(event.phase);
      if (event.type === "search" && event.query) searches.push(event.query);
      if (event.type === "text") textLength += event.delta.length;
    }

    expect(phases.length).toBeGreaterThan(0);
    expect(searches.length).toBeGreaterThan(0);
    expect(textLength).toBeGreaterThan(0);

    const result = await job.result();
    expect(result.status).toBe("completed");
    expect(result.report).toContain("Quantum Report");
    expect(result.citations).toHaveLength(1);
    expect(result.usage.searches).toBe(5);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("supports the background workflow: detach mid-run, persist ref, attach, finish", async () => {
    mockLLM()
      .when(() => true)
      .returnsResearch("long-running background report", { jobId: "e2e-bg-1" })
      .register();

    const client = createClient();
    const job = client.research.start({ model: "openai:any", query: "background topic" });

    // Consume the first two events, then "shut down".
    const iterator = job.events()[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.next();
    const serialized = JSON.stringify(job.toRef());

    // "New process": fresh client, attach from the persisted ref.
    const client2 = createClient();
    const revived = client2.research.attach(JSON.parse(serialized));
    const events: ResearchEvent[] = [];
    for await (const event of revived) {
      events.push(event);
    }
    expect(events.at(-1)?.type).toBe("done");
    const result = await revived.result();
    expect(result.report).toBe("long-running background report");

    // Status polling via the namespace.
    const snapshot = await client2.research.get(JSON.parse(serialized));
    expect(snapshot.status).toBe("completed");
  });

  it("cancel() ends the run as cancelled", async () => {
    mockLLM()
      .when(() => true)
      .withResearchEvents([
        { type: "created", jobId: "e2e-cancel-1" },
        { type: "status", status: "in_progress" },
        { type: "thinking", delta: "working..." },
        { type: "text", delta: "partial" },
        { type: "done", result: { status: "completed", report: "" } },
      ])
      .register();

    const client = createClient();
    const job = client.research.start({ model: "openai:any", query: "q" });
    const iterator = job.events()[Symbol.asyncIterator]();
    await iterator.next(); // created
    await job.cancel();

    const snapshot = await client.research.get(job.toRef());
    expect(snapshot.status).toBe("cancelled");
  });

  it("keeps the plain chat path untouched (research is opt-in)", async () => {
    mockLLM().whenMessageContains("hello").returns("Hi there!").register();

    const client = createClient();
    let text = "";
    for await (const chunk of client.stream({
      model: "openai:gpt-4o",
      messages: [{ role: "user", content: "hello" }],
    })) {
      text += chunk.text;
    }
    expect(text).toBe("Hi there!");
  });
});
