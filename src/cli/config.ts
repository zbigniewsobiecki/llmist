import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load as parseToml } from "js-toml";
import {
  type PromptsConfig,
  TemplateError,
  createTemplateEngine,
  hasTemplateSyntax,
  resolveTemplate,
  validateEnvVars,
  validatePrompts,
} from "./templates.js";

// Re-export PromptsConfig for consumers
export type { PromptsConfig } from "./templates.js";

/**
 * Valid log level names.
 */
export type LogLevel = "silly" | "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Gadget approval mode determines how a gadget execution is handled.
 * - "allowed": Auto-proceed without prompting
 * - "denied": Auto-reject, return denial message to LLM
 * - "approval-required": Prompt user for approval before execution
 */
export type GadgetApprovalMode = "allowed" | "denied" | "approval-required";

/**
 * Valid gadget approval modes.
 */
const VALID_APPROVAL_MODES: GadgetApprovalMode[] = ["allowed", "denied", "approval-required"];

/**
 * Configuration for per-gadget approval behavior.
 * Keys are gadget names (case-insensitive), values are approval modes.
 * Special key "*" sets the default for unconfigured gadgets.
 */
export type GadgetApprovalConfig = Record<string, GadgetApprovalMode>;

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
  inherits?: string | string[];
}

/**
 * Configuration for the complete command.
 */
export interface CompleteConfig extends BaseCommandConfig {
  "max-tokens"?: number;
  quiet?: boolean;
  "log-level"?: LogLevel;
  "log-file"?: string;
  "log-reset"?: boolean;
  "log-llm-requests"?: string | boolean;
  "log-llm-responses"?: string | boolean;
}

/**
 * Configuration for the agent command.
 */
export interface AgentConfig extends BaseCommandConfig {
  "max-iterations"?: number;
  gadgets?: string[]; // Full replacement (preferred)
  "gadget-add"?: string[]; // Add to inherited gadgets
  "gadget-remove"?: string[]; // Remove from inherited gadgets
  gadget?: string[]; // DEPRECATED: alias for gadgets
  builtins?: boolean;
  "builtin-interaction"?: boolean;
  "gadget-start-prefix"?: string;
  "gadget-end-prefix"?: string;
  "gadget-arg-prefix"?: string;
  "gadget-approval"?: GadgetApprovalConfig;
  quiet?: boolean;
  "log-level"?: LogLevel;
  "log-file"?: string;
  "log-reset"?: boolean;
  "log-llm-requests"?: string | boolean;
  "log-llm-responses"?: string | boolean;
}

/**
 * Command type determines execution behavior.
 */
export type CommandType = "agent" | "complete";

/**
 * Custom command configuration from config file.
 * Extends both agent and complete configs, with type determining behavior.
 */
export interface CustomCommandConfig extends AgentConfig, CompleteConfig {
  type?: CommandType;
  description?: string;
}

/**
 * Root configuration structure matching ~/.llmist/cli.toml.
 */
export interface CLIConfig {
  global?: GlobalConfig;
  complete?: CompleteConfig;
  agent?: AgentConfig;
  prompts?: PromptsConfig;
  [customCommand: string]:
    | CustomCommandConfig
    | CompleteConfig
    | AgentConfig
    | GlobalConfig
    | PromptsConfig
    | undefined;
}

/** Valid keys for global config */
const GLOBAL_CONFIG_KEYS = new Set(["log-level", "log-file", "log-reset"]);

/** Valid log levels */
const VALID_LOG_LEVELS: LogLevel[] = ["silly", "trace", "debug", "info", "warn", "error", "fatal"];

/** Valid keys for complete command config */
const COMPLETE_CONFIG_KEYS = new Set([
  "model",
  "system",
  "temperature",
  "max-tokens",
  "quiet",
  "inherits",
  "log-level",
  "log-file",
  "log-reset",
  "log-llm-requests",
  "log-llm-responses",
  "type", // Allowed for inheritance compatibility, ignored for built-in commands
]);

/** Valid keys for agent command config */
const AGENT_CONFIG_KEYS = new Set([
  "model",
  "system",
  "temperature",
  "max-iterations",
  "gadgets", // Full replacement (preferred)
  "gadget-add", // Add to inherited gadgets
  "gadget-remove", // Remove from inherited gadgets
  "gadget", // DEPRECATED: alias for gadgets
  "builtins",
  "builtin-interaction",
  "gadget-start-prefix",
  "gadget-end-prefix",
  "gadget-arg-prefix",
  "gadget-approval",
  "quiet",
  "inherits",
  "log-level",
  "log-file",
  "log-reset",
  "log-llm-requests",
  "log-llm-responses",
  "type", // Allowed for inheritance compatibility, ignored for built-in commands
]);

