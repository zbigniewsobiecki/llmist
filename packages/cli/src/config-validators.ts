import type { SubagentConfig, SubagentConfigMap } from "llmist";
import type {
  AgentConfig,
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
import {
  AGENT_CONFIG_KEYS,
  COMPLETE_CONFIG_KEYS,
  CUSTOM_CONFIG_KEYS,
  GLOBAL_CONFIG_KEYS,
  IMAGE_CONFIG_KEYS,
  RATE_LIMITS_CONFIG_KEYS,
  REASONING_CONFIG_KEYS,
  RETRY_CONFIG_KEYS,
  SPEECH_CONFIG_KEYS,
  VALID_LOG_LEVELS,
  VALID_PERMISSION_LEVELS,
  VALID_REASONING_EFFORTS,
} from "./config-types.js";
import { expandTildePath } from "./paths.js";
import type { GlobalSubagentConfig } from "./subagent-config.js";
import type { PromptsConfig } from "./templates.js";

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
export function validateString(value: unknown, key: string, section: string): string {
  if (typeof value !== "string") {
    throw new ConfigError(`[${section}].${key} must be a string`);
  }
  return value;
}

/**
 * Validates that a value is a string representing a file path.
 * Expands tilde (~) to the user's home directory.
 */
export function validatePathString(value: unknown, key: string, section: string): string {
  return expandTildePath(validateString(value, key, section));
}

/**
 * Validates that a value is a number within optional bounds.
 */
export function validateNumber(
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
export function validateBoolean(value: unknown, key: string, section: string): boolean {
  if (typeof value !== "boolean") {
    throw new ConfigError(`[${section}].${key} must be a boolean`);
  }
  return value;
}

/**
 * Validates that a value is an array of strings.
 */
export function validateStringArray(value: unknown, key: string, section: string): string[] {
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
export function validateInherits(value: unknown, section: string): string | string[] {
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
 * Validates a TOML table-like object (must be an object, not null, not array).
 * Reusable guard replacing 8+ identical `if (typeof val !== "object"...)` blocks.
 */
export function validateTable(
  raw: unknown,
  section: string,
  validKeys?: Set<string>,
): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigError(`[${section}] must be a table`);
  }
  const obj = raw as Record<string, unknown>;
  if (validKeys) {
    for (const key of Object.keys(obj)) {
      if (!validKeys.has(key)) {
        throw new ConfigError(`[${section}].${key} is not a valid option`);
      }
    }
  }
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// Declarative field schema infrastructure
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single field validation rule used in declarative field schema maps.
 */
type FieldRule =
  | { type: "string" }
  | { type: "path" } // string with tilde expansion
  | { type: "boolean" }
  | { type: "number"; min?: number; max?: number; integer?: boolean }
  | { type: "string[]" }
  | { type: "enum"; values: readonly string[] }
  | { type: "custom"; validate: (value: unknown, key: string, section: string) => unknown };

/**
 * A map from field names to their validation rules.
 */
type FieldSchemaMap = Record<string, FieldRule>;

/**
 * Validates a raw object's fields against a declarative schema map.
 * Only processes keys present in both `rawObj` and `schema`.
 * Returns a plain object with the validated values.
 */
function validateFields(
  rawObj: Record<string, unknown>,
  section: string,
  schema: FieldSchemaMap,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(schema)) {
    if (!(key in rawObj)) continue;
    const value = rawObj[key];
    switch (rule.type) {
      case "string":
        result[key] = validateString(value, key, section);
        break;
      case "path":
        result[key] = validatePathString(value, key, section);
        break;
      case "boolean":
        result[key] = validateBoolean(value, key, section);
        break;
      case "number":
        result[key] = validateNumber(value, key, section, {
          min: rule.min,
          max: rule.max,
          integer: rule.integer,
        });
        break;
      case "string[]":
        result[key] = validateStringArray(value, key, section);
        break;
      case "enum": {
        const str = validateString(value, key, section);
        if (!rule.values.includes(str)) {
          throw new ConfigError(
            `[${section}].${key} must be one of: ${rule.values.join(", ")} (got "${str}")`,
          );
        }
        result[key] = str;
        break;
      }
      case "custom":
        result[key] = rule.validate(value, key, section);
        break;
    }
  }
  return result;
}

/**
 * Handles the shared rate-limits / retry / reasoning sub-sections that appear
 * in validateCompleteConfig, validateAgentConfig, and validateCustomConfig.
 */
function validateSharedNestedSections(
  rawObj: Record<string, unknown>,
  section: string,
  result: Record<string, unknown>,
): void {
  if ("rate-limits" in rawObj) {
    result["rate-limits"] = validateRateLimitsConfig(
      rawObj["rate-limits"],
      `${section}.rate-limits`,
    );
  }
  if ("retry" in rawObj) {
    result.retry = validateRetryConfig(rawObj.retry, `${section}.retry`);
  }
  if ("reasoning" in rawObj) {
    result.reasoning = validateReasoningConfig(rawObj.reasoning, `${section}.reasoning`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Declarative schemas for each config section
// ─────────────────────────────────────────────────────────────────────────────

const RATE_LIMITS_SCHEMA: FieldSchemaMap = {
  "requests-per-minute": { type: "number", integer: true, min: 1 },
  "tokens-per-minute": { type: "number", integer: true, min: 1 },
  "tokens-per-day": { type: "number", integer: true, min: 1 },
  "safety-margin": { type: "number", min: 0, max: 1 },
  enabled: { type: "boolean" },
};

const RETRY_SCHEMA: FieldSchemaMap = {
  enabled: { type: "boolean" },
  retries: { type: "number", integer: true, min: 0 },
  "min-timeout": { type: "number", integer: true, min: 0 },
  "max-timeout": { type: "number", integer: true, min: 0 },
  factor: { type: "number", min: 1 },
  randomize: { type: "boolean" },
  "respect-retry-after": { type: "boolean" },
  "max-retry-after-ms": { type: "number", integer: true, min: 0 },
};

const REASONING_SCHEMA: FieldSchemaMap = {
  enabled: { type: "boolean" },
  effort: { type: "enum", values: [...VALID_REASONING_EFFORTS] },
  "budget-tokens": { type: "number", integer: true, min: 1 },
};

const IMAGE_SCHEMA: FieldSchemaMap = {
  model: { type: "string" },
  size: { type: "string" },
  quality: { type: "string" },
  count: { type: "number", integer: true, min: 1, max: 10 },
  output: { type: "path" },
  quiet: { type: "boolean" },
};

const SPEECH_SCHEMA: FieldSchemaMap = {
  model: { type: "string" },
  voice: { type: "string" },
  format: { type: "string" },
  speed: { type: "number", min: 0.25, max: 4.0 },
  output: { type: "path" },
  quiet: { type: "boolean" },
};

const COMPLETE_EXTRA_SCHEMA: FieldSchemaMap = {
  "max-tokens": { type: "number", integer: true, min: 1 },
  quiet: { type: "boolean" },
  "log-llm-requests": { type: "boolean" },
};

/** Simple agent/custom fields that map directly to a single validate call. */
const AGENT_SIMPLE_FIELDS_SCHEMA: FieldSchemaMap = {
  "max-iterations": { type: "number", integer: true, min: 1 },
  budget: { type: "number", min: 0 },
  gadgets: { type: "string[]" },
  "gadget-add": { type: "string[]" },
  "gadget-remove": { type: "string[]" },
  builtins: { type: "boolean" },
  "builtin-interaction": { type: "boolean" },
  "gadget-start-prefix": { type: "string" },
  "gadget-end-prefix": { type: "string" },
  "gadget-arg-prefix": { type: "string" },
  quiet: { type: "boolean" },
  "log-llm-requests": { type: "boolean" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Complex / nested validators (unchanged public API)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a single subagent configuration.
 * Subagent configs are flexible objects with optional model and maxIterations.
 */
export function validateSingleSubagentConfig(
  value: unknown,
  subagentName: string,
  section: string,
): SubagentConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError(
      `[${section}].${subagentName} must be a table (e.g., { model = "inherit", maxIterations = 20 })`,
    );
  }

  const result: SubagentConfig = {};
  const rawObj = value as Record<string, unknown>;

  for (const [key, val] of Object.entries(rawObj)) {
    if (key === "model") {
      if (typeof val !== "string") {
        throw new ConfigError(`[${section}].${subagentName}.model must be a string`);
      }
      result.model = val;
    } else if (key === "maxIterations") {
      if (typeof val !== "number" || !Number.isInteger(val) || val < 1) {
        throw new ConfigError(
          `[${section}].${subagentName}.maxIterations must be a positive integer`,
        );
      }
      result.maxIterations = val;
    } else if (key === "budget") {
      if (typeof val !== "number" || val < 0) {
        throw new ConfigError(`[${section}].${subagentName}.budget must be a non-negative number`);
      }
      result.budget = val;
    } else if (key === "timeoutMs") {
      if (typeof val !== "number" || !Number.isInteger(val) || val < 0) {
        throw new ConfigError(
          `[${section}].${subagentName}.timeoutMs must be a non-negative integer`,
        );
      }
      result.timeoutMs = val;
    } else if (key === "maxConcurrent") {
      if (typeof val !== "number" || !Number.isInteger(val) || val < 0) {
        throw new ConfigError(
          `[${section}].${subagentName}.maxConcurrent must be a non-negative integer`,
        );
      }
      result.maxConcurrent = val;
    } else {
      // Allow arbitrary additional options (headless, etc.)
      result[key] = val;
    }
  }

  return result;
}

/**
 * Validates a subagent configuration map (per-profile subagents).
 */
export function validateSubagentConfigMap(value: unknown, section: string): SubagentConfigMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError(
      `[${section}].subagents must be a table (e.g., { BrowseWeb = { model = "inherit" } })`,
    );
  }

  const result: SubagentConfigMap = {};
  for (const [subagentName, config] of Object.entries(value as Record<string, unknown>)) {
    result[subagentName] = validateSingleSubagentConfig(
      config,
      subagentName,
      `${section}.subagents`,
    );
  }
  return result;
}

/**
 * Validates rate limits configuration.
 */
export function validateRateLimitsConfig(value: unknown, section: string): RateLimitsConfig {
  const raw = validateTable(value, section, RATE_LIMITS_CONFIG_KEYS);
  const result = validateFields(raw, section, RATE_LIMITS_SCHEMA) as RateLimitsConfig;

  // Warn for suspiciously high limits
  if (result["requests-per-minute"] && result["requests-per-minute"] > 10_000) {
    console.warn(
      `⚠️  Warning: [${section}].requests-per-minute is very high (${result["requests-per-minute"]}). Make sure your API tier supports this rate.`,
    );
  }

  if (result["tokens-per-minute"] && result["tokens-per-minute"] > 5_000_000) {
    console.warn(
      `⚠️  Warning: [${section}].tokens-per-minute is very high (${result["tokens-per-minute"]}). Make sure your API tier supports this rate.`,
    );
  }

  return result;
}

/**
 * Validates retry configuration.
 */
export function validateRetryConfig(value: unknown, section: string): RetryConfigCLI {
  const raw = validateTable(value, section, RETRY_CONFIG_KEYS);
  return validateFields(raw, section, RETRY_SCHEMA) as RetryConfigCLI;
}

/**
 * Validates reasoning configuration.
 */
export function validateReasoningConfig(value: unknown, section: string): ReasoningConfigCLI {
  const raw = validateTable(value, section, REASONING_CONFIG_KEYS);
  return validateFields(raw, section, REASONING_SCHEMA) as ReasoningConfigCLI;
}

/**
 * Validates the global [subagents] section.
 * Contains default-model and per-subagent configurations.
 */
export function validateGlobalSubagentConfig(
  value: unknown,
  section: string,
): GlobalSubagentConfig {
  const rawObj = validateTable(value, section);
  const result: GlobalSubagentConfig = {};

  for (const [key, val] of Object.entries(rawObj)) {
    if (key === "default-model") {
      if (typeof val !== "string") {
        throw new ConfigError(`[${section}].default-model must be a string`);
      }
      result["default-model"] = val;
    } else {
      // Per-subagent config (nested table)
      result[key] = validateSingleSubagentConfig(val, key, section);
    }
  }

  return result;
}

/**
 * Validates that a value is a gadget approval config (object mapping gadget names to modes).
 */
export function validateGadgetApproval(value: unknown, section: string): GadgetPermissionPolicy {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError(
      `[${section}].gadget-approval must be a table (e.g., { WriteFile = "approval-required" })`,
    );
  }

  const result: GadgetPermissionPolicy = {};
  for (const [gadgetName, mode] of Object.entries(value as Record<string, unknown>)) {
    if (typeof mode !== "string") {
      throw new ConfigError(`[${section}].gadget-approval.${gadgetName} must be a string`);
    }
    if (!VALID_PERMISSION_LEVELS.includes(mode as GadgetPermissionLevel)) {
      throw new ConfigError(
        `[${section}].gadget-approval.${gadgetName} must be one of: ${VALID_PERMISSION_LEVELS.join(", ")}`,
      );
    }
    result[gadgetName] = mode as GadgetPermissionLevel;
  }
  return result;
}

/**
 * Validates that a value is an initial-gadgets array.
 * Each entry must have: gadget (string), parameters (object), result (string).
 */
export function validateInitialGadgets(value: unknown, section: string): InitialGadget[] {
  if (!Array.isArray(value)) {
    throw new ConfigError(`[${section}].initial-gadgets must be an array`);
  }

  const result: InitialGadget[] = [];
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new ConfigError(
        `[${section}].initial-gadgets[${i}] must be a table with gadget, parameters, and result`,
      );
    }

    const entryObj = entry as Record<string, unknown>;

    // Validate required 'gadget' field
    if (!("gadget" in entryObj)) {
      throw new ConfigError(
        `[${section}].initial-gadgets[${i}] is missing required field 'gadget'`,
      );
    }
    if (typeof entryObj.gadget !== "string") {
      throw new ConfigError(`[${section}].initial-gadgets[${i}].gadget must be a string`);
    }

    // Validate required 'parameters' field
    if (!("parameters" in entryObj)) {
      throw new ConfigError(
        `[${section}].initial-gadgets[${i}] is missing required field 'parameters'`,
      );
    }
    if (typeof entryObj.parameters !== "object" || entryObj.parameters === null) {
      throw new ConfigError(`[${section}].initial-gadgets[${i}].parameters must be a table`);
    }

    // Validate required 'result' field
    if (!("result" in entryObj)) {
      throw new ConfigError(
        `[${section}].initial-gadgets[${i}] is missing required field 'result'`,
      );
    }
    if (typeof entryObj.result !== "string") {
      throw new ConfigError(`[${section}].initial-gadgets[${i}].result must be a string`);
    }

    result.push({
      gadget: entryObj.gadget,
      parameters: entryObj.parameters as Record<string, unknown>,
      result: entryObj.result,
    });
  }

  return result;
}

