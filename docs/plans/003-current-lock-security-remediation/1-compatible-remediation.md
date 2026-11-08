---
id: "003"
slug: current-lock-security-remediation
plan: 1
plan_slug: compatible-remediation
level: plan
title: Compatible dependency remediation and residual evidence
parent_spec: docs/specs/003-current-lock-security-remediation.md
depends_on: []
status: pending
---

# 003/1: Compatible dependency remediation and residual evidence

> Part 1 of 1. Parent: [full spec](../../specs/003-current-lock-security-remediation.md).
> Implementation updates this link to `.md.done` when the parent lifecycle transition lands.

## Summary

Reduce dependency exposure through ordinary upstream updates within the existing parent
ranges. Re-audit current `dev`, update release-tool npm to 11.21.2 and the Google
authentication chain to google-auth-library 10.9.1 / gaxios 7.3.1, then qualify the
installed graph. These are the spec's targets, subject to fresh implementation-time evidence.
The npm installation tool remains 10.9.2; release-tool npm is a separate dependency.

Deliver measured removal of the five bundled undici findings and bundled ip-address finding,
and removal of the Google authentication rimraf/glob path. Glob and minimatch remain
explicitly unresolved for owner decision, including direct runtime minimatch exposure.
Passing this plan establishes compatible exposure reduction; it grants no risk acceptance
or release permission. No later plan in this spec performs a major migration.

**Components delivered / exclusive file ownership:**

- `package-lock.json`: narrowly selected transitive updates and required graph changes.
- This plan's Evidence and Progress sections: baseline, candidate, residual and gate results.
- This execution plan: own its `.md` → `.md.wip` → `.md.done` lifecycle, ending at
  `docs/plans/003-current-lock-security-remediation/1-compatible-remediation.md.done`
  with frontmatter `status: done` in the implementation's reviewed candidate.
- `docs/specs/003-current-lock-security-remediation.md` →
  `docs/specs/003-current-lock-security-remediation.md.done`: since this is the only plan,
  own the parent completion rename and `status: draft` → `status: done`, with no other
  parent-spec text change. The pinned commit below remains the historical source reference.
- `docs/plans/003-current-lock-security-remediation/_coverage.md`: update lifecycle links
  and coverage disposition for the completed candidate, retaining any CI-only deferral.
- `changelog.d/wat-392-compatible-remediation.md`: one measured implementation fragment.
- No manifest or source change is expected: `@google/genai` already permits
  google-auth-library `^10.3.0`; `@semantic-release/npm` already permits npm `^11.6.2`.
  google-auth-library 10.9.1 permits gaxios `^7.1.4`. Verify these edges afresh.

**Shared surfaces:** none within this one-plan set. Independent changelog filenames do not
conflict. Keep the landed specification fragment and planning fragment unchanged; an unmerged
implementation fix round edits its existing implementation fragment instead of adding another.

**Deferred:** no work to a later plan. Residual glob/minimatch decisions require the owner
outside this assignment. Keep the temperature work separate.

## Spec ACs satisfied by this plan

- Spec AC #1 — **full**: valid fresh advisory JSON, deduplicated inventory and parent exposure.
- Spec AC #2 — **full**: installed compatible targets, six findings absent, Google path removed,
  and explicit assessment of any newly reported advisory.
- Spec AC #3 — **full**: all residual paths and incompatible upstream boundaries are recorded,
  unresolved and without suppression or acceptance.
- Spec AC #4 — **full**: six sequential local tiers, unchanged assertions and exact-head CI.
- Spec AC #5 — **full**: behavior, policy and gate preservation; dependency/evidence-only diff.

Required approval and repository merge governance remain in the operator handoff below,
outside per-plan criteria. This does not waive the parent spec's required approval.

## Depends On

