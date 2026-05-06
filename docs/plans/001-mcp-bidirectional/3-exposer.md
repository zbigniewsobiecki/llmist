---
id: 001
slug: mcp-bidirectional
plan: 3
plan_slug: exposer
level: plan
parent_spec: docs/specs/001-mcp-bidirectional.md
depends_on: [1-foundation.md]
status: pending
---

# 001/3: Exposer — `llmist mcp serve` publishes gadgets and skills as an MCP server

> Part 3 of 3 in the 001-mcp-bidirectional plan. See [parent spec](../../specs/001-mcp-bidirectional.md). This plan depends only on plan 1 (foundation); it does **not** depend on plan 2 and can ship in parallel with it.

## Summary

Adds the **exposer** side: a stdio MCP server that publishes a chosen set of native llmist gadgets as MCP tools and (optionally) llmist skills as MCP prompts. After this plan ships, a user can run `llmist mcp serve --gadgets <spec>` and add the resulting command to Claude Code's, Cursor's, or any other MCP client's configuration; the client discovers and calls llmist gadgets through the standard MCP handshake. This makes llmist's gadget/skill ecosystem available to any MCP-aware host without those hosts learning anything about llmist's block format.

This plan also lands the **roundtrip** test that closes the loop: an llmist agent (consumer-side, plan 1) connects to an `llmist mcp serve` subprocess (exposer-side, this plan) and successfully calls an exposed gadget end-to-end.

What this plan does NOT deliver: Streamable HTTP transport for the exposer (stdio only at v1; HTTP exposer scoped for v1.5), MCP `resources` advertisement (deferred), `sampling` server-side hooks (server requesting our LLM — out of v1 scope), `elicitation` (mid-call user prompts — out of v1 scope), authentication (out of v1 scope).

**Components delivered:**
- `packages/llmist/src/mcp/server.ts` — wraps the SDK's `Server` class with stdio transport; registers tool and prompt handlers; forwards calls into a passed-in `GadgetRegistry` and (optional) `SkillRegistry`
- `packages/llmist/src/mcp/gadget-exporter.ts` — converts an `AbstractGadget` into the MCP tool descriptor shape: `{ name, description, inputSchema (JSON Schema via existing schemaToJSONSchema) }`; converts a gadget execute() result into MCP `content` blocks
- `packages/llmist/src/mcp/skill-exporter.ts` — converts a `Skill` into the MCP prompt descriptor shape: `{ name, description, arguments }`; converts `prompts/get` invocations into rendered messages by calling `Skill.getInstructions()` with substituted arguments
- `packages/llmist/src/mcp/server-lifecycle.ts` — handles stdin-close (parent disconnected), SIGTERM, SIGINT, clean shutdown
- `packages/llmist/src/mcp/server-capabilities.ts` — capability advertisement: `{ tools: { listChanged: false }, prompts: { listChanged: false } }`; gracefully reports `prompts` capability only when at least one skill is provided
- `packages/cli/src/mcp/serve-command.ts` — implements the `llmist mcp serve` CLI subcommand; flags: `--gadgets <spec...>` (reusing the existing external-gadget specifier parser), `--skills <dir>` (optional), `--protocol-version <ver>` (optional override, defaults to `2025-06-18`)
- `packages/cli/src/mcp/mcp-command.ts` — extended to register the `serve` subcommand alongside plan 2's `import-claude-code`
- `examples/29-mcp-expose.ts` — programmatic exposer example: spawns an MCP server in-process exposing a single demo gadget
- `examples/30-mcp-roundtrip.ts` — roundtrip example: spawns `llmist mcp serve` as a subprocess and connects an llmist agent (consumer) to it
- `packages/docs/src/content/docs/cli/commands/mcp-serve.mdx` — CLI guide for `mcp serve` including a Claude Code installation walkthrough
- `packages/docs/src/content/docs/library/advanced/mcp-expose.mdx` — library guide for the programmatic exposer (`createMcpServer({ gadgets, skills })`)
- `README.md` — extend the existing MCP capability bullet (added in plan 1) with a one-liner about exposing
- `CHANGELOG.md` — entry
- `CLAUDE.md` — extend with the `mcp serve` command

**Deferred to follow-up specs / future plans:**
- Streamable HTTP for the exposer (deferred to spec follow-up at v1.5)
- MCP resources export (deferred to v1.5 follow-up)
- Sampling, elicitation, roots primitives (deferred to v2 follow-up)
- OAuth 2.1 (deferred to follow-up)

