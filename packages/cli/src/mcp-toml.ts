/**
 * Translate `[mcp.servers.<name>]` TOML blocks into runtime
 * `McpServerSpec` values, plus a small validator that returns user-readable
 * error strings.
 *
 * @module cli/mcp-toml
 */

import type { McpServerSpec } from "llmist";
import type { McpConfig, McpServerToml } from "./config-types.js";

/**
 * Validate an `[mcp]` config block. Returns an array of human-readable error
 * messages — empty when the config is valid.
 */
export function validateMcpServersConfig(config: McpConfig | undefined): string[] {
  if (!config || !config.servers) return [];
  const errors: string[] = [];
  for (const [name, raw] of Object.entries(config.servers)) {
    if (!raw || typeof raw !== "object") {
      errors.push(`mcp.servers.${name}: must be a table`);
      continue;
    }
    const transport = (raw as { transport?: string }).transport;
    if (transport !== "stdio" && transport !== "http") {
      errors.push(
        `mcp.servers.${name}: missing or invalid 'transport' (expected "stdio" or "http")`,
      );
      continue;
    }
    if (transport === "stdio") {
      const command = (raw as { command?: unknown }).command;
      if (typeof command !== "string" || command.length === 0) {
        errors.push(`mcp.servers.${name}: stdio transport requires a non-empty 'command'`);
      }
    } else {
      const url = (raw as { url?: unknown }).url;
      if (typeof url !== "string" || url.length === 0) {
        errors.push(`mcp.servers.${name}: http transport requires a non-empty 'url'`);
      }
    }
  }
  return errors;
}

/**
 * Convert validated `[mcp.servers.*]` blocks into runtime `McpServerSpec`s.
 *
 * - Skips blocks with `enabled = false`.
 * - Maps `timeout-ms` → `timeoutMs`.
 * - Validation errors are NOT thrown here; call `validateMcpServersConfig`
 *   first if you want to surface them. Invalid blocks are silently skipped
 *   so a partial-bad config doesn't break agent startup.
 */
export function mcpServersTomlToSpecs(config: McpConfig | undefined): McpServerSpec[] {
  if (!config?.servers) return [];
  const specs: McpServerSpec[] = [];

  for (const [name, raw] of Object.entries(config.servers)) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.enabled === false) continue;
    const block = raw as McpServerToml;
    const timeoutMs = block["timeout-ms"];

    if (block.transport === "stdio") {
      if (!block.command) continue;
      specs.push({
        name,
        transport: "stdio",
        command: block.command,
        ...(block.args ? { args: block.args } : {}),
        ...(block.env ? { env: block.env } : {}),
        ...(block.trust ? { trust: block.trust } : {}),
        ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
      });
    } else if (block.transport === "http") {
      if (!block.url) continue;
      specs.push({
        name,
        transport: "http",
        url: block.url,
        ...(block.headers ? { headers: block.headers } : {}),
        ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
      });
    }
  }

  return specs;
}
