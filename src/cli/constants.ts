/** CLI program name */
export const CLI_NAME = "llmist";

/** CLI program description shown in --help */
export const CLI_DESCRIPTION = "Command line utilities for llmist agents and direct LLM access.";

/** Available CLI commands */
export const COMMANDS = {
  complete: "complete",
  agent: "agent",
  models: "models",
  gadget: "gadget",
  image: "image",
  speech: "speech",
  vision: "vision",
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
  noBuiltins: "--no-builtins",
  noBuiltinInteraction: "--no-builtin-interaction",
  quiet: "-q, --quiet",
  docker: "--docker",
  dockerRo: "--docker-ro",
  noDocker: "--no-docker",
  dockerDev: "--docker-dev",
  // Multimodal input options
  inputImage: "--image <path>",
  inputAudio: "--audio <path>",
  // Image generation options
  imageSize: "--size <size>",
  imageQuality: "--quality <quality>",
  imageCount: "-n, --count <number>",
  imageOutput: "-o, --output <path>",
  // Speech generation options
  voice: "--voice <name>",
  speechFormat: "--format <format>",
  speechSpeed: "--speed <value>",
  speechOutput: "-o, --output <path>",
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
  logLlmRequests: "Save LLM requests/responses to session directories. Optional dir, defaults to ~/.llmist/logs/requests/",
  noBuiltins: "Disable built-in gadgets (AskUser, TellUser).",
  noBuiltinInteraction: "Disable interactive gadgets (AskUser) while keeping TellUser.",
  quiet: "Suppress all output except content (text and TellUser messages).",
  // Multimodal input descriptions
  inputImage: "Image file to include with the prompt (vision models).",
  inputAudio: "Audio file to include with the prompt (Gemini only).",
  docker: "Run agent in a Docker sandbox container for security isolation.",
  dockerRo: "Run in Docker with current directory mounted read-only.",
  noDocker: "Disable Docker sandboxing (override config).",
  dockerDev: "Run in Docker dev mode (mount local source instead of npm install).",
  // Image generation descriptions
  imageSize: "Image size/aspect ratio, e.g. '1024x1024', '1:1', '16:9'.",
  imageQuality: "Image quality: 'standard', 'hd', 'low', 'medium', 'high'.",
  imageCount: "Number of images to generate (model dependent, usually 1-4).",
  imageOutput: "Output path for the generated image. Defaults to stdout if not specified.",
  // Speech generation descriptions
  voice: "Voice name for speech generation, e.g. 'nova', 'alloy', 'Zephyr'.",
  speechFormat: "Audio format: 'mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'.",
  speechSpeed: "Speech speed multiplier (0.25 to 4.0, default 1.0).",
  speechOutput: "Output path for audio file. Defaults to stdout if not specified.",
} as const;

/** Prefix for summary output written to stderr */
export const SUMMARY_PREFIX = "[llmist]";
