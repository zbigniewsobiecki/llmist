/**
 * Common hook presets for logging, timing, and monitoring.
 *
 * @example
 * ```typescript
 * import { HookPresets } from 'llmist/hooks';
 *
 * const agent = LLMist.createAgent()
 *   .withHooks(HookPresets.logging())
 *   .ask("...");
 *
 * // Or combine multiple presets
 * const agent = LLMist.createAgent()
 *   .withHooks(HookPresets.merge(
 *     HookPresets.logging({ verbose: true }),
 *     HookPresets.timing(),
 *     HookPresets.tokenTracking()
 *   ))
 *   .ask("...");
 * ```
 */

import type { AgentHooks } from "./hooks.js";

/**
 * Options for logging preset.
 */
export interface LoggingOptions {
  /** Include verbose details like parameters and results */
  verbose?: boolean;
}

/**
 * Common hook presets.
 */
export class HookPresets {
  /**
   * Preset: Basic logging of all events.
   *
   * Logs LLM calls and gadget executions to console.
   *
   * @param options - Logging options
   * @returns Hook configuration
   *
   * @example
   * ```typescript
   * .withHooks(HookPresets.logging())
   * .withHooks(HookPresets.logging({ verbose: true }))
   * ```
   */
  static logging(options: LoggingOptions = {}): AgentHooks {
    return {
      observers: {
        onLLMCallStart: async (ctx) => {
          console.log(`[LLM] Starting call (iteration ${ctx.iteration})`);
        },
        onLLMCallComplete: async (ctx) => {
          const tokens = ctx.usage?.totalTokens ?? "unknown";
          console.log(`[LLM] Completed (tokens: ${tokens})`);
          if (options.verbose && ctx.finalMessage) {
            console.log(`[LLM] Response: ${ctx.finalMessage}`);
          }
        },
        onGadgetExecutionStart: async (ctx) => {
          console.log(`[GADGET] Executing ${ctx.gadgetName}`);
          if (options.verbose) {
            console.log(`[GADGET] Parameters:`, JSON.stringify(ctx.parameters, null, 2));
          }
        },
        onGadgetExecutionComplete: async (ctx) => {
          console.log(`[GADGET] Completed ${ctx.gadgetName}`);
          if (options.verbose) {
            const display = ctx.error ?? ctx.finalResult ?? "(no result)";
            console.log(`[GADGET] Result: ${display}`);
          }
        },
      },
    };
  }

  /**
   * Preset: Performance timing for all operations.
   *
   * Measures and logs execution time for LLM calls and gadgets.
   *
   * @returns Hook configuration
   *
   * @example
   * ```typescript
   * .withHooks(HookPresets.timing())
   * ```
   */
  static timing(): AgentHooks {
    const timings = new Map<string, number>();

    return {
      observers: {
        onLLMCallStart: async (ctx) => {
          timings.set(`llm-${ctx.iteration}`, Date.now());
        },
        onLLMCallComplete: async (ctx) => {
          const start = timings.get(`llm-${ctx.iteration}`);
          if (start) {
            const duration = Date.now() - start;
            console.log(`⏱️  LLM call took ${duration}ms`);
            timings.delete(`llm-${ctx.iteration}`);
          }
        },
        onGadgetExecutionStart: async (ctx) => {
          const key = `gadget-${ctx.gadgetName}-${Date.now()}`;
          timings.set(key, Date.now());
          // Store key for lookup in complete handler
          (ctx as any)._timingKey = key;
        },
        onGadgetExecutionComplete: async (ctx) => {
          const key = (ctx as any)._timingKey;
          if (key) {
            const start = timings.get(key);
            if (start) {
              const duration = Date.now() - start;
              console.log(`⏱️  Gadget ${ctx.gadgetName} took ${duration}ms`);
              timings.delete(key);
            }
          }
        },
      },
    };
  }

  /**
   * Preset: Token usage tracking.
   *
   * Tracks and logs cumulative token usage across all LLM calls.
   *
   * @returns Hook configuration
   *
   * @example
   * ```typescript
   * .withHooks(HookPresets.tokenTracking())
   * ```
   */
  static tokenTracking(): AgentHooks {
    let totalTokens = 0;
    let totalCalls = 0;

    return {
      observers: {
        onLLMCallComplete: async (ctx) => {
          totalCalls++;
          if (ctx.usage?.totalTokens) {
            totalTokens += ctx.usage.totalTokens;
            console.log(`📊 Tokens this call: ${ctx.usage.totalTokens}`);
            console.log(`📊 Total tokens: ${totalTokens} (across ${totalCalls} calls)`);
          }
        },
      },
    };
  }

