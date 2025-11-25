import chalk from "chalk";
import { InvalidArgumentError } from "commander";

import type { TokenUsage } from "../core/options.js";
import { FALLBACK_CHARS_PER_TOKEN } from "../providers/constants.js";
import type { CLIEnvironment, TTYStream } from "./environment.js";

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
export function isInteractive(stream: TTYStream): boolean {
  return Boolean(stream.isTTY);
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_DELAY_MS = 500; // Don't show spinner for fast responses

type ProgressMode = "streaming" | "cumulative";

/**
 * Progress indicator shown while waiting for LLM response.
 * Two modes:
 * - streaming: Shows current LLM call stats (out/in tokens, call time)
 * - cumulative: Shows total stats across all calls (total tokens, iterations, total time)
 * Only displays on TTY (interactive terminal), silent when piped.
 */
export class StreamProgress {
  // Animation state
  private frameIndex = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private delayTimeout: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private hasRendered = false;

  // Current call stats (streaming mode)
  private mode: ProgressMode = "cumulative";
  private model = "";
  private callStartTime = Date.now();
  private callInputTokens = 0;
  private callInputTokensEstimated = true;
  private callOutputTokens = 0;
  private callOutputTokensEstimated = true;
  private callOutputChars = 0;
  private isStreaming = false;

  // Cumulative stats (cumulative mode)
  private totalStartTime = Date.now();
  private totalTokens = 0;
  private iterations = 0;

  constructor(
    private readonly target: NodeJS.WritableStream,
    private readonly isTTY: boolean,
  ) {}

  /**
   * Starts a new LLM call. Switches to streaming mode.
   * @param model - Model name being used
   * @param estimatedInputTokens - Estimated input tokens based on prompt length
   */
  startCall(model: string, estimatedInputTokens?: number): void {
    this.mode = "streaming";
    this.model = model;
    this.callStartTime = Date.now();
    this.callInputTokens = estimatedInputTokens ?? 0;
    this.callInputTokensEstimated = true;
    this.callOutputTokens = 0;
    this.callOutputTokensEstimated = true;
    this.callOutputChars = 0;
    this.isStreaming = false;
    this.start();
  }

  /**
   * Ends the current LLM call. Updates cumulative stats and switches to cumulative mode.
   * @param usage - Final token usage from the call
   */
  endCall(usage?: { inputTokens: number; outputTokens: number; totalTokens: number }): void {
    this.iterations++;
    if (usage) {
      this.totalTokens += usage.totalTokens;
    }
    this.pause();
    this.mode = "cumulative";
  }

  /**
   * Sets the input token count for current call (from stream metadata).
   * @param tokens - Token count
   * @param estimated - If true, shown with ~ prefix until actual count arrives
   */
  setInputTokens(tokens: number, estimated = false): void {
    // Don't overwrite actual count with a new estimate
    if (estimated && !this.callInputTokensEstimated) {
      return;
    }
    this.callInputTokens = tokens;
    this.callInputTokensEstimated = estimated;
  }

  /**
   * Sets the output token count for current call (from stream metadata).
   * @param tokens - Token count
   * @param estimated - If true, shown with ~ prefix until actual count arrives
   */
  setOutputTokens(tokens: number, estimated = false): void {
    // Don't overwrite actual count with a new estimate
    if (estimated && !this.callOutputTokensEstimated) {
      return;
    }
    this.callOutputTokens = tokens;
    this.callOutputTokensEstimated = estimated;
  }

  /**
   * Starts the progress indicator animation after a brief delay.
   */
  start(): void {
    if (!this.isTTY || this.isRunning) return;
    this.isRunning = true;

    // Delay showing spinner to avoid flicker for fast responses
    this.delayTimeout = setTimeout(() => {
      if (this.isRunning) {
        this.interval = setInterval(() => this.render(), 80);
        this.render();
      }
    }, SPINNER_DELAY_MS);
  }

  /**
   * Updates output character count for current call and marks streaming as active.
   * @param totalChars - Total accumulated character count
   */
  update(totalChars: number): void {
    this.callOutputChars = totalChars;
    this.isStreaming = true;
  }

  private render(): void {
    const spinner = SPINNER_FRAMES[this.frameIndex++ % SPINNER_FRAMES.length];

    if (this.mode === "streaming") {
      this.renderStreamingMode(spinner);
    } else {
      this.renderCumulativeMode(spinner);
    }
    this.hasRendered = true;
  }

  private renderStreamingMode(spinner: string): void {
    const elapsed = ((Date.now() - this.callStartTime) / 1000).toFixed(1);

    // Output tokens: use actual if available, otherwise estimate from chars
    const outTokens = this.callOutputTokensEstimated
      ? Math.round(this.callOutputChars / FALLBACK_CHARS_PER_TOKEN)
      : this.callOutputTokens;

    // Build status parts: model, out (sent), in (received), time
    const parts: string[] = [];
    if (this.model) {
      parts.push(chalk.cyan(this.model));
    }
    if (this.callInputTokens > 0) {
      const prefix = this.callInputTokensEstimated ? "~" : "";
      parts.push(chalk.dim("out:") + chalk.yellow(` ${prefix}${this.callInputTokens}`));
    }
    if (this.isStreaming || outTokens > 0) {
      const prefix = this.callOutputTokensEstimated ? "~" : "";
      parts.push(chalk.dim("in:") + chalk.green(` ${prefix}${outTokens}`));
    }
    parts.push(chalk.dim(`${elapsed}s`));

    this.target.write(`\r${chalk.cyan(spinner)} ${parts.join(chalk.dim(" | "))}`);
  }

  private renderCumulativeMode(spinner: string): void {
    const elapsed = ((Date.now() - this.totalStartTime) / 1000).toFixed(1);

    // Build status parts: model, total tokens, iterations, total time
    const parts: string[] = [];
    if (this.model) {
      parts.push(chalk.cyan(this.model));
    }
    if (this.totalTokens > 0) {
      parts.push(chalk.dim("total:") + chalk.magenta(` ${this.totalTokens}`));
    }
    if (this.iterations > 0) {
      parts.push(chalk.dim("iter:") + chalk.blue(` ${this.iterations}`));
    }
    parts.push(chalk.dim(`${elapsed}s`));

    this.target.write(`\r${chalk.cyan(spinner)} ${parts.join(chalk.dim(" | "))}`);
  }

  /**
   * Pauses the progress indicator and clears the line.
   * Can be resumed with start().
   */
  pause(): void {
    if (!this.isTTY || !this.isRunning) return;

    if (this.delayTimeout) {
      clearTimeout(this.delayTimeout);
      this.delayTimeout = null;
    }
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;

    // Only clear the line if we actually rendered something
    if (this.hasRendered) {
      this.target.write("\r\x1b[K");
      this.hasRendered = false;
    }
  }

  /**
   * Completes the progress indicator and clears the line.
   */
  complete(): void {
    this.pause();
  }

  /**
   * Returns a formatted prompt string with stats (like bash PS1).
   * Shows current call stats during streaming, cumulative stats otherwise.
   * Format: "out: 1.2k │ in: ~300 │ 5s > " or "3.6k │ i2 │ 34s > "
   */
  formatPrompt(): string {
    const parts: string[] = [];

    if (this.mode === "streaming") {
      // During a call: show current call stats
      const elapsed = Math.round((Date.now() - this.callStartTime) / 1000);

      // Output tokens: use actual if available, otherwise estimate from chars
      const outTokens = this.callOutputTokensEstimated
        ? Math.round(this.callOutputChars / FALLBACK_CHARS_PER_TOKEN)
        : this.callOutputTokens;
      const outEstimated = this.callOutputTokensEstimated;

      if (this.callInputTokens > 0) {
        const prefix = this.callInputTokensEstimated ? "~" : "";
        parts.push(
          chalk.dim("out:") + chalk.yellow(` ${prefix}${this.formatTokens(this.callInputTokens)}`),
        );
      }
      if (outTokens > 0) {
        const prefix = outEstimated ? "~" : "";
        parts.push(chalk.dim("in:") + chalk.green(` ${prefix}${this.formatTokens(outTokens)}`));
      }
      parts.push(chalk.dim(`${elapsed}s`));
    } else {
      // Between calls: show cumulative stats
      const elapsed = Math.round((Date.now() - this.totalStartTime) / 1000);

      if (this.totalTokens > 0) {
        parts.push(chalk.magenta(this.formatTokens(this.totalTokens)));
      }
      if (this.iterations > 0) {
        parts.push(chalk.blue(`i${this.iterations}`));
      }
      parts.push(chalk.dim(`${elapsed}s`));
    }

    return `${parts.join(chalk.dim(" │ "))} ${chalk.green(">")} `;
  }

  /**
   * Formats token count compactly (3625 -> "3.6k").
   */
  private formatTokens(tokens: number): string {
    return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`;
  }
}

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

/**
 * Metadata for generating execution summaries.
 */
export interface SummaryMetadata {
  finishReason?: string | null;
  usage?: TokenUsage;
  iterations?: number;
}

/**
 * Renders execution metadata as a formatted summary string with colors.
 * Includes iterations, finish reason, and token usage.
 *
 * @param metadata - Summary metadata to format
 * @returns Formatted summary string or null if no metadata
 */
export function renderSummary(metadata: SummaryMetadata): string | null {
  const parts: string[] = [];

  if (metadata.iterations !== undefined) {
    parts.push(chalk.dim(`iterations: ${metadata.iterations}`));
  }

  if (metadata.finishReason) {
    parts.push(chalk.dim(`finish: ${metadata.finishReason}`));
  }

  if (metadata.usage) {
    const { inputTokens, outputTokens, totalTokens } = metadata.usage;
    parts.push(
      chalk.dim(`tokens: `) +
        chalk.cyan(`${totalTokens}`) +
        chalk.dim(` (in: ${inputTokens}, out: ${outputTokens})`),
    );
  }

  if (parts.length === 0) {
    return null;
  }

  return `${chalk.dim("─".repeat(40))}\n${parts.join(chalk.dim(" │ "))}`;
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
    const message = error instanceof Error ? error.message : String(error);
    env.stderr.write(`${chalk.red.bold("Error:")} ${message}\n`);
    env.setExitCode(1);
  }
}
