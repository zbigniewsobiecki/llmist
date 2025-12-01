/**
 * Clean, world-class hooks system with clear separation of concerns.
 *
 * ## Three Distinct Categories
 *
 * ### 1. OBSERVERS (Read-Only)
 * **Purpose:** Logging, metrics, monitoring, analytics
 * **Characteristics:**
 * - Cannot modify data, only observe
 * - Run in parallel (no ordering guarantees)
 * - Errors are logged but don't crash the system
 * - Both sync and async supported
 *
 * **When to use:** When you need to track what's happening without affecting execution.
 *
 * @example
 * ```typescript
 * observers: {
 *   onLLMCallComplete: async (ctx) => {
 *     metrics.track('llm_call', { tokens: ctx.usage?.totalTokens });
 *   },
 *   onGadgetExecutionComplete: async (ctx) => {
 *     console.log(`${ctx.gadgetName} took ${ctx.executionTimeMs}ms`);
 *   }
 * }
 * ```
 *
 * ### 2. INTERCEPTORS (Synchronous Transformations)
 * **Purpose:** Transform, filter, redact, format data in-flight
 * **Characteristics:**
 * - Pure functions: input -> output (or null to suppress)
 * - Run in sequence (order matters)
 * - Effect is immediate and visible to subsequent hooks
 * - Sync only (no async)
 *
 * **When to use:** When you need to modify data as it flows through the system.
 *
 * @example
 * ```typescript
 * interceptors: {
 *   // Redact sensitive data
 *   interceptRawChunk: (chunk) =>
 *     chunk.replace(/api_key=\w+/g, 'api_key=[REDACTED]'),
 *
 *   // Suppress certain outputs
 *   interceptTextChunk: (chunk, ctx) =>
 *     chunk.includes('[INTERNAL]') ? null : chunk,
 *
 *   // Add metadata to results
 *   interceptGadgetResult: (result, ctx) =>
 *     `[${ctx.gadgetName}] ${result}`
 * }
 * ```
 *
 * ### 3. CONTROLLERS (Async Lifecycle Control)
 * **Purpose:** Control execution flow, skip operations, provide fallbacks
 * **Characteristics:**
 * - Async functions returning action objects
 * - Can skip operations or provide synthetic/fallback responses
 * - Run at specific decision points in the lifecycle
 * - Actions are validated at runtime
 *
 * **When to use:** When you need to conditionally modify behavior or recover from errors.
 *
 * @example
 * ```typescript
 * controllers: {
 *   // Skip LLM call and return cached response
 *   beforeLLMCall: async (ctx) => {
 *     const cached = cache.get(ctx.options.messages);
 *     if (cached) return { action: 'skip', syntheticResponse: cached };
 *     return { action: 'proceed' };
 *   },
 *
 *   // Recover from LLM errors
 *   afterLLMError: async (ctx) => ({
 *     action: 'recover',
 *     fallbackResponse: 'Sorry, I encountered an error. Please try again.'
 *   }),
 *
 *   // Skip expensive gadgets in certain conditions
 *   beforeGadgetExecution: async (ctx) => {
 *     if (ctx.gadgetName === 'SlowSearch' && ctx.iteration > 2) {
 *       return { action: 'skip', syntheticResult: 'Search skipped to save time' };
 *     }
 *     return { action: 'proceed' };
 *   }
 * }
 * ```
 *
 * ## Hook Execution Order
 *
 * ```
 * LLM CALL LIFECYCLE:
 * 1. onLLMCallStart (observer)
 * 2. beforeLLMCall (controller) - can skip/modify
 * 3. [LLM API Call]
 * 4. For each stream chunk:
 *    a. interceptRawChunk (interceptor)
 *    b. onStreamChunk (observer)
 *    c. Parse for gadgets
 *    d. If gadget found -> GADGET LIFECYCLE
 *    e. If text -> interceptTextChunk -> emit
 * 5. afterLLMCall (controller) - can append/modify
 * 6. interceptAssistantMessage (interceptor)
 * 7. onLLMCallComplete (observer)
 *
 * GADGET LIFECYCLE:
 * 1. interceptGadgetParameters (interceptor)
 * 2. beforeGadgetExecution (controller) - can skip
 * 3. onGadgetExecutionStart (observer)
 * 4. [Execute gadget]
 * 5. interceptGadgetResult (interceptor)
 * 6. afterGadgetExecution (controller) - can recover
 * 7. onGadgetExecutionComplete (observer)
 * ```
 *
 * @module agent/hooks
 */

