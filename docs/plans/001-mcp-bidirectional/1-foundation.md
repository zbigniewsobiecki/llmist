---
id: 001
slug: mcp-bidirectional
plan: 1
plan_slug: foundation
level: plan
parent_spec: docs/specs/001-mcp-bidirectional.md
depends_on: []
status: pending
---

# 001/1: Foundation — minimal stdio MCP consumer with security baseline

> Part 1 of 3 in the 001-mcp-bidirectional plan. See [parent spec](../../specs/001-mcp-bidirectional.md).

## Summary

Adds the `@modelcontextprotocol/sdk` dependency and a minimal MCP client adapter to the core `llmist` package. After this plan ships, an llmist agent can connect to **one** stdio MCP server (e.g., the public Filesystem MCP server), discover its tools, and use them through the standard streaming gadget block format. The library API is `AgentBuilder.withMcpServer(spec)`. The CLI gets a single-server `--mcp-server name=command -- args...` flag for ad-hoc use; the full TOML schema and multi-server experience land in plan 2.

This plan also lands the **security baseline** that gates every later plan: a STDIO command allowlist with explicit per-server `trust` opt-out (mitigates [CVE-2026-30623](https://docs.litellm.ai/blog/mcp-stdio-command-injection-april-2026)), basic process lifecycle (terminate child on agent abort/exit), capability handshake (we only register tools the server advertises), and lazy-loading so agents that don't use MCP pay zero overhead.

What this plan does NOT deliver: multi-server, Streamable HTTP transport, MCP prompts, the `mcp serve` exposer, the `mcp import-claude-code` command, the full TOML schema, hooks/observability integration beyond what falls out for free, capability-negotiation downgrade for unsupported primitives (logged but not exhaustively tested), reconnect-on-disconnect.

**Components delivered:**
- `packages/llmist/src/mcp/index.ts` — barrel export of the MCP module
- `packages/llmist/src/mcp/client.ts` — wraps the SDK's stdio client transport, exposes connect/listTools/callTool/close
- `packages/llmist/src/mcp/tool-adapter.ts` — converts an MCP tool descriptor into a native `createGadget` instance
- `packages/llmist/src/mcp/json-schema-to-zod.ts` — minimal JSON Schema → Zod converter for the subset MCP servers actually emit
- `packages/llmist/src/mcp/allowlist.ts` — default command allowlist + `assertCommandAllowed(cmd, trust)` check
- `packages/llmist/src/mcp/lifecycle.ts` — basic child-process lifecycle (spawn-tracked set, killAll on agent exit)
- `packages/llmist/src/mcp/types.ts` — public types: `McpServerSpec`, `McpServerHandle`
- `packages/llmist/src/agent/builder.ts` — extended with `withMcpServer(spec)` method (mutates internal `mcpSpecs[]`)
- `packages/llmist/src/agent/agent.ts` — extended `prepare()` path to spawn MCP servers, build adapter gadgets, register them in the agent's `GadgetRegistry`
- `packages/cli/src/agent-command.ts` and `packages/cli/src/complete-command.ts` — `--mcp-server` repeated flag (single-server ad-hoc usage)
- `examples/28-mcp-consume.ts` — runnable example using the real public Filesystem MCP server
- `packages/docs/src/content/docs/library/advanced/mcp.mdx` — library guide for `withMcpServer`
- `packages/docs/src/content/docs/cli/getting-started/mcp.mdx` — CLI getting-started page for the consume direction
- `packages/docs/src/content/docs/library/advanced/mcp-security.mdx` — security doc covering the allowlist posture and CVE context
- `README.md` — capability bullet under "Core Capabilities"
- `CHANGELOG.md` — entry
- `CLAUDE.md` — note about the new MCP commands and the allowlist gotcha

**Deferred to later plans in this spec:**
- Multi-server, Streamable HTTP, prompts, error-isolation polish, full TOML schema, claude-code import → plan 2
- `llmist mcp serve` (exposer), gadget→tool / skill→prompt exporter, roundtrip tests → plan 3

---

## Spec ACs satisfied by this plan

- **Spec AC #1** (library agent uses MCP server end-to-end) — **full**
- **Spec AC #2** (multi-server with conflict resolution) — **partial** (this plan delivers single-server connect-and-call; plan 2 delivers multi-server + name conflict resolution)
- **Spec AC #3** (TOML config) — **partial** (this plan delivers the `--mcp-server` ad-hoc CLI flag; plan 2 delivers the persistent TOML `[mcp.servers.<name>]` schema)
- **Spec AC #9** (allowlist by default + opt-in) — **full**
- **Spec AC #12** (zero overhead when MCP not used) — **full** (lazy `import()` for MCP module; verified in tests; revisited in plans 2 and 3 to keep the property)
- **Spec AC #14** (process hygiene) — **partial** (this plan delivers terminate-child-on-agent-exit/abort; plan 2 delivers signal handling and graceful shutdown windows)
- **Spec AC #16** (5-minute consume walkthrough) — **partial** (this plan delivers the consume-side walkthrough; plan 3 delivers the expose-side walkthrough)
- **Spec AC #17** (E2E coverage) — **partial** (this plan delivers consume-only E2E against a real public MCP server; plans 2 and 3 add multi-server, error, and roundtrip E2E)

---

## Depends On

- No prior plans (this is the foundation).
- Existing `packages/llmist/src/gadgets/create-gadget.ts` (used to wrap MCP tools as gadgets).
- Existing `packages/llmist/src/gadgets/registry.ts` (wrapped gadgets are added to the agent's effective registry).
- Existing `packages/llmist/src/agent/builder.ts` (gains the new `withMcpServer` method).
- Existing `packages/llmist/src/agent/agent.ts` (agent run lifecycle is extended for MCP server lifecycle).
- Existing `packages/cli/src/agent-command.ts` and `packages/cli/src/complete-command.ts` (add `--mcp-server` flag).
- Vitest test infrastructure (already configured).

---

## Detailed Task List (TDD)

### 1. Add the `@modelcontextprotocol/sdk` dependency

**No tests** (dependency wiring).

**Implementation:**
- `packages/llmist/package.json`: add `"@modelcontextprotocol/sdk": "^1.x"` to `dependencies` (pin the latest 1.x line at implement time).
- `packages/llmist/src/index.ts`: do **not** re-export the SDK; encapsulate it inside the `mcp/` module so consumers don't reach into vendor types.
- Run `npm install` and confirm `@modelcontextprotocol/sdk` resolves; commit `package-lock.json`.

### 2. JSON Schema → Zod converter

**Tests first** (`packages/llmist/src/mcp/json-schema-to-zod.test.ts`):
- `converts string schema with description and default` — `{type:'string', description:'foo', default:'bar'}` → `z.string().describe('foo').default('bar')`
- `converts number schema` — `{type:'number'}` → `z.number()`
- `converts integer schema` — `{type:'integer'}` → `z.number().int()`
- `converts boolean schema` — `{type:'boolean'}` → `z.boolean()`
- `converts string enum` — `{type:'string', enum:['a','b']}` → `z.enum(['a','b'])`
- `converts array of strings` — `{type:'array', items:{type:'string'}}` → `z.array(z.string())`
- `converts object with required and optional fields` — `{type:'object', properties:{x:{type:'string'},y:{type:'number'}}, required:['x']}` → object with `x` required, `y` optional
- `converts nested object` — round-trips a 2-level nested schema
- `passes through unknown/missing type as z.unknown()` — `{}` → `z.unknown()`
- `respects nullable: true` — `{type:'string', nullable:true}` → `z.string().nullable()`
- `respects oneOf with primitives as z.union` — `{oneOf:[{type:'string'},{type:'number'}]}` → `z.union([z.string(), z.number()])`
- `throws CleanError on schemas it cannot convert` — circular `$ref`, format-only schemas, etc.

**Implementation** (`packages/llmist/src/mcp/json-schema-to-zod.ts`):
- Function signature: `jsonSchemaToZod(schema: JSONSchemaLike, opts?: { strict?: boolean }): ZodTypeAny`.
- Recursive switch on `schema.type` for primitives and containers.
- Handle `enum`, `default`, `description`, `nullable`, `oneOf` (primitives only — fail loudly on richer composition for v1).
- On unsupported features (`$ref`, `allOf`, `anyOf` with non-primitives, format-only schemas) throw a typed error `JsonSchemaConversionError`.
- Export `JsonSchemaConversionError` and `JSONSchemaLike` type alias (subset of JSON Schema 2020-12 we accept).

### 3. Allowlist + security gate

**Tests first** (`packages/llmist/src/mcp/allowlist.test.ts`):
- `default allowlist contains expected runtimes` — `npx`, `node`, `uvx`, `python`, `python3`, `deno`, `bun`
- `accepts allowlisted command` — `assertCommandAllowed('npx', false)` returns void (no throw)
- `rejects non-allowlisted command without trust` — `assertCommandAllowed('curl', false)` throws `McpUntrustedCommandError`
- `accepts non-allowlisted command with trust=true` — `assertCommandAllowed('curl', true)` returns void
- `rejects argument-substitution-shaped command` — `assertCommandAllowed('npx -c "evil"', false)` (whole-string command with embedded args) throws — we accept only basename of an executable path, not a shell line
- `error message includes the command and the opt-in instructions`

**Implementation** (`packages/llmist/src/mcp/allowlist.ts`):
- Export `DEFAULT_MCP_COMMAND_ALLOWLIST: ReadonlySet<string>` containing: `npx`, `node`, `uvx`, `python`, `python3`, `deno`, `bun`.
- Function: `assertCommandAllowed(command: string, trusted: boolean, customAllowlist?: ReadonlySet<string>): void`.
- Reject any command containing whitespace before splitting (force the user to pass args separately).
- Compute basename of `command` via `path.basename`; lookup in allowlist.
- On reject, throw `McpUntrustedCommandError` whose message names the command and tells the user to set `trust: true` (library) or `trust = true` (TOML, plan 2 will document this) or pass `--mcp-trust <name>` (CLI flag, plan 2).

### 4. MCP client wrapper

**Tests first** (`packages/llmist/src/mcp/client.test.ts`):
- `connect+listTools returns the tools advertised by the mock server` (using a fake stdio transport that returns canned `initialize` + `tools/list` responses)
- `callTool with valid args returns the content blocks`
- `callTool with isError=true response surfaces an error result`
- `close terminates the underlying transport and child process`
- `connect rejects with McpUntrustedCommandError if command not allowlisted and trust=false`
- `respects per-server env override and timeout`
- `serverCapabilities is read from initialize response and exposed`

**Implementation** (`packages/llmist/src/mcp/client.ts`):
- Lazy-import the SDK at top of file via dynamic `import()` to keep cold-start cost off the hot path. Cache the imported module in a module-level promise.
- Class signature: `class McpClient { constructor(spec: McpServerSpec); async connect(): Promise<void>; listTools(): Promise<McpToolDescriptor[]>; callTool(name: string, args: unknown): Promise<McpToolResult>; close(): Promise<void>; readonly serverCapabilities: McpServerCapabilities | null; }`.
- Inside `connect()`: call `assertCommandAllowed`, then construct the SDK's `StdioClientTransport` with `{command, args, env}`, then construct the SDK's `Client` with `{name: 'llmist', version: <pkg-version>}` and `connect(transport)`.
- Track the spawned child process pid; expose for the lifecycle module.
- Catch SDK errors and re-throw as typed errors (`McpConnectError`, `McpToolCallError`).
- `close()` is idempotent; calling twice does nothing.

### 5. Tool adapter

**Tests first** (`packages/llmist/src/mcp/tool-adapter.test.ts`):
- `wraps an MCP tool as a native gadget with name+description+schema` — feed in `{name:'read_file', description:'reads', inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path']}}` → produced gadget has matching name, description, and Zod schema that validates `{path:'foo'}`
- `executing the wrapped gadget calls McpClient.callTool with the right args`
- `MCP text content block becomes gadget result string` — `[{type:'text', text:'hello'}]` → `'hello'`
- `multiple text content blocks are joined with newlines`
- `MCP image content block becomes gadget media output` — `{type:'image', data:'<base64>', mimeType:'image/png'}` → uses `resultWithImage` helper
- `MCP isError=true result throws gadget error with the text content`
- `gadget name is prefixed when prefix option provided` — pass `{prefix: 'fs__'}` → gadget name becomes `fs__read_file` (used by plan 2 for multi-server conflict resolution; passes-through in plan 1 with no prefix)
- `gracefully handles tool with no inputSchema` (some servers omit it for zero-arg tools) — produces a gadget with empty Zod object schema

**Implementation** (`packages/llmist/src/mcp/tool-adapter.ts`):
- Function signature: `mcpToolToGadget(tool: McpToolDescriptor, client: McpClient, opts?: { prefix?: string }): AbstractGadget`.
- Build the Zod schema by calling `jsonSchemaToZod(tool.inputSchema)` (or `z.object({})` for missing schema).
- Use existing `createGadget({ name, description, schema, execute })` to produce the gadget.
- `execute` calls `client.callTool(tool.name, params)`, then converts each content block:
  - `text` → join into a single string
  - `image` → `resultWithImage({ base64, mimeType })`
  - other types (audio, resource) → for v1 throw a clean error noting the content kind isn't yet supported.

### 6. Lifecycle (basic)

**Tests first** (`packages/llmist/src/mcp/lifecycle.test.ts`):
- `tracks spawned client and closes it on agent run completion`
- `closes all clients when one of them errors`
- `close is idempotent across rapid double-shutdown`
- `clients are removed from the tracked set on close`

**Implementation** (`packages/llmist/src/mcp/lifecycle.ts`):
- Class: `class McpLifecycle { register(client: McpClient): void; closeAll(): Promise<void>; readonly size: number; }`.
- `closeAll` awaits all `client.close()` calls in parallel; failures are collected and logged but don't propagate (closing on a teardown path must not throw).
- The agent owns one `McpLifecycle` per run.

### 7. AgentBuilder integration

**Tests first** (`packages/llmist/src/agent/builder.test.ts` — extend existing file):
- `withMcpServer adds the spec to internal state`
- `withMcpServer can be called multiple times — but in plan 1 the second call is allowed and accumulates; multi-server adapter wiring lands in plan 2`
- `building an agent without withMcpServer does not import the mcp module` — verify no `mcp/` module is required at build time when no specs are present (load-time test using a require-spy or import-counter)
- `building an agent with one withMcpServer attaches the adapter gadgets to the registry after agent.run() begins`

**Implementation** (`packages/llmist/src/agent/builder.ts`):
- Add `mcpSpecs: McpServerSpec[]` to internal state.
- Method: `withMcpServer(spec: McpServerSpec): this` — pushes to `mcpSpecs`.
- During agent build/`prepare`: if `mcpSpecs.length === 0`, do nothing (zero-overhead path). Otherwise, dynamic-import the mcp module, construct an `McpClient` per spec, `connect()` them in parallel, list tools, wrap them with `mcpToolToGadget`, register in the agent's `GadgetRegistry`. The lifecycle helper is stored on the agent instance and `closeAll()` is invoked from the agent's existing teardown / abort handler.
- Public type: `McpServerSpec` with fields `name`, `transport: 'stdio'`, `command`, `args?`, `env?`, `trust?`, `timeoutMs?`.

### 8. CLI single-server flag

**Tests first** (`packages/cli/src/agent-command.test.ts` and `packages/cli/src/complete-command.test.ts` — extend existing):
- `--mcp-server name=cmd parses into a spec`
- `--mcp-server can be repeated` (specs accumulate; multi-server wiring is plan 2 but parsing must handle it)
- `--mcp-server name=cmd -- arg1 arg2` parses args correctly (positional args after `--`)
- `--mcp-trust <name>` sets trust=true on the named spec
- `single --mcp-server end-to-end with mocked McpClient registers tools`

**Implementation** (`packages/cli/src/agent-command.ts`, `packages/cli/src/complete-command.ts`):
- Use existing Commander option parser; add `--mcp-server <spec...>` (repeated, value-collecting) and `--mcp-trust <name...>` (repeated).
- Parse `<name>=<command>` pairs; everything after `--` until the next `--mcp-server` belongs to the prior spec's args (use a small parser, not naive split).
- Translate parsed specs into `withMcpServer(spec)` calls on the builder.

### 9. Example

**No tests** (it's an example; smoke-tested manually).

**Implementation** (`examples/28-mcp-consume.ts`):
- Uses the public `@modelcontextprotocol/server-filesystem` package (npm) over `npx -y @modelcontextprotocol/server-filesystem /tmp`.
- Asks the agent to "list files in /tmp and tell me how many there are".
- Includes a top-of-file comment block with prereq install instructions and the security note (npx is in the default allowlist, so this works out of the box).

### 10. Documentation

**No tests** (prose).

**Implementation:**
- `packages/docs/src/content/docs/library/advanced/mcp.mdx` — covers `AgentBuilder.withMcpServer`, the spec shape, single-server example, the security gate, lifecycle expectations, and a "what's next" link to plan 2's feature set (multi-server, prompts, etc.).
- `packages/docs/src/content/docs/cli/getting-started/mcp.mdx` — covers `--mcp-server` flag with an example. Cross-link to library doc.
- `packages/docs/src/content/docs/library/advanced/mcp-security.mdx` — explains the default allowlist, why it exists (CVE-2026-30623 link), the per-server `trust` opt-in, and pointer to upcoming TOML config in plan 2.
- `README.md` — add an MCP bullet under "Core Capabilities" with a one-line example.
- `CHANGELOG.md` — `feat(mcp): add bidirectional MCP support — foundation (consume one stdio server)` entry under the next minor version.
- `CLAUDE.md` — add brief "MCP commands" section explaining `--mcp-server` flag and the allowlist gotcha.

---

## Test Plan

### Unit tests
- [ ] `packages/llmist/src/mcp/json-schema-to-zod.test.ts` — ~12 tests covering primitive types, enums, arrays, objects, nullable, oneOf, error paths
- [ ] `packages/llmist/src/mcp/allowlist.test.ts` — ~6 tests covering default allowlist, opt-in, error message
- [ ] `packages/llmist/src/mcp/client.test.ts` — ~7 tests using a fake stdio transport
- [ ] `packages/llmist/src/mcp/tool-adapter.test.ts` — ~8 tests covering schema, content-block conversion, error
- [ ] `packages/llmist/src/mcp/lifecycle.test.ts` — ~4 tests covering teardown
- [ ] `packages/llmist/src/agent/builder.test.ts` (extension) — ~4 new tests covering `withMcpServer`
- [ ] `packages/cli/src/agent-command.test.ts` (extension) — ~5 new tests covering `--mcp-server` flag
- [ ] `packages/cli/src/complete-command.test.ts` (extension) — ~3 new tests covering `--mcp-server` flag

### Integration tests
- [ ] In-process integration: agent + mocked McpClient end-to-end — ~3 tests in `packages/llmist/src/mcp/integration.test.ts` (covers register-and-call, server-error-passthrough, abort-during-call)

### E2E test
- [ ] `packages/llmist/src/e2e/mcp-consume.e2e.test.ts` — spawns `npx -y @modelcontextprotocol/server-filesystem /tmp` as a real subprocess, runs an agent (with mocked LLM via `mockLLM` helper) that calls `list_directory`, asserts the response is parsed correctly. Gated behind `LLMIST_E2E_NETWORK=1` env so CI can opt out, but runs in the standard E2E config locally and on opt-in CI.

### Acceptance tests
- [ ] Per-plan AC tests inline in the unit/integration files above; cross-references called out in this document.

---

## Acceptance Criteria (per-plan, testable)

1. `AgentBuilder.withMcpServer(spec)` accepts a spec object and registers MCP-backed gadgets on the resulting agent's registry. Verified by unit + integration tests in `builder.test.ts` and `integration.test.ts`.
2. The built agent successfully connects to a real public MCP server (`@modelcontextprotocol/server-filesystem` over `npx`) and calls one of its tools end-to-end (E2E test).
3. Calling `withMcpServer` with a `command` that is not in the allowlist and without `trust: true` throws a `McpUntrustedCommandError` whose message names the command and tells the user how to opt in.
4. The `jsonSchemaToZod` utility correctly converts the JSON Schema subset MCP servers emit (covered by unit tests).
5. The `mcpToolToGadget` adapter correctly handles MCP `text`, `image`, and `isError` response shapes.
6. When `agent.run()` exits (success, abort, or error), every spawned MCP child process is terminated (no orphans). Verified by integration test with a mock client and an abort.
7. `--mcp-server name=cmd ...` and `--mcp-trust name` are parsed correctly and result in the matching `withMcpServer` call on the builder.
8. Building an agent without any `withMcpServer` calls does not import the `mcp/` module — verified by an import-tracking test.
9. All new/modified code has corresponding tests; total new test count is **≥ 50** in this plan.
10. `npm run build` passes from the repo root.
11. `npm run typecheck` passes from the repo root.
12. `npm run test` passes from the repo root.
13. `npm run lint` passes from the repo root (Biome).
14. All documentation listed in the Documentation Impact section has been written and renders correctly via `npm run docs:dev`.
15. The single-server consume walkthrough in `cli/getting-started/mcp.mdx` is **end-to-end runnable** in under 5 minutes from a fresh checkout (with `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in env).

**Partial-state criterion:**
- Multi-server, Streamable HTTP, prompts, error isolation polish, full TOML schema, claude-code import, hooks/observability, and the `mcp serve` exposer are all explicitly **not** delivered by this plan and are not expected to pass in this plan's scope. Reviewers should ignore those gaps.

---

## Documentation Impact (this plan only)

| File | Change |
|---|---|
| `README.md` | New bullet under "Core Capabilities" introducing MCP support, with a one-line example using `withMcpServer`. |
| `CHANGELOG.md` | New entry under the next minor version: `feat(mcp): add bidirectional MCP support — foundation (consume one stdio server)`. |
| `CLAUDE.md` | New short subsection under "Commands" or "Key Concepts" describing `--mcp-server` and the allowlist gotcha. |
| `packages/docs/src/content/docs/library/advanced/mcp.mdx` | New page: library API for MCP consume — `withMcpServer` reference, single-server example, security gate. |
| `packages/docs/src/content/docs/library/advanced/mcp-security.mdx` | New page: allowlist posture, CVE-2026-30623 context, opt-in flow. |
| `packages/docs/src/content/docs/cli/getting-started/mcp.mdx` | New page: CLI consume walkthrough with `--mcp-server` and a real public MCP server. |
| `examples/README.md` | Add `28-mcp-consume.ts` row to the table. |

---

## Out of Scope (this plan)

- Multi-server, name-conflict resolution → plan 2.
- Streamable HTTP transport → plan 2.
- MCP `prompts` primitive → plan 2.
- Full `[mcp.servers.<name>]` TOML schema → plan 2.
- `llmist mcp import-claude-code` command → plan 2.
- Capability negotiation downgrade for unsupported primitives (resources, sampling, elicitation) → plan 2 (logged in plan 1 but not exhaustively tested).
- Hooks / observability fan-out for MCP-backed gadgets → plan 2.
- Permission policy integration → plan 2.
- Reconnect / retry on transport disconnect → plan 2 (and likely deferred further).
- TUI display of MCP server origin → plan 2.
- `llmist mcp serve` exposer command → plan 3.
- Gadget → MCP tool exporter, skill → MCP prompt exporter → plan 3.
- Roundtrip test (llmist consumes its own published server) → plan 3.
- OAuth 2.1, dynamic client registration, RFC9728/8414/8707 (out of spec entirely).
- MCP `sampling`, `elicitation`, `roots`, `resources` primitives (out of spec for v1; resources/roots scoped to v1.5 follow-up).
- HTTP+SSE legacy transport (out of spec entirely; deprecated upstream).
- `llmist`-hosted MCP service (out of spec entirely).

---

## Progress

<!-- /implement updates these as it works. Do not edit manually. -->
- [ ] AC #1 (`withMcpServer` registers MCP-backed gadgets)
- [ ] AC #2 (real public MCP server end-to-end via npx)
- [ ] AC #3 (`McpUntrustedCommandError` for non-allowlisted command)
- [ ] AC #4 (`jsonSchemaToZod` covers MCP subset)
- [ ] AC #5 (`mcpToolToGadget` handles text/image/isError)
- [ ] AC #6 (no orphan child processes after agent exit)
- [ ] AC #7 (`--mcp-server` and `--mcp-trust` CLI flags)
- [ ] AC #8 (zero overhead when MCP not used; `mcp/` module not imported)
- [ ] AC #9 (≥ 50 new tests)
- [ ] AC #10 (`npm run build` passes)
- [ ] AC #11 (`npm run typecheck` passes)
- [ ] AC #12 (`npm run test` passes)
- [ ] AC #13 (`npm run lint` passes)
- [ ] AC #14 (docs render via `npm run docs:dev`)
- [ ] AC #15 (5-minute consume walkthrough is end-to-end runnable)
