---
id: 008
slug: self-hosted-github-actions
level: full
title: Repository-scoped self-hosted GitHub Actions
created: 2026-11-14
status: draft
---

# 008: Repository-scoped self-hosted GitHub Actions

## Problem & Motivation

Related to WAT-751. llmist currently runs all six jobs in its three GitHub
Actions workflows on GitHub-hosted Ubuntu runners. The requested change routes
these jobs to Root's three repository-scoped pools on bauer while preserving
the checks, event handling, credentials references, and release rules that
maintainers already use, with the owner-approved exception that both Release
jobs use a dedicated release environment.

The migration changes where repository code executes, including code submitted
in public pull requests and jobs that can publish packages or write repository
history. A successful CI run cannot establish release or Claude readiness.
The specification therefore separates routing, infrastructure readiness,
security prerequisites, and evidence of actual execution. This document is a
specification only; Plan and implementation are separate deliveries into dev.

---

## Goals

- Route each existing job to its designated llmist pool without changing the
  observable check or release contract.
- Make each job's toolchain independent of the GitHub-hosted image and cache.
- Require readiness before the implementation PR and distinguish configured
  jobs from jobs proven by real execution.
- Make activation timing and the owner-approved safety prerequisites explicit.

---

## Non-goals

- Performing runner provisioning, infrastructure application, environment setup
  or secret migration in the PR; these are operator-owned prerequisites/actions.
- Governance changes beyond the owner's explicitly approved decision A.
- Changing release eligibility, publishing packages, or promoting dev to main.
- Improving performance, changing dependencies, or introducing new CI products.

---

## Constraints

- Repository: zbigniewsobiecki/llmist. Delivery base: dev. Related to WAT-751.
- Preserve workflow names, job IDs and display names, triggers, all job and
  step conditions, permissions, secret references, and required check names
  exactly. Preserve environments except that release and sync-dev move from
  CI to release. Preserve checkout targets and release/sync behavior.
- Keep Node 22 through actions/setup-node and explicitly install npm 10.9.2
  per job. No job may depend on a hosted-runner tool cache or a previous job's
  tools. Keep the existing lockfile, npm workspaces, Lefthook, commitlint and Biome.
- Root owns the separate repository-scoped pools, CPU/memory limits, ephemeral
  clean work and home directories, non-root workers, and exclusion of Docker
  sockets and host-service or credential mounts. Decision A additionally
  requires a fresh container per job on all three pools: reset the writable
  filesystem and scratch state between jobs. This is not a guarantee about
  host/kernel isolation, GitHub caches, artifacts or external state. Root
  changes infrastructure and Zbigniew applies it; the PR does neither.
- No provider API calls are needed for validation; existing mocked checks remain.
- Decision A settles the safety question. Its application and verification
  remain prerequisites to implementation; the decision is not evidence that
  the current containers already reset or that secrets have already moved.

---

## User stories / Requirements

1. **Exact routing.** Every job SHALL request the complete label set below.
   Pool labels are routing selectors; this specification does not treat them
   as an authorization boundary against modified workflow code.

   | Workflow | Job ID | Existing display name | Final labels |
   |---|---|---|---|
   | CI | lint-and-test | implicit job ID | `[self-hosted, linux, x64, llmist-ci]` |
   | CI | validate-commits | implicit job ID | `[self-hosted, linux, x64, llmist-ci]` |
   | CI | e2e-tests | implicit job ID | `[self-hosted, linux, x64, llmist-ci]` |
   | Release | release | Semantic Release | `[self-hosted, linux, x64, llmist-release]` |
   | Release | sync-dev | Sync dev branch | `[self-hosted, linux, x64, llmist-release]` |
   | Claude Code | claude | implicit job ID | `[self-hosted, linux, x64, llmist-claude]` |

2. **Preserved events and gates.** CI retains pushes to main/dev, all pull
   requests, and manual dispatch. Commit validation retains its pull-request
   condition and dev-to-main exception. Release retains completed CI runs on
   main, its success condition, and its main-only manual-dispatch condition.
   Sync retains its dependency on successful release. Claude retains the
   existing issue, comment and review events and mention conditions. No event
   or condition is broadened to obtain verification evidence.
3. **Credentials and environment contract.** CI test jobs retain environment CI;
   release and sync-dev SHALL use environment release. This is the sole
   exception to preserving environments. Validate-commits and Claude retain
   their absence of an environment. Existing provider, Codecov, GH_PAT, NPM_TOKEN and
   CLAUDE_CODE_OAUTH_TOKEN references and permission declarations remain
   unchanged. Zbigniew creates release with a dev/main-only branch policy and
   GH_PAT and NPM_TOKEN. Once that environment is confirmed, he deletes GH_PAT
   and NPM_TOKEN from CI and the repository-level NPM_TOKEN. Creation, secret
   entry and post-confirmation deletions are his actions outside the PR.
   CLAUDE_CODE_OAUTH_TOKEN is absent from the supplied environment/repository
   inventories; record this existing gap without adding or broadening credentials
   or claiming Claude authentication is fixed.
