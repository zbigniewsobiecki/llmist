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
  | { type: "gadget_result"; result: GadgetExecutionResult }
  | GadgetSkippedEvent
  | { type: "human_input_required"; question: string; gadgetName: string; invocationId: string }
  | { type: "compaction"; event: CompactionEvent }
  | { type: "llm_response_end"; finishReason: string | null; usage?: TokenUsage }
  | StreamCompletionEvent;
