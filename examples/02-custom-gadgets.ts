/**
 * Custom gadgets: Class-based vs functional, async, timeouts, schemas
 *
 * Run: bunx tsx examples/02-custom-gadgets.ts
 */

import { BreakLoopException, createGadget, Gadget, HookPresets, LLMist, ModelRegistry } from "llmist";
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
// GADGET WITH COST REPORTING
// =============================================================================

// Simulates a paid API call - returns { result, cost } instead of just string
const paidApiGadget = createGadget({
  name: "PaidAPI",
  description: "Simulates a paid API call that costs $0.001 per request",
  schema: z.object({
    query: z.string().describe("The query to send to the API"),
  }),
  execute: ({ query }) => {
    // Simulate API response
    const response = `API response for: "${query}"`;

    // Return result with cost - this will be tracked in progressTracking
    return {
      result: response,
      cost: 0.001, // $0.001 per API call
    };
  },
});

// Class-based gadget with cost reporting
class PremiumCalculator extends Gadget({
  description: "Premium calculator that costs $0.0005 per calculation",
  schema: z.object({
    expression: z.string().describe("Math expression to evaluate (e.g., '2 + 2')"),
  }),
}) {
  execute(params: this["params"]) {
    const { expression } = params;
    // Simple eval for demo - in production, use a safe math parser
    const evalResult = Function(`"use strict"; return (${expression})`)();

    return {
      result: `${expression} = ${evalResult}`,
      cost: 0.0005, // $0.0005 per calculation
    };
  }
}

// =============================================================================
// LLM-POWERED GADGET (passes internal LLM costs as gadget costs)
// =============================================================================

// This gadget uses an internal LLM call and reports those costs
class Summarizer extends Gadget({
  description: "Summarizes text using an internal LLM call",
  schema: z.object({
    text: z.string().describe("Text to summarize"),
  }),
}) {
  private client = new LLMist();
  private modelRegistry = new ModelRegistry();

  async execute(params: this["params"]) {
    const { text } = params;

    // Track tokens for cost calculation
    let inputTokens = 0;
    let outputTokens = 0;
    let summary = "";

    // Use LLMist.complete() for the internal LLM call
    for await (const chunk of this.client.complete({
      model: "haiku", // Use a fast, cheap model
      messages: [{ role: "user", content: `Summarize briefly: ${text}` }],
    })) {
      summary += chunk.text;
      if (chunk.usage) {
        inputTokens = chunk.usage.inputTokens;
        outputTokens = chunk.usage.outputTokens;
      }
    }

    // Calculate the internal LLM cost
    const costEstimate = this.modelRegistry.estimateCost(
      "claude-3-5-haiku-20241022",
      inputTokens,
      outputTokens,
    );

    // Return result with the LLM cost passed through
    return {
      result: summary.trim(),
      cost: costEstimate?.totalCost ?? 0,
    };
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

  // Example 5: Gadgets with cost reporting
  console.log("5. Gadgets with cost tracking:");
  let totalCost = 0;
  const modelRegistry = new ModelRegistry();

  const answer5 = await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(paidApiGadget, PremiumCalculator)
    .withHooks(
      HookPresets.progressTracking({
        modelRegistry,
        onProgress: (stats) => {
          totalCost = stats.totalCost;
        },
      }),
    )
    .askAndCollect("Query the API for 'weather' and calculate 10 * 5 + 3");

  console.log(`   ${answer5}`);
  console.log(`   Total cost (LLM + gadgets): $${totalCost.toFixed(6)}\n`);

  console.log("=== Done ===");
}

main().catch(console.error);
