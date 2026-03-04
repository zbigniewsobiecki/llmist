import { readFileSync, writeFileSync } from "node:fs";
import { createGadget } from "llmist";
import { z } from "zod";
import type { MatchFailure, MatchResult } from "./editfile/index.js";
import {
  adjustIndentation,
  applyReplacement,
  findAllMatches,
  findMatch,
  formatEditContext,
  formatMultipleMatches,
  getMatchFailure,
} from "./editfile/index.js";
import { validatePathIsWithinCwd } from "./utils.js";

/**
 * EditFile gadget - Edit files using search/replace with layered matching.
 *
 * Uses layered matching strategies: exact -> whitespace -> indentation -> fuzzy
 * This approach reduces edit errors by ~9x (per Aider benchmarks).
 */

function formatFailure(
  filePath: string,
  search: string,
  failure: MatchFailure,
  fileContent: string,
): string {
  const lines: string[] = [
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
    for (const suggestion of failure.suggestions) {
      const percent = Math.round(suggestion.similarity * 100);
      lines.push(
        "",
        `Line ${suggestion.lineNumber} (${percent}% similar):`,
        "```",
        suggestion.content,
        "```",
      );
    }

    if (failure.nearbyContext) {
      lines.push("", "CONTEXT:", failure.nearbyContext);
    }
  }

  lines.push("", "CURRENT FILE CONTENT:", "```", fileContent, "```");

  return lines.join("\n");
}

