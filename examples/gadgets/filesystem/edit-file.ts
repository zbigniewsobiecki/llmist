import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { createGadget } from "../../../src/index.js";
import { validatePathIsWithinCwd } from "./utils.js";

/**
 * Types for the layered matching algorithm.
 */
type MatchStrategy = "exact" | "whitespace" | "indentation" | "fuzzy";

interface MatchResult {
  found: boolean;
  strategy: MatchStrategy;
  confidence: number;
  matchedContent: string;
  startIndex: number;
  endIndex: number;
  startLine: number;
  endLine: number;
}

interface SuggestionMatch {
  content: string;
  lineNumber: number;
  similarity: number;
}

interface MatchFailure {
  reason: string;
  suggestions: SuggestionMatch[];
  nearbyContext: string;
}

/**
 * Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  return 1 - levenshteinDistance(a, b) / Math.max(a.length, b.length);
}

function calculateLineSimilarity(a: string[], b: string[]): number {
  if (a.length !== b.length) return 0;
  if (a.length === 0) return 1;
  let totalSimilarity = 0;
  let totalWeight = 0;
  for (let i = 0; i < a.length; i++) {
    const weight = Math.max(a[i].length, b[i].length, 1);
    totalSimilarity += stringSimilarity(a[i], b[i]) * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? totalSimilarity / totalWeight : 0;
}

function getLineNumbers(
  content: string,
  startIndex: number,
  endIndex: number,
): { startLine: number; endLine: number } {
  const beforeStart = content.slice(0, startIndex);
  const beforeEnd = content.slice(0, endIndex);
  return {
    startLine: (beforeStart.match(/\n/g) || []).length + 1,
    endLine: (beforeEnd.match(/\n/g) || []).length + 1,
  };
}

/**
 * Find match using layered strategies: exact -> whitespace -> indentation -> fuzzy
 */
function findMatch(content: string, search: string): MatchResult | null {
  // Strategy 1: Exact match
  const exactIndex = content.indexOf(search);
  if (exactIndex !== -1) {
    const { startLine, endLine } = getLineNumbers(content, exactIndex, exactIndex + search.length);
    return {
      found: true,
      strategy: "exact",
      confidence: 1.0,
      matchedContent: search,
      startIndex: exactIndex,
      endIndex: exactIndex + search.length,
      startLine,
      endLine,
    };
  }

  // Strategy 2: Whitespace-insensitive
  const normalizeWs = (s: string) => s.replace(/[ \t]+/g, " ");
  const normalizedContent = normalizeWs(content);
  const normalizedSearch = normalizeWs(search);
  const wsIndex = normalizedContent.indexOf(normalizedSearch);
  if (wsIndex !== -1) {
    // Map back to original indices (simplified)
    let origStart = 0,
      normPos = 0;
    for (let i = 0; i < content.length && normPos < wsIndex; i++) {
      if (!/[ \t]/.test(content[i]) || (i > 0 && !/[ \t]/.test(content[i - 1]))) normPos++;
      origStart = i + 1;
    }
    const matchedContent = content
      .slice(origStart, origStart + search.length + 10)
      .slice(0, search.length + 10);
    const { startLine, endLine } = getLineNumbers(
      content,
      origStart,
      origStart + matchedContent.length,
    );
    return {
      found: true,
      strategy: "whitespace",
      confidence: 0.95,
      matchedContent,
      startIndex: origStart,
      endIndex: origStart + matchedContent.length,
      startLine,
      endLine,
    };
  }

  // Strategy 3: Indentation-preserving
  const stripIndent = (s: string) =>
    s
      .split("\n")
      .map((l) => l.trimStart())
      .join("\n");
  const strippedSearch = stripIndent(search);
  const contentLines = content.split("\n");
  const searchLineCount = search.split("\n").length;

  for (let i = 0; i <= contentLines.length - searchLineCount; i++) {
    const windowLines = contentLines.slice(i, i + searchLineCount);
    if (stripIndent(windowLines.join("\n")) === strippedSearch) {
      const startIndex = contentLines.slice(0, i).join("\n").length + (i > 0 ? 1 : 0);
      const matchedContent = windowLines.join("\n");
      const { startLine, endLine } = getLineNumbers(
        content,
        startIndex,
        startIndex + matchedContent.length,
      );
      return {
        found: true,
        strategy: "indentation",
        confidence: 0.9,
        matchedContent,
        startIndex,
        endIndex: startIndex + matchedContent.length,
        startLine,
        endLine,
      };
    }
  }

  // Strategy 4: Fuzzy match
  const searchLines = search.split("\n");
  let bestMatch: { startLineIndex: number; endLineIndex: number; similarity: number } | null = null;

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const windowLines = contentLines.slice(i, i + searchLines.length);
    const similarity = calculateLineSimilarity(searchLines, windowLines);
    if (similarity >= 0.8 && (!bestMatch || similarity > bestMatch.similarity)) {
      bestMatch = { startLineIndex: i, endLineIndex: i + searchLines.length, similarity };
    }
  }

  if (bestMatch) {
    const startIndex =
      contentLines.slice(0, bestMatch.startLineIndex).join("\n").length +
      (bestMatch.startLineIndex > 0 ? 1 : 0);
    const matchedContent = contentLines
      .slice(bestMatch.startLineIndex, bestMatch.endLineIndex)
      .join("\n");
    const { startLine, endLine } = getLineNumbers(
      content,
      startIndex,
      startIndex + matchedContent.length,
    );
    return {
      found: true,
      strategy: "fuzzy",
      confidence: bestMatch.similarity,
      matchedContent,
      startIndex,
      endIndex: startIndex + matchedContent.length,
      startLine,
      endLine,
    };
  }

  return null;
}

