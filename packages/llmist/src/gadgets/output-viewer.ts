/**
 * GadgetOutputViewer - Browse stored outputs from gadgets that exceeded the size limit.
 *
 * Supports two access patterns:
 * - `mode: "line"`: grep-like filtering and line pagination.
 * - `mode: "character"`: raw character windows for dense or single-line output.
 */

import { z } from "zod";
import type { GadgetOutputStore, StoredOutput } from "../agent/gadget-output-store.js";
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

type LimitWindow =
  | { kind: "first"; count: number }
  | { kind: "last"; count: number }
  | { kind: "range"; start: number; end: number };

interface CharacterWindow {
  text: string;
  start: number;
  end: number;
  total: number;
  truncatedBySize: boolean;
  hasMoreAfter: boolean;
}

/** Default max output in characters (~19k tokens at 4 chars/token) */
const DEFAULT_MAX_OUTPUT_CHARS = 76_800;
const CHARACTER_HINT_WINDOW = 2_000;
const DENSE_LINE_THRESHOLD = 4_000;

function pluralize(count: number, singular: string, plural: string = `${singular}s`): string {
  return count === 1 ? singular : plural;
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
    return lines.filter((line) => !regex.test(line));
  }

  const matchIndices = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      const start = Math.max(0, i - pattern.before);
      const end = Math.min(lines.length - 1, i + pattern.after);
      for (let j = start; j <= end; j++) {
        matchIndices.add(j);
      }
    }
  }

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
 * Parse a limit string used by both line mode and character mode.
 *
 * Formats:
 * - "100-" → first 100 units
 * - "-25" → last 25 units
 * - "50-100" → units 50-100 (1-indexed, inclusive)
 */
function parseLimitWindow(limit: string): LimitWindow | null {
  const trimmed = limit.trim();

  if (trimmed.endsWith("-") && !trimmed.startsWith("-")) {
    const n = parseInt(trimmed.slice(0, -1), 10);
    if (!Number.isNaN(n) && n > 0) {
      return { kind: "first", count: n };
    }
  }

  if (trimmed.startsWith("-") && !trimmed.includes("-", 1)) {
    const n = parseInt(trimmed, 10);
    if (!Number.isNaN(n) && n < 0) {
      return { kind: "last", count: Math.abs(n) };
    }
  }

  const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    if (!Number.isNaN(start) && !Number.isNaN(end) && start > 0 && end >= start) {
      return { kind: "range", start, end };
    }
  }

  return null;
}

/**
 * Apply line pagination using the parsed limit window.
 */
function applyLineLimit(lines: string[], limit: string): string[] {
  const window = parseLimitWindow(limit);
  if (!window) return lines;

  switch (window.kind) {
    case "first":
      return lines.slice(0, window.count);
    case "last":
      return lines.slice(-window.count);
    case "range":
      return lines.slice(window.start - 1, window.end);
  }
}

/**
 * Apply character pagination over the raw stored string.
 */
function applyCharacterLimit(
  content: string,
  limit: string | undefined,
  maxOutputChars: number,
): CharacterWindow {
  const total = content.length;
  if (total === 0) {
    return { text: "", start: 0, end: 0, total: 0, truncatedBySize: false, hasMoreAfter: false };
  }

  let startIndex = 0;
  let endExclusive = total;
  const window = limit ? parseLimitWindow(limit) : null;

  if (window) {
    switch (window.kind) {
      case "first":
        endExclusive = Math.min(window.count, total);
        break;
      case "last":
        startIndex = Math.max(0, total - window.count);
        break;
      case "range":
        startIndex = Math.min(window.start - 1, total);
        endExclusive = Math.min(window.end, total);
        break;
    }
  }

  let text = content.slice(startIndex, endExclusive);
  let truncatedBySize = false;
  if (text.length > maxOutputChars) {
    text = window?.kind === "last" ? text.slice(-maxOutputChars) : text.slice(0, maxOutputChars);
    if (window?.kind === "last") {
      startIndex = endExclusive - text.length;
    }
    truncatedBySize = true;
  }

  return {
    text,
    start: text.length === 0 ? 0 : startIndex + 1,
    end: text.length === 0 ? 0 : startIndex + text.length,
    total,
    truncatedBySize,
    hasMoreAfter: startIndex + text.length < total,
  };
}

