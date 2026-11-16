# Coverage map for spec 008-self-hosted-github-actions

Parent: [completed-form full spec](../../specs/008-self-hosted-github-actions.md.done).
Execution: [completed-form runner-routing plan](1-runner-routing.md.done).

Related to WAT-763.

## Spec ACs

| # | Spec AC (short) | Satisfied by | Coverage / current status |
|---|---|---|---|
| 1 | All six routes; preserve contracts with the Release environment exception | Plan 1 tasks 1–3, per-plan AC #2 | Structural acceptance passes; contracts preserved |
| 2 | Node 22 and npm 10.9.2 independently in every job | Plan 1 tasks 1–3, per-plan AC #3 | Static checks pass; actual exact-head CI install/version/action logs deferred to manager before merge; no Release/Claude execution claim |
| 3 | Applied fresh-job containers on all pools and prepared restricted release environment | Plan 1 task 1, M1/M2, per-plan AC #1 | Both pre-start gates satisfied by supplied Root/owner evidence; sources and limits in plan |
| 4 | Existing merge delegation, independent review, exact-head CI on llmist-ci and post-merge dev success | Plan 1 tasks 4–5, per-plan AC #4 | Deferred: manager verifies exact-head GitHub checks/review before merge and records post-merge dev run/runner metadata afterward; approval and strict checks remain unchanged |
| 5 | Accurate default-branch/main/dispatch activation reporting | Plan 1 task 5, M3, per-plan AC #5 | Source/ref comparison and activation report recorded |
| 6 | Per-job registration versus execution proof and Claude credential gap | Plan 1 task 5, M3, per-plan AC #5 | Release/sync-dev/Claude configured and registered; execution not proven; Claude authentication unqualified |
| 7 | Report owner removal as confirmed or pending, preserving ordering and conditional CI retention | Plan 1 task 5, M4, per-plan AC #7 | Accurate pending report recorded; actual removal status deferred to dated owner names-only post-merge report |

## Coverage summary

- Seven spec ACs map to one plan. All have full ownership; none depends on another
  implementation plan or has an unassigned verification path. Coverage means the
  plan owns the work, not that deferred external outcomes have passed.
- Requirements 1–3 map to spec AC #1; requirement 4 maps to #2, requirement 5 to #3,
  requirement 6 to #5, requirement 7 to #4 and requirement 8 to #6. The owner secret
  ordering in requirement 3 also maps to #7. All constraints and strategic decisions
  carry into the plan's prerequisites, allowed delta, proof limits and exclusions.
- Per-plan AC #6 is local verification/documentation hygiene. Every other per-plan
  criterion traces directly to the spec; no criterion is orphaned.
- Both pre-start gates pass on the implementation brief's Root/owner evidence.
  Plan Evidence records identities, actor/time/source and proof limits separately
  from the old persistent-container observations. Only the authorized workflow
  selectors, tools and two Release environment values change.
- The implementation assignment requires completed-form plan/spec files at the PR
  head with named deferrals. Publication-dependent checks/review and post-merge
  evidence remain manager gates; lifecycle status does not assert their success.

## Plan dependency graph

```text
External: fresh-per-job containers + prepared release environment
                              |
                              v
                       1-runner-routing
```

Topological order: `1-runner-routing.md.done`. Frontmatter `depends_on: []` has no cycle
or missing plan reference. Maximum concurrency is one; no same-layer ownership
conflicts or shared append surfaces exist.

## Planning decisions and trade-offs

The headless planning assignment uses the autonomous operating mode. The following
recommended equivalent choices are recorded in place of interactive sign-off.
They change neither the supplied full-spec identity nor the owner's controls.

