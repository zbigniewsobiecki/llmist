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
 * Tracks the single in-progress (trailing) gadget while its block streams, so we
 * can emit progressive argument partials with a stable invocationId and per-field
 * deltas, then a single authoritative `gadget_call` when the block completes.
 */
interface PartialGadgetState {
  gadgetName: string;
  invocationId: string;
  dependencies: string[];
  /** fieldPath -> length of the value already emitted (drives delta + de-dup). */
  emittedFieldLengths: Map<string, number>;
  /** fieldPaths already emitted as complete (avoid re-emitting completion). */
  completedFields: Set<string>;
  /**
   * Body-relative count of bytes already scanned for markers. Lets each feed resume
   * marker scanning near the tail (with overlap) instead of re-scanning the whole
   * growing body — the difference between O(n) and O(n²) for large streamed gadgets.
   */
  bodyScannedLen: number;
  /** Body-relative offset of the in-progress field's `!!!ARG:` marker (-1 = none yet). */
  lastArgRelOffset: number;
}

/**
 * Parser for extracting gadget invocations from LLM text output.
 * Processes text chunks incrementally and emits events for text and gadget calls.
 */
export class GadgetCallParser {
  private buffer = "";
  private lastEmittedTextOffset = 0;
  /** Non-null only while a single trailing gadget block is mid-stream. */
  private currentPartial: PartialGadgetState | null = null;
  private readonly startPrefix: string;
  private readonly endPrefix: string;
  private readonly argPrefix: string;
  /** Length of the longest marker; `maxMarkerLength - 1` is the scan-resume overlap. */
  private readonly maxMarkerLength: number;

  constructor(options: StreamParserOptions = {}) {
    this.startPrefix = options.startPrefix ?? GADGET_START_PREFIX;
    this.endPrefix = options.endPrefix ?? GADGET_END_PREFIX;
    this.argPrefix = options.argPrefix ?? GADGET_ARG_PREFIX;
    this.maxMarkerLength = Math.max(
      this.startPrefix.length,
      this.endPrefix.length,
      this.argPrefix.length,
    );
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
   * - `GadgetName:my_id:dep1:dep2:dep3` - Colons treated as dep separators (LLM resilience)
   *
   * Dependencies can be comma-separated or colon-separated invocation IDs.
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
      // Also handles LLM using colons instead of commas: GadgetName:id:dep1:dep2
      const depsRaw = parts.slice(2).join(",");
      const deps = [
        ...new Set(
          depsRaw
            .split(",")
            .map((d) => d.trim())
            .filter((d) => d.length > 0),
        ),
      ];
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
      // Parse the header metadata exactly ONCE per gadget. While a gadget streams
      // across multiple feeds we reuse the cached values so the (possibly
      // auto-generated) invocationId is stable across every partial AND the final
      // gadget_call — and the global counter is not bumped on each feed.
      const { gadgetName, invocationId, dependencies } = this.currentPartial
        ? this.currentPartial
        : this.parseInvocationMetadata(headerLine);

      const contentStartIndex = metadataEndIndex + 1;

      let partEndIndex: number;
      let endMarkerLength = 0;

      // Look for end marker OR next start marker (implicit end). When a gadget is
      // mid-stream we resume the scan near the tail (backing off by one marker's
      // worth so a marker split across a chunk boundary is still found) instead of
      // re-scanning the whole growing body every feed — O(n) instead of O(n²).
      const bodySearchStart = this.currentPartial
        ? contentStartIndex +
          Math.max(0, this.currentPartial.bodyScannedLen - (this.maxMarkerLength - 1))
        : contentStartIndex;

      // Look for next gadget start (potential implicit end)
      const nextStartPos = this.buffer.indexOf(this.startPrefix, bodySearchStart);

      // Look for end marker
      const endPos = this.buffer.indexOf(this.endPrefix, bodySearchStart);

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
        // Neither end marker nor next start found yet. The gadget is still
        // streaming: surface the growing argument values as partials, then wait.
        if (!this.currentPartial) {
          this.currentPartial = this.newPartialState(gadgetName, invocationId, dependencies);
        }
        yield* this.emitArgPartials(
          this.currentPartial,
          contentStartIndex,
          this.buffer.length,
          false,
        );
        break;
      }