---

## Spec ACs satisfied by this plan

- **Spec AC #5** (`mcp serve` initialize handshake + tools/call) — **full**
- **Spec AC #6** (`--skills` option exposes prompts) — **full**
- **Spec AC #7** (Inspector sanity checks) — **full**
- **Spec AC #8** (Claude Code installs published server, calls a gadget) — **full**
- **Spec AC #14** (process hygiene — exposer side) — **full** (plan 1 + plan 2 cover the consumer-side hygiene; this plan covers exposer-side stdin-close + signals)
- **Spec AC #16** (5/10-minute walkthroughs — expose side) — **full** (combined with plan 1's consume-side walkthrough)
- **Spec AC #17** (E2E coverage — expose + roundtrip) — **full** (combined with plans 1 and 2's consumer-side E2E)

---

## Depends On

- **Plan 1 (`foundation`)** — provides the `@modelcontextprotocol/sdk` install, the consumer-side `McpClient` (used by the roundtrip test), and the existing `schemaToJSONSchema` reuse pattern.
- **Does NOT depend on plan 2** — this plan can land in parallel with plan 2 once plan 1 is merged.
- Existing `packages/llmist/src/gadgets/schema-to-json.ts` (used to export Zod schemas as JSON Schema for MCP tool descriptors).
- Existing `packages/llmist/src/gadgets/registry.ts` (the source of truth for gadgets to expose).
- Existing `packages/llmist/src/skills/registry.ts` (the source of truth for skills to expose).
- Existing `packages/llmist/src/skills/parser.ts` (frontmatter / argument substitution for prompt rendering).
- Existing `packages/cli/src/external-gadgets.ts` (specifier parser reused for the `--gadgets` flag).

---

## Detailed Task List (TDD)

### 1. Gadget → MCP tool exporter

**Tests first** (`packages/llmist/src/mcp/gadget-exporter.test.ts`):
- `exports a basic Zod-schema gadget — name, description, and inputSchema match the gadget's metadata`
- `exports a gadget with no parameter schema as inputSchema { type: 'object', properties: {} }`
- `description includes the gadget's description plus optional examples (when present on the gadget)`
- `executing the exported tool with valid params calls gadget.execute() and returns content blocks`
- `string result becomes a single text content block`
- `result with media (image) becomes mixed content (text + image base64)`
- `gadget that throws becomes a tool result with isError=true`
- `gadget that throws TaskCompletionSignal is converted into a successful end-of-turn result`
- `unknown content kinds (audio) are downgraded to text with a warning until plan-3-follow-up adds proper handlers`
- `inputSchema produced by the exporter is the same JSON Schema produced by schemaToJSONSchema for the same Zod schema`

**Implementation** (`packages/llmist/src/mcp/gadget-exporter.ts`):
- Function: `gadgetToMcpTool(gadget: AbstractGadget): McpToolDescriptor`.
- Reuse existing `schemaToJSONSchema(gadget.parameterSchema)` to produce `inputSchema`.
- Function: `gadgetResultToMcpContent(result: GadgetExecuteReturn): McpContentBlock[]` — handles string, object, media outputs.
- Function: `runGadgetForMcp(gadget, params, ctx): Promise<McpToolCallResult>` — executes gadget, catches errors, converts to MCP shape.

### 2. Skill → MCP prompt exporter

**Tests first** (`packages/llmist/src/mcp/skill-exporter.test.ts`):
- `exports a skill with arguments — name, description, arguments[] (name, description, required) match the skill metadata`
- `exports a skill without arguments`
- `prompts/get with arguments calls Skill.getInstructions() with the arguments substituted`
- `prompts/get with missing required argument returns an error response (not a JSON-RPC protocol error)`
- `skill body is returned as a single user-role message in the prompt response`
- `skill body with multiple sections is preserved as one message (we don't try to split into turns)`
- `skill resources are NOT exported as MCP resources in this plan (deferred)`

**Implementation** (`packages/llmist/src/mcp/skill-exporter.ts`):
- Function: `skillToMcpPrompt(skill: Skill): McpPromptDescriptor`.
- Function: `renderSkillForMcpPrompt(skill: Skill, args: Record<string, unknown>): McpPromptResult` — calls `skill.getInstructions()`, then `substituteArguments` (existing helper), then wraps in a user-role message.

