---
id: 007
slug: cli-version-output-note
level: spec
title: CLI version-output documentation note
created: 2026-11-10
status: draft
---

# 007: CLI version-output documentation note

## Problem & Motivation

Related to WAT-593. The request is to specify a concise documentation note
explaining how a user reads the existing CLI version output. The CLI installation
guide already shows the version command, but does not explain what the returned
number identifies.

This is a specification-only qualification request. Review and merge of this spec
is the end of the request. No plan or implementation is requested; any later
documentation change requires a new owner instruction.

---

## Goals

- Define a short explanation that lets a user identify the version of the CLI
  they invoked.
- Keep the proposed note accurate to existing public behavior without creating
  a new CLI contract.
- Make the specification-only stopping point explicit.

---

## Non-goals

- Writing or publishing the proposed user-facing note in this request.
- Changing CLI behavior, flags, output formatting, or version selection.
- Planning or implementing subsequent work automatically.

---

## Constraints

- The deliverable is one full spec and its changelog fragment, targeting dev.
- The note must describe existing behavior, without requiring provider access.
- Keep the proposed note to one short paragraph alongside the existing version
  command in the CLI installation documentation.
- Avoid a hardcoded current version that would become stale after a release.

---

## User stories / Requirements

1. As a CLI user, I can learn that `llmist --version` displays the version of the
   CLI installation invoked by that command.
2. I can understand that the returned value comes from that CLI's package version;
   it is not a model version or a check for the latest available release.
3. As the owner, I can review this specification without authorizing a plan or
   implementation. The proposed note remains future work unless I ask for it.

---

## Research Notes

Research skipped: the request documents established repository behavior and
introduces no external technology. Repository inspection confirms that the CLI
uses its package version for the version option, and the installation guide
already presents `llmist --version` as an installation check.

---

## Open Source Decisions

| Tool | Solves | Decision | Reason |
|------|--------|----------|--------|
| Additional tooling | Documentation authoring | Skip | A prose note requires no dependency or tool change. |

---

## Strategic decisions

1. **Full spec** — use the requested full tier even though the proposed note is
   small; retain outcome-level requirements without an execution task list.
2. **Placement and length** — one short paragraph in the existing CLI installation
   documentation keeps the explanation near the command (assumed — flag if wrong).
3. **Meaning over example numbers** — describe the invoked CLI's package version
   without pinning a release number or promising update detection.
4. **Spec-only endpoint** — review and merge of the spec ends this request. No
   downstream plan or implementation follows without a later owner request.

---

## Acceptance Criteria (outcome-level)

1. When reviewing this spec, a reader can identify the existing version command
   and the proposed explanation of its returned value (requirements 1–2).
2. The proposed note's requirements distinguish the invoked CLI package version
   from model versions and latest-release checks, without prescribing a fixed
   numeric output (requirement 2).
3. The spec bounds the proposed note to one short paragraph near the existing
   installation check, leaving current user documentation and CLI behavior
   unchanged in this request (goals 1–2).
4. When this spec is merged, the request ends; a plan or implementation requires
   a later owner instruction (requirement 3).

---

## Documentation Impact (high-level)

- This request adds only this spec and a changelog fragment recording its scope.
- The CLI installation guide is the proposed future home of the short note;
  editing it is not authorized by this request.
- No other documentation changes are needed for this specification.

---

## Out of Scope

- Runtime, dependencies, credentials, governance, and public API changes.
- Release work, package publication, or promotion to main.
- Troubleshooting installation selection, upgrade instructions, or new version
  diagnostics.
- Any plan or implementation following this spec without a later owner request.
