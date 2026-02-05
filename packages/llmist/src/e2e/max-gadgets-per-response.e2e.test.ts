import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { mockLLM } from "../../../testing/src/index.js";
import { AgentBuilder } from "../agent/builder.js";
import { createGadget } from "../gadgets/create-gadget.js";
import { TEST_TIMEOUTS } from "./fixtures.js";
import { clearAllMocks, createMockE2EClient } from "./mock-setup.js";
import { collectAllEvents, filterEventsByType } from "./setup.js";

/**
 * E2E tests for maxGadgetsPerResponse feature
 *
 * These tests verify that:
 * 1. Gadget limit is enforced correctly
 * 2. Excess gadgets are skipped with informative messages
 * 3. Agent loop continues to next iteration after hitting limit
 * 4. Skip events have correct format and reason
 */
describe("E2E: maxGadgetsPerResponse", () => {
  beforeEach(() => {
    clearAllMocks();
  });

  afterEach(() => {
    clearAllMocks();
  });

  // Create simple test gadgets
  const SimpleGadget = createGadget({
    name: "SimpleGadget",
    description: "A simple test gadget",
    schema: z.object({
      id: z.string(),
    }),
    execute: ({ id }) => `Executed: ${id}`,
  });

  describe("Gadget Limiting", () => {
    it(
      "executes all gadgets when limit is not set (0 = unlimited)",
      async () => {
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("test unlimited")
          .returns(
            `I will call the gadget five times:
!!!GADGET_START:SimpleGadget:gc_1
!!!ARG:id
one
!!!GADGET_END
!!!GADGET_START:SimpleGadget:gc_2
!!!ARG:id
two
!!!GADGET_END
!!!GADGET_START:SimpleGadget:gc_3
!!!ARG:id
three
!!!GADGET_END
!!!GADGET_START:SimpleGadget:gc_4
!!!ARG:id
four
!!!GADGET_END
!!!GADGET_START:SimpleGadget:gc_5
!!!ARG:id
five
!!!GADGET_END`,
          )
          .register();

        const mockClient = createMockE2EClient();

        const agent = new AgentBuilder(mockClient)
          .withModel("openai:gpt-5-nano")
          .withGadgets(SimpleGadget)
          // No maxGadgetsPerResponse set (defaults to 0 = unlimited)
          .withMaxIterations(1)
          .ask("test unlimited gadgets");

        const events = await collectAllEvents(agent.run());

        const gadgetResults = filterEventsByType(events, "gadget_result");
        const skippedEvents = filterEventsByType(events, "gadget_skipped");

        expect(gadgetResults).toHaveLength(5);
        expect(skippedEvents).toHaveLength(0);
      },
      TEST_TIMEOUTS.QUICK,
    );

    it(
      "limits gadgets when maxGadgetsPerResponse is set",
      async () => {
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("test limit")
          .returns(
            `I will call the gadget five times:
!!!GADGET_START:SimpleGadget:gc_1
!!!ARG:id
one
!!!GADGET_END
!!!GADGET_START:SimpleGadget:gc_2
!!!ARG:id
two
!!!GADGET_END
!!!GADGET_START:SimpleGadget:gc_3
!!!ARG:id
three
!!!GADGET_END
!!!GADGET_START:SimpleGadget:gc_4
!!!ARG:id
four
!!!GADGET_END
!!!GADGET_START:SimpleGadget:gc_5
!!!ARG:id
five
!!!GADGET_END`,
          )
          .register();

        const mockClient = createMockE2EClient();

        const agent = new AgentBuilder(mockClient)
          .withModel("openai:gpt-5-nano")
          .withGadgets(SimpleGadget)
          .withMaxGadgetsPerResponse(3) // Limit to 3
          .withMaxIterations(1)
          .ask("test limit gadgets");

        const events = await collectAllEvents(agent.run());

        const gadgetResults = filterEventsByType(events, "gadget_result");
        const skippedEvents = filterEventsByType(events, "gadget_skipped");

        // First 3 execute, last 2 are skipped
        expect(gadgetResults).toHaveLength(3);
        expect(skippedEvents).toHaveLength(2);

        // Verify skip reason
        for (const skipEvent of skippedEvents) {
          expect(skipEvent.failedDependency).toBe("maxGadgetsPerResponse");
          expect(skipEvent.failedDependencyError).toContain("Gadget limit (3) exceeded");
        }
      },
      TEST_TIMEOUTS.QUICK,
    );

    it(
      "includes skipped gadget info in result",
      async () => {
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("test skip info")
          .returns(
            `Calling gadgets:
!!!GADGET_START:SimpleGadget:gc_execute
!!!ARG:id
execute_me
!!!GADGET_END
!!!GADGET_START:SimpleGadget:gc_skip
!!!ARG:id
skip_me
!!!GADGET_END`,
          )
          .register();

        const mockClient = createMockE2EClient();

        const agent = new AgentBuilder(mockClient)
          .withModel("openai:gpt-5-nano")
          .withGadgets(SimpleGadget)
          .withMaxGadgetsPerResponse(1) // Only allow 1
          .withMaxIterations(1)
          .ask("test skip info");

        const events = await collectAllEvents(agent.run());

        const skippedEvents = filterEventsByType(events, "gadget_skipped");
        expect(skippedEvents).toHaveLength(1);

        const skipped = skippedEvents[0];
        expect(skipped.gadgetName).toBe("SimpleGadget");
        expect(skipped.invocationId).toBe("gc_skip");
        expect(skipped.parameters).toEqual({ id: "skip_me" });
      },
      TEST_TIMEOUTS.QUICK,
    );
  });

  describe("Agent Loop Continuation", () => {
    it(
      "continues to next iteration after hitting limit",
      async () => {
        // First iteration: 3 gadgets, limit of 2 -> 2 execute, 1 skipped
        // LLM sees skip message and adjusts (second iteration)
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("test continuation")
          .returns(
            `I'll call three gadgets:
!!!GADGET_START:SimpleGadget:gc_1
!!!ARG:id
first
!!!GADGET_END
!!!GADGET_START:SimpleGadget:gc_2
!!!ARG:id
second
!!!GADGET_END
!!!GADGET_START:SimpleGadget:gc_3
!!!ARG:id
third
!!!GADGET_END`,
          )
          .once()
          .register();

        // Second iteration: LLM responds after seeing results (no more gadget calls)
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("Executed: first")
          .whenMessageContains("Executed: second")
          .returns(
            "I've completed the first two operations. The third was skipped due to the limit.",
          )
          .register();

        const mockClient = createMockE2EClient();

        const agent = new AgentBuilder(mockClient)
          .withModel("openai:gpt-5-nano")
          .withGadgets(SimpleGadget)
          .withMaxGadgetsPerResponse(2)
          .withMaxIterations(3)
          .withTextOnlyHandler("terminate")
          .ask("test continuation after limit");

        const events = await collectAllEvents(agent.run());

        // Check that we had gadget activity in first iteration
        const gadgetResults = filterEventsByType(events, "gadget_result");
        const skippedEvents = filterEventsByType(events, "gadget_skipped");

        expect(gadgetResults).toHaveLength(2);
        expect(skippedEvents).toHaveLength(1);

        // Verify agent didn't abort - should have text events from second iteration
        const textEvents = filterEventsByType(events, "text");
        expect(textEvents.length).toBeGreaterThan(0);
      },
      TEST_TIMEOUTS.STANDARD,
    );
  });

  describe("Integration with Other Features", () => {
    it(
      "works with sequential execution mode",
      async () => {
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("sequential mode")
          .returns(
            `Calling gadgets:
!!!GADGET_START:SimpleGadget:gc_1
!!!ARG:id
one
!!!GADGET_END
!!!GADGET_START:SimpleGadget:gc_2
!!!ARG:id
two
!!!GADGET_END
!!!GADGET_START:SimpleGadget:gc_3
!!!ARG:id
three
!!!GADGET_END`,
          )
          .register();

        const mockClient = createMockE2EClient();

        const agent = new AgentBuilder(mockClient)
          .withModel("openai:gpt-5-nano")
          .withGadgets(SimpleGadget)
          .withGadgetExecutionMode("sequential")
          .withMaxGadgetsPerResponse(2)
          .withMaxIterations(1)
          .ask("sequential mode with limit");

        const events = await collectAllEvents(agent.run());

        const gadgetResults = filterEventsByType(events, "gadget_result");
        const skippedEvents = filterEventsByType(events, "gadget_skipped");

        expect(gadgetResults).toHaveLength(2);
        expect(skippedEvents).toHaveLength(1);
      },
      TEST_TIMEOUTS.QUICK,
    );

    it(
      "emits gadget_call events for all gadgets (including skipped ones)",
      async () => {
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("test call events")
          .returns(
            `Calling gadgets:
!!!GADGET_START:SimpleGadget:gc_1
!!!ARG:id
one
!!!GADGET_END
!!!GADGET_START:SimpleGadget:gc_2
!!!ARG:id
two
!!!GADGET_END
!!!GADGET_START:SimpleGadget:gc_3
!!!ARG:id
three
!!!GADGET_END`,
          )
          .register();

        const mockClient = createMockE2EClient();

        const agent = new AgentBuilder(mockClient)
          .withModel("openai:gpt-5-nano")
          .withGadgets(SimpleGadget)
          .withMaxGadgetsPerResponse(2)
          .withMaxIterations(1)
          .ask("test call events");

        const events = await collectAllEvents(agent.run());

        // gadget_call events should be emitted for ALL gadgets
        const gadgetCalls = filterEventsByType(events, "gadget_call");
        expect(gadgetCalls).toHaveLength(3); // All 3 gadgets called

        // But only 2 have results, 1 is skipped
        const gadgetResults = filterEventsByType(events, "gadget_result");
        const skippedEvents = filterEventsByType(events, "gadget_skipped");
        expect(gadgetResults).toHaveLength(2);
        expect(skippedEvents).toHaveLength(1);
      },
      TEST_TIMEOUTS.QUICK,
    );
  });
});