/** Valid keys for custom command config (union of complete + agent + type + description) */
const CUSTOM_CONFIG_KEYS = new Set([
  ...COMPLETE_CONFIG_KEYS,
  ...AGENT_CONFIG_KEYS,
  "type",
  "description",
]);

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
 * Validates that a value is a string or array of strings (for inherits field).
 */
function validateInherits(value: unknown, section: string): string | string[] {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (typeof value[i] !== "string") {
        throw new ConfigError(`[${section}].inherits[${i}] must be a string`);
      }
    }
    return value as string[];
  }
  throw new ConfigError(`[${section}].inherits must be a string or array of strings`);
}

/**
 * Validates that a value is a gadget approval config (object mapping gadget names to modes).
 */
function validateGadgetApproval(value: unknown, section: string): GadgetApprovalConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError(
      `[${section}].gadget-approval must be a table (e.g., { WriteFile = "approval-required" })`,
    );
  }

  const result: GadgetApprovalConfig = {};
  for (const [gadgetName, mode] of Object.entries(value as Record<string, unknown>)) {
    if (typeof mode !== "string") {
      throw new ConfigError(
        `[${section}].gadget-approval.${gadgetName} must be a string`,
      );
    }
    if (!VALID_APPROVAL_MODES.includes(mode as GadgetApprovalMode)) {
      throw new ConfigError(
        `[${section}].gadget-approval.${gadgetName} must be one of: ${VALID_APPROVAL_MODES.join(", ")}`,
      );
    }
    result[gadgetName] = mode as GadgetApprovalMode;
  }
  return result;
}

/**
 * Validates and extracts logging config fields from a raw object.
 */
