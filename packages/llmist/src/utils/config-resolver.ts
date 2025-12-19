/**
 * Config resolution utility for subagent gadgets.
 *
 * Simplifies the common pattern of resolving configuration from multiple sources:
 * 1. Runtime params (explicit gadget call parameters)
 * 2. Subagent config (from CLI [subagents.Name] sections)
 * 3. Parent agent config (model inheritance)
 * 4. Package defaults
 *
 * @module utils/config-resolver
 */

import type { ExecutionContext } from "../gadgets/types.js";

/**
 * Options for resolving a single config value.
 */
export interface ResolveValueOptions<T> {
  /** Runtime parameter value (highest priority) */
  runtime?: T;
  /** Subagent config key to check */
  subagentKey?: string;
  /** Parent config key to check (for inheritance) - "model" or "temperature" */
  parentKey?: "model" | "temperature";
  /** Default value (lowest priority) */
  defaultValue: T;
  /** Whether "inherit" string means use parent value */
  handleInherit?: boolean;
}

/**
 * Resolve a single configuration value through the priority chain.
 *
 * Priority (highest to lowest):
 * 1. Runtime parameter (if provided and not undefined)
 * 2. Subagent config (from ctx.subagentConfig[gadgetName][key])
 * 3. Parent config (from ctx.agentConfig[key], if parentKey specified)
 * 4. Default value
 *
 * Special handling for "inherit" string:
 * - If handleInherit is true and value is "inherit", falls through to parent/default
 *
 * @param ctx - ExecutionContext from gadget execution
 * @param gadgetName - Name of the subagent gadget (e.g., "BrowseWeb")
 * @param options - Resolution options
 * @returns Resolved value
 *
 * @example
 * ```typescript
 * const model = resolveValue(ctx, "BrowseWeb", {
 *   runtime: params.model,
 *   subagentKey: "model",
 *   parentKey: "model",
 *   defaultValue: "sonnet",
 *   handleInherit: true,
 * });
 * ```
 */
export function resolveValue<T>(
  ctx: ExecutionContext,
  gadgetName: string,
  options: ResolveValueOptions<T>,
): T {
  const { runtime, subagentKey, parentKey, defaultValue, handleInherit } = options;

  // Priority 1: Runtime parameter
  if (runtime !== undefined) {
    // Handle "inherit" string if enabled
    if (handleInherit && runtime === "inherit") {
      // Fall through to lower priorities
    } else {
      return runtime;
    }
  }

  // Priority 2: Subagent config
  if (subagentKey && ctx.subagentConfig) {
    const subagentCfg = ctx.subagentConfig[gadgetName];
    if (subagentCfg && subagentKey in subagentCfg) {
      const value = subagentCfg[subagentKey] as T;
      // Handle "inherit" string if enabled
      if (handleInherit && value === "inherit") {
        // Fall through to parent/default
      } else if (value !== undefined) {
        return value;
      }
    }
  }

  // Priority 3: Parent config (inheritance)
  if (parentKey && ctx.agentConfig && parentKey in ctx.agentConfig) {
    const parentValue = ctx.agentConfig[parentKey] as T;
    if (parentValue !== undefined) {
      return parentValue;
    }
  }

  // Priority 4: Default value
  return defaultValue;
}

/**
 * Bulk configuration resolution for subagent gadgets.
 *
 * Takes a map of config keys to their resolution options and returns
 * a fully resolved configuration object.
 *
 * @param ctx - ExecutionContext from gadget execution
 * @param gadgetName - Name of the subagent gadget (e.g., "BrowseWeb")
 * @param config - Map of config keys to resolution options
 * @returns Fully resolved configuration object
 *
 * @example
 * ```typescript
 * // Before: 27 lines of manual fallback logic
 * const subagentConfig = ctx.subagentConfig?.Dhalsim ?? {};
 * const parentModel = ctx.agentConfig?.model;
 * const model = params.model ?? subagentConfig.model ?? parentModel ?? "sonnet";
 * const maxIterations = params.maxIterations ?? subagentConfig.maxIterations ?? 15;
 * const headless = params.headless ?? subagentConfig.headless ?? true;
 *
 * // After: One function call
 * const { model, maxIterations, headless } = resolveConfig(ctx, "BrowseWeb", {
 *   model: { runtime: params.model, subagentKey: "model", parentKey: "model", defaultValue: "sonnet", handleInherit: true },
 *   maxIterations: { runtime: params.maxIterations, subagentKey: "maxIterations", defaultValue: 15 },
 *   headless: { runtime: params.headless, subagentKey: "headless", defaultValue: true },
 * });
 * ```
 */
export function resolveConfig<T extends Record<string, unknown>>(
  ctx: ExecutionContext,
  gadgetName: string,
  config: { [K in keyof T]: ResolveValueOptions<T[K]> },
): T {
  const result: Record<string, unknown> = {};

  for (const [key, options] of Object.entries(config)) {
    result[key] = resolveValue(ctx, gadgetName, options as ResolveValueOptions<unknown>);
  }

  return result as T;
}

/**
 * Convenience function for resolving subagent model with "inherit" support.
 *
 * This is the most common resolution pattern for subagent gadgets:
 * - Use runtime model if provided
 * - Check subagent config for model override
 * - Inherit parent model if configured
 * - Fall back to default
 *
 * @param ctx - ExecutionContext from gadget execution
 * @param gadgetName - Name of the subagent gadget
 * @param runtimeModel - Model from gadget parameters
 * @param defaultModel - Default model if nothing else specified
 * @returns Resolved model string
 *
 * @example
 * ```typescript
 * const model = resolveSubagentModel(ctx, "BrowseWeb", params.model, "sonnet");
 * ```
 */
export function resolveSubagentModel(
  ctx: ExecutionContext,
  gadgetName: string,
  runtimeModel: string | undefined,
  defaultModel: string,
): string {
  return resolveValue(ctx, gadgetName, {
    runtime: runtimeModel,
    subagentKey: "model",
    parentKey: "model",
    defaultValue: defaultModel,
    handleInherit: true,
  });
}