### 3. Capability advertisement

**Tests first** (`packages/llmist/src/mcp/server-capabilities.test.ts`):
- `advertises tools capability when at least one gadget is registered`
- `advertises prompts capability when at least one skill is registered`
- `omits prompts capability when no skills are registered (zero-skill case)`
- `does NOT advertise resources, sampling, or elicitation in v1`
- `protocol version defaults to 2025-06-18`

**Implementation** (`packages/llmist/src/mcp/server-capabilities.ts`):
- Function: `buildServerCapabilities(opts: { hasTools: boolean; hasPrompts: boolean }): McpServerCapabilities`.

### 4. Server module

**Tests first** (`packages/llmist/src/mcp/server.test.ts`):
- `createMcpServer({ gadgets, skills }) returns a server handle with start/stop methods`
- `start() connects the SDK's Server with stdio transport`
- `initialize handshake returns the negotiated capabilities and protocol version`
- `tools/list returns the exported gadget descriptors in deterministic order (alphabetical by name)`
- `tools/call routes to the matching gadget and returns its content`
- `tools/call with invalid args (fails Zod validation) returns isError=true with a clear message`
- `tools/call for an unknown tool name returns a JSON-RPC method-not-found error`
- `prompts/list returns the exported skill descriptors`
- `prompts/get routes to the matching skill and returns rendered messages`
- `stop() cleanly closes the transport`

**Implementation** (`packages/llmist/src/mcp/server.ts`):
- Lazy-import the SDK's `Server` class.
- Function: `createMcpServer(opts: { gadgets: GadgetRegistry; skills?: SkillRegistry; protocolVersion?: string }): McpServerHandle`.
- Wires SDK request handlers for `initialize`, `tools/list`, `tools/call`, `prompts/list`, `prompts/get`.
- Each handler delegates to the matching exporter from steps 1–2.
- Returns a handle: `{ start(): Promise<void>; stop(): Promise<void>; readonly running: boolean }`.

### 5. Server lifecycle

**Tests first** (`packages/llmist/src/mcp/server-lifecycle.test.ts`):
- `server stops when stdin closes (parent disconnected)`
- `server stops on SIGTERM`
- `server stops on SIGINT`
- `multiple stop() calls are idempotent`
- `signal handlers are removed after stop completes (no leaked listeners)`

**Implementation** (`packages/llmist/src/mcp/server-lifecycle.ts`):
- Wires up `process.stdin.on('end', ...)`, `process.on('SIGTERM', ...)`, `process.on('SIGINT', ...)`.
- Calls `server.stop()` and exits the process cleanly with code 0.

### 6. CLI `mcp serve` subcommand

**Tests first** (`packages/cli/src/mcp/serve-command.test.ts`):
- `--gadgets ./fixtures/example-gadgets imports gadgets from a local path and registers them`
- `--gadgets dhalsim:minimal pulls from npm with the existing external-gadget loader (mocked)`
- `--skills <dir> loads skills from a directory and registers them`
- `--gadgets and --skills can be combined`
- `--gadgets repeated flag accumulates`
- `--protocol-version override is honored`
- `serve command exits cleanly with code 0 when stdin closes`
- `serve command exits with non-zero code when initialization fails (e.g., gadget import failure)`

**Implementation** (`packages/cli/src/mcp/serve-command.ts`):
- Reuses existing external-gadget specifier parser from `packages/cli/src/external-gadgets.ts`.
- Reuses existing skill-loading from `packages/llmist/src/skills/loader.ts`.
- Builds a `GadgetRegistry` and (optional) `SkillRegistry`.
- Calls `createMcpServer(...)`, wires lifecycle, calls `start()`.
- Logging: stderr only (stdout is reserved for MCP JSON-RPC traffic); use existing tslog with stderr stream.

**Implementation** (`packages/cli/src/mcp/mcp-command.ts`):
- Extend the `mcp` command (introduced in plan 2) with the `serve` subcommand.

### 7. Roundtrip integration

**Tests first** (`packages/llmist/src/e2e/mcp-roundtrip.e2e.test.ts`):
- `spawns llmist mcp serve as a subprocess with a known fixture gadget; connects an in-test agent (using plan 1's withMcpServer) to that subprocess; agent calls the exposed gadget; gadget executes; result reaches the agent`
- `spawns llmist mcp serve --skills <fixture-dir>; connects an agent; agent loads a prompt; prompt is rendered with arguments`
- `parent (in-test agent) abort cleans up the spawned mcp serve subprocess (no orphan)`

