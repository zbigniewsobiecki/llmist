/**
 * Custom gadgets: Class-based vs functional, async, timeouts, schemas
 *
 * Run: npx tsx examples/02-custom-gadgets.ts
 */

import {
  TaskCompletionSignal,
  createGadget,
  type ExecutionContext,
  Gadget,
  gadgetError,
  gadgetSuccess,
  HookPresets,
  LLMist,
  ModelRegistry,
  withErrorHandling,
} from "llmist";
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
// RESPONSE FORMATTING HELPERS
// =============================================================================

// Using gadgetSuccess() and gadgetError() for consistent response formatting
class DatabaseQuery extends Gadget({
  description: "Query a database with proper response formatting",
  schema: z.object({
    table: z.string().describe("Table name to query"),
    limit: z.number().default(10).describe("Maximum rows to return"),
  }),
}) {
  async execute(params: this["params"]): Promise<string> {
    try {
      // Simulate database query
      const rows = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ];
      return gadgetSuccess({
        rowCount: rows.length,
        data: rows.slice(0, params.limit),
      });
      // Returns: '{"success":true,"rowCount":2,"data":[...]}'
    } catch (error) {
      return gadgetError("Query failed", { table: params.table });
      // Returns: '{"error":"Query failed","table":"users"}'
    }
  }
}

// Function-based with automatic error handling using withErrorHandling()
const riskyOperation = createGadget({
  name: "RiskyOperation",
  description: "Operation that might fail - errors are automatically caught",
  schema: z.object({
    id: z.string().describe("Resource ID to process"),
    shouldFail: z.boolean().default(false).describe("Set to true to simulate failure"),
  }),
  execute: withErrorHandling(async ({ id, shouldFail }) => {
    if (shouldFail) {
      throw new Error(`Failed to process resource: ${id}`);
    }
    return gadgetSuccess({ processed: id, timestamp: Date.now() });
  }),
  // If execute throws, automatically returns: '{"error":"Failed to process resource: xyz"}'
});

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
    throw new TaskCompletionSignal(params.summary);
  }
}

// =============================================================================
// CALLBACK-BASED COST REPORTING (Recommended)
// =============================================================================

// Using ctx.reportCost() for incremental cost reporting
const multiStepApiGadget = createGadget({
  name: "MultiStepAPI",
  description: "Calls multiple APIs and reports costs incrementally",
  schema: z.object({
    query: z.string().describe("Query to process"),
  }),
  execute: async ({ query }, ctx) => {
    // First API call - simulate with delay
    await new Promise((resolve) => setTimeout(resolve, 10));
    ctx.reportCost(0.001); // $0.001 for first API

    // Second API call
    await new Promise((resolve) => setTimeout(resolve, 10));
    ctx.reportCost(0.002); // $0.002 for second API

    return `Processed query: "${query}" through 2 API calls`;
    // Total callback cost: $0.003
  },
});

// =============================================================================
// LLM-POWERED GADGET WITH AUTO COST TRACKING (Simplified!)
// =============================================================================

// Using ctx.llmist for automatic LLM cost reporting - much simpler!
class Summarizer extends Gadget({
  description: "Summarizes text using ctx.llmist (costs auto-reported)",
  schema: z.object({
    text: z.string().describe("Text to summarize"),
  }),
}) {
  async execute(params: this["params"], ctx: ExecutionContext) {
    const { text } = params;

    // ctx.llmist is only available when running within an agent context.
    // It will be undefined when run via CLI "gadget run" or direct testing.
    if (!ctx.llmist) {
      return "LLM not available - this gadget requires agent context";
    }

    // LLM costs are automatically reported via ctx.llmist!
    // No need to manually track tokens or calculate costs
    const summary = await ctx.llmist.complete(`Summarize briefly: ${text}`, { model: "haiku" });

    return summary;
  }
}

// =============================================================================
// COMBINING ALL COST SOURCES
// =============================================================================

// Class-based gadget combining callback, auto-LLM, and return costs
class PremiumAnalyzer extends Gadget({
  description: "Analyzes data with multiple cost sources",
  schema: z.object({
    data: z.string().describe("Data to analyze"),
  }),
}) {
  async execute(params: this["params"], ctx: ExecutionContext) {
    const { data } = params;

    // Source 1: Manual callback cost
    await new Promise((resolve) => setTimeout(resolve, 10));
    ctx.reportCost(0.001); // External API cost

    // Source 2: Automatic LLM cost via ctx.llmist (check availability first)
    if (!ctx.llmist) {
      return {
        result: "LLM not available - this gadget requires agent context",
        cost: 0.001, // Still report the callback cost
      };
    }
    const analysis = await ctx.llmist.complete(`Analyze this data: ${data}`, { model: "haiku" });

    // Source 3: Return-based cost (all three are summed)
    return {
      result: analysis,
      cost: 0.0005, // Processing overhead
    };
  }
}

// =============================================================================
// RETURN-BASED COST REPORTING (Simple cases)
// =============================================================================

// Simulates a paid API call - returns { result, cost }
const paidApiGadget = createGadget({
  name: "PaidAPI",
  description: "Simulates a paid API call ($0.001 per request)",
  schema: z.object({
    query: z.string().describe("The query to send to the API"),
  }),
  execute: ({ query }) => {
    // Return result with cost
    return {
      result: `API response for: "${query}"`,
      cost: 0.001, // $0.001 per API call
    };
  },
});

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

  // Example 5: Callback-based cost tracking
  console.log("5. Callback-based cost reporting (ctx.reportCost):");
  let totalCost5 = 0;
  const modelRegistry5 = new ModelRegistry();

  const answer5 = await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(multiStepApiGadget, paidApiGadget)
    .withHooks(
      HookPresets.progressTracking({
        modelRegistry: modelRegistry5,
        onProgress: (stats) => {
          totalCost5 = stats.totalCost;
        },
      }),
    )
    .askAndCollect(
      "Process 'weather data' through MultiStepAPI and also query PaidAPI for 'forecast'",
    );

  console.log(`   ${answer5}`);
  console.log(`   Total cost (LLM + gadgets): $${totalCost5.toFixed(6)}\n`);

  // Example 6: Auto LLM cost tracking via ctx.llmist
  console.log("6. Auto LLM cost tracking (ctx.llmist):");
  let totalCost6 = 0;
  const modelRegistry6 = new ModelRegistry();

  const answer6 = await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Summarizer)
    .withHooks(
      HookPresets.progressTracking({
        modelRegistry: modelRegistry6,
        onProgress: (stats) => {
          totalCost6 = stats.totalCost;
        },
      }),
    )
    .askAndCollect("Summarize: 'The quick brown fox jumps over the lazy dog. This is a test.'");

  console.log(`   ${answer6}`);
  console.log(`   Total cost (outer LLM + inner LLM via ctx.llmist): $${totalCost6.toFixed(6)}\n`);

  // Example 7: Response formatting helpers
  console.log("7. Response formatting helpers (gadgetSuccess/gadgetError):");
  const answer7 = await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(DatabaseQuery, riskyOperation)
    .askAndCollect("Query the users table with limit 5, then process resource 'abc123'");

  console.log(`   ${answer7}\n`);

  console.log("=== Done ===");
}

main().catch(console.error);
