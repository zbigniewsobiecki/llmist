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
| 4 | Sequential local tiers, intact assertions, no paid tests/publication, exact-head CI and approval | Plan 1, task 4 | Full; six commands, unchanged test diff, three exact-head CI checks and legitimate approval; per-plan AC #4 and #6 |
| 5 | Preserve public behavior and tools; authorized dependency/evidence-only diff | Plan 1, tasks 2 and 4 | Full; engine-strict installation, hook qualification and full-delta gate; per-plan AC #5 |

## Coverage summary

- Five spec criteria mapped to one execution plan; all have full coverage and remain pending.
- The plan has six per-plan criteria, each traced to a spec criterion or its documentation
  impact. Coverage describes planned ownership, not completed remediation or accepted risk.
- All spec test paths belong to plan 1: fresh audit/error handling, installed bundle and Google
  graph checks, residual reconciliation, existing mocked regressions, six local tiers and
  external CI/approval. No new test runner or permanent dependency-version test is required.

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
| Shape and size | One medium-risk plan, four tasks, one dependency-maintenance concern. Baseline → compatible update → residual reconciliation → gates is a single coherent change. |
| Targets | Preserve the spec's npm 11.21.2 / google-auth-library 10.9.1 / gaxios 7.3.1 targets and fresh re-audit requirement; installation tool remains npm 10.9.2. |
| TDD | Command-driven audit/graph red checks precede lock edits; existing behavior suites remain green. No artificial vulnerable fixture, exploit or snapshot of dependency versions. |
| Manual criteria | Residual interpretation, delta review and external CI/approval use explicit evidence protocols; package checks and local tiers remain automated. |
| Documentation | Implementation evidence lives in plan 1; the merged source spec stays pinned. One separate implementation fragment describes measured reductions. |
| Residuals | Glob/minimatch stay unresolved for owner decision. There is no major-migration or risk-acceptance plan. |
| Cost | One combined change concentrates lock/audit review, but avoids an intermediate partially qualified graph and repeated full verification. |

## Documentation impact distribution

| Spec-level impact | Owner and concrete expansion |
|---|---|
| Changelog for specification and measured implementation | The landed specification fragment remains intact; this planning PR adds one planning fragment. Plan 1 later owns `changelog.d/wat-392-compatible-remediation.md` with measured outcome and residuals. |
| Specification and downstream plan evidence | The pinned parent supplies advisory inventory and decisions. Plan 1 Evidence owns fresh audit/target/residual/gate conclusions; do not duplicate current measurements into shared docs. |
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

## Planning verification

- [x] All five spec acceptance criteria have full ownership and verification paths.
- [x] Dependency set is acyclic; its only execution plan is independently executable.
- [x] All required test paths have an owner, including audit failures and external gates.
- [x] Every high-level documentation impact has an explicit disposition.
- [x] No per-plan criterion is orphaned; six local commands remain sequential and required.
- [x] Execution plan is self-contained, and implementation progress stays unchecked.
