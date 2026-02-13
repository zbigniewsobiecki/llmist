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

// =============================================================================
// Media Output Types (for gadgets returning images, audio, video, files)
// =============================================================================

/**
 * Supported media types for gadget output.
 * Extensible via union - add new types as needed.
 */
export type MediaKind = "image" | "audio" | "video" | "file";

/**
 * Type-specific metadata for media outputs.
 * Extensible via index signature for future media types.
 */
export interface MediaMetadata {
  /** Width in pixels (images, video) */
  width?: number;
  /** Height in pixels (images, video) */
  height?: number;
  /** Duration in milliseconds (audio, video) */
  durationMs?: number;
  /** Allow additional metadata for future extensions */
  [key: string]: unknown;
}

/**
 * Media output from a gadget execution.
 * Supports images, audio, video, and arbitrary files.
 *
 * @example
 * ```typescript
 * // Image output
 * const imageOutput: GadgetMediaOutput = {
 *   kind: "image",
 *   data: base64EncodedPng,
 *   mimeType: "image/png",
 *   description: "Screenshot of webpage",
 *   metadata: { width: 1920, height: 1080 }
 * };
 * ```
 */
export interface GadgetMediaOutput {
  /** Type of media (discriminator for type-specific handling) */
  kind: MediaKind;
  /** Base64-encoded media data */
  data: string;
  /** Full MIME type (e.g., "image/png", "audio/mp3", "video/mp4") */
  mimeType: string;
  /** Human-readable description of the media */
  description?: string;
  /** Type-specific metadata */
  metadata?: MediaMetadata;
  /** Optional filename to use when saving (if not provided, auto-generated) */
  fileName?: string;
}

/**
 * Stored media item with metadata and file path.
 *
 * Created by MediaStore when a gadget returns media outputs.
 * Contains the abstract ID, file path, and metadata for display.
 */
export interface StoredMedia {
  /** Unique ID for this media item (e.g., "media_a1b2c3") */
  id: string;
  /** Type of media */
  kind: MediaKind;
  /** Actual file path on disk (internal use) */
  path: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Human-readable description */
  description?: string;
  /** Type-specific metadata */
  metadata?: MediaMetadata;
  /** Name of the gadget that created this media */
  gadgetName: string;
  /** When the media was stored */
  createdAt: Date;
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
  /** Media outputs from the gadget (images, audio, video, files) */
  media?: GadgetMediaOutput[];
  /** Abstract IDs for media outputs (e.g., ["media_a1b2c3"]) */
  mediaIds?: string[];
  /** Stored media with paths (for CLI display) */
  storedMedia?: StoredMedia[];
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
 * Extended result type with media support.
 * Use this when gadget returns images, audio, video, or files.
 *
 * @example
 * ```typescript
 * // Return with image
 * execute: () => ({
 *   result: "Screenshot captured",
 *   media: [{
 *     kind: "image",
 *     data: base64EncodedPng,
 *     mimeType: "image/png",
 *     description: "Screenshot"
 *   }],
 *   cost: 0.001
 * })
 * ```
 */
export interface GadgetExecuteResultWithMedia {
  /** The execution result as a string */
  result: string;
  /** Media outputs (images, audio, video, files) */
  media?: GadgetMediaOutput[];
  /** Optional cost in USD (e.g., 0.001 for $0.001) */
  cost?: number;
}

/**
 * Union type for backwards-compatible execute() return type.
 * Gadgets can return:
 * - string (legacy, cost = 0)
 * - GadgetExecuteResult (result + optional cost)
 * - GadgetExecuteResultWithMedia (result + optional media + optional cost)
 */
export type GadgetExecuteReturn = string | GadgetExecuteResult | GadgetExecuteResultWithMedia;

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

// Imports for text-only handlers
import type { ILogObj, Logger } from "tslog";
import type { Observers } from "../agent/hooks.js";
import type { ExecutionTree, NodeId } from "../core/execution-tree.js";
import type {
  ImageGenerationOptions,
  ImageGenerationResult,
  SpeechGenerationOptions,
  SpeechGenerationResult,
} from "../core/media-types.js";
import type { LLMMessage } from "../core/messages.js";
import type { ModelRegistry } from "../core/model-registry.js";
import type { LLMGenerationOptions, LLMStream, TokenUsage } from "../core/options.js";
import type { TextGenerationOptions } from "../core/quick-methods.js";
import type { RateLimitTracker } from "../core/rate-limit.js";
import type { ResolvedRetryConfig } from "../core/retry.js";

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
  complete(prompt: string, options?: TextGenerationOptions): Promise<string>;

