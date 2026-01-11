import { GADGET_ARG_PREFIX, GADGET_END_PREFIX, GADGET_START_PREFIX } from "../core/constants.js";
import { parseBlockParams } from "./block-params.js";
import type { StreamEvent } from "./types.js";

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

/**
 * Parser for extracting gadget invocations from LLM text output.
 * Processes text chunks incrementally and emits events for text and gadget calls.
 */
export class GadgetCallParser {
  private buffer = "";
  private lastEmittedTextOffset = 0;
  private readonly startPrefix: string;
  private readonly endPrefix: string;
  private readonly argPrefix: string;

  constructor(options: StreamParserOptions = {}) {
    this.startPrefix = options.startPrefix ?? GADGET_START_PREFIX;
    this.endPrefix = options.endPrefix ?? GADGET_END_PREFIX;
    this.argPrefix = options.argPrefix ?? GADGET_ARG_PREFIX;
  }

  /**
   * Extract and consume text up to the given index.
   * Returns undefined if no meaningful text to emit.
   */
  private extractTextSegment(index: number): string | undefined {
    if (index <= this.lastEmittedTextOffset) {
      return undefined;
    }

    const segment = this.buffer.slice(this.lastEmittedTextOffset, index);
    this.lastEmittedTextOffset = index;

    return segment.trim().length > 0 ? segment : undefined;
  }

  /**
   * Parse gadget invocation metadata from the header line.
   *
   * Supported formats:
   * - `GadgetName` - Auto-generate ID, no dependencies
   * - `GadgetName:my_id` - Explicit ID, no dependencies
   * - `GadgetName:my_id:dep1,dep2` - Explicit ID with dependencies
   *
   * Dependencies must be comma-separated invocation IDs.
   */
  private parseInvocationMetadata(headerLine: string): {
    gadgetName: string;
    invocationId: string;
    dependencies: string[];
  } {
    const parts = headerLine.split(":");

    if (parts.length === 1) {
      // Just name: GadgetName
      return {
        gadgetName: parts[0],
        invocationId: `gadget_${++globalInvocationCounter}`,
        dependencies: [],
      };
    } else if (parts.length === 2) {
      // Name + ID: GadgetName:calc_1
      return {
        gadgetName: parts[0],
        invocationId: parts[1].trim(),
        dependencies: [],
      };
    } else {
      // Name + ID + deps: GadgetName:calc_1:dep1,dep2
      const deps = parts[2]
        .split(",")
        .map((d) => d.trim())
        .filter((d) => d.length > 0);
      return {
        gadgetName: parts[0],
        invocationId: parts[1].trim(),
        dependencies: deps,
      };
    }
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
      const textBefore = this.extractTextSegment(partStartIndex);
      if (textBefore !== undefined) {
        yield { type: "text", content: textBefore };
      }

      // Extract gadget metadata from header line
      const metadataStartIndex = partStartIndex + this.startPrefix.length;
      const metadataEndIndex = this.buffer.indexOf("\n", metadataStartIndex);
      if (metadataEndIndex === -1) break; // Wait for more data

      const headerLine = this.buffer.substring(metadataStartIndex, metadataEndIndex).trim();
      const { gadgetName, invocationId, dependencies } = this.parseInvocationMetadata(headerLine);

      const contentStartIndex = metadataEndIndex + 1;

      let partEndIndex: number;
      let endMarkerLength = 0;

      // Look for end marker OR next start marker (implicit end)
      // If a next gadget starts BEFORE an end marker, use that as implicit terminator

      // Look for next gadget start (potential implicit end)
      const nextStartPos = this.buffer.indexOf(this.startPrefix, contentStartIndex);

      // Look for end marker
      const endPos = this.buffer.indexOf(this.endPrefix, contentStartIndex);

      // Decide which terminator to use:
      // - If next start comes before end marker, use next start (implicit end)
      // - Otherwise use the end marker if found
      if (nextStartPos !== -1 && (endPos === -1 || nextStartPos < endPos)) {
        // Found next gadget start before any end marker - implicit end
        partEndIndex = nextStartPos;
        endMarkerLength = 0; // Don't consume the next start marker
      } else if (endPos !== -1) {
        // Found proper end marker
        partEndIndex = endPos;
        endMarkerLength = this.endPrefix.length;
      } else {
        // Neither end marker nor next start found - wait for more data
        break;
      }

      // Extract parameters
      const parametersRaw = this.buffer.substring(contentStartIndex, partEndIndex).trim();

      // Parse parameters according to configured format
      const { parameters, parseError } = this.parseParameters(parametersRaw);

      yield {
        type: "gadget_call",
        call: {
          gadgetName,
          invocationId,
          parametersRaw,
          parameters,
          parseError,
          dependencies,
        },
      };

      // Move past this gadget
      startIndex = partEndIndex + endMarkerLength;

      this.lastEmittedTextOffset = startIndex;
    }

    // Keep unprocessed data in buffer
    if (startIndex > 0) {
      this.buffer = this.buffer.substring(startIndex);
      this.lastEmittedTextOffset = 0;
    }
  }

  // Finalize parsing and return remaining text or incomplete gadgets
  *finalize(): Generator<StreamEvent> {
    // Check if there's an incomplete gadget in the buffer
    const startIndex = this.buffer.indexOf(this.startPrefix, this.lastEmittedTextOffset);

    if (startIndex !== -1) {
      // There's an incomplete gadget - try to parse it
      const textBefore = this.extractTextSegment(startIndex);
      if (textBefore !== undefined) {
        yield { type: "text", content: textBefore };
      }

      // Extract gadget metadata from header line
      const metadataStartIndex = startIndex + this.startPrefix.length;
      const metadataEndIndex = this.buffer.indexOf("\n", metadataStartIndex);

      if (metadataEndIndex !== -1) {
        const headerLine = this.buffer.substring(metadataStartIndex, metadataEndIndex).trim();
        const { gadgetName, invocationId, dependencies } = this.parseInvocationMetadata(headerLine);
        const contentStartIndex = metadataEndIndex + 1;

        // Extract parameters (everything after the newline to end of buffer)
        const parametersRaw = this.buffer.substring(contentStartIndex).trim();

        const { parameters, parseError } = this.parseParameters(parametersRaw);

        yield {
          type: "gadget_call",
          call: {
            gadgetName,
            invocationId,
            parametersRaw: parametersRaw,
            parameters,
            parseError,
            dependencies,
          },
        };

        return;
      }
    }

    // No incomplete gadget - just emit remaining text
    const remainingText = this.extractTextSegment(this.buffer.length);
    if (remainingText !== undefined) {
      yield { type: "text", content: remainingText };
    }
  }

  // Reset parser state (note: global invocation counter is NOT reset to ensure unique IDs)
  reset(): void {
    this.buffer = "";
    this.lastEmittedTextOffset = 0;
  }
}
