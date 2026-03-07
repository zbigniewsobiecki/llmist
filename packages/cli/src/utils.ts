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

/** ESC key byte code */
const ESC_KEY = 0x1b;

/**
 * Timeout in milliseconds to distinguish standalone ESC key from escape sequences.
 *
 * When a user presses the ESC key alone, only byte 0x1B is sent. However, arrow keys
 * and other special keys send escape sequences that START with 0x1B followed by
 * additional bytes (e.g., `ESC[A` for up arrow, `ESC[B` for down arrow).
 *
 * These additional bytes typically arrive within 10-20ms on most terminals and SSH
 * connections. The 50ms timeout provides a safe buffer to detect escape sequences
 * while keeping the standalone ESC key responsive to user input.
 *
 * If no additional bytes arrive within this window after an initial ESC byte,
 * we treat it as a standalone ESC key press.
 */
const ESC_TIMEOUT_MS = 50;
const CTRL_C = 0x03; // ETX - End of Text (Ctrl+C in raw mode)

/**
 * Creates a keyboard listener for ESC key and Ctrl+C detection in TTY mode.
 *
 * Uses a timeout to distinguish standalone ESC from escape sequences (like arrow keys).
 * Arrow keys start with ESC byte (0x1B) followed by additional bytes, so we wait briefly
 * to see if more bytes arrive before triggering the callback.
 *
 * When stdin is in raw mode, Ctrl+C is received as byte 0x03 instead of generating
 * a SIGINT signal. This function handles Ctrl+C explicitly via the onCtrlC callback.
 *
 * @param stdin - The stdin stream (must be TTY with setRawMode support)
 * @param onEsc - Callback when ESC is pressed
 * @param onCtrlC - Optional callback when Ctrl+C is pressed in raw mode
 * @returns Cleanup function to restore normal mode, or null if not supported
 */
export function createEscKeyListener(
  stdin: NodeJS.ReadStream,
  onEsc: () => void,
  onCtrlC?: () => void,
): (() => void) | null {
  // Check both isTTY and setRawMode availability (mock streams may have isTTY but no setRawMode)
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return null;
  }

  let escTimeout: NodeJS.Timeout | null = null;

  const handleData = (data: Buffer) => {
    // Handle Ctrl+C in raw mode (since SIGINT won't be generated)
    if (data[0] === CTRL_C && onCtrlC) {
      // Clear any pending ESC timeout before handling Ctrl+C
      if (escTimeout) {
        clearTimeout(escTimeout);
        escTimeout = null;
      }
      onCtrlC();
      return;
    }

    if (data[0] === ESC_KEY) {
      if (data.length === 1) {
        // Could be standalone ESC or start of sequence - use timeout
        escTimeout = setTimeout(() => {
          onEsc();
        }, ESC_TIMEOUT_MS);
      } else {
        // Part of escape sequence (arrow key, etc.) - clear any pending timeout
        if (escTimeout) {
          clearTimeout(escTimeout);
          escTimeout = null;
        }
      }
    } else {
      // Other key - clear any pending ESC timeout
      if (escTimeout) {
        clearTimeout(escTimeout);
        escTimeout = null;
      }
    }
  };

  // Enable raw mode to get individual keystrokes
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on("data", handleData);

  // Return cleanup function
  return () => {
    if (escTimeout) {
      clearTimeout(escTimeout);
    }
    stdin.removeListener("data", handleData);
    stdin.setRawMode(false);
    stdin.pause();
  };
}

/**
 * Timeout window for detecting double Ctrl+C press (in milliseconds).
 *
 * When no operation is active, pressing Ctrl+C once shows a hint message.
 * If a second Ctrl+C is pressed within this window, the CLI exits gracefully.
 * This pattern is familiar from many CLI tools (npm, vim, etc.).
 */
const SIGINT_DOUBLE_PRESS_MS = 1000;

/**
 * Creates a SIGINT (Ctrl+C) listener with double-press detection.
 *
 * Behavior:
 * - If an operation is active: cancels the operation via `onCancel`
 * - If no operation active and first press: shows hint message
 * - If no operation active and second press within 1 second: calls `onQuit`
 *
 * @param onCancel - Callback when Ctrl+C pressed during an active operation
 * @param onQuit - Callback when double Ctrl+C pressed (quit CLI)
 * @param isOperationActive - Function that returns true if an operation is in progress
 * @param stderr - Stream to write hint messages to (defaults to process.stderr)
 * @returns Cleanup function to remove the listener
 *
 * @example
 * ```typescript
 * const cleanup = createSigintListener(
 *   () => abortController.abort(),
 *   () => process.exit(0),
 *   () => isStreaming,
 * );
 *
 * // When done:
 * cleanup();
 * ```
 */
export function createSigintListener(
  onCancel: () => void,
  onQuit: () => void,
  isOperationActive: () => boolean,
  stderr: NodeJS.WritableStream = process.stderr,
): () => void {
  let lastSigintTime = 0;

  const handler = () => {
    const now = Date.now();

    if (isOperationActive()) {
      // Cancel the current operation
      onCancel();
      // Set timer to now so that a second Ctrl+C within 1 second will trigger quit
      lastSigintTime = now;
      return;
    }

    // Check for double-press
    if (now - lastSigintTime < SIGINT_DOUBLE_PRESS_MS) {
      onQuit();
      return;
    }

    // First press when no operation is active
    lastSigintTime = now;
    stderr.write(chalk.dim("\n[Press Ctrl+C again to quit]\n"));
  };

  process.on("SIGINT", handler);

  return () => {
    process.removeListener("SIGINT", handler);
  };
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
