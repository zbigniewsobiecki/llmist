/**
 * Subagent creation helper for gadget authors.
 *
 * Simplifies the common pattern of creating subagents from within gadgets.
 * Handles:
 * - Getting host exports (AgentBuilder, LLMist) from context
 * - Model resolution with "inherit" support
 * - Parent context sharing for cost tracking
 * - Common configuration options
 *
 * @module agent/subagent
 *
 * @example
 * ```typescript
 * import { createSubagent, Gadget, z } from "llmist";
 * import type { ExecutionContext } from "llmist";
 *
 * class BrowseWeb extends Gadget({
 *   name: "BrowseWeb",
 *   schema: z.object({
 *     task: z.string(),
 *     url: z.string().url(),
 *     model: z.string().optional(),
 *   }),
 * }) {
 *   async execute(params: this["params"], ctx?: ExecutionContext) {
 *     const agent = createSubagent(ctx!, {
 *       name: "BrowseWeb",
 *       gadgets: [Navigate, Click, Screenshot],
 *       systemPrompt: BROWSER_SYSTEM_PROMPT,
 *       model: params.model,  // Optional override
 *       maxIterations: 15,
 *     }).ask(params.task);
 *
 *     for await (const event of agent.run()) {
 *       // Process events...
 *     }
 *
 *     return result;
 *   }
 * }
 * ```
 */

import type { AbstractGadget } from "../gadgets/gadget.js";
import type { ExecutionContext, HostExports } from "../gadgets/types.js";
import { resolveSubagentModel, resolveValue } from "../utils/config-resolver.js";
import type { AgentBuilder } from "./builder.js";
import type { AgentHooks } from "./hooks.js";

/**
 * Options for creating a subagent.
 */
export interface SubagentOptions {
  /**
   * Name of the subagent (used for config resolution).
   * Should match the gadget name in CLI config, e.g., "BrowseWeb".
   */
  name: string;

  /**
   * Gadgets to register with the subagent.
   */
  gadgets: AbstractGadget[];

  /**
   * System prompt for the subagent.
   */
  systemPrompt?: string;

  /**
   * Model to use. If not provided, inherits from parent or uses default.
   * Can be a runtime parameter from gadget params.
   */
  model?: string;

  /**
   * Default model if no other source provides one.
   * @default "sonnet"
   */
  defaultModel?: string;

  /**
   * Maximum iterations for the agent loop.
   */
  maxIterations?: number;

  /**
   * Default max iterations if not specified.
   * @default 15
   */
  defaultMaxIterations?: number;

  /**
   * Agent hooks for observers, interceptors, controllers.
   */
  hooks?: AgentHooks;

  /**
   * Temperature for LLM calls.
   */
  temperature?: number;
}

/**
 * Get host exports from execution context.
 *
 * This helper ensures gadgets use the same llmist version as the host CLI,
 * avoiding the "dual-package problem" where different versions have
 * incompatible classes.
 *
 * @param ctx - Execution context from gadget execute()
 * @returns Host exports (AgentBuilder, LLMist, etc.)
 * @throws Error if host exports not available
 */
function getHostExports(ctx: ExecutionContext): HostExports {
  if (!ctx?.hostExports) {
    throw new Error(
      "hostExports not available. Subagent gadgets must be run via llmist agent. " +
        "Ensure you are using llmist >= 6.2.0 and running through the CLI or AgentBuilder.",
    );
  }
  return ctx.hostExports;
}

/**
 * Create a subagent from within a gadget.
 *
 * This helper simplifies the common pattern of creating nested agents.
 * It automatically:
 * - Gets the correct AgentBuilder from host exports
 * - Resolves model with "inherit" support from CLI config
 * - Shares the parent's execution tree for cost tracking
 * - Forwards the abort signal for proper cancellation
 * - Inherits human input handler (for 2FA, CAPTCHAs, etc.)
 *
 * @param ctx - ExecutionContext passed to gadget's execute()
 * @param options - Subagent configuration options
 * @returns Configured AgentBuilder ready for .ask()
 *
 * @example
 * ```typescript
 * // Basic usage
 * const agent = createSubagent(ctx, {
 *   name: "BrowseWeb",
 *   gadgets: [Navigate, Click],
 * }).ask("Go to google.com");
 *
 * // With all options
 * const agent = createSubagent(ctx, {
 *   name: "BrowseWeb",
 *   gadgets: [Navigate, Click, Screenshot],
 *   systemPrompt: "You are a browser automation agent...",
 *   model: params.model,  // Runtime override
 *   defaultModel: "sonnet",
 *   maxIterations: 20,
 *   hooks: {
 *     observers: {
 *       onLLMCallReady: () => refreshPageState(),
 *     },
 *   },
 * }).ask(params.task);
 *
 * for await (const event of agent.run()) {
 *   // Events flow through shared tree automatically
 * }
 *
 * // Human input bubbles up automatically:
 * // If a gadget throws HumanInputRequiredException,
 * // the parent's onHumanInput handler will be called
 * ```
 */
export function createSubagent(ctx: ExecutionContext, options: SubagentOptions): AgentBuilder {
  const {
    name,
    gadgets,
    systemPrompt,
    model: runtimeModel,
    defaultModel = "sonnet",
    maxIterations: runtimeMaxIterations,
    defaultMaxIterations = 15,
    hooks,
    temperature,
  } = options;

  // Get host's AgentBuilder to ensure tree sharing works correctly
  const { AgentBuilder, LLMist } = getHostExports(ctx);

  // Create LLMist client for the subagent
  const client = new LLMist();

  // Resolve model with config hierarchy support
  const model = resolveSubagentModel(ctx, name, runtimeModel, defaultModel);

  // Resolve max iterations
  const maxIterations = resolveValue(ctx, name, {
    runtime: runtimeMaxIterations,
    subagentKey: "maxIterations",
    defaultValue: defaultMaxIterations,
  });

  // Build the subagent
  let builder = new AgentBuilder(client)
    .withModel(model)
    .withGadgets(...gadgets)
    .withMaxIterations(maxIterations)
    .withParentContext(ctx); // Share tree, forward signal

  // Inherit human input capability from parent context
  // This allows subagents to bubble up input requests (e.g., 2FA codes)
  if (ctx.requestHumanInput) {
    builder = builder.onHumanInput(ctx.requestHumanInput);
  }

  // Apply optional configuration
  if (systemPrompt) {
    builder = builder.withSystem(systemPrompt);
  }

  if (hooks) {
    builder = builder.withHooks(hooks);
  }

  if (temperature !== undefined) {
    builder = builder.withTemperature(temperature);
  }

  // Forward logger from parent context if available
  if (ctx.logger) {
    builder = builder.withLogger(ctx.logger);
  }

  return builder;
}

/**
 * Check if an execution context has valid host exports.
 *
 * Useful for conditional logic when gadgets may run standalone or via agent.
 *
 * @param ctx - Execution context
 * @returns True if host exports are available
 */
export function hasHostExports(ctx?: ExecutionContext): boolean {
  return ctx?.hostExports !== undefined;
}
