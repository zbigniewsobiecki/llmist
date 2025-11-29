import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load as parseToml } from "js-toml";
import type { ParameterFormat } from "../gadgets/parser.js";

/**
 * Valid log level names.
 */
export type LogLevel = "silly" | "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Global CLI options that apply to all commands.
 */
export interface GlobalConfig {
  "log-level"?: LogLevel;
  "log-file"?: string;
  "log-reset"?: boolean;
}

/**
 * Base options shared by both complete and agent command configurations.
 */
export interface BaseCommandConfig {
  model?: string;
  system?: string;
  temperature?: number;
}

/**
 * Configuration for the complete command.
 */
export interface CompleteConfig extends BaseCommandConfig {
  "max-tokens"?: number;
}

/**
 * Configuration for the agent command.
 */
export interface AgentConfig extends BaseCommandConfig {
  "max-iterations"?: number;
  gadget?: string[];
  "parameter-format"?: ParameterFormat;
  builtins?: boolean;
  "builtin-interaction"?: boolean;
}

/**
 * Command type determines execution behavior.
 */
export type CommandType = "agent" | "complete";

/**
 * Custom command configuration from config file.
 * Extends both agent and complete configs, with type determining behavior.
 * Also supports per-command logging configuration.
 */
export interface CustomCommandConfig extends AgentConfig, CompleteConfig {
  type?: CommandType;
  description?: string;
  "log-level"?: LogLevel;
  "log-file"?: string;
  "log-reset"?: boolean;
}

/**
 * Root configuration structure matching ~/.llmist/cli.toml.
 */
export interface CLIConfig {
  global?: GlobalConfig;
  complete?: CompleteConfig;
  agent?: AgentConfig;
  [customCommand: string]: CustomCommandConfig | CompleteConfig | AgentConfig | GlobalConfig | undefined;
}

/** Valid keys for global config */
const GLOBAL_CONFIG_KEYS = new Set(["log-level", "log-file", "log-reset"]);

/** Valid log levels */
const VALID_LOG_LEVELS: LogLevel[] = ["silly", "trace", "debug", "info", "warn", "error", "fatal"];

/** Valid keys for complete command config */
const COMPLETE_CONFIG_KEYS = new Set(["model", "system", "temperature", "max-tokens"]);

/** Valid keys for agent command config */
const AGENT_CONFIG_KEYS = new Set([
  "model",
  "system",
  "temperature",
  "max-iterations",
  "gadget",
  "parameter-format",
  "builtins",
  "builtin-interaction",
]);

/** Valid keys for custom command config (union of complete + agent + type + description + logging) */
const CUSTOM_CONFIG_KEYS = new Set([
  ...COMPLETE_CONFIG_KEYS,
  ...AGENT_CONFIG_KEYS,
  "type",
  "description",
  "log-level",
  "log-file",
  "log-reset",
]);

/** Valid parameter format values */
const VALID_PARAMETER_FORMATS: ParameterFormat[] = ["json", "yaml", "toml", "auto"];

/**
 * Returns the default config file path: ~/.llmist/cli.toml
 */
export function getConfigPath(): string {
  return join(homedir(), ".llmist", "cli.toml");
}

/**
 * Configuration validation error.
 */
export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly path?: string,
  ) {
    super(path ? `${path}: ${message}` : message);
    this.name = "ConfigError";
  }
}

/**
 * Validates that a value is a string.
 */
function validateString(value: unknown, key: string, section: string): string {
  if (typeof value !== "string") {
    throw new ConfigError(`[${section}].${key} must be a string`);
  }
  return value;
}

/**
 * Validates that a value is a number within optional bounds.
 */
function validateNumber(
  value: unknown,
  key: string,
  section: string,
  opts?: { min?: number; max?: number; integer?: boolean },
): number {
  if (typeof value !== "number") {
    throw new ConfigError(`[${section}].${key} must be a number`);
  }
  if (opts?.integer && !Number.isInteger(value)) {
    throw new ConfigError(`[${section}].${key} must be an integer`);
  }
  if (opts?.min !== undefined && value < opts.min) {
    throw new ConfigError(`[${section}].${key} must be >= ${opts.min}`);
  }
  if (opts?.max !== undefined && value > opts.max) {
    throw new ConfigError(`[${section}].${key} must be <= ${opts.max}`);
  }
  return value;
}

