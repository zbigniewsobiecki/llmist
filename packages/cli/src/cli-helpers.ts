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
 * Checks if a stream is a TTY (terminal) for interactive input.
 *
 * @param stream - Stream to check
 * @returns True if stream is a TTY
 */
export function isInteractive(stream: TTYAwareStream): boolean {
  return Boolean(stream.isTTY);
}

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