/**
 * Validates and extracts logging config fields from a raw object.
 */
export function validateLoggingConfig(
  raw: Record<string, unknown>,
  section: string,
): { "log-level"?: LogLevel } {
  const result: { "log-level"?: LogLevel } = {};

  if ("log-level" in raw) {
    const level = validateString(raw["log-level"], "log-level", section);
    if (!VALID_LOG_LEVELS.includes(level as LogLevel)) {
      throw new ConfigError(
        `[${section}].log-level must be one of: ${VALID_LOG_LEVELS.join(", ")}`,
      );
    }
    result["log-level"] = level as LogLevel;
  }

  return result;
}

/**
 * Validates and extracts base command config fields.
 */
export function validateBaseConfig(
  raw: Record<string, unknown>,
  section: string,
): Partial<SharedCommandConfig> {
  const result: Partial<SharedCommandConfig> = {};

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
 * Validates and assigns agent-specific fields shared between validateAgentConfig and
 * validateCustomConfig. Mutates result in-place and returns it for convenience.
 */
export function validateAgentFields(
  rawObj: Record<string, unknown>,
  section: string,
  result: AgentConfig | CustomCommandConfig,
): void {
  // Validate simple scalar/array fields declaratively
  Object.assign(result, validateFields(rawObj, section, AGENT_SIMPLE_FIELDS_SCHEMA));

  // Complex fields with nested validation logic kept inline
  if ("gadget-approval" in rawObj) {
    result["gadget-approval"] = validateGadgetApproval(rawObj["gadget-approval"], section);
  }
  if ("subagents" in rawObj) {
    result.subagents = validateSubagentConfigMap(rawObj.subagents, section);
  }
  if ("initial-gadgets" in rawObj) {
    result["initial-gadgets"] = validateInitialGadgets(rawObj["initial-gadgets"], section);
  }
}

/**
 * Validates the global config section.
 */
export function validateGlobalConfig(raw: unknown, section: string): GlobalConfig {
  const rawObj = validateTable(raw, section, GLOBAL_CONFIG_KEYS);
  return validateLoggingConfig(rawObj, section);
}

/**
 * Validates a complete command config section.
 */
export function validateCompleteConfig(raw: unknown, section: string): CompleteConfig {
  const rawObj = validateTable(raw, section, COMPLETE_CONFIG_KEYS);

  const result: CompleteConfig = {
    ...validateBaseConfig(rawObj, section),
    ...validateLoggingConfig(rawObj, section),
    ...validateFields(rawObj, section, COMPLETE_EXTRA_SCHEMA),
  };

  validateSharedNestedSections(rawObj, section, result as Record<string, unknown>);

  return result;
}

/**
 * Validates an agent command config section.
 */
export function validateAgentConfig(raw: unknown, section: string): AgentConfig {
  const rawObj = validateTable(raw, section, AGENT_CONFIG_KEYS);

  const result: AgentConfig = {
    ...validateBaseConfig(rawObj, section),
    ...validateLoggingConfig(rawObj, section),
  };

  validateAgentFields(rawObj, section, result);
  validateSharedNestedSections(rawObj, section, result as Record<string, unknown>);

  return result;
}

/**
 * Validates an image command config section.
 */
export function validateImageConfig(raw: unknown, section: string): ImageConfig {
  const rawObj = validateTable(raw, section, IMAGE_CONFIG_KEYS);
  return validateFields(rawObj, section, IMAGE_SCHEMA) as ImageConfig;
}

/**
 * Validates a speech command config section.
 */
export function validateSpeechConfig(raw: unknown, section: string): SpeechConfig {
  const rawObj = validateTable(raw, section, SPEECH_CONFIG_KEYS);
  return validateFields(rawObj, section, SPEECH_SCHEMA) as SpeechConfig;
}

/**
 * Validates a custom command config section.
 */
export function validateCustomConfig(raw: unknown, section: string): CustomCommandConfig {
  const rawObj = validateTable(raw, section, CUSTOM_CONFIG_KEYS);

  // Get the type first to validate properly
  let type: import("./config-types.js").CommandType = "agent"; // Default
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
  validateAgentFields(rawObj, section, result);

  // Complete-specific fields
  if ("max-tokens" in rawObj) {
    result["max-tokens"] = validateNumber(rawObj["max-tokens"], "max-tokens", section, {
      integer: true,
      min: 1,
    });
  }

  // Logging options
  Object.assign(result, validateLoggingConfig(rawObj, section));

  return result;
}

/**
 * Validates the prompts config section.
 * Each key must be a string (prompt name) and each value must be a string (template).
 */
export function validatePromptsConfig(raw: unknown, section: string): PromptsConfig {
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