  /**
   * Quick streaming - returns async generator of text chunks.
   * Costs are automatically reported when the stream completes.
   */
  streamText(prompt: string, options?: TextGenerationOptions): AsyncGenerator<string>;

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

  /**
   * Parent agent configuration for subagents to inherit.
   *
   * Contains the model and settings of the agent that invoked this gadget.
   * Subagent gadgets (like BrowseWeb) can use this to inherit the parent's
   * model by default, rather than using hardcoded defaults.
   *
   * This is optional - it will be `undefined` for:
   * - Gadgets executed via CLI `gadget run` command
   * - Direct gadget testing without agent context
   *
   * @example
   * ```typescript
   * execute: async (params, ctx) => {
   *   // Inherit parent model unless explicitly specified
   *   const model = params.model ?? ctx.agentConfig?.model ?? "sonnet";
   *
   *   const agent = new AgentBuilder(new LLMist())
   *     .withModel(model)
   *     .build();
   *   // ...
   * }
   * ```
   */
  agentConfig?: AgentContextConfig;

  /**
   * Subagent-specific configuration overrides from CLI config.
   *
   * Contains per-subagent settings defined in `[subagents.Name]` or
   * `[profile.subagents.Name]` sections of cli.toml. Allows users to
   * customize subagent behavior without modifying gadget parameters.
   *
   * Resolution priority (highest to lowest):
   * 1. Runtime params (explicit gadget call)
   * 2. Profile-level subagent config
   * 3. Global subagent config
   * 4. Parent model (if "inherit")
   * 5. Package defaults
   *
   * @example
   * ```typescript
   * execute: async (params, ctx) => {
   *   const subagentConfig = ctx.subagentConfig?.BrowseWeb ?? {};
   *
   *   const model = params.model
   *     ?? subagentConfig.model
   *     ?? ctx.agentConfig?.model
   *     ?? "sonnet";
   *
   *   const maxIterations = params.maxIterations
   *     ?? subagentConfig.maxIterations
   *     ?? 15;
   *   // ...
   * }
   * ```
   */
  subagentConfig?: SubagentConfigMap;

  /**
   * Unique invocation ID for this gadget execution.
   * Used by `withParentContext()` to identify which parent gadget
   * nested events belong to.
   */
  invocationId?: string;

  // ==========================================================================
  // Execution Tree Access (for subagent support)
  // ==========================================================================

  /**
   * The execution tree tracking all LLM calls and gadget executions.
   *
   * Subagent gadgets can use the tree to:
   * - Automatically aggregate costs via `tree.getSubtreeCost(nodeId)`
   * - Collect media outputs via `tree.getSubtreeMedia(nodeId)`
   * - Query token usage via `tree.getSubtreeTokens(nodeId)`
   *
   * When using `withParentContext(ctx)`, the subagent shares the parent's tree,
   * enabling unified cost tracking and progress visibility across all nesting levels.
   *
   * This is optional - it will be `undefined` for:
   * - Gadgets executed via CLI `gadget run` command
   * - Direct gadget testing without agent context
   * - Legacy code that hasn't adopted the ExecutionTree model
   *
   * @example
   * ```typescript
   * execute: async (params, ctx) => {
   *   // Build subagent with parent context (shares tree)
   *   const agent = new AgentBuilder(client)
   *     .withParentContext(ctx)
   *     .withGadgets(Navigate, Click)
   *     .ask(params.task);
   *
   *   for await (const event of agent.run()) {
   *     // Process events...
   *   }
   *
   *   // After subagent completes, costs are automatically tracked in tree
   *   // No need for manual cost aggregation!
   *   const subtreeCost = ctx.tree?.getSubtreeCost(ctx.nodeId!);
   *
   *   // Media from all nested gadgets also aggregated
   *   const allMedia = ctx.tree?.getSubtreeMedia(ctx.nodeId!);
   *
   *   return { result: "done", media: allMedia };
   * }
   * ```
   */
  tree?: ExecutionTree;

