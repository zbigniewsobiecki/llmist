---
id: 002
slug: deep-research
plan: 5
plan_slug: cli-docs
level: plan
parent_spec: docs/specs/002-deep-research.md
depends_on: [1, 2, 3, 4]
status: pending
---

# 002/5: CLI command, example, documentation

> Part 5 of 5 in the 002-deep-research plan set. See [parent spec](../../specs/002-deep-research.md).

## Summary

User-facing completion of the feature: `llmist research` CLI command with background/resume workflow, the runnable example, and the full documentation set (library guide, CLI page, testing section, README/CHANGELOG/CLAUDE.md).

**Components delivered:**
- `packages/cli/src/research-command.ts` (+ registration in `program.ts`, `COMMANDS.research` in `constants.ts`)
- `packages/cli/src/config.ts` / `config-types.ts` / `config-validators.ts` — `[research]` TOML section (`model`, `timeout`, `quiet`, `json`)
- `examples/32-deep-research.ts`
- `packages/docs/src/content/docs/library/advanced/deep-research.mdx`
- `packages/docs/src/content/docs/cli/...` research command page
- Testing docs section (`mockResearch()`)
- `README.md` capability bullet, `CHANGELOG.md`, `CLAUDE.md` note

---

## Spec ACs satisfied by this plan

- **AC #12** (CLI) — **full**
- **AC #15** (documentation set) — **full**

---

## Depends On

- Plans 1–4 (surface + all three providers).
- Existing CLI plumbing: `program.ts` command registration, TOML config loading/validation, stderr progress conventions from `complete-command.ts`.

---

## Detailed Task List (TDD)

### 1. CLI command

**Tests first** (`packages/cli/src/research-command.test.ts`, mock adapter):
- happy path: prompt arg → events stream; phases/searches/thinking rendered to **stderr**, report text to **stdout**, citations appended as a numbered list, cost/usage summary line on stderr
- `--model` overrides `[research].model` overrides global default; unknown/non-research model → actionable error listing `client.research.listModels()` output
- `--background`: prints `JSON.stringify(job.toRef())` to stdout and exits 0 after `created`
- `--resume <ref-json>`: `attach()` and continue streaming; invalid JSON / non-resumable ref → clean error, exit ≠ 0
- `--cancel <ref-json>`: cancels, prints confirmation
- `--json`: NDJSON events to stdout (no decorative output); report NOT separately printed (it's in the events)
- `--output <file>`: report written to file; stdout gets confirmation
- `--timeout <sec>` mapped to `timeoutMs`; `--quiet` suppresses progress
- terminal statuses: `failed` → exit 1 with error on stderr; `incomplete`/`budget_exceeded` → exit 2 with partial report + warning
- TOML `[research]` defaults resolved (fixture config)

**Implementation:** follow `complete-command.ts` structure (env handling, config load, cost summary); reuse existing progress/rendering utilities; exit codes as named constants.

### 2. Example

- `examples/32-deep-research.ts`: three sections — (a) mocked run (works without keys: registers `mockResearch()`), (b) commented real-provider variants for all three providers, (c) `toRef()`/`attach()` snippet. Verify with `npx tsx examples/32-deep-research.ts`.

### 3. Documentation

- **Library guide** (`library/advanced/deep-research.mdx`): surface walkthrough; event union table; job lifecycle diagram (create → stream/poll → resume/cancel); **abort vs cancel semantics** (loud); provider matrix (capabilities, pricing dimensions, caveats: gpt-5.5-pro poll-only degradation, Gemini preview + 60-min cap + paid tier + follow-ups, OpenRouter **non-resumable — dropped stream is money lost** + `--json` salvage tip, OpenAI o3/o4 shutdown 2026-07-23); cost estimation section.
- **CLI page**: command, flags, background/resume workflow with a real transcript, `[research]` TOML reference.
- **Testing docs**: `mockResearch()` / `returnsResearch` / `withResearchEvents` / resume replay.
- **README.md**: capability bullet + 5-line example. **CLAUDE.md**: research section (surface, catalog locations, CLI command). **CHANGELOG.md** entry.

### 4. Final verification sweep

- `npm run build && npm run typecheck && npm run lint && npm run test` across the workspace.
- Manual: `llmist research "test question" --model <mock>` end-to-end; `--background` → `--resume` roundtrip; docs site builds (`npm run docs:build`).
