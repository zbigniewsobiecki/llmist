/**
 * Custom gadget preview formatters.
 *
 * This module provides custom preview strings for specific gadgets when they
 * appear in the CLI output. Instead of showing a generic output preview,
 * some gadgets benefit from a richer, purpose-built display.
 *
 * **Design:**
 * - `getCustomPreview()` returns `string | undefined`
 * - Returns `undefined` when no custom preview exists for the gadget
 * - `formatGadgetSummary()` falls back to generic output preview when `undefined`
 *
 * **Adding new previews:**
 * Add a new `if` block in `getCustomPreview()` for the gadget name and
 * return the formatted string. Use `truncatePreview()` for text truncation.
 */

/**
 * Truncates a string to maxLen characters with ellipsis if needed.
 * Normalizes whitespace (collapses newlines/tabs to single spaces).
 *
 * @param output - The output text to truncate
 * @param maxLen - Maximum character width for the preview
 * @returns Truncated string with ellipsis if needed
 */
export function truncatePreview(output: string, maxLen: number): string {
  const normalized = output.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1)}…`;
}

/**
 * Returns a custom preview string for a gadget result, or `undefined` if
 * no custom preview is defined for that gadget.
 *
 * Custom previews replace the generic output preview in `formatGadgetSummary()`.
 *
 * @param gadgetName - Name of the gadget that was executed
 * @param params - Parameters passed to the gadget
 * @param result - Result string from gadget execution (may be undefined)
 * @param maxWidth - Maximum character width available for the preview
 * @returns Formatted preview string, or `undefined` if no custom preview exists
 *
 * @example
 * ```typescript
 * // TodoUpsert with done status
 * getCustomPreview("TodoUpsert", { status: "done", content: "Write tests" }, undefined, 60);
 * // → "✅ Write tests"
 *
 * // GoogleSearch with results
 * getCustomPreview("GoogleSearch", { query: "typescript generics" }, "(10 of 1000 results)", 60);
 * // → `🔍 "typescript generics" → 10 results`
 *
 * // Unknown gadget
 * getCustomPreview("MyGadget", {}, "some output", 60);
 * // → undefined
 * ```
 */
export function getCustomPreview(
  gadgetName: string,
  params: Record<string, unknown> | undefined,
  result: string | undefined,
  maxWidth: number,
): string | undefined {
  // TodoUpsert: show status emoji + content instead of generic output
  if (gadgetName === "TodoUpsert" && params?.content) {
    const statusEmoji =
      params.status === "done" ? "✅" : params.status === "in_progress" ? "🔄" : "⬜";
    const content = String(params.content);
    return `${statusEmoji} ${truncatePreview(content, maxWidth - 3)}`; // -3 for emoji+space
  }

  // GoogleSearch: show 🔍 + query + result count
  if (gadgetName === "GoogleSearch" && params?.query) {
    const query = String(params.query);
    // Parse result count from output - try multiple patterns
    const countMatch =
      result?.match(/\((\d+)\s+of\s+[\d,]+\s+results?\)/i) || // "(10 of 36400000 results)"
      result?.match(/(\d+)\s+results?\s+found/i) || // "10 results found"
      result?.match(/found\s+(\d+)\s+results?/i); // "found 10 results"
    // Fall back to maxResults parameter if no count found in output
    const count = countMatch?.[1] ?? (params.maxResults ? String(params.maxResults) : null);
    const countStr = count ? ` → ${count} results` : "";
    const queryPreview = truncatePreview(query, maxWidth - 5 - countStr.length); // 🔍 + space + quotes
    return `🔍 "${queryPreview}"${countStr}`;
  }

  return undefined;
}