**Implementation:**
- Test fixture: a tiny gadget package at `packages/llmist/src/e2e/fixtures/mcp-roundtrip-gadgets.ts` with a deterministic `EchoGadget`.
- Test fixture: skills directory at `packages/llmist/src/e2e/fixtures/mcp-roundtrip-skills/` with a small SKILL.md.
- Test spawns the actual built `llmist` CLI binary from `packages/cli/bin/...` via `child_process.spawn`.

### 8. MCP Inspector sanity (manual + automated smoke)

**Tests** (`packages/llmist/src/mcp/inspector-smoke.test.ts`):
- `tools/list output validates against the JSON Schema published by the MCP spec for ListToolsResult` (schema fetched from a pinned local copy under `packages/llmist/src/mcp/schemas/`)
- `each tool's inputSchema is a syntactically valid JSON Schema (validated with a JSON Schema validator like ajv installed only as a dev dep)`
- `prompts/list output validates against the spec schema`

**Manual verification step (documented, not automated):**
- Documentation must include a runnable command that pipes the running server through `npx @modelcontextprotocol/inspector` and confirms tools and prompts list correctly. This is for the docs walkthrough — not gated in CI.

### 9. Examples

**No tests** (examples are smoke-tested manually).

**Implementation** (`examples/29-mcp-expose.ts`):
- Programmatic example: builds a small `GadgetRegistry` with a `Calculator` gadget and a small `SkillRegistry` with a `code-review` SKILL.md (inline string), then calls `createMcpServer(...)` and `start()`. Top-of-file comment explains how to wire this into Claude Code's config.

**Implementation** (`examples/30-mcp-roundtrip.ts`):
- Spawns `npx tsx examples/29-mcp-expose.ts` (or the installed CLI binary) as a subprocess, then runs an llmist agent that consumes it via `withMcpServer`. Demonstrates the complete loop.

### 10. Documentation