import type { ILogObj, Logger } from "tslog";
import type { LLMMessage } from "../core/messages.js";
import type { LLMGenerationOptions, TokenUsage } from "../core/options.js";
import type { CompactionEvent, CompactionStats } from "./compaction/config.js";

// ============================================================================
// OBSERVERS (Read-Only, Side-Effects Only)
// ============================================================================

/**
 * Context provided when an LLM call starts.
 * Read-only observation point.
 */
export interface ObserveLLMCallContext {
  iteration: number;
  options: Readonly<LLMGenerationOptions>;
  logger: Logger<ILogObj>;
}

/**
 * Context provided when an LLM call completes successfully.
 * Read-only observation point.
 */
export interface ObserveLLMCompleteContext {
  iteration: number;
  options: Readonly<LLMGenerationOptions>;
  finishReason: string | null;
  /** Token usage including cached token counts when available */
  usage?: TokenUsage;
  /** The complete raw response text */
  rawResponse: string;
  /** The final message that will be added to history (after interceptors) */
  finalMessage: string;
  logger: Logger<ILogObj>;
}

/**
 * Context provided when an LLM call fails.
 * Read-only observation point.
 */
export interface ObserveLLMErrorContext {
  iteration: number;
  options: Readonly<LLMGenerationOptions>;
  error: Error;
  /** Whether the error was recovered by a controller */
  recovered: boolean;
  logger: Logger<ILogObj>;
}

/**
 * Context provided when a gadget execution starts.
 * Read-only observation point.
 */
export interface ObserveGadgetStartContext {
  iteration: number;
  gadgetName: string;
  invocationId: string;
  /** Parameters after controller modifications */
  parameters: Readonly<Record<string, unknown>>;
  logger: Logger<ILogObj>;
}

/**
 * Context provided when a gadget execution completes.
 * Read-only observation point.
 */
export interface ObserveGadgetCompleteContext {
  iteration: number;
  gadgetName: string;
  invocationId: string;
  parameters: Readonly<Record<string, unknown>>;
  /** Original result before interceptors */
  originalResult?: string;
  /** Final result after interceptors */
  finalResult?: string;
  error?: string;
  executionTimeMs: number;
  breaksLoop?: boolean;
  logger: Logger<ILogObj>;
}

/**
 * Context provided for each stream chunk.
 * Read-only observation point.
 */
export interface ObserveChunkContext {
  iteration: number;
  /** The raw chunk from the LLM */
  rawChunk: string;
  /** Accumulated text so far */
  accumulatedText: string;
  /** Token usage if available (providers send usage at stream start/end) */
  usage?: TokenUsage;
  logger: Logger<ILogObj>;
}

/**
 * Observers: Read-only hooks for side effects.
 * - Cannot modify data
 * - Errors are logged but don't crash the system
 * - Run in parallel (no ordering guarantees)
 */
export interface Observers {
  /** Called when an LLM call starts */
  onLLMCallStart?: (context: ObserveLLMCallContext) => void | Promise<void>;

  /** Called when an LLM call completes successfully */
  onLLMCallComplete?: (context: ObserveLLMCompleteContext) => void | Promise<void>;

  /** Called when an LLM call fails */
  onLLMCallError?: (context: ObserveLLMErrorContext) => void | Promise<void>;

  /** Called when a gadget execution starts */
  onGadgetExecutionStart?: (context: ObserveGadgetStartContext) => void | Promise<void>;

  /** Called when a gadget execution completes (success or error) */
  onGadgetExecutionComplete?: (context: ObserveGadgetCompleteContext) => void | Promise<void>;

  /** Called for each stream chunk */
  onStreamChunk?: (context: ObserveChunkContext) => void | Promise<void>;

  /** Called when context compaction occurs */
  onCompaction?: (context: ObserveCompactionContext) => void | Promise<void>;
}

/**
 * Context provided when context compaction occurs.
 * Read-only observation point.
 */
