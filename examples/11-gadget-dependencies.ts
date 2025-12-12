/**
 * Gadget Dependencies (DAG Execution)
 *
 * Demonstrates how LLMs can specify execution order between gadgets.
 * Independent gadgets run in parallel; dependent gadgets wait.
 *
 * Run: bunx tsx examples/11-gadget-dependencies.ts
 */

import { Gadget, LLMist } from "llmist";
import { z } from "zod";

// Simulates fetching data from a database
class FetchNumber extends Gadget({
  name: "FetchNumber",
  description: "Fetches a number from the database by key",
  schema: z.object({
    key: z.string().describe("Key to fetch: 'price', 'quantity', or 'tax_rate'"),
  }),
}) {
  execute(params: this["params"]): string {
    const data: Record<string, number> = {
      price: 100,
      quantity: 5,
      tax_rate: 0.08,
    };
    const value = data[params.key];
    return value !== undefined ? String(value) : `Error: Key '${params.key}' not found`;
  }
}

// Performs calculations
class Calculate extends Gadget({
  name: "Calculate",
  description: "Evaluates a math expression",
  schema: z.object({
    expression: z.string().describe("Math expression, e.g., '100 * 5'"),
  }),
}) {
  execute(params: this["params"]): string {
    try {
      const result = Function(`"use strict"; return (${params.expression})`)();
      return String(result);
    } catch (e) {
      return `Error: ${e}`;
    }
  }
}

// Formats numbers as currency
class FormatCurrency extends Gadget({
  name: "FormatCurrency",
  description: "Formats a number as USD currency",
  schema: z.object({
    amount: z.number().describe("Amount to format"),
  }),
}) {
  execute(params: this["params"]): string {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(params.amount);
  }
}

async function main() {
  console.log("=== Gadget Dependencies Example ===\n");

  // The LLM will use dependency syntax to order gadget execution:
  // - FetchNumber calls run in parallel (no dependencies)
  // - Calculate waits for FetchNumber results
  // - FormatCurrency waits for Calculate result

  console.log("Calculating total cost with tax...\n");

  await LLMist.createAgent()
    .withModel("haiku")
    .withSystem(
      "You are a helpful assistant. Use gadget dependencies to specify execution order. " +
        "Use :id syntax for invocation IDs and :id:dep1,dep2 for dependencies.",
    )
    .withGadgets(FetchNumber, Calculate, FormatCurrency)
    .withMaxIterations(10)
    .askWith(
      "Calculate the total cost: fetch price and quantity, multiply them for subtotal, " +
        "fetch tax_rate, calculate tax (subtotal * tax_rate), then format the total (subtotal + tax) as currency.",
      {
        onGadgetCall: (call) => {
          const deps =
            call.dependencies.length > 0
              ? ` (waits for: ${call.dependencies.join(", ")})`
              : " (immediate)";
          console.log(`  📤 ${call.gadgetName}:${call.invocationId}${deps}`);
        },
        onGadgetResult: (result) => {
          const status = result.error ? "❌" : "✅";
          console.log(`  ${status} ${result.invocationId} → ${result.result || result.error}`);
        },
        onText: (text) => {
          if (text.trim()) process.stdout.write(text);
        },
      },
    );

  console.log("\n\n=== Done ===");
}

main().catch(console.error);
