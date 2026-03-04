/**
 * Layered matching algorithm for EditFile gadget.
 *
 * Tries strategies in order: exact -> whitespace -> indentation -> fuzzy -> dmp
 * This approach reduces edit errors by ~9x (per Aider benchmarks).
 */

import DiffMatchPatch from "diff-match-patch";
import type {
  MatchFailure,
  MatchOptions,
  MatchResult,
  MatchStrategy,
  SuggestionMatch,
} from "./types.js";

// Singleton DMP instance
const dmp = new DiffMatchPatch();

const DEFAULT_OPTIONS: Required<MatchOptions> = {
  fuzzyThreshold: 0.8,
  maxSuggestions: 3,
  contextLines: 5,
};

/**
 * Find a match for the search string in content using layered strategies.
 *
 * @param content The file content to search in
 * @param search The string to search for
 * @param options Matching options
 * @returns MatchResult if found, null if not found
 */
export function findMatch(
  content: string,
  search: string,
  options: MatchOptions = {},
): MatchResult | null {
  // Early return for empty search - prevents matching at every position
  if (!search) return null;

  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Try each strategy in order
  const strategies: Array<{
    name: MatchStrategy;
    fn: (content: string, search: string) => MatchResult | null;
  }> = [
    { name: "exact", fn: exactMatch },
    { name: "whitespace", fn: whitespaceMatch },
    { name: "indentation", fn: indentationMatch },
    { name: "fuzzy", fn: (c, s) => fuzzyMatch(c, s, opts.fuzzyThreshold) },
    { name: "dmp", fn: (c, s) => dmpMatch(c, s, opts.fuzzyThreshold) },
  ];

  for (const { name, fn } of strategies) {
    const result = fn(content, search);
    if (result) {
      return { ...result, strategy: name };
    }
  }

  return null;
}

/**
 * Apply replacement to content at the matched location.
 */
export function applyReplacement(content: string, match: MatchResult, replacement: string): string {
  return content.slice(0, match.startIndex) + replacement + content.slice(match.endIndex);
}

/**
 * Get failure details with suggestions when no match is found.
 */
export function getMatchFailure(
  content: string,
  search: string,
  options: MatchOptions = {},
): MatchFailure {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const suggestions = findSuggestions(content, search, opts.maxSuggestions, opts.fuzzyThreshold);
  const nearbyContext =
    suggestions.length > 0 ? getContext(content, suggestions[0].lineNumber, opts.contextLines) : "";

  return {
    reason: "Search content not found in file",
    suggestions,
    nearbyContext,
  };
}

// ============================================================================
// Strategy 1: Exact Match
// ============================================================================

function exactMatch(content: string, search: string): MatchResult | null {
  const index = content.indexOf(search);
  if (index === -1) return null;

  const { startLine, endLine } = getLineNumbers(content, index, index + search.length);

  return {
    found: true,
    strategy: "exact",
    confidence: 1.0,
    matchedContent: search,
    startIndex: index,
    endIndex: index + search.length,
    startLine,
    endLine,
  };
}

// ============================================================================
// Strategy 2: Whitespace-Insensitive Match
// ============================================================================

function whitespaceMatch(content: string, search: string): MatchResult | null {
  // Normalize runs of spaces/tabs to single space, preserve newlines
  const normalizeWs = (s: string) => s.replace(/[ \t]+/g, " ");

  const normalizedContent = normalizeWs(content);
  const normalizedSearch = normalizeWs(search);

  const normalizedIndex = normalizedContent.indexOf(normalizedSearch);
  if (normalizedIndex === -1) return null;

  // Map normalized index back to original content
  const { originalStart, originalEnd } = mapNormalizedToOriginal(
    content,
    normalizedIndex,
    normalizedSearch.length,
  );

  const matchedContent = content.slice(originalStart, originalEnd);
  const { startLine, endLine } = getLineNumbers(content, originalStart, originalEnd);

  return {
    found: true,
    strategy: "whitespace",
    confidence: 0.95,
    matchedContent,
    startIndex: originalStart,
    endIndex: originalEnd,
    startLine,
    endLine,
  };
}

// ============================================================================
// Strategy 3: Indentation-Preserving Match
// ============================================================================