  /**
   * Preset: Error logging.
   *
   * Logs detailed error information for debugging.
   *
   * @returns Hook configuration
   *
   * @example
   * ```typescript
   * .withHooks(HookPresets.errorLogging())
   * ```
   */
  static errorLogging(): AgentHooks {
    return {
      observers: {
        onLLMCallError: async (ctx) => {
          console.error(`❌ LLM Error (iteration ${ctx.iteration}):`, ctx.error.message);
          console.error(`   Model: ${ctx.options.model}`);
          console.error(`   Recovered: ${ctx.recovered}`);
        },
        onGadgetExecutionComplete: async (ctx) => {
          if (ctx.error) {
            console.error(`❌ Gadget Error: ${ctx.gadgetName}`);
            console.error(`   Error: ${ctx.error}`);
            console.error(`   Parameters:`, JSON.stringify(ctx.parameters, null, 2));
          }
        },
      },
    };
  }

  /**
   * Preset: Silent (no output).
   *
   * Useful for testing or when you want complete control.
   *
   * @returns Empty hook configuration
   *
   * @example
   * ```typescript
   * .withHooks(HookPresets.silent())
   * ```
   */
  static silent(): AgentHooks {
    return {};
  }

  /**
   * Merge multiple hook configurations.
   *
   * Combines hook presets or custom configurations into a single object.
   * When multiple hooks target the same lifecycle event, they are composed
   * to run sequentially (all handlers will execute).
   *
   * @param hookSets - Array of hook configurations to merge
   * @returns Merged hook configuration with composed handlers
   *
   * @example
   * ```typescript
   * .withHooks(HookPresets.merge(
   *   HookPresets.logging({ verbose: true }),
   *   HookPresets.timing(),
   *   HookPresets.tokenTracking(),
   *   {
   *     // Custom hook
   *     observers: {
   *       onLLMCallComplete: async (ctx) => {
   *         saveToDatabase(ctx);
   *       }
   *     }
   *   }
   * ))
   * // All onLLMCallComplete handlers from logging, timing, tokenTracking,
   * // and the custom hook will execute in order
   * ```
   */
  static merge(...hookSets: AgentHooks[]): AgentHooks {
    const merged: AgentHooks = {
      observers: {},
      interceptors: {},
      controllers: {},
    };

    // Compose observers: run all handlers for the same event
    for (const hooks of hookSets) {
      if (hooks.observers) {
        for (const [key, handler] of Object.entries(hooks.observers)) {
          const typedKey = key as keyof typeof hooks.observers;
          if (merged.observers![typedKey]) {
            // Compose: run both existing and new handler
            const existing = merged.observers![typedKey];
            merged.observers![typedKey] = async (ctx: any) => {
              await existing(ctx);
              await handler(ctx);
            };
          } else {
            merged.observers![typedKey] = handler as any;
          }
        }
      }

      // Interceptors: last one wins (complex signatures make composition impractical)
      // Each interceptor has different parameters (chunk, message, parameters, etc.)
      // so we can't meaningfully compose them like we do with observers
      if (hooks.interceptors) {
        Object.assign(merged.interceptors!, hooks.interceptors);
      }

      // Controllers: last one wins (can't meaningfully compose boolean returns)
      if (hooks.controllers) {
        Object.assign(merged.controllers!, hooks.controllers);
      }
    }

    return merged;
  }

  /**
   * Preset: Complete monitoring suite.
   *
   * Combines logging, timing, and token tracking.
   *
   * @param options - Options for monitoring
   * @returns Merged hook configuration
   *
   * @example
   * ```typescript
   * .withHooks(HookPresets.monitoring())
   * .withHooks(HookPresets.monitoring({ verbose: true }))
   * ```
   */
  static monitoring(options: LoggingOptions = {}): AgentHooks {
    return HookPresets.merge(
      HookPresets.logging(options),
      HookPresets.timing(),
      HookPresets.tokenTracking(),
      HookPresets.errorLogging(),
    );
  }
}
