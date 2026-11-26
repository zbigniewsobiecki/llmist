---
id: 010
slug: js-toml-upgrade
level: spec
title: Upgrade js-toml to 1.2.2
created: 2026-11-26
status: draft
---

# 010: Upgrade js-toml to 1.2.2

## Problem & Motivation

The owner requests a narrowly scoped js-toml upgrade to 1.2.2 on llmist's dev
branch, with independent review, required CI, merge evidence, and Linear closeout.
Related to WAT-1043. Dependabot alert 272 motivates the request; the earlier
Dependabot PR #695 is closed without merging and is background evidence only.

At the supplied dev revision b6c90af19cfd8a95e6efe979414e3262581c3e7d,
both CLI and library dependency declarations allow ^1.1.0. The lock and installed
workspace tree resolve a shared js-toml 1.1.2. A permissive declaration alone
therefore does not establish that the requested version is installed. The CLI
uses the parser when loading configuration, making correct parsing and useful
failure behavior relevant to this maintenance change.

---

## Goals

- Resolve js-toml to exactly 1.2.2 throughout the verified workspace installation.
- Preserve supported configuration loading and validation while receiving the
  upstream parser fixes.
- Deliver the dependency change to dev with independently verifiable review,
  checks, merge, and issue closeout evidence.

---

## Non-goals

- Implementing the upgrade in this specification stage.
- Updating unrelated dependencies, replacing the TOML parser, or redesigning configuration.
- Package release, main promotion, or changing repository governance.

---

## Constraints

- The owner requires a fresh branch from dev; do not revive or merge PR #695.
- Limit dependency changes to js-toml and any demonstrably necessary resolution
  metadata. Unrelated dependency churn requires separate scope approval.
- Retain npm workspaces, Turborepo, npm 10.9.2, the committed lock, Biome,
  Lefthook, commitlint, and the supported Node policy (at least 22; CI uses 22).
- Preserve public APIs and stored configuration shape. Any needed change to
  either requires an explicit scope decision before implementation.
- Use mocked provider tests; no paid provider calls or new credentials.
- Reference the issue only as “Related to WAT-1043” in PRs and commits; do not
  use automatic issue-closing language.
- Review and CI must apply to the exact candidate head. Existing dev rules,
  including an approving review and strict up-to-date checks, remain mandatory.

---

## User stories / Requirements

1. As a maintainer, I can distinguish declared ranges, locked versions, and
   installed resolutions for both consuming workspaces on the current dev base
   and on the final candidate. Evidence identifies all resolved copies.
2. As a CLI user, I can continue loading supported TOML configuration with
   existing defaults, validation, inheritance, and template behavior intact.
   Malformed configuration produces a useful error through the existing error
   surface. Security and conformance tightening is documented where relevant.
3. As a maintainer, I can verify that representative malformed multiline-string
   input is rejected without hanging, using bounded execution. Regression
   evidence must not expose the normal test process to unbounded parser work.
4. As a reviewer, I can establish the dependency-only scope and see successful
   build, typecheck, lint, unit, coverage, and mocked end-to-end results, plus
   relevant configuration compatibility and security regression evidence.
5. As the owner, I receive a traceable delivery outcome: independent review,
   required CI, merge into dev, fresh-checkout verification, and manager-owned
   Linear closeout. Any unavailable evidence is an explicit remaining hold.

---

## Research Notes

- Local inspection on 2026-11-26 confirms declarations ^1.1.0 and locked and
  installed 1.1.2 in both workspaces; the installed package declares MIT licensing.
  The CLI is the direct parser caller found in production source.
