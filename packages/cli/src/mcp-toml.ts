/**
 * Translate `[mcp.servers.<name>]` TOML blocks into runtime
 * `McpServerSpec` values.
 *
 * @module cli/mcp-toml
 */

import type { McpServerSpec } from "llmist";
import type { McpConfig, McpServerToml } from "./config-types.js";
import {
  ConfigError,
  validateBoolean,
  validateNumber,
  validateString,
  validateStringArray,
  validateTable,
} from "./config-validators.js";

/**
 * Validate and normalize an `[mcp]` config block.
 */
export function validateMcpServersConfig(raw: unknown, section = "mcp"): McpConfig {
  const rawObj = validateTable(raw, section, new Set(["servers"]));
  const result: McpConfig = {};

  if (!("servers" in rawObj)) {
    return result;
  }

  const serversObj = validateTable(rawObj.servers, `${section}.servers`);
  const servers: Record<string, McpServerToml> = {};

  for (const [name, serverRaw] of Object.entries(serversObj)) {
    servers[name] = validateMcpServerBlock(serverRaw, name, `${section}.servers`);
  }

  result.servers = servers;
  return result;
}

/**
 * Convert validated `[mcp.servers.*]` blocks into runtime `McpServerSpec`s.
 *
 * - Skips blocks with `enabled = false`.
 * - Maps `timeout-ms` → `timeoutMs`.
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

function validateMcpServerBlock(raw: unknown, name: string, parentSection: string): McpServerToml {
  const section = `${parentSection}.${name}`;
  const rawObj = validateTable(raw, section);
  const transport = validateString(rawObj.transport, "transport", section);

  if (transport !== "stdio" && transport !== "http") {
    throw new ConfigError(
      `[${section}].transport must be one of: stdio, http (got "${transport}")`,
    );
  }

  const validKeys =
    transport === "stdio"
      ? new Set(["transport", "command", "args", "env", "trust", "enabled", "timeout-ms"])
      : new Set(["transport", "url", "headers", "enabled", "timeout-ms"]);

  for (const key of Object.keys(rawObj)) {
    if (!validKeys.has(key)) {
      throw new ConfigError(`[${section}].${key} is not a valid option`);
    }
  }

  const common = {
    transport,
    ...("enabled" in rawObj
      ? { enabled: validateBoolean(rawObj.enabled, "enabled", section) }
      : {}),
    ...("timeout-ms" in rawObj
      ? {
          "timeout-ms": validateNumber(rawObj["timeout-ms"], "timeout-ms", section, {
            integer: true,
            min: 0,
          }),
        }
      : {}),
  };

  if (transport === "stdio") {
    const command = validateString(rawObj.command, "command", section);
    if (command.length === 0) {
      throw new ConfigError(`[${section}].command must be a non-empty string`);
    }
    return {
      ...common,
      transport: "stdio",
      command,
      ...("args" in rawObj ? { args: validateStringArray(rawObj.args, "args", section) } : {}),
      ...("env" in rawObj ? { env: validateStringMap(rawObj.env, "env", section) } : {}),
      ...("trust" in rawObj ? { trust: validateBoolean(rawObj.trust, "trust", section) } : {}),
    };
  }

  const url = validateString(rawObj.url, "url", section);
  if (url.length === 0) {
    throw new ConfigError(`[${section}].url must be a non-empty string`);
  }
  return {
    ...common,
    transport: "http",
    url,
    ...("headers" in rawObj
      ? { headers: validateStringMap(rawObj.headers, "headers", section) }
      : {}),
  };
}

function validateStringMap(value: unknown, key: string, section: string): Record<string, string> {
  const raw = validateTable(value, `${section}.${key}`);
  const result: Record<string, string> = {};
  for (const [entryKey, entryValue] of Object.entries(raw)) {
    if (typeof entryValue !== "string") {
      throw new ConfigError(`[${section}].${key}.${entryKey} must be a string`);
    }
    result[entryKey] = entryValue;
  }
  return result;
}
