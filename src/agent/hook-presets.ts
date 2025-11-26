/**
 * Ready-to-use hook configurations for common monitoring, logging, and debugging tasks.
 *
 * HookPresets provide instant observability without writing custom hooks. They're the
 * fastest way to add monitoring to your agents during development and production.
 *
 * ## Available Presets
 *
 * - **logging(options?)** - Log LLM calls and gadget execution
 * - **timing()** - Measure execution time for operations
 * - **tokenTracking()** - Track cumulative token usage and costs
 * - **errorLogging()** - Log detailed error information
 * - **silent()** - No output (useful for testing)
 * - **monitoring(options?)** - All-in-one preset combining logging, timing, tokens, and errors
 * - **merge(...hookSets)** - Combine multiple hook configurations
 *
 * ## Quick Start
 *
 * @example
 * ```typescript
 * import { LLMist, HookPresets } from 'llmist';
 *
 * // Basic logging
 * await LLMist.createAgent()
 *   .withHooks(HookPresets.logging())
 *   .ask("Your prompt");
 *
 * // Full monitoring suite (recommended for development)
 * await LLMist.createAgent()
 *   .withHooks(HookPresets.monitoring({ verbose: true }))
 *   .ask("Your prompt");
 *
 * // Combine multiple presets
 * await LLMist.createAgent()
 *   .withHooks(HookPresets.merge(
 *     HookPresets.timing(),
 *     HookPresets.tokenTracking()
 *   ))
 *   .ask("Your prompt");
 *
 * // Environment-based configuration
 * const hooks = process.env.NODE_ENV === 'production'
 *   ? HookPresets.merge(HookPresets.errorLogging(), HookPresets.tokenTracking())
 *   : HookPresets.monitoring({ verbose: true });
 *
 * await LLMist.createAgent()
 *   .withHooks(hooks)
 *   .ask("Your prompt");
 * ```
 *
 * @see {@link https://github.com/zbigniewsobiecki/llmist/blob/main/docs/HOOKS.md | Full documentation}
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
   * Logs LLM calls and gadget execution to console with optional verbosity.
   *
   * **Output (basic mode):**
   * - LLM call start/complete events with iteration numbers
   * - Gadget execution start/complete with gadget names
   * - Token counts when available
   *
   * **Output (verbose mode):**
   * - All basic mode output
   * - Full gadget parameters (formatted JSON)
   * - Full gadget results
   * - Complete LLM response text
   *
   * **Use cases:**
   * - Basic development debugging and execution flow visibility
   * - Understanding agent decision-making and tool usage
   * - Troubleshooting gadget invocations
   *
   * **Performance:** Minimal overhead. Console writes are synchronous but fast.
   *
   * @param options - Logging options
   * @param options.verbose - Include full parameters and results. Default: false
   * @returns Hook configuration that can be passed to .withHooks()
   *
   * @example
   * ```typescript
   * // Basic logging
   * await LLMist.createAgent()
   *   .withHooks(HookPresets.logging())
   *   .ask("Calculate 15 * 23");
   * // Output: [LLM] Starting call (iteration 0)
   * //         [GADGET] Executing Calculator
   * //         [GADGET] Completed Calculator
   * //         [LLM] Completed (tokens: 245)
   * ```
   *
   * @example
   * ```typescript
   * // Verbose logging with full details
   * await LLMist.createAgent()
   *   .withHooks(HookPresets.logging({ verbose: true }))
   *   .ask("Calculate 15 * 23");
   * // Output includes: parameters, results, and full responses
   * ```
   *
   * @example
   * ```typescript
   * // Environment-based verbosity
   * const isDev = process.env.NODE_ENV === 'development';
   * .withHooks(HookPresets.logging({ verbose: isDev }))
   * ```
   *
   * @see {@link https://github.com/zbigniewsobiecki/llmist/blob/main/docs/HOOKS.md#hookpresetsloggingoptions | Full documentation}
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
   * Measures and logs execution time for LLM calls and gadgets.
   *
   * **Output:**
   * - Duration in milliseconds with ⏱️ emoji for each operation
   * - Separate timing for each LLM iteration
   * - Separate timing for each gadget execution
   *
   * **Use cases:**
   * - Performance profiling and optimization
   * - Identifying slow operations (LLM calls vs gadget execution)
   * - Monitoring response times in production
   * - Capacity planning and SLA tracking
   *
   * **Performance:** Negligible overhead. Uses Date.now() for timing measurements.
   *
   * @returns Hook configuration that can be passed to .withHooks()
   *
   * @example
   * ```typescript
   * // Basic timing
   * await LLMist.createAgent()
   *   .withHooks(HookPresets.timing())
   *   .withGadgets(Weather, Database)
   *   .ask("What's the weather in NYC?");
   * // Output: ⏱️ LLM call took 1234ms
   * //         ⏱️ Gadget Weather took 567ms
   * //         ⏱️ LLM call took 890ms
   * ```
   *
   * @example
   * ```typescript
   * // Combined with logging for full context
   * .withHooks(HookPresets.merge(
   *   HookPresets.logging(),
   *   HookPresets.timing()
   * ))
   * ```
   *
   * @example
   * ```typescript
   * // Correlate performance with cost
   * .withHooks(HookPresets.merge(
   *   HookPresets.timing(),
   *   HookPresets.tokenTracking()
   * ))
   * ```
   *
   * @see {@link https://github.com/zbigniewsobiecki/llmist/blob/main/docs/HOOKS.md#hookpresetstiming | Full documentation}
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
   * Tracks cumulative token usage across all LLM calls.
   *
   * **Output:**
   * - Per-call token count with 📊 emoji
   * - Cumulative total across all calls
   * - Call count for average calculations
   *
   * **Use cases:**
   * - Cost monitoring and budget tracking
   * - Optimizing prompts to reduce token usage
   * - Comparing token efficiency across different approaches
   * - Real-time cost estimation
   *
   * **Performance:** Minimal overhead. Simple counter increments.
   *
   * **Note:** Token counts depend on the provider's response. Some providers
   * may not include usage data, in which case counts won't be logged.
   *
   * @returns Hook configuration that can be passed to .withHooks()
   *
   * @example
   * ```typescript
   * // Basic token tracking
   * await LLMist.createAgent()
   *   .withHooks(HookPresets.tokenTracking())
   *   .ask("Summarize this document...");
   * // Output: 📊 Tokens this call: 1,234
   * //         📊 Total tokens: 1,234 (across 1 calls)
   * //         📊 Tokens this call: 567
   * //         📊 Total tokens: 1,801 (across 2 calls)
   * ```
   *
   * @example
   * ```typescript
   * // Cost calculation with custom hook
   * let totalTokens = 0;
   * .withHooks(HookPresets.merge(
   *   HookPresets.tokenTracking(),
   *   {
   *     observers: {
   *       onLLMCallComplete: async (ctx) => {
   *         totalTokens += ctx.usage?.totalTokens ?? 0;
   *         const cost = (totalTokens / 1_000_000) * 3.0; // $3 per 1M tokens
   *         console.log(`💰 Estimated cost: $${cost.toFixed(4)}`);
   *       },
   *     },
   *   }
   * ))
   * ```
   *
   * @see {@link https://github.com/zbigniewsobiecki/llmist/blob/main/docs/HOOKS.md#hookpresetstokentracking | Full documentation}
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
   * Logs detailed error information for debugging and troubleshooting.
   *
   * **Output:**
   * - LLM errors with ❌ emoji, including model and recovery status
   * - Gadget errors with full context (parameters, error message)
   * - Separate logging for LLM and gadget failures
   *
   * **Use cases:**
   * - Troubleshooting production issues
   * - Understanding error patterns and frequency
   * - Debugging error recovery behavior
   * - Collecting error metrics for monitoring
   *
   * **Performance:** Minimal overhead. Only logs when errors occur.
   *
   * @returns Hook configuration that can be passed to .withHooks()
   *
   * @example
   * ```typescript
   * // Basic error logging
   * await LLMist.createAgent()
   *   .withHooks(HookPresets.errorLogging())
   *   .withGadgets(Database)
   *   .ask("Fetch user data");
   * // Output (on LLM error): ❌ LLM Error (iteration 1): Rate limit exceeded
   * //                        Model: gpt-5-nano
   * //                        Recovered: true
   * // Output (on gadget error): ❌ Gadget Error: Database
   * //                            Error: Connection timeout
   * //                            Parameters: {...}
   * ```
   *
   * @example
   * ```typescript
   * // Combine with monitoring for full context
   * .withHooks(HookPresets.merge(
   *   HookPresets.monitoring(),  // Includes errorLogging
   *   customErrorAnalytics
   * ))
   * ```
   *
   * @example
   * ```typescript
   * // Error analytics collection
   * const errors: any[] = [];
   * .withHooks(HookPresets.merge(
   *   HookPresets.errorLogging(),
   *   {
   *     observers: {
   *       onLLMCallError: async (ctx) => {
   *         errors.push({ type: 'llm', error: ctx.error, recovered: ctx.recovered });
   *       },
   *     },
   *   }
   * ))
   * ```
   *
   * @see {@link https://github.com/zbigniewsobiecki/llmist/blob/main/docs/HOOKS.md#hookpresetserrorlogging | Full documentation}
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
   * Returns empty hook configuration for clean output without any logging.
   *
   * **Output:**
   * - None. Returns {} (empty object).
   *
   * **Use cases:**
   * - Clean test output without console noise
   * - Production environments where logging is handled externally
   * - Baseline for custom hook development
   * - Temporary disable of all hook output
   *
   * **Performance:** Zero overhead. No-op hook configuration.
   *
   * @returns Empty hook configuration
   *
   * @example
   * ```typescript
   * // Clean test output
   * describe('Agent tests', () => {
   *   it('should calculate correctly', async () => {
   *     const result = await LLMist.createAgent()
   *       .withHooks(HookPresets.silent()) // No console output
   *       .withGadgets(Calculator)
   *       .askAndCollect("What is 15 times 23?");
   *
   *     expect(result).toContain("345");
   *   });
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Conditional silence based on environment
   * const isTesting = process.env.NODE_ENV === 'test';
   * .withHooks(isTesting ? HookPresets.silent() : HookPresets.monitoring())
   * ```
   *
   * @see {@link https://github.com/zbigniewsobiecki/llmist/blob/main/docs/HOOKS.md#hookpresetssilent | Full documentation}
   */
  static silent(): AgentHooks {
    return {};
  }

  /**
   * Combines multiple hook configurations into one.
   *
   * Merge allows you to compose preset and custom hooks for modular monitoring
   * configurations. Understanding merge behavior is crucial for proper composition.
   *
   * **Merge behavior:**
   * - **Observers:** Composed - all handlers run sequentially in order
   * - **Interceptors:** Last one wins - only the last interceptor applies
   * - **Controllers:** Last one wins - only the last controller applies
   *
   * **Why interceptors/controllers don't compose:**
   * - Interceptors have different signatures per method, making composition impractical
   * - Controllers return specific actions that can't be meaningfully combined
   * - Only observers support composition because they're read-only and independent
   *
   * **Use cases:**
   * - Combining multiple presets (logging + timing + tokens)
   * - Adding custom hooks to presets
   * - Building modular, reusable monitoring configurations
   * - Environment-specific hook composition
   *
   * **Performance:** Minimal overhead for merging. Runtime performance depends on merged hooks.
   *
   * @param hookSets - Variable number of hook configurations to merge
   * @returns Single merged hook configuration with composed/overridden handlers
   *
   * @example
   * ```typescript
   * // Combine multiple presets
   * .withHooks(HookPresets.merge(
   *   HookPresets.logging(),
   *   HookPresets.timing(),
   *   HookPresets.tokenTracking()
   * ))
   * // All observers from all three presets will run
   * ```
   *
   * @example
   * ```typescript
   * // Add custom observer to preset (both run)
   * .withHooks(HookPresets.merge(
   *   HookPresets.timing(),
   *   {
   *     observers: {
   *       onLLMCallComplete: async (ctx) => {
   *         await saveMetrics({ tokens: ctx.usage?.totalTokens });
   *       },
   *     },
   *   }
   * ))
   * ```
   *
   * @example
   * ```typescript
   * // Multiple interceptors (last wins!)
   * .withHooks(HookPresets.merge(
   *   {
   *     interceptors: {
   *       interceptTextChunk: (chunk) => chunk.toUpperCase(), // Ignored
   *     },
   *   },
   *   {
   *     interceptors: {
   *       interceptTextChunk: (chunk) => chunk.toLowerCase(), // This wins
   *     },
   *   }
   * ))
   * // Result: text will be lowercase
   * ```
   *
   * @example
   * ```typescript
   * // Modular environment-based configuration
   * const baseHooks = HookPresets.errorLogging();
   * const devHooks = HookPresets.merge(baseHooks, HookPresets.monitoring({ verbose: true }));
   * const prodHooks = HookPresets.merge(baseHooks, HookPresets.tokenTracking());
   *
   * const hooks = process.env.NODE_ENV === 'production' ? prodHooks : devHooks;
   * .withHooks(hooks)
   * ```
   *
   * @see {@link https://github.com/zbigniewsobiecki/llmist/blob/main/docs/HOOKS.md#hookpresetsmergehooksets | Full documentation}
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
   * Composite preset combining logging, timing, tokenTracking, and errorLogging.
   *
   * This is the recommended preset for development and initial production deployments,
   * providing comprehensive observability with a single method call.
   *
   * **Includes:**
   * - All output from `logging()` preset (with optional verbosity)
   * - All output from `timing()` preset (execution times)
   * - All output from `tokenTracking()` preset (token usage)
   * - All output from `errorLogging()` preset (error details)
   *
   * **Output format:**
   * - Event logging: [LLM]/[GADGET] messages
   * - Timing: ⏱️ emoji with milliseconds
   * - Tokens: 📊 emoji with per-call and cumulative counts
   * - Errors: ❌ emoji with full error details
   *
   * **Use cases:**
   * - Full observability during development
   * - Comprehensive monitoring in production
   * - One-liner for complete agent visibility
   * - Troubleshooting and debugging with full context
   *
   * **Performance:** Combined overhead of all four presets, but still minimal in practice.
   *
   * @param options - Monitoring options
   * @param options.verbose - Passed to logging() preset for detailed output. Default: false
   * @returns Merged hook configuration combining all monitoring presets
   *
   * @example
   * ```typescript
   * // Basic monitoring (recommended for development)
   * await LLMist.createAgent()
   *   .withHooks(HookPresets.monitoring())
   *   .withGadgets(Calculator, Weather)
   *   .ask("What is 15 times 23, and what's the weather in NYC?");
   * // Output: All events, timing, tokens, and errors in one place
   * ```
   *
   * @example
   * ```typescript
   * // Verbose monitoring with full details
   * await LLMist.createAgent()
   *   .withHooks(HookPresets.monitoring({ verbose: true }))
   *   .ask("Your prompt");
   * // Output includes: parameters, results, and complete responses
   * ```
   *
   * @example
   * ```typescript
   * // Environment-based monitoring
   * const isDev = process.env.NODE_ENV === 'development';
   * .withHooks(HookPresets.monitoring({ verbose: isDev }))
   * ```
   *
   * @see {@link https://github.com/zbigniewsobiecki/llmist/blob/main/docs/HOOKS.md#hookpresetsmonitoringoptions | Full documentation}
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
