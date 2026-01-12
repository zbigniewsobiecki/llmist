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

// Singleton state for file logging - ensures all loggers share one WriteStream
let sharedLogFilePath: string | undefined;
let sharedLogFileStream: WriteStream | undefined;
let logFileInitialized = false;
let writeErrorCount = 0;
let writeErrorReported = false;
const MAX_WRITE_ERRORS_BEFORE_DISABLE = 5;

// Standard log line template for both console and file output
const LOG_TEMPLATE =
  "{{yyyy}}-{{mm}}-{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}\t{{logLevelName}}\t[{{name}}]\t";

/**
 * Strips ANSI color codes from a string.
 */
export function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes use control characters
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Resets the shared file logging state. Used for testing.
 * @internal
 */
export function _resetFileLoggingState(): void {
  if (sharedLogFileStream) {
    sharedLogFileStream.end();
    sharedLogFileStream = undefined;
  }
  sharedLogFilePath = undefined;
  logFileInitialized = false;
  writeErrorCount = 0;
  writeErrorReported = false;
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

  // Initialize log file and WriteStream (only once per path)
  if (envLogFile && (!logFileInitialized || sharedLogFilePath !== envLogFile)) {
    try {
      // Close previous stream if path changed
      if (sharedLogFileStream) {
        sharedLogFileStream.end();
        sharedLogFileStream = undefined;
      }

      mkdirSync(dirname(envLogFile), { recursive: true });

      // Use "w" (write/truncate) when logReset is true, "a" (append) otherwise
      const flags = logReset ? "w" : "a";
      sharedLogFileStream = createWriteStream(envLogFile, { flags });
      sharedLogFilePath = envLogFile;
      logFileInitialized = true;
      writeErrorCount = 0;
      writeErrorReported = false;

      // Handle stream errors
      sharedLogFileStream.on("error", (error) => {
        writeErrorCount++;
        if (!writeErrorReported) {
          console.error(`[llmist] Log file write error: ${error.message}`);
          writeErrorReported = true;
        }
        if (writeErrorCount >= MAX_WRITE_ERRORS_BEFORE_DISABLE) {
          console.error(
            `[llmist] Too many log file errors (${writeErrorCount}), disabling file logging`,
          );
          sharedLogFileStream?.end();
          sharedLogFileStream = undefined;
        }
      });
    } catch (error) {
      console.error("Failed to initialize LLMIST_LOG_FILE output:", error);
    }
  }

  // When file logging is enabled, use "pretty" type with overwrite to redirect to file
  // This lets tslog handle all formatting via prettyLogTemplate
  const useFileLogging = Boolean(sharedLogFileStream);

  const logger = new Logger<ILogObj>({
    name,
    minLevel,
    type: useFileLogging ? "pretty" : defaultType,
    // Hide log position for file logging and non-pretty types
    hideLogPositionForProduction: useFileLogging || defaultType !== "pretty",
    prettyLogTemplate: LOG_TEMPLATE,
    // Use overwrite to redirect tslog's formatted output to file instead of console
    overwrite: useFileLogging
      ? {
          transportFormatted: (logMetaMarkup: string, logArgs: unknown[], _logErrors: string[]) => {
            // Skip if stream was disabled due to errors
            if (!sharedLogFileStream) return;

            // tslog provides formatted meta (timestamp, level, name) and args separately
            // Strip ANSI colors for clean file output
            const meta = stripAnsi(logMetaMarkup);
            const args = logArgs.map((arg) =>
              typeof arg === "string" ? stripAnsi(arg) : JSON.stringify(arg),
            );
            const line = `${meta}${args.join(" ")}\n`;

            // Use async stream.write() - non-blocking and buffered
            sharedLogFileStream.write(line);
          },
        }
      : undefined,
  });

  return logger;
}

/**
 * Default logger instance for the library.
 * Users can replace this with their own configured logger.
 */
export const defaultLogger = createLogger();
