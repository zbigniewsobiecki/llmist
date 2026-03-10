import type { GlobalSubagentConfig } from "./subagent-config.js";
import type { PromptsConfig } from "./templates.js";

// Re-export SubagentConfig types from llmist for consumers
export type { SubagentConfig, SubagentConfigMap } from "llmist";
// Re-export GlobalSubagentConfig for consumers
export type { GlobalSubagentConfig } from "./subagent-config.js";
// Re-export PromptsConfig for consumers
export type { PromptsConfig } from "./templates.js";

/**
 * Valid log level names.
 */
export type LogLevel = "silly" | "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Gadget permission level determines how a gadget execution is handled.
 * - "allowed": Auto-proceed without prompting
 * - "denied": Auto-reject, return denial message to LLM
 * - "approval-required": Prompt user for approval before execution
 */
export type GadgetPermissionLevel = "allowed" | "denied" | "approval-required";

/**
 * Valid gadget permission levels.
 */
export const VALID_PERMISSION_LEVELS: GadgetPermissionLevel[] = [
  "allowed",
  "denied",
  "approval-required",
];

/**
 * Configuration for per-gadget permission behavior.
 * Keys are gadget names (case-insensitive), values are permission levels.
 * Special key "*" sets the default for unconfigured gadgets.
 */
export type GadgetPermissionPolicy = Record<string, GadgetPermissionLevel>;

/**
 * Global CLI options that apply to all commands.
 */
export interface GlobalConfig {
  "log-level"?: LogLevel;
}

/**
 * Rate limiting configuration for the CLI.
 */
export interface RateLimitsConfig {
  "requests-per-minute"?: number;
  "tokens-per-minute"?: number;
  "tokens-per-day"?: number;
  "safety-margin"?: number;
  enabled?: boolean;
}

/**
 * Retry configuration for LLM API calls.
 */
export interface RetryConfigCLI {
  enabled?: boolean;
  retries?: number;
  "min-timeout"?: number;
  "max-timeout"?: number;
  factor?: number;
  randomize?: boolean;
  "respect-retry-after"?: boolean;
  "max-retry-after-ms"?: number;
}

/**
 * Reasoning configuration from TOML config.
 */
export interface ReasoningConfigCLI {
  enabled?: boolean;
  effort?: string; // "none" | "low" | "medium" | "high" | "maximum"
  "budget-tokens"?: number;
}

/**
 * Shared options used by both complete and agent command configurations.
 */
export interface SharedCommandConfig {
  model?: string;
  system?: string;
  temperature?: number;
  inherits?: string | string[];
  /** Rate limiting configuration */
  "rate-limits"?: RateLimitsConfig;
  /** Retry configuration */
  retry?: RetryConfigCLI;
  /** Reasoning configuration */
  reasoning?: ReasoningConfigCLI;
}

/**
 * Configuration for the complete command.
 */
export interface CompleteConfig extends SharedCommandConfig {
  "max-tokens"?: number;
  quiet?: boolean;
  "log-level"?: LogLevel;
  "log-llm-requests"?: boolean;
}

/**
 * Configuration for the image command.
 */
export interface ImageConfig {
  model?: string;
  size?: string;
  quality?: string;
  count?: number;
  output?: string;
  quiet?: boolean;
}

/**
 * Configuration for the speech command.
 */
export interface SpeechConfig {
  model?: string;
  voice?: string;
  format?: string;
  speed?: number;
  output?: string;
  quiet?: boolean;
}

/**
 * Configuration for a pre-seeded gadget result.
 * Used with initial-gadgets to inject context into the agent's conversation history.
 */
export interface InitialGadget {
  /** Name of the gadget (e.g., "ListDirectory", "ReadFile") */
  gadget: string;
  /** Parameters that were "passed" to the gadget */
  parameters: Record<string, unknown>;
  /** The pre-filled result from the gadget */
  result: string;
}

/**
 * Configuration for the agent command.
 */
