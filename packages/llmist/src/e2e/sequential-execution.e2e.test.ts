import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { mockLLM } from "../../../testing/src/index.js";
import { AgentBuilder } from "../agent/builder.js";
import { createGadget } from "../gadgets/create-gadget.js";
import { TEST_TIMEOUTS } from "./fixtures.js";
import { clearAllMocks, createMockE2EClient } from "./mock-setup.js";
import { collectAllEvents, filterEventsByType } from "./setup.js";

/**
 * E2E tests for gadget execution mode (sequential vs parallel)
 *
 * These tests verify that:
 * 1. Sequential mode executes gadgets one at a time
 * 2. Parallel mode (default) executes gadgets concurrently
 * 3. Timing differences reflect the execution mode
 */
describe("E2E: Gadget Execution Mode", () => {
  beforeEach(() => {
    clearAllMocks();
  });

  afterEach(() => {
    clearAllMocks();
  });

  // Create a gadget that tracks execution order and has a configurable delay
  const executionLog: string[] = [];
  const DelayedGadget = createGadget({
    name: "DelayedGadget",
    description: "A gadget that logs execution start/end with optional delay",
    schema: z.object({
      id: z.string(),
      delayMs: z.number().default(50),
    }),
    execute: async ({ id, delayMs }) => {
      executionLog.push(`start:${id}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      executionLog.push(`end:${id}`);
      return `Completed ${id}`;
    },
  });

  describe("Sequential Mode", () => {
    it(
      "executes gadgets one at a time in order",
      async () => {
        executionLog.length = 0;

        // Mock LLM to call the gadget three times
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("test sequential")
          .returns(
            `I will call the gadget three times:
!!!GADGET_START:DelayedGadget:gc_1
!!!ARG:id
first
!!!ARG:delayMs
50
!!!GADGET_END
!!!GADGET_START:DelayedGadget:gc_2
!!!ARG:id
second
!!!ARG:delayMs
50
!!!GADGET_END
!!!GADGET_START:DelayedGadget:gc_3
!!!ARG:id
third
!!!ARG:delayMs
50
!!!GADGET_END`,
          )
          .register();

        const mockClient = createMockE2EClient();

        const agent = new AgentBuilder(mockClient)
          .withModel("openai:gpt-5-nano")
          .withGadgets(DelayedGadget)
          .withGadgetExecutionMode("sequential")
          .withMaxIterations(1)
          .ask("test sequential execution");

        const events = await collectAllEvents(agent.run());

        // Verify all gadgets executed
        const gadgetResults = filterEventsByType(events, "gadget_result");
        expect(gadgetResults).toHaveLength(3);

        // In sequential mode, each gadget should complete before the next starts
        // Pattern should be: start:first, end:first, start:second, end:second, start:third, end:third
        expect(executionLog).toEqual([
          "start:first",
          "end:first",
          "start:second",
          "end:second",
          "start:third",
          "end:third",
        ]);
      },
      TEST_TIMEOUTS.QUICK,
    );
  });

  describe("Parallel Mode (default)", () => {
    it(
      "executes independent gadgets concurrently",
      async () => {
        executionLog.length = 0;

        // Mock LLM to call the gadget three times
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("test parallel")
          .returns(
            `I will call the gadget three times:
!!!GADGET_START:DelayedGadget:gc_1
!!!ARG:id
first
!!!ARG:delayMs
50
!!!GADGET_END
!!!GADGET_START:DelayedGadget:gc_2
!!!ARG:id
second
!!!ARG:delayMs
50
!!!GADGET_END
!!!GADGET_START:DelayedGadget:gc_3
!!!ARG:id
third
!!!ARG:delayMs
50
!!!GADGET_END`,
          )
          .register();

        const mockClient = createMockE2EClient();

        const agent = new AgentBuilder(mockClient)
          .withModel("openai:gpt-5-nano")
          .withGadgets(DelayedGadget)
          .withGadgetExecutionMode("parallel") // explicit, but same as default
          .withMaxIterations(1)
          .ask("test parallel execution");

        const events = await collectAllEvents(agent.run());

        // Verify all gadgets executed
        const gadgetResults = filterEventsByType(events, "gadget_result");
        expect(gadgetResults).toHaveLength(3);

        // In parallel mode, all gadgets should start before any ends
        // Pattern should show overlapping starts: start:first, start:second, start:third, ...
        const startIndices = executionLog
          .map((log, i) => (log.startsWith("start:") ? i : -1))
          .filter((i) => i !== -1);
        const endIndices = executionLog
          .map((log, i) => (log.startsWith("end:") ? i : -1))
          .filter((i) => i !== -1);

        // All starts should happen before all ends complete
        // At least 2 starts should happen before the first end (true concurrency)
        const firstEndIndex = Math.min(...endIndices);
        const startsBeforeFirstEnd = startIndices.filter((i) => i < firstEndIndex);
        expect(startsBeforeFirstEnd.length).toBeGreaterThan(1);
      },
      TEST_TIMEOUTS.QUICK,
    );
  });

  describe("Default behavior", () => {
    it(
      "defaults to parallel mode when not specified",
      async () => {
        executionLog.length = 0;

        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("test default")
          .returns(
            `Calling gadgets:
!!!GADGET_START:DelayedGadget:gc_1
!!!ARG:id
A
!!!ARG:delayMs
30
!!!GADGET_END
!!!GADGET_START:DelayedGadget:gc_2
!!!ARG:id
B
!!!ARG:delayMs
30
!!!GADGET_END`,
          )
          .register();

        const mockClient = createMockE2EClient();

        const agent = new AgentBuilder(mockClient)
          .withModel("openai:gpt-5-nano")
          .withGadgets(DelayedGadget)
          // No withGadgetExecutionMode() - should default to parallel
          .withMaxIterations(1)
          .ask("test default mode");

        const events = await collectAllEvents(agent.run());
        const gadgetResults = filterEventsByType(events, "gadget_result");
        expect(gadgetResults).toHaveLength(2);

        // Both should start before either ends (parallel behavior)
        const startA = executionLog.indexOf("start:A");
        const startB = executionLog.indexOf("start:B");
        const endA = executionLog.indexOf("end:A");
        const endB = executionLog.indexOf("end:B");

        // In parallel: start:A and start:B should both come before end:A and end:B
        expect(Math.max(startA, startB)).toBeLessThan(Math.min(endA, endB));
      },
      TEST_TIMEOUTS.QUICK,
    );
  });
});