export interface ObserveCompactionContext {
  /** Agent iteration when compaction occurred */
  iteration: number;
  /** Details of the compaction event */
  event: CompactionEvent;
  /** Cumulative compaction statistics */
  stats: CompactionStats;
  /** Logger instance */
  logger: Logger<ILogObj>;
}

// ============================================================================
// INTERCEPTORS (Synchronous Transformations)
// ============================================================================

/**
 * Context for chunk interception.
 */
export interface ChunkInterceptorContext {
  iteration: number;
  accumulatedText: string;
  logger: Logger<ILogObj>;
}

/**
 * Context for message interception.
 */
export interface MessageInterceptorContext {
  iteration: number;
  /** The raw LLM response */
  rawResponse: string;
  logger: Logger<ILogObj>;
}

/**
 * Context for gadget parameter interception.
 */
export interface GadgetParameterInterceptorContext {
  iteration: number;
  gadgetName: string;
  invocationId: string;
  logger: Logger<ILogObj>;
}

/**
 * Context for gadget result interception.
 */
export interface GadgetResultInterceptorContext {
  iteration: number;
  gadgetName: string;
  invocationId: string;
  parameters: Readonly<Record<string, unknown>>;
  executionTimeMs: number;
  logger: Logger<ILogObj>;
}

/**
 * Interceptors: Synchronous transformations with predictable timing.
 * - Pure functions with clear input -> output
 * - Run in sequence (order matters)
 * - Effect is immediate (no confusion about timing)
 */
export interface Interceptors {
  /**
   * Intercept and transform raw chunks from the LLM stream.
   * Affects current stream immediately.
   *
   * @param chunk - The raw chunk text from the LLM
   * @param context - Context information including iteration and accumulated text
   * @returns Transformed chunk text, or null to suppress the chunk entirely
   */
  interceptRawChunk?: (chunk: string, context: ChunkInterceptorContext) => string | null;

  /**
   * Intercept and transform text chunks before they're displayed.
   * Affects current output immediately.
   *
   * @param chunk - The text chunk to be displayed
   * @param context - Context information including iteration and accumulated text
   * @returns Transformed chunk text, or null to suppress the chunk entirely
   */
  interceptTextChunk?: (chunk: string, context: ChunkInterceptorContext) => string | null;

  /**
   * Intercept and transform the final assistant message before it's added to conversation history.
   * This is the last chance to modify what gets stored.
   *
   * @param message - The final message text
   * @param context - Context information including raw response
   * @returns Transformed message text (cannot be suppressed)
   */
  interceptAssistantMessage?: (message: string, context: MessageInterceptorContext) => string;

  /**
   * Intercept and transform gadget parameters before execution.
   *
   * IMPORTANT: The intercepted parameters are used to update the original call object.
   * This means the modified parameters will be visible in subsequent hooks.
   *
   * @param parameters - The original parameters (readonly - create new object if modifying)
   * @param context - Context information including gadget name and invocation ID
   * @returns Modified parameters object
   */
  interceptGadgetParameters?: (
    parameters: Readonly<Record<string, unknown>>,
    context: GadgetParameterInterceptorContext,
  ) => Record<string, unknown>;

  /**
   * Intercept and transform gadget results after execution.
   * This affects what gets sent back to the LLM and stored in history.
   *
   * @param result - The gadget result text
   * @param context - Context information including parameters and execution time
   * @returns Transformed result text (cannot be suppressed)
   */
  interceptGadgetResult?: (result: string, context: GadgetResultInterceptorContext) => string;
}

// ============================================================================
// CONTROLLERS (Async Lifecycle Control)
// ============================================================================

/**
 * Context for LLM call controller.
 */
export interface LLMCallControllerContext {
  iteration: number;
  /** Maximum iterations configured for the agent */
  maxIterations: number;
  options: LLMGenerationOptions;
  logger: Logger<ILogObj>;
}

/**
 * Action returned by beforeLLMCall controller.
 */
export type BeforeLLMCallAction =
  | { action: "proceed"; modifiedOptions?: Partial<LLMGenerationOptions> }
  | { action: "skip"; syntheticResponse: string };

/**
 * Context for after LLM call controller.
 */
