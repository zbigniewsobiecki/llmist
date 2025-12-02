/**
 * Error utilities for llmist.
 */

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
