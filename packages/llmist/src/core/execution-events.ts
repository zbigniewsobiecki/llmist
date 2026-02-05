/**
 * Unified event types for the Execution Tree.
 *
 * All events carry full tree context (nodeId, parentId, depth, path).
 * No special SubagentEvent wrapper needed - subagent events are regular
 * events with depth > 0.
 *
 * @module core/execution-events
 */

import type { GadgetMediaOutput } from "../gadgets/types.js";
import type { LLMMessage } from "./messages.js";
import type { TokenUsage } from "./options.js";

// =============================================================================
// Base Event Properties
// =============================================================================

/**
 * Base properties shared by all execution events.
 * Every event carries full tree context.
 */
export interface BaseExecutionEvent {
  /** Monotonically increasing event ID */
  eventId: number;
  /** Event timestamp */
  timestamp: number;
  /** Node that emitted this event */
  nodeId: string;
  /** Parent node ID (null for root events) */
  parentId: string | null;
  /** Nesting depth (0 = root, 1 = child, etc.) */
  depth: number;
  /** Full path from root to this node */
  path: string[];
}

// =============================================================================
// LLM Call Events
// =============================================================================

/**
 * Emitted when an LLM call starts.
 */
export interface LLMCallStartEvent extends BaseExecutionEvent {
  type: "llm_call_start";
  /** Iteration number within agent loop (1-indexed) */
  iteration: number;
  /** Model identifier */
  model: string;
  /** Request messages */
  request?: LLMMessage[];
}

/**
 * Emitted for each streaming chunk from LLM.
 */
export interface LLMCallStreamEvent extends BaseExecutionEvent {
  type: "llm_call_stream";
  /** Text chunk */
  chunk: string;
}

/**
 * Emitted when the LLM finishes generating tokens (before gadget execution completes).
 *
 * This event fires when the LLM stream ends, allowing consumers to track
 * "LLM thinking time" separately from gadget execution time.
 *
 * Event order: llm_call_start → llm_response_end → llm_call_complete
 */
export interface LLMResponseEndEvent extends BaseExecutionEvent {
  type: "llm_response_end";
  /** Iteration number within agent loop */
  iteration: number;
  /** Model identifier */
  model: string;
  /** Finish reason from LLM */
  finishReason: string | null;
  /** Token usage (may be partial, final usage in llm_call_complete) */
  usage?: TokenUsage;
}

/**
 * Emitted when an LLM call completes successfully (after all gadgets finish).
 */
export interface LLMCallCompleteEvent extends BaseExecutionEvent {
  type: "llm_call_complete";
  /** Complete response text */
  response: string;
  /** Token usage */
  usage?: TokenUsage;
  /** Finish reason from LLM */
  finishReason?: string | null;
  /** Cost in USD */
  cost?: number;
  /** Accumulated thinking/reasoning content from reasoning models */
  thinkingContent?: string;
}

/**
 * Emitted when an LLM call fails.
 */
export interface LLMCallErrorEvent extends BaseExecutionEvent {
  type: "llm_call_error";
  /** The error that occurred */
  error: Error;
  /** Whether the error was recovered by a controller */
  recovered: boolean;
}

// =============================================================================
// Gadget Events
// =============================================================================

/**
 * Emitted when a gadget call is parsed from LLM output (before execution).
 */
export interface GadgetCallEvent extends BaseExecutionEvent {
  type: "gadget_call";
  /** Invocation ID */
  invocationId: string;
  /** Gadget name */
  name: string;
  /** Parameters */
  parameters: Record<string, unknown>;
  /** Dependencies (other invocation IDs) */
  dependencies: string[];
}

/**
 * Emitted when gadget execution starts.
 */
export interface GadgetStartEvent extends BaseExecutionEvent {
  type: "gadget_start";
  /** Invocation ID */
  invocationId: string;
  /** Gadget name */
  name: string;
}

/**
 * Emitted when gadget execution completes successfully.
 */
export interface GadgetCompleteEvent extends BaseExecutionEvent {
  type: "gadget_complete";
  /** Invocation ID */
  invocationId: string;
  /** Gadget name */
  name: string;
  /** Result string */
  result: string;
  /** Execution time in ms */
  executionTimeMs: number;
  /** Cost in USD */
  cost?: number;
  /** Media outputs */
  media?: GadgetMediaOutput[];
}

/**
 * Emitted when gadget execution fails.
 */
export interface GadgetErrorEvent extends BaseExecutionEvent {
  type: "gadget_error";
  /** Invocation ID */
  invocationId: string;
  /** Gadget name */
  name: string;
  /** Error message */
  error: string;
  /** Execution time in ms */
  executionTimeMs: number;
}

/**
 * Emitted when a gadget is skipped.
 */
export interface GadgetSkippedEvent extends BaseExecutionEvent {
  type: "gadget_skipped";
  /** Invocation ID */
  invocationId: string;
  /** Gadget name */
  name: string;
  /** Reason for skipping */
  reason: "dependency_failed" | "controller_skip" | "limit_exceeded";
  /** Error message (combines reason and failedDependencyError for consistency with GadgetErrorEvent) */
  error: string;
  /** Failed dependency invocation ID (if dependency_failed) */
  failedDependency?: string;
  /** Error message from failed dependency */
  failedDependencyError?: string;
}

