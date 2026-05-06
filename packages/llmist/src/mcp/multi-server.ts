/**
 * Deterministic multi-server tool name conflict resolution.
 *
 * When two or more MCP servers expose tools with the same name, llmist
 * prefixes those servers' tools with `<server>__`. The check is per-tool-name:
 * any name that appears on more than one server triggers prefixing on every
 * server that owns the colliding name. To keep the gadget naming uniform
 * within a server, all tools on a server with at least one collision get the
 * prefix.
 *
 * This shape matches the convention used by every major MCP-aware framework
 * (LangChain, OpenAI Agents SDK, Cline) — divergence buys nothing.
 *
 * @module mcp/multi-server
 */

import type { McpServerSpec, McpToolDescriptor } from "./types.js";

export interface ServerToolList {
  server: McpServerSpec;
  tools: McpToolDescriptor[];
}

export interface ResolvedServerToolList extends ServerToolList {
  /** Prefix applied to each tool of this server (e.g. "fs__"). undefined when no collision. */
  prefix: string | undefined;
}

export function resolveToolNames(input: ServerToolList[]): ResolvedServerToolList[] {
  // Count occurrences of each tool name across servers.
  const counts = new Map<string, number>();
  for (const s of input) {
    for (const t of s.tools) {
      counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
    }
  }

  // Determine which servers have at least one colliding tool.
  const collidingServers = new Set<string>();
  for (const s of input) {
    if (s.tools.some((t) => (counts.get(t.name) ?? 0) > 1)) {
      collidingServers.add(s.server.name);
    }
  }

  return input.map((s) => ({
    ...s,
    prefix: collidingServers.has(s.server.name) ? `${s.server.name}__` : undefined,
  }));
}
