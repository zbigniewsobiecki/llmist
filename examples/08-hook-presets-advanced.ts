/**
 * Advanced HookPresets Patterns
 *
 * This file demonstrates advanced patterns for using HookPresets in production scenarios.
 * Each example shows a real-world use case with complete, working code.
 *
 * Run: bun examples/08-hook-presets-advanced.ts
 */

import { type AgentHooks, Gadget, HookPresets, LLMist, z } from "../src/index.js";

// Simple calculator for examples
class Calculator extends Gadget({
  description: "Performs arithmetic operations",
  schema: z.object({
    operation: z.enum(["add", "multiply", "subtract", "divide"]),
    a: z.number(),
    b: z.number(),
  }),
}) {
  execute(params: this["params"]): string {
    const { operation, a, b } = params;
    switch (operation) {
      case "add":
        return `${a + b}`;
      case "multiply":
        return `${a * b}`;
      case "subtract":
        return `${a - b}`;
      case "divide":
        return `${a / b}`;
    }
  }
}

// ============================================================================
// Example 1: Environment-based Configuration
// ============================================================================

async function example1_EnvironmentBasedConfig() {
  console.log("\n=== Example 1: Environment-Based Configuration ===\n");
  console.log("Different presets for dev/staging/prod environments\n");

  const env = process.env.NODE_ENV || "development";

  // Build hooks based on environment
  const hooks =
    env === "production"
      ? HookPresets.merge(
          HookPresets.errorLogging(), // Only errors in prod
          HookPresets.tokenTracking(), // Track costs
        )
      : env === "staging"
        ? HookPresets.merge(
            HookPresets.logging(), // Basic logs in staging
            HookPresets.errorLogging(),
          )
        : HookPresets.monitoring({ verbose: true }); // Full visibility in dev

  console.log(`Environment: ${env}`);
  console.log(
    `Hooks: ${env === "production" ? "errors + tokens" : env === "staging" ? "logging + errors" : "full monitoring"}\n`,
  );

  await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .withHooks(hooks)
    .askAndCollect("What is 10 + 5?");
}

// ============================================================================
// Example 2: Cost Monitoring with Budget Enforcement
// ============================================================================

async function example2_CostBudgetEnforcement() {
  console.log("\n=== Example 2: Cost Monitoring & Budget Enforcement ===\n");
  console.log("Track token usage and stop if budget exceeded\n");

  const BUDGET_TOKENS = 5000;
  let totalTokens = 0;

  const hooks = HookPresets.merge(HookPresets.tokenTracking(), {
    controllers: {
      beforeLLMCall: async (ctx) => {
        if (totalTokens >= BUDGET_TOKENS) {
          console.log(`\n🛑 Budget exceeded: ${totalTokens}/${BUDGET_TOKENS} tokens used`);
          throw new Error("Token budget exceeded");
        }
        return { action: "proceed" };
      },
    },
    observers: {
      onLLMCallComplete: async (ctx) => {
        totalTokens += ctx.usage?.totalTokens ?? 0;
        const remaining = BUDGET_TOKENS - totalTokens;
        const percentUsed = ((totalTokens / BUDGET_TOKENS) * 100).toFixed(1);
        console.log(`💰 Budget: ${remaining} tokens remaining (${percentUsed}% used)`);
      },
    },
  });

  await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .withHooks(hooks)
    .askAndCollect("Calculate 15 times 23");
}

// ============================================================================
// Example 3: Performance Profiling Suite
// ============================================================================

async function example3_PerformanceProfiling() {
  console.log("\n=== Example 3: Performance Profiling Suite ===\n");
  console.log("Collect comprehensive performance metrics\n");

  const metrics = {
    llmCalls: [] as number[],
    gadgetCalls: new Map<string, number[]>(),
  };

  const hooks = HookPresets.merge(HookPresets.timing(), {
    observers: {
      onLLMCallComplete: async (ctx) => {
        // Extract timing from context (set by timing preset)
        const duration = (ctx as any)._llmDuration;
        if (duration) metrics.llmCalls.push(duration);
      },
      onGadgetExecutionComplete: async (ctx) => {
        if (ctx.executionTimeMs) {
          if (!metrics.gadgetCalls.has(ctx.gadgetName)) {
            metrics.gadgetCalls.set(ctx.gadgetName, []);
          }
          metrics.gadgetCalls.get(ctx.gadgetName)!.push(ctx.executionTimeMs);
        }
      },
    },
  });

  await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .withHooks(hooks)
    .askAndCollect("What is 25 times 4?");

  // Print performance report
  console.log("\n📊 Performance Report:");
  if (metrics.llmCalls.length > 0) {
    const avgLLM = metrics.llmCalls.reduce((a, b) => a + b, 0) / metrics.llmCalls.length;
    console.log(`   Average LLM call: ${avgLLM.toFixed(0)}ms`);
  }
  metrics.gadgetCalls.forEach((times, name) => {
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`   Average ${name}: ${avg.toFixed(0)}ms (${times.length} calls)`);
  });
}

// ============================================================================
// Example 4: Structured Logging with Context Logger
// ============================================================================

