/**
 * Custom gadgets: Class-based vs functional, async, timeouts, schemas
 *
 * Run: bunx tsx examples/02-custom-gadgets.ts
 */

import { BreakLoopException, createGadget, Gadget, LLMist } from "llmist";
import { z } from "zod";

// =============================================================================
// CLASS-BASED GADGET (Full type safety)
// =============================================================================

class Calculator extends Gadget({
  description: "Performs arithmetic operations",
  schema: z.object({
    operation: z
      .enum(["add", "subtract", "multiply", "divide"])
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
      case "subtract":
        return String(a - b);
      case "multiply":
        return String(a * b);
      case "divide":
        return b !== 0 ? String(a / b) : "Error: Division by zero";
    }
  }
}

// =============================================================================
// FUNCTION-BASED GADGET (Simpler syntax)
// =============================================================================

const stringProcessor = createGadget({
  name: "StringProcessor",
  description: "Processes strings: reverse, uppercase, lowercase, length",
  schema: z.object({
    text: z.string().describe("The text string to process"),
    operation: z
      .enum(["reverse", "uppercase", "lowercase", "length"])
      .describe("String operation to apply"),
  }),
  execute: ({ text, operation }) => {
    switch (operation) {
      case "reverse":
        return text.split("").reverse().join("");
      case "uppercase":
        return text.toUpperCase();
      case "lowercase":
        return text.toLowerCase();
      case "length":
        return String(text.length);
    }
  },
});

// =============================================================================
// ASYNC GADGET WITH TIMEOUT
// =============================================================================

class DelayedResponse extends Gadget({
  description: "Returns a response after a delay (simulates API call)",
  schema: z.object({
    message: z.string().describe("Message to return after delay"),
    delayMs: z.number().min(0).max(5000).describe("Delay in milliseconds (0-5000)"),
  }),
  timeoutMs: 10000, // 10 second timeout
}) {
  async execute(params: this["params"]): Promise<string> {
    const { message, delayMs } = params;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return `After ${delayMs}ms: ${message}`;
  }
}

// =============================================================================
// COMPLEX NESTED SCHEMA
// =============================================================================

class DataProcessor extends Gadget({
  description: "Processes structured data",
  schema: z.object({
    user: z
      .object({
        name: z.string().describe("User full name"),
        age: z.number().optional().describe("User age in years"),
      })
      .describe("User information"),
    settings: z
      .object({
        format: z.enum(["json", "text"]).describe("Output format"),
        verbose: z.boolean().default(false).describe("Include extra details"),
      })
      .describe("Processing settings"),
    tags: z.array(z.string()).optional().describe("Optional tags to categorize"),
  }),
}) {
  execute(params: this["params"]): string {
    const { user, settings, tags } = params;

    if (settings.format === "json") {
      return JSON.stringify({ user, tags }, null, 2);
    }

    let result = `User: ${user.name}`;
    if (user.age) result += ` (${user.age})`;
    if (tags?.length) result += `\nTags: ${tags.join(", ")}`;
    if (settings.verbose) result += `\n[Verbose mode enabled]`;

    return result;
  }
}

// =============================================================================
// GADGET THAT BREAKS THE LOOP
// =============================================================================

class TaskComplete extends Gadget({
  description: "Call this when all tasks are complete",
  schema: z.object({
    summary: z.string().describe("Summary of what was accomplished"),
  }),
}) {
  execute(params: this["params"]): string {
    throw new BreakLoopException(params.summary);
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log("=== Custom Gadgets Examples ===\n");

  // Example 1: Multiple gadget types
  console.log("1. Using multiple gadget types together:");
  const answer1 = await LLMist.createAgent()
    .withModel("haiku")
    .withSystem("You have access to Calculator and StringProcessor. Use them to help.")
    .withGadgets(Calculator, stringProcessor)
    .askAndCollect('What is 10 * 5, and what is "hello" reversed?');

  console.log(`   ${answer1}\n`);

  // Example 2: Nested schema
  console.log("2. Complex nested schema:");
  const answer2 = await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(DataProcessor)
    .askAndCollect(
      "Process this user: John, age 30, with tags: developer, reader. Use JSON format.",
    );

  console.log(`   ${answer2}\n`);

  // Example 3: Async with delay
  console.log("3. Async gadget with simulated delay:");
  const answer3 = await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(DelayedResponse)
    .askAndCollect("Send a greeting with a 100ms delay");

  console.log(`   ${answer3}\n`);

  // Example 4: Breaking the loop
  console.log("4. Gadget that terminates the loop:");
  const answer4 = await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator, TaskComplete)
    .withMaxIterations(10)
    .askAndCollect("Calculate 5+5, then mark the task as complete with a summary.");

  console.log(`   ${answer4}\n`);

  console.log("=== Done ===");
}

main().catch(console.error);
