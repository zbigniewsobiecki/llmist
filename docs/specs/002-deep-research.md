---
id: 002
slug: deep-research
level: spec
title: First-Class Deep Research Support
created: 2026-07-02
status: planned
---

# 002: First-Class Deep Research Support

## Problem & Motivation

Every major provider now ships "deep research" — long-running (minutes to an hour), server-side agentic research jobs that plan, browse the web across dozens-to-hundreds of searches, and return long cited reports. OpenAI exposes this through the Responses API with background jobs; Google through the new Interactions API with dedicated research agents; OpenRouter carries research models (Perplexity Sonar Deep Research, OpenAI's research models) over its chat-completions surface. These products are increasingly the *reason* users reach for an LLM API at all.

**llmist cannot express any of this today.** Three structural mismatches:

1. **Job lifecycle.** Deep research is create → background → poll/stream/resume → cancel. llmist's `stream()` models a single HTTP round-trip; there is no job handle, no polling, no resume-after-disconnect, no cancel endpoint plumbing. A dropped connection 25 minutes into a $3 research run is unrecoverable.
2. **Event shape.** Research runs emit plans, per-search activity, reasoning summaries, citations, and report deltas. `LLMStreamChunk` carries text, usage, and thinking — citations and tool-activity events are silently dropped by every current normalizer.
3. **Economics.** Research pricing has dimensions `ModelSpec.pricing` can't represent: per-search fees ($5–18 per 1k searches), internal-reasoning token rates, and per-run costs in dollars, not cents. Cost tracking — a first-class llmist feature — is blind to them.

A user who wants a cited research report from an llmist-based app must today hand-roll provider SDK calls beside llmist, losing streaming, cost tracking, retry, mocking, and the CLI. This spec adds a **first-class research surface** — one consistent, streaming-first API across providers — the same way llmist already treats text, image, speech, and vision as capability namespaces.

---

## Goals

1. **One research surface across providers.** `client.research.start()` returns a job whose normalized event stream (status, phase, search activity, thinking, report deltas, citations, usage) looks identical whether the backend is OpenAI, Gemini, or an OpenRouter-hosted model.
2. **Background-job lifecycle as a first-class citizen.** Jobs expose `id`/`toRef()` (JSON-serializable), and the client can `attach()` to a running job after a disconnect or process restart, poll status, and cancel — on providers that support it.
3. **Streaming-first with graceful degradation.** Live event streaming with automatic cursor-based reconnect where the provider supports it; create-then-poll with status heartbeats where it doesn't (e.g. poll-only models).
4. **Catalog-driven capability, never hardcoded model IDs.** Which models/agents support research, which tools they require, their pricing dimensions, deprecation/shutdown metadata — all declared in a research model catalog, so provider model churn (e.g. OpenAI's July 2026 research-model shutdown) is a data change, not a code change.
5. **Cost visibility.** Research usage reports tokens *and* searches, and cost estimation covers per-search and internal-reasoning pricing dimensions.
6. **Testability on par with existing surfaces.** `@llmist/testing` can mock research runs (events, reports, citations, resume behavior) with the same fluent API style as `mockLLM()`.
7. **CLI parity.** `llmist research "question"` streams progress and prints a cited report; `--background`/`--resume` make long runs survivable from the shell.
8. **Leave room for providers without native research.** The abstraction must accommodate a future Anthropic track (server web tools + an llmist-orchestrated research preset) without breaking changes — but that track is out of v1 scope.

---

## Non-goals

- **Anthropic support in v1.** Anthropic has no native research API; the right integration (Messages API `web_search`/`web_fetch` server tools + a cookbook-style orchestrator preset) is a follow-up spec/plan. v1 only reserves the type-level room (`kind: "preset"`, nullable job ids).
- **Anthropic Managed Agents.** Beta, differently-shaped resource-CRUD surface; rejected for v1.
- **A general background-job framework.** Job refs are serializable and attachable, but llmist does not persist them, schedule them, or manage a job queue — that's the caller's concern.
- **Webhooks.** OpenAI supports dashboard-configured webhooks for background responses; out of scope (polling and streaming cover the need without deployment requirements).
- **OpenRouter's beta `/responses` endpoint.** Stateless, no background support — adds nothing over chat completions for research.
- **Research inside the agent gadget loop.** A `ResearchGadget`/`withResearch()` builder integration is sketched but deferred to a follow-up plan after the core surface stabilizes.
- **The `openrouter:web_search` server tool ("poor man's research mode" for any model).** Noted as future sugar; not v1.
- **File-search corpus management.** Passing existing `vector_store_ids` through to OpenAI is supported; creating/managing vector stores is not.

---

## Constraints

- **TypeScript-first, streaming-first.** Research events are `AsyncIterable`; the job handle itself is async-iterable, mirroring `client.stream()` ergonomics.
- **Follow the capability-namespace precedent.** `client.research` mirrors `core/namespaces/image.ts`; provider support is optional methods on `ProviderAdapter` (like `generateImage?`), so adapter discovery, priority sorting, and mock interception are reused, not reimplemented.
- **Separate research catalog.** Research models/agents get their own spec type (media-catalog precedent) — Gemini research "agents" are not chat models and must not pollute `ModelSpec`.
- **No new dependencies.** Installed SDKs suffice: `openai` ^6 has `client.responses.*`; `@google/genai` 1.43.0 has `client.interactions.*`. If the Gemini SDK surface diverges from the live API, fall back to raw `fetch` SSE isolated in one transport function.
- **No magic numbers.** Timeouts, poll intervals, reconnect limits, deprecation-warning windows are named constants.
- **Money-safety.** A research run can cost dollars. Never silently re-run a job after a stream drop on non-resumable providers; retries only on idempotent operations (poll) or before job creation.
- **Abort ≠ cancel.** `AbortSignal`/timeout abort transport only; background jobs keep running server-side and stay attachable. Server-side cancellation is explicit (`job.cancel()`).
- **Zero overhead when unused.** No research code on the hot path of `stream()`/agent runs; catalogs are static data.
- **Reuse existing retry infra** (`core/retry.ts`: `isRetryableError`, `extractRetryAfterMs`) — no parallel retry implementation.

---

## User stories / Requirements

### As a library user

1. I can start a research run with one call — model, query, optional system prompt/tools/budget caps — and iterate normalized events to drive my UI.
2. I can `await job.result()` and get the report text, a deduplicated citations list, usage (tokens + searches), and estimated cost.
3. I can serialize `job.toRef()`, restart my process, `client.research.attach(ref)`, and keep streaming from where I left off (on resumable providers).
4. I can cancel a running job server-side, and distinguish that from merely aborting my local stream.
5. I can list research-capable models/agents with their capabilities (streaming? background? resumable? follow-ups?) and pricing, and pick one at runtime.
6. When I pick a model past its announced shutdown date, I get a typed error naming the replacement; within the warning window I get a logged warning.
7. Gemini: I can ask a follow-up question grounded in a previous completed research job.
8. OpenAI: I can constrain cost with a max-tool-calls cap and choose data-source tools (web search, file search with my vector stores, MCP).

### As a CLI user

1. `llmist research "question"` streams progress (phases, searches, thinking) to stderr and prints the cited report to stdout, followed by a cost/usage summary.
2. `--background` prints a serialized job ref and exits; `--resume <ref>` re-attaches; `--cancel <ref>` stops the job.
3. `--json` emits NDJSON events for scripting; `--output` writes the report to a file.
4. I can set defaults (model, timeout) in a `[research]` TOML section.

### As a test author

1. I can register a mock research response (report, citations, optional scripted event sequence) with the same matcher style as `mockLLM()`, and the mock adapter intercepts `client.research` calls with priority over real providers.
2. I can deterministically test resume behavior (mock replays events from a cursor) and failure mid-run.

---

## Research Notes

*(verified 2026-07-02 against live docs/APIs)*

- **OpenAI**: Deep research works only on the Responses API (`POST /v1/responses`) — request requires ≥1 data-source tool (`web_search_preview` — the GA `web_search` type breaks research models; `file_search` max 2 vector stores; `mcp` with `require_approval:"never"`), `background: true` requires `store: true`. Streaming events carry `sequence_number`; resume = `retrieve(id, {stream: true, starting_after})`. Citations = `url_citation` annotations. **`o3-deep-research` / `o4-mini-deep-research` shut down 2026-07-23**; replacement `gpt-5.5-pro` ($30/$180 per M, 1.05M ctx) supports research via tools + background but **not streaming**. Web search $10/1k calls. ([deep research guide](https://developers.openai.com/api/docs/guides/deep-research), [background guide](https://developers.openai.com/api/docs/guides/background), [deprecations](https://developers.openai.com/api/docs/deprecations))
- **Google**: Deep Research is exclusive to the **Interactions API** (GA 2026-05-19; agents in preview): `POST /v1beta/interactions` with `agent: "deep-research-preview-04-2026"` (Gemini 3.1 Pro core) / `deep-research-max-preview-04-2026` / legacy `deep-research-pro-preview-12-2025`. `background: true` mandatory; 60-min hard cap; SSE resume via `last_event_id`; follow-ups via `previous_interaction_id`; ~$1–7/run at standard token rates; paid tiers only; not on Vertex. Docs are internally inconsistent on `thought` vs `thought_summary` delta types and `error` vs `interaction.error` — handle both. May-2026 schema replaced `outputs[]` with `steps[]` (pre-June tutorials show the dead shape). ([interactions reference](https://ai.google.dev/api/interactions-api), [deep research docs](https://ai.google.dev/gemini-api/docs/deep-research), [changelog](https://ai.google.dev/gemini-api/docs/changelog))
- **OpenRouter**: `perplexity/sonar-deep-research` ($2/$8 + $3/M internal reasoning + $5/1k searches), `perplexity/sonar-pro-search` ($3/$15 + $18/1k), `openai/o3-deep-research` & `o4-mini-deep-research` (until upstream shutdown) — all via plain chat completions. **Streaming mandatory** (60s idle disconnects; multi-minute runs; ~350K reasoning tokens observed). Keep-alive SSE comments (`: OPENROUTER PROCESSING`) are skipped by the `openai` SDK parser. No background/async mode. Citations arrive as `annotations[].url_citation` and/or legacy top-level `citations: [urls]` — read both. Reasoning arrives as `delta.reasoning` / `reasoning_details[]`, which llmist's current normalizer drops. ([models API](https://openrouter.ai/api/v1/models), [reasoning docs](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), [streaming docs](https://openrouter.ai/docs/api/reference/streaming))
- **Anthropic** (context for the deferred track): no research model/endpoint exists as of July 2026. Primitives: `web_search_20260318` ($10/1k, citations with `encrypted_content` that must round-trip) + `web_fetch_20260318` (free) server tools, `pause_turn` continuation contract; official pattern is the multi-agent orchestrator from the cookbook. ([web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool), [multi-agent research blog](https://www.anthropic.com/engineering/built-multi-agent-research-system))

---

## Open Source Decisions

| Tool | Solves | Decision | Reason |
|------|--------|----------|--------|
| `openai` SDK ^6 (installed) | Responses API client incl. background, stream-resume, cancel | **Use** | Already a dependency; `client.responses.*` fully typed in 6.x |
| `@google/genai` 1.43.0 (installed) | Interactions API client (`client.interactions.*`) | **Use, verify early** | Already installed and exposes create/get/cancel with `last_event_id`; agents are preview — isolate transport so a raw-fetch SSE fallback is a drop-in |
| Perplexity native async API | Submit+poll for sonar-deep-research | **Skip** | Only on Perplexity's own API, not via OpenRouter; would add a fourth provider integration for one model |
| OpenRouter `/api/v1/responses` (beta) | OpenAI-Responses-shaped surface on OpenRouter | **Skip** | Stateless, no `background` param — no benefit over chat completions |
| OpenAI webhooks | Push notification of background completion | **Skip (documented)** | Requires deployed endpoint + dashboard config; polling/streaming cover v1 |

---

## Strategic decisions

1. **First-class capability namespace, not `stream()` overloading.** Research is job-based and event-rich; forcing it through `LLMStreamChunk` would lose citations, job lifecycle, and search activity — and pollute the chat path with job concerns. Follows the existing text/image/speech/vision namespace precedent. *(User decision.)*
2. **v1 tracks: OpenAI (generic Responses+background infra), Gemini (Interactions), OpenRouter (chat-completions mapping). Anthropic deferred.** *(User decision.)*
3. **OpenAI built generically against the Responses API**, with research capability declared in the catalog: the dying `*-deep-research` IDs ship with shutdown metadata; `gpt-5.5-pro`+required-tools is the durable path. The infra (background/poll/stream-resume) is model-agnostic and reusable. *(User decision.)*
4. **Optional adapter methods over a separate registry.** `startResearch?`/`resumeResearch?`/`getResearchStatus?`/`cancelResearch?`/`getResearchModelSpecs?`/`supportsResearch?` on `ProviderAdapter` reuse discovery, priority, and mock interception for free — the image/speech precedent.
5. **Separate `ResearchModelSpec` catalog** with `kind: "model" | "agent" | "preset"`, capability flags (streaming/background/resumable/followUps/tools), required-tool defaults, pricing incl. `perThousandSearches` + `internalReasoning`, and shutdown metadata.
6. **Normalized event union** (`created/status/phase/thinking/search/tool/text/citation/usage/error/done`) with a `cursor` on every event (provider sequence number / event id) and a `rawEvent` escape hatch.
7. **Money-safety over convenience**: no silent re-runs on non-resumable stream drops; abort-vs-cancel semantics explicit; deprecation warnings before shutdowns, typed errors after.

---

## Acceptance Criteria (outcome-level)

1. A library user can run a research job end-to-end on each v1 provider (OpenAI, Gemini, OpenRouter) through the identical surface: `client.research.start()` → normalized events → `result()` with report, citations, usage.
2. Background lifecycle works where the provider supports it: `toRef()` → process restart → `attach(ref)` resumes the event stream from the cursor without event loss; `status()` polls; `cancel()` stops the job server-side.
3. On a provider without background/resume (OpenRouter), the same surface works for a full streamed run; `toRef()`/`status()` fail with typed, documented errors; a mid-run stream drop surfaces a non-retryable error and never silently re-runs the job.
4. A non-streaming research model (gpt-5.5-pro) works through the same surface via create+poll: status heartbeat events, then the full report as a single text event and `done`.
5. Citations are captured on all three providers (OpenAI annotations, Gemini annotations, OpenRouter annotations + legacy citations array, deduplicated) with url/title/offsets where available.
6. Usage reports tokens (input/output/reasoning/cached) and search counts where the provider exposes them; `estimateResearchCost` covers per-search and internal-reasoning dimensions, and `result().usage.costUSD` is populated for cataloged models.
7. Research-capable models/agents are discoverable via `client.research.listModels()` with capabilities and pricing; starting a model past `shutdownDate` throws a typed error naming the replacement; within 30 days logs a warning.
8. Requests are validated against catalog capabilities before any network call: missing required data-source tools are injected from spec defaults (OpenAI); unsupported tools rejected (Perplexity); `previousJobId` rejected on specs without follow-up support.
9. Mid-stream disconnects on resumable providers auto-reconnect with the cursor (bounded attempts, reset on progress) without duplicating or dropping events.
10. Abort (signal/timeout) tears down transport but leaves the server-side job running and attachable; this distinction is covered by tests and documented.
11. `@llmist/testing` supports research mocking: report/citations/scripted events, matcher-based registration, resume-from-cursor replay; the whole surface is testable without network.
12. `llmist research` streams progress to stderr, prints the cited report to stdout with a cost summary; `--background` emits a reusable ref JSON; `--resume` re-attaches; `--json` emits NDJSON events; `[research]` TOML defaults apply.
13. Unit tests cover each provider normalizer against recorded fixtures (including Gemini's dual `thought`/`thought_summary` + `error`/`interaction.error` shapes and OpenRouter's dual citation shapes); gated live e2e tests exist for each provider.
14. Zero-overhead invariant: no research module code loads unless `client.research` is used (mirroring the MCP lazy-load precedent where applicable), and existing chat/stream behavior is unchanged.
15. Documentation: library guide (surface, resume semantics, abort-vs-cancel, per-provider notes incl. poll-only degradation and OpenRouter non-resumability), CLI page, testing guide section, runnable example.

---

## Documentation Impact (high-level)

- **`README.md`** — capability bullet + minimal example.
- **`CHANGELOG.md`** — minor-version entry per plan.
- **`CLAUDE.md`** — research surface + commands note.
- **Library docs** — new guide `library/advanced/deep-research.mdx` (surface, job lifecycle, abort-vs-cancel, provider matrix, cost dimensions).
- **CLI docs** — `llmist research` page (flags, background/resume workflow, TOML section).
- **Testing docs** — `mockResearch()` section.
- **API reference** — new public types (ResearchOptions/Job/Event/Result/ModelSpec/errors).
- **Runnable example** — `examples/32-deep-research.ts`.

---

## Out of Scope

- Anthropic research track (server web tools + orchestrator preset) — follow-up spec/plans; v1 reserves type-level room only.
- Anthropic Managed Agents integration.
- `ResearchGadget` / `AgentBuilder.withResearch()` agent-loop integration — follow-up plan after the surface stabilizes.
- `openrouter:web_search` server-tool "research mode" sugar for arbitrary models.
- Webhook-based completion notification.
- Job persistence/queueing/scheduling beyond serializable refs.
- Vector-store creation/management for OpenAI file search.
- TUI research panel; interactive collaborative-planning flows (Gemini `collaborative_planning`) — flag is passed through via `extra`, not surfaced as first-class UX.
