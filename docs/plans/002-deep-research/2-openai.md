---
id: 002
slug: deep-research
plan: 2
plan_slug: openai
level: plan
parent_spec: docs/specs/002-deep-research.md
depends_on: [1]
status: pending
---

# 002/2: OpenAI track — generic Responses-API research (background, poll, stream-resume)

> Part 2 of 5 in the 002-deep-research plan set. See [parent spec](../../specs/002-deep-research.md).

## Summary

Implements research on the OpenAI adapter via a **generic Responses-API job client** — create (with `background`), poll, stream, stream-resume (`starting_after`), cancel — plus a normalizer from Responses SSE events to `ResearchEvent`. Research capability is **catalog-driven**: the dying `o3-deep-research`/`o4-mini-deep-research` IDs ship with `shutdownDate: "2026-07-23"` metadata, and `gpt-5.5-pro` (poll-only, `capabilities.streaming: false`) is the durable path. Nothing outside the catalog names a model ID.

**Components delivered:**
- `packages/llmist/src/providers/openai-research.ts` — `ResponsesJobClient` (create/stream/resume/poll/cancel wrappers with per-request `{timeout, signal}`) + `normalizeResponsesStream()` + request builder (tool mapping, validation, input assembly)
- `packages/llmist/src/providers/openai-research-models.ts` — research catalog entries
- `packages/llmist/src/providers/openai.ts` — wiring: `supportsResearch`/`getResearchModelSpecs`/`startResearch`/`resumeResearch`/`getResearchStatus`/`cancelResearch` delegating to `openai-research.ts` (image/speech delegation style)
- `packages/llmist/src/providers/__fixtures__/openai-responses-research.json` — recorded/hand-authored event fixture

