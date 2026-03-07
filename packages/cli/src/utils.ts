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

// Re-export resolvePrompt from prompt-resolver for backward compatibility
export { resolvePrompt } from "./prompt-resolver.js";

// Re-export StreamProgress and ProgressMode from dedicated module
export { type ProgressMode, StreamProgress } from "./stream-progress.js";