function validateLoggingConfig(
  raw: Record<string, unknown>,
  section: string,
): { "log-level"?: LogLevel; "log-file"?: string; "log-reset"?: boolean } {
  const result: { "log-level"?: LogLevel; "log-file"?: string; "log-reset"?: boolean } = {};

  if ("log-level" in raw) {
    const level = validateString(raw["log-level"], "log-level", section);
    if (!VALID_LOG_LEVELS.includes(level as LogLevel)) {
      throw new ConfigError(
        `[${section}].log-level must be one of: ${VALID_LOG_LEVELS.join(", ")}`,
      );
    }
    result["log-level"] = level as LogLevel;
  }
  if ("log-file" in raw) {
    result["log-file"] = validateString(raw["log-file"], "log-file", section);
  }
  if ("log-reset" in raw) {
    result["log-reset"] = validateBoolean(raw["log-reset"], "log-reset", section);
  }

  return result;
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
  if ("inherits" in raw) {
    result.inherits = validateInherits(raw.inherits, section);
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

  return validateLoggingConfig(rawObj, section);
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

  const result: CompleteConfig = {
    ...validateBaseConfig(rawObj, section),
    ...validateLoggingConfig(rawObj, section),
  };

  if ("max-tokens" in rawObj) {
    result["max-tokens"] = validateNumber(rawObj["max-tokens"], "max-tokens", section, {
      integer: true,
      min: 1,
    });
  }
  if ("quiet" in rawObj) {
    result.quiet = validateBoolean(rawObj.quiet, "quiet", section);
  }
  if ("log-llm-requests" in rawObj) {
    result["log-llm-requests"] = validateStringOrBoolean(
      rawObj["log-llm-requests"],
      "log-llm-requests",
      section,
    );
  }
  if ("log-llm-responses" in rawObj) {
    result["log-llm-responses"] = validateStringOrBoolean(
      rawObj["log-llm-responses"],
      "log-llm-responses",
      section,
    );
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

  const result: AgentConfig = {
    ...validateBaseConfig(rawObj, section),
    ...validateLoggingConfig(rawObj, section),
  };

  if ("max-iterations" in rawObj) {
    result["max-iterations"] = validateNumber(rawObj["max-iterations"], "max-iterations", section, {
      integer: true,
      min: 1,
    });
  }
  // Gadget configuration (new plural form preferred)
  if ("gadgets" in rawObj) {
    result.gadgets = validateStringArray(rawObj.gadgets, "gadgets", section);
  }
  if ("gadget-add" in rawObj) {
    result["gadget-add"] = validateStringArray(rawObj["gadget-add"], "gadget-add", section);
  }
  if ("gadget-remove" in rawObj) {
    result["gadget-remove"] = validateStringArray(rawObj["gadget-remove"], "gadget-remove", section);
  }
  // Legacy singular form (deprecated)
  if ("gadget" in rawObj) {
    result.gadget = validateStringArray(rawObj.gadget, "gadget", section);
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
  if ("gadget-start-prefix" in rawObj) {
    result["gadget-start-prefix"] = validateString(
      rawObj["gadget-start-prefix"],
      "gadget-start-prefix",
      section,
    );
  }
  if ("gadget-end-prefix" in rawObj) {
    result["gadget-end-prefix"] = validateString(
      rawObj["gadget-end-prefix"],
      "gadget-end-prefix",
      section,
    );
  }
  if ("gadget-arg-prefix" in rawObj) {
    result["gadget-arg-prefix"] = validateString(
      rawObj["gadget-arg-prefix"],
      "gadget-arg-prefix",
      section,
    );
  }
  if ("gadget-approval" in rawObj) {
    result["gadget-approval"] = validateGadgetApproval(rawObj["gadget-approval"], section);
  }
  if ("quiet" in rawObj) {
    result.quiet = validateBoolean(rawObj.quiet, "quiet", section);
  }
  if ("log-llm-requests" in rawObj) {
    result["log-llm-requests"] = validateStringOrBoolean(
      rawObj["log-llm-requests"],
      "log-llm-requests",
      section,
    );
  }
  if ("log-llm-responses" in rawObj) {
    result["log-llm-responses"] = validateStringOrBoolean(
      rawObj["log-llm-responses"],
      "log-llm-responses",
      section,
    );
  }

  return result;
}

/**
 * Validates a value is either a string or boolean.
 */
function validateStringOrBoolean(value: unknown, field: string, section: string): string | boolean {
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  throw new ConfigError(`[${section}].${field} must be a string or boolean`);
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
  // Gadget configuration (new plural form preferred)
  if ("gadgets" in rawObj) {
    result.gadgets = validateStringArray(rawObj.gadgets, "gadgets", section);
  }
  if ("gadget-add" in rawObj) {
    result["gadget-add"] = validateStringArray(rawObj["gadget-add"], "gadget-add", section);
  }
  if ("gadget-remove" in rawObj) {
    result["gadget-remove"] = validateStringArray(rawObj["gadget-remove"], "gadget-remove", section);
  }
  // Legacy singular form (deprecated)
  if ("gadget" in rawObj) {
    result.gadget = validateStringArray(rawObj.gadget, "gadget", section);
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
  if ("gadget-start-prefix" in rawObj) {
    result["gadget-start-prefix"] = validateString(
      rawObj["gadget-start-prefix"],
      "gadget-start-prefix",
      section,
    );
  }
  if ("gadget-end-prefix" in rawObj) {
    result["gadget-end-prefix"] = validateString(
      rawObj["gadget-end-prefix"],
      "gadget-end-prefix",
      section,
    );
  }
  if ("gadget-arg-prefix" in rawObj) {
    result["gadget-arg-prefix"] = validateString(
      rawObj["gadget-arg-prefix"],
      "gadget-arg-prefix",
      section,
    );
  }
  if ("gadget-approval" in rawObj) {
    result["gadget-approval"] = validateGadgetApproval(rawObj["gadget-approval"], section);
  }

  // Complete-specific fields
  if ("max-tokens" in rawObj) {
    result["max-tokens"] = validateNumber(rawObj["max-tokens"], "max-tokens", section, {
      integer: true,
      min: 1,
    });
  }

  // Shared fields
  if ("quiet" in rawObj) {
    result.quiet = validateBoolean(rawObj.quiet, "quiet", section);
  }

  // Logging options
  Object.assign(result, validateLoggingConfig(rawObj, section));

  return result;
}

/**
 * Validates the prompts config section.
 * Each key must be a string (prompt name) and each value must be a string (template).
 */
function validatePromptsConfig(raw: unknown, section: string): PromptsConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new ConfigError(`[${section}] must be a table`);
  }

  const result: PromptsConfig = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") {
      throw new ConfigError(`[${section}].${key} must be a string`);
    }
    result[key] = value;
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
      } else if (key === "prompts") {
        result.prompts = validatePromptsConfig(value, key);
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
  const reserved = new Set(["global", "complete", "agent", "prompts"]);
  return Object.keys(config).filter((key) => !reserved.has(key));
}

/**
 * Resolves Eta templates in system prompts throughout the config.
 * Templates are resolved using the [prompts] section as named partials.
 *
 * @param config - Config with inheritance already resolved
 * @param configPath - Path to config file for error messages
 * @returns Config with all templates resolved in system prompts
 * @throws ConfigError if template resolution fails
 */
export function resolveTemplatesInConfig(config: CLIConfig, configPath?: string): CLIConfig {
  const prompts = config.prompts ?? {};

  // If no prompts and no templates used, return as-is
  const hasPrompts = Object.keys(prompts).length > 0;

  // Check if any section uses template syntax
  let hasTemplates = false;
  for (const [sectionName, section] of Object.entries(config)) {
    if (sectionName === "global" || sectionName === "prompts") continue;
    if (!section || typeof section !== "object") continue;

    const sectionObj = section as Record<string, unknown>;
    if (typeof sectionObj.system === "string" && hasTemplateSyntax(sectionObj.system)) {
      hasTemplates = true;
      break;
    }
  }

  // Also check prompts for template syntax (they may reference each other)
  for (const template of Object.values(prompts)) {
    if (hasTemplateSyntax(template)) {
      hasTemplates = true;
      break;
    }
  }

  // Quick return if nothing to do
  if (!hasPrompts && !hasTemplates) {
    return config;
  }

  // Validate all prompts compile correctly and env vars exist
  try {
    validatePrompts(prompts, configPath);
  } catch (error) {
    if (error instanceof TemplateError) {
      throw new ConfigError(error.message, configPath);
    }
    throw error;
  }

  // Validate environment variables in all prompts
  for (const [name, template] of Object.entries(prompts)) {
    try {
      validateEnvVars(template, name, configPath);
    } catch (error) {
      if (error instanceof TemplateError) {
        throw new ConfigError(error.message, configPath);
      }
      throw error;
    }
  }

  // Create template engine with all prompts registered
  const eta = createTemplateEngine(prompts, configPath);
  const result = { ...config };

  // Resolve templates in all sections with system fields
  for (const [sectionName, section] of Object.entries(config)) {
    if (sectionName === "global" || sectionName === "prompts") continue;
    if (!section || typeof section !== "object") continue;

    const sectionObj = section as Record<string, unknown>;
    if (typeof sectionObj.system === "string" && hasTemplateSyntax(sectionObj.system)) {
      // Validate env vars in the system prompt itself
      try {
        validateEnvVars(sectionObj.system, undefined, configPath);
      } catch (error) {
        if (error instanceof TemplateError) {
          throw new ConfigError(`[${sectionName}].system: ${error.message}`, configPath);
        }
        throw error;
      }

      // Resolve the template
      try {
        const resolved = resolveTemplate(eta, sectionObj.system, {}, configPath);
        result[sectionName] = {
          ...sectionObj,
          system: resolved,
        };
      } catch (error) {
        if (error instanceof TemplateError) {
          throw new ConfigError(`[${sectionName}].system: ${error.message}`, configPath);
        }
        throw error;
      }
    }
  }

  return result;
}

/**
 * Resolves gadget configuration with inheritance support.
 * Handles gadgets (full replacement), gadget-add (append), and gadget-remove (filter).
 *
 * Resolution order:
 * 1. If `gadgets` is present (or deprecated `gadget`), use it as full replacement
 * 2. Otherwise, start with inherited gadgets and apply add/remove
 *
 * @param section - The section's own values (not yet merged)
 * @param inheritedGadgets - Gadgets from parent sections
 * @param sectionName - Name of section for error messages
 * @param configPath - Path to config file for error messages
 * @returns Resolved gadget array
 * @throws ConfigError if conflicting gadget options
 */
function resolveGadgets(
  section: Record<string, unknown>,
  inheritedGadgets: string[],
  sectionName: string,
  configPath?: string,
): string[] {
  const hasGadgets = "gadgets" in section;
  const hasGadgetLegacy = "gadget" in section;
  const hasGadgetAdd = "gadget-add" in section;
  const hasGadgetRemove = "gadget-remove" in section;

  // Warn on deprecated 'gadget' usage
  if (hasGadgetLegacy && !hasGadgets) {
    console.warn(
      `[config] Warning: [${sectionName}].gadget is deprecated, use 'gadgets' (plural) instead`,
    );
  }

  // Error if both full replacement AND add/remove
  if ((hasGadgets || hasGadgetLegacy) && (hasGadgetAdd || hasGadgetRemove)) {
    throw new ConfigError(
      `[${sectionName}] Cannot use 'gadgets' with 'gadget-add'/'gadget-remove'. ` +
        `Use either full replacement (gadgets) OR modification (gadget-add/gadget-remove).`,
      configPath,
    );
  }

  // Full replacement mode (new `gadgets` takes precedence over deprecated `gadget`)
  if (hasGadgets) {
    return section.gadgets as string[];
  }
  if (hasGadgetLegacy) {
    return section.gadget as string[];
  }

  // Modification mode: start with inherited
  let result = [...inheritedGadgets];

  // Apply removes first
  if (hasGadgetRemove) {
    const toRemove = new Set(section["gadget-remove"] as string[]);
    result = result.filter((g) => !toRemove.has(g));
  }

  // Then apply adds
  if (hasGadgetAdd) {
    const toAdd = section["gadget-add"] as string[];
    result.push(...toAdd);
  }

  return result;
}

/**
 * Resolves inheritance chains for all sections in the config.
 * Each section can specify `inherits` as a string or array of strings.
 * Resolution follows these rules:
 * - For multiple parents, later parents override earlier ones (last wins)
 * - Section's own values always override inherited values
 * - Arrays are replaced, not merged (except gadgets with add/remove support)
 * - Circular inheritance is detected and throws an error
 *
 * @param config - Validated config with possible unresolved inheritance
 * @param configPath - Path to config file for error messages
 * @returns Config with all inheritance resolved
 * @throws ConfigError if circular inheritance or unknown parent section
 */
export function resolveInheritance(config: CLIConfig, configPath?: string): CLIConfig {
  const resolved: Record<string, Record<string, unknown>> = {};
  const resolving = new Set<string>(); // For cycle detection

  function resolveSection(name: string): Record<string, unknown> {
    // Return cached if already resolved
    if (name in resolved) {
      return resolved[name];
    }

    // Cycle detection
    if (resolving.has(name)) {
      throw new ConfigError(`Circular inheritance detected: ${name}`, configPath);
    }

    const section = config[name];
    if (section === undefined || typeof section !== "object") {
      throw new ConfigError(`Cannot inherit from unknown section: ${name}`, configPath);
    }

    resolving.add(name);

    // Get inheritance list (normalize to array)
    const sectionObj = section as Record<string, unknown>;
    const inheritsRaw = sectionObj.inherits;
    const inheritsList: string[] = inheritsRaw
      ? Array.isArray(inheritsRaw)
        ? inheritsRaw
        : [inheritsRaw]
      : [];

    // Resolve all parents first (recursive), merge in order (last wins)
    let merged: Record<string, unknown> = {};
    for (const parent of inheritsList) {
      const parentResolved = resolveSection(parent);
      merged = { ...merged, ...parentResolved };
    }

    // Get inherited gadgets before applying own values
    const inheritedGadgets = (merged.gadgets as string[] | undefined) ?? [];

    // Apply own values on top (excluding metadata and gadget-related keys handled specially)
    const {
      inherits: _inherits,
      gadgets: _gadgets,
      gadget: _gadget,
      "gadget-add": _gadgetAdd,
      "gadget-remove": _gadgetRemove,
      ...ownValues
    } = sectionObj;
    merged = { ...merged, ...ownValues };

    // Resolve gadgets with add/remove support
    const resolvedGadgets = resolveGadgets(sectionObj, inheritedGadgets, name, configPath);
    if (resolvedGadgets.length > 0) {
      merged.gadgets = resolvedGadgets;
    }

    // Clean up legacy/modification fields from output
    delete merged["gadget"];
    delete merged["gadget-add"];
    delete merged["gadget-remove"];

    resolving.delete(name);
    resolved[name] = merged;
    return merged;
  }

  // Resolve all sections
  for (const name of Object.keys(config)) {
    resolveSection(name);
  }

  return resolved as unknown as CLIConfig;
}
