/**
 * Research constants.
 *
 * Every tunable lives here (repo rule: no magic numbers). Timeouts are
 * deliberately generous — research runs take minutes to an hour.
 */

/**
 * Default client-side time budget for a research run.
 * 1 hour — OpenAI's documented SDK timeout recommendation for synchronous
 * deep-research calls, and the Gemini Interactions hard cap.
 */
export const RESEARCH_DEFAULT_TIMEOUT_MS = 3_600_000;

/**
 * Gemini Interactions API hard cap on research duration (60 minutes).
 * Runs exceeding it are terminated server-side.
 */
export const GEMINI_RESEARCH_MAX_DURATION_MS = 3_600_000;

/**
 * Per-request HTTP timeout for OpenAI Responses research calls
 * (overrides SDK defaults; background polling uses short requests but
 * synchronous streams can run for the full duration).
 */
export const OPENAI_RESEARCH_HTTP_TIMEOUT_MS = 3_600_000;

/**
 * Per-request HTTP timeout for OpenRouter research calls. The env-created
 * OpenRouter client defaults to 120s, which multi-minute research runs exceed.
 */
export const OPENROUTER_RESEARCH_HTTP_TIMEOUT_MS = 3_600_000;

/** Initial polling interval for background jobs without streaming. */
export const RESEARCH_POLL_INTERVAL_MS = 10_000;

/** Ceiling for the backed-off polling interval. */
export const RESEARCH_POLL_MAX_INTERVAL_MS = 60_000;

/** Multiplier applied to the polling interval after each poll. */
export const RESEARCH_POLL_BACKOFF_FACTOR = 1.5;

/**
 * Maximum consecutive stream-reconnect attempts (cursor-based resume) before
 * giving up. The counter resets whenever an event is successfully received.
 */
export const RESEARCH_STREAM_RECONNECT_MAX_ATTEMPTS = 5;

/**
 * How many days before a model's `shutdownDate` a warning is logged when
 * starting a run on it.
 */
export const RESEARCH_SHUTDOWN_WARNING_WINDOW_DAYS = 30;

/** Decimal places for cost estimates (avoids float noise in reported USD). */
export const RESEARCH_COST_DECIMALS = 6;

/** Tokens per million — denominator for per-1M-token pricing. */
export const TOKENS_PER_MILLION = 1_000_000;

/** Searches per thousand — denominator for per-1k-search pricing. */
export const SEARCHES_PER_THOUSAND = 1_000;

/** Milliseconds per day (shutdown-window arithmetic). */
export const MS_PER_DAY = 86_400_000;
