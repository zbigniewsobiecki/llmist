/**
 * Test script for complex schema gadget with real Gemini API
 *
 * This tests a gadget with a complex nested schema similar to AppendTodoListItemGadget:
 * - Nested object with string fields
 * - Optional enum field
 * - Optional numeric field with constraints
 *
 * Run with: bun run scripts/test-complex-schema-gemini.ts
 */

import { z } from "zod";
import { LLMist, Gadget } from "../src/index.js";

// Schema similar to todoItemInputSchema from the user's project
const todoItemSchema = z.object({
  title: z
    .string()
    .min(1)
    .max(200)
    .describe("Concise title describing the to-do item."),
  acceptanceCriteria: z
    .string()
    .min(1)
    .max(500)
    .describe("Concrete acceptance criteria confirming when the task is done."),
  status: z
    .enum(["pending", "in_progress", "done"])
    .optional()
    .describe("Optional initial status: 'pending' (default), 'in_progress', or 'done'."),
});

// Full gadget schema with nested object and optional number
const complexParametersSchema = z.object({
  item: todoItemSchema,
  after_index: z
    .number()
    .int()
    .min(-1)
    .optional()
    .describe(
      "Optional zero-based index to insert after. Omit to append at the end. Use -1 to insert at the beginning.",
    ),
});

class ComplexSchemaGadget extends Gadget({
  name: "TodoManager",
  description:
    "Manages a list of todo items. Add new items with title and acceptance criteria. Optionally specify status and position.",
  schema: complexParametersSchema,
  examples: [
    {
      comment: "Add a simple pending task",
      params: {
        item: {
          title: "Review pull request",
          acceptanceCriteria: "PR is reviewed and commented on",
        },
      },
      output: "Added item 'Review pull request' at position 0. Total items: 1",
    },
    {
      comment: "Add an in-progress task at specific position",
      params: {
        item: {
          title: "Fix bug in login",
          acceptanceCriteria: "Bug is fixed and tests pass",
          status: "in_progress",
        },
        after_index: 0,
      },
      output: "Added item 'Fix bug in login' at position 1. Total items: 2",
    },
  ],
}) {
  private items: Array<{ title: string; acceptanceCriteria: string; status: string }> = [];

  execute(params: this["params"]): string {
    const { item, after_index } = params;

    console.log("\n📋 TodoManager.execute() called with:", JSON.stringify(params, null, 2));

    // Determine insert position
    let insertIndex: number;
    if (after_index === undefined || after_index === null) {
      insertIndex = this.items.length;
    } else if (after_index === -1) {
      insertIndex = 0;
    } else {
      insertIndex = after_index + 1;
    }

    // Create the item with default status if not provided
    const todoItem = {
      title: item.title,
      acceptanceCriteria: item.acceptanceCriteria,
      status: item.status || "pending",
    };

    // Insert the item
    this.items.splice(insertIndex, 0, todoItem);

    const result = `Added item "${todoItem.title}" (status: ${todoItem.status}) at position ${insertIndex}. Total items: ${this.items.length}`;
    console.log(`✅ ${result}`);

    return result;
  }

  getItems() {
    return [...this.items];
  }

  listItems(): string {
    if (this.items.length === 0) {
      return "No items in the todo list.";
    }

    return (
      "Todo list:\n" +
      this.items
        .map((item, i) => `${i}. [${item.status}] ${item.title} - ${item.acceptanceCriteria}`)
        .join("\n")
    );
  }
}

async function main() {
  console.log("🧪 Testing Complex Schema Gadget with Real Gemini API\n");
  console.log("=" .repeat(60));

  // Check for API key
  if (!process.env.GEMINI_API_KEY) {
    console.error("❌ Error: GEMINI_API_KEY environment variable not set");
    console.error("Please set it with: export GEMINI_API_KEY=your-key-here");
    process.exit(1);
  }

  // Create gadget instance
  const todoGadget = new ComplexSchemaGadget();

  console.log("\n📝 Gadget Schema:");
  console.log(todoGadget.getInstruction());
  console.log("=" .repeat(60));

  // Test prompts
  const testCases = [
    {
      name: "Test 1: Simple todo with required fields only",
      prompt:
        "Add a todo item with title 'Write documentation' and acceptance criteria 'Documentation is complete and reviewed'",
    },
    {
      name: "Test 2: Todo with optional status field",
      prompt:
        "Add a todo with title 'Fix authentication bug' and criteria 'Bug is fixed and tests pass', with status 'in_progress'",
    },
    {
      name: "Test 3: Todo with position constraint",
      prompt:
        "Add a todo at the beginning (after_index: -1) with title 'Urgent: Security patch' and criteria 'Patch is applied'",
    },
  ];

  for (const testCase of testCases) {
    console.log(`\n\n${"=".repeat(60)}`);
    console.log(`🧪 ${testCase.name}`);
    console.log("=".repeat(60));

    try {
      console.log(`\n💬 Prompt: "${testCase.prompt}"\n`);

      let textOutput = "";
      let gadgetCallCount = 0;

      const agent = LLMist.createAgent()
        .withModel("flash")
        .withGadgets(todoGadget)
        .withMaxIterations(3)
        .ask(testCase.prompt);

      for await (const event of agent.run()) {
        if (event.type === "text") {
          textOutput += event.content;
        } else if (event.type === "gadget_result") {
          gadgetCallCount++;
          console.log(`   Result: ${event.result.result}`);
        }
      }

      console.log(`\n💭 Agent response: ${textOutput.trim()}`);
      console.log(`\n📊 Stats: ${gadgetCallCount} gadget call(s)`);

      // Show current todo list
      console.log(`\n📋 Current todo list:\n${todoGadget.listItems()}`);
    } catch (error) {
      console.error(`\n❌ Error in ${testCase.name}:`, error);
      if (error instanceof Error) {
        console.error("Stack:", error.stack);
      }
    }
  }

  console.log("\n\n" + "=".repeat(60));
  console.log("✅ Test complete!");
  console.log("=".repeat(60));
}

// Run the test
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