/**
 * Validates that a value is a boolean.
 */
function validateBoolean(value: unknown, key: string, section: string): boolean {
  if (typeof value !== "boolean") {
    throw new ConfigError(`[${section}].${key} must be a boolean`);
  }
  return value;
}

/**
 * Validates that a value is an array of strings.
 */
function validateStringArray(value: unknown, key: string, section: string): string[] {
  if (!Array.isArray(value)) {
    throw new ConfigError(`[${section}].${key} must be an array`);
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string") {
      throw new ConfigError(`[${section}].${key}[${i}] must be a string`);
    }
  }
  return value as string[];
}

/**
 * Validates and extracts base command config fields.
 */
function validateBaseConfig(
  raw: Record<string, unknown>,
  section: string,
): Partial<BaseCommandConfig> {
  const result: Partial<BaseCommandConfig> = {};

  if ("model" in raw) {
    result.model = validateString(raw.model, "model", section);
  }
  if ("system" in raw) {
    result.system = validateString(raw.system, "system", section);
  }
  if ("temperature" in raw) {
    result.temperature = validateNumber(raw.temperature, "temperature", section, {
      min: 0,
      max: 2,
    });
  }

  return result;
}

/**
 * Validates the global config section.
 */
function validateGlobalConfig(raw: unknown, section: string): GlobalConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new ConfigError(`[${section}] must be a table`);
  }

  const rawObj = raw as Record<string, unknown>;

  // Check for unknown keys
  for (const key of Object.keys(rawObj)) {
    if (!GLOBAL_CONFIG_KEYS.has(key)) {
      throw new ConfigError(`[${section}].${key} is not a valid option`);
    }
  }

  const result: GlobalConfig = {};

  if ("log-level" in rawObj) {
    const level = validateString(rawObj["log-level"], "log-level", section);
    if (!VALID_LOG_LEVELS.includes(level as LogLevel)) {
      throw new ConfigError(
        `[${section}].log-level must be one of: ${VALID_LOG_LEVELS.join(", ")}`,
      );
    }
    result["log-level"] = level as LogLevel;
  }
  if ("log-file" in rawObj) {
    result["log-file"] = validateString(rawObj["log-file"], "log-file", section);
  }
  if ("log-reset" in rawObj) {
    result["log-reset"] = validateBoolean(rawObj["log-reset"], "log-reset", section);
  }

  return result;
}

/**
 * Validates a complete command config section.
 */
function validateCompleteConfig(raw: unknown, section: string): CompleteConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new ConfigError(`[${section}] must be a table`);
  }

  const rawObj = raw as Record<string, unknown>;

  // Check for unknown keys
  for (const key of Object.keys(rawObj)) {
    if (!COMPLETE_CONFIG_KEYS.has(key)) {
      throw new ConfigError(`[${section}].${key} is not a valid option`);
    }
  }

  const result: CompleteConfig = { ...validateBaseConfig(rawObj, section) };

  if ("max-tokens" in rawObj) {
    result["max-tokens"] = validateNumber(rawObj["max-tokens"], "max-tokens", section, {
      integer: true,
      min: 1,
    });
  }

  return result;
}

/**
 * Validates an agent command config section.
 */
function validateAgentConfig(raw: unknown, section: string): AgentConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new ConfigError(`[${section}] must be a table`);
  }

  const rawObj = raw as Record<string, unknown>;

  // Check for unknown keys
  for (const key of Object.keys(rawObj)) {
    if (!AGENT_CONFIG_KEYS.has(key)) {
      throw new ConfigError(`[${section}].${key} is not a valid option`);
    }
  }

  const result: AgentConfig = { ...validateBaseConfig(rawObj, section) };

  if ("max-iterations" in rawObj) {
    result["max-iterations"] = validateNumber(rawObj["max-iterations"], "max-iterations", section, {
      integer: true,
      min: 1,
    });
  }
  if ("gadget" in rawObj) {
    result.gadget = validateStringArray(rawObj.gadget, "gadget", section);
  }
  if ("parameter-format" in rawObj) {
    const format = validateString(rawObj["parameter-format"], "parameter-format", section);
    if (!VALID_PARAMETER_FORMATS.includes(format as ParameterFormat)) {
      throw new ConfigError(
        `[${section}].parameter-format must be one of: ${VALID_PARAMETER_FORMATS.join(", ")}`,
      );
    }
    result["parameter-format"] = format as ParameterFormat;
  }
  if ("builtins" in rawObj) {
    result.builtins = validateBoolean(rawObj.builtins, "builtins", section);
  }
  if ("builtin-interaction" in rawObj) {
    result["builtin-interaction"] = validateBoolean(
      rawObj["builtin-interaction"],
      "builtin-interaction",
      section,
    );
  }

  return result;
}

