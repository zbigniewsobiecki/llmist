---
id: 004
slug: runtime-minimatch-major-upgrade
level: spec
title: Direct runtime minimatch major upgrade
created: 2026-11-10
status: draft
---

# 004: Direct runtime minimatch major upgrade

## Problem & Motivation

Related to WAT-558

The completed compatible dependency remediation leaves llmist's direct runtime minimatch
at 9.0.9. The CLI inherits this dependency through llmist. This is the remaining shipped
runtime path reported for GHSA-g3hv-75wg-m249, a pattern-amplification denial-of-service
advisory whose patched release starts at 11.0.1. The existing direct range cannot select it.

The supplied owner decision authorizes the direct major upgrade as a separate follow-up.
Skill-file matching must preserve its observable behavior across that upgrade. Removing this
runtime finding must not obscure the remaining development, private documentation and
release-tool findings or imply that the whole dependency graph is advisory-free.

---

## Goals

- Remove the reported advisory from llmist's direct runtime dependency and the CLI's inherited path.
- Preserve skill selection for file paths and existing library and CLI behavior.
- Give reviewers fresh, reproducible exposure evidence and explicit residual upstream boundaries.

---

## Non-goals

- Eliminate every glob or minimatch copy or obtain a zero-finding repository audit.
- Change skill syntax, public APIs, stored shapes, provider behavior or application architecture.
- Perform the dependency upgrade in this specification PR; planning and implementation follow separately.

---

## Constraints

- The authorized direct dependency range changes from `^9.0.9` to `^11`; the selected version
  must be at least 11.0.1. The range alone is not sufficient evidence of remediation.
- Limit dependency changes to the direct upgrade and lock changes it requires. Preserve the
  Node >=22 policy, Node 22 selection, engine-strict npm 10.9.2 installation and existing lock workflow.
  Verify the selected release's engine and module compatibility before implementation proceeds;
  incompatible requirements block the work rather than silently raising the support floor.
- Preserve npm, Lefthook, commitlint, Biome and all verification gates. Use mocked tests;
  paid provider calls and exploit execution are excluded.
- Work targets dev through separate Spec, Plan and implementation stages. This Spec delivery
  adds exactly this full specification and one changelog fragment.
- No forced overrides or resolutions, vendor patches, suppressions, ignore lists, new exceptions
  or waivers. A residual finding is an unresolved upstream constraint, not accepted risk.

---

## User stories / Requirements

1. Maintainers SHALL be able to install the committed dependency graph reproducibly with
   llmist's direct minimatch satisfying `^11` and resolving to at least 11.0.1.
2. Skill matching SHALL preserve selection by file path: matching and nonmatching paths,
   nested paths, alternative patterns, absent or empty patterns, and exclusion of skills
   disabled for model invocation. Existing pattern semantics SHALL remain compatible;
   downstream characterization must cover relevant major-version edge cases.
3. Library consumers and CLI users SHALL retain existing loading and skill workflows.
   Compatibility verification SHALL cover the library's supported module formats and the
   CLI's inherited runtime, without invoking paid providers.
4. Fresh audit evidence SHALL distinguish shipped runtime reachability from workspace flags.
   It must demonstrate removal of the specified advisory from the llmist and inherited CLI
   paths, not merely a changed package version or lower overall finding count.
5. Residual evidence SHALL enumerate development cleanup through rimraf/glob, private docs
   through TypeDoc and its plugins, and release-tool npm's bundled glob/minimatch. Record
   affected versions, parent chains and advisory identifiers; keep these paths upstream-only.
   New or changed findings require explicit assessment, never silent suppression.
6. Build, typecheck, lint, unit, coverage and mocked E2E verification SHALL pass sequentially.
   The exact PR head requires successful lint-and-test, validate-commits and e2e-tests,
   followed by independent review of that head. Local results do not replace CI or approval.

---

## Research Notes

- Baseline inspection uses dev at `7b04b18ea36d4e6c4c222455679ac890b08d5df1`.
  Its merged compatible-remediation evidence records the removed Google authentication
  cleanup chain and the remaining direct runtime, cleanup, docs and release-tool paths.
  These are baseline observations, not a fresh candidate audit.
- The [reviewed advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)
  identifies affected minimatch versions from 7.0.0 below 11.0.1 and patched version 11.0.1.
  It describes amplification with optimization level at least two. The registry currently
  passes no matcher options; dependency reachability does not prove practical exploitability.
