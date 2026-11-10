---
id: "004"
slug: runtime-minimatch-major-upgrade
plan: 1
plan_slug: runtime-upgrade
level: plan
title: Upgrade direct runtime minimatch with skill compatibility and exposure evidence
parent_spec: docs/specs/004-runtime-minimatch-major-upgrade.md
depends_on: []
status: pending
---

# 004/1: Upgrade direct runtime minimatch with skill compatibility and exposure evidence

> Part 1 of 1. Parent: [full spec](../../specs/004-runtime-minimatch-major-upgrade.md).

## Summary

Related to WAT-558

Characterize skill selection and built consumer loading before upgrading llmist's direct
minimatch range from `^9.0.9` to `^11`, selecting an upstream release at least 11.0.1.
Qualify the installed graph, preserve the existing matcher defaults and public behavior,
and demonstrate removal of GHSA-g3hv-75wg-m249 from the library and inherited CLI runtime
paths with fresh valid advisory data and actual parent chains.

Deliver one atomic dependency-maintenance change with regression tests and evidence.
Development cleanup, private documentation and release-tool findings remain visible and
upstream-only. This is not a zero-finding audit target or risk acceptance. There is no
later plan that supplies missing tests or evidence.

**Components delivered / files owned exclusively within this spec:**

- `packages/llmist/src/skills/registry.test.ts`: file-selection characterization.
- `packages/llmist/src/skills/runtime-compatibility.test.ts`: new built ESM/CommonJS checks.
- `packages/cli/src/skills/runtime-skills.test.ts`: new built CLI skill workflow checks.
- `packages/llmist/package.json`: only the direct minimatch dependency range.
- `package-lock.json`: that range and required upstream resolution changes.
- This plan's Evidence and Progress sections, and its normal `.md` → `.md.wip` →
  `.md.done` implementation lifecycle.
- `docs/plans/004-runtime-minimatch-major-upgrade/_coverage.md`: completion links/conclusions.
- The sole parent spec's completion status and `.md.done` rename when the implementation
  lifecycle reaches spec completion; no other parent text change.
- `changelog.d/wat-558-runtime-minimatch-upgrade.md`: one later implementation fragment.

No production TypeScript change is expected: `SkillRegistry.findByFilePath(filePath: string):
Skill[]` already uses the named `minimatch` export with default options. A necessary behavior,
public API or stored-shape change blocks execution for owner direction rather than becoming
an implicit migration. Do not change bundler configuration to conceal incompatibility.

**Shared surfaces:** none in this one-plan set. Independent changelog fragments do not
conflict. Preserve landed Spec and Plan fragments; edit the implementation fragment on
unmerged follow-ups rather than adding a second one.

**Deferred to later plans:** none. Upstream residuals require separate scope and ownership.

## Spec ACs satisfied by this plan

- Spec AC #1 — **full**: direct range, selected installed version, engine/module checks,
  reproducible engine-strict install and explained lock delta.
- Spec AC #2 — **full**: fresh valid audit plus shipped library/CLI dependency traversal.
- Spec AC #3 — **full**: enumerated residual versions, chains, advisories and upstream boundaries.
- Spec AC #4 — **full**: concrete file-selection characterization plus existing regressions.
- Spec AC #5 — **full**: built ESM/CommonJS and inherited CLI skill workflows, no migration.
- Spec AC #6 — **full**: six sequential local tiers and required exact-reviewed-head CI;
  the external CI result is a merge gate, not inferred from local success.

## Depends On

None (`depends_on: []`). Start from current `dev` containing the merged full spec.
Historical source: merge commit `c392dcd711b1ed399f2da9cba3532d5864785df4`, SHA-256
`ea79004167e50940b33aa4479b3756920fd7f3046ca008f5e128b9a953b5090c`.
Resolve the parent by id/slug if its lifecycle extension changes; retain the pinned source
as provenance. Reassess if current code, ranges or advisory data invalidate this plan.

Planning inspects the existing registry, skill parser/loader, package exports, tsup configs,
CLI manager/commands and CI workflow. Cached registry metadata for minimatch 11.0.1 declares
Node `18 || 20 || >=22`, dependencies `brace-expansion ^5.0.12` and
`@isaacs/nonrecursive-glob-match ^1.0.1`. This supports the Node-major choice but is not a
fresh artifact, license, export-map or installed-compatibility proof. Task 1 must verify
the actual selected artifact before editing dependencies; task 3 qualifies its consumers.

