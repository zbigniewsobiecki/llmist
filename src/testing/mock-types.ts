import type { LLMMessage } from "../core/messages.js";
import type { LLMGenerationOptions } from "../core/options.js";

/**
 * Context provided to matcher functions to determine if a mock should be used.
 */
export interface MockMatcherContext {
  /** The model descriptor (e.g., "openai:gpt-5") */
  model: string;
  /** The provider ID extracted from the model */
  provider: string;
  /** The model name without provider prefix */
  modelName: string;
  /** The complete LLM generation options */
  options: LLMGenerationOptions;
  /** The messages being sent to the LLM */
  messages: LLMMessage[];
}

/**
 * Matcher function that determines if a mock should be used for an LLM call.
 *
 * @param context - The context of the LLM call
 * @returns true if this mock should be used, false otherwise
 *
 * @example
 * // Match any call to GPT-5
 * const matcher: MockMatcher = (ctx) => ctx.modelName.includes('gpt-5');
 *
 * @example
 * // Match calls with specific message content
 * const matcher: MockMatcher = (ctx) => {
 *   const lastMessage = ctx.messages[ctx.messages.length - 1];
 *   return lastMessage?.content?.includes('calculate');
 * };
 *
 * @example
 * // Match by provider
 * const matcher: MockMatcher = (ctx) => ctx.provider === 'anthropic';
 */
export type MockMatcher = (context: MockMatcherContext) => boolean | Promise<boolean>;

/**
 * A mock response that will be returned when a matcher succeeds.
 */
export interface MockResponse {
  /**
   * Plain text content to return (will be streamed as text chunks)
   * Can include gadget markers like \n<GADGET_name>...</GADGET_END>
   */
  text?: string;

  /**
   * Pre-parsed gadget calls to inject into the response stream
   * These will be emitted as gadget_call events
   */
  gadgetCalls?: Array<{
    gadgetName: string;
    parameters: Record<string, unknown>;
    /** Optional invocationId, will be auto-generated if not provided */
    invocationId?: string;
  }>;

  /**
   * Simulated token usage statistics
   */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };

  /**
   * Simulated finish reason
   */
  finishReason?: string;

  /**
   * Delay in milliseconds before starting to stream the response
   * Useful for simulating network latency
   */
  delayMs?: number;

  /**
   * Delay in milliseconds between each chunk when streaming
   * Useful for simulating realistic streaming behavior
   */
  streamDelayMs?: number;
}

/**
 * A registered mock configuration combining a matcher with a response.
 */
export interface MockRegistration {
  /** Unique identifier for this mock (auto-generated if not provided) */
  id: string;
  /** The matcher function to determine if this mock applies */
  matcher: MockMatcher;
  /** The response to return when matched */
  response: MockResponse | ((context: MockMatcherContext) => MockResponse | Promise<MockResponse>);
  /** Optional label for debugging */
  label?: string;
  /** If true, this mock will only be used once then automatically removed */
  once?: boolean;
}

/**
 * Statistics about mock usage.
 */
export interface MockStats {
  /** Number of times this mock was matched and used */
  matchCount: number;
  /** Last time this mock was used */
  lastUsed?: Date;
}

/**
 * Options for configuring the mock system.
 */
export interface MockOptions {
  /**
   * If true, throws an error when no mock matches an LLM call.
   * If false, logs a warning and returns an empty response.
   * Default: false
   */
  strictMode?: boolean;

  /**
   * If true, logs detailed information about mock matching and execution.
   * Default: false
   */
  debug?: boolean;

  /**
   * If true, records statistics about mock usage.
   * Default: true
   */
  recordStats?: boolean;
}
