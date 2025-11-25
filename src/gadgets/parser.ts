import * as yaml from "js-yaml";
import { GADGET_END_PREFIX, GADGET_START_PREFIX } from "../core/constants.js";
import type { StreamEvent } from "./types.js";

export type ParameterFormat = "json" | "yaml" | "auto";

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
        return { parameters: yaml.load(raw) as Record<string, unknown> };
      } catch (error) {
        return { parseError: error instanceof Error ? error.message : "Failed to parse YAML" };
      }
    }

    // Auto-detect: try JSON first, then YAML
    try {
      return { parameters: JSON.parse(raw) as Record<string, unknown> };
    } catch {
      try {
        return { parameters: yaml.load(raw) as Record<string, unknown> };
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

      // Check if this is old format (contains colon for invocation ID)
      let invocationId: string;
      let actualGadgetName: string;

      if (gadgetName.includes(":")) {
        // Old format: gadgetName:invocationId - support for backward compatibility
        const parts = gadgetName.split(":");
        actualGadgetName = parts[0];
        invocationId = parts[1];
      } else {
        // New format: just gadget name
        actualGadgetName = gadgetName;
        invocationId = `gadget_${++globalInvocationCounter}`;
      }

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
        // New format - look for simple end marker
        // But we need to ensure it's not part of an old format marker
        partEndIndex = contentStartIndex;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const endPos = this.buffer.indexOf(this.endPrefix, partEndIndex);
          if (endPos === -1) {
            partEndIndex = -1;
            break;
          }

          // Check if this is a standalone end marker or part of old format
          const afterEnd = this.buffer.substring(endPos + this.endPrefix.length);
          if (
            afterEnd.startsWith("\n") ||
            afterEnd.startsWith("\r") ||
            afterEnd.startsWith(this.startPrefix) ||
            afterEnd.length === 0
          ) {
            // It's a standalone end marker
            partEndIndex = endPos;
            endMarkerLength = this.endPrefix.length;
            break;
          } else {
            // It might be old format, skip this one
            partEndIndex = endPos + this.endPrefix.length;
          }
        }

        if (partEndIndex === -1) break; // Wait for more data
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

  // Finalize parsing and return remaining text
  *finalize(): Generator<StreamEvent> {
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
