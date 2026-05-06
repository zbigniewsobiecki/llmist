/**
 * Parse `--mcp-server` and `--mcp-trust` CLI flags into McpServerSpec values.
 *
 * Plan 1 ships ad-hoc single-server flags. Plan 2 adds the full TOML schema
 * (`[mcp.servers.<name>]`) and merges TOML + flag specs.
 *
 * @module cli/mcp-options
 */

import type { McpServerSpec } from "llmist";

/**
 * Parse a list of `--mcp-server` flag values and a list of `--mcp-trust`
 * names into an array of `McpServerSpec`.
 *
 * Flag-value format:
 *   <name>=<command> [-- <arg> <arg> ...]
 *
 * - Multiple flag values accumulate.
 * - Args after `--` belong to the same server (Commander has already split
 *   on whitespace, so the value is a single string here that we re-tokenize).
 * - Duplicate names raise an error.
 */
export function parseMcpServerFlags(serverFlags: string[], trustFlags: string[]): McpServerSpec[] {
  const trustSet = new Set(trustFlags);
  const seen = new Set<string>();
  const specs: McpServerSpec[] = [];

  for (const raw of serverFlags) {
    const value = String(raw);
    const eqIdx = value.indexOf("=");
    if (eqIdx < 0) {
      throw new Error(
        `Invalid --mcp-server flag value "${raw}". Expected format: <name>=<command> [-- <args>...]`,
      );
    }

    const name = value.slice(0, eqIdx).trim();
    const tail = value.slice(eqIdx + 1).trim();

    if (!name) {
      throw new Error(`Invalid --mcp-server flag value "${raw}": missing server name before "=".`);
    }

    if (!tail) {
      throw new Error(`Invalid --mcp-server flag value "${raw}": missing command after "=".`);
    }

    if (seen.has(name)) {
      throw new Error(`Duplicate --mcp-server name "${name}". Each server name must be unique.`);
    }
    seen.add(name);

    // Tokenize the tail: command and optional args (after `--`).
    const tokens = tail.split(/\s+/).filter(Boolean);
    let command: string;
    let args: string[] = [];

    const dashDashIdx = tokens.indexOf("--");
    if (dashDashIdx >= 0) {
      command = tokens[0]!;
      args = tokens.slice(dashDashIdx + 1);
    } else if (tokens.length === 1) {
      command = tokens[0]!;
    } else {
      // No `--` separator and >1 token: treat the rest as args.
      command = tokens[0]!;
      args = tokens.slice(1);
    }

    specs.push({
      name,
      transport: "stdio",
      command,
      args,
      ...(trustSet.has(name) ? { trust: true } : {}),
    });
  }

  return specs;
}