function indentationMatch(content: string, search: string): MatchResult | null {
  // Strip leading whitespace from each line for comparison
  const stripIndent = (s: string) =>
    s
      .split("\n")
      .map((line) => line.trimStart())
      .join("\n");

  const strippedSearch = stripIndent(search);
  const contentLines = content.split("\n");
  const searchLines = search.split("\n");

  // Sliding window search
  const searchLineCount = searchLines.length;

  for (let i = 0; i <= contentLines.length - searchLineCount; i++) {
    const windowLines = contentLines.slice(i, i + searchLineCount);
    const strippedWindow = stripIndent(windowLines.join("\n"));

    if (strippedWindow === strippedSearch) {
      // Found match - calculate original indices
      const startIndex = contentLines.slice(0, i).join("\n").length + (i > 0 ? 1 : 0);
      const matchedContent = windowLines.join("\n");
      const endIndex = startIndex + matchedContent.length;
      const { startLine, endLine } = getLineNumbers(content, startIndex, endIndex);

      // Compute indentation delta (difference between file's indent and search's indent)
      const indentationDelta = computeIndentationDelta(searchLines, windowLines);

      return {
        found: true,
        strategy: "indentation",
        confidence: 0.9,
        matchedContent,
        startIndex,
        endIndex,
        startLine,
        endLine,
        indentationDelta,
      };
    }
  }

  return null;
}

// ============================================================================
// Strategy 4: Fuzzy Match
// ============================================================================

function fuzzyMatch(content: string, search: string, threshold: number): MatchResult | null {
  const searchLines = search.split("\n");
  const contentLines = content.split("\n");

  if (searchLines.length > contentLines.length) return null;

  let bestMatch: {
    startLineIndex: number;
    endLineIndex: number;
    similarity: number;
  } | null = null;

  // Sliding window
  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const windowLines = contentLines.slice(i, i + searchLines.length);
    const similarity = calculateLineSimilarity(searchLines, windowLines);

    if (similarity >= threshold && (!bestMatch || similarity > bestMatch.similarity)) {
      bestMatch = {
        startLineIndex: i,
        endLineIndex: i + searchLines.length,
        similarity,
      };
    }
  }

  if (!bestMatch) return null;

  // Calculate original indices
  const startIndex =
    contentLines.slice(0, bestMatch.startLineIndex).join("\n").length +
    (bestMatch.startLineIndex > 0 ? 1 : 0);
  const matchedContent = contentLines
    .slice(bestMatch.startLineIndex, bestMatch.endLineIndex)
    .join("\n");
  const endIndex = startIndex + matchedContent.length;
  const { startLine, endLine } = getLineNumbers(content, startIndex, endIndex);

  return {
    found: true,
    strategy: "fuzzy",
    confidence: bestMatch.similarity,
    matchedContent,
    startIndex,
    endIndex,
    startLine,
    endLine,
  };
}

// ============================================================================
// Strategy 5: DMP (diff-match-patch) Match
// ============================================================================

/**
 * DMP matching strategy using Google's diff-match-patch algorithm.
 * Handles heavily refactored code where other strategies fail.
 *
 * - Short patterns (≤32 chars): Uses native bitap algorithm
 * - Long patterns (>32 chars): Uses 32-char prefix for region finding + Levenshtein
 * - Skips patterns >1000 chars (too slow)
 */
function dmpMatch(content: string, search: string, threshold: number): MatchResult | null {
  // Skip empty strings - prevent DMP from failing silently
  if (!search || !content) return null;

  // Skip very long patterns (too slow and unlikely to match)
  if (search.length > 1000) return null;

  // DMP works better with single-line or short patterns
  // For long multiline searches, fuzzy is usually better
  if (search.split("\n").length > 20) return null;

  const matchIndex =
    search.length <= 32
      ? dmpMatchShortPattern(content, search, threshold)
      : dmpMatchLongPattern(content, search, threshold);

  if (matchIndex === -1) return null;

  // Determine the actual matched content length
  // For DMP, we find the region and then find the best ending point
  const matchedContent = findBestMatchExtent(content, matchIndex, search, threshold);
  if (!matchedContent) return null;

  const startIndex = matchIndex;
  const endIndex = matchIndex + matchedContent.length;
  const { startLine, endLine } = getLineNumbers(content, startIndex, endIndex);

  // Calculate confidence based on similarity
  const similarity = stringSimilarity(search, matchedContent);

  return {
    found: true,
    strategy: "dmp",
    confidence: similarity,
    matchedContent,
    startIndex,
    endIndex,
    startLine,
    endLine,
  };
}

/**
 * DMP matching for short patterns (≤32 chars) using native bitap.
 */
