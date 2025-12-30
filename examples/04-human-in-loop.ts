/**
 * Human-in-the-loop: Interactive conversations with user input
 *
 * Run: npx tsx examples/04-human-in-loop.ts
 */

import * as readline from "node:readline";
import { TaskCompletionSignal, Gadget, HumanInputRequiredException, LLMist } from "llmist";
import { z } from "zod";

// =============================================================================
// GADGETS
// =============================================================================

class AskUser extends Gadget({
  description: "Ask the user a question when you need more information",
  schema: z.object({
    question: z.string().describe("The question to ask"),
  }),
}) {
  execute(params: this["params"]): string {
    throw new HumanInputRequiredException(params.question);
  }
}

class Confirm extends Gadget({
  description: "Ask user for confirmation before proceeding",
  schema: z.object({
    action: z.string().describe("What will be done"),
  }),
}) {
  execute(params: this["params"]): string {
    throw new HumanInputRequiredException(`${params.action}\n\nProceed? (yes/no)`);
  }
}

class TaskComplete extends Gadget({
  description: "Call when the conversation is complete",
  schema: z.object({
    summary: z.string(),
  }),
}) {
  execute(params: this["params"]): string {
    throw new TaskCompletionSignal(params.summary);
  }
}

// =============================================================================
// READLINE HELPER
// =============================================================================

function createPrompt() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    ask: (question: string): Promise<string> => {
      return new Promise((resolve) => {
        console.log(`\n${question}`);
        rl.question("> ", (answer) => {
          resolve(answer);
        });
      });
    },
    close: () => rl.close(),
  };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log("=== Human-in-the-Loop Example ===\n");
  console.log("This example demonstrates interactive conversations.");
  console.log("The AI will ask you questions to help plan a trip.\n");

  const prompt = createPrompt();

  try {
    // Interactive trip planner
    const result = await LLMist.createAgent()
      .withModel("haiku")
      .withSystem(`You are a helpful trip planner. Ask the user questions to understand their preferences:
1. Where they want to go
2. Budget range
3. Trip duration
4. Interests (beach, mountains, culture, etc.)

After gathering info, summarize the trip plan and confirm with the user.
When done, use TaskComplete to end the conversation.`)
      .withGadgets(AskUser, Confirm, TaskComplete)
      .withMaxIterations(20) // Allow multiple Q&A rounds
      .onHumanInput(prompt.ask)
      .askAndCollect("Hello! I'd like help planning a vacation.");

    console.log("\n--- Final Result ---");
    console.log(result);
  } finally {
    prompt.close();
  }

  console.log("\n=== Done ===");
}

// Run only if executed directly (not imported)
main().catch(console.error);