None. Start from current `dev` containing the pinned parent spec. Read its bytes at commit
`431bf3414f4fa251af41b6e2e538b4fbcea4378a`; expected blob
`ff3239eb588892df0e8945e453500632ed326059`, SHA-256
`22222adf72a2fec203bd9f858364b3af805b705f2c6c939b0e44dfcbd9af872e`.
If current dependency ranges or advisory evidence no longer support these targets, stop for
plan reassessment rather than selecting a major update or weakening a gate.

## Detailed Task List (TDD)

This is a dependency/evidence change, with no new application behavior or functions.
Use command-driven acceptance checks before changing the lock, followed by the same checks
after installation. Keep raw command output and any one-shot assertions in an ignored
`.watershed/.cache/003-remediation/` directory; commit conclusions in this plan, not scratch
tools. Do not add permanent tests that merely pin the current package versions.

### 1. Establish the baseline and executable red checks

**Tests first — acceptance checks against the unchanged current-dev lock:**

1. `audit-json-valid`: run `npm audit --package-lock-only --json --ignore-scripts`, capture
   stdout, stderr and exit status separately, and parse stdout as JSON. Require a supported
   audit schema, a vulnerability map and advisory data, and no registry/error object.
   Exit 1 with valid findings is a completed audit, not a clean result. Malformed JSON,
   HTTP/network failure or an unsupported schema blocks all conclusions. Expected red for
   remediation is in checks 2–4 below; validity itself should pass before and after.
2. `bundled-undici-advisories-absent`: deduplicate advisory objects by GHSA URL/identifier,
   following propagated parent entries back to advisory objects. Assert absence of
   `GHSA-4qv8-2p9j-2685`, `GHSA-xjj6-f33q-929c`, `GHSA-2m5v-pch6-74hx`,
   `GHSA-qrxm-fqhp-jwvm` and `GHSA-9fm3-97px-rjf6` in the candidate inventory.
   Expected red on the spec's baseline: each identifier remains present through bundled
   undici 6.29.0. Report each separately, not as one aggregate count assertion.
3. `bundled-ip-address-advisory-absent`: assert `GHSA-rxp7-6hxx-x8q5` is absent.
   Expected red: the baseline still reports bundled ip-address 10.7.2.
4. `google-auth-cleanup-path-removed`: traverse actual dependency edges rooted at
   `@google/genai` through google-auth-library and gaxios; require no reachable rimraf/glob
   on that authentication path. Expected red: baseline gaxios 7.1.3 reaches rimraf 5.0.10
   and glob 10.5.0. A top-level search for glob is insufficient; other paths must remain visible.

**Implementation — baseline evidence in this plan:**

- Record current base SHA, Node/npm versions, lock SHA-256 and audit timestamp. Do not reuse
  the spec's 44-entry count as a fresh measurement. If any red check already passes, record
  why from the actual graph; do not manufacture a failing test or reintroduce a vulnerable version.
- Build an inventory with GHSA, severity, affected version and installed path, parent edges,
  exposure category, and proposed outcome. Separate unique advisories from propagated package
  entries. Use every row of the parent spec's Requirements inventory as a reconciliation key;
  enumerate and assess any added, changed or withdrawn finding.
- Trace parents using lock edges and `npm explain` / `npm ls --all --json`, including CLI →
  llmist, root/workspace rimraf, private docs TypeDoc/plugins and semantic-release →
  @semantic-release/npm → bundled npm. Do not classify shipped runtime solely by `dev` flags
  or claim safety from a production-only audit. Explain unexpected tree errors before proceeding.

### 2. Apply compatible updates and prove the installed graph

**Tests first:** retain checks 1–4 unchanged; establish the expected target versions and
parent ranges from the pinned spec and fresh registry metadata before editing the lock.
Inspect the baseline npm artifact's bundled packages to validate that bundle inspection
reaches the nested copies rather than top-level undici or ip-address.

**Implementation — `package-lock.json`:**

