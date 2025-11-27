import * as yaml from "js-yaml";
import { GADGET_END_PREFIX, GADGET_START_PREFIX } from "../core/constants.js";
import type { StreamEvent } from "./types.js";

export type ParameterFormat = "json" | "yaml" | "auto";

/**
 * Preprocess YAML to handle common LLM output issues.
 *
 * Handles two patterns:
 * 1. Single-line values with colons: `key: value with: colon` → `key: "value with: colon"`
 * 2. Multi-line continuations where LLM writes:
 *    ```
 *    key: value ending with:
 *      - list item 1
 *      - list item 2
 *    ```
 *    Converts to proper YAML multiline:
 *    ```
 *    key: |
 *      value ending with:
 *      - list item 1
 *      - list item 2
 *    ```
 *
 * @internal Exported for testing only
 */
export function preprocessYaml(yamlStr: string): string {
  const lines = yamlStr.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Match lines like "key: value" where value isn't quoted or using pipe
    // Support keys with hyphens/underscores (e.g., my-key, my_key)
    const match = line.match(/^(\s*)([\w-]+):\s+(.+)$/);

    if (match) {
      const [, indent, key, value] = match;

      // Skip if already quoted, is a pipe/block indicator, or is a boolean/number
      if (
        value.startsWith('"') ||
        value.startsWith("'") ||
        value === "|" ||
        value === ">" ||
        value === "|-" ||
        value === ">-" ||
        value === "true" ||
        value === "false" ||
        /^-?\d+(\.\d+)?$/.test(value)
      ) {
        result.push(line);
        i++;
        continue;
      }

      // Check if this is a multi-line continuation pattern:
      // A value followed by more-indented lines starting with dash (list items)
      // or text that looks like continuation
      const keyIndentLen = indent.length;
      const continuationLines: string[] = [];
      let j = i + 1;

      // Look ahead to see if there are continuation lines
      while (j < lines.length) {
        const nextLine = lines[j];
        // Empty lines can be part of continuation
        if (nextLine.trim() === "") {
          continuationLines.push(nextLine);
          j++;
          continue;
        }

        // Check indentation - must be more indented than the key
        const nextIndentMatch = nextLine.match(/^(\s*)/);
        const nextIndentLen = nextIndentMatch ? nextIndentMatch[1].length : 0;

        // If more indented and starts with dash or looks like continuation text
        if (nextIndentLen > keyIndentLen) {
          continuationLines.push(nextLine);
          j++;
        } else {
          // Not a continuation line
          break;
        }
      }

      // If we found continuation lines, convert to pipe multiline
      if (continuationLines.length > 0 && continuationLines.some((l) => l.trim().length > 0)) {
        result.push(`${indent}${key}: |`);
        // Add the first line value as part of multiline content
        result.push(`${indent}  ${value}`);
        // Add continuation lines, adjusting indentation
        for (const contLine of continuationLines) {
          if (contLine.trim() === "") {
            result.push("");
          } else {
            // Normalize indentation: ensure all lines have at least 2-space indent from key
            const contIndentMatch = contLine.match(/^(\s*)/);
            const contIndent = contIndentMatch ? contIndentMatch[1] : "";
            const contContent = contLine.substring(contIndent.length);
            result.push(`${indent}  ${contContent}`);
          }
        }
        i = j;
        continue;
      }

      // Single-line value: quote if it contains problematic colon patterns
      if (value.includes(": ") || value.endsWith(":")) {
        const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        result.push(`${indent}${key}: "${escaped}"`);
        i++;
        continue;
      }
    }

    result.push(line);
    i++;
  }

  return result.join("\n");
}

export interface StreamParserOptions {
  startPrefix?: string;
  endPrefix?: string;
  /**
   * Format for parsing gadget parameters.
   * - 'json': Parse as JSON (more robust, recommended for complex nested data)
   * - 'yaml': Parse as YAML (backward compatible)
   * - 'auto': Try JSON first, fall back to YAML
   * @default 'json'
   */
  parameterFormat?: ParameterFormat;
}

// Global counter for generating unique invocation IDs across all parser instances
let globalInvocationCounter = 0;