- [Upstream changelog](https://github.com/sunnyadn/js-toml/blob/main/CHANGELOG.md)
  describes TOML 1.1 support and parser hardening across the intervening releases.
  Compatibility verification must cover valid input and stricter invalid-input
  rejection rather than assuming a version bump is behavior-neutral.
- [PR #695](https://github.com/zbigniewsobiecki/llmist/pull/695), verified closed
  and unmerged through GitHub, reproduces 1.2.2 release notes concerning multiline
  string backtracking and oversized decimal literals. Its historical diff and
  check results do not qualify a fresh candidate.
- [Alert 272](https://github.com/zbigniewsobiecki/llmist/security/dependabot/272)
  could not be read with the granted API access (403). Its current state and
  exact advisory association are unverified; no alert-closure claim is made.
- The open-PR listing contains only unrelated Dependabot branches at spec time.
  No active decision records or bug ledger are present in this checkout.

---

## Open Source Decisions

| Tool | Solves | Decision | Reason |
|------|--------|----------|--------|
| [js-toml](https://github.com/sunnyadn/js-toml) | TOML parsing | Use | Retain the existing MIT parser and reach the owner-requested 1.2.2 resolution. |
| Alternative TOML parsers | TOML parsing | Skip | Replacement adds migration risk outside the dependency-only request. |

---

## Strategic decisions

1. **Full specification** — follow the explicitly selected Spec → Plan →
   implementation route. This document defines outcomes; a downstream plan
   chooses dependency declaration syntax and concrete verification details.
2. **Exact installed target** — 1.2.2 is the required locked and installed
   resolution, not a claim that a semver range permanently pins future installs.
   Both consumers must exclude older vulnerable resolutions in the candidate.
3. **Compatibility boundary** — retain configuration behavior for supported
   inputs and accept documented upstream security/conformance rejection of
   invalid inputs (assumed — flag if wrong). Do not add application workarounds
   that restore unsafe parsing or silently change public contracts.
4. **Evidence and ownership** — the spec worker prepares documentation only.
   Downstream workers implement and verify; the operator owns live review,
   exact-head CI, merge and fresh-checkout reconciliation, and the manager owns
   workflow transitions and closeout. A spec PR merge does not complete the upgrade.
5. **Documentation scope** — add one changelog fragment per landed PR, with
   configuration documentation changes only where verified behavior warrants
   them. No cross-spec guidance change is needed (assumed — flag if wrong).

---

## Acceptance Criteria (outcome-level)

1. WHEN the candidate is installed reproducibly from its lock, both CLI and
   library SHALL resolve js-toml 1.2.2, with no older resolved copy. Evidence
   compares declarations, lock, installed tree, and unrelated resolution changes
   against the current implementation base. Satisfies Goal 1 / Requirement 1.
2. WHEN supported configuration is loaded, existing configuration semantics
   SHALL remain intact; malformed input SHALL produce a useful error. Evidence
   covers actual parsing, not only validation of constructed objects, and records
   upstream compatibility differences. Satisfies Goal 2 / Requirement 2.
3. WHEN representative adversarial multiline input is parsed, it SHALL fail
   within a documented bounded verification budget without blocking the test
   harness indefinitely. Satisfies Goal 2 / Requirement 3.
4. WHEN the candidate is submitted for delivery, all six local verification
   tiers SHALL pass, and independent review SHALL have no unresolved blocking
   findings. GitHub lint-and-test, validate-commits, and e2e-tests SHALL succeed
   at the exact reviewed head. Codecov upload is advisory. Satisfies Goal 3 /
   Requirement 4.
5. WHEN the owner is told the upgrade is complete, evidence SHALL identify its
   merge into dev, the required approving review in addition to the independent
   COMMENT quality review, successful required checks, and fresh-checkout
   resolution verification. Manager closeout SHALL record the outcome and any
   alert visibility limitation without claiming a release. Satisfies Goal 3 /
   Requirement 5.

---

## Documentation Impact (high-level)

- Specification and downstream plan: record scope, acceptance mapping, evidence,
  and unresolved delivery prerequisites.
- Changelog: distinguish the specification deliverable from the eventual
  dependency upgrade; describe verified compatibility implications when it lands.
- Configuration reference: update only if supported user guidance changes.
- PR and Linear delivery records: record verification and final outcome, with
  issue workflow transitions reserved for the manager.

---

## Out of Scope

- General vulnerability cleanup or assertions that all advisories are resolved.
- Reusing historical CI as final candidate evidence, bypassing review rules,
  provisioning credentials, or changing branch protection.
- New parser features, provider integrations, runtime API changes, stored-shape
  migrations, or unrelated bug fixes.
- Package publication and release workflows, and any merge to main.
