import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Agent } from "../agent/agent.js";
import { AgentBuilder } from "../agent/builder.js";
import { GadgetRegistry } from "../gadgets/registry.js";
import { createLogger } from "../logging/logger.js";
import { mockLLM } from "../../../testing/src/index.js";
import { TEST_TIMEOUTS } from "./fixtures.js";
import { clearAllMocks, createMockE2EClient } from "./mock-setup.js";
import {
  CalculatorGadget,
  collectAllEvents,
  filterEventsByType,
  StateTrackerGadget,
  StringManipulatorGadget,
} from "./setup.js";

/**
 * E2E tests for Gemini Gadget Execution using mocks
 * These tests validate gadget execution behavior WITHOUT making real API calls
 */
describe("E2E: Gemini Gadget Execution", () => {
  beforeEach(() => {
    clearAllMocks();
  });

  afterEach(() => {
    clearAllMocks();
  });

  describe("Gemini 2.5 Pro Gadget Tests", () => {
    it(
      "should execute a simple Calculator gadget with Gemini",
      async () => {
        // Setup mock for Gemini with Calculator
        mockLLM()
          .forModel("gemini-2.5-pro")
          .forProvider("gemini")
          .whenMessageContains("Calculate")
          .whenMessageContains("15 + 25")
          .returnsGadgetCall("Calculator", {
            operation: "add",
            a: 15,
            b: 25,
          })
          .register();

        const registry = new GadgetRegistry();
        registry.registerByClass(new CalculatorGadget());

        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        // Note: parameterFormat is not supported in AgentBuilder
        const agent = new AgentBuilder(client)
          .withModel("gemini:gemini-2.5-pro")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withMaxIterations(3)
          .ask("Calculate 15 + 25 using the Calculator gadget");

        console.log("🚀 Starting Gemini 2.5 Pro test with Calculator gadget...");

        const events = await collectAllEvents(agent.run());

        // Debug: Print all events
        console.log(
          "📋 All events:",
          events.map((e) => ({
            type: e.type,
            content:
              e.type === "text" ? e.content : e.type === "gadget_result" ? e.result : undefined,
          })),
        );

        // Check for gadget calls
        const gadgetResults = filterEventsByType(events, "gadget_result");
        console.log(`🔧 Gadget calls made: ${gadgetResults.length}`);

        // Verify gadget was called
        expect(gadgetResults.length).toBeGreaterThan(0);

        const calcResult = gadgetResults.find((r) => r.result.gadgetName === "Calculator");
        expect(calcResult).toBeDefined();
        expect(calcResult?.result.result).toContain("40");
      },
      TEST_TIMEOUTS.STANDARD,
    );

    it(
      "should handle multiple gadget calls with Gemini",
      async () => {
        // Setup mock for multiple gadgets
        mockLLM()
          .forModel("gemini-2.5-pro")
          .forProvider("gemini")
          .when(async (context) => {
            const lastMsg = context.messages[context.messages.length - 1]?.content || "";
            return (
              typeof lastMsg === "string" &&
              lastMsg.includes("100 / 4") &&
              lastMsg.includes("hello world")
            );
          })
          .withResponse({
            text: "I'll perform both tasks.\n\n",
            gadgetCalls: [
              { gadgetName: "Calculator", parameters: { operation: "divide", a: 100, b: 4 } },
              {
                gadgetName: "StringManipulator",
                parameters: { operation: "uppercase", text: "hello world" },
              },
            ],
          })
          .register();

        const registry = new GadgetRegistry();
        registry.registerByClass(new CalculatorGadget());
        registry.registerByClass(new StringManipulatorGadget());

        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        // Note: parameterFormat is not supported in AgentBuilder
        const agent = new AgentBuilder(client)
          .withModel("gemini:gemini-2.5-pro")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withMaxIterations(5)
          .ask(`Please do the following tasks:
1. Calculate 100 / 4 using the Calculator gadget
2. Convert "hello world" to uppercase using the StringManipulator gadget
3. Report both results`);

        console.log("🚀 Starting Gemini 2.5 Pro test with multiple gadgets...");

        const events = await collectAllEvents(agent.run());

        const gadgetResults = filterEventsByType(events, "gadget_result");
        console.log(`🔧 Gadget calls made: ${gadgetResults.length}`);

        // Should make at least 2 gadget calls
        expect(gadgetResults.length).toBeGreaterThanOrEqual(2);

        // Check for Calculator result
        const calcResult = gadgetResults.find(
          (r) => r.result.gadgetName === "Calculator" && r.result.result?.includes("25"),
        );
        expect(calcResult).toBeDefined();

        // Check for StringManipulator result
        const stringResult = gadgetResults.find(
          (r) => r.result.gadgetName === "StringManipulator" && r.result.result === "HELLO WORLD",
        );
        expect(stringResult).toBeDefined();
      },
      TEST_TIMEOUTS.STANDARD,
    );

    it(
      "should work with stateful gadgets in Gemini",
      async () => {
        // Setup mocks for stateful gadget calls
        mockLLM()
          .forModel("gemini-2.5-pro")
          .forProvider("gemini")
          .when(async (context) => {
            const lastMsg = context.messages[context.messages.length - 1]?.content || "";
            return typeof lastMsg === "string" && lastMsg.includes("StateTracker");
          })
          .withResponse({
            text: "I'll use the StateTracker gadget.\n\n",
            gadgetCalls: [
              { gadgetName: "StateTracker", parameters: { operation: "increment", value: 5 } },
              { gadgetName: "StateTracker", parameters: { operation: "get" } },
            ],
          })
          .register();

        const registry = new GadgetRegistry();
        registry.registerByClass(new StateTrackerGadget());

        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        // Note: parameterFormat is not supported in AgentBuilder
        const agent = new AgentBuilder(client)
          .withModel("gemini:gemini-2.5-pro")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withMaxIterations(5)
          .ask(`Using the StateTracker gadget:
1. Increment by 5
2. Get the current state`);

        console.log("🚀 Starting Gemini 2.5 Pro test with stateful gadget...");

        const events = await collectAllEvents(agent.run());

        const gadgetResults = filterEventsByType(events, "gadget_result");
        console.log(`🔧 Gadget calls made: ${gadgetResults.length}`);

        // Should make multiple StateTracker calls
        expect(gadgetResults.length).toBeGreaterThanOrEqual(2);

        const stateResults = gadgetResults.filter((r) => r.result.gadgetName === "StateTracker");

        expect(stateResults.length).toBeGreaterThanOrEqual(2);

        // Verify state changes occurred
        const results = stateResults.map((r) => r.result.result);
        expect(results.some((r) => r?.includes("5"))).toBe(true);
      },
      TEST_TIMEOUTS.STANDARD,
    );
  });

  describe("Compare Gemini vs GPT-5-nano", () => {
    it(
      "should show different behavior between providers",
      async () => {
        const testPrompt = "Calculate 50 + 50 using the Calculator gadget and explain the result";

        const registry = new GadgetRegistry();
        registry.registerByClass(new CalculatorGadget());

        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        // Setup mock for GPT-5-nano
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("50 + 50")
          .returnsGadgetCall("Calculator", {
            operation: "add",
            a: 50,
            b: 50,
          })
          .register();

        // Setup mock for Gemini
        mockLLM()
          .forModel("gemini-2.5-pro")
          .forProvider("gemini")
          .whenMessageContains("50 + 50")
          .returnsGadgetCall("Calculator", {
            operation: "add",
            a: 50,
            b: 50,
          })
          .register();

        // Test with GPT-5-nano
        console.log("\n🤖 Testing with GPT-5-nano...");
        // Note: parameterFormat is not supported in AgentBuilder
        const gptLoop = new AgentBuilder(client)
          .withModel("openai:gpt-5-nano")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withMaxIterations(3)
          .ask(testPrompt);

        const gptEvents = await collectAllEvents(gptLoop.run());
        const gptGadgetResults = filterEventsByType(gptEvents, "gadget_result");
        console.log(`  GPT-5-nano gadget calls: ${gptGadgetResults.length}`);

        // Test with Gemini
        console.log("\n🤖 Testing with Gemini 2.5 Pro...");
        // Note: parameterFormat is not supported in AgentBuilder
        const geminiLoop = new AgentBuilder(client)
          .withModel("gemini:gemini-2.5-pro")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withMaxIterations(3)
          .ask(testPrompt);

        const geminiEvents = await collectAllEvents(geminiLoop.run());
        const geminiGadgetResults = filterEventsByType(geminiEvents, "gadget_result");
        console.log(`  Gemini gadget calls: ${geminiGadgetResults.length}`);

        // Both should call the gadget
        expect(gptGadgetResults.length).toBeGreaterThan(0);
        expect(geminiGadgetResults.length).toBeGreaterThan(0);
      },
      TEST_TIMEOUTS.COMPLEX,
    );
  });
});
