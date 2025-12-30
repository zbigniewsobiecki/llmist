/**
 * Basic llmist usage: Calculator agent
 *
 * Run: npx tsx examples/01-basic-usage.ts
 */

import { Gadget, LLMist } from "llmist";
import { z } from "zod";

// Define a gadget (tool) with Zod schema for type safety
class Calculator extends Gadget({
  description: "Performs arithmetic operations on two numbers",
  schema: z.object({
    operation: z
      .enum(["add", "multiply", "subtract", "divide"])
      .describe("Arithmetic operation to perform"),
    a: z.number().describe("First number"),
    b: z.number().describe("Second number"),
  }),
}) {
  execute(params: this["params"]): string {
    const { operation, a, b } = params; // Fully typed!

    switch (operation) {
      case "add":
        return String(a + b);
      case "multiply":
        return String(a * b);
      case "subtract":
        return String(a - b);
      case "divide":
        if (b === 0) return "Error: Division by zero";
        return String(a / b);
    }
  }
}

async function main() {
  console.log("=== Basic llmist Usage ===\n");

  // Method 1: askAndCollect - get final text response
  console.log("1. Simple query with askAndCollect:");
  const answer = await LLMist.createAgent()
    .withModel("haiku") // Use Claude Haiku (fast and cheap)
    .withSystem("You are a helpful math assistant. Use the calculator for arithmetic.")
    .withGadgets(Calculator)
    .askAndCollect("What is 15 times 23?");

  console.log(`   Answer: ${answer}\n`);

  // Method 2: askWith - handle events as they happen
  console.log("2. Event-driven with askWith:");
  await LLMist.createAgent()
    .withModel("haiku")
    .withSystem("You are a helpful math assistant.")
    .withGadgets(Calculator)
    .askWith("Calculate 100 divided by 4, then add 50", {
      onText: (text) => process.stdout.write(text),
      onGadgetCall: (call) => console.log(`\n   [Calling ${call.gadgetName}]`),
      onGadgetResult: (result) => console.log(`   [Result: ${result.result}]`),
    });

  console.log("\n");

  // Method 3: Manual iteration with run()
  console.log("3. Manual streaming with run():");
  const agent = LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .ask("What is 7 plus 8?");

  for await (const event of agent.run()) {
    if (event.type === "text") {
      process.stdout.write(event.content);
    } else if (event.type === "gadget_result") {
      console.log(`\n   [Gadget returned: ${event.result.result}]`);
    }
  }

  console.log("\n\n=== Done ===");
}

main().catch(console.error);
