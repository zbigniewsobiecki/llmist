// Gadget marker constants
export const GADGET_START_PREFIX = "!!!GADGET_START:";
export const GADGET_END_PREFIX = "!!!GADGET_END";
export const GADGET_ARG_PREFIX = "!!!ARG:";

// Default configuration values
export const DEFAULT_MAX_TOKENS = 1024;
export const DEFAULT_MAX_ITERATIONS = 10;

// Gadget output limiting defaults
/** Default: gadget output limiting is enabled */
export const DEFAULT_GADGET_OUTPUT_LIMIT = true;

/** Default: limit gadget output to 15% of context window */
export const DEFAULT_GADGET_OUTPUT_LIMIT_PERCENT = 15;

/** Approximate characters per token for limit calculation */
export const CHARS_PER_TOKEN = 4;

/** Fallback context window size if model is not in registry */
export const FALLBACK_CONTEXT_WINDOW = 128_000;
