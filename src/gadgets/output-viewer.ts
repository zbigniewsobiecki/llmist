/**
 * GadgetOutputViewer - Browse stored outputs from gadgets that exceeded the size limit.
 *
 * When a gadget returns too much data, the output is stored and can be browsed
 * using this gadget with grep-like pattern filtering and line limiting.
 */

import { z } from "zod";
import type { GadgetOutputStore } from "../agent/gadget-output-store.js";
import { createGadget } from "./create-gadget.js";

/**
 * Pattern filter configuration.
 */
interface PatternFilter {
  /** Regular expression to match */
  regex: string;
  /** true = keep matches, false = exclude matches */
  include: boolean;
  /** Context lines before match (like grep -B) */
  before: number;
  /** Context lines after match (like grep -A) */
  after: number;
}

/**
 * Apply a single pattern filter to lines.
 *
 * For include=true: keeps lines that match (with before/after context).
 * For include=false: removes lines that match.
 */
function applyPattern(lines: string[], pattern: PatternFilter): string[] {
  const regex = new RegExp(pattern.regex);

  if (!pattern.include) {
    // Exclude mode: remove matching lines
    return lines.filter((line) => !regex.test(line));
  }

  // Include mode: keep matching lines with context
  const matchIndices = new Set<number>();

  // Find all matching line indices
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      // Add the matching line and its context
      const start = Math.max(0, i - pattern.before);
      const end = Math.min(lines.length - 1, i + pattern.after);
      for (let j = start; j <= end; j++) {
        matchIndices.add(j);
      }
    }
  }

  // Return lines at matching indices (preserving order)
  return lines.filter((_, index) => matchIndices.has(index));
}

/**
 * Apply multiple pattern filters in sequence (like piping through grep commands).
 */
function applyPatterns(lines: string[], patterns: PatternFilter[]): string[] {
  let result = lines;
  for (const pattern of patterns) {
    result = applyPattern(result, pattern);
  }
  return result;
}

/**
 * Parse and apply a line limit string.
 *
 * Formats:
 * - "100-" → first 100 lines (slice 0 to 100)
 * - "-25" → last 25 lines (slice -25)
 * - "50-100" → lines 50-100 (1-indexed, so slice 49 to 100)
 */
function applyLineLimit(lines: string[], limit: string): string[] {
  const trimmed = limit.trim();

  // Format: "100-" (first N lines)
  if (trimmed.endsWith("-") && !trimmed.startsWith("-")) {
    const n = parseInt(trimmed.slice(0, -1), 10);
    if (!isNaN(n) && n > 0) {
      return lines.slice(0, n);
    }
  }

  // Format: "-25" (last N lines)
  if (trimmed.startsWith("-") && !trimmed.includes("-", 1)) {
    const n = parseInt(trimmed, 10);
    if (!isNaN(n) && n < 0) {
      return lines.slice(n);
    }
  }

  // Format: "50-100" (range, 1-indexed)
  const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    if (!isNaN(start) && !isNaN(end) && start > 0 && end >= start) {
      // Convert from 1-indexed to 0-indexed
      return lines.slice(start - 1, end);
    }
  }

  // Invalid format - return unchanged
  return lines;
}

/**
 * Schema for pattern filter objects.
 */
const patternSchema = z.object({
  regex: z.string().describe("Regular expression to match"),
  include: z
    .boolean()
    .default(true)
    .describe("true = keep matching lines, false = exclude matching lines"),
  before: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Context lines before each match (like grep -B)"),
  after: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Context lines after each match (like grep -A)"),
});

/**
 * Create a GadgetOutputViewer gadget instance bound to a specific output store.
 *
 * This is a factory function because the gadget needs access to the output store,
 * which is created per-agent-run.
 *
 * @param store - The GadgetOutputStore to read outputs from
 * @returns A GadgetOutputViewer gadget instance
 *
 * @example
 * ```typescript
 * const store = new GadgetOutputStore();
 * const viewer = createGadgetOutputViewer(store);
 * registry.register("GadgetOutputViewer", viewer);
 * ```
 */
export function createGadgetOutputViewer(store: GadgetOutputStore) {
  return createGadget({
    name: "GadgetOutputViewer",
    description:
      "View stored output from gadgets that returned too much data. " +
      "Use patterns to filter lines (like grep) and limit to control output size. " +
      "Patterns are applied first in order, then the limit is applied to the result.",
    schema: z.object({
      id: z.string().describe("ID of the stored output (from the truncation message)"),
      patterns: z
        .array(patternSchema)
        .optional()
        .describe(
          "Filter patterns applied in order (like piping through grep). " +
            "Each pattern can include or exclude lines with optional before/after context.",
        ),
      limit: z
        .string()
        .optional()
        .describe(
          "Line range to return after filtering. " +
            "Formats: '100-' (first 100), '-25' (last 25), '50-100' (lines 50-100)",
        ),
    }),
    examples: [
      {
        comment: "View first 50 lines of stored output",
        params: { id: "Search_abc12345", limit: "50-" },
      },
      {
        comment: "Filter for error lines with context",
        params: {
          id: "Search_abc12345",
          patterns: [{ regex: "error|Error|ERROR", include: true, before: 2, after: 5 }],
        },
      },
      {
        comment: "Exclude blank lines, then show first 100",
        params: {
          id: "Search_abc12345",
          patterns: [{ regex: "^\\s*$", include: false, before: 0, after: 0 }],
          limit: "100-",
        },
      },
      {
        comment: "Chain filters: find TODOs, exclude tests, limit to 50 lines",
        params: {
          id: "Search_abc12345",
          patterns: [
            { regex: "TODO", include: true, before: 1, after: 1 },
            { regex: "test|spec", include: false, before: 0, after: 0 },
          ],
          limit: "50-",
        },
      },
    ],
    execute: ({ id, patterns, limit }) => {
      const stored = store.get(id);
      if (!stored) {
        return `Error: No stored output with id "${id}". Available IDs: ${store.getIds().join(", ") || "(none)"}`;
      }

      let lines = stored.content.split("\n");

      // Step 1: Apply patterns in order (like piping through grep)
      if (patterns && patterns.length > 0) {
        lines = applyPatterns(
          lines,
          patterns.map((p) => ({
            regex: p.regex,
            include: p.include ?? true,
            before: p.before ?? 0,
            after: p.after ?? 0,
          })),
        );
      }

      // Step 2: Apply line limit AFTER all patterns
      if (limit) {
        lines = applyLineLimit(lines, limit);
      }

      // Return result with metadata
      const totalLines = stored.lineCount;
      const returnedLines = lines.length;

      if (returnedLines === 0) {
        return `No lines matched the filters. Original output had ${totalLines} lines.`;
      }

      const header =
        returnedLines < totalLines
          ? `[Showing ${returnedLines} of ${totalLines} lines]\n`
          : `[Showing all ${totalLines} lines]\n`;

      return header + lines.join("\n");
    },
  });
}

// Export helpers for testing
export { applyPattern, applyPatterns, applyLineLimit };
