# Coverage map for spec 002-deep-research

Tracks which plans satisfy which spec ACs.

Parent spec: [002-deep-research.md](../../specs/002-deep-research.md)

## Spec ACs

| # | Spec AC (short) | Satisfied by | Status |
|---|---|---|---|
| 1 | End-to-end run on each v1 provider through the identical surface | plan 1 (surface) + plans 2/3/4 (provider legs) | partial chain |
| 2 | Background lifecycle: toRef → attach resumes losslessly; status; cancel | plan 1 (job/namespace) + plan 2 (OpenAI reference impl) + plan 3 (Gemini) | partial chain |
| 3 | Non-resumable provider: typed errors, no silent re-run on drop | plan 1 (job semantics) + plan 4 (OpenRouter) | partial chain |
| 4 | Poll-only model via create+poll with status heartbeats | plan 2 (gpt-5.5-pro) | full |
| 5 | Citations captured on all providers (incl. dual shapes, dedupe) | plan 1 (collector) + plans 2/3/4 | partial chain |
| 6 | Usage incl. searches; cost covers per-search + internal-reasoning | plan 1 (cost.ts) + plans 2/3/4 (catalog pricing) | partial chain |
| 7 | Catalog-driven capability + shutdown metadata warn/throw | plan 1 (mechanism) + plans 2/3/4 (catalogs) | partial chain |
| 8 | Pre-flight validation against spec capabilities | plan 1 (mechanism) + plans 2 (tool injection), 3 (followUps/background), 4 (tools rejection) | partial chain |
| 9 | Auto-reconnect with cursor, bounded, no dup/loss | plan 1 (job) + plans 2/3 (provider resume) | partial chain |
| 10 | Abort ≠ cancel; job survives transport abort | plan 1 | full |
| 11 | Testing mocks (events, report, resume replay) | plan 1 | full |
| 12 | CLI: research command, background/resume, --json, TOML | plan 5 | full |
| 13 | Fixture-driven normalizer tests + gated live e2e per provider | plans 2/3/4 | partial chain |
| 14 | Zero overhead when unused; chat path unchanged | plan 1 (invariant; re-checked in 2–4) | partial chain |
| 15 | Documentation set (library guide, CLI, testing, example) | plan 5 | full |

## Coverage summary

- **15 spec ACs** mapped to **5 plans**
- **5 full-coverage ACs**: #4 (P2), #10 (P1), #11 (P1), #12 (P5), #15 (P5)
- **10 partial-chain ACs**: #1, #2, #3, #5, #6, #7, #8, #9, #13, #14

## Plan dependency graph

```
                ┌──→ 2-openai ──────┐
1-research-core ┼──→ 3-gemini ──────┼──→ 5-cli-docs
                └──→ 4-openrouter ──┘
```

- **Plan 1** is the prerequisite for everything.
- **Plans 2, 3, 4 are siblings** — parallelizable after plan 1; recommended landing order 2 → 3 → 4 (OpenAI is the reference background implementation; OpenRouter removes the `@experimental` marker).
- **Plan 5** requires all provider legs (docs describe the real provider matrix).

## Plans

| # | File | Slug | Status |
|---|---|---|---|
| 1 | [`1-research-core.md`](./1-research-core.md) | `research-core` | pending |
| 2 | [`2-openai.md`](./2-openai.md) | `openai` | pending |
| 3 | [`3-gemini.md`](./3-gemini.md) | `gemini` | pending |
| 4 | [`4-openrouter.md`](./4-openrouter.md) | `openrouter` | pending |
| 5 | [`5-cli-docs.md`](./5-cli-docs.md) | `cli-docs` | pending |

## Documentation impact distribution

| Top-level doc (from spec) | Plan that owns it |
|---|---|
| `README.md` capability bullet | plan 5 |
| `CHANGELOG.md` | each plan adds its own entry |
| `CLAUDE.md` | plan 5 |
| Library guide (`deep-research.mdx`) | plan 5 (from realities established in 1–4) |
| CLI docs | plan 5 |
| Testing docs (`mockResearch`) | plan 5 |
| API reference (TSDoc) | each plan documents its own public types |
| Runnable example (`32-deep-research.ts`) | plan 5 |

## Deferred (tracked in spec Out of Scope)

- Anthropic track (server web tools + orchestrator preset) — future spec/plans; v1 reserves `kind: "preset"` + nullable jobId.
- `ResearchGadget` / `AgentBuilder.withResearch()` — future plan.
- `openrouter:web_search` server-tool sugar — future plan.