function dmpMatchShortPattern(content: string, search: string, threshold: number): number {
  // DMP's match_main uses bitap for patterns ≤32 chars
  // Threshold is inverted: DMP uses 0.0 = perfect, we use 1.0 = perfect
  dmp.Match_Threshold = 1 - threshold;
  dmp.Match_Distance = 1000; // Allow matches within reasonable distance

  const index = dmp.match_main(content, search, 0);
  return index;
}

/**
 * DMP matching for long patterns (>32 chars).
 * Uses a 32-char prefix to find candidate regions, then verifies with Levenshtein.
 */
function dmpMatchLongPattern(content: string, search: string, threshold: number): number {
  // Extract 32-char prefix for region finding
  const prefix = search.slice(0, 32);
  // Use same threshold as short patterns - DMP uses inverted threshold (0 = perfect)
  dmp.Match_Threshold = 1 - threshold;
  dmp.Match_Distance = 1000;

  const prefixIndex = dmp.match_main(content, prefix, 0);
  if (prefixIndex === -1) return -1;

  // Now verify the full pattern matches starting from this region
  // Look in a window around the prefix match - scale padding with pattern length
  const windowPadding = Math.max(50, Math.floor(search.length / 2));
  const windowStart = Math.max(0, prefixIndex - windowPadding);
  const windowEnd = Math.min(content.length, prefixIndex + search.length + windowPadding);
  const window = content.slice(windowStart, windowEnd);

  // Find best match within window using sliding approach
  let bestIndex = -1;
  let bestSimilarity = 0;

  for (let i = 0; i <= window.length - search.length; i++) {
    const candidate = window.slice(i, i + search.length);
    const similarity = stringSimilarity(search, candidate);

    if (similarity >= threshold && similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestIndex = windowStart + i;
    }
  }

  return bestIndex;
}

/**
 * Find the best extent of a match starting at matchIndex.
 * Handles cases where the matched content length differs from search length.
 */
function findBestMatchExtent(
  content: string,
  matchIndex: number,
  search: string,
  threshold: number,
): string | null {
  // Try exact length first
  const exactLength = content.slice(matchIndex, matchIndex + search.length);
  if (stringSimilarity(search, exactLength) >= threshold) {
    return exactLength;
  }

  // Try line-based matching (match same number of lines)
  const searchLines = search.split("\n").length;
  const contentFromMatch = content.slice(matchIndex);
  const contentLines = contentFromMatch.split("\n");

  if (contentLines.length >= searchLines) {
    const lineBasedMatch = contentLines.slice(0, searchLines).join("\n");
    if (stringSimilarity(search, lineBasedMatch) >= threshold) {
      return lineBasedMatch;
    }
  }

  return null;
}

// ============================================================================
// Multi-Match Support
// ============================================================================

/**
 * Find all matches for the search string in content.
 * Returns matches in order of appearance (not by confidence).
 *
 * @param content The file content to search in
 * @param search The string to search for
 * @param options Matching options
 * @returns Array of MatchResult for all matches found
 */
export function findAllMatches(
  content: string,
  search: string,
  options: MatchOptions = {},
): MatchResult[] {
  const results: MatchResult[] = [];
  let searchStart = 0;

  while (searchStart < content.length) {
    // Try to find a match starting from current position
    const remainingContent = content.slice(searchStart);
    const match = findMatch(remainingContent, search, options);

    if (!match) break;

    // Adjust indices to be relative to original content
    results.push({
      ...match,
      startIndex: searchStart + match.startIndex,
      endIndex: searchStart + match.endIndex,
      // Recalculate line numbers for original content
      ...getLineNumbers(content, searchStart + match.startIndex, searchStart + match.endIndex),
    });

    // Move search start past this match to find next
    searchStart = searchStart + match.endIndex;
    // Safety: advance at least one character to prevent infinite loop on zero-width matches
    if (match.endIndex === 0) {
      searchStart++;
    }
  }

  return results;
}

// ============================================================================
// Suggestion Finding
// ============================================================================

