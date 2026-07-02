---
id: 002
slug: deep-research
plan: 3
plan_slug: gemini
level: plan
parent_spec: docs/specs/002-deep-research.md
depends_on: [1]
status: pending
---

# 002/3: Gemini track — Interactions API deep-research agents

> Part 3 of 5 in the 002-deep-research plan set. See [parent spec](../../specs/002-deep-research.md).

## Summary

Implements research on the Gemini adapter via the **Interactions API** (`client.interactions.*` in the installed `@google/genai` 1.43.0). Deep research runs as *agents* (`agent` field, not `model`) with mandatory `background: true`, SSE streaming with `last_event_id` resume, follow-ups via `previous_interaction_id`, and a 60-minute hard cap. Catalog entries use `kind: "agent"` (no context-window semantics).

**Components delivered:**
- `packages/llmist/src/providers/gemini-research.ts` — transport (create/get/get-stream/cancel, isolated in one function for a raw-fetch SSE fallback), normalizer, request builder
- `packages/llmist/src/providers/gemini-research-models.ts` — agent catalog
- `packages/llmist/src/providers/gemini.ts` — capability wiring
- `packages/llmist/src/providers/__fixtures__/gemini-interactions-research.json` — SSE event fixture

**First task at implementation time:** live-verify the installed SDK's interactions surface (create with `agent` + `background` + `agent_config`, streaming `get` with `last_event_id`); docs are internally inconsistent (`thought` vs `thought_summary`, `error` vs `interaction.error`) and the agents are preview — if the SDK diverges from the live API, swap the isolated transport function for raw `fetch` SSE against `/v1beta/interactions` (same `x-goog-api-key` auth) without touching the normalizer.

---

## Spec ACs satisfied by this plan

- **AC #1** (end-to-end run) — **partial** (Gemini leg)
- **AC #2** (background lifecycle) — **partial** (Gemini leg: mandatory background, `last_event_id` resume, cancel)
- **AC #5** (citations) — **partial** (Gemini leg)
- **AC #6** (usage/cost) — **partial** (token usage incl. thought/tool-use tokens; searches when reported)
- **AC #7** (catalog) — **partial** (Gemini agents incl. legacy `deep-research-pro-preview-12-2025`)
- **AC #8** (validation) — **partial** (`previousJobId` gating on `followUps`, mandatory background enforcement)
- **AC #13** (fixtures incl. dual shapes + gated live e2e) — **partial** (Gemini leg)

---

## Depends On

- Plan 1.
- Existing `providers/gemini.ts` client construction/env discovery.

---

## Detailed Task List (TDD)

### 1. Agent catalog

**Tests first** (`providers/gemini-research-models.test.ts`):
- `deep-research-preview-04-2026`: `kind:"agent"`, capabilities `{streaming:true, background:true, resumable:true, followUps:true, tools:[]}` (tools are agent-managed), `maxDurationMs: GEMINI_RESEARCH_MAX_DURATION_MS`, pricing per-token (Gemini 3.1 Pro rates) + `perThousandSearches: 14`, no contextWindow
- `deep-research-max-preview-04-2026` (same shape, max-tier notes)
- `deep-research-pro-preview-12-2025` (legacy; `metadata.notes` pointing to the 04-2026 agents)
- unversioned alias absent (no `deep-research` id — Google publishes none)

### 2. Request builder

**Tests first** (`providers/gemini-research.test.ts` — builder section):
- assembles snake_case `{agent, input, background: true, store: true, stream: true, agent_config: {type: "deep-research", thinking_summaries}, previous_interaction_id}`
- `background` forced true regardless of options (mandatory); `options.background === false` → typed validation error (namespace pre-flight catches it via spec, builder double-checks)
- `thinking_summaries`: `"auto"` unless `reasoning?.includeThinking === false` → `"none"`
- `systemPrompt` → `system_instruction` passthrough
- `previousJobId` → `previous_interaction_id`
- `extra` merged last (e.g. `collaborative_planning`)

### 3. Normalizer

**Tests first** (fixture-driven):
- happy path over `__fixtures__/gemini-interactions-research.json`: `interaction.created` → `created {jobId}` + `status in_progress`; `step.start` → `phase` (model_output→writing, thought→reasoning, google_search_call→`search started`); `step.delta text` → `text`; `step.delta thought_summary` → `thinking`; **`step.delta thought` also → `thinking`** (defensive dual shape — separate fixture case); `text_annotation_delta` url_citation → `citation`; `google_search_call/result` deltas → `search started/completed` with query/url; `interaction.status_update` → `status` (incl. `budget_exceeded`, `requires_action`); `interaction.completed` → `usage` (map `total_input_tokens`/`total_output_tokens`/`total_thought_tokens`→reasoningTokens/`total_cached_tokens`) + `done` (report = last `model_output` step `content[0].text`; citations from its `annotations[]`)
- **`error` AND `interaction.error`** both → `error` event (dual shape fixture case)
- `thought_signature` deltas ignored (rawEvent only)
- every event `cursor` = `event_id`
- stream ending without `interaction.completed` → collector falls back to last status (assert non-throw)

### 4. Lifecycle: poll, resume, cancel

**Tests first** (stubbed transport):
- `startResearch`: create(stream) → normalized events
- `resumeResearch(ref)`: streaming `get(id, {last_event_id: ref.cursor})`; no pre-cursor duplication (fixture slice)
- `getResearchStatus(ref)`: non-streaming `get(id)`; maps all seven statuses; on `completed` builds `ResearchResult` from `steps[]`
- `cancelResearch(ref)`: `interactions.cancel(id)`
- default job timeout = `min(RESEARCH_DEFAULT_TIMEOUT_MS, spec.maxDurationMs)` → 60 min
- transport isolation: normalizer consumes `AsyncIterable<InteractionSSEEvent>` — swap-in fake transport in all tests

### 5. Adapter wiring + e2e

- Wire capability methods on `GeminiProvider` delegating to `gemini-research.ts`; `supportsResearch` = agent-catalog membership.
- Gated live e2e (`RUN_LIVE_RESEARCH_TESTS` + `GEMINI_API_KEY`): one `deep-research-preview-04-2026` run (~$1–3; budget note in header): assert report + citations + ref/attach roundtrip mid-run + follow-up via `previousJobId` (small follow-up question).
- `CHANGELOG.md` entry.

---

## Documentation impact (this plan)

TSDoc only; plan 5 authors the user-facing provider matrix row (preview status, 60-min cap, paid-tier requirement, follow-ups).
