/**
 * Error utilities for llmist.
 */

/**
 * Thrown when an LLM provider returns a completion with no usable output —
 * no text, no tool calls, and no reasoning — typically a transient provider
 * glitch (e.g. a 200-OK response with an empty body). The retry orchestrator
 * treats this as a retryable failure; if every attempt comes back empty it
 * surfaces this error rather than committing a silent blank turn.
 */
export class EmptyCompletionError extends Error {
  /** Agent iteration on which the empty completion was observed. */
  readonly iteration: number;
  /** Finish reason reported alongside the empty body (often null). */
  readonly finishReason: string | null;

  constructor(params: { iteration: number; finishReason: string | null }) {
    super(
      `LLM returned an empty completion (no text, tool calls, or reasoning) on iteration ${params.iteration}`,
    );
    this.name = "EmptyCompletionError";
    this.iteration = params.iteration;
    this.finishReason = params.finishReason;
  }
}

/**
 * Detects if an error is an abort/cancellation error from any provider.
 *
 * Different providers throw different error types when a request is aborted:
 * - Standard: `AbortError` (name) - from fetch/AbortController
 * - Anthropic SDK: `APIConnectionAbortedError`
 * - OpenAI SDK: `APIUserAbortError`
 * - Generic: errors with "abort", "cancelled", or "canceled" in the message
 *
 * @param error - The error to check
 * @returns `true` if the error is an abort-related error, `false` otherwise
 *
 * @example
 * ```typescript
 * import { isAbortError } from "@llmist/core/errors";
 *
 * const controller = new AbortController();
 *
 * try {
 *   for await (const chunk of client.stream({ signal: controller.signal, ... })) {
 *     // Process chunks...
 *   }
 * } catch (error) {
 *   if (isAbortError(error)) {
 *     console.log("Request was cancelled - this is expected");
 *     return; // Graceful exit
 *   }
 *   // Re-throw unexpected errors
 *   throw error;
 * }
 * ```
 */
export function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // Standard AbortError (from fetch/AbortController)
  if (error.name === "AbortError") return true;

  // Anthropic SDK
  if (error.name === "APIConnectionAbortedError") return true;

  // OpenAI SDK
  if (error.name === "APIUserAbortError") return true;

  // Message-based detection (fallback for edge cases)
  const message = error.message.toLowerCase();
  if (message.includes("abort")) return true;
  if (message.includes("cancelled")) return true;
  if (message.includes("canceled")) return true;

  return false;
}
