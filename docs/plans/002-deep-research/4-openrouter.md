---
id: 002
slug: deep-research
plan: 4
plan_slug: openrouter
level: plan
parent_spec: docs/specs/002-deep-research.md
depends_on: [1]
status: pending
---

# 002/4: OpenRouter track — research models over chat completions

> Part 4 of 5 in the 002-deep-research plan set. See [parent spec](../../specs/002-deep-research.md).

## Summary

Maps OpenRouter-hosted research models (`perplexity/sonar-deep-research`, `perplexity/sonar-pro-search`, `openai/o3-deep-research`, `openai/o4-mini-deep-research`) into the research surface over the **existing chat-completions streaming path**. No job id, no background, no resume — `created {jobId: null}`, mandatory streaming, long per-request timeout, and strict money-safety on stream drops (typed non-retryable error, never re-run). Adds the reasoning-delta and citation extraction the current OpenRouter normalizer drops, in a research-specific normalizer.

**Components delivered:**
- `packages/llmist/src/providers/openrouter-research-models.ts` — catalog
- `packages/llmist/src/providers/openrouter-research.ts` — request builder + chunk normalizer (or co-located in `openrouter.ts` if under ~200 lines; prefer sibling file)
- `packages/llmist/src/providers/openrouter.ts` — capability wiring (`startResearch` only; resume/status/cancel intentionally omitted)
- `packages/llmist/src/providers/__fixtures__/openrouter-sonar-research.json` — chunk fixture (reasoning deltas, both citation shapes, keep-alive comments, final usage)

---

## Spec ACs satisfied by this plan

- **AC #1** (end-to-end run) — **partial** (OpenRouter leg; completes the three-provider set)
- **AC #3** (non-resumable provider semantics: typed errors, no silent re-run) — **full**
- **AC #5** (citations incl. dual-shape dedupe) — **partial** (OpenRouter leg)
- **AC #6** (usage/cost incl. per-search + internal-reasoning) — **partial** (the only provider exercising `internalReasoning` pricing)
- **AC #7** (catalog incl. upstream-shutdown metadata on `openai/*` slugs) — **partial**
- **AC #8** (validation: tools rejected on Perplexity models) — **partial**
- **AC #13** (fixtures + gated live e2e) — **partial** (OpenRouter leg)

---

## Depends On

- Plan 1.
- Existing `providers/openrouter.ts` / `openai-compatible-provider.ts` (client construction, headers, error enhancement).

---

## Detailed Task List (TDD)

### 1. Catalog

**Tests first** (`providers/openrouter-research-models.test.ts`):
- `perplexity/sonar-deep-research`: $2/$8, `internalReasoning: 3`, `perThousandSearches: 5`, ctx 128_000, capabilities `{streaming:true, background:false, resumable:false, tools:[]}`
- `perplexity/sonar-pro-search`: $3/$15, `perThousandSearches: 18`, ctx 200_000
- `openai/o3-deep-research` ($10/$40) and `openai/o4-mini-deep-research` ($2/$8): `perThousandSearches: 10`, `metadata.shutdownDate: "2026-07-23"` (upstream), `metadata.replacement` note, capabilities tools `[web_search]` (upstream-managed; requests still pass no tools param — document)
- all `kind: "model"`

### 2. Request builder

**Tests first** (`providers/openrouter-research.test.ts` — builder section):
- builds standard chat-completions request: messages (`systemPrompt` as system role — chat surface has one; `query` as user), `stream: true` always (options.background === true → typed error via namespace pre-flight; builder asserts too), `reasoning: {effort}` mapped from `ReasoningConfig` when set, `web_search_options.search_context_size` passthrough via `extra`
- `options.tools` non-empty on a spec with `capabilities.tools: []` → typed validation error
- OpenRouter conventions preserved: HTTP-Referer/X-Title headers, `extra.routing` handling
- per-request `{timeout: OPENROUTER_RESEARCH_HTTP_TIMEOUT_MS}` override (client default is 120s — must be overridden)

### 3. Normalizer

**Tests first** (fixture-driven):
- first content-bearing chunk → `created {jobId: null}` + `status in_progress`
- `delta.reasoning` → `thinking`; `delta.reasoning_details[]` entries of type `reasoning.text` → `thinking` (no double-emit when both present — reasoning_details preferred; fixture case)
- `delta.content` → `text`
- `delta.annotations[]`/`message.annotations[]` `url_citation` (nested `{url_citation: {url, title, content, start_index, end_index}}`) → `citation` incl. `content`
- legacy top-level `citations: ["url", ...]` → one `citation` per url, **deduplicated** against annotation-derived citations by url
- final chunk usage → `usage` (map `completion_tokens_details.reasoning_tokens` → reasoningTokens; search count when present) then `done` (`finish_reason` stop→completed, length→incomplete, error→failed)
- keep-alive comment lines absent from chunk stream (SDK-level) — fixture documents this; test asserts normalizer tolerates empty-delta chunks
- stream error mid-run → `error {retryable: false}` + iterator end (money-safety; NO resume attempt — assert `resumeResearch` is undefined on the adapter)

### 4. Adapter wiring + e2e

- `startResearch` on `OpenRouterProvider`; `supportsResearch` = catalog membership; `resumeResearch`/`getResearchStatus`/`cancelResearch` deliberately not implemented (job surfaces typed errors from plan-1 logic; `cancel()` falls back to transport abort).
- `toRef()` behavior verified end-to-end: throws `ResearchJobNotResumableError`.
- Gated live e2e (`RUN_LIVE_RESEARCH_TESTS` + `OPENROUTER_API_KEY`): one `perplexity/sonar-deep-research` run (~$0.50–2; budget note): report + ≥1 citation + usage with reasoning tokens; assert `costUSD` computed with internal-reasoning + per-search dimensions.
- `CHANGELOG.md` entry; remove `@experimental` from the research surface TSDoc (three providers live).

---

## Documentation impact (this plan)

TSDoc only; plan 5 authors the "not resumable — dropped stream is money lost" warning and the provider matrix row.
