/**
 * Lifts MCP server configuration from a Claude Code config file
 * (`~/.claude.json` by default; `$CLAUDE_CONFIG_HOME` overrides) and emits
 * llmist TOML `[mcp.servers.<name>]` blocks the user can paste into their
 * llmist config.
 *
 * @module cli/import-claude-code
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { McpServerSpec } from "llmist";

export interface ImportedServer {
  name: string;
  spec: McpServerSpec;
}

export interface ParseResult {
  servers: ImportedServer[];
  warnings: string[];
}

/**
 * Parse a Claude Code JSON object and extract MCP server entries.
 *
 * Recognized shapes:
 * - `mcpServers` at the top level (Claude Code's typical layout)
 * - `projects[*].mcpServers` for per-project entries (also picked up)
 *
 * Recognized entry types:
 * - stdio (default when `type` is missing or `"stdio"`): `{ command, args?, env? }`
 * - http: `{ type: "http", url, headers? }`
 *
 * Anything else is reported in `warnings` and skipped.
 */
export function parseClaudeCodeMcp(raw: unknown): ParseResult {
  const servers: ImportedServer[] = [];
  const warnings: string[] = [];

  if (!raw || typeof raw !== "object") {
    return { servers, warnings };
  }
  const root = raw as Record<string, unknown>;

  collectFrom(root.mcpServers, servers, warnings);

  // per-project entries
  const projects = root.projects;
  if (projects && typeof projects === "object") {
    for (const proj of Object.values(projects)) {
      if (proj && typeof proj === "object") {
        collectFrom(
          (proj as Record<string, unknown>).mcpServers,
          servers,
          warnings,
        );
      }
    }
  }

  return { servers, warnings };
}

function collectFrom(
  candidate: unknown,
  out: ImportedServer[],
  warnings: string[],
): void {
  if (!candidate || typeof candidate !== "object") return;
  for (const [name, raw] of Object.entries(candidate as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") {
      warnings.push(`Skipping ${name}: entry is not an object`);
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const type = (entry.type as string | undefined) ?? "stdio";

    if (type === "stdio") {
      const command = entry.command;
      if (typeof command !== "string" || command.length === 0) {
        warnings.push(`Skipping ${name}: stdio entry has no 'command'`);
        continue;
      }
      out.push({
        name,
        spec: {
          name,
          transport: "stdio",
          command,
          ...(Array.isArray(entry.args) ? { args: entry.args as string[] } : {}),
          ...(entry.env && typeof entry.env === "object"
            ? { env: entry.env as Record<string, string> }
            : {}),
        },
      });
    } else if (type === "http" || type === "streamable-http" || type === "sse") {
      const url = entry.url;
      if (typeof url !== "string" || url.length === 0) {
        warnings.push(`Skipping ${name}: ${type} entry has no 'url'`);
        continue;
      }
      out.push({
        name,
        spec: {
          name,
          transport: "http",
          url,
          ...(entry.headers && typeof entry.headers === "object"
            ? { headers: entry.headers as Record<string, string> }
            : {}),
        },
      });
    } else {
      warnings.push(`Skipping ${name}: unsupported type "${type}"`);
    }
  }
}

/**
 * Emit each imported server as a TOML block string suitable for appending to
 * `~/.llmist/config.toml`.
 */
export function claudeCodeJsonToTomlBlocks(servers: ImportedServer[]): string[] {
  return servers.map((s) => formatTomlBlock(s));
}

function formatTomlBlock(server: ImportedServer): string {
  const lines: string[] = [];
  lines.push(`[mcp.servers.${server.name}]`);
  if (server.spec.transport === "stdio") {
    lines.push(`transport = "stdio"`);
    lines.push(`command = ${tomlString(server.spec.command)}`);
    if (server.spec.args && server.spec.args.length > 0) {
      lines.push(
        `args = [${server.spec.args.map((a) => tomlString(a)).join(", ")}]`,
      );
    }
    if (server.spec.env) {
      lines.push("");
      lines.push(`[mcp.servers.${server.name}.env]`);
      for (const [k, v] of Object.entries(server.spec.env)) {
        lines.push(`${k} = ${tomlString(v)}`);
      }
    }
  } else {
    lines.push(`transport = "http"`);
    lines.push(`url = ${tomlString(server.spec.url)}`);
    if (server.spec.headers && Object.keys(server.spec.headers).length > 0) {
      lines.push("");
      lines.push(`[mcp.servers.${server.name}.headers]`);
      for (const [k, v] of Object.entries(server.spec.headers)) {
        lines.push(`${k} = ${tomlString(v)}`);
      }
    }
  }
  return lines.join("\n");
}

function tomlString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Resolve the default Claude Code config file path.
 */
export function defaultClaudeConfigPath(): string {
  const override = process.env.CLAUDE_CONFIG_HOME;
  if (override) return override;
  return path.join(os.homedir(), ".claude.json");
}

/**
 * Read the Claude Code config file and return parsed MCP entries.
 *
 * Used by the CLI subcommand. Returns warnings as a separate array so the
 * caller can decide whether to print them.
 */
export async function readClaudeCodeMcpConfig(
  source?: string,
): Promise<{ source: string; result: ParseResult }> {
  const target = source ?? defaultClaudeConfigPath();
  const raw = await fs.readFile(target, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse Claude Code config at ${target}: ${(err as Error).message}`,
    );
  }
  return { source: target, result: parseClaudeCodeMcp(parsed) };
}
