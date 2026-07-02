---
id: 002
slug: deep-research
plan: 1
plan_slug: research-core
level: plan
parent_spec: docs/specs/002-deep-research.md
depends_on: []
status: pending
---

# 002/1: Research core — surface, job lifecycle, catalog types, mocks

> Part 1 of 5 in the 002-deep-research plan set. See [parent spec](../../specs/002-deep-research.md).

## Summary

Lands the entire provider-independent research surface: the normalized event/type model, the `client.research` namespace, the `ResearchJob` implementation (aggregation, cursor tracking, auto-reconnect, timeout, abort-vs-cancel semantics), the research model-spec catalog types + cost estimation, the optional `ProviderAdapter` research capability block, and full mock support in `@llmist/testing`. After this plan ships, the whole surface is usable and testable end-to-end **with mocks**; no real provider speaks research yet.

**Components delivered:**
- `packages/llmist/src/research/types.ts` — `ResearchStatus`, `ResearchToolConfig`, `ResearchOptions`, `ResearchCitation`, `ResearchUsage`, `ResearchEvent`, `ResearchResult`, `ResearchJobRef`, `ResearchJob`
- `packages/llmist/src/research/model-spec.ts` — `ResearchModelSpec`, `ResearchPricing`
- `packages/llmist/src/research/constants.ts` — all timeouts/intervals/limits as named constants
- `packages/llmist/src/research/errors.ts` — `ResearchNotSupportedError`, `ResearchJobNotResumableError`, `ResearchNotPollableError`, `ResearchTimeoutError`, `ResearchDeprecatedModelError`
- `packages/llmist/src/research/collector.ts` — event → `ResearchResult` aggregation (text, citation dedupe, usage merge, duration)
- `packages/llmist/src/research/cost.ts` — `estimateResearchCost(spec, usage)`
- `packages/llmist/src/research/job.ts` — `ResearchJobImpl`
- `packages/llmist/src/research/namespace.ts` — `ResearchNamespace` (`start`/`attach`/`get`/`cancel`/`listModels`/`supportsModel`)
- `packages/llmist/src/research/index.ts` — barrel
- `packages/llmist/src/providers/provider.ts` — optional research capability block on `ProviderAdapter`
- `packages/llmist/src/core/client.ts` — `readonly research: ResearchNamespace`
- `packages/llmist/src/core/model-catalog.ts` — `features.research?: boolean` discoverability flag
- `packages/llmist/src/index.ts` — public exports
- `packages/testing/src/mock-types.ts` / `mock-builder.ts` / `mock-adapter.ts` — research mock support

**Deferred:** real providers (plans 2–4), CLI/example/docs (plan 5).

---

## Spec ACs satisfied by this plan

- **AC #7** (listModels + deprecation warn/throw) — **full** (mechanism; real catalogs land in plans 2–4)
- **AC #8** (pre-flight validation against spec capabilities) — **full** (mechanism + tests with synthetic specs)
- **AC #9** (auto-reconnect with cursor) — **full** (job-level logic, tested via mock resume replay)
- **AC #10** (abort vs cancel) — **full**
- **AC #11** (testing mocks) — **full**
- **AC #14** (zero overhead / unchanged chat path) — **full** (invariant established here)
- **AC #1, #2, #3, #4, #5, #6** — **partial** (surface + collector + cost mechanics; provider realities in plans 2–4)

---

## Depends On

- Existing `core/namespaces/image.ts` (pattern template), `core/client.ts`, `providers/provider.ts`, `core/retry.ts`, `core/options.ts` (`TokenUsage`, `ReasoningConfig`), logging.
- `packages/testing` mock plumbing (`mock-types.ts`, `mock-builder.ts`, `mock-adapter.ts`).

---

## Detailed Task List (TDD)

### 1. Types, constants, errors (no tests — pure declarations, verified via consumers)

- `research/types.ts`, `research/model-spec.ts`, `research/errors.ts`, `research/constants.ts` exactly as specified in the parent spec's Architecture section:
  - `RESEARCH_DEFAULT_TIMEOUT_MS = 3_600_000`, `RESEARCH_POLL_INTERVAL_MS = 10_000`, `RESEARCH_POLL_MAX_INTERVAL_MS = 60_000`, `RESEARCH_POLL_BACKOFF_FACTOR = 1.5`, `RESEARCH_STREAM_RECONNECT_MAX_ATTEMPTS = 5`, `RESEARCH_SHUTDOWN_WARNING_WINDOW_DAYS = 30` (each with a doc comment naming its source).
  - Every event carries optional `cursor?: string` and `rawEvent?: unknown`.
  - `ResearchJobRef` is a plain JSON-serializable object; document the round-trip contract in TSDoc.

### 2. Collector

**Tests first** (`research/collector.test.ts`):
- accumulates `text` deltas into `report`
- collects citations; dedupes by `url + startIndex` (same url at different offsets = two citations; identical tuple = one)
- merges `usage` events (later events override token fields, `searches` accumulates only if provider re-reports cumulatively — take max, not sum)
- captures terminal status from `done`; falls back to last `status` event when stream ends without `done`
- records `durationMs` from first event to terminal event
- `costUSD` set when a spec with pricing is provided; left undefined otherwise

**Implementation** (`research/collector.ts`): `class ResearchResultCollector { ingest(ev); toResult(context): ResearchResult }`.

