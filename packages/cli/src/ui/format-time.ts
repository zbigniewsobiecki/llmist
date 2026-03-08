/**
 * Execution time formatting utility.
 *
 * Provides shared logic for formatting execution time in milliseconds
 * to a human-readable string for display in gadget and LLM call lines.
 *
 * Shows seconds for values >= 1000ms, otherwise milliseconds.
 */

/**
 * Formats an execution time in milliseconds as a human-readable string.
 *
 * Uses seconds for durations >= 1000ms, and milliseconds otherwise.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string (e.g., "123ms" or "1.5s")
 *
 * @example
 * ```typescript
 * formatExecutionTime(123);   // "123ms"
 * formatExecutionTime(1500);  // "1.5s"
 * formatExecutionTime(1000);  // "1.0s"
 * ```
 */
export function formatExecutionTime(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${Math.round(ms)}ms`;
}