  /**
   * The tree node ID for this gadget execution.
   *
   * This identifies the current gadget's node in the execution tree.
   * Use with tree methods to query/aggregate data for this subtree:
   * - `tree.getSubtreeCost(nodeId)` - total cost including nested calls
   * - `tree.getSubtreeMedia(nodeId)` - all media from nested gadgets
   * - `tree.getSubtreeTokens(nodeId)` - token usage breakdown
   * - `tree.getDescendants(nodeId)` - all child nodes
   *
   * Note: This is distinct from `invocationId` which identifies the gadget call
   * (used in conversation history). `nodeId` is the tree node identifier.
   */
  nodeId?: NodeId;

  /**
   * Nesting depth of this gadget execution.
   *
   * - 0 = Root level (direct gadget call from main agent)
   * - 1 = First-level subagent (gadget called by a gadget)
   * - 2+ = Deeper nesting
   *
   * Useful for:
   * - Conditional behavior based on nesting level
   * - Logging with appropriate indentation
   * - Limiting recursion depth
   *
   * @example
   * ```typescript
   * execute: async (params, ctx) => {
   *   // Prevent infinite recursion
   *   if ((ctx.depth ?? 0) > 3) {
   *     return "Maximum nesting depth reached";
   *   }
   *
   *   // Log with depth-aware indentation
   *   const indent = "  ".repeat(ctx.depth ?? 0);
   *   console.log(`${indent}Executing at depth ${ctx.depth}`);
   * }
   * ```
   */
  depth?: number;

  // ==========================================================================
  // Host Exports (for external gadgets)
  // ==========================================================================

  /**
   * Host llmist exports for external gadgets.
   *
   * External gadgets MUST use these instead of importing from 'llmist'
   * to ensure they use the same version as the host CLI, enabling proper
   * tree sharing and feature compatibility.
   *
   * Use the `getHostExports(ctx)` helper function to access these exports
   * with proper error handling.
   *
   * @example
   * ```typescript
   * import { getHostExports, Gadget, z } from 'llmist';
   *
   * class BrowseWeb extends Gadget({...}) {
   *   async execute(params, ctx) {
   *     const { AgentBuilder } = getHostExports(ctx);
   *     const agent = new AgentBuilder()
   *       .withParentContext(ctx)
   *       .ask(params.task);
   *   }
   * }
   * ```
   */
  hostExports?: HostExports;

  // ==========================================================================
  // Logging
  // ==========================================================================

  /**
   * Logger instance for structured logging.
   *
   * External gadgets should use this for logging instead of importing
   * defaultLogger directly. This ensures logs respect the CLI's configured
   * log level, format, and destination (file/console).
   *
   * The logger is optional to support standalone gadget execution and testing.
   * Use optional chaining when logging: `ctx.logger?.debug(...)`.
   *
   * @example
   * ```typescript
   * execute: async (params, ctx) => {
   *   ctx.logger?.debug("[MyGadget] Starting operation", { itemId: params.id });
   *   // ... do work ...
   *   ctx.logger?.info("[MyGadget] Completed successfully");
   *   return "done";
   * }
   * ```
   */
  logger?: Logger<ILogObj>;

  // ==========================================================================
  // Human Input
  // ==========================================================================