function buildCharacterRangeHint(start: number, total: number): string | null {
  if (total <= 0 || start > total) return null;
  const end = Math.min(total, start + CHARACTER_HINT_WINDOW - 1);
  return `${start}-${end}`;
}

function buildCharacterModeSuggestion(
  stored: Pick<StoredOutput, "charCount" | "lineCount" | "maxLineLength">,
  opts: { removePatterns?: boolean; start?: number } = {},
): string {
  const hint = buildCharacterRangeHint(opts.start ?? 1, stored.charCount);
  const action = opts.removePatterns ? "Remove patterns and then try" : "Try";
  const lineLabel = pluralize(stored.lineCount, "line");

  return (
    `This output is dense (${stored.lineCount.toLocaleString()} ${lineLabel}; ` +
    `longest line ${stored.maxLineLength.toLocaleString()} chars). ` +
    `${action} mode: "character"` +
    (hint ? `, limit: "${hint}"` : "") +
    "."
  );
}

function shouldSuggestCharacterMode(
  stored: Pick<StoredOutput, "lineCount" | "maxLineLength">,
  maxOutputChars: number = DEFAULT_MAX_OUTPUT_CHARS,
): boolean {
  return (
    stored.lineCount <= 3 &&
    (stored.maxLineLength > maxOutputChars || stored.maxLineLength >= DENSE_LINE_THRESHOLD)
  );
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
 * @param store - The GadgetOutputStore to read outputs from
 * @param maxOutputChars - Maximum characters to return (default: 76,800 = ~19k tokens)
 * @returns A GadgetOutputViewer gadget instance
 */
export function createGadgetOutputViewer(
  store: GadgetOutputStore,
  maxOutputChars: number = DEFAULT_MAX_OUTPUT_CHARS,
) {
  return createGadget({
    name: "GadgetOutputViewer",
    description:
      "View stored output from gadgets that returned too much data. " +
      'Use mode "line" for grep-like filtering and mode "character" for raw chunked browsing ' +
      "when the output is dense or effectively single-line. Patterns work only in line mode.",
    schema: z.object({
      id: z.string().describe("ID of the stored output (from the truncation message)"),
      mode: z
        .enum(["line", "character"])
        .default("line")
        .describe(
          'Browse by "line" (supports patterns) or by "character" (raw windows for dense output).',
        ),
      patterns: z
        .array(patternSchema)
        .optional()
        .describe(
          "Line-mode filter patterns applied in order (like piping through grep). " +
            'Not supported in mode "character".',
        ),
      limit: z
        .string()
        .optional()
        .describe(
          'Pagination window. In mode "line" it is a line range; in mode "character" it is ' +
            `a character range. Formats: "100-" (first 100), "-25" (last 25), ` +
            '"50-100" (inclusive range).',
        ),
    }),
    examples: [
      {
        comment: "View first 50 lines of stored output",
        params: { id: "Search_abc12345", mode: "line", limit: "50-" },
      },
      {
        comment: "Filter for error lines with context",
        params: {
          id: "Search_abc12345",
          mode: "line",
          patterns: [{ regex: "error|Error|ERROR", include: true, before: 2, after: 5 }],
        },
      },
      {
        comment: "Exclude blank lines, then show first 100 lines",
        params: {
          id: "Search_abc12345",
          mode: "line",
          patterns: [{ regex: "^\\s*$", include: false, before: 0, after: 0 }],
          limit: "100-",
        },
      },
      {
        comment: "Browse the raw output by character window when line mode is too dense",
        params: {
          id: "Search_abc12345",
          mode: "character",
          limit: "1-2000",
        },
      },
    ],
    execute: ({ id, mode, patterns, limit }) => {
      const stored = store.get(id);
      if (!stored) {
        return `Error: No stored output with id "${id}". Available IDs: ${store.getIds().join(", ") || "(none)"}`;
      }

      const suggestCharacterMode = shouldSuggestCharacterMode(stored, maxOutputChars);

      if (mode === "character") {
        if (patterns && patterns.length > 0) {
          return (
            'Error: patterns are only supported in mode "line". ' +
            'Remove patterns or switch back to mode: "line".'
          );
        }

        const window = applyCharacterLimit(stored.content, limit, maxOutputChars);
        if (window.total === 0) {
          return "[Mode: character | Output is empty]";
        }

        const header = [
          `[Mode: character | Showing chars ${window.start.toLocaleString()}-${window.end.toLocaleString()} of ${window.total.toLocaleString()}${
            window.truncatedBySize ? " (truncated due to viewer size limit)" : ""
          }]`,
        ];

        if (window.hasMoreAfter) {
          const nextRange = buildCharacterRangeHint(window.end + 1, window.total);
          if (nextRange) {
            header.push(`[Next chunk: mode: "character", limit: "${nextRange}"]`);
          }
        }

        return `${header.join("\n")}\n${window.text}`;
      }

      let lines = stored.content.split("\n");

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

      if (limit) {
        lines = applyLineLimit(lines, limit);
      }

      const totalLines = stored.lineCount;
      const totalLineLabel = pluralize(totalLines, "line");
      const returnedLines = lines.length;

      if (returnedLines === 0) {
        const base = `No lines matched the filters. Original output had ${totalLines.toLocaleString()} lines.`;
        if (!suggestCharacterMode) return base;
        return `${base} ${buildCharacterModeSuggestion(stored, {
          removePatterns: Boolean(patterns && patterns.length > 0),
        })}`;
      }

      let output = lines.join("\n");
      let truncatedBySize = false;
      let linesIncluded = returnedLines;
      let clippedFirstLine = false;

      if (output.length > maxOutputChars) {
        truncatedBySize = true;
        let truncatedOutput = "";
        linesIncluded = 0;

        for (const line of lines) {
          const addition = linesIncluded === 0 ? line : `\n${line}`;
          if (truncatedOutput.length + addition.length > maxOutputChars) break;
          truncatedOutput += addition;
          linesIncluded++;
        }

        if (linesIncluded === 0) {
          clippedFirstLine = true;
          linesIncluded = 1;
          truncatedOutput = lines[0].slice(0, maxOutputChars);
        }

        output = truncatedOutput;
      }

      let header: string;
      if (clippedFirstLine) {
        header =
          `[Mode: line | Showing 1 partial line of ${totalLines.toLocaleString()} ${totalLineLabel} ` +
          "(the selected line exceeds the viewer size limit)]\n";
      } else if (truncatedBySize) {
        const remainingLines = returnedLines - linesIncluded;
        header =
          `[Mode: line | Showing ${linesIncluded.toLocaleString()} of ${totalLines.toLocaleString()} ${totalLineLabel} ` +
          "(truncated due to size limit)]\n" +
          `[... ${remainingLines.toLocaleString()} more ${pluralize(remainingLines, "line")}. ` +
          `Use limit parameter to paginate, e.g., limit: "${linesIncluded + 1}-${linesIncluded + 200}"]\n`;
      } else if (returnedLines < totalLines) {
        header =
          `[Mode: line | Showing ${returnedLines.toLocaleString()} ` +
          `of ${totalLines.toLocaleString()} ${totalLineLabel}]\n`;
      } else {
        header = `[Mode: line | Showing all ${totalLines.toLocaleString()} ${totalLineLabel}]\n`;
      }

      const footer =
        suggestCharacterMode || clippedFirstLine
          ? `\n[Tip: ${buildCharacterModeSuggestion(stored, {
              removePatterns: Boolean(patterns && patterns.length > 0),
            })}]`
          : "";

      return header + output + footer;
    },
  });
}

// Export helpers for testing
export {
  applyCharacterLimit,
  applyLineLimit,
  applyPattern,
  applyPatterns,
  buildCharacterModeSuggestion,
  parseLimitWindow,
  shouldSuggestCharacterMode,
};
