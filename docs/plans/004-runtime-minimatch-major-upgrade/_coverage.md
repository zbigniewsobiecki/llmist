# Coverage map for spec 004-runtime-minimatch-major-upgrade

Related to WAT-558

Parent: [full spec](../../specs/004-runtime-minimatch-major-upgrade.md.done), merged at
`c392dcd711b1ed399f2da9cba3532d5864785df4`; SHA-256
`ea79004167e50940b33aa4479b3756920fd7f3046ca008f5e128b9a953b5090c`.

## Spec ACs

| # | Spec AC (short) | Satisfied by | Coverage / verification |
|---|---|---|---|
| 1 | Direct `^11`, resolution >=11.0.1, reproducible engine-strict installation, explained lock changes | [Plan 1](1-runtime-upgrade.md.done), tasks 1 and 3; plan AC #1 | Full; installed edge resolution, selected artifact metadata, lock review and install |
| 2 | Valid fresh audit and parent chains show named GHSA absent from shipped library/CLI runtime; errors block conclusions | Plan 1, tasks 1 and 4; AC #4 | Full; `audit-json-valid`, `runtime-advisory-absent` and evidence protocol |
| 3 | Residual development/docs/release-tool versions and chains remain upstream-only without zero-finding or exception claims | Plan 1, task 4; AC #4 and #7 | Full; `residual-inventory-complete`, advisory/path reconciliation and measured changelog |
| 4 | Preserve file selection and existing tests, including absent/empty and model-disabled skills and relevant major edges | Plan 1, task 2; AC #2 | Full; fourteen named matrix rows, real registry/matcher, baseline and candidate runs |
| 5 | Supported library modules and inherited CLI skill workflows stay usable without migration | Plan 1, task 3; AC #3 | Full; built ESM/CommonJS child processes and CLI discovery/list/info |
| 6 | Six sequential local tiers, three successful exact-head checks, then independent review | Plan 1, task 5; AC #5, #7 and #8 | Full; local commands/gate plus head-specific GitHub CI and review records |

## Coverage summary