**Implementation:**
- `packages/docs/src/content/docs/cli/commands/mcp-serve.mdx` — new page: `llmist mcp serve` flags, examples, Claude Code installation walkthrough (steps to add to `~/.claude.json`), Cursor walkthrough (steps to add to Cursor's settings), MCP Inspector smoke test instructions.
- `packages/docs/src/content/docs/library/advanced/mcp-expose.mdx` — new page: `createMcpServer({ gadgets, skills })` library API, programmatic embedding.
- `README.md` — extend the existing MCP capability bullet from plan 1 with a one-liner about exposing.
- `CHANGELOG.md` — entry: `feat(mcp): exposer — llmist mcp serve publishes gadgets and skills as an MCP server (stdio)`.
- `CLAUDE.md` — extend the MCP commands subsection (started in plan 1) with `mcp serve`.
- `examples/README.md` — add rows for `29-mcp-expose.ts` and `30-mcp-roundtrip.ts`.

---

## Test Plan

### Unit tests
- [ ] `gadget-exporter.test.ts` — ~10 tests
- [ ] `skill-exporter.test.ts` — ~7 tests
- [ ] `server-capabilities.test.ts` — ~5 tests
- [ ] `server.test.ts` — ~10 tests
- [ ] `server-lifecycle.test.ts` — ~5 tests
- [ ] `serve-command.test.ts` — ~8 tests
- [ ] `inspector-smoke.test.ts` — ~3 tests

### Integration / E2E tests
- [ ] `mcp-roundtrip.e2e.test.ts` — ~3 tests covering tool roundtrip, prompt roundtrip, abort cleanup

### Acceptance tests
- Per-plan AC tests inline above.

---

## Acceptance Criteria (per-plan, testable)

1. `llmist mcp serve --gadgets <spec>` starts an MCP server over stdio; an MCP client (the in-test consumer) successfully completes the `initialize` handshake, calls `tools/list`, and calls one of the exposed tools — verified by `mcp-roundtrip.e2e.test.ts`.
2. `llmist mcp serve --gadgets <spec> --skills <dir>` additionally exposes prompts; `prompts/list` and `prompts/get` work correctly — verified by `mcp-roundtrip.e2e.test.ts`.
3. `gadgetToMcpTool` produces a tool descriptor whose `inputSchema` is identical to the JSON Schema produced by the existing `schemaToJSONSchema` for the same Zod schema — verified by unit test.
4. `skillToMcpPrompt` produces a prompt descriptor whose `arguments` are correctly mapped from the skill's frontmatter — verified by unit test.
5. The server advertises only the capabilities its inputs support: tools when gadgets are present, prompts when skills are present, neither resources nor sampling nor elicitation — verified by `server-capabilities.test.ts`.
6. The server stops cleanly on stdin close, SIGTERM, and SIGINT, with no leaked listeners — verified by `server-lifecycle.test.ts`.
7. The server's `tools/list` and `prompts/list` outputs validate against the pinned MCP spec JSON schemas — verified by `inspector-smoke.test.ts`.
8. The roundtrip example (`examples/30-mcp-roundtrip.ts`) runs end-to-end without errors — verified manually + smoke-tested in CI.
9. Documentation walks a user through adding the published server to Claude Code's `~/.claude.json` and successfully calling an exposed gadget; the walkthrough is **end-to-end runnable in under 10 minutes** from a fresh checkout.
10. All new/modified code has corresponding tests; total new test count is **≥ 45** in this plan.
11. `npm run build` passes from the repo root.
12. `npm run typecheck` passes from the repo root.
13. `npm run test` passes from the repo root.
14. `npm run lint` passes from the repo root.
15. All documentation listed in the Documentation Impact section has been written and renders.

**Spec roundtrip closure:**
- After this plan merges, the full spec acceptance criteria set should be green. `_coverage.md` will mark all 17 spec ACs as satisfied across plans 1–3.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `packages/docs/src/content/docs/cli/commands/mcp-serve.mdx` | New page: `mcp serve` flags, Claude Code install walkthrough, Cursor install walkthrough, Inspector smoke instructions. |
| `packages/docs/src/content/docs/library/advanced/mcp-expose.mdx` | New page: programmatic `createMcpServer` API, embedding inside another Node app. |
| `README.md` | Extend the existing MCP bullet (added in plan 1) with one-liner about `mcp serve`. |
| `CHANGELOG.md` | New entry: `feat(mcp): exposer — llmist mcp serve publishes gadgets and skills as an MCP server (stdio)`. |
| `CLAUDE.md` | Extend the MCP commands subsection (started in plan 1) with `mcp serve` and the security note about treating exposed gadgets as a public surface. |
| `examples/README.md` | Add rows for `29-mcp-expose.ts` and `30-mcp-roundtrip.ts`. |

---

## Out of Scope (this plan)

- Streamable HTTP transport for the exposer side (deferred to v1.5 follow-up spec).
- MCP `resources` advertisement (deferred to v1.5 follow-up).
- MCP `sampling` server-side support (server requesting our LLM — out of v1 scope, separate spec).
- MCP `elicitation` server-side support (mid-call user prompts — out of v1 scope, separate spec).
- MCP `roots` advertisement (out of v1, scoped to v1.5 follow-up).
- OAuth 2.1 / dynamic client registration (out of spec entirely; separate follow-up).
- HTTP+SSE legacy transport (out of spec entirely).
- A first-party llmist registry of MCP servers (out of spec entirely).
- Sandboxing primitives beyond the consumer-side allowlist that already exists (out of spec entirely).

---

## Progress

<!-- /implement updates these as it works. Do not edit manually. -->
- [ ] AC #1 (initialize + tools/call roundtrip)
- [ ] AC #2 (prompts/list + prompts/get with --skills)
- [ ] AC #3 (gadget→tool descriptor matches schemaToJSONSchema)
- [ ] AC #4 (skill→prompt descriptor maps arguments)
- [ ] AC #5 (capability advertisement is exact)
- [ ] AC #6 (clean shutdown on stdin close + signals)
- [ ] AC #7 (Inspector smoke validates against pinned schemas)
- [ ] AC #8 (roundtrip example runs)
- [ ] AC #9 (Claude Code 10-minute walkthrough is end-to-end runnable)
- [ ] AC #10 (≥ 45 new tests)
- [ ] AC #11 (`npm run build` passes)
- [ ] AC #12 (`npm run typecheck` passes)
- [ ] AC #13 (`npm run test` passes)
- [ ] AC #14 (`npm run lint` passes)
- [ ] AC #15 (docs render via `npm run docs:dev`)
