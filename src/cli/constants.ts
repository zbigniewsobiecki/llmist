/** CLI program name */
export const CLI_NAME = "llmist";

/** CLI program description shown in --help */
export const CLI_DESCRIPTION = "Command line utilities for llmist agents and direct LLM access.";

/** Available CLI commands */
export const COMMANDS = {
  complete: "complete",
  agent: "agent",
  models: "models",
} as const;

/** Valid log level names */
export const LOG_LEVELS = ["silly", "trace", "debug", "info", "warn", "error", "fatal"] as const;
export type LogLevelName = (typeof LOG_LEVELS)[number];

/** Default model used when --model is not specified */
export const DEFAULT_MODEL = "openai:gpt-5-nano";

/** Command-line option flags */
export const OPTION_FLAGS = {
  model: "-m, --model <identifier>",
  systemPrompt: "-s, --system <prompt>",
  temperature: "-t, --temperature <value>",
  maxTokens: "--max-tokens <count>",
  maxIterations: "-i, --max-iterations <count>",
  gadgetModule: "-g, --gadget <module>",
  logLevel: "--log-level <level>",
  logFile: "--log-file <path>",
  logReset: "--log-reset",
  logLlmRequests: "--log-llm-requests [dir]",
  logLlmResponses: "--log-llm-responses [dir]",
  noBuiltins: "--no-builtins",
  noBuiltinInteraction: "--no-builtin-interaction",
  quiet: "-q, --quiet",
} as const;

/** Human-readable descriptions for command-line options */
export const OPTION_DESCRIPTIONS = {
  model: "Model identifier, e.g. openai:gpt-5-nano or anthropic:claude-sonnet-4-5.",
  systemPrompt: "Optional system prompt prepended to the conversation.",
  temperature: "Sampling temperature between 0 and 2.",
  maxTokens: "Maximum number of output tokens requested from the model.",
  maxIterations: "Maximum number of agent loop iterations before exiting.",
  gadgetModule:
    "Path or module specifier for a gadget export. Repeat to register multiple gadgets.",
  logLevel: "Log level: silly, trace, debug, info, warn, error, fatal.",
  logFile: "Path to log file. When set, logs are written to file instead of stderr.",
  logReset: "Reset (truncate) the log file at session start instead of appending.",
  logLlmRequests: "Save raw LLM requests as plain text. Optional dir, defaults to ~/.llmist/logs/requests/",
  logLlmResponses: "Save raw LLM responses as plain text. Optional dir, defaults to ~/.llmist/logs/responses/",
  noBuiltins: "Disable built-in gadgets (AskUser, TellUser).",
  noBuiltinInteraction: "Disable interactive gadgets (AskUser) while keeping TellUser.",
  quiet: "Suppress all output except content (text and TellUser messages).",
} as const;

/** Prefix for summary output written to stderr */
export const SUMMARY_PREFIX = "[llmist]";