| Decision | Choice and reason |
|---|---|
| Shape, slug and size | One medium-risk `runner-routing` plan, five tasks; the six-job, three-file routing/tool/environment migration is one bounded configuration concern |
| Boundary | Gate all implementation on both external prerequisites, then deliver all six routes together; splitting by pool offers file-disjoint editing but permits partial activation and duplicates evidence/review cycles |
| Cost | One review includes CI, Release and Claude YAML; this avoids intermediate rollout states and keeps the authorized preservation exception visible |
| Tests | Seven structural check families plus command/live acceptance protocols; use existing locked YAML parsing and Node assertions in ignored scratch, with baseline-red targets and in-memory mutation proofs for preservation |
| Tool steps | Preserve four existing Node setups; add Node to sync-dev/Claude, bootstrap/check npm in every job; no new cache on the two jobs without dependency installation |
| Docs | This plan owns detailed evidence, one later operational fragment and the implementation PR description; no shared developer-guidance or public API edits |
| Lifecycle | Implementation assignment requires completed-form files at PR head; external outcomes remain explicitly deferred to manager's exact-head/post-merge records and the owner's report; accurate pending owner-action reporting passes without deletion |
| Scope | Preserve the full spec's governance and credential limits; record the Claude gap and fresh-container proof limits without repair or broader isolation claims |

The full spec is retained as assigned. Although the YAML delta is small, the
prerequisites, activation semantics and external evidence justify a full execution
plan; this delivery does not convert it to a light spec.

## Test ownership

All checks belong to plan 1; no missing proof is assigned downstream.

| Check | Task / verification surface |
|---|---|
| `readiness-all-pools`, `release-environment-ready` | Task 1, M1/M2, external Root/owner names-only records |
| YAML parse validity and preservation with six mutation checks | Task 1, real workflow YAML and in-memory copies |
| Three CI selectors | Task 2, `.github/workflows/ci.yml` |
| Two Release selectors and two environment values | Task 3, `.github/workflows/release.yml` |
| Claude selector | Task 3, `.github/workflows/claude.yml` |
| Six independent Node/npm bootstrap/order rows | Tasks 2–3, all three workflow files |
| Fresh-worker tool/action capability | Task 1, Root inspection; actual CI logs in task 4; unexecuted action limits retained |
| Six local tiers and independent local gate | Task 4, existing mocked suites and project commands |
| Three exact-head feature-PR checks, runner metadata and review | Task 4, real GitHub records |
| Post-merge dev push and expected skipped commit validation | Task 5, real GitHub records |
| Activation/ref and registration/execution reporting | Task 5, M3, source and actual event/job records |
| Confirmed-or-pending owner removal reporting, ordering and conditional retention | Task 5, M4, owner-managed names-only inventories when available |

No permanent product tests, new dependency or weaker gate is planned. All changed
workflow behavior has a command-driven or explicitly manual acceptance protocol.
No provider credential or release dispatch is needed for local validation.

## Documentation impact distribution

| Spec impact | Owner and disposition |
|---|---|
| Routing contract, prerequisites, activation and proof limits | Plan 1 carries the parent by reference and expands its concrete execution/evidence protocols; parent requirements remain unchanged |
| Later delivery description distinguishes exact-head/post-merge and non-CI evidence | Plan 1 tasks 4–5; separate sections/state in the implementation delivery body, with detailed proof in plan Evidence |
| Operational implementation changelog | Plan 1 owns `changelog.d/wat-763-self-hosted-github-actions.md`; previously landed Spec/Plan fragments remain intact |
| No public API or general developer-guidance change | No edits to public docs, README, CONTRIBUTING.md or CLAUDE.md |
| Completion lifecycle | Plan 1 updates its evidence and coverage conclusions; parent changes only status/extension. The assignment authorizes completed-form files with named external deferrals in plan Progress |

## Scope carried forward

Only future workflow selectors, explicit per-job tools and the two Release job
environment values change. Infrastructure and environment/secret administration
belong to Root/Zbigniew outside the PR. No broader settings/governance changes,
billing changes, missing OAuth provisioning, Dependabot runner configuration,
release dispatch, package publication, main promotion, paid provider calls,
dependency upgrades or unrelated failures are included.

## Planning verification

- [x] All seven spec ACs and eight numbered requirements have an owner and protocol.
- [x] The dependency graph is acyclic; both external pre-start gates are explicit.
- [x] Every required test/evidence path is assigned, including failure sensitivity.
- [x] Every high-level documentation impact has a per-file/surface disposition.
- [x] Every per-plan AC traces to spec outcomes or local verification/doc hygiene.
- [x] One execution plan owns the complete change; no later plan supplies missing work.
- [x] The plan contains source identity, file ownership, tasks, expected reds,
  verification protocols, proof limits, criteria, exclusions and pending progress.