/**
 * Validates a custom command config section.
 */
function validateCustomConfig(raw: unknown, section: string): CustomCommandConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new ConfigError(`[${section}] must be a table`);
  }

  const rawObj = raw as Record<string, unknown>;

  // Check for unknown keys
  for (const key of Object.keys(rawObj)) {
    if (!CUSTOM_CONFIG_KEYS.has(key)) {
      throw new ConfigError(`[${section}].${key} is not a valid option`);
    }
  }

  // Get the type first to validate properly
  let type: CommandType = "agent"; // Default
  if ("type" in rawObj) {
    const typeValue = validateString(rawObj.type, "type", section);
    if (typeValue !== "agent" && typeValue !== "complete") {
      throw new ConfigError(`[${section}].type must be "agent" or "complete"`);
    }
    type = typeValue;
  }

  // Validate base fields + type-specific fields
  const result: CustomCommandConfig = {
    ...validateBaseConfig(rawObj, section),
    type,
  };

  if ("description" in rawObj) {
    result.description = validateString(rawObj.description, "description", section);
  }

  // Always allow agent-specific fields (they'll be ignored for complete type)
  if ("max-iterations" in rawObj) {
    result["max-iterations"] = validateNumber(rawObj["max-iterations"], "max-iterations", section, {
      integer: true,
      min: 1,
    });
  }
  if ("gadget" in rawObj) {
    result.gadget = validateStringArray(rawObj.gadget, "gadget", section);
  }
  if ("parameter-format" in rawObj) {
    const format = validateString(rawObj["parameter-format"], "parameter-format", section);
    if (!VALID_PARAMETER_FORMATS.includes(format as ParameterFormat)) {
      throw new ConfigError(
        `[${section}].parameter-format must be one of: ${VALID_PARAMETER_FORMATS.join(", ")}`,
      );
    }
    result["parameter-format"] = format as ParameterFormat;
  }
  if ("builtins" in rawObj) {
    result.builtins = validateBoolean(rawObj.builtins, "builtins", section);
  }
  if ("builtin-interaction" in rawObj) {
    result["builtin-interaction"] = validateBoolean(
      rawObj["builtin-interaction"],
      "builtin-interaction",
      section,
    );
  }

  // Complete-specific fields
  if ("max-tokens" in rawObj) {
    result["max-tokens"] = validateNumber(rawObj["max-tokens"], "max-tokens", section, {
      integer: true,
      min: 1,
    });
  }

  // Logging options (per-command override)
  if ("log-level" in rawObj) {
    const level = validateString(rawObj["log-level"], "log-level", section);
    if (!VALID_LOG_LEVELS.includes(level as LogLevel)) {
      throw new ConfigError(
        `[${section}].log-level must be one of: ${VALID_LOG_LEVELS.join(", ")}`,
      );
    }
    result["log-level"] = level as LogLevel;
  }
  if ("log-file" in rawObj) {
    result["log-file"] = validateString(rawObj["log-file"], "log-file", section);
  }
  if ("log-reset" in rawObj) {
    result["log-reset"] = validateBoolean(rawObj["log-reset"], "log-reset", section);
  }

  return result;
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

  return validateConfig(raw, configPath);
}

/**
 * Gets list of custom command names from config (excludes built-in sections).
 */
export function getCustomCommandNames(config: CLIConfig): string[] {
  const reserved = new Set(["global", "complete", "agent"]);
  return Object.keys(config).filter((key) => !reserved.has(key));
}
