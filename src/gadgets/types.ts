/**
 * Example of gadget usage to help LLMs understand proper invocation.
 *
 * Examples are rendered alongside the schema in `getInstruction()` to provide
 * concrete usage patterns for the LLM.
 *
 * @template TParams - Inferred parameter type from Zod schema (defaults to Record<string, unknown>)
 *
 * @example
 * ```typescript
 * const calculator = createGadget({
 *   schema: z.object({ a: z.number(), b: z.number() }),
 *   examples: [
 *     { params: { a: 5, b: 3 }, output: "8", comment: "Addition example" }
 *   ],
 *   // ...
 * });
 * ```
 */
export interface GadgetExample<TParams = Record<string, unknown>> {
  /** Example parameter values (typed to match schema) */
  params: TParams;

  /** Optional expected output/result string */
  output?: string;

  /** Optional description explaining what this example demonstrates */
  comment?: string;
}

// Result of gadget execution
export interface GadgetExecutionResult {
  gadgetName: string;
  invocationId: string; // Still required in results for tracking
  parameters: Record<string, unknown>;
  result?: string;
  error?: string;
  executionTimeMs: number;
  breaksLoop?: boolean;
  /** Cost of gadget execution in USD. Defaults to 0 if not provided by gadget. */
  cost?: number;
  /** If this gadget was skipped due to a failed dependency, the invocation ID of that dependency. */
  skippedDueToFailedDependency?: string;
}

/**
 * Result returned by gadget execute() method.
 * Can be a simple string or an object with result and optional cost.
 *
 * @example
 * ```typescript
 * // Simple string return (free gadget)
 * execute: () => "result"
 *
 * // Object return with cost
 * execute: () => ({ result: "data", cost: 0.001 })
 * ```
 */
export interface GadgetExecuteResult {
  /** The execution result as a string */
  result: string;
  /** Optional cost in USD (e.g., 0.001 for $0.001) */
  cost?: number;
}

/**
 * Union type for backwards-compatible execute() return type.
 * Gadgets can return either a string (legacy, cost = 0) or
 * an object with result and optional cost.
 */
export type GadgetExecuteReturn = string | GadgetExecuteResult

// Parsed gadget call from LLM stream
export interface ParsedGadgetCall {
  gadgetName: string;
  invocationId: string; // Auto-generated internally if not provided
  parametersRaw: string;
  parameters?: Record<string, unknown>;
  parseError?: string;
  /** List of invocation IDs this gadget depends on. Empty array if no dependencies. */
  dependencies: string[];
}

// Import compaction types
import type { CompactionEvent } from "../agent/compaction/config.js";

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

// Stream chunk with text or gadget metadata
export type StreamEvent =
  | { type: "text"; content: string }
  | { type: "gadget_call"; call: ParsedGadgetCall }
  | { type: "gadget_result"; result: GadgetExecutionResult }
  | GadgetSkippedEvent
  | { type: "human_input_required"; question: string; gadgetName: string; invocationId: string }
  | { type: "compaction"; event: CompactionEvent };

// Imports for text-only handlers
import type { ILogObj, Logger } from "tslog";
import type {
  ImageGenerationOptions,
  ImageGenerationResult,
  SpeechGenerationOptions,
  SpeechGenerationResult,
} from "../core/media-types.js";
import type { LLMMessage } from "../core/messages.js";
import type { ModelRegistry } from "../core/model-registry.js";
import type { LLMGenerationOptions, LLMStream } from "../core/options.js";
import type { QuickOptions } from "../core/quick-methods.js";

// Text-only response handler types
export type TextOnlyHandler =
  | TextOnlyStrategy // Simple string strategies
  | TextOnlyGadgetConfig // Trigger a gadget
  | TextOnlyCustomHandler; // Custom handler function

/**
 * Simple strategies for common cases
 * - 'terminate': End the loop (default behavior)
 * - 'acknowledge': Continue to next iteration
 * - 'wait_for_input': Request human input
 */
export type TextOnlyStrategy = "terminate" | "acknowledge" | "wait_for_input";

/**
 * Configuration for triggering a gadget when receiving text-only response
 */
export interface TextOnlyGadgetConfig {
  type: "gadget";
  name: string;
  /**
   * Optional function to map text to gadget parameters.
   * If not provided, text will be passed as { text: string }
   */
  parameterMapping?: (text: string) => Record<string, unknown>;
}

/**
 * Custom handler for complex text-only response scenarios
 */
export interface TextOnlyCustomHandler {
  type: "custom";
  handler: (context: TextOnlyContext) => Promise<TextOnlyAction> | TextOnlyAction;
}

/**
 * Context provided to custom text-only handlers
 */
export interface TextOnlyContext {
  /** The complete text response from the LLM */
  text: string;
  /** Current iteration number */
  iteration: number;
  /** Full conversation history */
  conversation: LLMMessage[];
  /** Logger instance */
  logger: Logger<ILogObj>;
}

/**
 * Actions that can be returned by text-only handlers
 */
export type TextOnlyAction =
  | { action: "continue" }
  | { action: "terminate" }
  | { action: "wait_for_input"; question?: string }
  | { action: "trigger_gadget"; name: string; parameters: Record<string, unknown> };

// =============================================================================
// Execution Context for Gadgets
// =============================================================================

/**
 * LLMist client interface for use within gadgets.
 *
 * Provides LLM completion methods that automatically report costs
 * via the execution context. All LLM calls made through this client
 * will have their costs tracked and included in the gadget's total cost.
 *
 * @example
 * ```typescript
 * execute: async ({ text }, ctx) => {
 *   // LLM costs are automatically reported
 *   const summary = await ctx.llmist.complete('Summarize: ' + text, {
 *     model: 'haiku',
 *   });
 *   return summary;
 * }
 * ```
 */