/**
 * Reset the global invocation counter. Only use this in tests!
 * @internal
 */
export function resetGlobalInvocationCounter(): void {
  globalInvocationCounter = 0;
}

export class StreamParser {
  private buffer = "";
  private lastReportedTextLength = 0;
  private readonly startPrefix: string;
  private readonly endPrefix: string;
  private readonly parameterFormat: ParameterFormat;

  constructor(options: StreamParserOptions = {}) {
    this.startPrefix = options.startPrefix ?? GADGET_START_PREFIX;
    this.endPrefix = options.endPrefix ?? GADGET_END_PREFIX;
    this.parameterFormat = options.parameterFormat ?? "json";
  }

  private takeTextUntil(index: number): string | undefined {
    if (index <= this.lastReportedTextLength) {
      return undefined;
    }

    const segment = this.buffer.slice(this.lastReportedTextLength, index);
    this.lastReportedTextLength = index;

    return segment.trim().length > 0 ? segment : undefined;
  }

  /**
   * Parse gadget name, handling both old format (name:invocationId) and new format (just name).
   * For new format, generates a unique invocation ID.
   */
  private parseGadgetName(gadgetName: string): { actualName: string; invocationId: string } {
    if (gadgetName.includes(":")) {
      // Old format: gadgetName:invocationId - support for backward compatibility
      const parts = gadgetName.split(":");
      return { actualName: parts[0], invocationId: parts[1] };
    }
    // New format: just gadget name, generate unique ID
    return { actualName: gadgetName, invocationId: `gadget_${++globalInvocationCounter}` };
  }

  /**
   * Parse parameter string according to configured format
   */
  private parseParameters(raw: string): {
    parameters?: Record<string, unknown>;
    parseError?: string;
  } {
    if (this.parameterFormat === "json") {
      try {
        return { parameters: JSON.parse(raw) as Record<string, unknown> };
      } catch (error) {
        return { parseError: error instanceof Error ? error.message : "Failed to parse JSON" };
      }
    }

    if (this.parameterFormat === "yaml") {
      try {
        return { parameters: yaml.load(preprocessYaml(raw)) as Record<string, unknown> };
      } catch (error) {
        return { parseError: error instanceof Error ? error.message : "Failed to parse YAML" };
      }
    }

    // Auto-detect: try JSON first, then YAML
    try {
      return { parameters: JSON.parse(raw) as Record<string, unknown> };
    } catch {
      try {
        return { parameters: yaml.load(preprocessYaml(raw)) as Record<string, unknown> };
      } catch (error) {
        return {
          parseError: error instanceof Error ? error.message : "Failed to parse as JSON or YAML",
        };
      }
    }
  }

