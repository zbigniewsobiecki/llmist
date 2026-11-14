---
id: "008"
slug: self-hosted-github-actions
plan: 1
plan_slug: runner-routing
level: plan
title: Route all six GitHub Actions jobs after verified safety prerequisites
parent_spec: docs/specs/008-self-hosted-github-actions.md
depends_on: []
status: pending
---

# 008/1: Route all six GitHub Actions jobs

> Part 1 of 1. Parent: [full spec](../../specs/008-self-hosted-github-actions.md).
> Resolve the parent by id/slug if its lifecycle extension changes.

## Summary

Related to WAT-751.

Move the six existing jobs to their three designated repository-scoped x64 pools,
establish Node 22 and npm 10.9.2 separately in each job, and change the two Release
jobs' environment from `CI` to `release`. Preserve every other workflow contract.
Deliver the three workflow files together: dev's default-branch activation makes
the readiness and evidence of all three pools relevant to the same rollout.

This is one medium-risk, bounded configuration change with five tasks, seven
named command-driven check families and external evidence protocols. No later
plan supplies missing tests, credentials or safety controls. Root and Zbigniew
must satisfy both pre-start gates below; the implementation PR performs no
infrastructure, environment, secret or governance administration.

**Components delivered / files owned exclusively within this spec:**

- `.github/workflows/ci.yml`: three job selectors and per-job npm installation.
- `.github/workflows/release.yml`: two selectors, two environment values and tools.
- `.github/workflows/claude.yml`: one selector and explicit tools before the action.
- This plan's Evidence and Progress sections and normal lifecycle extensions.
- `docs/plans/008-self-hosted-github-actions/_coverage.md`: conclusions/status links.
- `docs/specs/008-self-hosted-github-actions.md`: normal completion status/rename only
  after every spec outcome has evidence; no rewriting the owner decision.
- `changelog.d/wat-751-self-hosted-github-actions.md`: one later implementation fragment.

**Shared surfaces:** none in this single-plan set. Keep the landed Spec and Plan
fragments; an unmerged implementation follow-up edits its existing fragment.

**Deferred to later plans:** none. Operator prerequisites and real release/Claude
events are external dependencies, not additional implementation plans.

## Spec ACs satisfied by this plan

All entries mean full ownership of the verification path, not outcomes already met.

- Spec AC #1 — **full**: routing, preserved contracts and the Release environment exception.
- Spec AC #2 — **full**: explicit tools in all six jobs plus clean-worker capability evidence.
- Spec AC #3 — **full**, `[manual]`: both operator pre-start gates and names-only evidence.
- Spec AC #4 — **full**: exact-head checks, independent review and post-merge dev CI.
- Spec AC #5 — **full**: default-branch, main and selected-ref activation reporting.
- Spec AC #6 — **full**: per-job proof limits and the existing Claude OAuth gap.
- Spec AC #7 — **full**, `[manual]`: owner secret-removal ordering, conditional retention
  and honest pending/confirmed reporting; no secret administration in the PR.

## Depends On

No other execution plan (`depends_on: []`). The authoritative source is the amended
spec at dev `b095b81c22abcd1b03615627163a39403f442fd4`, spec Git blob
`45f812175e0771bdbbda0c175995dddaeffca61a`. Planning verifies the checkout and live
dev identity through MCP. Workflow blobs at that base are:

| Path | Git blob |
|---|---|
| `.github/workflows/ci.yml` | `aceecb2fb3d5cb800492b60bfe6de3775b0983ef` |
| `.github/workflows/release.yml` | `04537e52062e7f718007581b9f3cd6bc273fe392` |
| `.github/workflows/claude.yml` | `412cef9e6785990d352aec5b9df3141e878fe3b5` |

Re-read the parent and current dev before execution. If these workflow inputs
change, stop for plan reconciliation rather than applying a stale allowlist.

### Pre-start gates — both pending at planning time

Do not lock this plan, edit workflows or open the implementation PR until both pass:

1. **Fresh containers on every pool.** Root supplies published infrastructure identity,
   Zbigniew's successful `pulumi up`, and Root's verification that each job receives
   a fresh container with its writable filesystem and scratch reset on all three
   pools. Confirm all pools remain registered on this repository and online.
   Already-applied infrastructure `3b8ebde840976ef6a13701153b660ee796d1b236` and online
   persistent containers do not satisfy this new gate.
