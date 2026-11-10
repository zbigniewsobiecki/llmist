---
id: "005"
slug: cli-sdk-version-terminology
level: spec
title: CLI and SDK version terminology
created: 2026-11-10
status: draft
---

# 005: CLI and SDK version terminology

## Problem & Motivation

Related to WAT-587

The repository offers both a command-line application and a TypeScript library.
The command is named `llmist`, the CLI package is `@llmist/cli`, and the library
package is `llmist`. Consequently, an unqualified reference to an “llmist version”
does not identify which installed package is meant.

The existing CLI installation guide shows how to display a version, and the library
installation guide identifies the library package. A small explanation within those
existing guides can connect the terminology without adding a new documentation area.
This specification records that explanation for an owner-requested qualification
fixture retained as test history. Merging this spec is the end of this request;
documentation implementation requires a later explicit owner request.

---

## Goals

- Define CLI version and SDK version using the existing package identities.
- Make the meaning of the existing CLI version display unambiguous.
- Describe a concise clarification that fits the current documentation structure.

---

## Non-goals

- Change version output, package identities, dependencies or runtime behavior.
- Establish a new release policy or compatibility guarantee.
- Deliver the proposed guide edits, a plan or implementation in this request.

---

## Constraints

- This delivery adds only this full spec and one changelog fragment.
- The proposed explanation must describe current behavior without hardcoding a
  “latest” version number or implying that separate installations always match.
- Existing documentation organization and installation instructions remain the
  context; no new documentation system or dedicated versioning guide is needed.
- No release, package publication, governance change or credential change is authorized.

---

## User stories / Requirements

1. A reader can identify **CLI version** as the version of `@llmist/cli`, which
   provides the `llmist` executable. The existing CLI version display reports that
   CLI package's version.
2. A reader can identify **SDK version** as the version of the `llmist` library
   used by their application. Here SDK means the llmist library, not a provider SDK.
3. A reader understands that matching release numbers do not make these package
   identities interchangeable. The repository synchronizes package versions during
   release preparation, but the CLI display does not inspect an application's
   installed SDK version.
4. The clarification is discoverable in the existing CLI and Library installation
   documentation, using a short explanation and cross-reference where useful.

---

## Research Notes

External research skipped: this is terminology for established repository behavior.
Repository inspection confirms separate CLI/library package identities, a CLI version
display sourced from its own package metadata, existing CLI and Library installation
guides, and release preparation that synchronizes package versions. These observations
describe the checkout, not the latest published registry versions.

---

## Open Source Decisions

| Tool | Solves | Decision | Reason |
|------|--------|----------|--------|
| Existing documentation tooling | Publishes the current CLI and Library guides | Use | Prose clarification needs no new tooling or dependency |

---

## Strategic decisions

1. **Package-qualified language** — distinguish the CLI package from the library
   package even when their version numbers match; package identity is the stable
   distinction readers need.
2. **Existing guide placement** — use the CLI and Library installation documentation
   rather than a new page. This equivalent editorial choice keeps the explanation
   close to the relevant installation context.
3. **No version snapshot** — explain what each version refers to without recording
   current release numbers, avoiding unnecessary maintenance and stale guidance.
4. **Spec-only endpoint** — retain a full spec as requested. Its merge ends this
   qualification request; it does not authorize a downstream plan or guide edits.

---

## Acceptance Criteria (outcome-level)

These criteria define the proposed documentation outcome for any separately authorized
future work. They do not claim that this Spec PR changes the installation guides.

1. When reading the CLI installation explanation, a reader can identify the CLI
   package and understand that its version display refers to that package (requirement 1).
2. When reading the Library installation explanation, a reader can identify the SDK
   as the application's `llmist` library and distinguish it from provider SDKs
   (requirement 2).
3. When comparing CLI and SDK versions, a reader is told that synchronized release
   numbers do not establish the SDK version installed in an application, and that
   the CLI display is not an SDK installation check (requirement 3).
4. The explanation fits the existing CLI and Library installation documentation,
   contains no claim about the latest published version, and requires no change
   to installation behavior or documentation navigation (requirement 4, constraints).

---

## Documentation Impact (high-level)

- CLI installation guide — proposed concise definition of the CLI package version
  alongside the existing version verification guidance; no guide edit in this delivery.
- Library installation guide — proposed SDK package definition and connection to
  the CLI terminology; no guide edit in this delivery.
- Changelog — record addition of this specification only, without claiming that
  user-facing installation documentation has already changed.

---

## Out of Scope

- Runtime code, dependency or lockfile changes; new commands or SDK APIs.
- Compatibility matrices, migration guidance, new versioning schemes or release automation.
- Release PRs, promotion to the release branch, package publication or automatic merge.
- Plans, implementation, unrelated documentation cleanup or changes to other specs.