### 3. Cost estimation

**Tests first** (`research/cost.test.ts`):
- token-only pricing (input/output/cached)
- `internalReasoning` dimension (perplexity-style: reasoning tokens priced separately from output)
- `perThousandSearches` (e.g. 40 searches at $5/1k = $0.20)
- combined; zero/undefined usage fields ignored; result rounded to 6 decimals (constant)

**Implementation** (`research/cost.ts`).

### 4. Provider capability block

- Extend `providers/provider.ts` with the optional research block (`getResearchModelSpecs?`, `supportsResearch?`, `startResearch?`, `resumeResearch?`, `getResearchStatus?`, `cancelResearch?`) — grouped section with TSDoc, mirroring image/speech.
- Contract (documented on the interface): `startResearch` must emit `created` first; non-streaming providers implement create+poll internally; providers omit methods they can't support.

### 5. ResearchJobImpl

**Tests first** (`research/job.test.ts`) against a scripted fake adapter:
- happy path: iterating yields all events; `result()` resolves aggregated result
- `result()` without prior iteration drains internally
- single iteration only: second `events()` call while active throws (or returns same iterator — pick one, test it; recommend: throw `IllegalStateError`-style CleanError)
- cursor tracking: `toRef().cursor` reflects the last event's cursor
- `toRef()` throws `ResearchJobNotResumableError` when `jobId === null`
- reconnect: fake adapter stream errors mid-run → job calls `resumeResearch(ref)` with the last cursor; events continue without duplication; attempts bounded by `RESEARCH_STREAM_RECONNECT_MAX_ATTEMPTS`; counter resets after a successful event
- non-resumable spec: stream error surfaces `error {retryable:false}` event then iterator ends; no resume call
- timeout: fake timer past `timeoutMs` → transport aborted, `ResearchTimeoutError` surfaced, ref still valid
- external `signal` abort: transport aborted; job marked aborted; `cancel()` not called
- `cancel()`: calls `adapter.cancelResearch` when present; otherwise aborts transport
- `status()`: delegates to `getResearchStatus`; throws `ResearchNotPollableError` when adapter lacks it

**Implementation** (`research/job.ts`): lazy-open on first iteration; internal `AbortController` chained to `options.signal`; timeout via `setTimeout` unref'd.

### 6. ResearchNamespace

**Tests first** (`research/namespace.test.ts`):
- `start()` dispatches to the adapter whose `supports() && supportsResearch()` matches; adapter priority respected (mock at 100 wins)
- no adapter → `ResearchNotSupportedError` listing available research providers
- validation before network: tools not in `spec.capabilities.tools` → throw; missing data-source tools filled from `spec.requiredTools`; `previousJobId` on a spec without `followUps` → throw; `background: true` on a spec without background → throw; `background` defaulted from spec
- deprecation: spec with `shutdownDate` in the past → `ResearchDeprecatedModelError` naming `metadata.replacement`; within `RESEARCH_SHUTDOWN_WARNING_WINDOW_DAYS` → logger warning (spy)
- `attach(ref)` returns a job that calls `resumeResearch(ref)`; unknown provider in ref → `ResearchNotSupportedError`
- `get(ref)` / `cancel(ref)` delegate; missing capability → typed errors
- `listModels()` unions adapter catalogs; `supportsModel()` works with and without provider prefix

**Implementation** (`research/namespace.ts`), plus `core/client.ts` wiring (`this.research = new ResearchNamespace(this.adapters, this.parser)` — match `ImageNamespace` constructor conventions) and `src/index.ts` exports.

### 7. Testing package support

**Tests first** (`packages/testing/src/mock-adapter.test.ts`, `mock-builder.test.ts` additions):
- `mockLLM().whenMessageContains("solid-state").returnsResearch("report text", {citations, usage, jobId})` → `client.research.start()` yields synthesized `created → phase → search → thinking → text → citation → usage → done` sequence; result matches
- `withResearchEvents(events)` replays a custom scripted sequence verbatim (cursor = index)
- `resumeResearch(ref)` replays events after `ref.cursor` (deterministic resume tests)
- `failAtEvent: n` → stream errors after n events (drives job reconnect tests)
- `getResearchStatus`/`cancelResearch` implemented; `getMockManager().clear()` resets

**Implementation:** extend `mock-types.ts` (`MockResponse.research`), `mock-builder.ts` (`returnsResearch`, `withResearchEvents`, `mockResearch()` convenience), `mock-adapter.ts` (full research capability block; synthetic `ResearchModelSpec` with `kind:"model"`, resumable+background+streaming all true).

### 8. E2E (mock) + invariants

- `packages/llmist/src/e2e/research.e2e.test.ts`: full roundtrip with mock client — start → iterate → result; toRef mid-stream → attach → completes; cancel path.
- Zero-overhead check: importing `llmist` and running a plain `stream()` never touches `research/` runtime code beyond type-level imports (assert via module side-effect flag or keep research namespace construction dependency-free and cheap — document approach in test).

### 9. Housekeeping

- `CHANGELOG.md` entry (`feat(research): core research surface (experimental, mock-only)`).
- Mark surface `@experimental` in TSDoc until plan 4 lands.

---

## Documentation impact (this plan)

None user-facing yet (docs land in plan 5); TSDoc on all public types is required now.