function findSuggestions(
  content: string,
  search: string,
  maxSuggestions: number,
  minSimilarity: number,
): SuggestionMatch[] {
  const searchLines = search.split("\n");
  const contentLines = content.split("\n");
  const suggestions: Array<{ lineIndex: number; similarity: number; content: string }> = [];

  // Reduce threshold for suggestions (show more potential matches)
  const suggestionThreshold = Math.max(0.5, minSimilarity - 0.2);

  // Find best matches using sliding window
  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const windowLines = contentLines.slice(i, i + searchLines.length);
    const similarity = calculateLineSimilarity(searchLines, windowLines);

    if (similarity >= suggestionThreshold) {
      suggestions.push({
        lineIndex: i,
        similarity,
        content: windowLines.join("\n"),
      });
    }
  }

  // Sort by similarity descending
  suggestions.sort((a, b) => b.similarity - a.similarity);

  return suggestions.slice(0, maxSuggestions).map((s) => ({
    content: s.content,
    lineNumber: s.lineIndex + 1, // 1-based
    similarity: s.similarity,
  }));
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate similarity between two line arrays using line-by-line comparison.
 */
function calculateLineSimilarity(a: string[], b: string[]): number {
  if (a.length !== b.length) return 0;
  if (a.length === 0) return 1;

  let totalSimilarity = 0;
  let totalWeight = 0;

  for (let i = 0; i < a.length; i++) {
    const lineA = a[i];
    const lineB = b[i];
    // Weight by line length (longer lines matter more)
    const weight = Math.max(lineA.length, lineB.length, 1);
    const similarity = stringSimilarity(lineA, lineB);
    totalSimilarity += similarity * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? totalSimilarity / totalWeight : 0;
}

/**
 * Calculate similarity between two strings using Levenshtein distance.
 */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const distance = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  return 1 - distance / maxLen;
}

/**
 * Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1, // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Get 1-based line numbers for a range in content.
 */
function getLineNumbers(
  content: string,
  startIndex: number,
  endIndex: number,
): { startLine: number; endLine: number } {
  const beforeStart = content.slice(0, startIndex);
  const beforeEnd = content.slice(0, endIndex);

  const startLine = (beforeStart.match(/\n/g) || []).length + 1;
  const endLine = (beforeEnd.match(/\n/g) || []).length + 1;

  return { startLine, endLine };
}

/**
 * Check if character is horizontal whitespace (space or tab).
 */
function isHorizontalWhitespace(char: string): boolean {
  return char === " " || char === "\t";
}

/**
 * Map normalized string index back to original string.
 * Uses a two-pass approach: first find start, then find end.
 */
function mapNormalizedToOriginal(
  original: string,
  normalizedStart: number,
  normalizedLength: number,
): { originalStart: number; originalEnd: number } {
  const originalStart = findOriginalIndex(original, normalizedStart);
  const originalEnd = findOriginalIndex(original, normalizedStart + normalizedLength);
  return { originalStart, originalEnd: originalEnd === -1 ? original.length : originalEnd };
}

/**
 * Find original string index for a given normalized position.
 */
function findOriginalIndex(original: string, targetNormalizedPos: number): number {
  let normalizedPos = 0;
  let inWhitespace = false;

  for (let i = 0; i < original.length; i++) {
    if (normalizedPos === targetNormalizedPos) {
      return i;
    }

    const isWs = isHorizontalWhitespace(original[i]);
    if (isWs && !inWhitespace) {
      normalizedPos++;
      inWhitespace = true;
    } else if (!isWs) {
      normalizedPos++;
      inWhitespace = false;
    }
  }

  return normalizedPos === targetNormalizedPos ? original.length : -1;
}

/**
 * Get context lines around a line number.
 */
function getContext(content: string, lineNumber: number, contextLines: number): string {
  const lines = content.split("\n");
  const start = Math.max(0, lineNumber - 1 - contextLines);
  const end = Math.min(lines.length, lineNumber + contextLines);

  const contextWithNumbers = lines.slice(start, end).map((line, i) => {
    const num = start + i + 1;
    const marker = num === lineNumber ? ">" : " ";
    return `${marker}${String(num).padStart(4)} | ${line}`;
  });

  return contextWithNumbers.join("\n");
}

// ============================================================================
// Indentation Delta Functions
// ============================================================================

/**
 * Extract leading whitespace from a line.
 */
function getLeadingWhitespace(line: string): string {
  const match = line.match(/^[ \t]*/);
  return match ? match[0] : "";
}

/**
 * Compute the indentation delta between search and matched content.
 * Returns the whitespace prefix that should be added to each line.
 *
 * @param searchLines Lines from the search pattern
 * @param matchedLines Lines from the matched content in the file
 * @returns The indentation delta string (e.g., "    " for 4-space indent)
 */
