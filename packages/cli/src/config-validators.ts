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
  const result: RateLimitsConfig = {};

  for (const [key, val] of Object.entries(raw)) {
    switch (key) {
      case "requests-per-minute":
        result["requests-per-minute"] = validateNumber(val, key, section, {
          integer: true,
          min: 1,
        });
        break;
      case "tokens-per-minute":
        result["tokens-per-minute"] = validateNumber(val, key, section, { integer: true, min: 1 });
        break;
      case "tokens-per-day":
        result["tokens-per-day"] = validateNumber(val, key, section, { integer: true, min: 1 });
        break;
      case "safety-margin":
        result["safety-margin"] = validateNumber(val, key, section, { min: 0, max: 1 });
        break;
      case "enabled":
        result.enabled = validateBoolean(val, key, section);
        break;
    }
  }

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
  const result: RetryConfigCLI = {};

  for (const [key, val] of Object.entries(raw)) {
    switch (key) {
      case "enabled":
        result.enabled = validateBoolean(val, key, section);
        break;
      case "retries":
        result.retries = validateNumber(val, key, section, { integer: true, min: 0 });
        break;
      case "min-timeout":
        result["min-timeout"] = validateNumber(val, key, section, { integer: true, min: 0 });
        break;
      case "max-timeout":
        result["max-timeout"] = validateNumber(val, key, section, { integer: true, min: 0 });
        break;
      case "factor":
        result.factor = validateNumber(val, key, section, { min: 1 });
        break;
      case "randomize":
        result.randomize = validateBoolean(val, key, section);
        break;
      case "respect-retry-after":
        result["respect-retry-after"] = validateBoolean(val, key, section);
        break;
      case "max-retry-after-ms":
        result["max-retry-after-ms"] = validateNumber(val, key, section, { integer: true, min: 0 });
        break;
    }
  }

  return result;
}

/**
 * Validates reasoning configuration.
 */
export function validateReasoningConfig(value: unknown, section: string): ReasoningConfigCLI {
  const raw = validateTable(value, section, REASONING_CONFIG_KEYS);
  const result: ReasoningConfigCLI = {};

  for (const [key, val] of Object.entries(raw)) {
    switch (key) {
      case "enabled":
        result.enabled = validateBoolean(val, key, section);
        break;
      case "effort": {
        const effort = validateString(val, key, section);
        if (!VALID_REASONING_EFFORTS.has(effort)) {
          throw new ConfigError(
            `[${section}].effort must be one of: none, low, medium, high, maximum (got "${effort}")`,
          );
        }
        result.effort = effort;
        break;
      }
      case "budget-tokens":
        result["budget-tokens"] = validateNumber(val, key, section, { integer: true, min: 1 });
        break;
    }
  }

  return result;
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
  if ("max-iterations" in rawObj) {
    result["max-iterations"] = validateNumber(rawObj["max-iterations"], "max-iterations", section, {
      integer: true,
      min: 1,
    });
  }
  if ("budget" in rawObj) {
    result.budget = validateNumber(rawObj.budget, "budget", section, { min: 0 });
  }
  // Gadget configuration (new plural form preferred)
  if ("gadgets" in rawObj) {
    result.gadgets = validateStringArray(rawObj.gadgets, "gadgets", section);
  }
  if ("gadget-add" in rawObj) {
    result["gadget-add"] = validateStringArray(rawObj["gadget-add"], "gadget-add", section);
  }
  if ("gadget-remove" in rawObj) {
    result["gadget-remove"] = validateStringArray(
      rawObj["gadget-remove"],
      "gadget-remove",
      section,
    );
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
  if ("subagents" in rawObj) {
    result.subagents = validateSubagentConfigMap(rawObj.subagents, section);
  }
  if ("initial-gadgets" in rawObj) {
    result["initial-gadgets"] = validateInitialGadgets(rawObj["initial-gadgets"], section);
  }
  if ("quiet" in rawObj) {
    result.quiet = validateBoolean(rawObj.quiet, "quiet", section);
  }
  if ("log-llm-requests" in rawObj) {
    result["log-llm-requests"] = validateBoolean(
      rawObj["log-llm-requests"],
      "log-llm-requests",
      section,
    );
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
    result["log-llm-requests"] = validateBoolean(
      rawObj["log-llm-requests"],
      "log-llm-requests",
      section,
    );
  }
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

  return result;
}

/**
 * Validates an image command config section.
 */
export function validateImageConfig(raw: unknown, section: string): ImageConfig {
  const rawObj = validateTable(raw, section, IMAGE_CONFIG_KEYS);
  const result: ImageConfig = {};

  if ("model" in rawObj) {
    result.model = validateString(rawObj.model, "model", section);
  }
  if ("size" in rawObj) {
    result.size = validateString(rawObj.size, "size", section);
  }
  if ("quality" in rawObj) {
    result.quality = validateString(rawObj.quality, "quality", section);
  }
  if ("count" in rawObj) {
    result.count = validateNumber(rawObj.count, "count", section, {
      integer: true,
      min: 1,
      max: 10,
    });
  }
  if ("output" in rawObj) {
    result.output = validatePathString(rawObj.output, "output", section);
  }
  if ("quiet" in rawObj) {
    result.quiet = validateBoolean(rawObj.quiet, "quiet", section);
  }

  return result;
}

/**
 * Validates a speech command config section.
 */
export function validateSpeechConfig(raw: unknown, section: string): SpeechConfig {
  const rawObj = validateTable(raw, section, SPEECH_CONFIG_KEYS);
  const result: SpeechConfig = {};

  if ("model" in rawObj) {
    result.model = validateString(rawObj.model, "model", section);
  }
  if ("voice" in rawObj) {
    result.voice = validateString(rawObj.voice, "voice", section);
  }
  if ("format" in rawObj) {
    result.format = validateString(rawObj.format, "format", section);
  }
  if ("speed" in rawObj) {
    result.speed = validateNumber(rawObj.speed, "speed", section, {
      min: 0.25,
      max: 4.0,
    });
  }
  if ("output" in rawObj) {
    result.output = validatePathString(rawObj.output, "output", section);
  }
  if ("quiet" in rawObj) {
    result.quiet = validateBoolean(rawObj.quiet, "quiet", section);
  }

  return result;
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