- Repository inspection confirms the registry uses minimatch for each declared file pattern,
  accepting any match among model-invocable skills. Existing tests exercise recursive matching
  and no-match behavior; implementation must preserve these and characterize remaining edges.
- The baseline package metadata identifies minimatch as ISC licensed. Retaining this existing
  matcher avoids a replacement engine's pattern-language migration; selected-release metadata
  and compatibility still require verification during planning and implementation.
- The supplied brief records the owner's choice of the direct upgrade over development cleanup.
  The unowned dependency-update PR is context only, not an implementation or review artifact to adopt.

---

## Open Source Decisions

| Tool | Solves | Decision | Reason |
|---|---|---|---|
| [minimatch](https://www.npmjs.com/package/minimatch) (ISC in baseline metadata) | Skill-file glob matching | Use upstream major upgrade | Owner-authorized route to the patched version while retaining the existing matcher. |
| Existing npm toolchain | Reproducible dependency graph and advisory evidence | Use | Preserves the project installation and audit contract. |
| Alternative glob engines or patch tooling | Replacement matching or local remediation | Skip | Adds migration scope or bypasses the approved upstream boundary. |

---

## Strategic decisions

1. **Explicit major boundary** — authorize only the direct minimatch major transition and its
   required lock changes. The earlier compatible-remediation scope remains historical;
   this follow-up does not retroactively broaden it or authorize rimraf cleanup.
2. **Behavior preservation** — retain the existing matcher and observable skill selection.
   Any required public API, stored-shape or behavior change stops for owner direction.
3. **Path-specific evidence** — require a fresh audit and dependency-parent analysis rather
   than treating repository-wide audit success as the outcome. Upstream-only copies remain visible.
4. **Separate stages** — use a full specification, then planning, then implementation and
   independent review. No dependency edits or implementation success claims belong in this PR.
5. **No invented performance target** — preserve matching behavior and use the upstream security
   release without exploit benchmarks (assumed — flag if wrong). No new latency promise is made.

---

## Acceptance Criteria (outcome-level)

1. WHEN consumers install the implementation's committed graph, llmist's direct minimatch
   SHALL satisfy `^11` and resolve to at least 11.0.1, with engine-strict installation succeeding
   under the unchanged supported Node policy. Required lock changes SHALL be explained.
2. WHEN a fresh audit examines that graph, valid advisory data and parent-chain evidence SHALL
   show GHSA-g3hv-75wg-m249 absent from shipped llmist and inherited CLI runtime paths.
   Network or registry failure SHALL block the conclusion, not count as a clean result.
3. WHEN residual findings are reported, the development, private-docs and release-tool copies
   SHALL remain enumerated with versions, parents and upstream-only status. No evidence SHALL
   imply zero repository findings or a newly granted exception.
4. WHEN users select skills by file path, matching, nonmatching, nested and alternative patterns
   SHALL preserve existing selection behavior. Skills with absent or empty patterns and skills
   disabled for model invocation SHALL remain unselected. Existing tests SHALL stay green,
   with compatibility characterization covering relevant pattern edge cases.
5. WHEN library and CLI consumers load and use the updated runtime, supported module formats
   and skill workflows SHALL remain usable without API, configuration or stored-data migration.
6. WHEN the implementation is proposed for merge, all six local verification tiers SHALL pass,
   and lint-and-test, validate-commits and e2e-tests SHALL succeed on the exact independently
   reviewed head. Required approval and up-to-date dev checks remain mandatory; a comment review
   alone does not satisfy the approval requirement.

---

## Documentation Impact (high-level)

- Changelog: describe the specification now; a later implementation entry reports measured
  runtime remediation and the retained upstream-only findings.
- Downstream plan evidence: record candidate audit, dependency paths, compatibility results
  and gate outcomes. Preserve prior evidence as historical context.
- No README, global agent-guidance or user migration documentation change is expected because
  public behavior is preserved. Any discovered migration need requires a scope decision.

---

## Out of Scope

- rimraf or other development cleanup; TypeDoc upgrades; local changes to npm's bundled dependencies.
- Adopting, editing, commenting on or closing the unowned Dependabot PR #677.
- Release PRs, main promotion, package publication, automatic merge, ruleset changes or new identities.
- Broader vulnerability remediation, risk waivers, forced dependency mechanisms and provider tests.
