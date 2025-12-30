/**
 * Text Handling Configuration: Control how text responses are managed
 *
 * Run: npx tsx examples/10-text-handling.ts
 *
 * This example demonstrates:
 * - textOnlyHandler: What happens when LLM responds without gadget calls
 * - textWithGadgetsHandler: How to wrap text alongside gadget calls
 */

import { createGadget, LLMist } from "llmist";
import { z } from "zod";

// Simple gadget for demonstration
const Calculator = createGadget({
  name: "Calculator",
  description: "Adds two numbers",
  schema: z.object({
    a: z.number(),
    b: z.number(),
  }),
  execute: ({ a, b }) => `${a} + ${b} = ${a + b}`,
});

// Custom TellUser gadget for wrapping text
const TellUser = createGadget({
  name: "TellUser",
  description: "Communicate a message to the user",
  schema: z.object({
    message: z.string().describe("The message to tell the user"),
    done: z.boolean().default(false).describe("Whether the task is complete"),
    type: z.enum(["info", "success", "warning", "error"]).default("info"),
  }),
  execute: ({ message, type }) => `[${type.toUpperCase()}] ${message}`,
});

async function main() {
  console.log("=== Text Handling Configuration ===\n");

  // ==========================================================================
  // Example 1: textOnlyHandler - Control behavior for text-only responses
  // ==========================================================================
  console.log("1. textOnlyHandler strategies:\n");

  // "acknowledge" - Continue loop when LLM responds with just text
  // Useful for multi-turn conversations where LLM may explain before acting
  console.log('   Strategy: "acknowledge" (continues loop)');
  const agent1 = LLMist.createAgent()
    .withModel("haiku")
    .withSystem("You are helpful. Think step by step before using tools.")
    .withGadgets(Calculator)
    .withMaxIterations(3)
    .withTextOnlyHandler("acknowledge") // Continue if LLM just talks
    .ask("What is 5 + 3?");

  let iterations1 = 0;
  for await (const event of agent1.run()) {
    if (event.type === "text") {
      iterations1++;
      console.log(`   [Iteration ${iterations1}] Text: "${event.content.slice(0, 50)}..."`);
    }
  }
  console.log();

  // "terminate" - End loop immediately on text-only response (default)
  console.log('   Strategy: "terminate" (ends loop - default)');
  const answer = await LLMist.createAgent()
    .withModel("haiku")
    .withGadgets(Calculator)
    .withTextOnlyHandler("terminate")
    .askAndCollect("Hello, how are you?");

  console.log(`   Response: "${answer.slice(0, 60)}..."\n`);

  // ==========================================================================
  // Example 2: textWithGadgetsHandler - Wrap text alongside gadget calls
  // ==========================================================================
  console.log("2. textWithGadgetsHandler - Wrap text as synthetic gadget calls:\n");

  // When LLM responds with text AND gadget calls, this wraps the text
  // as a synthetic gadget call in the conversation history
  console.log("   Without handler: text appears in output but not in history as gadget");
  console.log("   With handler: text is wrapped as TellUser call in history\n");

  const conversationHistory: string[] = [];

  await LLMist.createAgent()
    .withModel("haiku")
    .withSystem("Always explain what you're doing before calculating.")
    .withGadgets(Calculator, TellUser)
    .withTextWithGadgetsHandler({
      // Name of gadget to use for wrapping text
      gadgetName: "TellUser",
      // Convert text to gadget parameters
      parameterMapping: (text) => ({
        message: text,
        done: false,
        type: "info",
      }),
      // Format the result (optional)
      resultMapping: (text) => `[WRAPPED] ${text}`,
    })
    .withHooks({
      observers: {
        // Track what goes into conversation history
        onGadgetExecutionComplete: async (ctx) => {
          conversationHistory.push(
            `${ctx.gadgetName}: ${JSON.stringify(ctx.parameters).slice(0, 50)}`,
          );
        },
      },
    })
    .askAndCollect("Calculate 10 + 20");

  console.log("   Conversation history gadget calls:");
  for (const entry of conversationHistory) {
    console.log(`   - ${entry}`);
  }
  console.log();

  // ==========================================================================
  // Example 3: Combining both handlers for consistent behavior
  // ==========================================================================
  console.log("3. Combined configuration for consistent gadget-oriented conversations:\n");

  const agent3 = LLMist.createAgent()
    .withModel("haiku")
    .withSystem("You are a calculator assistant. Always use tools.")
    .withGadgets(Calculator, TellUser)
    // Continue loop for text-only responses (LLM might be thinking)
    .withTextOnlyHandler("acknowledge")
    // Wrap any explanatory text as TellUser calls
    .withTextWithGadgetsHandler({
      gadgetName: "TellUser",
      parameterMapping: (text) => ({ message: text, done: false, type: "info" }),
    })
    .withMaxIterations(5)
    .ask("What is 7 times 8?");

  console.log("   Events:");
  for await (const event of agent3.run()) {
    if (event.type === "text") {
      console.log(`   [text] "${event.content.slice(0, 40)}..."`);
    } else if (event.type === "gadget_result") {
      console.log(`   [${event.result.gadgetName}] ${event.result.result?.slice(0, 40)}`);
    }
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