export interface AgentConfig extends SharedCommandConfig {
  "max-iterations"?: number;
  budget?: number;
  gadgets?: string[]; // Full replacement (preferred)
  "gadget-add"?: string[]; // Add to inherited gadgets
  "gadget-remove"?: string[]; // Remove from inherited gadgets
  builtins?: boolean;
  "builtin-interaction"?: boolean;
  "gadget-start-prefix"?: string;
  "gadget-end-prefix"?: string;
  "gadget-arg-prefix"?: string;
  "gadget-approval"?: GadgetPermissionPolicy;
  /** Per-subagent configuration overrides for this profile/command */
  subagents?: import("llmist").SubagentConfigMap;
  /** Pre-seeded gadget results to inject into conversation history */
  "initial-gadgets"?: InitialGadget[];
  quiet?: boolean;
  "log-level"?: LogLevel;
  "log-llm-requests"?: boolean;
  /** Show keyboard shortcuts hints bar in TUI (default: true) */
  "show-hints"?: boolean;
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
  image?: ImageConfig;
  speech?: SpeechConfig;
  prompts?: PromptsConfig;
  /** Global subagent configuration defaults */
  subagents?: GlobalSubagentConfig;
  /** Global rate limiting configuration */
  "rate-limits"?: RateLimitsConfig;
  /** Global retry configuration */
  retry?: RetryConfigCLI;
  [customCommand: string]:
    | CustomCommandConfig
    | CompleteConfig
    | AgentConfig
    | ImageConfig
    | SpeechConfig
    | GlobalConfig
    | PromptsConfig
    | GlobalSubagentConfig
    | RateLimitsConfig
    | RetryConfigCLI
    | undefined;
}

/** Valid keys for global config */
export const GLOBAL_CONFIG_KEYS = new Set(["log-level"]);

/** Valid log levels */
export const VALID_LOG_LEVELS: LogLevel[] = [
  "silly",
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
];

/** Valid keys for complete command config */
export const COMPLETE_CONFIG_KEYS = new Set([
  "model",
  "system",
  "temperature",
  "max-tokens",
  "quiet",
  "inherits",
  "log-level",
  "log-llm-requests",
  "rate-limits",
  "retry",
  "reasoning",
  "type", // Allowed for inheritance compatibility, ignored for built-in commands
]);

/** Valid keys for agent command config */
export const AGENT_CONFIG_KEYS = new Set([
  "model",
  "system",
  "temperature",
  "max-iterations",
  "budget",
  "gadgets", // Full replacement (preferred)
  "gadget-add", // Add to inherited gadgets
  "gadget-remove", // Remove from inherited gadgets
  "builtins",
  "builtin-interaction",
  "gadget-start-prefix",
  "gadget-end-prefix",
  "gadget-arg-prefix",
  "gadget-approval",
  "subagents", // Per-subagent configuration overrides
  "initial-gadgets", // Pre-seeded gadget results
  "quiet",
  "inherits",
  "log-level",
  "log-llm-requests",
  "rate-limits",
  "retry",
  "reasoning",
  "type", // Allowed for inheritance compatibility, ignored for built-in commands
]);

/** Valid keys for image command config */
export const IMAGE_CONFIG_KEYS = new Set(["model", "size", "quality", "count", "output", "quiet"]);

/** Valid keys for speech command config */
export const SPEECH_CONFIG_KEYS = new Set(["model", "voice", "format", "speed", "output", "quiet"]);

/** Valid keys for custom command config (union of complete + agent + type + description) */
export const CUSTOM_CONFIG_KEYS = new Set([
  ...COMPLETE_CONFIG_KEYS,
  ...AGENT_CONFIG_KEYS,
  "type",
  "description",
]);

/** Valid keys for rate-limits configuration section. */
export const RATE_LIMITS_CONFIG_KEYS = new Set([
  "requests-per-minute",
  "tokens-per-minute",
  "tokens-per-day",
  "safety-margin",
  "enabled",
]);

/** Valid keys for retry configuration section. */
export const RETRY_CONFIG_KEYS = new Set([
  "enabled",
  "retries",
  "min-timeout",
  "max-timeout",
  "factor",
  "randomize",
  "respect-retry-after",
  "max-retry-after-ms",
]);

/** Valid keys for reasoning configuration section. */
export const REASONING_CONFIG_KEYS = new Set(["enabled", "effort", "budget-tokens"]);

/** Valid effort levels for reasoning. */
export const VALID_REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "maximum"]);