- Keep the process's npm at 10.9.2, engine-strict enabled and lifecycle scripts enabled for
  final installation. Use the worker's compatible Node per `CONTRIBUTING.md`; retain Node
  >=22.0.0 consumer policy and `.nvmrc` 22. Record `command -v npm` and `npm --version`:
  `node_modules/.bin/npm` belongs to release tooling and must not become the installation tool.
- Use npm 10.9.2's ordinary targeted `npm update npm google-auth-library gaxios
  --package-lock-only --ignore-scripts --engine-strict`. Inspect the result before accepting it:
  require npm 11.21.2, google-auth-library 10.9.1 and gaxios 7.3.1 within the actual parent
  ranges. The command is not permission to accept a newer target or unrelated churn. If
  registry drift prevents that result with ordinary range-respecting resolution, stop.
- Do not add direct dependencies merely to pin transitives. Do not update the Google SDK,
  semantic-release, direct minimatch, rimraf or TypeDoc as an unrelated cleanup. Required
  transitive changes may follow the targeted parents; explain each changed subtree.
- Run `npm ci --engine-strict --ignore-scripts=false` from the candidate lock. Invoke
  `node_modules/.bin/lefthook install` directly and verify executable pre-commit, commit-msg
  and pre-push hooks invoke Lefthook. The prepare wrapper's success alone is insufficient.
  Verify postinstall's expected data symlink and no lifecycle failure hidden by its wrapper.
- Inspect `node_modules/npm/package.json` and its actual nested package artifacts. Require
  bundled undici 6.29.1 and ip-address 10.7.5; report glob/minimatch bundle contents as well.
  Do not infer a bundled update from a top-level dependency. Record versions and integrity
  provenance from the candidate lock/artifact, then re-run checks 1–4 against the installed
  candidate plus its unchanged lock. A valid finding-bearing audit may still exit 1.
- Compare baseline and candidate inventories by advisory identity and path. Require the
  six specified advisory removals and no Google authentication cleanup path. Explicitly
  assess every new finding; stop if it needs an owner decision outside compatible remediation.

### 3. Verify residual paths before documenting the outcome

**Tests first — acceptance check `residual-inventory-complete`:** reconcile every remaining
audit node with actual parent chains and the baseline inventory. Expected red if the report
omits a residual path, categorizes docs as shipped runtime solely from flags, or describes a
residual advisory as accepted. Audit totals alone cannot satisfy this check.

**Implementation — this plan's Evidence section and implementation changelog:**

- Enumerate `GHSA-3g3m-2fjr-6pw4` (glob) and `GHSA-g3hv-75wg-m249` (minimatch)
  separately. Include direct llmist skill filtering and inherited CLI runtime minimatch;
  rimraf 5 cleanup in root/workspaces; private documentation TypeDoc and plugin paths;
  release-tool npm's bundled glob/minimatch. Show the removed Google authentication path
  separately from the remaining paths.
- Recheck upstream boundaries: fixed glob starts at 14.0.2, outside rimraf 5/npm's examined
  glob ranges; fixed minimatch starts at 11.0.1, outside direct `^9.0.9` and examined docs/npm
  ranges. Verify parent artifacts/metadata afresh rather than interpreting `fixAvailable`
  as authorization for a downgrade or major migration.
- Label both residual advisories **unresolved — owner decision required**. Direct runtime
  minimatch remains a potential denial-of-service surface for pathological patterns.
  Installed reachability establishes neither practical exploitability nor safety.
- Add one implementation changelog fragment reporting only measured compatible reductions
  and the unresolved residuals. This plan owns fresh implementation evidence and changed
  audit conclusions. Preserve all parent-spec text except task 4's completion status change
  and rename. No global documentation edit.

### 4. Prepare the implementation completion transitions

**Tests first — candidate lifecycle acceptance checks:**

- `completed-candidate-lifecycle`: require this plan and the sole parent spec at their
  `.md.done` paths with `status: done`, and no pending/`.wip` copies of those files.
  Expected red on the planning candidate: this plan is `.md` / `pending` and the parent
  is `.md` / `draft`; neither completed path exists.
- `parent-spec-text-preserved`: compare the completed parent against the historical pinned
  blob after changing exactly its one frontmatter `status: draft` line to `status: done`.
  Require byte equality for all other text. Expected red before completion: the completed
  file is absent; any additional parent edit must also fail this comparison.
- `progress-ready`: require each Progress AC checked from observed evidence, except AC #6
  may use the exact CI-only deferral below. Missing dispositions or any non-CI deferral fail.
  Run the supplied `check_plan_done.py` with `--expect-status done` on the completed plan;
  additionally enforce this plan's narrower rule that only AC #6 may be deferred.
  Expected red on the planning candidate: status is pending and all seven ACs are unchecked.

**Implementation — lifecycle files owned above:**

- Keep this planning PR pending and the parent spec untouched. These transitions belong to
  the implementation candidate, before publication and the review of that candidate.
- Prepare the plan's `.md.wip` → `.md.done` rename and `status: done`, then rename the
  sole parent spec to `.md.done` and set only its frontmatter status to `done`. Retain the
  pinned commit/hash as provenance; do not rewrite the parent inventory or any other text.
- Update this plan's parent link and the coverage map's plan/parent links to `.md.done`.
  Record local evidence and lifecycle results in this plan; check AC #7 after inspecting
  both completed artifacts and the byte-preserving parent comparison.
- Before sealing the implementation commit, require AC #1–5 and #7 checked from evidence.
  If exact-head CI cannot yet be observed, replace only the AC #6 Progress line with:

  ```markdown
  - [ ] AC #6 — deferred: CI-only to lint-and-test, validate-commits, e2e-tests; satisfied only by all three jobs succeeding at the final reviewed head.
  ```

  This is the only allowed deferral, not a waiver or a claim that pending jobs have passed.
  It permits the completed plan/spec forms in the candidate while exact-head CI is pending.
  A red or missing job still blocks merge. Do not use governance state as a deferral.
- Task 5 qualifies this completed candidate and supplies the remaining local evidence.
  Commit the lifecycle edits with the candidate, after those local checks and review pass;
  do not require a later publication, CI-evidence or approval-evidence commit.

### 5. Run the preserved gates and hand off exact-head CI

**Tests first:** retain all existing assertions. Relevant existing unit checks include
`packages/llmist/src/providers/gemini.test.ts` ("maps messages with system instructions and
role conversion", "counts tokens for simple messages") and
`packages/llmist/src/skills/registry.test.ts` ("finds skills matching file path patterns",
"returns empty array when no patterns match"). Existing mocked E2E includes
`packages/llmist/src/e2e/providers.e2e.test.ts` ("streams response with Gemini Pro model",
"handles multi-turn conversations"). They are regression checks expected to stay green,
not evidence of vulnerability removal or live Google authentication coverage.

**Implementation — verification and delivery evidence:**

- Finish task 4's candidate edits and stage intended files before final checks. Keep live
  research opt-in unset (`RUN_LIVE_RESEARCH_TESTS`); do not supply provider credentials or
  run paid/exploit tests.
- Run these sequentially, stopping on failure: `npm run build`, `npm run typecheck`,
  `npm run lint`, `npm test`, `npm run test:coverage`, `npm run test:e2e`. Record exit status,
  test counts, skipped live suites and relevant warnings. Confirm a suspected baseline failure
  once on unchanged `origin/dev`; report test names, timings and failure mode, then stop.
- Review the full delta with `agent-plugins__z:local-review` in gate mode. Verify public
  behavior, stored shapes, Node/npm policy, Lefthook, commitlint, Biome and mocked tiers remain
  intact; only authorized dependency changes and their evidence are present. No removed or
  weakened test assertion, override, resolution, vendor patch, suppression, ignore list,
  downgrade, exception or waiver is allowed. Fix blockers; never silently defer one.
- Commit with normal hooks and Conventional Commits. Use only `Related to WAT-392` for an
  issue reference in commit messages and PR text. Deliver through the declared hook lane into
  `dev`; do not push, publish packages, create a release PR, promote to `main`, or auto-merge.
- Hand off the completed candidate with either observed AC #6 success or task 4's explicit
  CI-only Progress deferral to `lint-and-test`, `validate-commits` and `e2e-tests`.
  After publication, read GitHub check runs for the final reviewed head: all three named
  jobs must actually succeed at that head to satisfy the deferral. A missing, stale, pending
  or failed run does not satisfy it. Local success is no substitute for these CI results.
  Keep final check results in GitHub's head-specific records; no post-publication
  evidence-only commit or checkbox update is required to satisfy the CI-only deferral.

## Operator governance handoff (outside plan criteria)

The existing owner decision assigns approval, required-review counts, strict up-to-date
ruleset enforcement and merge authority to the operator. They remain required repository
governance, separate from per-plan ACs, Progress and CI-only deferrals. A local-review COMMENT
does not supply an approving review. The operator checks these requirements before merge
without requesting a post-publication plan-evidence commit. No rule or approval is waived.

## Test Plan

| Check | Tier / source | Required result |
|---|---|---|
| `audit-json-valid` | Registry acceptance; task 1 | Valid baseline and candidate advisory JSON; errors block conclusions |
| `bundled-undici-advisories-absent` | Audit plus installed bundle; tasks 1–2 | Five independent GHSA removals |
| `bundled-ip-address-advisory-absent` | Audit plus installed bundle; tasks 1–2 | Specified GHSA absent |
| `google-auth-cleanup-path-removed` | Installed dependency traversal; tasks 1–2 | Authentication subtree has no rimraf/glob |
| `residual-inventory-complete` | Audit/lock/parent reconciliation; task 3 | Every residual path listed, no acceptance |
| Completed lifecycle and parent text | Candidate acceptance; task 4 | Both `.md.done` / `status: done`; parent otherwise byte-identical |
| Progress dispositions | Done-gate plus CI-only restriction; task 4 | AC #1–5 and #7 checked; only AC #6 can defer to all three named jobs |
| Existing provider/skill suites | Unit; task 5 | Existing assertions remain green |
| Existing workspace build/type/lint/unit/coverage/mocked E2E | Six sequential commands; task 5 | Every command succeeds |
| Exact-head CI | External jobs; task 5 | All three named jobs succeed at the final reviewed head; satisfies AC #6's CI-only deferral |

## Manual Verification

AC #3 and #5 below include evidence review that cannot be truthfully
replaced by a unit test. Run these protocols, record observed outcomes under Evidence, and
leave their boxes unchecked until their full protocols pass:

- **AC #3 [manual], residual interpretation:** inspect each fresh audit advisory and every
  associated lock/installed node against the task 3 path inventory and registry parent ranges.
  Expect each residual path accounted for, both named advisories unresolved, no unassessed new
  finding, and no acceptance or exploitability claim. Record GHSA/path/range rows and date.
- **AC #5 [manual], delta review:** inspect the full base-to-candidate diff and local-review
  report. Expect only authorized lock/evidence/changelog and normal plan lifecycle edits,
  unchanged manifests/source/tests/tool policies, and no forbidden mechanisms or weakened gates.
  Record changed-file disposition and gate result. An unexplained change blocks completion.

AC #6 is automated CI, not manual verification. It follows the named-job CI-only Progress
deferral in task 4 and the exact-head comparison in task 5. Its final result is recorded by
GitHub, without a required follow-up commit. Governance remains in the separate handoff.

## Acceptance Criteria (per-plan, testable)

1. Fresh baseline/candidate audits are valid, deduplicated, linked to parents and exposure,
   with new findings assessed and errors blocking conclusions (spec AC #1, #2).
2. Engine-strict installation from the candidate lock has the specified compatible targets,
   six advisory removals and no Google authentication rimraf/glob path, verified from installed
   artifacts as well as the lock (spec AC #2).
3. [manual] The complete residual inventory and incompatible boundaries remain explicit and
   unresolved for owner decision; evidence and measured implementation changelog are current
   (spec AC #3 and Documentation Impact).
4. All six local verification commands pass sequentially with existing assertions intact,
   without exploit execution, paid tests or publication (spec AC #4).
5. [manual] The delta and local-review gate preserve public behavior, shapes and all specified
   tools/policies, and contain only authorized dependency/evidence work with no forbidden
   mechanism (spec AC #5).
6. `lint-and-test`, `validate-commits` and `e2e-tests` actually succeed at the final reviewed
   head (spec AC #4). Progress may explicitly defer this criterion only to those three CI jobs;
   only their success at that exact head satisfies the deferral. No subsequent evidence-only
   commit is required.
7. This plan and its sole parent spec are `.md.done` with frontmatter `status: done` in the
   implementation's reviewed candidate. Only the parent's status line changes beyond its rename;
   lifecycle links are updated, and all Progress criteria are checked or carry the permitted
   named-job CI-only deferral (spec AC #5 and Documentation Impact).

## Documentation Impact

| File | Change |
|---|---|
| This plan, Evidence and Progress | Fresh audit/graph/residual/local-gate evidence; completed `.md.done` / `status: done` form and explicit named-job CI-only deferral when needed |
| `_coverage.md` | Update completed plan/parent links and lifecycle disposition; distinguish exact-head CI from operator governance |
| `changelog.d/wat-392-compatible-remediation.md` | One fragment for measured implementation outcome, preserving explicit unresolved residuals |
| `docs/specs/003-current-lock-security-remediation.md` → `.md.done` | Implementation owns completion rename and `status: draft` → `status: done` only; preserve all other pinned-source text and retain its historical provenance |
| README, CLAUDE.md, global guidance | No change required; this maintenance work introduces no cross-cutting policy or public API |

## Out of Scope

- Major migrations, npm 12, direct minimatch 11/rimraf 6 migration, provider/SDK feature changes.
- Forced overrides/resolutions, vendor patches, suppressions, ignore lists, downgrades,
  new exceptions, risk acceptance or waivers, including historical acceptance reused as authority.
- Temperature work, exploit research, paid provider tests, release execution or publication.
- Release PRs, `main` promotion, governance/ruleset/identity changes, automatic merge.

## Evidence

Pending implementation. The parent spec's audit and scratch experiment are reference evidence,
not proof that this plan is executed. Record fresh results here: base/lock/tool identities,
timestamp and valid audit statuses; unique advisory and affected-entry totals separately;
GHSA/version/path/exposure/disposition rows; installed bundle and Google subtree results;
all residual boundaries; local verification results; local-review outcome; lifecycle checks
and the permitted named-job CI-only handoff. Record these before publication in the completed
plan. Final exact-head CI results stay in GitHub's job records and satisfy the explicit
deferral there; no post-publication evidence-only commit is required. Governance evidence
belongs to the operator handoff, not this plan's criteria. Raw scratch paths are not reviewer evidence.

## Progress

<!-- /implement updates these from observed evidence, never from the planning run. -->
Implementation checks AC #1–5 and #7 from evidence before sealing its completed candidate.
For AC #6 only, it may substitute task 4's explicit CI-only deferral line. All lines remain
unchecked and undeferred in this planning PR; none of the implementation work has run here.

- [ ] AC #1 — fresh valid audit inventories
- [ ] AC #2 — installed compatible remediation
- [ ] AC #3 — residual evidence and changelog
- [ ] AC #4 — six sequential local tiers
- [ ] AC #5 — preserved scope/policies and review gate
- [ ] AC #6 — exact-head lint-and-test, validate-commits and e2e-tests
- [ ] AC #7 — completed plan/spec lifecycle and preserved parent text