export const editFile = createGadget({
  name: "EditFile",
  description: `Edit a file by searching for content and replacing it.

Uses layered matching strategies (in order):
1. Exact match - byte-for-byte comparison
2. Whitespace-insensitive - ignores differences in spaces/tabs
3. Indentation-preserving - matches structure ignoring leading whitespace
4. Fuzzy match - similarity-based matching (80% threshold)
5. DMP (diff-match-patch) - handles heavily refactored code

For multiple edits to the same file, call this gadget multiple times.
Each call provides immediate feedback, allowing you to adjust subsequent edits.

Options:
- replaceAll: Replace all occurrences instead of just the first
- expectedCount: Validate exact number of matches before applying`,
  maxConcurrent: 1, // Sequential execution to prevent race conditions
  schema: z.object({
    filePath: z.string().describe("Path to the file to edit (relative or absolute)"),
    search: z.string().describe("The content to search for in the file"),
    replace: z.string().describe("The content to replace it with (empty string to delete)"),
    replaceAll: z
      .boolean()
      .optional()
      .default(false)
      .describe("Replace all occurrences instead of just the first match"),
    expectedCount: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Expected number of matches. Edit fails if actual count differs"),
  }),
  examples: [
    {
      params: {
        filePath: "src/config.ts",
        search: "const DEBUG = false;",
        replace: "const DEBUG = true;",
        replaceAll: false,
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
        replaceAll: false,
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
        replaceAll: false,
      },
      output:
        'path=src/app.ts status=success strategy=exact lines=3-3\n\nReplaced content successfully.\n\nUPDATED FILE CONTENT:\n```\n// app.ts\nimport { usedImport } from "./lib";\n```',
      comment: "Delete content by replacing with empty string",
    },
    {
      params: {
        filePath: "src/constants.ts",
        search: "OLD_VALUE",
        replace: "NEW_VALUE",
        replaceAll: true,
      },
      output:
        "path=src/constants.ts status=success matches=3 lines=[2-2, 5-5, 8-8]\n\nReplaced 3 occurrences\n\nUPDATED FILE CONTENT:\n```\n// constants.ts\nexport const A = NEW_VALUE;\nexport const B = NEW_VALUE;\nexport const C = NEW_VALUE;\n```",
      comment: "Replace all occurrences with replaceAll=true",
    },
  ],
  timeoutMs: 30000,
  execute: ({ filePath, search, replace, replaceAll, expectedCount }) => {
    // Validate search is not empty
    if (search.trim() === "") {
      return `path=${filePath} status=error\n\nError: Search content cannot be empty.`;
    }

    // Validate and resolve path
    let validatedPath: string;
    try {
      validatedPath = validatePathIsWithinCwd(filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `path=${filePath} status=error\n\nError: ${message}`;
    }

    // Read file content
    let content: string;
    try {
      content = readFileSync(validatedPath, "utf-8");
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        return `path=${filePath} status=error\n\nError: File not found: ${filePath}`;
      }
      const message = error instanceof Error ? error.message : String(error);
      return `path=${filePath} status=error\n\nError reading file: ${message}`;
    }

    // Find all matches to detect multiple occurrences
    const allMatches = findAllMatches(content, search);

    if (allMatches.length === 0) {
      // No match found - provide helpful suggestions
      const failure = getMatchFailure(content, search);
      return formatFailure(filePath, search, failure, content);
    }

    // Validate expectedCount if provided.
    // This check happens before the ambiguous-match detection below because it's stricter:
    // if user specifies expectedCount=1 but 2 matches are found, they get the count error,
    // not the "add more context or use replaceAll" suggestion.
    if (expectedCount !== undefined && allMatches.length !== expectedCount) {
      return `path=${filePath} status=error\n\nError: Expected ${expectedCount} match(es) but found ${allMatches.length}.\n\n${formatMultipleMatches(content, allMatches)}`;
    }

    // Handle multiple matches
    if (allMatches.length > 1 && !replaceAll) {
      // Ambiguous match - require explicit replaceAll or more context
      const matchSummary = formatMultipleMatches(content, allMatches);
      return `path=${filePath} status=error\n\nError: Found ${allMatches.length} matches. Please either:\n1. Add more context to your search to make it unique\n2. Use replaceAll=true to replace all occurrences\n\n${matchSummary}`;
    }

    // Apply replacement(s)
    let newContent: string;
    let editSummary: string;

    if (replaceAll && allMatches.length > 1) {
      // Replace all matches in reverse order to preserve indices
      newContent = executeReplaceAll(content, allMatches, replace);
      // Limit displayed line ranges to prevent very long output strings
      const MAX_DISPLAYED_RANGES = 5;
      const displayMatches = allMatches.slice(0, MAX_DISPLAYED_RANGES);
      const lineRanges = displayMatches.map((m) => `${m.startLine}-${m.endLine}`).join(", ");
      const suffix =
        allMatches.length > MAX_DISPLAYED_RANGES
          ? `, +${allMatches.length - MAX_DISPLAYED_RANGES} more`
          : "";
      editSummary = `matches=${allMatches.length} lines=[${lineRanges}${suffix}]`;
    } else {
      // Single match replacement
      const match = allMatches[0];
      const finalReplace = prepareReplacement(match, replace);
      newContent = applyReplacement(content, match, finalReplace);
      editSummary = `strategy=${match.strategy} lines=${match.startLine}-${match.endLine}`;
    }

    // Write file
    try {
      writeFileSync(validatedPath, newContent, "utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `path=${filePath} status=error\n\nError writing file: ${message}`;
    }

    // Generate edit context showing before/after diff
    const diffContext =
      allMatches.length === 1
        ? formatEditContext(content, allMatches[0], prepareReplacement(allMatches[0], replace))
        : `Replaced ${allMatches.length} occurrences`;

    return `path=${filePath} status=success ${editSummary}\n\n${diffContext}\n\nUPDATED FILE CONTENT:\n\`\`\`\n${newContent}\n\`\`\``;
  },
});

/**
 * Prepare the replacement text, applying indentation adjustments if needed.
 */
function prepareReplacement(match: MatchResult, replace: string): string {
  // Apply indentation delta when using indentation strategy
  if (match.strategy === "indentation" && match.indentationDelta) {
    return adjustIndentation(replace, match.indentationDelta);
  }
  return replace;
}

/**
 * Execute replaceAll by applying replacements in reverse order.
 * This preserves indices since we modify from end to start.
 */
function executeReplaceAll(content: string, matches: MatchResult[], replace: string): string {
  // Sort matches by startIndex descending (reverse order)
  const sortedMatches = [...matches].sort((a, b) => b.startIndex - a.startIndex);

  let result = content;
  for (const match of sortedMatches) {
    const finalReplace = prepareReplacement(match, replace);
    result = applyReplacement(result, match, finalReplace);
  }

  return result;
}