  // Feed a chunk of text and get parsed events
  *feed(chunk: string): Generator<StreamEvent> {
    this.buffer += chunk;

    let startIndex = 0;
    while (true) {
      // Find next gadget start marker
      const partStartIndex = this.buffer.indexOf(this.startPrefix, startIndex);
      if (partStartIndex === -1) break;

      // Yield any text before the gadget
      const textBefore = this.takeTextUntil(partStartIndex);
      if (textBefore !== undefined) {
        yield { type: "text", content: textBefore };
      }

      // Extract gadget name (no more invocation ID)
      const metadataStartIndex = partStartIndex + this.startPrefix.length;
      const metadataEndIndex = this.buffer.indexOf("\n", metadataStartIndex);
      if (metadataEndIndex === -1) break; // Wait for more data

      const gadgetName = this.buffer.substring(metadataStartIndex, metadataEndIndex).trim();
      const { actualName: actualGadgetName, invocationId } = this.parseGadgetName(gadgetName);

      const contentStartIndex = metadataEndIndex + 1;

      let partEndIndex: number;
      let endMarkerLength = 0;

      if (gadgetName.includes(":")) {
        // Old format - look for old format end marker
        const oldEndMarker = `${this.endPrefix + actualGadgetName}:${invocationId}`;
        partEndIndex = this.buffer.indexOf(oldEndMarker, contentStartIndex);
        if (partEndIndex === -1) break; // Wait for more data
        endMarkerLength = oldEndMarker.length;
      } else {
        // New format - look for end marker OR next start marker (implicit end)
        // If a next gadget starts BEFORE an end marker, use that as implicit terminator

        // Look for next gadget start (potential implicit end)
        const nextStartPos = this.buffer.indexOf(this.startPrefix, contentStartIndex);

        // Look for proper end marker
        let validEndPos = -1;
        let searchPos = contentStartIndex;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const endPos = this.buffer.indexOf(this.endPrefix, searchPos);
          if (endPos === -1) break;

          // Check if this is a standalone end marker or part of old format
          const afterEnd = this.buffer.substring(endPos + this.endPrefix.length);
          if (
            afterEnd.startsWith("\n") ||
            afterEnd.startsWith("\r") ||
            afterEnd.startsWith(this.startPrefix) ||
            afterEnd.length === 0
          ) {
            // It's a standalone end marker
            validEndPos = endPos;
            break;
          } else {
            // It might be old format, skip this one
            searchPos = endPos + this.endPrefix.length;
          }
        }

        // Decide which terminator to use:
        // - If next start comes before end marker, use next start (implicit end)
        // - Otherwise use the end marker if found
        if (nextStartPos !== -1 && (validEndPos === -1 || nextStartPos < validEndPos)) {
          // Found next gadget start before any end marker - implicit end
          partEndIndex = nextStartPos;
          endMarkerLength = 0; // Don't consume the next start marker
        } else if (validEndPos !== -1) {
          // Found proper end marker
          partEndIndex = validEndPos;
          endMarkerLength = this.endPrefix.length;
        } else {
          // Neither end marker nor next start found - wait for more data
          break;
        }
      }

      // Extract parameters
      const parametersRaw = this.buffer.substring(contentStartIndex, partEndIndex).trim();

      // Parse parameters according to configured format
      const { parameters, parseError } = this.parseParameters(parametersRaw);

      yield {
        type: "gadget_call",
        call: {
          gadgetName: actualGadgetName,
          invocationId,
          parametersYaml: parametersRaw, // Keep property name for backward compatibility
          parameters,
          parseError,
        },
      };

      // Move past this gadget
      startIndex = partEndIndex + endMarkerLength;

      this.lastReportedTextLength = startIndex;
    }

    // Keep unprocessed data in buffer
    if (startIndex > 0) {
      this.buffer = this.buffer.substring(startIndex);
      this.lastReportedTextLength = 0;
    }
  }

  // Finalize parsing and return remaining text or incomplete gadgets
  *finalize(): Generator<StreamEvent> {
    // Check if there's an incomplete gadget in the buffer
    const startIndex = this.buffer.indexOf(this.startPrefix, this.lastReportedTextLength);

    if (startIndex !== -1) {
      // There's an incomplete gadget - try to parse it
      const textBefore = this.takeTextUntil(startIndex);
      if (textBefore !== undefined) {
        yield { type: "text", content: textBefore };
      }

      // Extract gadget name
      const metadataStartIndex = startIndex + this.startPrefix.length;
      const metadataEndIndex = this.buffer.indexOf("\n", metadataStartIndex);

      if (metadataEndIndex !== -1) {
        const gadgetName = this.buffer.substring(metadataStartIndex, metadataEndIndex).trim();
        const { actualName: actualGadgetName, invocationId } = this.parseGadgetName(gadgetName);
        const contentStartIndex = metadataEndIndex + 1;

        // Extract parameters (everything after the newline to end of buffer)
        const parametersRaw = this.buffer.substring(contentStartIndex).trim();

        const { parameters, parseError } = this.parseParameters(parametersRaw);

        yield {
          type: "gadget_call",
          call: {
            gadgetName: actualGadgetName,
            invocationId,
            parametersYaml: parametersRaw,
            parameters,
            parseError,
          },
        };

        return;
      }
    }

    // No incomplete gadget - just emit remaining text
    const remainingText = this.takeTextUntil(this.buffer.length);
    if (remainingText !== undefined) {
      yield { type: "text", content: remainingText };
    }
  }

  // Reset parser state (note: global invocation counter is NOT reset to ensure unique IDs)
  reset(): void {
    this.buffer = "";
    this.lastReportedTextLength = 0;
  }
}
