import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname } from "node:path";
import { type ILogObj, Logger } from "tslog";

const LEVEL_NAME_TO_ID: Record<string, number> = {
  silly: 0,
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
  fatal: 6,
};

function parseLogLevel(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "") {
    return undefined;
  }

  const numericLevel = Number(normalized);
  if (Number.isFinite(numericLevel)) {
    return Math.max(0, Math.min(6, Math.floor(numericLevel)));
  }

  return LEVEL_NAME_TO_ID[normalized];
}

/**
 * Logger configuration options for the library.
 */
export interface LoggerOptions {
  /**
   * Log level: 0=silly, 1=trace, 2=debug, 3=info, 4=warn, 5=error, 6=fatal
   * @default 4 (warn)
   */
  minLevel?: number;

  /**
   * Output type: 'pretty' for development, 'json' for production
   * @default 'pretty'
   */
  type?: "pretty" | "json" | "hidden";

  /**
   * Logger name (appears in logs)
   */
  name?: string;

  /**
   * When true, reset (truncate) the log file instead of appending.
   * Useful for getting clean logs per session.
   * @default false
   */
  logReset?: boolean;
}

/**
 * Parses a boolean environment variable.
 */
function parseEnvBoolean(value?: string): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return undefined;
}

/**
 * Create a new logger instance for the library.
 *
 * @param options - Logger configuration options
 * @returns Configured Logger instance
 *
 * @example
 * ```typescript
 * // Development logger with pretty output
 * const logger = createLogger({ type: 'pretty', minLevel: 2 });
 *
 * // Production logger with JSON output
 * const logger = createLogger({ type: 'json', minLevel: 3 });
 *
 * // Silent logger for tests
 * const logger = createLogger({ type: 'hidden' });
 * ```
 */
export function createLogger(options: LoggerOptions = {}): Logger<ILogObj> {
  const envMinLevel = parseLogLevel(process.env.LLMIST_LOG_LEVEL);
  const envLogFile = process.env.LLMIST_LOG_FILE?.trim() ?? "";
  const envLogReset = parseEnvBoolean(process.env.LLMIST_LOG_RESET);

  const minLevel = options.minLevel ?? envMinLevel ?? 4;
  const defaultType = options.type ?? "pretty";
  const name = options.name ?? "llmist";
  // Priority: options > env var > default (false = append)
  const logReset = options.logReset ?? envLogReset ?? false;

  let logFileStream: WriteStream | undefined;
  let finalType = defaultType;

  if (envLogFile) {
    try {
      mkdirSync(dirname(envLogFile), { recursive: true });
      // Use "w" (write/truncate) when logReset is true, "a" (append) otherwise
      const flags = logReset ? "w" : "a";
      logFileStream = createWriteStream(envLogFile, { flags });
      finalType = "hidden";
    } catch (error) {
      console.error("Failed to initialize LLMIST_LOG_FILE output:", error);
    }
  }

  const logger = new Logger<ILogObj>({
    name,
    minLevel,
    type: finalType,
    // Optimize for production
    hideLogPositionForProduction: finalType !== "pretty",
    // Pretty output settings
    prettyLogTemplate:
      finalType === "pretty"
        ? "{{yyyy}}-{{mm}}-{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}} {{logLevelName}} [{{name}}] "
        : undefined,
  });

  if (logFileStream) {
    logger.attachTransport((logObj) => {
      logFileStream?.write(`${JSON.stringify(logObj)}\n`);
    });
  }

  return logger;
}

/**
 * Default logger instance for the library.
 * Users can replace this with their own configured logger.
 */
export const defaultLogger = createLogger();