export interface AfterLLMCallControllerContext {
  iteration: number;
  /** Maximum iterations configured for the agent */
  maxIterations: number;
  options: Readonly<LLMGenerationOptions>;
  finishReason: string | null;
  /** Token usage including cached token counts when available */
  usage?: TokenUsage;
  /** The final message (after interceptors) that will be added to history */
  finalMessage: string;
  /** Number of gadget calls in the current response */
  gadgetCallCount: number;
  logger: Logger<ILogObj>;
}

/**
 * Action returned by afterLLMCall controller.
 */
export type AfterLLMCallAction =
  | { action: "continue" }
  | { action: "append_messages"; messages: LLMMessage[] }
  | { action: "modify_and_continue"; modifiedMessage: string }
  | { action: "append_and_modify"; modifiedMessage: string; messages: LLMMessage[] };

/**
 * Context for LLM error controller.
 */
export interface LLMErrorControllerContext {
  iteration: number;
  options: Readonly<LLMGenerationOptions>;
  error: Error;
  logger: Logger<ILogObj>;
}

/**
 * Action returned by LLM error controller.
 */
export type AfterLLMErrorAction =
  | { action: "rethrow" }
  | { action: "recover"; fallbackResponse: string };

/**
 * Context for gadget execution controller.
 */
export interface GadgetExecutionControllerContext {
  iteration: number;
  gadgetName: string;
  invocationId: string;
  /** Parameters after interceptors have run */
  parameters: Record<string, unknown>;
  logger: Logger<ILogObj>;
}

/**
 * Action returned by beforeGadgetExecution controller.
 */
export type BeforeGadgetExecutionAction =
  | { action: "proceed" }
  | { action: "skip"; syntheticResult: string };

/**
 * Context for after gadget execution controller.
 */
export interface AfterGadgetExecutionControllerContext {
  iteration: number;
  gadgetName: string;
  invocationId: string;
  parameters: Readonly<Record<string, unknown>>;
  /** Result after interceptors (if successful) */
  result?: string;
  error?: string;
  executionTimeMs: number;
  logger: Logger<ILogObj>;
}

/**
 * Action returned by afterGadgetExecution controller.
 */
export type AfterGadgetExecutionAction =
  | { action: "continue" }
  | { action: "recover"; fallbackResult: string };

/**
 * Controllers: Async lifecycle hooks that control execution flow.
 * - Can short-circuit execution
 * - Can modify options and provide fallbacks
 * - Run at specific lifecycle points
 */
export interface Controllers {
  /**
   * Called before making an LLM API call.
   * Can modify options or skip the call entirely.
   */
  beforeLLMCall?: (context: LLMCallControllerContext) => Promise<BeforeLLMCallAction>;

  /**
   * Called after a successful LLM call (after interceptors have run).
   * Can append messages to conversation or modify the final message.
   */
  afterLLMCall?: (context: AfterLLMCallControllerContext) => Promise<AfterLLMCallAction>;

  /**
   * Called after an LLM call fails.
   * Can provide a fallback response to recover from the error.
   */
  afterLLMError?: (context: LLMErrorControllerContext) => Promise<AfterLLMErrorAction>;

  /**
   * Called before executing a gadget (after interceptors have run).
   * Can skip execution and provide a synthetic result.
   */
  beforeGadgetExecution?: (
    context: GadgetExecutionControllerContext,
  ) => Promise<BeforeGadgetExecutionAction>;

  /**
   * Called after a gadget execution (success or error).
   * Can provide a fallback result to recover from errors.
   */
  afterGadgetExecution?: (
    context: AfterGadgetExecutionControllerContext,
  ) => Promise<AfterGadgetExecutionAction>;
}

// ============================================================================
// MAIN HOOKS INTERFACE
// ============================================================================

/**
 * Clean hooks system with three distinct categories:
 * - Observers: Read-only, for logging and metrics
 * - Interceptors: Synchronous transformations with immediate effect
 * - Controllers: Async lifecycle control with short-circuit capability
 */
export interface AgentHooks {
  /** Read-only observation hooks for logging, metrics, etc. */
  observers?: Observers;

  /** Synchronous transformation hooks that affect current execution */
  interceptors?: Interceptors;

  /** Async lifecycle control hooks */
  controllers?: Controllers;
}
