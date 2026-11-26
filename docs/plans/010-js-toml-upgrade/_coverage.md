# Coverage map for spec 010-js-toml-upgrade

Source: [complete merged specification](../../specs/010-js-toml-upgrade.md).
Execution: [1-parser-upgrade.md.wip](1-parser-upgrade.md.wip), currently in progress.
Every outcome belongs to this one implementation PR; assignment does not mark
any outcome complete. This Plan stage preserves the merged specification in full.

## Spec ACs

| # | Spec AC (short) | Satisfied by | Coverage / state |
|---|---|---|---|
| 1 | Both workspaces lock/install exactly 1.2.2; compare complete graph/delta | Plan 1, tasks 1/4, per-plan AC #1 | Full / locally verified |
| 2 | Real configuration parsing, semantics, useful errors and differences | Plan 1, tasks 2/3/4, AC #2/#5 | Full / locally verified |
| 3 | Malformed multiline rejection inside a documented process bound | Plan 1, task 3, AC #3 | Full / locally verified; baseline also bounded |
| 4 | Six local tiers, independent review, successful exact-head CI | Plan 1, tasks 4/5, AC #4/#6/#7 and external gate A | Full / local tiers and review verified; external CI/review hold |
| 5 | Approving review, dev merge, fresh checkout and manager closeout | Plan 1, task 5, AC #7/#8 and external gates A/B | Full / pending, operator/manager evidence hold |

## Coverage summary

- **5 spec ACs** map to **1 plan**, with full outcome ownership and no partial chains.
- **1 plan** has independently verifiable local criteria; external outcomes have
  explicit manual protocols and owners. Local completion never implies closeout.
- Plan lifecycle completion permits publication of the implementation PR. The
  parent spec stays pending until mandatory external gates A/B are verified,
  including actual manager closeout; no local checkbox substitutes for proof.
- **0 unmapped spec ACs**, **0 orphaned per-plan ACs**, **0 dependency edges**.

## Plan dependency graph

```text
1-parser-upgrade
```

Topological order: `1-parser-upgrade`. Widest concurrency: one implementer.
The bump, narrow lock delta and compatibility/security tests merge together.
No artificial split leaves the parser update unverified in an intermediate PR.
Implementation starts only after this Plan PR merges into dev.

## Test and evidence ownership

| Required path | Sole owner and verification |
|---|---|
| Declarations vs lock vs every installed copy / workspace resolver | Task 1/4 command-driven target and explained-delta checks, including engine-strict clean install |
| Actual supported TOML loading, optional defaults, strings/arrays, validation, inheritance, templates and error path | Task 2's nine named configuration cases plus existing config suites, real `loadConfig()` with only fs mocked |
| Adversarial multiline rejection / valid continuation | Task 3's isolated parser cases, fixed input and 2-second parse budget, 8-second absolute child ceiling |
| Harness sensitivity | Task 3's valid, syntax-error, nonresponsive/reaped, crashed and missing-import controls |
| Stricter decimal, offset and duplicate-header behavior | Task 3's bounded conformance cases; artifact inspection separates verified outcomes from release-note context |
| Complete verification and independent review | Task 4's six sequential tiers, normal hooks, fresh-context local-review gate |
| Published-head CI/reviews and dev reconciliation | Task 5 / Manual Verification: operator exact-head links, approval, strict freshness, merge and fresh installation; manager's actual closeout record |

New tests belong only to `config-loadconfig.test.ts` and
`config-parser-security.test.ts` in the CLI source directory. Existing assertions
remain; no test is silently replaced or demoted. Each planned test specifies
expected red or a temporary reverted sensitivity control for characterization.

## Documentation coverage

| Parent high-level impact | Plan 1 expansion |
|---|---|
| Specification / downstream plan, scope, mapping, evidence and holds | Preserve full parent content; this plan's Evidence/Progress and this map own results and lifecycle links |
| Changelog distinguishes stages and verified compatibility implications | This Plan PR adds `changelog.d/wat-1043-js-toml-plan.md`; implementation adds its own `changelog.d/js-toml-upgrade.md`, retaining landed fragments |
| Configuration reference only if user guidance changes | Conditional `packages/docs/src/content/docs/cli/configuration/toml-reference.mdx` entry after verified parser differences, or recorded no-change reason |
| PR / Linear delivery records and manager-only transitions | Task 5 and Manual Verification define whole-branch PR text, exact-head external evidence, operator reconciliation and manager-owned closeout |

## Planning verification and decisions

The source follows the full-spec template. The owner explicitly selects the
full Spec → Plan route; the atomic size does not authorize reducing it to a light
spec. Headless planning records routine decisions in Plan 1: `^1.2.2` declarations,
exact 1.2.2 lock/install target, real-parser tests, bounded child probes, conditional
configuration docs, one implementation PR and unchanged API/stored shapes.

The dependency graph is acyclic and each named test/doc impact has one owner.
All per-plan ACs cite spec outcomes or their required verification/delivery hygiene.
There is no active decision-record directory to constrain the decomposition.
No public API or stored-shape decision, spec rewrite, cross-spec guidance change,
new credential, release, main promotion or gate waiver is assumed.