      // Gadget is complete. If we were streaming partials for it, flush any final
      // deltas (marking every field complete) BEFORE the authoritative gadget_call.
      const rawSlice = this.buffer.substring(contentStartIndex, partEndIndex);
      if (this.currentPartial) {
        yield* this.emitArgPartials(this.currentPartial, contentStartIndex, partEndIndex, true);
      }

      // Parse parameters according to configured format
      const parametersRaw = rawSlice.trim();
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

      // This gadget is done; the next trailing gadget (if any) re-initializes fresh.
      this.currentPartial = null;

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

  /** Create fresh partial-tracking state for a newly-started streaming gadget. */
  private newPartialState(
    gadgetName: string,
    invocationId: string,
    dependencies: string[],
  ): PartialGadgetState {
    return {
      gadgetName,
      invocationId,
      dependencies,
      emittedFieldLengths: new Map(),
      completedFields: new Set(),
      bodyScannedLen: 0,
      lastArgRelOffset: -1,
    };
  }

  /**
   * Emit per-field "growing value" partials for an in-progress (or, when
   * `allComplete`, a just-completed) gadget body delimited by [bodyStart, bodyEnd).
   *
   * Incremental by design: each call resumes the `!!!ARG:` scan near where the last
   * one stopped (backing off by one marker's worth so a marker split across a chunk
   * boundary is still found) and only re-touches the in-progress field, so a long
   * streamed body costs O(new bytes) per feed instead of O(body). Every field except
   * the in-progress (last) one is complete — a following `!!!ARG:` terminated it; the
   * last field is tentative unless `allComplete`. The tentative field holds back any
   * suffix that is a partial prefix of a gadget marker so it never leaks into a value.
   *
   * We deliberately do NOT run stripMarkdownFences here: an unbalanced opening fence
   * sits before the first `!!!ARG:` (never emitted) and the authoritative gadget_call
   * still strips fences from the full raw parameters.
   */
  private *emitArgPartials(
    state: PartialGadgetState,
    bodyStart: number,
    bodyEnd: number,
    allComplete: boolean,
  ): Generator<StreamEvent> {
    const argLen = this.argPrefix.length;

    // Resume the !!!ARG: scan near the tail, but never before the current field's own
    // marker (so the overlap re-scan can't re-finalize a field we already emitted).
    let searchAbs = bodyStart + Math.max(0, state.bodyScannedLen - (this.maxMarkerLength - 1));
    if (state.lastArgRelOffset >= 0) {
      searchAbs = Math.max(searchAbs, bodyStart + state.lastArgRelOffset + argLen);
    }

    // Walk every NEW !!!ARG: marker. Each one terminates the prior in-progress field.
    while (true) {
      const argAbs = this.buffer.indexOf(this.argPrefix, searchAbs);
      if (argAbs === -1 || argAbs >= bodyEnd) break;

      if (state.lastArgRelOffset >= 0) {
        // A following !!!ARG: proves the current field's value is final.
        yield* this.emitFieldRange(state, bodyStart + state.lastArgRelOffset, argAbs, true);
      }
      state.lastArgRelOffset = argAbs - bodyStart;
      searchAbs = argAbs + argLen;
    }

    // Emit the in-progress (last) field, value running to bodyEnd; complete only if
    // the whole gadget body is done.
    if (state.lastArgRelOffset >= 0) {
      yield* this.emitFieldRange(state, bodyStart + state.lastArgRelOffset, bodyEnd, allComplete);
    }

    state.bodyScannedLen = bodyEnd - bodyStart;
  }