/**
 * Image generation namespace with automatic cost reporting.
 */
export interface CostReportingImageNamespace {
  /**
   * Generate images from a text prompt.
   * Costs are automatically reported to the execution context.
   */
  generate(options: ImageGenerationOptions): Promise<ImageGenerationResult>;
}

/**
 * Speech generation namespace with automatic cost reporting.
 */
export interface CostReportingSpeechNamespace {
  /**
   * Generate speech audio from text.
   * Costs are automatically reported to the execution context.
   */
  generate(options: SpeechGenerationOptions): Promise<SpeechGenerationResult>;
}

export interface CostReportingLLMist {
  /**
   * Quick completion - returns final text response.
   * Costs are automatically reported to the execution context.
   */
  complete(prompt: string, options?: QuickOptions): Promise<string>;

  /**
   * Quick streaming - returns async generator of text chunks.
   * Costs are automatically reported when the stream completes.
   */
  streamText(prompt: string, options?: QuickOptions): AsyncGenerator<string>;

  /**
   * Low-level stream access for full control.
   * Costs are automatically reported based on usage metadata in chunks.
   */
  stream(options: LLMGenerationOptions): LLMStream;

  /**
   * Access to model registry for cost estimation.
   */
  readonly modelRegistry: ModelRegistry;

  /**
   * Image generation with automatic cost reporting.
   * Costs are reported based on model and generation parameters.
   */
  readonly image: CostReportingImageNamespace;

  /**
   * Speech generation with automatic cost reporting.
   * Costs are reported based on input length and model pricing.
   */
  readonly speech: CostReportingSpeechNamespace;
}

/**
 * Execution context provided to gadgets during execution.
 *
 * Contains utilities for cost reporting and LLM access.
 * This parameter is optional for backwards compatibility -
 * existing gadgets without the context parameter continue to work.
 *
 * @example
 * ```typescript
 * // Using reportCost() for manual cost reporting
 * const apiGadget = createGadget({
 *   description: 'Calls external API',
 *   schema: z.object({ query: z.string() }),
 *   execute: async ({ query }, ctx) => {
 *     const result = await callExternalAPI(query);
 *     ctx.reportCost(0.001); // Report $0.001 cost
 *     return result;
 *   },
 * });
 *
 * // Using ctx.llmist for automatic LLM cost tracking
 * const summarizer = createGadget({
 *   description: 'Summarizes text using LLM',
 *   schema: z.object({ text: z.string() }),
 *   execute: async ({ text }, ctx) => {
 *     // LLM costs are automatically reported!
 *     return ctx.llmist.complete('Summarize: ' + text);
 *   },
 * });
 * ```
 */
export interface ExecutionContext {
  /**
   * Report a cost incurred during gadget execution.
   *
   * Costs are accumulated and added to the gadget's total cost.
   * Can be called multiple times during execution.
   * This is summed with any cost returned from the execute() method
   * and any costs from ctx.llmist calls.
   *
   * @param amount - Cost in USD (e.g., 0.001 for $0.001)
   *
   * @example
   * ```typescript
   * execute: async (params, ctx) => {
   *   await callExternalAPI(params.query);
   *   ctx.reportCost(0.001); // $0.001 per API call
   *
   *   await callAnotherAPI(params.data);
   *   ctx.reportCost(0.002); // Can be called multiple times
   *
   *   return 'done';
   *   // Total cost: $0.003
   * }
   * ```
   */
  reportCost(amount: number): void;

  /**
   * Pre-configured LLMist client that automatically reports LLM costs
   * as gadget costs via the reportCost() callback.
   *
   * All LLM calls made through this client will have their costs
   * automatically tracked and included in the gadget's total cost.
   *
   * This property is optional - it will be `undefined` if:
   * - The gadget is executed via CLI `gadget run` command
   * - The gadget is tested directly without agent context
   * - No LLMist client was provided to the executor
   *
   * Always check for availability before use: `ctx.llmist?.complete(...)`
   *
   * @example
   * ```typescript
   * execute: async ({ text }, ctx) => {
   *   // Check if llmist is available
   *   if (!ctx.llmist) {
   *     return 'LLM not available in this context';
   *   }
   *
   *   // LLM costs are automatically reported
   *   const summary = await ctx.llmist.complete('Summarize: ' + text, {
   *     model: 'haiku',
   *   });
   *
   *   // Additional manual costs can still be reported
   *   ctx.reportCost(0.0001); // Processing overhead
   *
   *   return summary;
   * }
   * ```
   */
  llmist?: CostReportingLLMist;

  /**
   * Abort signal for cancellation support.
   *
   * When a gadget times out, this signal is aborted before the TimeoutException
   * is thrown. Gadgets can use this to clean up resources (close browsers,
   * cancel HTTP requests, etc.) when execution is cancelled.
   *
   * The signal is always provided (never undefined) to simplify gadget code.
   *
   * @example
   * ```typescript
   * // Check for abort at key checkpoints
   * execute: async (params, ctx) => {
   *   if (ctx.signal.aborted) return 'Aborted';
   *
   *   await doExpensiveWork();
   *
   *   if (ctx.signal.aborted) return 'Aborted';
   *   return result;
   * }
   *
   * // Register cleanup handlers
   * execute: async (params, ctx) => {
   *   const browser = await chromium.launch();
   *   ctx.signal.addEventListener('abort', () => browser.close(), { once: true });
   *   // ... use browser
   * }
   *
   * // Pass to fetch for automatic cancellation
   * execute: async ({ url }, ctx) => {
   *   const response = await fetch(url, { signal: ctx.signal });
   *   return await response.text();
   * }
   * ```
   */
  signal: AbortSignal;
}
