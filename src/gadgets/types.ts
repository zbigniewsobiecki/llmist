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
