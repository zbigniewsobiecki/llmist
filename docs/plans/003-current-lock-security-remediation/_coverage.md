# Coverage map for spec 003-current-lock-security-remediation

Parent: [full spec](../../specs/003-current-lock-security-remediation.md), read at merge commit
`431bf3414f4fa251af41b6e2e538b4fbcea4378a`; blob
`ff3239eb588892df0e8945e453500632ed326059`, content SHA-256
`22222adf72a2fec203bd9f858364b3af805b705f2c6c939b0e44dfcbd9af872e`.

## Spec ACs

| # | Spec AC (short) | Satisfied by | Coverage / verification |
|---|---|---|---|
| 1 | Fresh valid deduplicated audit and parent/exposure inventory; errors block conclusions | [Plan 1](1-compatible-remediation.md), task 1 and candidate re-audit in task 2 | Full; `audit-json-valid`, advisory identity/path reconciliation; per-plan AC #1 |
| 2 | Compatible installed targets remove six advisories and Google cleanup path; assess new findings | Plan 1, tasks 1–2 | Full; five undici checks, ip-address check, installed bundle inspection and Google subtree traversal; per-plan AC #1–2 |
| 3 | Remaining glob/minimatch paths and upstream boundaries stay unresolved | Plan 1, task 3 | Full; `residual-inventory-complete` and evidence protocol; per-plan AC #3 |
| 4 | Sequential local tiers, intact assertions, no paid tests/publication, exact-head CI; required approval remains external governance | Plan 1, task 5; separate operator governance handoff | Full; six commands and unchanged test diff (per-plan AC #4); exact-head lint-and-test, validate-commits and e2e-tests (AC #6, explicitly CI-only deferrable). Approval remains required outside plan criteria. |
| 5 | Preserve public behavior and tools; authorized dependency/evidence and lifecycle diff | Plan 1, tasks 2, 4 and 5 | Full; engine-strict installation, hook qualification and full-delta gate (AC #5); completed plan/spec lifecycle with parent text preserved (AC #7) |

## Coverage summary

- Five spec criteria mapped to one execution plan; all have full coverage and remain pending.
- The plan has seven per-plan criteria, each traced to a spec criterion or its documentation
  impact. Coverage describes planned ownership, not completed remediation or accepted risk.
- All spec test paths belong to plan 1: fresh audit/error handling, installed bundle and Google
  graph checks, residual reconciliation, existing mocked regressions, six local tiers and
  lifecycle/parent-text checks and exact-head CI. Required approval remains in the operator's
  existing governance handoff, outside plan criteria. No new test runner or permanent
  dependency-version test is required.

## Plan dependency graph

```text
1-compatible-remediation
```

Topological order: `1-compatible-remediation.md`. `depends_on: []`; no cycles or missing files.
Maximum concurrency is one. Both dependency updates own the same root lockfile and produce
one combined candidate inventory; splitting would create lock conflicts and duplicate the
audit/gate cycle without file-disjoint work.

## Planning decisions and trade-offs

Autonomous planning follows the supplied scope; these are recorded choices, not owner risk decisions.

| Choice | Decision and reason |
|---|---|
| Shape and size | One medium-risk plan, five tasks, one dependency-maintenance concern. Baseline → compatible update → residual reconciliation → completion candidate → gates is a single coherent change. |
| Targets | Preserve the spec's npm 11.21.2 / google-auth-library 10.9.1 / gaxios 7.3.1 targets and fresh re-audit requirement; installation tool remains npm 10.9.2. |
| TDD | Command-driven audit/graph red checks precede lock edits; existing behavior suites remain green. No artificial vulnerable fixture, exploit or snapshot of dependency versions. |
| Manual criteria | Residual interpretation and delta review use explicit evidence protocols; package, lifecycle and local-tier checks remain automated. AC #6 may defer only to lint-and-test, validate-commits and e2e-tests succeeding at the final reviewed head. |
| Documentation | Implementation evidence lives in plan 1. Its completed candidate owns plan/spec `.md.done` / `status: done` transitions and link updates; the parent otherwise stays byte-identical to the pinned source. One implementation fragment describes measured reductions. |
| Governance and CI handoff | Approval, review counts, up-to-date rules and merge authority remain in the operator's existing governance handoff, outside plan criteria. The CI-only deferral is satisfied by exact-head job results without a post-publication evidence-only commit. |
| Residuals | Glob/minimatch stay unresolved for owner decision. There is no major-migration or risk-acceptance plan. |
| Cost | One combined change concentrates lock/audit review, but avoids an intermediate partially qualified graph and repeated full verification. |

## Documentation impact distribution

| Spec-level impact | Owner and concrete expansion |
|---|---|
| Changelog for specification and measured implementation | The landed specification fragment remains intact; this planning PR adds one planning fragment. Plan 1 later owns `changelog.d/wat-392-compatible-remediation.md` with measured outcome and residuals. |
| Specification and downstream plan evidence | The historical pinned parent supplies inventory and decisions. Plan 1 owns fresh conclusions plus both completion renames/status changes and link updates; the parent's status line is its only text change. No other shared docs change. |
| No README/global agent guidance | No changes; this maintenance scope creates no cross-spec rule or public API. |

## Scope carried forward

All eight advisory rows in the spec's Requirements inventory are reconciliation inputs to
plan 1. It plans removal of the five undici advisory identities and ip-address identity, and
explicit enumeration of the two remaining glob/minimatch identities. Counts from the spec's
scratch experiment are not implementation acceptance thresholds. Changed advisory coverage
must be assessed afresh; network errors cannot be interpreted as clean results.

No overrides, resolutions, vendor patches, suppressions, ignore lists, downgrades, exceptions,
waivers, major migration, publication or release/governance/identity action is authorized.
The separate temperature work remains outside this plan. Local checks cannot replace the
three successful exact-reviewed-head CI checks or legitimate approval.

## Implementation completion contract

This planning PR leaves the execution plan pending and the parent spec untouched. In the
implementation's reviewed candidate, plan 1 owns both transitions:

- `1-compatible-remediation.md` (via `.md.wip`) → `1-compatible-remediation.md.done`,
  frontmatter `status: done`.
- `docs/specs/003-current-lock-security-remediation.md` →
  `docs/specs/003-current-lock-security-remediation.md.done`, frontmatter `status: done`;
  all other parent text must match the historical pinned blob.

Update this map's parent/plan links to the completed paths in that same candidate. Every
Progress criterion must be checked from observed evidence except AC #6, which may carry
the plan's explicit CI-only deferral naming `lint-and-test`, `validate-commits` and
`e2e-tests`. That deferral is satisfied only by all three jobs succeeding at the exact final
reviewed head. It allows completed lifecycle forms while CI is pending; it does not waive
CI or permit a failed/missing job to merge. GitHub job records supply the final result;
no subsequent evidence-only commit is required. Approval, review counts, up-to-date
enforcement and merge authority remain external operator governance, not plan criteria.

## Planning verification

- [x] All five spec acceptance criteria have full ownership and verification paths.
- [x] Dependency set is acyclic; its only execution plan is independently executable.
- [x] All required test paths have an owner, including audit failures and external gates.
- [x] Every high-level documentation impact has an explicit disposition.
- [x] No per-plan criterion is orphaned; six local commands remain sequential and required.
- [x] Execution plan is self-contained, and implementation progress stays unchecked.
- [x] Completed-candidate ownership and the narrow named-job CI-only deferral are explicit;
  neither requires a post-publication evidence-only commit.