// =============================================================================
// Text Events
// =============================================================================

/**
 * Emitted for text output from LLM (pure notification, not a tree node).
 */
export interface TextEvent extends BaseExecutionEvent {
  type: "text";
  /** Text content */
  content: string;
}

// =============================================================================
// Thinking / Reasoning Events
// =============================================================================

/**
 * Emitted when a reasoning model produces thinking content during streaming.
 * This gives consumers a dedicated event type to listen for reasoning output.
 */
export interface ThinkingEvent extends BaseExecutionEvent {
  type: "thinking";
  /** Thinking text content */
  content: string;
  /** Whether this is actual thinking or redacted content */
  thinkingType: "thinking" | "redacted";
}

// =============================================================================
// Other Events
// =============================================================================

/**
 * Emitted when context compaction occurs.
 */
export interface CompactionEvent extends BaseExecutionEvent {
  type: "compaction";
  /** Tokens before compaction */
  tokensBefore: number;
  /** Tokens after compaction */
  tokensAfter: number;
  /** Compaction strategy used */
  strategy: string;
  /** Messages removed */
  messagesRemoved: number;
}

/**
 * Emitted when human input is required.
 */
export interface HumanInputRequiredEvent extends BaseExecutionEvent {
  type: "human_input_required";
  /** Question for the user */
  question: string;
  /** Gadget name requesting input */
  gadgetName: string;
  /** Invocation ID */
  invocationId: string;
}

/**
 * Emitted when the execution stream completes.
 */
export interface StreamCompleteEvent extends BaseExecutionEvent {
  type: "stream_complete";
  /** Whether any gadgets were executed */
  didExecuteGadgets: boolean;
  /** Whether the agent loop should break */
  shouldBreakLoop: boolean;
  /** Total cost for this iteration */
  iterationCost?: number;
}

// =============================================================================
// Union Types
// =============================================================================

/**
 * All LLM-related events.
 */
export type LLMEvent =
  | LLMCallStartEvent
  | LLMCallStreamEvent
  | LLMResponseEndEvent
  | LLMCallCompleteEvent
  | LLMCallErrorEvent;

/**
 * All gadget-related events.
 */
export type GadgetEvent =
  | GadgetCallEvent
  | GadgetStartEvent
  | GadgetCompleteEvent
  | GadgetErrorEvent
  | GadgetSkippedEvent;

/**
 * Union of all execution events.
 */
export type ExecutionEvent =
  | LLMCallStartEvent
  | LLMCallStreamEvent
  | LLMResponseEndEvent
  | LLMCallCompleteEvent
  | LLMCallErrorEvent
  | GadgetCallEvent
  | GadgetStartEvent
  | GadgetCompleteEvent
  | GadgetErrorEvent
  | GadgetSkippedEvent
  | TextEvent
  | ThinkingEvent
  | CompactionEvent
  | HumanInputRequiredEvent
  | StreamCompleteEvent;

/**
 * Event type discriminator.
 */
export type ExecutionEventType = ExecutionEvent["type"] | "*";

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if an event is an LLM event.
 */
export function isLLMEvent(event: ExecutionEvent): event is LLMEvent {
  return event.type.startsWith("llm_call_");
}

/**
 * Check if an event is a gadget event.
 */
export function isGadgetEvent(event: ExecutionEvent): event is GadgetEvent {
  return event.type.startsWith("gadget_");
}

/**
 * Check if an event is from a subagent (nested execution).
 */
export function isSubagentEvent(event: ExecutionEvent): boolean {
  return event.depth > 0;
}

/**
 * Check if an event is from the root agent.
 */
export function isRootEvent(event: ExecutionEvent): boolean {
  return event.depth === 0;
}

// =============================================================================
// Event Filtering Utilities
// =============================================================================

/**
 * Filter events by depth.
 */
export function filterByDepth(events: ExecutionEvent[], depth: number): ExecutionEvent[] {
  return events.filter((e) => e.depth === depth);
}

/**
 * Filter events by parent node.
 */
export function filterByParent(events: ExecutionEvent[], parentId: string): ExecutionEvent[] {
  return events.filter((e) => e.parentId === parentId);
}

/**
 * Filter events to only root-level events.
 */
export function filterRootEvents(events: ExecutionEvent[]): ExecutionEvent[] {
  return filterByDepth(events, 0);
}

/**
 * Group events by their parent node.
 */
export function groupByParent(events: ExecutionEvent[]): Map<string | null, ExecutionEvent[]> {
  const groups = new Map<string | null, ExecutionEvent[]>();

  for (const event of events) {
    const parentId = event.parentId;
    if (!groups.has(parentId)) {
      groups.set(parentId, []);
    }
    groups.get(parentId)?.push(event);
  }

  return groups;
}
