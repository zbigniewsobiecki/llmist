/**
 * LLM Assistance Hints Examples
 *
 * This file demonstrates the hints system that helps guide LLM behavior
 * during agentic execution. Hints provide coaching messages to help LLMs
 * work more efficiently.
 *
 * Run: npx tsx examples/14-hints.ts
 */

import {
  createHints,
  DEFAULT_HINTS,
  Gadget,
  HookPresets,
  iterationProgressHint,
  LLMist,
  parallelGadgetHint,
  z,
} from "../src/index.js";

// Example gadgets for demonstration
class ReadFile extends Gadget({
  description: "Read a file from disk",
  schema: z.object({
    path: z.string().describe("Path to the file"),
  }),
}) {
  execute(params: this["params"]): string {
    return `Contents of ${params.path}: [simulated file contents]`;
  }
}

class WriteFile extends Gadget({
  description: "Write content to a file",
  schema: z.object({
    path: z.string().describe("Path to the file"),
    content: z.string().describe("Content to write"),
  }),
}) {
  execute(params: this["params"]): string {
    return `Successfully wrote ${params.content.length} characters to ${params.path}`;
  }
}

class SearchFiles extends Gadget({
  description: "Search for files matching a pattern",
  schema: z.object({
    pattern: z.string().describe("Search pattern"),
  }),
}) {
  execute(params: this["params"]): string {
    return `Found 3 files matching "${params.pattern}": file1.ts, file2.ts, file3.ts`;
  }
}

// ============================================================================
// Example 1: Iteration Progress Hints
// ============================================================================

async function example1_IterationProgressHints() {
  console.log("\n=== Example 1: Iteration Progress Hints ===\n");
  console.log("LLM receives iteration context to help plan work\n");

  // Show what the default hint looks like
  console.log("Default hint template:", DEFAULT_HINTS.iterationProgressHint);
  console.log("");

  // Track messages to see the hint injection
  const messagesReceived: string[] = [];

  const hooks = HookPresets.merge(iterationProgressHint({ timing: "always" }), {
    controllers: {
      beforeLLMCall: async (ctx) => {
        // Log what messages the LLM will see
        const hintMessage = ctx.options.messages.find((m) => m.content.includes("[System Hint]"));
        if (hintMessage) {
          messagesReceived.push(hintMessage.content);
          console.log(`   💡 Hint injected: "${hintMessage.content}"`);
        }
        return { action: "proceed" };
      },
    },
  });

  await LLMist.createAgent()
    .withModel("haiku")
    .withMaxIterations(5)
    .withGadgets(SearchFiles)
    .withHooks(hooks)
    .askAndCollect("Search for typescript files");

  console.log(`\n   Total hints injected: ${messagesReceived.length}`);
}

// ============================================================================
// Example 2: Late Timing for Iteration Hints
// ============================================================================

async function example2_LateTimingHints() {
  console.log("\n=== Example 2: Late Timing - Only Show When Running Low ===\n");
  console.log("Hints only appear when >= 50% through iterations\n");

  let hintCount = 0;

  const hooks = HookPresets.merge(iterationProgressHint({ timing: "late", showUrgency: true }), {
    controllers: {
      beforeLLMCall: async (ctx) => {
        const hintMessage = ctx.options.messages.find((m) => m.content.includes("[System Hint]"));
        if (hintMessage) {
          hintCount++;
          console.log(
            `   💡 [Iteration ${ctx.iteration + 1}/${ctx.maxIterations}] Hint shown: "${hintMessage.content.slice(0, 60)}..."`,
          );
        } else {
          console.log(
            `   ⏭️  [Iteration ${ctx.iteration + 1}/${ctx.maxIterations}] No hint (too early)`,
          );
        }
        return { action: "proceed" };
      },
    },
  });

  await LLMist.createAgent()
    .withModel("haiku")
    .withMaxIterations(6)
    .withGadgets(SearchFiles)
    .withHooks(hooks)
    .askAndCollect("Search for files multiple times");

  console.log(`\n   Hints shown: ${hintCount} (only in later iterations)`);
}

// ============================================================================
// Example 3: Parallel Gadget Hints
// ============================================================================

async function example3_ParallelGadgetHints() {
  console.log("\n=== Example 3: Parallel Gadget Hints ===\n");
  console.log("Encourage LLM to call multiple gadgets when it only calls one\n");

  const hooks = HookPresets.merge(parallelGadgetHint(), {
    controllers: {
      afterLLMCall: async (ctx) => {
        console.log(`   📊 Gadget calls in response: ${ctx.gadgetCallCount}`);
        if (ctx.gadgetCallCount === 1) {
          console.log(`   💡 Parallel gadget hint will be appended`);
        }
        return { action: "continue" };
      },
    },
  });

  await LLMist.createAgent()
    .withModel("haiku")
    .withMaxIterations(3)
    .withGadgets(ReadFile, WriteFile, SearchFiles)
    .withHooks(hooks)
    .askAndCollect("Read the file config.json");
}