## Detailed Task List (TDD)

Keep raw logs and one-shot audit/graph checks in ignored `.watershed/.cache/004-runtime/`.
Record conclusions in this plan, not global docs or the historical 003 evidence. Do not
commit dependency-version snapshot tests. No exploit patterns, optimization-level benchmarks
or provider calls are needed. New characterization tests legitimately pass on the baseline;
their expected-red mechanism below uses temporary, reverted mutations, not an invented bug.

### 1. Establish baseline checks and selected-release compatibility

**Tests first — command-driven acceptance checks on unchanged current `dev`:**

- `direct-runtime-target`: resolve dependencies from `packages/llmist` and through
  `packages/cli` → `llmist`; require the direct manifest range `^11` and installed version
  satisfying it and `>=11.0.1`. Expected red on the pinned baseline: `^9.0.9` / 9.0.9 fails
  these predicates. Use the installed resolver and lock edges, not the hoisted version alone.
- `audit-json-valid`: run `npm audit --package-lock-only --json --ignore-scripts`, capturing
  stdout, stderr and status separately. Parse JSON; require the supported audit schema,
  vulnerability map, advisory entries and absence of a registry/error object. Exit 1 with
  valid findings is a completed audit. Network failure, missing advisory data, malformed
  JSON or unsupported schema blocks conclusions. This validity check should pass before
  and after; a deliberately malformed saved response must fail parsing/validation.
- `runtime-advisory-absent`: map GHSA-g3hv-75wg-m249 advisory ranges/nodes to installed
  paths reachable on library and inherited CLI runtime dependency edges. Expected red:
  baseline direct minimatch 9.0.9 is affected on both paths. Do not assert that this GHSA
  disappears from the whole repository; residual copies are expected.

**Implementation — baseline and pre-edit evidence in this plan:**

