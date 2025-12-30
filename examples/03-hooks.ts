/**
 * Hooks: Presets, custom observers, interceptors, controllers
 *
 * Run: npx tsx examples/03-hooks.ts
 */

import { Gadget, HookPresets, LLMist } from "llmist";
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

async function main() {
  console.log("=== Hooks Examples ===\n");

  // ==========================================================================
  // Example 1: Built-in presets
  // ==========================================================================
  console.log("1. Using HookPresets.logging():");
  console.log("---");

  await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .withHooks(HookPresets.logging())
    .askAndCollect("What is 5 + 3?");

  console.log("---\n");

  // ==========================================================================
  // Example 2: Verbose logging
  // ==========================================================================
  console.log("2. Verbose logging with parameters/results:");
  console.log("---");

  await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .withHooks(HookPresets.logging({ verbose: true }))
    .askAndCollect("Multiply 7 by 8");

  console.log("---\n");

  // ==========================================================================
  // Example 3: Combined presets
  // ==========================================================================
  console.log("3. Combined presets (logging + timing + tokens):");
  console.log("---");

  await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .withHooks(
      HookPresets.merge(HookPresets.logging(), HookPresets.timing(), HookPresets.tokenTracking()),
    )
    .askAndCollect("Add 10 and 20");

  console.log("---\n");

  // ==========================================================================
  // Example 4: Custom observers
  // ==========================================================================
  console.log("4. Custom observers for analytics:");
  console.log("---");

  const metrics = {
    llmCalls: 0,
    gadgetCalls: 0,
    totalTokens: 0,
  };

  await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .withHooks({
      observers: {
        onLLMCallComplete: async (ctx) => {
          metrics.llmCalls++;
          metrics.totalTokens += ctx.usage?.totalTokens ?? 0;
        },
        onGadgetExecutionComplete: async (ctx) => {
          metrics.gadgetCalls++;
          console.log(`   [Custom] Gadget ${ctx.gadgetName} took ${ctx.executionTimeMs}ms`);
        },
      },
    })
    .askAndCollect("Calculate 100 + 200, then 50 * 2");

  console.log(`   Metrics: ${JSON.stringify(metrics)}`);
  console.log("---\n");

  // ==========================================================================
  // Example 5: Interceptors (transform data)
  // ==========================================================================
  console.log("5. Interceptors - transform text output:");
  console.log("---");

  const answer = await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .withHooks({
      interceptors: {
        // Transform text chunks to uppercase
        interceptTextChunk: (chunk) => chunk.toUpperCase(),

        // Add prefix to gadget results
        interceptGadgetResult: (result, ctx) => {
          return `[${ctx.gadgetName}] ${result}`;
        },
      },
    })
    .askAndCollect("What is 3 + 4?");

  console.log(`   Result (uppercased): ${answer}`);
  console.log("---\n");

  // ==========================================================================
  // Example 6: Merging custom hooks with presets
  // ==========================================================================
  console.log("6. Merging custom hooks with presets:");
  console.log("---");

  await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .withHooks(
      HookPresets.merge(HookPresets.timing(), {
        observers: {
          onLLMCallStart: async (ctx) => {
            console.log(`   [Custom] Starting iteration ${ctx.iteration}...`);
          },
          onGadgetExecutionStart: async (ctx) => {
            console.log(`   [Custom] About to execute: ${ctx.gadgetName}`);
          },
        },
      }),
    )
    .askAndCollect("Multiply 6 by 7");

  console.log("---\n");

  console.log("=== Done ===");
}

main().catch(console.error);