**First task at implementation time:** live-verify `client.responses.retrieve(id, {stream: true, starting_after})` against the real API (risk #5 in spec). Fallback if unsupported: resume = re-stream from 0 and client-side skip events with `sequence_number <= cursor`.

---

## Spec ACs satisfied by this plan

- **AC #1** (end-to-end run) — **partial** (OpenAI leg)
- **AC #2** (background lifecycle: ref/attach/status/cancel) — **full** (OpenAI is the reference background provider)
- **AC #4** (poll-only model via create+poll) — **full** (gpt-5.5-pro)
- **AC #5** (citations) — **partial** (OpenAI leg)
- **AC #6** (usage + cost incl. per-search) — **partial** (OpenAI leg)
- **AC #7** (catalog + shutdown metadata) — **partial** (OpenAI catalog)
- **AC #8** (pre-flight validation) — **partial** (required-tool injection: `web_search_preview`)
- **AC #13** (fixture-driven normalizer tests + gated live e2e) — **partial** (OpenAI leg)

---

## Depends On

- Plan 1 (types, job, namespace, adapter capability block, mocks).
- Existing `providers/openai.ts` client construction/env discovery; `core/retry.ts`.

---

## Detailed Task List (TDD)

### 1. Research model catalog

**Tests first** (`providers/openai-research-models.test.ts`):
- `o3-deep-research` + dated snapshot: pricing $10/$40, cached $2.50, `perThousandSearches: 10`, `metadata.shutdownDate: "2026-07-23"`, `metadata.replacement: "gpt-5.5-pro"`, capabilities `{streaming:true, background:true, resumable:true, tools:[web_search,file_search,mcp,code_interpreter]}`, `requiredTools: [{type:"web_search"}]`
- `o4-mini-deep-research` (+snapshot): $2/$8, cached $0.50, same shape
- `gpt-5.5-pro`: $30/$180, ctx 1_050_000, maxOutput 128_000, `capabilities.streaming: false`, background/resumable true, `perThousandSearches: 10`
- every entry `kind: "model"`; ids unique

**Implementation:** `providers/openai-research-models.ts`; also set `features.research: true` on the `gpt-5.5-pro` `ModelSpec` entry in the main OpenAI catalog if present (discoverability flag only).

### 2. Request builder

**Tests first** (`providers/openai-research.test.ts` — builder section):
- assembles `{model, input, background, store:true (when background), reasoning:{summary:"auto"}, tools, max_tool_calls}`
- `systemPrompt` prepended to `input` with a blank-line separator (no system role on DR requests)
- tool mapping: `web_search → {type:"web_search_preview"}` (NEVER `web_search`); `file_search → {type:"file_search", vector_store_ids}` with >2 stores rejected; `mcp → {type:"mcp", server_label, server_url, require_approval:"never"}`; `code_interpreter → {container:{type:"auto"}}`
- no data-source tool in options → `spec.requiredTools` injected; spec without requiredTools and no data source → typed validation error
- `reasoning.effort` passed through only when spec/model supports it (catalog flag; default omit)
- `extra` merged last (escape hatch)

### 3. Normalizer

**Tests first** (fixture-driven, same file):
- full happy path over `__fixtures__/openai-responses-research.json`: `created`+`status queued` from `response.created/queued`, `status in_progress`, `thinking` deltas from `reasoning_summary_text.delta`, `search started/completed` from `web_search_call` items/events (deduped by item id; `action.query`/`url` extracted), `tool` events for code_interpreter/file_search/mcp, `text` deltas, `citation` from `output_text.annotation.added`, final `usage` (input/output/reasoning/cached from `response.usage`) then `done` (report from final message output_text; status completed)
- every event's `cursor` = stringified `sequence_number`
- terminal mappings: `response.failed` → `error` + `done(status:"failed")`; `response.incomplete` → `done(status:"incomplete")` with partial report; `response.cancelled` → `done(status:"cancelled")`
- top-level `error` SSE event → `error` with `retryable` from `isRetryableError`
- unknown event types pass through silently (rawEvent preserved on nearest emitted event or dropped — assert no throw)

### 4. Background create + poll (non-streaming path)

**Tests first** (fake timers, stubbed SDK):
- spec with `streaming:false` → `create({background:true, stream:false})`, then `retrieve(id)` loop at `RESEARCH_POLL_INTERVAL_MS` backing off ×1.5 to max; each poll emits `status`; on `completed` emits one `text` (full report), `citation`s from annotations, `usage`, `done`
- poll retries on transient errors (429/5xx) via retry infra; create retried only when `isRetryableError` (test: 429 on create → one retry → success)
- cancel mid-poll: `responses.cancel(id)` called; loop exits with `done(status:"cancelled")`

### 5. Stream + resume

**Tests first:**
- `startResearch` streaming spec: `create({stream:true, background:true})`, events normalized
- `resumeResearch(ref)`: calls `retrieve(ref.jobId, {stream:true, starting_after: Number(ref.cursor)})`; events before cursor never re-emitted (fixture slice)
- fallback path (feature-flagged constant until live-verified): resume without `starting_after` support re-streams and skips `sequence_number <= cursor`
- `getResearchStatus(ref)`: maps Responses status enum; on `completed` builds full `ResearchResult` from the retrieved response object
- per-request options: `{timeout: OPENAI_RESEARCH_HTTP_TIMEOUT_MS, signal}` passed on create/retrieve/cancel

### 6. Adapter wiring + e2e

- Wire the six capability methods on `OpenAIProvider`, delegating to `openai-research.ts`.
- `supportsResearch(modelId)` = catalog membership (incl. dated-snapshot aliases and prefix-stripped ids).
- Gated live e2e (`RUN_LIVE_RESEARCH_TESTS` + `OPENAI_API_KEY`): one cheap `o4-mini-deep-research` run while alive (post-shutdown: `gpt-5.5-pro` with tight `max_tool_calls`), assert report non-empty + ≥1 citation + jobId/ref roundtrip. Budget note in test header.
- `CHANGELOG.md` entry.

---

## Documentation impact (this plan)

TSDoc only; user docs in plan 5 (provider matrix row + poll-only caveat authored there from this plan's realities).
