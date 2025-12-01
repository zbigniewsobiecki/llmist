import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import { AgentBuilder } from "../agent/builder.js";
import { Gadget } from "../gadgets/typed-gadget.js";
import { GadgetRegistry } from "../gadgets/registry.js";
import { createLogger } from "../logging/logger.js";
import { mockLLM } from "../testing/index.js";
import { TEST_TIMEOUTS } from "./fixtures.js";
import { clearAllMocks, createMockE2EClient } from "./mock-setup.js";
import { collectAllEvents, filterEventsByType } from "./setup.js";

/**
 * Test gadget that mimics the complex schema from AppendTodoListItemGadget
 * This tests nested objects with optional enums and optional numeric constraints
 */

// Schema similar to todoItemInputSchema
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
  name: "ComplexSchemaGadget",
  description: "Test gadget with complex nested schema including optional enum and constrained number.",
  schema: complexParametersSchema,
}) {
  private items: Array<{ title: string; acceptanceCriteria: string; status: string }> = [];

  execute(params: this["params"]): string {
    const { item, after_index } = params;

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

    return `Added item "${todoItem.title}" at position ${insertIndex}. Total items: ${this.items.length}`;
  }

  getItems() {
    return [...this.items];
  }

  reset() {
    this.items = [];
  }
}

/**
 * E2E tests for complex schema gadget across multiple providers
 * Tests that nested objects, optional enums, and constrained numbers work correctly
 * This is NOT Gemini-specific - it tests all providers
 */
