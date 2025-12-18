/**
 * Logging and debugging: Verbose output, custom loggers
 *
 * Run: bunx tsx examples/07-logging.ts
 */

import { createLogger, Gadget, HookPresets, LLMist, type ExecutionContext } from "llmist";
import { z } from "zod";

class Calculator extends Gadget({
  description: "Performs arithmetic",
  schema: z.object({
    a: z.number(),
    b: z.number(),
    op: z.enum(["add", "multiply"]),
  }),
}) {
  execute(params: this["params"]): string {
    const { a, b, op } = params;
    return op === "add" ? String(a + b) : String(a * b);
  }
}

// Gadget that uses ctx.logger for internal logging
class LoggingCalculator extends Gadget({
  description: "Performs arithmetic with detailed logging",
  schema: z.object({
    a: z.number(),
    b: z.number(),
    op: z.enum(["add", "multiply"]),
  }),
}) {
  execute(params: this["params"], ctx?: ExecutionContext): string {
    const { a, b, op } = params;

    // Use ctx.logger for structured logging
    // This respects CLI's --log-level and --log-file settings
    ctx?.logger?.debug("[LoggingCalculator] Starting calculation", {
      operation: op,
      operands: { a, b },
    });

    const result = op === "add" ? a + b : a * b;

    ctx?.logger?.info("[LoggingCalculator] Calculation complete", {
      result,
      operation: op,
    });

    return String(result);
  }
}

async function main() {
  console.log("=== Logging Examples ===\n");

  // ==========================================================================
  // 1. Basic logging preset
  // ==========================================================================
  console.log("1. HookPresets.logging():\n");

  await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .withHooks(HookPresets.logging())
    .askAndCollect("What is 7 + 5?");

  console.log();

  // ==========================================================================
  // 2. Verbose logging
  // ==========================================================================
  console.log("2. Verbose logging (shows parameters and results):\n");

  await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .withHooks(HookPresets.logging({ verbose: true }))
    .askAndCollect("Multiply 8 by 9");

  console.log();

  // ==========================================================================
  // 3. Full monitoring suite
  // ==========================================================================
  console.log("3. Full monitoring (logging + timing + tokens + errors):\n");

  await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .withHooks(HookPresets.monitoring())
    .askAndCollect("Add 100 and 200");

  console.log();

  // ==========================================================================
  // 4. Custom logger instance
  // ==========================================================================
  console.log("4. Custom logger with tslog:\n");

  const logger = createLogger({
    minLevel: "debug",
  });

  await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .withLogger(logger)
    .withHooks({
      observers: {
        onLLMCallStart: async (ctx) => {
          ctx.logger.debug(`Starting LLM call iteration ${ctx.iteration}`);
        },
        onLLMCallComplete: async (ctx) => {
          ctx.logger.info(`LLM completed with ${ctx.usage?.totalTokens ?? 0} tokens`);
        },
        onGadgetExecutionComplete: async (ctx) => {
          ctx.logger.debug(`Gadget ${ctx.gadgetName} completed in ${ctx.executionTimeMs}ms`);
        },
      },
    })
    .askAndCollect("What is 50 + 50?");

  console.log();

  // ==========================================================================
  // 5. Debug raw requests/responses
  // ==========================================================================
  console.log("5. Debug raw LLM interactions:\n");

  await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .withHooks({
      observers: {
        onLLMCallStart: async (ctx) => {
          console.log("--- REQUEST ---");
          console.log(`Model: ${ctx.options.model}`);
          console.log(`Messages: ${ctx.options.messages.length}`);
          ctx.options.messages.forEach((m, i) => {
            console.log(`  [${i}] ${m.role}: ${m.content?.slice(0, 50)}...`);
          });
        },
        onLLMCallComplete: async (ctx) => {
          console.log("--- RESPONSE ---");
          console.log(`Finish: ${ctx.finishReason}`);
          console.log(
            `Tokens: ${ctx.usage?.inputTokens ?? 0} in, ${ctx.usage?.outputTokens ?? 0} out`,
          );
          console.log(`Raw (first 100 chars): ${ctx.rawResponse.slice(0, 100)}...`);
        },
      },
    })
    .askAndCollect("Calculate 3 times 7");

  console.log();

  // ==========================================================================
  // 6. Error logging
  // ==========================================================================
  console.log("6. Error logging preset:\n");

  // This won't show errors since Calculator works, but demonstrates the pattern
  await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .withHooks(HookPresets.merge(HookPresets.logging(), HookPresets.errorLogging()))
    .askAndCollect("Add 1 and 1");

  console.log();

  // ==========================================================================
  // 7. Gadget internal logging with ctx.logger
  // ==========================================================================
  console.log("7. Gadget using ctx.logger (internal structured logging):\n");

  // When gadgets need to log internally, they can use ctx.logger
  // This logger is automatically configured with the CLI's settings
  // (--log-level, --log-file) so logs appear in the right place
  const debugLogger = createLogger({ minLevel: "debug" });

  await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(LoggingCalculator)
    .withLogger(debugLogger) // Logger is passed to gadgets via ctx.logger
    .askAndCollect("Multiply 6 by 7");

  console.log(`
Note: ctx.logger is especially useful for:
- External gadgets (npm packages) that need to respect CLI settings
- Complex gadgets with multiple steps that benefit from debug logging
- Structured logging with JSON-compatible metadata
`);

  console.log("\n=== Done ===");
}

main().catch(console.error);