4. **Per-job tools.** All six jobs SHALL explicitly establish Node 22 through
   actions/setup-node and npm 10.9.2, including sync-dev and Claude. Existing
   dependency installation and test/release operations remain intact. Required
   action runtimes and non-Node tools must work on the clean supplied workers;
   a missing runner capability is a prerequisite failure, not permission to
   assume the hosted image's software is present.
5. **Readiness before implementation.** Spec and Plan PRs retain hosted execution.
   The implementation PR SHALL wait until Root's infrastructure is on remote
   main, Zbigniew has applied it with pulumi up, and Root has verified both
   fresh-per-job-container behavior and all three pools registered on this
   repository and online. Existing online runners alone are insufficient.
   Zbigniew's release environment must also be confirmed to exist with both
   secrets and a policy allowing only dev and main before implementation starts.
   Root reports capacity and readiness; Watershed cannot inspect these workers.
   Hosted-run refusal must be reported concretely without changing billing caps.
6. **Effective time.** Because dev is the default branch, merging the workflow
   change there activates the new routing for Release's workflow_run path and
   Claude's default-branch issue/comment events. Release still checks out main;
   it need not wait for a dev-to-main promotion to use its new pool. Main's CI
   remains hosted until a separately authorized promotion. Manual dispatch
   uses the selected ref's workflow version; main's old version can remain
   hosted before promotion. No release is triggered to test this change.
   The release environment policy permits dev because the normal workflow_run
   definition executes from the default branch, and main for the permitted
   manual dispatch. No trigger or ref behavior changes to accommodate the policy.
7. **Completion evidence.** Require independent review and successful exact-head
   lint-and-test, validate-commits and e2e-tests on llmist-ci before the
   implementation merges to dev under the existing merge delegation. The
   repository's approval requirement and strict up-to-date required checks
   remain unchanged; no ruleset change is made. Require a passing post-merge
   dev push run and job metadata showing
   self-hosted llmist-ci execution. Validate-commits remains skipped on pushes.
8. **Honest proof limits.** Release, sync-dev and Claude are reported as
   "configured and registered" once their configuration and online registration
   are verified. Their execution is proven only by the next real release or
   qualifying @claude interaction, with each job's actual result recorded.
   Registration, labels, skipped jobs, and CI success are not execution proof.
   Report the missing Claude OAuth secret alongside that status; online
   registration does not establish authentication or functional readiness.

---

## Research Notes

- Repository evidence was inspected at dev 687e0af8d1b0a89ba2cd4ef041b0a65c8e9e4414.
  The three workflows are byte-identical to the snapshot's origin/main and
  origin/HEAD points to dev. All six jobs currently use ubuntu-latest.
  Node 22 setup exists in the three CI jobs and release, but not sync-dev or
  Claude; no workflow explicitly installs npm 10.9.2. The package-manager
  declaration selects npm 10.9.2. Explicit per-job installation is therefore
  part of the requested outcome, not merely a label substitution.
- The lockfile includes the linux-x64 lzma binary and has no linux-arm64 lzma
  entry. This supports retaining the requested x64 architecture; it does not
  prove every native dependency works on Root's workers.
- The supplied operator context reports a public personal-account repository,
  one environment (CI) with protection_rules empty, deployment_branch_policy
  null and can_admins_bypass true, all_external_contributors
  fork approval, and strict required checks plus one approval. Available MCP
  tools do not expose repository settings, environments, or runner registration;
  these live settings were not independently re-read in this session. The
  workflow source does independently confirm the shared CI environment.
  Root's later names-only evidence establishes CI secrets ANTHROPIC_API_KEY,
  CODECOV_TOKEN, GEMINI_API_KEY, GH_PAT, NPM_TOKEN and OPENAI_API_KEY, with only
  NPM_TOKEN at repository level. CLAUDE_CODE_OAUTH_TOKEN is in neither inventory.
  These are supplied operator observations, not independent live MCP reads.