2. **Prepared release environment.** Zbigniew confirms that `release` exists with
   `GH_PAT` and `NPM_TOKEN` and a deployment branch policy allowing only `dev` and
   `main`. Require names/scope/policy evidence only; never obtain secret values.

Related to WAT-755. The owner has selected these controls; this plan does not
reopen that choice or design broader governance. Pool labels are routing selectors,
not an authorization boundary. Container reset does not establish host/kernel,
cache, artifact or external-state isolation.

Supplied Root observations, not independent live runner/settings reads:

| Runner | Pool | Capacity | Current evidence |
|---|---|---|---|
| `bauer-llmist-ci-1` | `llmist-ci` | 4 CPU, 8 GiB | Registered and online; reset gate pending |
| `bauer-llmist-release-1` | `llmist-release` | 2 CPU, 4 GiB | Registered and online; reset gate pending |
| `bauer-llmist-claude-1` | `llmist-claude` | 2 CPU, 4 GiB | Registered and online; reset gate pending |

Root reports labels `self-hosted`, `Linux`, `X64` plus each pool label. Use the
spec's lower-case YAML selectors below; reconcile actual labels through Root and
GitHub job metadata without changing pool or architecture. Registration proves no
job execution. These MCP tools cannot independently inspect runner or secret state.

## Detailed Task List (TDD)

Use existing Node/npm and locked packages; no new dependency, framework or script
entry is needed. One-shot Node acceptance scripts and raw output belong in ignored
`node_modules/.cache/008-runner-routing/`. Record results in this plan's Evidence.
Use the locked `yaml` package (currently 2.9.1) with YAML 1.2 parsing and Node's
`node:assert/strict`; read actual YAML, never regex-match a few labels or execute
workflow shell bodies. Scratch helper signatures can be:
`readWorkflow(path): object`, `assertRouting(workflow, expectedByJob): void`,
`assertTools(job): void` and `assertPreserved(base, candidate, additions): void`.
They are verification helpers, not exported product APIs or committed infrastructure.

### 1. Verify operator prerequisites and freeze the preservation oracle

**Tests first — acceptance checks before any workflow edit:**

- `readiness-all-pools` — manual acceptance, spec AC #3 — run protocol M1 below.
  Expected red now: fresh-container evidence is pending on all three pools, so
  the gate refuses to proceed even though the existing runners are online.
- `release-environment-ready` — manual acceptance, spec AC #3 — run M2 below.
  Expected red now: verified `release` environment/secrets/policy evidence is absent.
- `workflow-contract-preserved` — structural acceptance — parse the baseline
  workflows from the pinned Git objects and assert the candidate equals that
  contract after removing only the exact authorized edits from tasks 2 and 3.
  Baseline is legitimately green. Prove assertion sensitivity with separate
  in-memory candidate mutations to a CI trigger, the validate-commits condition,
  a permission, a secret reference, Release's checkout ref and a sync command.
  Expected red for each mutation: deep-equality failure at the changed property;
  restore each copy. Never weaken the oracle to make a preservation test red.

