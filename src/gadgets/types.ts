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
}

// Import compaction types
import type { CompactionEvent } from "../agent/compaction/config.js";

// Stream chunk with text or gadget metadata
export type StreamEvent =
  | { type: "text"; content: string }
  | { type: "gadget_call"; call: ParsedGadgetCall }
  | { type: "gadget_result"; result: GadgetExecutionResult }
  | { type: "human_input_required"; question: string; gadgetName: string; invocationId: string }
  | { type: "compaction"; event: CompactionEvent };

// Imports for text-only handlers
import type { ILogObj, Logger } from "tslog";
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
   * @example
   * ```typescript
   * execute: async ({ text }, ctx) => {
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
  llmist: CostReportingLLMist;
}
