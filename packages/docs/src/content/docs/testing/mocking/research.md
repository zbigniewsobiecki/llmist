---
title: Mocking Research
description: Test deep research flows without network calls
---

`@llmist/testing` mocks the entire `client.research` surface: event streams, reports, citations, background refs, and deterministic resume.

## Quick start

```typescript
import { createMockClient, getMockManager, mockResearch } from "@llmist/testing";

mockResearch("# Battery Report\n\nFindings here.", {
  citations: [{ url: "https://example.com/paper", title: "Paper" }],
  usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, searches: 7 },
}).whenMessageContains("solid-state").register();

const client = createMockClient();
const result = await client.research
  .start({ model: "openai:o4-mini-deep-research", query: "solid-state batteries" })
  .result();

expect(result.report).toBe("# Battery Report\n\nFindings here.");
expect(result.usage.searches).toBe(7);

getMockManager().clear(); // between tests
```

The mock adapter synthesizes a realistic normalized stream: `created → status → phase → search → thinking → text deltas → citations → usage → done`.

`mockResearch(report, opts?)` is a convenience over the general builder — the same registration works as `mockLLM()...returnsResearch(report, opts)`, composing with all matchers (`forModel`, `whenMessageContains`, `when`, ...).

## Scripting exact event sequences

Drive UIs or edge cases with a verbatim event script (cursors auto-assigned from the index):

```typescript
import { mockLLM } from "@llmist/testing";

mockLLM()
  .forModel("deep-research")
  .withResearchEvents([
    { type: "created", jobId: "job-1" },
    { type: "phase", phase: "planning" },
    { type: "text", delta: "partial" },
    { type: "error", error: { message: "budget hit", retryable: false } },
  ])
  .register();
```

## Deterministic resume and stream drops

Mock research jobs live in a shared server-side-style registry, so background refs survive across client instances ("process restarts"):

```typescript
mockResearch("resumable report", { jobId: "job-1" }).when(() => true).register();

const job = client.research.start({ model: "openai:any", query: "q" });
// ...consume a few events...
const ref = job.toRef();

const client2 = createMockClient();          // "new process"
const revived = client2.research.attach(ref); // replays events after ref.cursor
```

`failAtEvent: n` makes the stream throw after `n` events — the resumed stream is healthy, which exercises the job's automatic reconnect:

```typescript
mockResearch("survives a drop", { jobId: "flaky", failAtEvent: 4 })
  .when(() => true)
  .register();
```

`status()` and `cancel()` also work against the registry (`cancel` flips the stored status to `cancelled`).
