import chalk from "chalk";
import { InvalidArgumentError } from "commander";

import type { ModelRegistry } from "../core/model-registry.js";
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

/**
 * Creates a keyboard listener for ESC key detection in TTY mode.
 *
 * Uses a timeout to distinguish standalone ESC from escape sequences (like arrow keys).
 * Arrow keys start with ESC byte (0x1B) followed by additional bytes, so we wait briefly
 * to see if more bytes arrive before triggering the callback.
 *
 * @param stdin - The stdin stream (must be TTY with setRawMode support)
 * @param onEsc - Callback when ESC is pressed
 * @returns Cleanup function to restore normal mode, or null if not supported
 */
export function createEscKeyListener(
  stdin: NodeJS.ReadStream,
  onEsc: () => void,
): (() => void) | null {
  // Check both isTTY and setRawMode availability (mock streams may have isTTY but no setRawMode)
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return null;
  }

  let escTimeout: NodeJS.Timeout | null = null;

  const handleData = (data: Buffer) => {
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
      lastSigintTime = 0; // Reset double-press timer
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

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_DELAY_MS = 500; // Don't show spinner for fast responses

type ProgressMode = "streaming" | "cumulative";

// Import formatters from centralized formatting module
// This showcases llmist's clean code organization
import { formatTokens, formatCost } from "./ui/formatters.js";

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
  // Cache token tracking for live cost estimation during streaming
  private callCachedInputTokens = 0;
  private callCacheCreationInputTokens = 0;

  // Cumulative stats (cumulative mode)
  private totalStartTime = Date.now();
  private totalTokens = 0;
  private totalCost = 0;
  private iterations = 0;
  private currentIteration = 0;

  constructor(
    private readonly target: NodeJS.WritableStream,
    private readonly isTTY: boolean,
    private readonly modelRegistry?: ModelRegistry,
  ) {}

  /**
   * Starts a new LLM call. Switches to streaming mode.
   * @param model - Model name being used
   * @param estimatedInputTokens - Initial input token count. Should come from
   *   client.countTokens() for accuracy (provider-specific counting), not
   *   character-based estimation. Will be updated with provider-returned counts
   *   via setInputTokens() during streaming if available.
   */
  startCall(model: string, estimatedInputTokens?: number): void {
    this.mode = "streaming";
    this.model = model;
    this.callStartTime = Date.now();
    this.currentIteration++;
    this.callInputTokens = estimatedInputTokens ?? 0;
    this.callInputTokensEstimated = true;
    this.callOutputTokens = 0;
    this.callOutputTokensEstimated = true;
    this.callOutputChars = 0;
    this.isStreaming = false;
    // Reset cache tracking for new call
    this.callCachedInputTokens = 0;
    this.callCacheCreationInputTokens = 0;
    this.start();
  }

  /**
   * Ends the current LLM call. Updates cumulative stats and switches to cumulative mode.
   * @param usage - Final token usage from the call (including cached tokens if available)
   */
  endCall(usage?: TokenUsage): void {
    this.iterations++;
    if (usage) {
      this.totalTokens += usage.totalTokens;

      // Calculate and accumulate cost if model registry is available
      if (this.modelRegistry && this.model) {
        try {
          // Strip provider prefix if present (e.g., "openai:gpt-5-nano" -> "gpt-5-nano")
          const modelName = this.model.includes(":")
            ? this.model.split(":")[1]
            : this.model;

          const cost = this.modelRegistry.estimateCost(
            modelName,
            usage.inputTokens,
            usage.outputTokens,
            usage.cachedInputTokens ?? 0,
            usage.cacheCreationInputTokens ?? 0,
          );
          if (cost) {
            this.totalCost += cost.totalCost;
          }
        } catch {
          // Ignore errors (e.g., unknown model) - just don't add to cost
        }
      }
    }
    this.pause();
    this.mode = "cumulative";
  }

  /**
   * Sets the input token count for current call (from stream metadata).
   * @param tokens - Token count from provider or client.countTokens()
   * @param estimated - If true, this is a fallback estimate (character-based).
   *   If false, this is an accurate count from the provider API or client.countTokens().
   *   Display shows ~ prefix only when estimated=true.
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
   * @param tokens - Token count from provider streaming response
   * @param estimated - If true, this is a fallback estimate (character-based).
   *   If false, this is an accurate count from the provider's streaming metadata.
   *   Display shows ~ prefix only when estimated=true.
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
   * Sets cached token counts for the current call (from stream metadata).
   * Used for live cost estimation during streaming.
   * @param cachedInputTokens - Number of tokens read from cache (cheaper)
   * @param cacheCreationInputTokens - Number of tokens written to cache (more expensive)
   */
  setCachedTokens(cachedInputTokens: number, cacheCreationInputTokens: number): void {
    this.callCachedInputTokens = cachedInputTokens;
    this.callCacheCreationInputTokens = cacheCreationInputTokens;
  }

  /**
   * Get total elapsed time in seconds since the first call started.
   * @returns Elapsed time in seconds with 1 decimal place
   */
  getTotalElapsedSeconds(): number {
    if (this.totalStartTime === 0) return 0;
    return Number(((Date.now() - this.totalStartTime) / 1000).toFixed(1));
  }

  /**
   * Get elapsed time in seconds for the current call.
   * @returns Elapsed time in seconds with 1 decimal place
   */
  getCallElapsedSeconds(): number {
    return Number(((Date.now() - this.callStartTime) / 1000).toFixed(1));
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

    // Build status parts: #N model | ↑ in │ ↓ out │ time | cost
    const parts: string[] = [];

    // #N model (iteration number + model name)
    const iterPart = chalk.cyan(`#${this.currentIteration}`);
    if (this.model) {
      parts.push(`${iterPart} ${chalk.magenta(this.model)}`);
    } else {
      parts.push(iterPart);
    }

    // Context usage percentage (color-coded by usage level)
    const usagePercent = this.getContextUsagePercent();
    if (usagePercent !== null) {
      const formatted = `${Math.round(usagePercent)}%`;
      if (usagePercent >= 80) {
        parts.push(chalk.red(formatted)); // Danger zone - compaction threshold
      } else if (usagePercent >= 50) {
        parts.push(chalk.yellow(formatted)); // Warning zone
      } else {
        parts.push(chalk.green(formatted)); // Safe zone
      }
    }

    // ↑ input tokens
    if (this.callInputTokens > 0) {
      const prefix = this.callInputTokensEstimated ? "~" : "";
      parts.push(chalk.dim("↑") + chalk.yellow(` ${prefix}${formatTokens(this.callInputTokens)}`));
    }

    // ↓ output tokens
    if (this.isStreaming || outTokens > 0) {
      const prefix = this.callOutputTokensEstimated ? "~" : "";
      parts.push(chalk.dim("↓") + chalk.green(` ${prefix}${formatTokens(outTokens)}`));
    }

    // Time
    parts.push(chalk.dim(`${elapsed}s`));

    // Live cost estimate for current call (updates as tokens stream in)
    const callCost = this.calculateCurrentCallCost(outTokens);
    if (callCost > 0) {
      parts.push(chalk.cyan(`$${formatCost(callCost)}`));
    }

    this.target.write(`\r${parts.join(chalk.dim(" | "))} ${chalk.cyan(spinner)}`);
  }

  /**
   * Calculates live cost estimate for the current streaming call.
   * Uses current input/output tokens and cached token counts.
   */
  private calculateCurrentCallCost(outputTokens: number): number {
    if (!this.modelRegistry || !this.model) return 0;

    try {
      // Strip provider prefix if present (e.g., "anthropic:claude-sonnet-4-5" -> "claude-sonnet-4-5")
      const modelName = this.model.includes(":") ? this.model.split(":")[1] : this.model;

      const cost = this.modelRegistry.estimateCost(
        modelName,
        this.callInputTokens,
        outputTokens,
        this.callCachedInputTokens,
        this.callCacheCreationInputTokens,
      );

      return cost?.totalCost ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Calculates context window usage percentage.
   * Returns null if model is unknown or context window unavailable.
   */
  private getContextUsagePercent(): number | null {
    if (!this.modelRegistry || !this.model || this.callInputTokens === 0) {
      return null;
    }

    // Strip provider prefix if present (e.g., "anthropic:claude-sonnet-4-5" -> "claude-sonnet-4-5")
    const modelName = this.model.includes(":") ? this.model.split(":")[1] : this.model;

    const limits = this.modelRegistry.getModelLimits(modelName);
    if (!limits?.contextWindow) {
      return null;
    }

    return (this.callInputTokens / limits.contextWindow) * 100;
  }

  private renderCumulativeMode(spinner: string): void {
    const elapsed = ((Date.now() - this.totalStartTime) / 1000).toFixed(1);

    // Build status parts: model, total tokens, iterations, cost, total time
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
    if (this.totalCost > 0) {
      parts.push(chalk.dim("cost:") + chalk.cyan(` $${formatCost(this.totalCost)}`));
    }
    parts.push(chalk.dim(`${elapsed}s`));

    this.target.write(`\r${parts.join(chalk.dim(" | "))} ${chalk.cyan(spinner)}`);
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
      // Clear spinner line and ensure cursor is at column 0
      // \r = carriage return (go to column 0)
      // \x1b[K = clear from cursor to end of line
      // \x1b[0G = move cursor to column 0 (ensures we're at start even after clear)
      this.target.write("\r\x1b[K\x1b[0G");
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
   * Returns the total accumulated cost across all calls.
   */
  getTotalCost(): number {
    return this.totalCost;
  }

  /**
   * Returns a formatted stats string for cancellation messages.
   * Format: "↑ 1.2k | ↓ 300 | 5.0s"
   */
  formatStats(): string {
    const parts: string[] = [];
    const elapsed = ((Date.now() - this.callStartTime) / 1000).toFixed(1);

    // Output tokens: use actual if available, otherwise estimate from chars
    const outTokens = this.callOutputTokensEstimated
      ? Math.round(this.callOutputChars / FALLBACK_CHARS_PER_TOKEN)
      : this.callOutputTokens;

    if (this.callInputTokens > 0) {
      const prefix = this.callInputTokensEstimated ? "~" : "";
      parts.push(`↑ ${prefix}${formatTokens(this.callInputTokens)}`);
    }

    if (outTokens > 0) {
      const prefix = this.callOutputTokensEstimated ? "~" : "";
      parts.push(`↓ ${prefix}${formatTokens(outTokens)}`);
    }

    parts.push(`${elapsed}s`);

    return parts.join(" | ");
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
          chalk.dim("↑") + chalk.yellow(` ${prefix}${formatTokens(this.callInputTokens)}`),
        );
      }
      if (outTokens > 0) {
        const prefix = outEstimated ? "~" : "";
        parts.push(chalk.dim("↓") + chalk.green(` ${prefix}${formatTokens(outTokens)}`));
      }
      parts.push(chalk.dim(`${elapsed}s`));
    } else {
      // Between calls: show cumulative stats
      const elapsed = Math.round((Date.now() - this.totalStartTime) / 1000);

      if (this.totalTokens > 0) {
        parts.push(chalk.magenta(formatTokens(this.totalTokens)));
      }
      if (this.iterations > 0) {
        parts.push(chalk.blue(`i${this.iterations}`));
      }
      if (this.totalCost > 0) {
        parts.push(chalk.cyan(`$${formatCost(this.totalCost)}`));
      }
      parts.push(chalk.dim(`${elapsed}s`));
    }

    return `${parts.join(chalk.dim(" | "))} ${chalk.green(">")} `;
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
    const message = error instanceof Error ? error.message : String(error);
    env.stderr.write(`${chalk.red.bold("Error:")} ${message}\n`);
    env.setExitCode(1);
  }
}