  /**
   * Request human input during gadget execution.
   *
   * When available, gadgets can use this callback to ask the user questions
   * and receive their answers. This is used internally by gadgets that throw
   * `HumanInputRequiredException` - the executor catches the exception and
   * calls this callback if provided.
   *
   * Subagents created via `createSubagent()` will automatically inherit this
   * capability from their parent context, enabling nested agents to bubble up
   * human input requests to the CLI's TUI.
   *
   * This is optional - it will be `undefined` for:
   * - Gadgets executed via CLI `gadget run` command
   * - Non-interactive (piped) execution
   * - Direct gadget testing without agent context
   *
   * @example
   * ```typescript
   * // Subagents automatically inherit human input capability:
   * const agent = createSubagent(ctx, {
   *   name: "BrowseWeb",
   *   gadgets: [Navigate, Click, AskUser],
   * }).ask("Log in to example.com");
   *
   * // The AskUser gadget inside BrowseWeb can now prompt the user
   * // and the input request will bubble up to the CLI's TUI
   * ```
   */
  requestHumanInput?: (question: string) => Promise<string>;

  // ==========================================================================
  // Parent Observer Hooks (for subagent visibility)
  // ==========================================================================

  /**
   * Parent agent's observer hooks for subagent visibility.
   *
   * When a subagent is created with `withParentContext(ctx)`, these observers
   * are also called for gadget events (in addition to the subagent's own hooks),
   * enabling the parent to observe subagent gadget activity.
   *
   * Only observer hooks are shared (for visibility), not interceptors (which
   * modify behavior). This ensures subagents operate independently while
   * parents can monitor their progress.
   *
   * The parent's observer hooks are called with `await` in stream-processor.ts
   * after the subagent's own hooks, ensuring proper ordering of events
   * (e.g., GadgetCall.Start always before GadgetCall.Complete).
   *
   * This is populated automatically by the parent agent's GadgetExecutor
   * and should not be set manually.
   *
   * @example
   * ```typescript
   * // Parent agent's hooks will receive subagent gadget events:
   * const parentHooks = {
   *   observers: {
   *     onGadgetExecutionStart: async (ctx) => {
   *       if (ctx.subagentContext) {
   *         // This is from a subagent (e.g., BrowseWeb's Navigate call)
   *         console.log(`Subagent gadget: ${ctx.gadgetName}`);
   *       }
   *     }
   *   }
   * };
   *
   * // When BrowseWeb creates a subagent with withParentContext(ctx),
   * // the subagent's gadget events will call parentHooks.observers
   * ```
   */
  parentObservers?: Observers;

  // ==========================================================================
  // Rate Limiting & Retry (shared across subagents)
  // ==========================================================================

  /**
   * Shared rate limit tracker for coordinated throttling across subagents.
   *
   * When present, all agents in the tree share this tracker to respect
   * aggregate RPM/TPM limits. This ensures that a parent configured with
   * `requestsPerMinute: 10` actually limits the entire agent tree to 10 RPM,
   * not 10 RPM per agent.
   *
   * The tracker is automatically inherited via `withParentContext(ctx)`.
   * Standalone gadgets (testing, CLI `gadget run`) will have this undefined
   * and create their own tracker if rate limits are configured.
   *
   * @example
   * ```typescript
   * // Subagents automatically share the parent's tracker:
   * const agent = new AgentBuilder(client)
   *   .withParentContext(ctx)  // Inherits ctx.rateLimitTracker
   *   .ask("Do something");
   *
   * // All LLM calls from this subagent count toward the parent's limits
   * ```
   */
  rateLimitTracker?: RateLimitTracker;

  /**
   * Shared retry configuration for consistent backoff behavior across subagents.
   *
   * When present, subagents inherit the parent's retry strategy including
   * max retries, backoff timing, and callbacks. This ensures consistent
   * error handling across the entire agent tree.
   *
   * The config is automatically inherited via `withParentContext(ctx)`.
   * Standalone gadgets will have this undefined and use default retry config.
   *
   * @example
   * ```typescript
   * // Subagents automatically share the parent's retry config:
   * const agent = new AgentBuilder(client)
   *   .withParentContext(ctx)  // Inherits ctx.retryConfig
   *   .ask("Do something");
   *
   * // Retry attempts use the same backoff strategy as the parent
   * ```
   */
  retryConfig?: ResolvedRetryConfig;
}

