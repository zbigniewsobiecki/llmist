/**
 * Default-safe allowlist for MCP STDIO server commands.
 *
 * Mitigates the CVE-2026-30623 family of stdio-spawn RCE vulnerabilities. The
 * gate refuses to spawn any executable whose basename is not in the allowlist
 * unless the spec is marked `trust: true` (library) / `trust = true` (TOML)
 * / `--mcp-trust <name>` (CLI). It also rejects whole-string commands that
 * embed args or shell metacharacters — callers must pass arguments as a
 * separate array.
 *
 * @module mcp/allowlist
 */

import path from "node:path";
import { McpUntrustedCommandError } from "./errors.js";

/**
 * Default allowlist of MCP stdio server runtimes that are safe to spawn
 * without explicit user opt-in. Add entries to this list only when the
 * basename is universally a runtime, not a tool that takes arbitrary code
 * (e.g. don't add `bash` or `sh`).
 */
export const DEFAULT_MCP_COMMAND_ALLOWLIST: ReadonlySet<string> = new Set([
  "npx",
  "node",
  "uvx",
  "uv",
  "python",
  "python3",
  "deno",
  "bun",
]);

const WHITESPACE_OR_META_RE = /[\s;|&`$<>()'"\\]/;

/**
 * Throws McpUntrustedCommandError if `command` is not safe to spawn under
 * the allowlist policy.
 */
export function assertCommandAllowed(
  command: string,
  trusted: boolean,
  customAllowlist?: ReadonlySet<string>,
): void {
  if (!command || typeof command !== "string") {
    throw new McpUntrustedCommandError(String(command));
  }

  if (WHITESPACE_OR_META_RE.test(command)) {
    // Whitespace or shell metachars in the command string mean the caller
    // is trying to pass args via the command line. Refuse; they must use
    // `args` instead.
    throw new McpUntrustedCommandError(command);
  }

  if (trusted) return;

  const allowlist = customAllowlist ?? DEFAULT_MCP_COMMAND_ALLOWLIST;
  const base = path.basename(command);
  if (!allowlist.has(base)) {
    throw new McpUntrustedCommandError(command);
  }
}
