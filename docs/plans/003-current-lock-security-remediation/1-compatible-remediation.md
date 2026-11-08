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
  and the unresolved residuals. Keep this pinned spec unchanged; this plan owns fresh
  implementation evidence and any changed audit conclusions. No global documentation edit.

### 4. Run the preserved gates and capture exact-head evidence

**Tests first:** retain all existing assertions. Relevant existing unit checks include
`packages/llmist/src/providers/gemini.test.ts` ("maps messages with system instructions and
role conversion", "counts tokens for simple messages") and
`packages/llmist/src/skills/registry.test.ts` ("finds skills matching file path patterns",
"returns empty array when no patterns match"). Existing mocked E2E includes
`packages/llmist/src/e2e/providers.e2e.test.ts` ("streams response with Gemini Pro model",
"handles multi-turn conversations"). They are regression checks expected to stay green,
not evidence of vulnerability removal or live Google authentication coverage.

**Implementation — verification and delivery evidence:**

- Finish edits and stage intended files before final checks. Keep live research opt-in unset
  (`RUN_LIVE_RESEARCH_TESTS`); do not supply provider credentials or run paid/exploit tests.
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
- After publication, the operator must obtain actual successful `lint-and-test`,
  `validate-commits` and `e2e-tests` at the exact reviewed head plus the required legitimate
  independent approval and up-to-date checks. Record check links, head identity and review
  disposition in this plan's evidence. A local review COMMENT does not supply the approval.
  If publication/checks cannot be observed in-session, hand off the committed candidate with
  these gates pending; do not mark this plan's exact-head criterion or the spec done.

## Test Plan

| Check | Tier / source | Required result |
|---|---|---|
| `audit-json-valid` | Registry acceptance; task 1 | Valid baseline and candidate advisory JSON; errors block conclusions |
| `bundled-undici-advisories-absent` | Audit plus installed bundle; tasks 1–2 | Five independent GHSA removals |
| `bundled-ip-address-advisory-absent` | Audit plus installed bundle; tasks 1–2 | Specified GHSA absent |
| `google-auth-cleanup-path-removed` | Installed dependency traversal; tasks 1–2 | Authentication subtree has no rimraf/glob |
| `residual-inventory-complete` | Audit/lock/parent reconciliation; task 3 | Every residual path listed, no acceptance |
| Existing provider/skill suites | Unit; task 4 | Existing assertions remain green |
| Existing workspace build/type/lint/unit/coverage/mocked E2E | Six sequential commands; task 4 | Every command succeeds |
| Exact-head CI and review | External gates; task 4 | All three named checks and legitimate approval |

## Manual Verification

AC #3, #5 and #6 below include evidence review or external state that cannot be truthfully
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
- **AC #6 [manual], external checks:** read check runs and approval for the published candidate
  using GitHub MCP. Compare check head and reviewed head with the candidate identity. Expect
  all three named checks successful, required approval and strict up-to-date checks. Record
  check/review links and identities. Missing, stale or pending results leave AC #6 pending;
  do not loop new evidence-only commits that invalidate the very head being checked.

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
6. [manual] Actual successful exact-reviewed-head CI checks, legitimate approval and strict
   up-to-date checks are recorded before completion/merge (spec AC #4).

## Documentation Impact

| File | Change |
|---|---|
| This plan, Evidence and Progress | Fresh baseline/candidate inventory, bundled targets, residual conclusions, local gates and external check/review evidence |
| `changelog.d/wat-392-compatible-remediation.md` | One fragment for measured implementation outcome, preserving explicit unresolved residuals |
| Parent spec | Preserve the pinned source; reference its inventory/decisions and keep changed measurements in this downstream plan |
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
all residual boundaries; local verification results; local-review outcome; external CI and
approval evidence or explicit pending hand-off. Raw scratch paths are not reviewer evidence.

## Progress

<!-- /implement updates these from observed evidence, never from the planning run. -->
- [ ] AC #1 — fresh valid audit inventories
- [ ] AC #2 — installed compatible remediation
- [ ] AC #3 — residual evidence and changelog
- [ ] AC #4 — six sequential local tiers
- [ ] AC #5 — preserved scope/policies and review gate
- [ ] AC #6 — exact-head CI and required approval
