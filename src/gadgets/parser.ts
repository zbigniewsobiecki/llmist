import { GADGET_ARG_PREFIX, GADGET_END_PREFIX, GADGET_START_PREFIX } from "../core/constants.js";
import type { StreamEvent } from "./types.js";
import { parseBlockParams } from "./block-params.js";

export type ParameterFormat = "block";


/**
 * Strip markdown code fences from parameter content.
 * LLMs sometimes wrap their parameters in ```toml, ```yaml, ```json, or plain ``` blocks.
 * This function removes those fences to allow successful parsing.
 *
 * @internal Exported for testing only
 */
export function stripMarkdownFences(content: string): string {
  let cleaned = content.trim();

  // Pattern: ```toml, ```yaml, ```json, or just ``` at start (case-insensitive)
  const openingFence = /^```(?:toml|yaml|json)?\s*\n/i;
  // Pattern: ``` at end (with optional preceding newline)
  const closingFence = /\n?```\s*$/;

  // Strip opening fence if present
  cleaned = cleaned.replace(openingFence, "");
  // Strip closing fence if present
  cleaned = cleaned.replace(closingFence, "");

  return cleaned.trim();
}

export interface StreamParserOptions {
  startPrefix?: string;
  endPrefix?: string;
  /** Prefix for block format arguments. Default: "!!!ARG:" */
  argPrefix?: string;
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
  private readonly argPrefix: string;

  constructor(options: StreamParserOptions = {}) {
    this.startPrefix = options.startPrefix ?? GADGET_START_PREFIX;
    this.endPrefix = options.endPrefix ?? GADGET_END_PREFIX;
    this.argPrefix = options.argPrefix ?? GADGET_ARG_PREFIX;
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
   * Extract the error message from a parse error.
   * Preserves full message since the error formatter adds contextual help
   * that benefits from precise, detailed error information.
   */
  private extractParseError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Parse parameter string using block format
   */
  private parseParameters(raw: string): {
    parameters?: Record<string, unknown>;
    parseError?: string;
  } {
    // Strip markdown code fences if LLM wrapped the parameters
    const cleaned = stripMarkdownFences(raw);

    try {
      return { parameters: parseBlockParams(cleaned, { argPrefix: this.argPrefix }) };
    } catch (error) {
      return { parseError: this.extractParseError(error) };
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
          parametersRaw,
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
            parametersRaw: parametersRaw,
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
