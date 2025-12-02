/**
 * Error utilities for llmist.
 */

/**
 * Detects if an error is an abort-related error from any provider SDK.
 *
 * Different providers throw different error types when a request is aborted:
 * - Standard: AbortError (from fetch/AbortController)
 * - Anthropic: APIConnectionAbortedError
 * - OpenAI: APIUserAbortError
 *
 * @param error - The error to check
 * @returns true if the error is an abort-related error
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
