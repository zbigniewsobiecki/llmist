/**
 * Streaming: Event handling patterns
 *
 * Run: bunx tsx examples/05-streaming.ts
 */

import { collectEvents, collectText, Gadget, LLMist, runWithHandlers } from "llmist";
import { z } from "zod";

class Calculator extends Gadget({
  description: "Performs arithmetic",
  schema: z.object({
    a: z.number(),
    b: z.number(),
    op: z.enum(["add", "multiply", "subtract", "divide"]),
  }),
}) {
  execute(params: this["params"]): string {
    const { a, b, op } = params;
    switch (op) {
      case "add":
        return String(a + b);
      case "multiply":
        return String(a * b);
      case "subtract":
        return String(a - b);
      case "divide":
        return b !== 0 ? String(a / b) : "Error: Division by zero";
    }
  }
}

async function main() {
  console.log("=== Streaming Examples ===\n");

  // ==========================================================================
  // Method 1: askAndCollect (simplest)
  // ==========================================================================
  console.log("1. askAndCollect - get final text:");

  const answer1 = await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .askAndCollect("What is 25 + 17?");

  console.log(`   "${answer1}"\n`);

  // ==========================================================================
  // Method 2: askWith - named event handlers
  // ==========================================================================
  console.log("2. askWith - event handlers:");
  process.stdout.write("   ");

  await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .askWith("Calculate 100 divided by 4", {
      onText: (text) => process.stdout.write(text),
      onGadgetCall: (call) => console.log(`\n   [Calling ${call.gadgetName}]`),
      onGadgetResult: (result) => console.log(`   [Result: ${result.result}]`),
    });

  console.log("\n");

  // ==========================================================================
  // Method 3: run() - manual iteration
  // ==========================================================================
  console.log("3. run() - manual streaming:");
  process.stdout.write("   ");

  const agent = LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .ask("What is 8 times 9?");

  for await (const event of agent.run()) {
    switch (event.type) {
      case "text":
        process.stdout.write(event.content);
        break;
      case "gadget_call":
        console.log(`\n   [Gadget: ${event.call.gadgetName}]`);
        break;
      case "gadget_result":
        console.log(`   [Result: ${event.result.result}]`);
        process.stdout.write("   ");
        break;
    }
  }

  console.log("\n");

  // ==========================================================================
  // Method 4: collectText helper
  // ==========================================================================
  console.log("4. collectText helper:");

  const agent2 = LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .ask("Add 50 and 50");

  const text = await collectText(agent2.run());
  console.log(`   "${text}"\n`);

  // ==========================================================================
  // Method 5: collectEvents helper
  // ==========================================================================
  console.log("5. collectEvents - structured collection:");

  const agent3 = LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .ask("Calculate 10 + 5, then 20 * 3");

  const collected = await collectEvents(agent3.run(), {
    text: true,
    gadgetCalls: true,
    gadgetResults: true,
  });

  console.log(`   Text chunks: ${collected.text.length}`);
  console.log(`   Gadget calls: ${collected.gadgetCalls.length}`);
  console.log(`   Gadget results: ${collected.gadgetResults.length}`);
  collected.gadgetResults.forEach((r, i) => {
    console.log(`     ${i + 1}. ${r.gadgetName}: ${r.result}`);
  });

  console.log();

  // ==========================================================================
  // Method 6: runWithHandlers helper
  // ==========================================================================
  console.log("6. runWithHandlers - reusable handler pattern:");

  const handlers = {
    onText: (text: string) => process.stdout.write(text),
    onGadgetCall: (call: { gadgetName: string }) => {
      console.log(`\n   >>> ${call.gadgetName}`);
    },
    onGadgetResult: (result: { result?: string }) => {
      console.log(`   <<< ${result.result}`);
      process.stdout.write("   ");
    },
  };

  const agent4 = LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .ask("What is 7 + 7?");

  process.stdout.write("   ");
  await runWithHandlers(agent4.run(), handlers);

  console.log("\n\n=== Done ===");
}

main().catch(console.error);
