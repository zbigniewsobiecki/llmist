import { isInteractive } from "./cli-helpers.js";
import type { CLIEnvironment } from "./environment.js";

// Re-export CLI helpers for backward compatibility
export {
  createNumericParser,
  executeAction,
  isInteractive,
  type NumericParserOptions,
} from "./cli-helpers.js";

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