- [GitHub event semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
  distinguish default-branch workflow_run and issue events from selected-ref
  manual dispatch. This makes all three pools necessary before dev activation.
- [GitHub security guidance](https://docs.github.com/en/actions/reference/security/secure-use)
  warns about public-repository self-hosted execution and compromise by
  untrusted code. Approval to run a fork workflow is not evidence of worker
  isolation or secret segregation.
- [GitHub environment semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
  make environment secrets available to jobs referencing that environment,
  subject to applicable protections; an environment itself does not isolate
  self-hosted execution. Root's inventory confirms release credentials share
  CI with test jobs; decision A separates them into a branch-restricted release
  environment without claiming environment policy provides host isolation.
- [GitHub secret handling](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
  excludes secrets other than GITHUB_TOKEN from fork-triggered workflows.
  This does not establish isolation of workers or protect secrets in
  same-repository PR execution. The supplied context notes that pushing such
  branches requires write access, and edited workflows can select any label.
- **Safety decision settled:** The manager reports that Zbigniew selected
  option A from his own account at 2026-11-14T22:42:08Z. Related to WAT-755.
  The decision requires fresh containers per job, the release environment and
  its two secrets restricted to dev/main, and the owner's post-confirmation
  deletions. Requirements 3 and 5 capture these consequences. This settles the
  choice of controls; applying and verifying them remains outstanding.
- Root reports infrastructure 3b8ebde840976ef6a13701153b660ee796d1b236 applied
  and bauer-llmist-ci-1 / llmist-ci, bauer-llmist-release-1 / llmist-release,
  and bauer-llmist-claude-1 / llmist-claude online on this repository.
  Related to WAT-753. The current containers retain their writable layer
  between jobs, so this evidence does not satisfy decision A's new reset
  requirement. Fresh-container verification must cover all three pools and
  is limited to writable filesystem and scratch reset, not external state.

---

## Open Source Decisions

| Tool | Solves | Decision | Reason |
|---|---|---|---|
| GitHub Actions and existing actions | Workflow execution | Use | Preserve the existing event and check contract; no replacement platform. |
| actions/setup-node (MIT) | Per-job Node setup | Use | Existing tool required by the request; installation must work without a hosted cache. |
| npm, Lefthook, commitlint and Biome | Dependency and quality gates | Use | Preserve existing tools and lockfile; no tooling migration is needed. |
| Additional runner management tools | Infrastructure lifecycle | Skip | Root owns infrastructure outside this specification. |

---

## Strategic decisions

1. **Three x64 pools** — retain the requested separation and complete label sets;
   do not infer security isolation solely from pool names.
2. **Explicit per-job tools** — include all six jobs so neither hosted images
   nor earlier jobs supply an undocumented runtime dependency.
3. **Readiness before routing** — require all pools before the implementation
   PR because default-branch events activate at the dev merge.
4. **Apply decision A's explicit exception** — the two Release jobs use release;
   the owner prepares its dev/main-only policy and secrets, then removes the
   old copies after confirmation. Root supplies fresh containers per job.
   All other workflow contracts and approval rules remain unchanged. No broader
   governance or credential changes are authorized.
5. **Evidence by job** — CI can be proven during delivery; release and Claude
   remain configured and registered until real events exercise them.
6. **Full spec only** — use level full as requested. No implementation plan,
   executable changes, cross-spec decision records, or performance promises.

---

## Acceptance Criteria (outcome-level)

1. WHEN workflows are compared with the baseline, all six jobs SHALL have the
   exact routing in requirement 1 and preserve the contracts in requirements
   2 and 3, including required check names and release checkout behavior.
2. WHEN any job starts on a clean eligible worker, it SHALL establish Node 22
   and npm 10.9.2 without a hosted cache or another job's installed tools.
3. BEFORE the implementation PR proceeds, Root SHALL provide evidence of
   applied fresh-per-job-container infrastructure, verified writable filesystem
   and scratch reset across jobs on all three pools, and all pools registered
   on llmist and online. Zbigniew SHALL have confirmed release exists with
   GH_PAT and NPM_TOKEN and a dev/main-only policy. Evidence SHALL distinguish
   these new prerequisites from the already-applied persistent-container setup.
   `[manual]` — Root and Zbigniew control infrastructure and live access evidence.
4. WHEN the implementation merges to dev under the existing merge delegation,
   independent review and successful exact-head lint-and-test, validate-commits
   and e2e-tests on llmist-ci SHALL be recorded; the post-merge dev push SHALL
   pass with job metadata showing llmist-ci self-hosted runners.
5. WHEN dev activates the default-branch workflows, reporting SHALL distinguish
   the Release/Claude routing from main's still-hosted CI and selected-ref
   dispatch. No release or promotion SHALL be performed just for validation.
6. WHEN completion is reported, Release, sync-dev and Claude SHALL be called
   configured and registered until actual job execution provides stronger
   evidence. Any later proof SHALL identify the real event and job result.
   The absent CLAUDE_CODE_OAUTH_TOKEN SHALL be reported as an existing gap,
   not as repaired or covered by runner registration.
7. WHEN the owner confirms the release environment, Zbigniew SHALL remove
   GH_PAT and NPM_TOKEN from CI and repository-level NPM_TOKEN. Reporting SHALL
   distinguish confirmed removal from pending owner action; the PR SHALL not
   perform secret administration. `[manual]` — owner-managed secret inventories.

---

## Documentation Impact (high-level)

- This spec records the routing contract, prerequisites, timing and proof limits.
- The later delivery description must report exact-head and post-merge CI
  evidence separately from release/Claude registration and execution evidence.
- No public API documentation or general developer-guidance change is needed.
  A later implementation delivery can document the operational runner change
  in its own changelog fragment. This spec adds no runtime behavior.

---

## Out of Scope

- Performing workflow edits or writing an implementation plan in this Spec PR.
- Performing runner provisioning, pulumi up, environment setup, secret entry or
  deletions in the PR. Decision A assigns those actions to Root and Zbigniew;
  only the later implementation changes the two Release job environment values.
- Repository settings, rulesets, environment/secret changes beyond decision A,
  billing changes, and provisioning the missing Claude OAuth credential.
- Dependabot runner settings, release dispatch, package publication, main
  promotion, bypassing merge controls or changing required check names.
- Resolving unrelated dependency or test failures and modifying shared policy.
