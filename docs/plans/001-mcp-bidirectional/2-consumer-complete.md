---
id: 001
slug: mcp-bidirectional
plan: 2
plan_slug: consumer-complete
level: plan
parent_spec: docs/specs/001-mcp-bidirectional.md
depends_on: [1-foundation.md]
status: pending
---

# 001/2: Consumer-complete — multi-server, HTTP, prompts, error isolation

> Part 2 of 3 in the 001-mcp-bidirectional plan. See [parent spec](../../specs/001-mcp-bidirectional.md).

## Summary

Builds on plan 1's foundation to deliver the **complete consumer story**. After this plan ships, an llmist agent can attach an arbitrary number of MCP servers (mixing stdio and Streamable HTTP transports), consume their tools and prompts, recover gracefully from server crashes / tool errors / disconnects, honor llmist's existing gadget permission policy and hook system, and survive process-lifecycle edge cases (SIGTERM, SIGINT, graceful shutdown windows). Users gain the full TOML schema (`[mcp.servers.<name>]`) and a one-shot `llmist mcp import-claude-code` command that lifts existing setup from `~/.claude.json`.

This plan does NOT deliver the exposer side (that's plan 3). It also does not implement reconnect-on-disconnect, MCP resources, MCP roots, OAuth, or the deferred MCP primitives (sampling, elicitation) — those are spec-level non-goals.

**Components delivered:**
- `packages/llmist/src/mcp/http-transport.ts` — wraps the SDK's `StreamableHTTPClientTransport`, exposes the same surface as the stdio transport in `client.ts`
- `packages/llmist/src/mcp/client.ts` — extended with HTTP transport selection (transport-agnostic factory), reconnect-on-init, and richer error typing
- `packages/llmist/src/mcp/multi-server.ts` — name-conflict resolution: when two servers expose tools with the same name, prefix the colliding tool with `<server>__` (deterministic, alphabetic order); pass-through when unique
- `packages/llmist/src/mcp/prompt-adapter.ts` — converts an MCP prompt descriptor into a loadable skill-like artifact via the existing skill-loading pathway
- `packages/llmist/src/mcp/capability-negotiation.ts` — reads server capabilities, only registers what's advertised, logs a one-time warning per unsupported primitive (resources, sampling, elicitation)
- `packages/llmist/src/mcp/error-isolation.ts` — wraps every MCP request with a try/catch that converts SDK errors and tool-error responses into typed errors usable as gadget trailing messages
- `packages/llmist/src/mcp/lifecycle.ts` — extended with signal handlers (SIGTERM, SIGINT) and a configurable graceful shutdown window (`shutdownTimeoutMs`)
- `packages/llmist/src/agent/agent.ts` — wires MCP-backed gadget calls through the existing hooks pipeline (Observers, Interceptors, Controllers) with origin metadata `{ origin: { type: 'mcp', server: <name> } }`
- `packages/cli/src/config-types.ts` — extended `LlmistConfig` with `mcp?: { servers?: Record<string, McpServerTomlSpec> }`
- `packages/cli/src/config.ts` — TOML parsing for the `[mcp.servers.<name>]` block
- `packages/cli/src/config-validators.ts` — schema validator for the new TOML block
- `packages/cli/src/mcp/mcp-command.ts` — top-level `llmist mcp` subcommand router (this plan: `import-claude-code` only; plan 3 adds `serve`)
- `packages/cli/src/mcp/import-claude-code.ts` — parses `~/.claude.json` (or `$CLAUDE_CONFIG_HOME` override), extracts MCP servers, emits TOML blocks (stdout by default, `--write` appends to llmist config)
- `packages/cli/src/agent-command.ts` and `packages/cli/src/complete-command.ts` — wire TOML-defined MCP servers into the agent builder, in addition to plan 1's `--mcp-server` ad-hoc flag
- `packages/cli/src/tui/` (relevant existing TUI files) — show MCP server origin badge on gadget execution tree nodes
- `packages/llmist/src/agent/file-logging.ts` — include `origin` field in logged gadget calls
- `packages/docs/src/content/docs/library/advanced/mcp.mdx` — extended with multi-server, HTTP, prompts, error handling, hooks
- `packages/docs/src/content/docs/cli/configuration/toml-reference.md` (existing) — extended with `[mcp.servers.<name>]` schema
- `packages/docs/src/content/docs/cli/commands/mcp-import-claude-code.mdx` — new page
- `CHANGELOG.md` — entry

**Deferred to later plans in this spec:**
- `llmist mcp serve` (exposer), gadget → MCP tool exporter, skill → MCP prompt exporter, roundtrip test → plan 3

---

## Spec ACs satisfied by this plan

- **Spec AC #2** (multi-server with conflict resolution) — **full** (combined with plan 1's single-server foundation)
- **Spec AC #3** (TOML config) — **full** (combined with plan 1's `--mcp-server` ad-hoc flag)
- **Spec AC #4** (claude-code import) — **full**
- **Spec AC #10** (TUI/log MCP origin display) — **full**
- **Spec AC #11** (permission policy integration) — **full**
- **Spec AC #12** (zero overhead when MCP not used) — **full** (re-verified — must be preserved as the consumer surface grows)
- **Spec AC #13** (server crash isolation) — **full**
- **Spec AC #14** (process hygiene) — **full** (signal handling + graceful shutdown completes the work plan 1 began)
- **Spec AC #15** (capability negotiation degrades cleanly) — **full**
- **Spec AC #17** (E2E coverage — consumer-side parts) — **partial** (this plan adds multi-server, HTTP, prompts, and error E2E; plan 3 adds expose-side and roundtrip)

---

## Depends On

- **Plan 1 (`foundation`)** — provides the SDK install, `McpClient`, `mcpToolToGadget`, allowlist gate, basic lifecycle, library `withMcpServer` API, and the CLI `--mcp-server` ad-hoc flag.
- Existing `packages/llmist/src/skills/` (used as the loading pathway for MCP prompts).
- Existing `packages/llmist/src/agent/hook-composer.ts` (used to attach origin metadata to MCP-backed gadget call events).
- Existing `packages/cli/src/config.ts`, `config-types.ts`, `config-validators.ts` (extended with new MCP TOML schema).
- Existing TUI execution-tree rendering (extended with origin badge).

---

## Detailed Task List (TDD)

### 1. Streamable HTTP transport

**Tests first** (`packages/llmist/src/mcp/http-transport.test.ts`):
- `connect+listTools against a fake HTTP server returns tools`
- `respects Authorization header from spec.headers`
- `surface 401/403 as McpAuthError with actionable message`
- `surface network timeout as McpConnectError`
- `propagates session id across requests when server provides one`

**Implementation** (`packages/llmist/src/mcp/http-transport.ts`):
- Lazy-import `StreamableHTTPClientTransport` from the SDK.
- Function: `createHttpTransport(spec: HttpServerSpec): StreamableHTTPClientTransport`.
- Spec shape: `{ name, transport: 'http', url, headers?, timeoutMs? }`.
- Wrap in the same try/catch shape as stdio for typed errors.

**Implementation in** `packages/llmist/src/mcp/client.ts`:
- Add a transport factory: `createTransport(spec): Promise<Transport>` that returns stdio or HTTP based on `spec.transport`.
- Update `McpClient` constructor to call the factory.

### 2. Multi-server name-conflict resolution

**Tests first** (`packages/llmist/src/mcp/multi-server.test.ts`):
- `unique tool names across servers pass through unchanged`
- `colliding tool names are prefixed with <server>__ deterministically`
- `prefix uses alphabetical server-name order so the same input produces the same output across runs`
- `description of a prefixed tool annotates which server it came from`
- `attaching three servers with overlapping namespaces resolves correctly`
- `prefixing applies to the gadget registered with the agent's GadgetRegistry`

**Implementation** (`packages/llmist/src/mcp/multi-server.ts`):
- Function: `resolveToolNames(serversWithTools: Array<{ server: McpServerSpec; tools: McpToolDescriptor[] }>): Array<{ server: McpServerSpec; tools: McpToolDescriptor[]; prefix?: string }>`.
- Group all tool names; identify collisions; sort server names alphabetically; assign prefix `<server>__` to colliding tools (with original name kept inside the descriptor for `tools/call`).
- Wire into `agent/builder.ts`: instead of the plan-1 single-server adapter call, build the conflict-resolved list, then call `mcpToolToGadget(tool, client, { prefix })` for each.

### 3. MCP prompts

**Tests first** (`packages/llmist/src/mcp/prompt-adapter.test.ts`):
- `converts MCP prompt descriptor into a loadable skill-like artifact`
- `prompt arguments map to skill arguments with names, descriptions, and required flags`
- `prompts/get with arguments returns rendered messages`
- `prompt without arguments still loads`
- `MCP prompt registers as user-invocable via existing /<prompt-name> slash handler`
- `MCP prompt is also model-invocable via the existing skill-load gadget`

**Implementation** (`packages/llmist/src/mcp/prompt-adapter.ts`):
- Function: `mcpPromptToSkill(prompt: McpPromptDescriptor, client: McpClient, opts?: { prefix?: string }): Skill`.
- Build a `Skill` (or skill-like artifact compatible with `SkillRegistry`) whose `getInstructions()` calls `client.getPrompt(prompt.name, args)` and joins the returned messages.
- Frontmatter shape is synthesized: `name`, `description`, `arguments` (mapped from prompt args).
- The `agent/builder.ts` path adds these to the agent's effective skill registry alongside native skills.

**Implementation in** `packages/cli/src/skills/slash-handler.ts`:
- Extend slash handler to recognize MCP-prompt-backed skills the same as native skills (origin metadata is the only difference).

### 4. Capability negotiation

**Tests first** (`packages/llmist/src/mcp/capability-negotiation.test.ts`):
- `server advertising only tools registers tools, skips prompts (no error)`
- `server advertising tools+prompts registers both`
- `server advertising resources/sampling/elicitation logs a one-time warning per primitive and skips them`
- `same warning is not emitted twice in the same agent run`

**Implementation** (`packages/llmist/src/mcp/capability-negotiation.ts`):
- Function: `negotiateCapabilities(serverCaps: McpServerCapabilities, logger: Logger): NegotiatedCapabilities`.
- Returns a struct: `{ tools: boolean; prompts: boolean }`.
- Emits one-time warnings (tracked via a Set) for unsupported primitives.

### 5. Error isolation + connection-drop handling

**Tests first** (`packages/llmist/src/mcp/error-isolation.test.ts`):
- `MCP tool returning isError=true surfaces as a gadget error trailing message; agent continues`
- `MCP server transport disconnect mid-call surfaces as a typed error; agent continues; subsequent calls to that server fail fast with a clear message`
- `MCP server crash during agent.run() does not crash the agent`
- `tool call timeout (configurable) surfaces as a TimeoutException reusing the existing exception type`
- `agent abort propagates to in-flight MCP tool calls (cancelled via AbortSignal)`

**Implementation** (`packages/llmist/src/mcp/error-isolation.ts`):
- Function: `withMcpErrorIsolation<T>(serverName: string, op: () => Promise<T>): Promise<T>`.
- Catches SDK errors, transport errors, and `isError=true` responses; converts to typed errors.
- Wires `AbortSignal` from the agent's existing abort plumbing into the SDK's call-tool API.

**Implementation in** `packages/llmist/src/mcp/client.ts`:
- After a transport error, mark the client as `disconnected`; subsequent calls fast-fail with a clear message instead of attempting reconnect (reconnect deferred).

### 6. Lifecycle (full)

**Tests first** (`packages/llmist/src/mcp/lifecycle.test.ts` — extend):
- `SIGTERM to parent process triggers closeAll on registered clients`
- `SIGINT to parent process triggers closeAll on registered clients`
- `closeAll completes within shutdownTimeoutMs; force-kills children that don't exit gracefully`
- `signal handlers do not interfere with the agent's existing abort handling`
- `signal handlers are removed after closeAll completes (no leaked listeners)`

**Implementation** (`packages/llmist/src/mcp/lifecycle.ts`):
- Extend `McpLifecycle` with `installSignalHandlers()` and `removeSignalHandlers()`.
- `closeAll` first sends graceful shutdown to all clients; if any don't complete within `shutdownTimeoutMs` (default 5000), force-kill via `process.kill(pid, 'SIGKILL')`.

### 7. Permission policy integration

**Tests first** (`packages/llmist/src/agent/agent.test.ts` extension or `packages/cli/src/agent-command.test.ts` extension):
- `MCP-backed gadget tagged "denied" in permission policy never executes`
- `MCP-backed gadget tagged "approval-required" prompts user before executing`
- `MCP-backed gadget tagged "allowed" runs without prompting`
- `wildcard "*" default applies to MCP-backed gadgets the same as native ones`
- `permission decisions are based on the resolved (post-prefix) gadget name when conflict resolution prefixes apply`

**Implementation:**
- The MCP-backed gadgets are already standard `AbstractGadget` instances (per plan 1's adapter), so they inherit the existing permission resolver. New tests confirm the policy applies; minor wiring in `gadget-permissions` resolver to confirm origin metadata doesn't bypass the resolver.

### 8. Hooks / observability + origin metadata

**Tests first** (`packages/llmist/src/agent/hooks.test.ts` extension or new file):
- `Observers receive ObserveGadgetStartContext with origin: { type: 'mcp', server: <name> }`
- `Observers receive ObserveGadgetCompleteContext with the same origin metadata`
- `Interceptors can transform MCP gadget params and results`
- `Controllers can short-circuit MCP gadget calls`
- `origin metadata is also visible in the execution tree node`

**Implementation:**
- `packages/llmist/src/agent/hook-composer.ts`: extend the gadget-call event payload with an optional `origin` field.
- `packages/llmist/src/core/execution-events.ts`: extend the relevant event types with `origin`.
- `packages/llmist/src/core/execution-tree.ts`: store `origin` on `GadgetNode`.
- `packages/llmist/src/mcp/tool-adapter.ts` (extension to plan 1's adapter): attach `origin` to the produced gadget so the executor surfaces it on every event.

### 9. TUI origin badge + log origin field

**Tests first** (relevant TUI/log test file extensions):
- `TUI execution-tree node renders an MCP origin badge with the server name`
- `file logger writes origin field for MCP-backed gadget calls`
- `existing native gadgets still render with no origin badge (no regression)`

**Implementation:**
- TUI rendering files (`packages/cli/src/tui/...`) — small visual addition to the gadget node renderer.
- `packages/llmist/src/agent/file-logging.ts` — include origin in serialized log entries.

### 10. TOML schema

**Tests first** (`packages/cli/src/config-validators.test.ts` extension):
- `valid [mcp.servers.foo] block with stdio transport parses`
- `valid block with HTTP transport parses`
- `block missing required transport field rejected with clear error`
- `block with invalid transport value rejected`
- `unknown extra fields produce a warning but don't reject (forward-compat)`

**Implementation** (`packages/cli/src/config-types.ts`):
- New types: `McpServerTomlSpec` (union of stdio + http variants), `McpConfig` (servers map).
- Add to `LlmistConfig`.

**Implementation** (`packages/cli/src/config.ts`):
- Parse `[mcp.servers.<name>]` blocks; map them to `McpServerSpec` for the agent builder.
- Resolution order: TOML servers first, then `--mcp-server` ad-hoc flags appended; conflict on name = TOML wins, ad-hoc flag emits a warning.

**Implementation** (`packages/cli/src/config-validators.ts`):
- Validator for the new types.

### 11. `llmist mcp import-claude-code`

**Tests first** (`packages/cli/src/mcp/import-claude-code.test.ts`):
- `parses real-shape ~/.claude.json snippet with one stdio server`
- `parses snippet with multiple servers (mix of stdio and HTTP if Claude Code stores them)`
- `emits TOML blocks to stdout by default`
- `--write appends to ~/.llmist/config.toml without overwriting existing config`
- `--write does not duplicate an existing server name; emits a clear conflict warning`
- `unsupported entries (e.g. unknown server kinds) are skipped with a warning, not rejected`
- `respects $CLAUDE_CONFIG_HOME env override`
- `clear error when ~/.claude.json doesn't exist`

**Implementation** (`packages/cli/src/mcp/import-claude-code.ts`):
- Function: `importClaudeCodeMcp(opts: { source?: string; write?: string | boolean }): Promise<{ tomlBlocks: string[]; warnings: string[] }>`.
- Default source: `$CLAUDE_CONFIG_HOME ?? path.join(os.homedir(), '.claude.json')`.
- Default write target: `path.join(os.homedir(), '.llmist', 'config.toml')`.
- Translate Claude Code's MCP shape into our `McpServerTomlSpec` shape.

**Implementation** (`packages/cli/src/mcp/mcp-command.ts`):
- Top-level `llmist mcp <subcommand>` router using Commander.
- Wires `import-claude-code` subcommand. Plan 3 will add `serve`.

**Implementation** (`packages/cli/src/program.ts` or analogous):
- Register the `mcp` command on the program.

### 12. Re-verify zero-overhead invariant

**Tests** (`packages/llmist/src/mcp/no-overhead.test.ts`):
- `building an agent without MCP specs does not import any file under packages/llmist/src/mcp/`
- `building an agent without MCP specs does not import @modelcontextprotocol/sdk`

**Implementation:**
- Check that all MCP-related imports are dynamic (`await import('./mcp/...')`) and gated on `mcpSpecs.length > 0`.

### 13. Documentation

**Implementation:**
- `packages/docs/src/content/docs/library/advanced/mcp.mdx` — extend with multi-server, HTTP transport, prompts, error handling, hooks, origin metadata.
- `packages/docs/src/content/docs/cli/configuration/toml-reference.md` — extend with `[mcp.servers.<name>]` schema and examples.
- `packages/docs/src/content/docs/cli/commands/mcp-import-claude-code.mdx` — new page covering the import command.
- `CHANGELOG.md` — entry: `feat(mcp): consumer-complete — multi-server, HTTP, prompts, error isolation, claude-code import`.

---

## Test Plan

### Unit tests
- [ ] `http-transport.test.ts` — ~5 tests
- [ ] `multi-server.test.ts` — ~6 tests
- [ ] `prompt-adapter.test.ts` — ~6 tests
- [ ] `capability-negotiation.test.ts` — ~4 tests
- [ ] `error-isolation.test.ts` — ~5 tests
- [ ] `lifecycle.test.ts` (extension) — ~5 new tests for signals/graceful shutdown
- [ ] `import-claude-code.test.ts` — ~8 tests
- [ ] `config-validators.test.ts` (extension) — ~5 new tests for MCP TOML
- [ ] `hooks.test.ts` (extension) — ~5 new tests for origin metadata
- [ ] `no-overhead.test.ts` — 2 tests

### Integration tests
- [ ] `mcp/multi-server.integration.test.ts` — agent with two MCP clients (mocked), verify conflict resolution + permission policy + hooks
- [ ] `mcp/error-isolation.integration.test.ts` — server-crash, tool-error, abort scenarios end-to-end through the agent run loop

### E2E tests
- [ ] `packages/llmist/src/e2e/mcp-multi.e2e.test.ts` — two real MCP servers attached (Filesystem + a second small public server), agent uses both, both origin tags present in logs
- [ ] `packages/llmist/src/e2e/mcp-http.e2e.test.ts` — an HTTP MCP server (a tiny in-process express stub or mock) connected via Streamable HTTP, agent uses it
- [ ] `packages/llmist/src/e2e/mcp-prompts.e2e.test.ts` — a prompt-providing server, agent loads a prompt by slash-command, response correctly composed

### Acceptance tests
- Per-plan AC tests inline above; cross-references called out.

---

## Acceptance Criteria (per-plan, testable)

1. Two or more MCP servers can be attached to one agent simultaneously; tool name conflicts resolve via deterministic `<server>__<tool>` prefix; verified by unit + integration + E2E tests.
2. Streamable HTTP transport works against a stub HTTP MCP server; the spec accepts `transport: 'http'` and a URL; verified by unit + E2E tests.
3. MCP prompts are discoverable and loadable through the existing slash-handler and skill-loading meta-gadget; verified by unit + E2E tests.
4. Server crashes, tool errors, transport disconnects, and timeouts are isolated — the agent receives a typed error trailing message and continues running; verified by integration tests.
5. SIGTERM/SIGINT to the parent process triggers graceful shutdown of all spawned MCP children within `shutdownTimeoutMs` (default 5s); verified by unit tests.
6. MCP-backed gadgets honor the gadget permission policy (`allowed` / `denied` / `approval-required`); verified by integration tests.
7. MCP-backed gadget calls flow through Observers, Interceptors, and Controllers with `origin: { type: 'mcp', server: <name> }` metadata; verified by hooks unit tests.
8. TUI execution-tree nodes for MCP-backed gadgets show an origin badge; file logs include the `origin` field; verified by unit tests.
9. The TOML `[mcp.servers.<name>]` schema parses valid blocks for both stdio and HTTP transports; rejects malformed blocks with a clear error; verified by config-validator unit tests.
10. `llmist mcp import-claude-code` reads `~/.claude.json`, emits TOML blocks, and supports `--write` to append to llmist config without clobbering existing settings; verified by unit tests with snapshot fixtures.
11. Building an agent without any MCP servers configured does not import the `mcp/` module or the SDK — zero overhead invariant preserved; verified by `no-overhead.test.ts`.
12. Capability negotiation: server advertising only tools doesn't error on missing prompts; advertising unsupported primitives produces a one-time logged warning per primitive; verified by unit tests.
13. All new/modified code has corresponding tests; total new test count is **≥ 60** in this plan.
14. `npm run build` passes from the repo root.
15. `npm run typecheck` passes from the repo root.
16. `npm run test` passes from the repo root.
17. `npm run lint` passes from the repo root.
18. All documentation listed in the Documentation Impact section has been updated and renders.

**Partial-state criterion:**
- The exposer side (`llmist mcp serve`, gadget→tool exporter, skill→prompt exporter, roundtrip) is explicitly **not** delivered by this plan and is not expected to pass in this plan's scope.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `packages/docs/src/content/docs/library/advanced/mcp.mdx` | Extend with: multi-server example, HTTP transport, MCP prompts, error handling, hooks/observers, origin metadata. |
| `packages/docs/src/content/docs/cli/configuration/toml-reference.md` | Add `[mcp.servers.<name>]` block schema with examples for both stdio and HTTP. |
| `packages/docs/src/content/docs/cli/commands/mcp-import-claude-code.mdx` | New page: usage, flags, examples, conflict-handling. |
| `CHANGELOG.md` | New entry: `feat(mcp): consumer-complete — multi-server, HTTP, prompts, error isolation, claude-code import, hooks integration`. |

---

## Out of Scope (this plan)

- `llmist mcp serve` exposer command → plan 3.
- Gadget → MCP tool exporter, skill → MCP prompt exporter → plan 3.
- Roundtrip test (llmist consumes its own published server) → plan 3.
- Reconnect-on-disconnect (mark disconnected and fast-fail; reconnect explicitly deferred even past plan 3).
- OAuth 2.1 / dynamic client registration / RFC9728/8414/8707 (out of spec entirely; separate follow-up).
- MCP `sampling`, `elicitation`, `roots`, `resources` primitives (out of spec for v1).
- HTTP+SSE legacy transport (out of spec entirely).
- Cursor / Cline config import (out of plan; spec only requires `claude-code` import).
- Hosted, multi-tenant llmist-as-a-remote-MCP-service (out of spec entirely).

---

## Progress

<!-- /implement updates these as it works. Do not edit manually. -->
- [ ] AC #1 (multi-server + conflict resolution)
- [ ] AC #2 (Streamable HTTP transport)
- [ ] AC #3 (MCP prompts loadable via skill pathway)
- [ ] AC #4 (error isolation: crash/error/disconnect/timeout/abort)
- [ ] AC #5 (signal handling + graceful shutdown)
- [ ] AC #6 (permission policy integration)
- [ ] AC #7 (hooks pipeline + origin metadata)
- [ ] AC #8 (TUI badge + log origin field)
- [ ] AC #9 (TOML schema + validation)
- [ ] AC #10 (`mcp import-claude-code` command)
- [ ] AC #11 (zero-overhead invariant preserved)
- [ ] AC #12 (capability negotiation downgrade)
- [ ] AC #13 (≥ 60 new tests)
- [ ] AC #14 (`npm run build` passes)
- [ ] AC #15 (`npm run typecheck` passes)
- [ ] AC #16 (`npm run test` passes)
- [ ] AC #17 (`npm run lint` passes)
- [ ] AC #18 (docs render via `npm run docs:dev`)
