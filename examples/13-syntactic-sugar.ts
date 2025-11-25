/**
 * Syntactic sugar: Fluent API showcase
 *
 * Run: bunx tsx examples/13-syntactic-sugar.ts
 */

import { createGadget, Gadget, HookPresets, LLMist } from "llmist";
import { z } from "zod";

// =============================================================================
// GADGETS
// =============================================================================

// Class-based with full type safety
class Calculator extends Gadget({
  description: "Performs arithmetic operations",
  schema: z.object({
    operation: z
      .enum(["add", "subtract", "multiply", "divide"])
      .describe("Math operation to perform"),
    a: z.number().describe("First number"),
    b: z.number().describe("Second number"),
  }),
}) {
  execute(params: this["params"]): string {
    const { operation, a, b } = params;
    switch (operation) {
      case "add":
        return String(a + b);
      case "subtract":
        return String(a - b);
      case "multiply":
        return String(a * b);
      case "divide":
        return String(a / b);
    }
  }
}

// Functional for quick one-offs
const weather = createGadget({
  name: "Weather",
  description: "Gets weather for a city",
  schema: z.object({ city: z.string().describe("City name to get weather for") }),
  execute: ({ city }) => `${city}: 72°F, Sunny`,
});

async function main() {
  console.log("=== Fluent API Showcase ===\n");

  // ==========================================================================
  // Minimal agent
  // ==========================================================================
  console.log("1. Minimal agent:\n");

  const answer1 = await LLMist.createAgent().withModel("haiku").askAndCollect("What is 2 + 2?");

  console.log(`   "${answer1}"\n`);

  // ==========================================================================
  // Agent with gadgets
  // ==========================================================================
  console.log("2. Agent with gadgets:\n");

  const answer2 = await LLMist.createAgent()
    .withModel("haiku")
    .withSystem("You are a helpful math assistant.")
    .withGadgets(Calculator)
    .askAndCollect("What is 15 * 23?");

  console.log(`   "${answer2}"\n`);

  // ==========================================================================
  // Mixed gadget types
  // ==========================================================================
  console.log("3. Mixed gadget types (class + functional):\n");

  const answer3 = await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator, weather)
    .askAndCollect("What's the weather in Tokyo and what is 100 / 4?");

  console.log(`   "${answer3}"\n`);

  // ==========================================================================
  // Full configuration
  // ==========================================================================
  console.log("4. Full configuration:\n");

  const answer4 = await LLMist.createAgent()
    .withModel("haiku")
    .withSystem("You are a precise calculator.")
    .withTemperature(0.1)
    .withMaxIterations(5)
    .withGadgets(Calculator)
    .withHooks(HookPresets.logging())
    .askAndCollect("Calculate 7 * 8");

  console.log(`\n   "${answer4}"\n`);

  // ==========================================================================
  // Conversation history
  // ==========================================================================
  console.log("5. With conversation history:\n");

  const answer5 = await LLMist.createAgent()
    .withModel("haiku")
    .withHistory([{ user: "My favorite color is blue." }, { assistant: "That's a nice color!" }])
    .askAndCollect("What's my favorite color?");

  console.log(`   "${answer5}"\n`);

  // ==========================================================================
  // Event handlers
  // ==========================================================================
  console.log("6. Event handlers with askWith:\n");
  process.stdout.write("   ");

  await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .askWith("What is 9 + 16?", {
      onText: (text) => process.stdout.write(text),
      onGadgetCall: (call) => console.log(`\n   [${call.gadgetName}]`),
      onGadgetResult: (r) => {
        console.log(`   [= ${r.result}]`);
        process.stdout.write("   ");
      },
    });

  console.log("\n");

  // ==========================================================================
  // Quick methods (no agent)
  // ==========================================================================
  console.log("7. Quick methods (no agent setup):\n");

  // Static completion
  const quick1 = await LLMist.complete("Say hello in French", { model: "haiku" });
  console.log(`   Complete: "${quick1}"`);

  // Streaming
  process.stdout.write('   Stream: "');
  for await (const chunk of LLMist.stream("Count to 5", { model: "haiku" })) {
    process.stdout.write(chunk);
  }
  console.log('"');

  // ==========================================================================
  // Model shortcuts
  // ==========================================================================
  console.log("\n8. Model shortcuts:\n");

  const shortcuts = [
    ["haiku", "anthropic:claude-haiku-4-5-20251001"],
    ["sonnet", "anthropic:claude-sonnet-4-5-20250929"],
    ["gpt5-mini", "openai:gpt-5-mini"],
    ["flash", "gemini:gemini-2.5-flash"],
  ];

  for (const [short, full] of shortcuts) {
    console.log(`   ${short.padEnd(12)} → ${full}`);
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