// ============================================================================
// Example 4: Custom Templates
// ============================================================================

async function example4_CustomTemplates() {
  console.log("\n=== Example 4: Custom Templates ===\n");
  console.log("Use custom hint messages for your use case\n");

  // Custom string template with placeholders
  const stringTemplateHooks = iterationProgressHint({
    template: "🔄 Step {iteration}/{maxIterations} - {remaining} steps remaining",
    timing: "always",
  });

  // Custom function template for dynamic messages
  const functionTemplateHooks = iterationProgressHint({
    template: (ctx) => {
      const progress = (ctx.iteration / ctx.maxIterations) * 100;
      if (progress < 33) return "🟢 Plenty of time - explore freely";
      if (progress < 66) return "🟡 Midway through - stay focused";
      return "🔴 Final stretch - wrap up the task";
    },
    timing: "always",
  });

  console.log("String template example:");
  await LLMist.createAgent()
    .withModel("haiku")
    .withMaxIterations(3)
    .withGadgets(SearchFiles)
    .withHooks(
      HookPresets.merge(stringTemplateHooks, {
        controllers: {
          beforeLLMCall: async (ctx) => {
            const hint = ctx.options.messages.find((m) => m.content.includes("[System Hint]"));
            if (hint) console.log(`   ${hint.content.replace("[System Hint] ", "")}`);
            return { action: "proceed" };
          },
        },
      }),
    )
    .askAndCollect("Find files");

  console.log("\nFunction template example:");
  await LLMist.createAgent()
    .withModel("haiku")
    .withMaxIterations(3)
    .withGadgets(SearchFiles)
    .withHooks(
      HookPresets.merge(functionTemplateHooks, {
        controllers: {
          beforeLLMCall: async (ctx) => {
            const hint = ctx.options.messages.find((m) => m.content.includes("[System Hint]"));
            if (hint) console.log(`   ${hint.content.replace("[System Hint] ", "")}`);
            return { action: "proceed" };
          },
        },
      }),
    )
    .askAndCollect("Find files");
}

// ============================================================================
// Example 5: Combined Hints with createHints()
// ============================================================================

async function example5_CombinedHints() {
  console.log("\n=== Example 5: Combined Hints with createHints() ===\n");
  console.log("Use createHints() for easy configuration\n");

  const hints = createHints({
    iterationProgress: { timing: "late" },
    parallelGadgets: { minGadgetsForEfficiency: 2 },
  });

  console.log("Configuration:");
  console.log('  - Iteration hints: timing="late" (show at >= 50%)');
  console.log("  - Parallel hints: minGadgetsForEfficiency=2");
  console.log("");

  await LLMist.createAgent()
    .withModel("haiku")
    .withMaxIterations(5)
    .withGadgets(ReadFile, WriteFile, SearchFiles)
    .withHooks(HookPresets.merge(hints, HookPresets.logging({ verbose: false })))
    .askAndCollect("Search for config files and read the first one");
}

// ============================================================================
// Example 6: Production Setup with Hints
// ============================================================================

async function example6_ProductionSetup() {
  console.log("\n=== Example 6: Production Setup with Hints ===\n");
  console.log("Combine hints with other presets for production use\n");

  const productionHooks = HookPresets.merge(
    // Standard production monitoring
    HookPresets.errorLogging(),
    HookPresets.tokenTracking(),

    // LLM assistance hints
    createHints({
      iterationProgress: { timing: "late", showUrgency: true },
      parallelGadgets: true,
    }),
  );

  console.log("Production hooks configured:");
  console.log("  - Error logging");
  console.log("  - Token tracking");
  console.log("  - Iteration progress (late timing with urgency)");
  console.log("  - Parallel gadget hints");
  console.log("");

  await LLMist.createAgent()
    .withModel("haiku")
    .withMaxIterations(10)
    .withGadgets(ReadFile, WriteFile, SearchFiles)
    .withHooks(productionHooks)
    .askAndCollect("Search for and read the config file");
}

// ============================================================================
// Run all examples
// ============================================================================

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║          LLM Assistance Hints Examples                     ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  try {
    await example1_IterationProgressHints();
    await example2_LateTimingHints();
    await example3_ParallelGadgetHints();
    await example4_CustomTemplates();
    await example5_CombinedHints();
    await example6_ProductionSetup();

    console.log("\n✅ All examples completed successfully!\n");
  } catch (error) {
    console.error("\n❌ Error running examples:", error);
    process.exit(1);
  }
}

main();