**Implementation preparation** (this plan's Evidence only):

- Record M1/M2 evidence with actor, observation time and source; stop if either fails.
  No infrastructure, settings or credentials are changed by the implementer.
- Read baseline YAML with `git show <pinned-base>:<path>` and fail on parse errors,
  duplicate keys or missing expected jobs. Preserve workflow names, `on`, job IDs,
  display names, every `if`, `needs`, permissions, outputs, checkout inputs, action
  versions, secret expressions and existing step bodies/order.
- The permitted differences are six `runs-on` replacements, two Release environment
  replacements, six npm bootstrap steps and two Node setup steps (sync-dev/Claude).
  Everything else must compare equal. In particular retain Codecov's advisory
  behavior, full commit-validation history, release `ref: main`, registry URL,
  semantic-release exit/output logic, publish conditions and sync merge/push body.
- Establish capability evidence from Root for fresh workers: action runtime support,
  Git, Bash and archive/network tools needed by the existing pinned actions,
  setup-node downloads, writable non-root tool/npm paths and registry access.
  Cover native dependency installation, not only Node's major version. No hosted
  tool cache or previous job's installation may be a hidden prerequisite.
  A missing capability stops work for Root; do not add privileged installers or
  assume a hosted Ubuntu image. Release/Claude capabilities can be inspected by
  Root without publishing or calling a provider, but that is not action execution.

### 2. Route CI and establish its per-job npm version

**Tests first — command-driven structural acceptance on `.github/workflows/ci.yml`:**

- `ci-job-routing` — parameterized acceptance, three rows — each of `lint-and-test`,
  `validate-commits` and `e2e-tests` requests exactly
  `[self-hosted, linux, x64, llmist-ci]`. Expected red per row on baseline:
  actual `ubuntu-latest` differs from the required label array.
- `per-job-node-npm` — parameterized acceptance, three CI rows — retain each
  `actions/setup-node@v4` with `node-version: "22"` and its npm cache settings;
  require an unconditional npm 10.9.2 bootstrap immediately after Node setup,
  before `npm ci`, commitlint or other npm consumers. Expected red per row:
  the required npm bootstrap step is missing.
- Re-run `workflow-contract-preserved` after the edit: both test jobs keep `CI`;
  validate-commits keeps no environment, its existing PR condition and dev-to-main
  exception. All commands, provider/Codecov secret references and triggers stay equal.

**Implementation** (`.github/workflows/ci.yml`):

- Replace only the three selectors with the spec's complete array.
- Insert a step named `Install npm 10.9.2` after each Node setup. Run
  `npm install --global npm@10.9.2`, then check `node --version` is major 22 and
  `npm --version` equals 10.9.2; make a mismatch fail the step. This gives log
  evidence and prevents accidentally using a global npm from a previous image.
- Keep setup-node's existing cache, all dependency/build/test commands, environments
  and action inputs. A cache hit is optional; explicit Node/npm setup is mandatory.
  Refactor only within this allowed delta; do not introduce a reusable workflow.

### 3. Route Release and Claude with explicit independent tools

**Tests first — command-driven structural acceptance on the other two workflows:**

- `release-job-routing` — parameterized acceptance, two rows — `release` and
  `sync-dev` request `[self-hosted, linux, x64, llmist-release]`.
  Expected red per row: `ubuntu-latest` differs from the required array.
- `release-job-environment` — parameterized acceptance, two rows — both Release
  jobs reference exactly `release`. Expected red per row: actual `CI` differs.
- `claude-job-routing` — acceptance — `claude` requests
  `[self-hosted, linux, x64, llmist-claude]`. Expected red: actual `ubuntu-latest`.
- `per-job-node-npm` — three additional rows — Release's existing Node setup is
  retained, sync-dev and Claude each get Node 22 setup, and each has the same
  unconditional npm bootstrap/version assertions as CI before its first consumer.
  Expected red: release lacks npm bootstrap; sync-dev/Claude lack Node setup and
  npm bootstrap. Assert each property independently rather than stopping at one.
- Re-run `workflow-contract-preserved`: preserve Release's workflow_run/main and
  manual/main conditions, `needs` and successful-release sync gate; retain Claude's
  four event types/mention conditions, no environment, permissions and OAuth input.

**Implementation** (`.github/workflows/release.yml`, `.github/workflows/claude.yml`):

- Change the two Release selectors and environment values; change Claude's selector.
- Retain release's Node setup including `registry-url` and npm cache. Add the same
  `Install npm 10.9.2` step immediately after it.
- In sync-dev and Claude, insert `actions/setup-node@v4` with `node-version: "22"`
  after checkout, followed by that npm bootstrap. Their Node setup needs no cache
  option; do not add `npm ci` to these jobs or alter their existing action/commands.
- Never change the secret expressions. Preserve `GH_PAT`, `NPM_TOKEN` and
  `CLAUDE_CODE_OAUTH_TOKEN` references exactly. The environment switch controls
  which prepared Release environment supplies its two credentials.
- Keep the absent Claude OAuth secret as an existing, separately reported gap.
  Do not add an environment or alternative token to make the Claude action run.

### 4. Verify the candidate and prepare an honest rollout report

**Tests first — acceptance before declaring the configuration ready:**

- Re-run all seven named structural check families, with six independent tool
  rows and the preservation mutation checks. Every unauthorized delta must fail.
- `mocked-project-gates` — command acceptance — build, typecheck, lint, unit,
  coverage and E2E in the order below. No expected new baseline failure; any failure
  is investigated, not accepted because workflow YAML changed. Confirm a suspected
  baseline failure once on unchanged origin/dev, using a comparison worktree under
  `.watershed/.cache/`, then stop unless this assignment owns the failure.
- `exact-head-ci` — external integration acceptance — after publication, require
  successful named feature-PR checks at the reviewed head, with llmist-ci runner
  metadata. Expected red/blocked before actual runs: required head-specific
  success/runner evidence is missing. Local green and the supplied base push run
  are not substitutes.

**Implementation / documentation** (this plan and one implementation fragment):

- Verify compatible Node and pinned npm locally, use engine-strict `npm ci` with
  the existing lockfile when installing, directly install/verify Lefthook, and
  check postinstall qualification; suppressed lifecycle errors are blockers.
  Preserve manifests, lockfile, hooks, commitlint and Biome. On the workers, retain
  the existing `npm ci` commands and check real install logs for hidden failures.
- Finish all edits and stage intended files before final checks. Run sequentially:
  `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run test:coverage`, `npm run test:e2e`. Use existing mocked tests only.
  Invoke `agent-plugins__z:local-review` in fresh-context gate mode on the exact delta;
  blocking findings cannot be waived automatically. Commit with normal hooks.
- Record command outcomes and the independent local gate in this plan. Write one
  operational changelog fragment without claiming speed, successful release/Claude
  execution or completed external prerequisites without evidence.
- Write the implementation delivery description with separate configuration,
  prerequisite, exact-head CI, post-merge and proof-limit results; fresh required
  PR sections remain authoritative. List any assertion removal and its new owner;
  no test deletion or weakening is planned.
- Require GitHub `lint-and-test`, `validate-commits` and `e2e-tests` success and
  independent review at the exact reviewed head. Confirm runner metadata for all
  three jobs identifies the self-hosted llmist-ci pool, not just matching job names.
  Codecov upload remains advisory. A changed head invalidates the head-specific
  review/check evidence. Hosted-run refusal is reported concretely; no billing edit.
- Existing one-approval and strict up-to-date required-check rules remain in force.
  An independent COMMENT review does not supply the required approval. The operator
  handles legitimate review identity and merge delegation; no bypass is authorized.

### 5. Verify dev activation and track owner actions without triggering releases

**Tests first — external acceptance and manual protocols before claiming completion:**

- `dev-push-ci` — external integration acceptance — inspect the actual post-merge
  dev push run. Expect success and self-hosted llmist-ci metadata for lint-and-test
  and e2e-tests; validate-commits is correctly skipped on pushes. Expected red/blocked
  before merge: no qualifying post-merge run exists. A PR run cannot satisfy this.
- `activation-report` — acceptance by source/event-record inspection, per-plan AC #5
  `[manual]` — follow M3. Expected red for a report claiming Release waits for main
  promotion, main CI has already migrated, or a skipped job proves execution:
  the report contradicts the workflow source and the parent requirements.
- `owner-secret-state` — manual acceptance, spec AC #7 — follow M4. Expected
  red/blocked before authorized ordering: secret removal is not yet confirmed;
  record pending status rather than deleting credentials or inventing proof.

**Implementation / evidence reconciliation** (this plan's Evidence and rollout body):

- Hand off the reviewed candidate to the operator for the existing dev merge path.
  No automatic merge, release dispatch, publication or main promotion is part of
  execution. The operator supplies post-merge job records if MCP cannot expose them.
- Report that dev activates Release's default-branch workflow_run routing and
  Claude's default-branch issue/comment path. Release still checks out main. The
  `release` policy permits dev for workflow_run and main for permitted manual
  dispatch; change no trigger or ref to accommodate that policy.
- Main CI and main-selected manual workflow versions remain hosted until a
  separately authorized promotion. Record which ref/event a cited run actually uses.
- Report each of release, sync-dev and Claude as **configured and registered**
  after configuration and current online registration are verified. Add that
  Claude authentication is unqualified because `CLAUDE_CODE_OAUTH_TOKEN` is absent.
  Only a next real release or qualifying Claude interaction can strengthen the
  per-job execution claim: record event, run/job identity, runner, result and logs.
  Never trigger either to fill this plan's evidence table or make paid provider calls.
- After the implementation merges, Zbigniew performs the old-copy deletions under
  M4. If main manual Release dispatch is needed before promotion, CI copies remain
  until that separately authorized promotion. Never silently decide that owner choice.
  Pending owner action remains pending in evidence; the PR administers no secret.
- Keep external outcome boxes unchecked until their actual protocols pass. A clean
  committed implementation candidate may be handed off with its plan still in
  progress. Do not run the done-gate or rename the plan/spec `.done` while required
  post-merge/owner evidence is missing; reconcile it in the normal reviewed lifecycle.
  Merely being configured and registered, with the OAuth gap disclosed, is the
  intended Release/Claude reporting limit, not an obligation to manufacture live runs.

## Test Plan

### Unit tests

No product unit behavior changes or new permanent tests are planned. Existing unit
and coverage suites remain intact. The structural checks below exercise real YAML.

### Structural / integration acceptance

- [ ] `workflow-contract-preserved`: all three parsed workflows and six separate
  in-memory mutations prove only the authorized delta is allowed (tasks 1–3).
- [ ] `ci-job-routing`: three rows (task 2).
- [ ] `release-job-routing`: two rows (task 3).
- [ ] `release-job-environment`: two rows (task 3).
- [ ] `claude-job-routing`: one row (task 3).
- [ ] `per-job-node-npm`: six rows, independently asserting Node, pinned npm and
  bootstrap-before-consumer order; existing setup inputs compare equal (tasks 2–3).
- [ ] Parse validity/duplicate-key rejection in `readWorkflow` (task 1).
- [ ] `mocked-project-gates`: all six sequential local tiers (task 4).
- [ ] `exact-head-ci`: three successful feature-PR jobs, runner metadata and review (task 4).
- [ ] `dev-push-ci`: post-merge dev run and correct skipped commit validation (task 5).

### Manual acceptance

- [ ] `readiness-all-pools` / M1; `release-environment-ready` / M2.
- [ ] `activation-report` / M3; `owner-secret-state` / M4.
- [ ] Root capability inspection in task 1 distinguishes installed prerequisites
  from real action execution; release and Claude remain unproven by CI success.

## Manual Verification

### M1 — per-plan AC #1 / spec AC #3: all-pool readiness

**Why manual:** Root controls infrastructure and worker inspection; available MCP
does not expose it. Ask for names/identities and outcomes, never secrets.

1. Obtain Root's fresh-container infrastructure revision on remote main, Zbigniew's
   successful application identity/time, and Root's dated observation for each pool.
2. Require an observation of two successive jobs on each pool: distinct container
   identity and a harmless writable-filesystem/scratch marker from the first absent
   from the second, including fresh work/home state. Root owns the inspection
   method; this PR creates no diagnostic workflow or infrastructure change.
3. Obtain repository-scoped registration, labels and online state for all three
   pools, non-root/no-host-mount/no-Docker-socket confirmation and capacity. Obtain
   the action/tool capability inspection described in task 1.
4. Record observations separately from earlier persistent-container readiness.
   Missing/reset-failing evidence on any pool blocks execution. Limit claims to
   writable filesystem/scratch; never claim host/kernel or external-state isolation.

### M2 — per-plan AC #1 / spec AC #3: release preparation

**Why manual:** Zbigniew controls environment policy and secret inventory.

1. Obtain names-only confirmation that `release` exists with `GH_PAT`, `NPM_TOKEN`
   and the dev/main-only deployment branch policy. Record actor/time/source.
2. Confirm old copies have not been removed prematurely; inventory records values
   as names and scopes only. No token is read, copied or exposed.
3. If anything is absent or permits broader branches, stop for the operator.
   The implementation branch does not create the environment or repair the policy.

### M3 — per-plan AC #5 / spec ACs #5–6: activation and proof limits

**Why manual:** multi-ref GitHub event semantics and operator reporting cannot be
proven by a sandbox YAML assertion or safely exercised via a manufactured release.

1. Compare dev and main workflow definitions and actual cited event/ref metadata.
   Record dev-default Release/Claude activation, Release's main checkout and the
   selected-ref dispatch caveat; main CI stays hosted before promotion.
2. For each non-CI job, pair the candidate config with Root's current registration.
   Record configured/registered separately from an actual event/job result.
   For each unexecuted job, explicitly write "execution not proven".
3. Record the absent Claude OAuth secret and unqualified authentication/functionality.
   CI green, an online runner, a skipped job or static tools cannot erase that gap.
4. Verify no release/promotion/provider call was performed for evidence. If a real
   event later occurs independently, record each job's actual result, including
   failure or skip; do not upgrade all three jobs from one successful job.

### M4 — per-plan AC #7 / spec AC #7: owner secret transition

**Why manual:** owner-managed inventories and an explicit operator dispatch need.

1. Before deletion confirmation, verify M2 evidence and the actual dev merge changing
   both Release jobs to `release`. Obtain the owner's statement about relying on
   manual Release dispatch from main before promotion. If unanswered, retain the
   conditional pending state; do not assume dispatch is dispensable.
2. Only Zbigniew removes `GH_PAT` and `NPM_TOKEN` from `CI` and repository-level
   `NPM_TOKEN`, after that merge and names-only verification. If main dispatch is
   needed before promotion, retain the CI copies until that separately authorized
   promotion. The repository copy has the spec's post-dev-merge ordering.
3. Obtain dated names-only inventories confirming the actual removals while
   `release` retains both names and its dev/main-only policy. Record retained copies
   with the condition blocking deletion; distinguish pending from confirmed.
4. Per-plan AC #7 is not checked until all required removals are confirmed. If CI
   retention is required, leave that outcome pending through the promotion window.
   No settings API write, secret deletion or main promotion is performed by this plan.

## Acceptance Criteria (per-plan, testable)

1. M1 and M2 pass before implementation starts, including capability evidence and
   all three fresh-per-job pools; earlier online persistent workers are insufficient
   (`[manual]`, spec AC #3 and requirement 4).
2. All six complete label selectors, environments and every preserved workflow
   contract pass the structural checks (spec AC #1).
3. Every job explicitly establishes Node 22 and npm 10.9.2 before consumers;
   cold-worker capability evidence and actual available CI logs support the claim,
   without claiming unexecuted Release/Claude actions have run (spec AC #2).
4. Independent review, legitimate required approval, successful exact-head
   lint-and-test/validate-commits/e2e-tests on llmist-ci and successful post-merge
   dev push metadata are recorded; push commit validation remains skipped (spec AC #4).
5. M3 accurately reports activation by ref/event, configured/registered status and
   the absent Claude OAuth credential; no validation release or promotion occurs
   (`[manual]`, spec ACs #5–6).
6. All six sequential local tiers and fresh-context local review pass; hooks and
   tooling are preserved; documentation/fragment and evidence reflect actual results
   (verification and documentation hygiene).
7. M4 confirms the owner's ordered removals and final names-only inventories;
   any conditional retention remains pending until confirmed, with no secret
   administration in the PR (`[manual]`, spec AC #7).

## Documentation Impact

| File / surface | Change |
|---|---|
| This plan's Evidence/Progress | Prerequisites, red/green structural results, tool capability limits, local gates, head-specific review/CI, post-merge and owner-action states |
| `_coverage.md` in this folder | Conclusions and lifecycle links only; detailed proof stays here |
| `changelog.d/wat-751-self-hosted-github-actions.md` | One measured operational migration fragment for the later implementation PR |
| Implementation PR description | Separate exact-head and post-merge CI, Release/Claude registration versus execution, activation/ref caveats and pending/confirmed owner actions |
| Parent spec | Keep requirements unchanged; normal completion transition only once every outcome is verified |
| Public API docs, README, CONTRIBUTING.md, CLAUDE.md | No edit: no public API or general guidance change is required |

## Out of Scope

- All runner provisioning, `pulumi up`, environment/policy setup, secret entry or
  deletion; Root and Zbigniew own the specified external actions.
- Broader governance/settings/rulesets, billing changes, admin bypass or credential
  provisioning, including the missing Claude OAuth secret.
- Dependabot runner settings, dependencies, lockfile edits, test weakening, new CI
  platforms, performance promises, reusable-workflow refactors or unrelated failures.
- Release dispatch, package publication, main promotion or fabricated Claude events.
- Additional decision records or shared policy changes; no later plan is proposed.

## Evidence

Planning uses project `llmist`, target-qualified agent `llmist-plan`, repository
`zbigniewsobiecki/llmist`, base `dev`. The source identities and workflow blobs above
are verified locally and dev's head is confirmed through GitHub MCP. The parent
amendment is merged via PR #691. Runner, environment and secret facts are supplied
Root/operator observations, not independent live settings reads. Available tools
do not expose those inventories. Both new prerequisites remain pending.

Implementation records its own dated observations here. Required fields: check or
protocol name, input identities, command/event, exit/result, actor/source, per-job
runner and limitation. Do not paste secrets or sandbox-local log paths into PR text.
Carry a measured result forward only with complete measured-input hash equality;
when the full input set is uncertain, re-measure. GitHub head-specific results must
always match the head being reviewed. No implementation outcome is claimed by this Plan.

## Progress

<!-- Implementation updates these only after the corresponding evidence exists. -->
- [ ] AC #1
- [ ] AC #2
- [ ] AC #3
- [ ] AC #4
- [ ] AC #5
- [ ] AC #6
- [ ] AC #7