- The sole implementation plan qualifies minimatch 11.0.7 with the authorized license
  transition, original matching matrix and two explicit owner-approved matching changes.
  Both newly accepted selections have baseline-red/candidate-green registry regressions.
  The [plan evidence](1-runtime-upgrade.md.done#evidence) records both owner decisions;
  every other preservation expectation remains mandatory, with no production-code change.
- Runtime traversal removes the named advisory from llmist and inherited CLI paths.
  The same two advisory identities remain on 42 affected cleanup, private-docs and
  release-tool nodes, all enumerated with installed parent ranges and upstream-only status.
- Final local verification, review and lifecycle results are recorded in the plan's Progress.
  Exact-head `lint-and-test`, `validate-commits` and `e2e-tests`, then independent review,
  remain an explicit CI-only handoff; this coverage map does not claim external success.
- All six numbered Requirements map respectively to the same six spec ACs above. Constraints
  and strategic decisions carry into plan tasks, scope, documentation and governance handoff.
- AC #6 in the plan is lifecycle/documentation hygiene. All other per-plan criteria cite
  spec outcomes, constraints or documentation; none is orphaned.

## Plan dependency graph

```text
1-runtime-upgrade
```

Topological order: `1-runtime-upgrade.md.done`. Frontmatter `depends_on: []` has no missing
references or cycle. Maximum concurrency: one. No same-layer plans share source files.

## Planning decisions and trade-offs

Autonomous planning follows the supplied assignment. These are equivalent execution choices,
not new public contracts or owner risk decisions.

| Choice | Decision and reason |
|---|---|
| Shape, slug and size | One medium-risk `runtime-upgrade` plan, five tasks, fourteen registry matrix rows plus three built-consumer scenarios and command acceptance checks. All concern qualification of one direct major transition. |
| Boundary | Characterization comes before the manifest edit; compatibility, lock and advisory evidence land together. Splitting introduces an incompletely qualified upgrade or repeated full audit/gate cycles without useful file-disjoint concurrency. |
| Cost | One reviewer must examine the dependency delta alongside its compatibility and exposure evidence. This avoids intermediate shipped states lacking those proofs. |
| Target selection | Preserve exact range `^11` and floor 11.0.1; actual ordinary upstream resolution is recorded during execution. Cached 11.0.1 engine metadata supports Node-major compatibility only. Full artifact/license/exports and installed consumer checks remain blocking prerequisites. |
| TDD | Command-driven target/advisory checks are red on the baseline. Behavior-preservation tests are expected green; reverted mutation checks verify assertion sensitivity. No fabricated regression or exploit is required. |
| Documentation | Candidate evidence stays in this plan, one measured implementation fragment and normal completion links/status. Parent content and historical 003 evidence remain preserved. No README/global guidance changes. |
| CI and governance | Reuse the existing narrow CI-only handoff from plan 003 for external named-job results. It cannot excuse local failure or waive a check. Required approval/review identity/up-to-date governance remain the operator's responsibility outside plan criteria. |

The merged full spec remains the authoritative input; its structure and separate-stage
decision are retained. A future small dependency follow-up may suit a light spec, but this
assignment does not rewrite the supplied full spec or omit its planning stage.

## Test ownership

All tests/checks belong to plan 1; there is no downstream owner for a missing proof.

| Test path | Owner / scope |
|---|---|
| Registry matching/nonmatching/nested/alternatives; absent/empty/model-disabled; default major edges | Task 2, `packages/llmist/src/skills/registry.test.ts` |
| Built library ESM and CommonJS loading, selection and activation | Task 3, `packages/llmist/src/skills/runtime-compatibility.test.ts` |
| Built inherited CLI discovery, list and info | Task 3, `packages/cli/src/skills/runtime-skills.test.ts` |
| Direct version/engines, reproducible install, required lock changes and hook qualification | Tasks 1 and 3, command acceptance |
| Audit validity/error handling, runtime GHSA absence and actual parent reachability | Tasks 1 and 4, command acceptance and evidence review |
| Cleanup, TypeDoc/plugins and bundled npm residuals; new/changed advisory reconciliation | Task 4, command acceptance and explicit manual inventory review |
| Existing library/CLI skill regressions, all six tiers and local-review | Task 5, unchanged suites and prescribed commands |
| Plan/parent lifecycle, byte-preserving parent comparison, done-gate | Task 5, candidate acceptance |
| Three exact-head CI jobs and subsequent independent review | Task 5, external GitHub records; local success is insufficient |

No production functions or package exports are added. `SkillRegistry.findByFilePath` and
the named minimatch export remain the behavior under test. No new runner, weaker test tier,
removed assertion or paid provider access is planned.

## Documentation impact distribution

| Spec impact | Owner and disposition |
|---|---|
| Changelog now and measured implementation later | This Plan PR adds only its planning fragment. Plan 1 owns `changelog.d/wat-558-runtime-minimatch-upgrade.md` after measured remediation; landed fragments remain intact. |
| Downstream candidate audit, dependency paths, compatibility and gates | Plan 1's Evidence/Progress; coverage map conclusions and completion links; retain historical 003 context by reference. |
| No README/global guidance/migration documentation expected | No edit. Parent spec gets only normal sole-plan completion status/rename. A discovered migration need stops for scope direction. |

## Scope carried forward

Only the direct minimatch major change and required lock changes are authorized. No
development cleanup, TypeDoc/plugin upgrade, bundled npm edit, replacement matcher,
forced resolution/override, vendor patch, suppression, ignore list, exception or waiver.
Do not touch unowned PR #677. No releases, `main` promotion, package publication, automatic
merge, governance or identity changes, paid provider calls or exploit execution.

## Planning verification

- [x] All six spec ACs and corresponding Requirements have an owner and verification path.
- [x] The dependency graph is acyclic; the single plan has no prerequisite execution plan.
- [x] Every required test path is assigned, including error handling and both module formats.
- [x] All high-level documentation impacts have explicit dispositions.
- [x] Every per-plan criterion traces to a spec requirement or workflow hygiene.
- [x] The plan is independently executable; no later plan supplies missing qualification.
- [x] The execution file carries its own inputs, file ownership, tasks, tests, criteria,
  evidence protocol and external exact-head handoff for child-issue creation from that file.