  /**
   * Emit a single field whose `!!!ARG:` marker starts at `markerAbs` and whose value
   * runs to `valueEndAbs` (the next marker, or the body end). Mirrors the per-field
   * semantics of the old split-based emitter: field-path line, hold-back for a
   * tentative value, single trailing-newline strip.
   */
  private *emitFieldRange(
    state: PartialGadgetState,
    markerAbs: number,
    valueEndAbs: number,
    complete: boolean,
  ): Generator<StreamEvent> {
    const pathStart = markerAbs + this.argPrefix.length;
    const newlineAbs = this.buffer.indexOf("\n", pathStart);

    // No field-path newline within this field's range — we don't know the name yet.
    if (newlineAbs === -1 || newlineAbs >= valueEndAbs) {
      // Wait, unless the field is already complete: then surface the trimmed pointer
      // with an empty value (mirrors the old `newlineIndex === -1` branch).
      if (!complete) return;
      const pointer = this.buffer.substring(pathStart, valueEndAbs).trim();
      if (pointer) yield* this.emitFieldDelta(state, pointer, "", true);
      return;
    }

    const fieldPath = this.buffer.substring(pathStart, newlineAbs).trim();
    if (!fieldPath) return;

    let value = this.buffer.substring(newlineAbs + 1, valueEndAbs);

    if (!complete) {
      // Hold back a trailing partial marker so it never leaks into the value.
      const hold = this.trailingPartialMarkerLength(value);
      if (hold > 0) value = value.slice(0, value.length - hold);
    }

    // Strip a single trailing newline to match parseBlockParams semantics.
    if (value.endsWith("\n")) value = value.slice(0, -1);

    yield* this.emitFieldDelta(state, fieldPath, value, complete);
  }

  /**
   * Emit a single partial for a field, but only when its value grew or it newly
   * completed — keeping event volume proportional to field growth, not characters.
   */
  private *emitFieldDelta(
    state: PartialGadgetState,
    fieldPath: string,
    value: string,
    fieldComplete: boolean,
  ): Generator<StreamEvent> {
    const previousLength = state.emittedFieldLengths.get(fieldPath) ?? -1; // -1 => never emitted
    const grew = value.length > previousLength;
    const newlyComplete = fieldComplete && !state.completedFields.has(fieldPath);
    if (!grew && !newlyComplete) return;

    const delta = previousLength < 0 ? value : value.slice(Math.min(previousLength, value.length));
    state.emittedFieldLengths.set(fieldPath, value.length);
    if (fieldComplete) state.completedFields.add(fieldPath);

    yield {
      type: "gadget_args_partial",
      invocationId: state.invocationId,
      gadgetName: state.gadgetName,
      fieldPath,
      value,
      delta,
      isFieldComplete: fieldComplete,
    };
  }

  /**
   * Length of the longest suffix of `value` that is a proper prefix of any gadget
   * marker (start/end/arg). Used to hold back the beginning of an incoming marker
   * so it never appears inside a streamed value.
   */
  private trailingPartialMarkerLength(value: string): number {
    const markers = [this.startPrefix, this.endPrefix, this.argPrefix];
    const limit = Math.min(this.maxMarkerLength - 1, value.length);
    for (let len = limit; len >= 1; len--) {
      const suffix = value.slice(value.length - len);
      for (const marker of markers) {
        if (suffix.length < marker.length && marker.startsWith(suffix)) return len;
      }
    }
    return 0;
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
        // Reuse cached metadata so the invocationId matches partials already emitted.
        const { gadgetName, invocationId, dependencies } = this.currentPartial
          ? this.currentPartial
          : this.parseInvocationMetadata(headerLine);
        const contentStartIndex = metadataEndIndex + 1;

        // Everything after the newline to end of buffer is the gadget body.
        const contentRaw = this.buffer.substring(contentStartIndex);

        // Flush any final partials (all fields complete) before the gadget_call.
        if (this.currentPartial) {
          yield* this.emitArgPartials(
            this.currentPartial,
            contentStartIndex,
            this.buffer.length,
            true,
          );
        }

        const parametersRaw = contentRaw.trim();
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

        this.currentPartial = null;
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
    this.currentPartial = null;
  }
}