async function example4_StructuredLogging() {
  console.log("\n=== Example 4: Structured Logging with Context Logger ===\n");
  console.log("Use ctx.logger for structured, production-ready logs\n");

  const hooks: AgentHooks = {
    observers: {
      onLLMCallStart: async (ctx) => {
        ctx.logger.info("LLM call starting", {
          iteration: ctx.iteration,
          model: ctx.options.model,
        });
      },
      onLLMCallComplete: async (ctx) => {
        ctx.logger.info("LLM call completed", {
          iteration: ctx.iteration,
          tokens: ctx.usage?.totalTokens,
          finishReason: ctx.finishReason,
        });
      },
      onGadgetExecutionComplete: async (ctx) => {
        ctx.logger.info("Gadget executed", {
          gadget: ctx.gadgetName,
          duration: ctx.executionTimeMs,
          success: !ctx.error,
        });
      },
    },
  };

  await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .withHooks(hooks)
    .askAndCollect("What is 100 divided by 4?");
}

// ============================================================================
// Example 5: Error Rate Monitoring (Circuit Breaker Pattern)
// ============================================================================

async function example5_ErrorRateMonitoring() {
  console.log("\n=== Example 5: Error Rate Monitoring (Circuit Breaker) ===\n");
  console.log("Track error frequency and implement circuit breaker\n");

  const errorWindow = {
    errors: [] as number[],
    windowMs: 60000, // 1 minute
    threshold: 3, // Max 3 errors per minute
  };

  function recordError(): number {
    const now = Date.now();
    errorWindow.errors = errorWindow.errors.filter((t) => now - t < errorWindow.windowMs);
    errorWindow.errors.push(now);
    return errorWindow.errors.length;
  }

  const hooks = HookPresets.merge(HookPresets.errorLogging(), {
    observers: {
      onLLMCallError: async (ctx) => {
        const errorCount = recordError();
        console.log(`⚠️  Error rate: ${errorCount}/${errorWindow.threshold} in last minute`);

        if (errorCount >= errorWindow.threshold) {
          console.log("🔴 Circuit breaker tripped - too many errors!");
          // In production, you might: pause execution, send alerts, switch to fallback
        }
      },
    },
  });

  await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .withHooks(hooks)
    .askAndCollect("Calculate 50 minus 25");
}

// ============================================================================
// Example 6: Conditional Preset Loading (Feature Flags)
// ============================================================================

async function example6_ConditionalPresets() {
  console.log("\n=== Example 6: Conditional Preset Loading (Feature Flags) ===\n");
  console.log("Enable/disable presets based on configuration\n");

  interface MonitoringConfig {
    enableLogging: boolean;
    enableTiming: boolean;
    enableTokenTracking: boolean;
    verboseMode: boolean;
  }

  function buildHooks(config: MonitoringConfig): AgentHooks {
    const hookSets: AgentHooks[] = [];

    if (config.enableLogging) {
      hookSets.push(HookPresets.logging({ verbose: config.verboseMode }));
    }
    if (config.enableTiming) {
      hookSets.push(HookPresets.timing());
    }
    if (config.enableTokenTracking) {
      hookSets.push(HookPresets.tokenTracking());
    }

    return hookSets.length > 0 ? HookPresets.merge(...hookSets) : HookPresets.silent();
  }

  // Simulated feature flags configuration
  const config: MonitoringConfig = {
    enableLogging: true,
    enableTiming: true,
    enableTokenTracking: false, // Cost tracking disabled
    verboseMode: false,
  };

  console.log("Config:", config, "\n");

  await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .withHooks(buildHooks(config))
    .askAndCollect("What is 7 times 8?");
}

// ============================================================================
// Example 7: Analytics Pipeline (External Metrics)
// ============================================================================

async function example7_AnalyticsPipeline() {
  console.log("\n=== Example 7: Analytics Pipeline (External Metrics) ===\n");
  console.log("Collect telemetry and send to external service (simulated)\n");

  // Simulated metrics collection
  const metrics: any[] = [];

  async function sendMetric(name: string, value: number, tags: Record<string, string> = {}) {
    // In production, this would be a real API call to DataDog, New Relic, etc.
    const metric = { name, value, tags, timestamp: Date.now() };
    metrics.push(metric);
    console.log(`   📤 Metric sent: ${name}=${value} ${JSON.stringify(tags)}`);
  }

  const hooks: AgentHooks = {
    observers: {
      onLLMCallComplete: async (ctx) => {
        void sendMetric("llm.tokens", ctx.usage?.totalTokens ?? 0, {
          model: ctx.options.model ?? "unknown",
          iteration: String(ctx.iteration),
        });
      },
      onGadgetExecutionComplete: async (ctx) => {
        void sendMetric("gadget.duration", ctx.executionTimeMs ?? 0, {
          gadget: ctx.gadgetName,
          status: ctx.error ? "error" : "success",
        });
      },
    },
  };

  await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .withHooks(hooks)
    .askAndCollect("What is 144 divided by 12?");

  console.log(`\n📊 Collected ${metrics.length} metrics for external service`);
}

// ============================================================================
// Run all examples
// ============================================================================

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║       Advanced HookPresets Patterns Examples              ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  try {
    await example1_EnvironmentBasedConfig();
    await example2_CostBudgetEnforcement();
    await example3_PerformanceProfiling();
    await example4_StructuredLogging();
    await example5_ErrorRateMonitoring();
    await example6_ConditionalPresets();
    await example7_AnalyticsPipeline();

    console.log("\n✅ All examples completed successfully!\n");
  } catch (error) {
    console.error("\n❌ Error running examples:", error);
    process.exit(1);
  }
}

main();