1. Record current base SHA, UTC audit time, Node/npm versions, lock hash, command statuses
   and deduplicated advisory inventory. Reconcile against historical
   [003 evidence](../003-current-lock-security-remediation/1-compatible-remediation.md.done#evidence).
   If a target check is already green, explain the actual graph; never reinstall a vulnerable
   version to manufacture red or reuse the historical finding count as a fresh result.
2. Use lock edges, `npm explain` and `npm ls --all --json` plus installed manifests to trace
   parent chains. Explain tree errors before proceeding. Distinguish advisory objects from
   propagated package entries. Workspace `dev`/`devOptional` flags and production-only audits
   cannot determine shipped runtime exposure by themselves.
3. Before the dependency edit, inspect full metadata and the selected upstream artifact
   satisfying `^11` / `>=11.0.1`, including integrity, ISC license, transitive dependencies,
   Node engines and ESM/CommonJS exports with the named `minimatch` function. Inspect its
   migration notes/types/source for changed default pattern semantics. Use pinned/cached
   package artifacts and authorized registry tools; do not bypass sandbox egress restrictions.
   Cached abbreviated metadata alone is insufficient. Missing artifact evidence blocks the
   upgrade; unsupported engines, missing exports or required behavior changes require direction.
4. Preserve consumer Node `>=22.0.0`, `.nvmrc` 22 and the existing contributor toolchain floor.
   Qualify on the worker's compatible Node per `CONTRIBUTING.md`, npm 10.9.2 and engine-strict;
   record the selected artifact version rather than assuming `^11` alone proves remediation.

### 2. Characterize existing skill matching before changing the dependency

**Tests first — unit tests in `packages/llmist/src/skills/registry.test.ts`:**

Exercise real `Skill`, `SkillRegistry.from` and `findByFilePath`; do not mock minimatch.
Assert returned skill names (and uniqueness), not calls to the matcher. Retain the existing
"finds skills matching file path patterns" and "returns empty array when no patterns match".
Use one small case per row or parameterized test; these are proposed descriptive test names.

| Test | Setup → expected selection | Expected red in a temporary mutation check |
|---|---|---|
| `matches a top-level file` | `*.ts`, `main.ts` → skill selected | Return `[]`: expected named skill, got none |
| `matches nested globstar paths` | `src/**/*.ts`, both `src/main.ts` and `src/a/b.ts` → selected | Return `[]`: expected selection |
| `rejects a nonmatching extension` | `**/*.ts`, `readme.md` → empty | Select every model-invocable skill: expected empty |
| `selects when only a later pattern matches` | `['**/*.css', '**/*.ts']`, `src/a.ts` → selected | Check only first pattern: expected selection |
| `returns a skill once when multiple patterns match` | `['**/*.ts', 'src/**']`, `src/a.ts` → one name | Collect per-pattern results: expected one, got two |
| `excludes absent paths` | No `paths`, `src/a.ts` → empty | Treat absent patterns as match-all: expected empty |
| `excludes empty paths` | Parsed skill with `paths: []`, `src/a.ts` → empty | Treat empty patterns as match-all: expected empty |
| `excludes model-disabled matching skills` | Matching paths with `disable-model-invocation: true` → empty | Use `getAll()` instead of `getModelInvocable()`: expected empty |
| `preserves default dotfile handling` | `**/*.ts` rejects `src/.hidden.ts`; `src/.*.ts` selects it | Set `dot: true` / reject explicit dot: selection mismatch |
| `preserves brace alternatives` | `src/*.{ts,tsx}` selects `src/a.tsx`, rejects `src/a.js` | Disable brace expansion: expected selected name |
| `preserves extglob alternatives` | `src/@(a|b).ts` selects `src/b.ts`, rejects `src/c.ts` | Disable extglob: expected selected name |
| `preserves case-sensitive matching` | `src/*.ts` rejects `SRC/a.TS` | Set `nocase: true`: expected empty |
| `preserves segment boundaries` | `src/*.ts` rejects `src/nested/a.ts` | Replace pattern with `src/**/*.ts`: expected empty, got selected skill |
| `preserves default negation` | `!**/*.test.ts` selects `src/a.ts`, rejects `src/a.test.ts` | Set `nonegate: true`: expected selected name |

For empty paths, use explicit YAML `paths: []` with `Skill.fromContent` rather than the
existing `makeSkill` helper's empty multiline YAML if it parses as null. Assert metadata
really contains the empty array, so this case differs from absent patterns.

**Implementation — test fixtures and characterization evidence only:**

- Run every row against baseline 9.0.9 first; pin observed defaults before the upgrade.
  Apply the relevant minimal mutation to confirm the named assertion fails for the stated
  reason, then revert it and require green. Temporary mutations must never be committed.
  Do not accept missing-import, syntax or fixture-parsing errors as right-reason red.
- Add bounded ordinary edge cases identified by task 1's artifact comparison, especially
  changed pattern parsing/optimization paths actually reachable with default options. Record
  why the matrix covers the relevant major boundary; do not claim exhaustive glob equivalence.
- Preserve `findByFilePath(filePath: string): Skill[]`, `.some` semantics and default matcher
  options. If any baseline result conflicts with the stated preservation contract, stop for
  reassessment rather than changing expected values to fit the candidate.
- Refactor fixtures on green if useful; keep all existing assertions and regression suites.

### 3. Prove built library and CLI compatibility, then upgrade

**Tests first — built consumer integration tests, before the dependency edit:**

Build baseline packages, then add these tests. They must spawn real Node processes against
package exports, bypassing Vitest's source aliases; don't mock llmist, minimatch or the CLI
manager. Use ordinary temporary fixture directories with cleanup and bounded child-process
timeouts; do not redirect `TMPDIR` or overwrite `HOME`. No provider client is needed.

- `built ESM consumer selects and activates a skill` —
  `packages/llmist/src/skills/runtime-compatibility.test.ts`: spawn Node in module mode and
  `import('llmist')`; construct `Skill.fromContent` with a simple path pattern, register it,
  select through `findByFilePath` and read/activate provider-free instructions with shell
  preprocessing disabled. Assert exact selected name and instruction text, zero exit status
  and no loading error. Expected red under a temporary fixture mismatch: expected selected
  name/instruction, got a different value. A deliberately invalid export path must also
  cause the parent test to fail rather than swallowing the child error.
- `built CommonJS consumer selects and activates a skill` — same file and observable
  assertions, using a separate CommonJS child process and `require('llmist')`. Expected red
  by the same controlled fixture mismatch. An ESM success cannot stand in for this check.
- `built CLI lists and describes a project skill` —
  `packages/cli/src/skills/runtime-skills.test.ts`: create a uniquely named
  `.llmist/skills/<name>/SKILL.md` beneath an isolated project fixture; spawn the absolute
  built `packages/cli/dist/cli.js` path with `skill list` and `skill info <name>` from that
  cwd. Assert the list contains the fixture name and info contains its paths and exact
  instruction text, with successful exits. Expected red if the fixture uses a different
  name: list/info assertions fail. Retain existing manager, command and slash-handler tests.

**Implementation — direct manifest and lock:**

1. Establish all task 2–3 tests green on the baseline, with mutation checks restored. Build
   before running the new subprocess tests; `npm test` alone after a clean checkout does
   not build dist artifacts. The six-tier final sequence and existing CI already build first.
2. Change only `packages/llmist/package.json`'s minimatch range to exactly `^11`.
   Use npm 10.9.2 ordinary range-respecting lock resolution, for example
   `npm install --package-lock-only --ignore-scripts --engine-strict`, without forced
   resolutions or adopting another branch. Explain each required changed dependency subtree
   and workspace lock metadata field; reject unrelated dependency churn. Other manifests
   and toolchain policy remain unchanged.
3. Run `npm ci --engine-strict --ignore-scripts=false` with npm 10.9.2 (record its executable;
   `node_modules/.bin/npm` belongs to release tooling). Verify the lock does not mutate.
   Directly run `node_modules/.bin/lefthook install`; inspect executable pre-commit,
   commit-msg and pre-push hooks and the expected `@unblessed/core/dist/data` symlink.
   Wrapper success does not excuse hidden lifecycle or hook failures.
4. Rebuild and rerun unchanged task 1–3 checks against the installed candidate. Verify the
   artifact and resolved version match the lock and integrity provenance. Keep both library
   module formats, CLI loading and skill selection usable. Stop for any needed public API,
   configuration, stored-data or behavior migration; do not weaken tests or add shims.

### 4. Re-audit and reconcile runtime removal and upstream residuals

**Tests first — acceptance check `residual-inventory-complete`:**

Compare valid fresh baseline/candidate audits by advisory identifier and dependency path,
not total counts. Require every remaining affected path to have versions, parent chains,
advisory identifiers, exposure and upstream-only status. Expected red on an incomplete
report: a deliberately omitted known residual row fails reconciliation. Keep the unchanged
`runtime-advisory-absent` check: candidate library/CLI paths must pass even if this advisory
remains on unrelated paths. Network errors must fail `audit-json-valid`, never produce green.

**Implementation — this plan's Evidence section and implementation changelog:**

- Run the same audit protocol against the candidate lock and installed tree; record UTC
  timestamp, lock hash, resolved versions and command outcomes. Deduplicate GHSA identities
  while retaining each affected installation and full parent chain. Trace CLI → llmist →
  selected minimatch explicitly. Reachability alone proves neither exploitability nor safety.
- Enumerate remaining root/workspace rimraf → glob cleanup paths; private `@llmist/docs`
  → TypeDoc / starlight-typedoc / typedoc-plugin-markdown paths; and semantic-release →
  @semantic-release/npm → npm's bundled glob/minimatch artifacts. Inspect nested bundled
  manifests, not only hoisted packages. Record GHSA-3g3m-2fjr-6pw4 and
  GHSA-g3hv-75wg-m249 wherever still reported, and all added/changed/withdrawn advisories.
- For each residual include affected version, dependency edge ranges, fixed upstream
  boundary and why it remains outside the authorized direct upgrade. Keep residuals
  **unresolved — upstream-only**, without a suppression, exception or accepted-risk claim.
  Assess new findings explicitly; stop if disposition requires scope or an owner decision.
- Update only this plan's evidence with candidate audit, graph, compatibility and gate
  conclusions. Preserve historical 003 evidence. Add the one measured implementation
  fragment with runtime-path remediation and retained residuals; do not imply an advisory-free
  repository. No README, global guidance or user migration docs are expected.

### 5. Qualify and deliver the completed implementation candidate

**Tests first:** keep task 1–4 checks and all existing assertions. Existing library skill
loader, activation, registry and LoadSkill tests, CLI manager/command/slash-handler tests,
and mocked E2E remain regression checks, not substitutes for the fresh audit. No test
removal or narrowing is planned. No exploit test or live research opt-in is authorized.

**Implementation — lifecycle, verification and delivery:**

- Follow the normal implementation lock/progress/done lifecycle. The sole completed plan
  owns the parent spec's `status: draft` → `done` and `.md` → `.md.done` transition, plus
  coverage links. Byte-compare the parent to the pinned source allowing only its status
  change; do not rewrite requirements. Run the implementation skill's done-gate. The Plan PR
  itself leaves the spec untouched and this plan pending.
- Finish and stage intended candidate files before final checks. Run sequentially, stopping
  on failure: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run test:coverage`, `npm run test:e2e`. Record statuses, counts and skipped live suites.
  Keep `RUN_LIVE_RESEARCH_TESTS` unset. If a suspected baseline failure appears, confirm once
  on unchanged `origin/dev` in `.watershed/.cache/`, report test names/timings/failure mode
  and stop. Never put a baseline worktree under `node_modules`.
- Invoke `agent-plugins__z:local-review` in gate mode over the full implementation delta
  with this plan as compliance input. Address blockers without weakening assertions or gates;
  do not silently defer them. Keep npm, Lefthook, commitlint, Biome and all CI jobs intact.
- Record local evidence before the final normal-hook Conventional Commit. Every commit and
  PR title/body uses only `Related to WAT-558` for the issue reference. Deliver into `dev`
  through the declared trusted publication hook; no push, package publication or auto-merge.
- Apply the existing repository CI-only handoff used by plan 003: if the final head is not
  yet published, only AC #8 may remain unchecked with an explicit note naming pending
  `lint-and-test`, `validate-commits` and `e2e-tests` on that head. This records an outstanding
  external check, not successful completion of it or a new waiver. All local criteria must
  be verified before lifecycle completion. Run the done-gate with that explicit disposition;
  no local failure or review blocker may use this handoff.
- After publication all three checks must actually succeed at the exact head, followed by
  independent review of that same head. Stale, pending, missing or failed checks block merge.
  GitHub's head-specific results satisfy the CI handoff without a subsequent evidence-only
  commit that would change the tested head. Any new commit requires checks/review for its head.

## Test Plan

| Check / suite | Owner task | Required result |
|---|---|---|
| `direct-runtime-target` | 1, 3 | Range `^11`, installed version >=11.0.1 on actual library/CLI edges |
| `audit-json-valid` | 1, 4 | Fresh valid JSON; malformed/error/network responses block conclusions |
| `runtime-advisory-absent` | 1, 4 | Named GHSA absent from shipped library/CLI paths, regardless of residual copies |
| Registry characterization matrix | 2 | All named rows preserve baseline selection with real matcher defaults |
| Built ESM/CommonJS integration | 3 | Both package-export branches load, select and activate fixture instructions |
| Built CLI integration | 3 | Real project discovery, list and info work without providers |
| Existing skill and mocked E2E suites | 5 | All existing assertions remain green |
| `residual-inventory-complete` | 4 | All residual paths and advisory changes reconciled |
| Engine-strict install, hooks, lock review | 1, 3 | Unchanged policy, valid lifecycle/hooks, narrowly explained lock delta |
| Six local tiers and local-review | 5 | Sequential success, no unresolved gate findings |
| Exact-head CI and independent review | 5 | Three named successful checks, then independent review of that head |
| Parent lifecycle and done-gate | 5 | Completed implementation artifacts; parent otherwise byte-identical |

## Manual Verification

AC #4 and #7 require evidence interpretation in addition to automated checks.

- **AC #4 — residual reconciliation.** Compare every baseline/candidate advisory identity
  and affected lock/installed path against the Evidence inventory. For cleanup, private docs
  and bundled release tooling, verify versions and edge ranges from actual manifests and
  `npm explain`/tree results. Expected outcome: every residual and every added/changed finding
  has an explicit disposition and chain; none is silently classified as safe or accepted.
- **AC #7 — scope and documentation.** Review the entire delta and candidate evidence;
  compare all manifests and the parent spec to the base/pinned versions. Expected outcome:
  only authorized direct/required lock changes, tests, own lifecycle/evidence and one measured
  implementation fragment; public contracts, policies, tools and assertions remain intact.
  Record the local-review outcome and document any blocker instead of marking green.

All other criteria use automated commands/tests; AC #8 uses GitHub's exact-head records.

## Acceptance Criteria (per-plan, testable)

1. Direct minimatch range is exactly `^11`, installed library/CLI resolution is at least
   11.0.1, selected artifact engines/exports are compatible, and engine-strict npm 10.9.2
   installation reproduces the explained lock delta under unchanged Node policy (spec AC #1).
2. The registry characterization matrix and existing skill suites pass with preserved
   matching/nonmatching/nested/alternative/default-edge behavior, excluding absent/empty
   patterns and model-disabled skills (spec AC #4).
3. Built ESM and CommonJS consumers and the built CLI skill workflow checks pass without
   API, configuration, stored-data or behavior migration and without providers (spec AC #5).
4. [manual] Valid fresh baseline/candidate audits and installed parent chains prove the
   named advisory absent from shipped library/CLI runtime paths; every residual and changed
   advisory has versions, parents and unresolved upstream-only disposition (spec AC #2–3).
5. Build, typecheck, lint, unit, coverage and mocked E2E all pass sequentially; all existing
   assertions remain intact; no paid providers or exploit execution (spec AC #6).
6. The plan/spec completion lifecycle and done-gate pass; parent text is otherwise preserved
   against the pinned source, with coverage links updated (workflow/documentation hygiene).
7. [manual] Evidence and implementation changelog describe measured outcomes, the scoped
   delta preserves required tools/policies and passes local-review with no outstanding
   blocker; no forced mechanism, suppression, exception or waiver is introduced (spec
   constraints and Documentation Impact).
8. `lint-and-test`, `validate-commits` and `e2e-tests` succeed on the exact final head,
   followed by independent review of that head (spec AC #6). Pending CI is explicitly
   outstanding under task 5's CI-only handoff, never inferred from local results.

## Documentation Impact

| File | Change |
|---|---|
| This plan's Evidence and Progress | Baseline/candidate graph and audit, artifact provenance, pattern/module/CLI results, local gate outcomes; retain exact-head CI as external records |
| `_coverage.md` in this folder | Completion links and measured coverage conclusions only |
| Parent spec | Sole-plan completion rename/status only; historical content preserved |
| `changelog.d/wat-558-runtime-minimatch-upgrade.md` | Measured direct runtime remediation and retained upstream residuals |
| `README.md`, `CLAUDE.md`, user migration docs | No change: no new public contract or cross-cutting rule; a migration need blocks scope |

## Operator governance handoff

Required approval count, legitimate review identity, strict up-to-date rules and merge
authority remain operator governance outside plan criteria. An independent COMMENT review
does not supply the required approving review. No bypass or new credentials are authorized.
Exact-head CI and independent review remain required even when local implementation is done.

## Out of Scope

- rimraf/development cleanup, TypeDoc/plugin upgrades, edits to npm's bundled dependencies,
  alternative matchers, forced overrides/resolutions, vendor patches, suppressions, ignore
  lists, new exceptions or waivers, and broader vulnerability remediation.
- Skill syntax, APIs, stored shapes, provider behavior, architecture or performance promises.
- Adopting, editing, commenting on or closing unowned Dependabot PR #677.
- Release PRs, `main` promotion, package publication, automatic merge, ruleset changes or
  new identities. No paid provider tests or exploit execution.

## Evidence

Pending implementation. Record baseline and candidate timestamps/hashes, artifact metadata,
audit/advisory/path tables, residual ranges, characterization and built consumer results,
local checks and review outcome here. Planning does not claim an installed upgrade or
runtime advisory removal. Exact-head CI/review outcomes remain in GitHub's records.

## Progress

<!-- /implement updates these from observed evidence; only AC #8 permits the existing CI-only handoff. -->
- [ ] AC #1
- [ ] AC #2
- [ ] AC #3
- [ ] AC #4
- [ ] AC #5
- [ ] AC #6
- [ ] AC #7
- [ ] AC #8
