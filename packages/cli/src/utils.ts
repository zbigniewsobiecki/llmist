import chalk from "chalk";
import { InvalidArgumentError } from "commander";
import { formatLLMError } from "llmist";
import type { CLIEnvironment, TTYAwareStream } from "./environment.js";

/**
 * Options for creating a numeric value parser.
 */
export interface NumericParserOptions {
  label: string;
  integer?: boolean;
  min?: number;
  max?: number;
}

/**
 * Creates a parser function for numeric command-line options with validation.
 * Validates that values are numbers, optionally integers, and within min/max bounds.
 *
 * @param options - Parser configuration (label, integer, min, max)
 * @returns Parser function that validates and returns the numeric value
 * @throws InvalidArgumentError if validation fails
 */
export function createNumericParser({
  label,
  integer = false,
  min,
  max,
}: NumericParserOptions): (value: string) => number {
  return (value: string) => {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      throw new InvalidArgumentError(`${label} must be a number.`);
    }

    if (integer && !Number.isInteger(parsed)) {
      throw new InvalidArgumentError(`${label} must be an integer.`);
    }

    if (min !== undefined && parsed < min) {
      throw new InvalidArgumentError(`${label} must be greater than or equal to ${min}.`);
    }

    if (max !== undefined && parsed > max) {
      throw new InvalidArgumentError(`${label} must be less than or equal to ${max}.`);
    }

    return parsed;
  };
}

/**
 * Helper class for writing text to a stream while tracking newline state.
 * Ensures output ends with a newline for proper terminal formatting.
 */
export class StreamPrinter {
  private endedWithNewline = true;

  constructor(private readonly target: NodeJS.WritableStream) {}

  /**
   * Writes text to the target stream and tracks newline state.
   *
   * @param text - Text to write
   */
  write(text: string): void {
    if (!text) {
      return;
    }
    this.target.write(text);
    this.endedWithNewline = text.endsWith("\n");
  }

  /**
   * Ensures output ends with a newline by writing one if needed.
   */
  ensureNewline(): void {
    if (!this.endedWithNewline) {
      this.target.write("\n");
      this.endedWithNewline = true;
    }
  }
}

/**
 * Checks if a stream is a TTY (terminal) for interactive input.
 *
 * @param stream - Stream to check
 * @returns True if stream is a TTY
 */
export function isInteractive(stream: TTYAwareStream): boolean {
  return Boolean(stream.isTTY);
}

// Re-export StreamProgress and ProgressMode from dedicated module
export { type ProgressMode, StreamProgress } from "./stream-progress.js";

/**
 * Reads all data from a readable stream into a string.
 *
 * @param stream - Stream to read from
 * @returns Complete stream contents as string
 */
async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    if (typeof chunk === "string") {
      chunks.push(chunk);
    } else {
      chunks.push(chunk.toString("utf8"));
    }
  }
  return chunks.join("");
}

/**
 * Normalizes a prompt by trimming whitespace.
 *
 * @param value - Prompt to normalize
 * @returns Trimmed prompt
 */
function normalizePrompt(value: string): string {
  return value.trim();
}

/**
 * Resolves the user prompt from either command-line argument or stdin.
 * Priority: 1) promptArg if provided, 2) stdin if piped, 3) error if neither.
 *
 * @param promptArg - Optional prompt from command-line argument
 * @param env - CLI environment for accessing stdin
 * @returns Resolved and normalized prompt
 * @throws Error if no prompt available or stdin is empty
 */
export async function resolvePrompt(
  promptArg: string | undefined,
  env: CLIEnvironment,
): Promise<string> {
  if (promptArg?.trim()) {
    return normalizePrompt(promptArg);
  }

  if (isInteractive(env.stdin)) {
    throw new Error("Prompt is required. Provide an argument or pipe content via stdin.");
  }

  const pipedInput = normalizePrompt(await readStream(env.stdin));
  if (!pipedInput) {
    throw new Error("Received empty stdin payload. Provide a prompt to continue.");
  }

  return pipedInput;
}

// Re-export summary rendering from formatters module
// This maintains backward compatibility while organizing code better
export { renderSummary, type SummaryMetadata } from "./ui/formatters.js";

/**
 * Executes a CLI action with error handling.
 * Catches errors, writes to stderr, and sets exit code 1 on failure.
 *
 * @param action - Async action to execute
 * @param env - CLI environment for error output and exit code
 */
export async function executeAction(
  action: () => Promise<void>,
  env: CLIEnvironment,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    // Format error message - formatLLMError handles LLM API errors gracefully
    // and falls through to original message for other error types
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = error instanceof Error ? formatLLMError(error) : rawMessage;
    env.stderr.write(`${chalk.red.bold("Error:")} ${message}\n`);
    env.setExitCode(1);
  }
}
