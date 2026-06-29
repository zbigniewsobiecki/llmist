/**
 * Stream event types emitted during agent execution.
 *
 * Contains all discriminated union members for `StreamEvent`, plus
 * `StreamCompletionEvent` and `GadgetSkippedEvent`.
 *
 * @module
 */

import type { CompactionEvent } from "../agent/compaction/config.js";
import type { TokenUsage } from "../core/options.js";
import type { GadgetExecutionResult, ParsedGadgetCall } from "./execution-result-types.js";

export type { GadgetExecutionResult, ParsedGadgetCall };

/** Event emitted when a gadget is skipped due to a failed dependency */
export interface GadgetSkippedEvent {
  type: "gadget_skipped";
  gadgetName: string;
  invocationId: string;
  parameters: Record<string, unknown>;
  /** The invocation ID of the dependency that failed */
  failedDependency: string;
  /** The error message from the failed dependency */
  failedDependencyError: string;
}

/**
 * Emitted repeatedly while a gadget call is still streaming, surfacing the
 * GROWING RAW value of one argument field BEFORE the gadget block terminates.
 *
 * Use this for progressive UIs (e.g. a form field that fills in live as the
 * agent streams a long text value).
 *
 * Important semantics:
 * - Values are RAW and UNCOERCED. The authoritative, validated/coerced
 *   parameters arrive later on the single `gadget_call` event.
 * - `invocationId` is identical across every partial for a gadget AND its
 *   final `gadget_call`, so consumers can correlate them.
 * - All partials for an invocation are emitted BEFORE that invocation's
 *   `gadget_call`.
 * - Prefer `value` (replace) over `delta` (append) for correctness; `delta`
 *   is a convenience that can occasionally differ by a trailing newline.
 * - A partial does NOT guarantee the gadget will execute (it may still be
 *   skipped by `maxGadgetsPerResponse` or fail validation).
 */
export interface GadgetArgsPartialEvent {
  type: "gadget_args_partial";
  /** Stable invocation id (same on all partials + the final `gadget_call`). */
  invocationId: string;
  gadgetName: string;
  /** JSON-pointer-ish path of the field, e.g. "title", "config/timeout", "items/0". */
  fieldPath: string;
  /** Full accumulated RAW value for this field so far (one trailing newline stripped). */
  value: string;
  /** Text appended since the previous partial for this field ("" if only completion flipped). */
  delta: string;
  /** True once a later `!!!ARG:` or the terminator proves this field's value is final. */
  isFieldComplete: boolean;
}

/**
 * Event emitted when stream processing completes, containing metadata.
 * This allows the async generator to "return" metadata while still yielding events.
 */
export interface StreamCompletionEvent {
  type: "stream_complete";
  /** The reason the LLM stopped generating (e.g., "stop", "tool_use") */
  finishReason: string | null;
  /** Token usage statistics from the LLM call */
  usage?: TokenUsage;
  /** Raw response text from the LLM */
  rawResponse: string;
  /** Final message after all interceptors applied */
  finalMessage: string;
  /** Whether any gadgets were executed during this iteration */
  didExecuteGadgets: boolean;
  /** Whether to break the agent loop (e.g., TaskComplete was called) */
  shouldBreakLoop: boolean;
  /** Accumulated thinking/reasoning content from reasoning models */
  thinkingContent?: string;
}

// Stream chunk with text or gadget metadata
export type StreamEvent =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string; thinkingType: "thinking" | "redacted" }
  | { type: "gadget_call"; call: ParsedGadgetCall }
  | GadgetArgsPartialEvent
  | { type: "gadget_result"; result: GadgetExecutionResult }
  | GadgetSkippedEvent
  | { type: "human_input_required"; question: string; gadgetName: string; invocationId: string }
  | { type: "compaction"; event: CompactionEvent }
  | { type: "llm_response_end"; finishReason: string | null; usage?: TokenUsage }
  | StreamCompletionEvent;
