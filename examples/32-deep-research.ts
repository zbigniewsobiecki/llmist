/**
 * Example 32: Deep Research
 *
 * Demonstrates the first-class research surface (client.research): long-running,
 * server-side research jobs that browse the web and return cited reports, with
 * a normalized event stream across providers (OpenAI Responses API, Gemini
 * Interactions API, OpenRouter research models).
 *
 * This example runs against an inline demo adapter so it works without API
 * keys. Real-provider variants are shown commented at the bottom.
 *
 * Run: npx tsx examples/32-deep-research.ts
 */

import {
  LLMist,
  type ProviderAdapter,
  type ResearchEvent,
  type ResearchJobRef,
  type ResearchModelSpec,
} from "llmist";

// ─── 1. A demo research adapter (delete this section with real keys) ─────────
//
// Providers implement research via optional methods on ProviderAdapter — this
// inline adapter fakes a run so the example works offline. In tests, prefer
// @llmist/testing's mockResearch() / returnsResearch() instead.

const DEMO_REPORT = [
  "# Solid-State Batteries: 2026 Status Report",
  "",
  "Solid-state batteries are transitioning from lab to limited production.",
  "Toyota and QuantumScape lead on sulfide and ceramic separators respectively.",
].join("\n");

const DEMO_SPEC: ResearchModelSpec = {
  provider: "demo",
  modelId: "o4-mini-deep-research",
  kind: "model",
  displayName: "Demo Research Model",
  pricing: { input: 2, output: 8, perThousandSearches: 10 },
  capabilities: { streaming: true, background: true, resumable: true, tools: ["web_search"] },
};

function demoEvents(): ResearchEvent[] {
  return [
    { type: "created", jobId: "example-research-job", cursor: "0" },
    { type: "status", status: "in_progress", cursor: "1" },
    { type: "phase", phase: "searching", cursor: "2" },
    {
      type: "search",
      action: "search",
      status: "started",
      query: "solid-state battery production 2026",
      cursor: "3",
    },
    {
      type: "search",
      action: "search",
      status: "completed",
      url: "https://example.com/toyota-ssb",
      cursor: "4",
    },
    {
      type: "thinking",
      delta: "Synthesizing findings across manufacturer announcements...",
      cursor: "5",
    },
    { type: "phase", phase: "writing", cursor: "6" },
    { type: "text", delta: DEMO_REPORT.slice(0, 80), cursor: "7" },
    { type: "text", delta: DEMO_REPORT.slice(80), cursor: "8" },
    {
      type: "citation",
      citation: { url: "https://example.com/toyota-ssb", title: "Toyota SSB announcement" },
      cursor: "9",
    },
    {
      type: "citation",
      citation: { url: "https://example.com/qs-b1", title: "QuantumScape B1 samples" },
      cursor: "10",
    },
    {
      type: "usage",
      usage: { inputTokens: 250_000, outputTokens: 60_000, totalTokens: 310_000, searches: 42 },
      cursor: "11",
    },
    { type: "done", result: { status: "completed", report: "" }, cursor: "12" },
  ];
}

const demoAdapter: ProviderAdapter = {
  providerId: "openai", // pose as openai so "openai:..." model ids resolve here
  priority: 100,
  supports: () => true,
  stream: () => {
    throw new Error("this demo adapter only implements research");
  },
  getResearchModelSpecs: () => [DEMO_SPEC],
  supportsResearch: () => true,
  async *startResearch() {
    yield* demoEvents();
  },
  async *resumeResearch(ref) {
    const after = ref.cursor === undefined ? -1 : Number(ref.cursor);
    for (const event of demoEvents()) {
      if (event.cursor !== undefined && Number(event.cursor) > after) {
        yield event;
      }
    }
  },
  getResearchStatus: async () => ({ status: "completed" }),
  cancelResearch: async () => {},
};

const client = new LLMist({ adapters: [demoAdapter], autoDiscoverProviders: false });

// ─── 2. Start a research job and consume the normalized event stream ─────────