/**
 * Host llmist exports provided to external gadgets via ExecutionContext.
 *
 * This ensures external gadgets use the same class instances as the host CLI,
 * enabling proper tree sharing and avoiding the "dual-package problem" where
 * different versions of llmist have incompatible classes.
 */
export interface HostExports {
  /** AgentBuilder for creating subagents with proper tree sharing */
  AgentBuilder: typeof import("../agent/builder.js").AgentBuilder;
  /** Gadget factory for defining gadgets */
  Gadget: typeof import("./typed-gadget.js").Gadget;
  /** createGadget for functional gadget definitions */
  createGadget: typeof import("./create-gadget.js").createGadget;
  /** ExecutionTree for tree operations */
  ExecutionTree: typeof import("../core/execution-tree.js").ExecutionTree;
  /** LLMist client */
  LLMist: typeof import("../core/client.js").LLMist;
  /** Zod schema builder */
  z: typeof import("zod").z;
}

// =============================================================================
// Subagent Configuration Types
// =============================================================================

/**
 * Parent agent configuration passed to gadgets.
 * Contains settings that subagents can inherit.
 */
export interface AgentContextConfig {
  /** Model identifier used by the parent agent */
  model: string;
  /** Temperature setting used by the parent agent */
  temperature?: number;
}

/**
 * Configuration for a single subagent.
 * Can be defined globally in `[subagents.Name]` or per-profile in `[profile.subagents.Name]`.
 *
 * @example
 * ```toml
 * [subagents.BrowseWeb]
 * model = "inherit"      # Use parent agent's model
 * maxIterations = 20
 * headless = true
 * ```
 */
export interface SubagentConfig {
  /**
   * Model to use for this subagent.
   * - "inherit": Use parent agent's model (default behavior)
   * - Any model ID: Use specific model (e.g., "sonnet", "haiku", "gpt-4o")
   */
  model?: string;
  /** Maximum iterations for the subagent loop */
  maxIterations?: number;
  /** Budget limit in USD for the subagent */
  budget?: number;
  /**
   * Timeout for the subagent gadget execution in milliseconds.
   * Overrides the gadget's hardcoded timeoutMs when set.
   * Set to 0 to disable timeout for this gadget.
   */
  timeoutMs?: number;
  /**
   * Maximum number of concurrent executions allowed for this gadget.
   * When the limit is reached, additional calls are queued and processed
   * as earlier executions complete (FIFO order).
   * Set to 0 or omit to allow unlimited concurrent executions (default).
   */
  maxConcurrent?: number;
  /** Additional subagent-specific options */
  [key: string]: unknown;
}

/**
 * Map of subagent names to their configurations.
 */
export type SubagentConfigMap = Record<string, SubagentConfig>;

/**
 * Gadget execution mode controlling how multiple gadgets are executed.
 *
 * - `'parallel'` (default): Gadgets without dependencies execute concurrently (fire-and-forget).
 *   This maximizes throughput but gadgets may complete in any order.
 *
 * - `'sequential'`: Gadgets execute one at a time, each awaiting completion before the next starts.
 *   Useful for:
 *   - Gadgets with implicit ordering dependencies (e.g., file operations)
 *   - Debugging and tracing execution flow
 *   - Resource-constrained environments
 *   - Ensuring deterministic execution order
 *
 * Note: Explicit `dependsOn` relationships are always respected regardless of mode.
 * Sequential mode effectively enforces a global `maxConcurrent: 1` for all gadgets.
 *
 * @example
 * ```typescript
 * const agent = LLMist.createAgent()
 *   .withModel("sonnet")
 *   .withGadgets(FileReader, FileWriter)
 *   .withGadgetExecutionMode('sequential')  // Execute one at a time
 *   .ask("Process files in order");
 * ```
 */
export type GadgetExecutionMode = "parallel" | "sequential";
