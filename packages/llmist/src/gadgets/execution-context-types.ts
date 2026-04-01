/**
 * Execution context types for gadgets.
 *
 * Contains `ExecutionContext`, `CostReportingLLMist`, and `HostExports` —
 * the rich context object passed to every gadget's `execute()` method.
 *
 * @module
 */

import type { ILogObj, Logger } from "tslog";
import type { Observers } from "../agent/hooks.js";
import type { ExecutionTree, NodeId } from "../core/execution-tree.js";
import type {
  ImageGenerationOptions,
  ImageGenerationResult,
  SpeechGenerationOptions,
  SpeechGenerationResult,
} from "../core/media-types.js";
import type { ModelRegistry } from "../core/model-registry.js";
import type { LLMGenerationOptions, LLMStream } from "../core/options.js";
import type { TextGenerationOptions } from "../core/quick-methods.js";
import type { RateLimitTracker } from "../core/rate-limit.js";
import type { ResolvedRetryConfig } from "../core/retry.js";
import type { AgentContextConfig, SubagentConfigMap } from "./subagent-config-types.js";

export type { AgentContextConfig, SubagentConfigMap };

// =============================================================================
// Execution Context for Gadgets
// =============================================================================

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