describe("E2E: Complex Schema Gadget (Multi-Provider)", () => {
  let gadget: ComplexSchemaGadget;

  beforeEach(() => {
    clearAllMocks();
    gadget = new ComplexSchemaGadget();
    gadget.reset();
  });

  afterEach(() => {
    clearAllMocks();
  });

  describe("Gemini 2.5 Flash with Complex Schema", () => {
    it(
      "should handle nested object with all required fields",
      async () => {
        // Setup mock for Gemini with complex schema
        mockLLM()
          .forModel("gemini-2.5-flash")
          .forProvider("gemini")
          .whenMessageContains("add a todo")
          .returnsGadgetCall("ComplexSchemaGadget", {
            item: {
              title: "Test task",
              acceptanceCriteria: "Task is completed successfully",
            },
          })
          .register();

        const registry = new GadgetRegistry();
        registry.registerByClass(gadget);

        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("gemini:gemini-2.5-flash")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withMaxIterations(3)
          .ask("Please add a todo item with title 'Test task' and acceptance criteria 'Task is completed successfully'");

        console.log("🚀 Starting Gemini 2.5 Flash test with complex nested schema...");

        const events = await collectAllEvents(agent.run());

        // Check for gadget calls
        const gadgetResults = filterEventsByType(events, "gadget_result");
        console.log(`🔧 Gadget calls made: ${gadgetResults.length}`);

        // Verify gadget was called
        expect(gadgetResults.length).toBeGreaterThan(0);

        const result = gadgetResults.find((r) => r.result.gadgetName === "ComplexSchemaGadget");
        expect(result).toBeDefined();
        expect(result?.result.result).toContain("Test task");
        expect(result?.result.result).toContain("position 0");

        // Verify the item was actually added
        const items = gadget.getItems();
        expect(items).toHaveLength(1);
        expect(items[0]?.title).toBe("Test task");
        expect(items[0]?.acceptanceCriteria).toBe("Task is completed successfully");
        expect(items[0]?.status).toBe("pending"); // Default status
      },
      TEST_TIMEOUTS.STANDARD,
    );

    it(
      "should handle nested object with optional enum field",
      async () => {
        // Setup mock with optional status field
        mockLLM()
          .forModel("gemini-2.5-flash")
          .forProvider("gemini")
          .whenMessageContains("in progress todo")
          .returnsGadgetCall("ComplexSchemaGadget", {
            item: {
              title: "Active task",
              acceptanceCriteria: "All tests pass",
              status: "in_progress",
            },
          })
          .register();

        const registry = new GadgetRegistry();
        registry.registerByClass(gadget);

        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("gemini:gemini-2.5-flash")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withMaxIterations(3)
          .ask("Add an in progress todo with title 'Active task' and criteria 'All tests pass'");

        console.log("🚀 Testing optional enum field...");

        const events = await collectAllEvents(agent.run());
        const gadgetResults = filterEventsByType(events, "gadget_result");

        expect(gadgetResults.length).toBeGreaterThan(0);

        const result = gadgetResults.find((r) => r.result.gadgetName === "ComplexSchemaGadget");
        expect(result).toBeDefined();

        // Verify the status was set correctly
        const items = gadget.getItems();
        expect(items).toHaveLength(1);
        expect(items[0]?.status).toBe("in_progress");
      },
      TEST_TIMEOUTS.STANDARD,
    );

    it(
      "should handle optional numeric constraint field",
      async () => {
        // First add an item
        gadget.execute({
          item: {
            title: "First task",
            acceptanceCriteria: "Done",
          },
        });

        // Setup mock to add item at specific position
        mockLLM()
          .forModel("gemini-2.5-flash")
          .forProvider("gemini")
          .whenMessageContains("insert at beginning")
          .returnsGadgetCall("ComplexSchemaGadget", {
            item: {
              title: "New first task",
              acceptanceCriteria: "Insert test",
            },
            after_index: -1,
          })
          .register();

        const registry = new GadgetRegistry();
        registry.registerByClass(gadget);

        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("gemini:gemini-2.5-flash")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withMaxIterations(3)
          .ask("Insert at beginning: 'New first task' with criteria 'Insert test'");

        console.log("🚀 Testing optional numeric constraint field...");

        const events = await collectAllEvents(agent.run());
        const gadgetResults = filterEventsByType(events, "gadget_result");

        expect(gadgetResults.length).toBeGreaterThan(0);

        const result = gadgetResults.find((r) => r.result.gadgetName === "ComplexSchemaGadget");
        expect(result).toBeDefined();
        expect(result?.result.result).toContain("position 0");

        // Verify insertion order
        const items = gadget.getItems();
        expect(items).toHaveLength(2);
        expect(items[0]?.title).toBe("New first task");
        expect(items[1]?.title).toBe("First task");
      },
      TEST_TIMEOUTS.STANDARD,
    );

    it(
      "should handle all optional fields together",
      async () => {
        // Add initial items
        gadget.execute({
          item: { title: "Task 1", acceptanceCriteria: "Done 1" },
        });
        gadget.execute({
          item: { title: "Task 2", acceptanceCriteria: "Done 2" },
        });

        // Setup mock with both optional fields
        mockLLM()
          .forModel("gemini-2.5-flash")
          .forProvider("gemini")
          .whenMessageContains("insert done task")
          .returnsGadgetCall("ComplexSchemaGadget", {
            item: {
              title: "Completed task",
              acceptanceCriteria: "Already done",
              status: "done",
            },
            after_index: 0,
          })
          .register();

        const registry = new GadgetRegistry();
        registry.registerByClass(gadget);

        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("gemini:gemini-2.5-flash")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withMaxIterations(3)
          .ask("Insert done task 'Completed task' after first item");

        console.log("🚀 Testing all optional fields together...");

        const events = await collectAllEvents(agent.run());
        const gadgetResults = filterEventsByType(events, "gadget_result");

        expect(gadgetResults.length).toBeGreaterThan(0);

        const result = gadgetResults.find((r) => r.result.gadgetName === "ComplexSchemaGadget");
        expect(result).toBeDefined();
        expect(result?.result.result).toContain("position 1");

        // Verify all fields
        const items = gadget.getItems();
        expect(items).toHaveLength(3);
        expect(items[1]?.title).toBe("Completed task");
        expect(items[1]?.status).toBe("done");
      },
      TEST_TIMEOUTS.STANDARD,
    );
  });

  describe("OpenAI GPT-4 with Complex Schema", () => {
    it(
      "should handle nested object with optional enum",
      async () => {
        mockLLM()
          .forModel("gpt-4")
          .forProvider("openai")
          .whenMessageContains("add todo")
          .returnsGadgetCall("ComplexSchemaGadget", {
            item: {
              title: "OpenAI task",
              acceptanceCriteria: "Works with GPT-4",
              status: "in_progress",
            },
          })
          .register();

        const registry = new GadgetRegistry();
        registry.registerByClass(gadget);

        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("openai:gpt-4")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withMaxIterations(3)
          .ask("Please add todo 'OpenAI task' with status in_progress");

        console.log("🚀 Testing OpenAI with complex schema...");

        const events = await collectAllEvents(agent.run());
        const gadgetResults = filterEventsByType(events, "gadget_result");

        expect(gadgetResults.length).toBeGreaterThan(0);

        const result = gadgetResults.find((r) => r.result.gadgetName === "ComplexSchemaGadget");
        expect(result).toBeDefined();

        const items = gadget.getItems();
        expect(items).toHaveLength(1);
        expect(items[0]?.status).toBe("in_progress");
      },
      TEST_TIMEOUTS.STANDARD,
    );
  });

  describe("Anthropic Claude with Complex Schema", () => {
    it(
      "should handle nested object with numeric constraint",
      async () => {
        // Add initial item
        gadget.execute({
          item: { title: "First", acceptanceCriteria: "Done" },
        });

        mockLLM()
          .forModel("claude-3-5-sonnet-20241022")
          .forProvider("anthropic")
          .whenMessageContains("insert task")
          .returnsGadgetCall("ComplexSchemaGadget", {
            item: {
              title: "Anthropic task",
              acceptanceCriteria: "Works with Claude",
            },
            after_index: -1,
          })
          .register();

        const registry = new GadgetRegistry();
        registry.registerByClass(gadget);

        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("anthropic:claude-3-5-sonnet-20241022")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withMaxIterations(3)
          .ask("Insert task at the beginning");

        console.log("🚀 Testing Anthropic with complex schema...");

        const events = await collectAllEvents(agent.run());
        const gadgetResults = filterEventsByType(events, "gadget_result");

        expect(gadgetResults.length).toBeGreaterThan(0);

        const result = gadgetResults.find((r) => r.result.gadgetName === "ComplexSchemaGadget");
        expect(result).toBeDefined();
        expect(result?.result.result).toContain("position 0");

        const items = gadget.getItems();
        expect(items).toHaveLength(2);
        expect(items[0]?.title).toBe("Anthropic task");
      },
      TEST_TIMEOUTS.STANDARD,
    );
  });
});