function getMatchFailure(content: string, search: string): MatchFailure {
  const searchLines = search.split("\n");
  const contentLines = content.split("\n");
  const suggestions: SuggestionMatch[] = [];

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const windowLines = contentLines.slice(i, i + searchLines.length);
    const similarity = calculateLineSimilarity(searchLines, windowLines);
    if (similarity >= 0.6) {
      suggestions.push({ content: windowLines.join("\n"), lineNumber: i + 1, similarity });
    }
  }

  suggestions.sort((a, b) => b.similarity - a.similarity);
  const topSuggestions = suggestions.slice(0, 3);

  let nearbyContext = "";
  if (topSuggestions.length > 0) {
    const lineNum = topSuggestions[0].lineNumber;
    const start = Math.max(0, lineNum - 6);
    const end = Math.min(contentLines.length, lineNum + 5);
    nearbyContext = contentLines
      .slice(start, end)
      .map((line, i) => {
        const num = start + i + 1;
        const marker = num === lineNum ? ">" : " ";
        return `${marker}${String(num).padStart(4)} | ${line}`;
      })
      .join("\n");
  }

  return { reason: "Search content not found in file", suggestions: topSuggestions, nearbyContext };
}

function formatFailure(
  filePath: string,
  search: string,
  failure: MatchFailure,
  fileContent: string,
): string {
  const lines = [
    `path=${filePath} status=failed`,
    "",
    `Error: ${failure.reason}`,
    "",
    "SEARCH CONTENT:",
    "```",
    search,
    "```",
  ];
  if (failure.suggestions.length > 0) {
    lines.push("", "SUGGESTIONS (similar content found):");
    for (const s of failure.suggestions) {
      lines.push(
        "",
        `Line ${s.lineNumber} (${Math.round(s.similarity * 100)}% similar):`,
        "```",
        s.content,
        "```",
      );
    }
    if (failure.nearbyContext) lines.push("", "CONTEXT:", failure.nearbyContext);
  }
  lines.push("", "CURRENT FILE CONTENT:", "```", fileContent, "```");
  return lines.join("\n");
}

/**
 * EditFile gadget - Edit files using search/replace with layered matching.
 *
 * Uses layered matching strategies: exact -> whitespace -> indentation -> fuzzy
 * This approach reduces edit errors by ~9x (per Aider benchmarks).
 */
export const editFile = createGadget({
  name: "EditFile",
  description: `Edit a file by searching for content and replacing it.

Uses layered matching strategies (in order):
1. Exact match - byte-for-byte comparison
2. Whitespace-insensitive - ignores differences in spaces/tabs
3. Indentation-preserving - matches structure ignoring leading whitespace
4. Fuzzy match - similarity-based matching (80% threshold)

For multiple edits to the same file, call this gadget multiple times.
Each call provides immediate feedback, allowing you to adjust subsequent edits.`,
  schema: z.object({
    filePath: z.string().describe("Path to the file to edit (relative or absolute)"),
    search: z.string().describe("The content to search for in the file"),
    replace: z.string().describe("The content to replace it with (empty string to delete)"),
  }),
  examples: [
    {
      params: {
        filePath: "src/config.ts",
        search: "const DEBUG = false;",
        replace: "const DEBUG = true;",
      },
      output:
        "path=src/config.ts status=success strategy=exact lines=5-5\n\nReplaced content successfully.\n\nUPDATED FILE CONTENT:\n```\n// config.ts\nconst DEBUG = true;\nexport default { DEBUG };\n```",
      comment: "Simple single-line edit",
    },
    {
      params: {
        filePath: "src/utils.ts",
        search: `function oldHelper() {
  return 1;
}`,
        replace: `function newHelper() {
  return 2;
}`,
      },
      output:
        "path=src/utils.ts status=success strategy=exact lines=10-12\n\nReplaced content successfully.\n\nUPDATED FILE CONTENT:\n```\n// utils.ts\nfunction newHelper() {\n  return 2;\n}\n```",
      comment: "Multi-line replacement",
    },
    {
      params: {
        filePath: "src/app.ts",
        search: "unusedImport",
        replace: "",
      },
      output:
        'path=src/app.ts status=success strategy=exact lines=3-3\n\nReplaced content successfully.\n\nUPDATED FILE CONTENT:\n```\n// app.ts\nimport { usedImport } from "./lib";\n```',
      comment: "Delete content by replacing with empty string",
    },
  ],
  timeoutMs: 30000,
  execute: ({ filePath, search, replace }) => {
    if (search.trim() === "") {
      return `path=${filePath} status=error\n\nError: Search content cannot be empty.`;
    }

    let validatedPath: string;
    try {
      validatedPath = validatePathIsWithinCwd(filePath);
    } catch (error) {
      return `path=${filePath} status=error\n\nError: ${error instanceof Error ? error.message : String(error)}`;
    }

    let content: string;
    try {
      content = readFileSync(validatedPath, "utf-8");
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        return `path=${filePath} status=error\n\nError: File not found: ${filePath}`;
      }
      return `path=${filePath} status=error\n\nError reading file: ${error instanceof Error ? error.message : String(error)}`;
    }

    const match = findMatch(content, search);
    if (!match) {
      return formatFailure(filePath, search, getMatchFailure(content, search), content);
    }

    const newContent = content.slice(0, match.startIndex) + replace + content.slice(match.endIndex);

    try {
      writeFileSync(validatedPath, newContent, "utf-8");
    } catch (error) {
      return `path=${filePath} status=error\n\nError writing file: ${error instanceof Error ? error.message : String(error)}`;
    }

    return `path=${filePath} status=success strategy=${match.strategy} lines=${match.startLine}-${match.endLine}\n\nReplaced content successfully.\n\nUPDATED FILE CONTENT:\n\`\`\`\n${newContent}\n\`\`\``;
  },
});