function computeIndentationDelta(searchLines: string[], matchedLines: string[]): string {
  // Find the first non-empty line in both to compare indentation
  for (let i = 0; i < Math.min(searchLines.length, matchedLines.length); i++) {
    const searchLine = searchLines[i];
    const matchedLine = matchedLines[i];

    // Skip empty lines
    if (searchLine.trim() === "" && matchedLine.trim() === "") continue;

    const searchIndent = getLeadingWhitespace(searchLine);
    const matchedIndent = getLeadingWhitespace(matchedLine);

    // Return the difference in indentation
    if (matchedIndent.length > searchIndent.length) {
      return matchedIndent.slice(searchIndent.length);
    }
    // If matched has less indent, return empty (can't have negative delta)
    return "";
  }

  return "";
}

/**
 * Adjust indentation of replacement text based on the indentation delta.
 * Adds the delta to each line of the replacement.
 *
 * @param replacement The replacement text
 * @param delta The indentation delta to apply
 * @returns The replacement with adjusted indentation
 */
export function adjustIndentation(replacement: string, delta: string): string {
  if (!delta) return replacement;

  return replacement
    .split("\n")
    .map((line, index) => {
      // Don't add indent to empty lines or the first line if it's aligned with search
      if (line.trim() === "") return line;
      return delta + line;
    })
    .join("\n");
}

// ============================================================================
// Before/After Context Formatting
// ============================================================================

/**
 * Format context showing before and after state of an edit.
 * Shows 5 lines of context around the edit with diff-style markers.
 *
 * @param originalContent The original file content
 * @param match The match result
 * @param replacement The replacement text
 * @param contextLines Number of context lines to show (default: 5)
 * @returns Formatted string showing the edit context
 */
export function formatEditContext(
  originalContent: string,
  match: MatchResult,
  replacement: string,
  contextLines = 5,
): string {
  const lines = originalContent.split("\n");
  const startLine = match.startLine - 1; // Convert to 0-based
  const endLine = match.endLine; // Already exclusive for slicing

  const contextStart = Math.max(0, startLine - contextLines);
  const contextEnd = Math.min(lines.length, endLine + contextLines);

  const output: string[] = [];
  output.push(`=== Edit (lines ${match.startLine}-${match.endLine}) ===`);
  output.push("");

  // Show before section
  // Context lines before the change
  for (let i = contextStart; i < startLine; i++) {
    output.push(`  ${String(i + 1).padStart(4)} | ${lines[i]}`);
  }

  // Lines being removed (marked with <)
  for (let i = startLine; i < endLine; i++) {
    output.push(`< ${String(i + 1).padStart(4)} | ${lines[i]}`);
  }

  // Lines being added (marked with >)
  const replacementLines = replacement.split("\n");
  for (let i = 0; i < replacementLines.length; i++) {
    const lineNum = startLine + i + 1;
    output.push(`> ${String(lineNum).padStart(4)} | ${replacementLines[i]}`);
  }

  // Context lines after the change
  for (let i = endLine; i < contextEnd; i++) {
    output.push(`  ${String(i + 1).padStart(4)} | ${lines[i]}`);
  }

  return output.join("\n");
}

/**
 * Format a summary of multiple matches for disambiguation.
 *
 * @param content The file content
 * @param matches Array of matches found
 * @param maxMatches Maximum matches to show (default: 5)
 * @returns Formatted string showing match locations
 */
export function formatMultipleMatches(
  content: string,
  matches: MatchResult[],
  maxMatches = 5,
): string {
  const lines = content.split("\n");
  const output: string[] = [];

  output.push(`Found ${matches.length} matches:`);
  output.push("");

  const displayMatches = matches.slice(0, maxMatches);

  for (let i = 0; i < displayMatches.length; i++) {
    const match = displayMatches[i];
    output.push(`Match ${i + 1} (lines ${match.startLine}-${match.endLine}):`);

    // Show a few lines of context
    const contextStart = Math.max(0, match.startLine - 2);
    const contextEnd = Math.min(lines.length, match.endLine + 1);

    for (let j = contextStart; j < contextEnd; j++) {
      const marker = j >= match.startLine - 1 && j < match.endLine ? ">" : " ";
      output.push(`${marker}${String(j + 1).padStart(4)} | ${lines[j]}`);
    }

    output.push("");
  }

  if (matches.length > maxMatches) {
    output.push(`... and ${matches.length - maxMatches} more matches`);
  }

  return output.join("\n");
}
