---
id: "006"
slug: cli-output-examples
level: spec
title: CLI output examples
created: 2026-11-10
status: draft
---

# 006: CLI output examples

## Problem & Motivation

Related to WAT-589

The CLI quick start pairs a completion command with a sample response. The existing
CLI guides also describe interactive terminal output, non-interactive use and quiet
mode. Readers need to distinguish illustrative generated content from the output
format and execution context that the CLI actually provides.

This qualification request calls for a documentation-only clarification of existing
examples. It retains the requested history as a full specification. Merging this
specification is the endpoint of the request; a plan or documentation implementation
requires a later explicit owner request.

---

## Goals

- Make existing CLI output examples understandable as illustrations of current behavior.
- Distinguish commands to enter from responses or terminal displays to expect.
- Explain output context where terminal mode, piping or quiet mode affects an example.
- Keep the clarification within the existing documentation structure.

---

## Non-goals

- Change CLI behavior, output formats, defaults or public interfaces.
- Promise exact model-generated wording, timing, usage totals or costs.
- Edit user-facing guides or create a downstream plan in this delivery.

---

## Constraints

- This delivery adds exactly one full specification and one changelog fragment.
- Current repository behavior is the authority; documentation must not prescribe a
  runtime change to make an example true.
- Preserve the current documentation navigation and command semantics.
- Verification must use repository evidence and existing mocked tests, without paid
  provider calls or new credentials.
- No dependency, release, publication or governance changes are authorized.

---

## User stories / Requirements

1. A reader can tell which part of an existing example is the command and which
   part is illustrative output. Generated response text is identified as a possible
   response, not a guaranteed verbatim result.
2. A reader can identify the execution context of an example when that context
   changes its presentation: completion versus agent, interactive terminal versus
   piped use, and quiet mode where shown.
3. A reader can distinguish response content from progress, diagnostics and terminal
   status when these appear in an example. Stream descriptions are specific to the
   command and mode shown, rather than a universal promise for every CLI command.
4. A reader can find the clarification alongside existing examples, with references
   to the current CLI command and terminal-interface guides where useful. No new
   tutorial series or output-format reference is required.

---

## Research Notes

External research skipped: this is clarification of established repository behavior,
with no new technology or domain.

- The CLI quick start presents a completion response and separately describes
  interactive agent mode and piping.
- Completion handling streams response content to standard output. Its summary is
  conditional on standard error being a terminal and quiet mode being disabled.
- Agent handling selects its terminal interface when input and output are interactive
  and quiet mode is disabled. Existing terminal documentation also covers piped use.
- These observations establish relevant example contexts; they do not establish an
  exhaustive audit of every command or guarantee a provider's response wording.

---

## Open Source Decisions

| Tool | Solves | Decision | Reason |
|------|--------|----------|--------|
| Existing documentation tooling | Presents CLI guides and examples | Use | Editorial clarification needs no new tooling or dependency |

---

## Strategic decisions

1. **Representative examples** — clarify the meaning of existing output excerpts
   instead of treating generated text as a golden transcript. Provider output varies.
2. **Local context** — place explanations beside the examples and use existing guide
   references. This editorial choice preserves navigation and avoids duplicated guidance.
3. **Behavior-specific wording** — qualify terminal and stream descriptions by the
   command and mode shown. Different commands need not share one output contract.
4. **Bounded maintenance** — focus on the quick-start examples and directly related
   command and terminal-mode explanations, not a comprehensive command audit.
5. **Spec-only endpoint** — retain the full specification and changelog record as the
   entire delivery. Future guide edits require separate owner authorization.

---

## Acceptance Criteria (outcome-level)

These criteria describe the proposed documentation outcome for separately authorized
future work. This delivery records the requirements; it does not claim guide changes.

1. When reading an affected example, a reader can distinguish the command from its
   output and sees generated text described as illustrative rather than guaranteed
   verbatim output (requirement 1).
2. When terminal mode or piping changes the displayed output, the example identifies
   the relevant execution context; quiet mode is explained according to the command
   shown wherever the example uses it (requirement 2).
3. When an example includes progress, diagnostics or status alongside content, the
   explanation distinguishes them and accurately identifies streams where relevant,
   without generalizing that behavior to unrelated commands (requirement 3).
4. The clarification remains discoverable beside the existing examples and consistent
   with the current command and terminal-interface guides, without new navigation,
   commands or runtime requirements (requirement 4 and constraints).

---

## Documentation Impact (high-level)

- CLI quick start — proposed labels and concise context for existing command/output
  examples; no guide edits in this delivery.
- CLI command overview and terminal-interface overview — proposed clarification of
  directly related output-mode explanations only where needed for consistency.
- Changelog — record the specification addition without claiming the proposed
  user-facing documentation maintenance has shipped.

---

## Out of Scope

- Runtime code, dependencies, stored data, output schemas or public API changes.
- New commands, features, example applications or provider integrations.
- Exhaustive CLI documentation cleanup, unrelated specifications or version terminology.
- Release PRs, package publication, branch governance or identity changes.
- Automatic planning, implementation or merge after this specification is delivered.
