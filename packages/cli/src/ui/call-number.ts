/**
 * Call number formatting utility.
 *
 * Provides shared logic for formatting hierarchical call numbers
 * used by LLM call progress lines.
 *
 * Format: `#N` (main agent) or `#N.gadgetId.M` (subagent)
 */

/**
 * Formats a hierarchical call number string.
 *
 * @param iteration - Iteration/call number
 * @param parentCallNumber - Parent call number for nested calls
 * @param gadgetInvocationId - Gadget invocation ID for unique subagent identification
 * @returns Formatted call number string (e.g., "#1", "#1.2", "#6.browse_web_1.2")
 *
 * @example
 * ```typescript
 * formatCallNumber(1);                          // "#1"
 * formatCallNumber(2, 1);                       // "#1.2"
 * formatCallNumber(2, 6, "browse_web_1");       // "#6.browse_web_1.2"
 * ```
 */
export function formatCallNumber(
  iteration: number,
  parentCallNumber?: number,
  gadgetInvocationId?: string,
): string {
  if (parentCallNumber !== undefined && gadgetInvocationId) {
    // Subagent with full context: #parent.gadgetId.iteration
    return `#${parentCallNumber}.${gadgetInvocationId}.${iteration}`;
  }
  if (parentCallNumber !== undefined) {
    // Subagent without gadget ID (legacy): #parent.iteration
    return `#${parentCallNumber}.${iteration}`;
  }
  // Main agent: #iteration
  return `#${iteration}`;
}