console.log("=== Streaming research events ===\n");

const job = client.research.start({
  // Real ids: "openai:gpt-5.5-pro", "gemini:deep-research-preview-04-2026",
  //           "openrouter:perplexity/sonar-deep-research"
  model: "openai:o4-mini-deep-research",
  query: "What is the state of solid-state batteries in 2026?",
});

let report = "";
for await (const event of job) {
  switch (event.type) {
    case "created":
      console.log(`[job]      id=${event.jobId}`);
      break;
    case "status":
      console.log(`[status]   ${event.status}`);
      break;
    case "phase":
      console.log(`[phase]    ${event.phase}`);
      break;
    case "search":
      console.log(`[search]   ${event.status}${event.query ? `: ${event.query}` : ""}`);
      break;
    case "thinking":
      console.log(`[thinking] ${event.delta.slice(0, 60)}...`);
      break;
    case "text":
      report += event.delta;
      break;
    case "citation":
      console.log(`[citation] ${event.citation.url}`);
      break;
    case "usage":
      console.log(`[usage]    ${event.usage.totalTokens} tokens, ${event.usage.searches} searches`);
      break;
    case "done":
      console.log(`[done]     status=${event.result.status}`);
      break;
  }
}

// ─── 3. The aggregated result: report + citations + usage + cost ─────────────

const result = await job.result();
console.log("\n=== Report ===\n");
console.log(result.report);
console.log("\nSources:");
result.citations.forEach((c, i) => console.log(`  [${i + 1}] ${c.url} — ${c.title ?? ""}`));
console.log(
  `\nUsage: ${result.usage.totalTokens} tokens | ${result.usage.searches} searches` +
    (result.usage.costUSD !== undefined ? ` | ~$${result.usage.costUSD}` : ""),
);

// ─── 4. Background jobs: detach, persist the ref, re-attach later ────────────

console.log("\n=== Background detach / attach ===\n");

const backgroundJob = client.research.start({
  model: "openai:o4-mini-deep-research",
  query: "solid-state batteries follow-up",
});

// Consume until the job id is known, then detach.
for await (const event of backgroundJob) {
  if (event.type === "created") break;
}
const serialized: string = JSON.stringify(backgroundJob.toRef());
console.log("Persisted ref:", serialized);

// ...process restart happens here...

const ref: ResearchJobRef = JSON.parse(serialized);
const revived = client.research.attach(ref);
const revivedResult = await revived.result();
console.log("Re-attached and finished:", revivedResult.status);

// ─── 5. Discover research-capable models ──────────────────────────────────────

console.log("\n=== Research model catalog ===\n");
for (const spec of client.research.listModels()) {
  console.log(
    `${spec.provider}:${spec.modelId} — streaming=${spec.capabilities.streaming} ` +
      `background=${spec.capabilities.background} resumable=${spec.capabilities.resumable}`,
  );
}

/*
// ─── Real-provider variants ──────────────────────────────────────────────────
// (Remove the mock section above; set the relevant API key.)

// OpenAI — Responses API; gpt-5.5-pro is poll-only (status heartbeats, then the
// full report in one text event). The o3/o4-mini deep-research models shut down
// on 2026-07-23 — llmist warns/throws based on catalog metadata.
const openaiJob = client.research.start({
  model: "openai:gpt-5.5-pro",
  query: "State of solid-state batteries in 2026",
  maxToolCalls: 40, // cost cap
});

// Gemini — Interactions API research agents (background mandatory, 60-min cap).
// Follow-ups: pass a completed job's id as previousJobId.
const geminiJob = client.research.start({
  model: "gemini:deep-research-preview-04-2026",
  query: "State of solid-state batteries in 2026",
});

// OpenRouter — streamed via chat completions. NOT resumable: a dropped stream
// is money lost (llmist never silently re-runs it). ~$0.50–2 per run.
const openrouterJob = client.research.start({
  model: "openrouter:perplexity/sonar-deep-research",
  query: "State of solid-state batteries in 2026",
});
*/
