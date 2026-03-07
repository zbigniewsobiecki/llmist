import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load as parseToml } from "js-toml";
import { resolveInheritance, resolveTemplatesInConfig } from "./config-resolution.js";
import type { CLIConfig } from "./config-types.js";
import {
  ConfigError,
  validateAgentConfig,
  validateCompleteConfig,
  validateCustomConfig,
  validateGlobalConfig,
  validateGlobalSubagentConfig,
  validateImageConfig,
  validatePromptsConfig,
  validateRateLimitsConfig,
  validateRetryConfig,
  validateSpeechConfig,
} from "./config-validators.js";

// ---------------------------------------------------------------------------
// Re-export everything so consumers never need to change their imports
// ---------------------------------------------------------------------------

export type { SubagentConfig, SubagentConfigMap } from "llmist";
export { resolveInheritance, resolveTemplatesInConfig } from "./config-resolution.js";
export type {
  AgentConfig,
  CLIConfig,
  CommandType,
  CompleteConfig,
  CustomCommandConfig,
  GadgetPermissionLevel,
  GadgetPermissionPolicy,
  GlobalConfig,
  ImageConfig,
  InitialGadget,
  LogLevel,
  RateLimitsConfig,
  ReasoningConfigCLI,
  RetryConfigCLI,
  SharedCommandConfig,
  SpeechConfig,
} from "./config-types.js";
export { ConfigError } from "./config-validators.js";
export type { GlobalSubagentConfig } from "./subagent-config.js";
export type { PromptsConfig } from "./templates.js";

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Returns the default config file path: ~/.llmist/cli.toml
 */
export function getConfigPath(): string {
  return join(homedir(), ".llmist", "cli.toml");
}

/**
 * Validates and normalizes raw TOML object to CLIConfig.
 *
 * @throws ConfigError if validation fails
 */
export function validateConfig(raw: unknown, configPath?: string): CLIConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new ConfigError("Config must be a TOML table", configPath);
  }

  const rawObj = raw as Record<string, unknown>;
  const result: CLIConfig = {};

  for (const [key, value] of Object.entries(rawObj)) {
    try {
      if (key === "global") {
        result.global = validateGlobalConfig(value, key);
      } else if (key === "complete") {
        result.complete = validateCompleteConfig(value, key);
      } else if (key === "agent") {
        result.agent = validateAgentConfig(value, key);
      } else if (key === "image") {
        result.image = validateImageConfig(value, key);
      } else if (key === "speech") {
        result.speech = validateSpeechConfig(value, key);
      } else if (key === "prompts") {
        result.prompts = validatePromptsConfig(value, key);
      } else if (key === "subagents") {
        result.subagents = validateGlobalSubagentConfig(value, key);
      } else if (key === "rate-limits") {
        result["rate-limits"] = validateRateLimitsConfig(value, key);
      } else if (key === "retry") {
        result.retry = validateRetryConfig(value, key);
      } else {
        // Custom command section
        result[key] = validateCustomConfig(value, key);
      }
    } catch (error) {
      if (error instanceof ConfigError) {
        throw new ConfigError(error.message, configPath);
      }
      throw error;
    }
  }

  return result;
}

/**
 * Loads configuration from the default path (~/.llmist/cli.toml).
 * Returns empty config if file doesn't exist.
 *
 * @throws ConfigError if file exists but has invalid syntax or unknown fields
 */
export function loadConfig(): CLIConfig {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    return {};
  }

  let content: string;
  try {
    content = readFileSync(configPath, "utf-8");
  } catch (error) {
    throw new ConfigError(
      `Failed to read config file: ${error instanceof Error ? error.message : "Unknown error"}`,
      configPath,
    );
  }

  let raw: unknown;
  try {
    raw = parseToml(content);
  } catch (error) {
    throw new ConfigError(
      `Invalid TOML syntax: ${error instanceof Error ? error.message : "Unknown error"}`,
      configPath,
    );
  }

  const validated = validateConfig(raw, configPath);
  const inherited = resolveInheritance(validated, configPath);
  return resolveTemplatesInConfig(inherited, configPath);
}

/**
 * Gets list of custom command names from config (excludes built-in sections).
 */
export function getCustomCommandNames(config: CLIConfig): string[] {
  const reserved = new Set([
    "global",
    "complete",
    "agent",
    "image",
    "speech",
    "prompts",
    "subagents",
    "rate-limits",
    "retry",
  ]);
  return Object.keys(config).filter((key) => !reserved.has(key));
}
