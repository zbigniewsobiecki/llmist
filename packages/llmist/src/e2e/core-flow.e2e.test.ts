import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockLLM } from "../../../testing/src/index.js";
import type { Agent } from "../agent/agent.js";
import { AgentBuilder } from "../agent/builder.js";
import { createLogger } from "../logging/logger.js";
import { createSimpleTestSetup, TEST_TIMEOUTS } from "./fixtures.js";
import { clearAllMocks, createMockE2EClient } from "./mock-setup.js";
import {
  collectAllEvents,
  filterEventsByType,
  setupE2ERegistry,
  validateResponse,
} from "./setup.js";

/**
 * E2E tests for core Agent flow using mock responses
 * These tests validate the complete flow of prompt processing,
 * gadget execution, and response generation WITHOUT making real API calls
 */
describe("E2E: Core Agent Flow", () => {
  beforeEach(() => {
    clearAllMocks();
  });

  afterEach(() => {
    clearAllMocks();
  });

  describe("Simple Gadget Execution", () => {
    it(
      "executes a simple math calculation with Calculator gadget",
      async () => {
        // Setup mock that returns a gadget call
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("42 + 58")
          .returnsGadgetCall("Calculator", {
            operation: "add",
            a: 42,
            b: 58,
          })
          .register();

        const { agent } = createSimpleTestSetup(
          "Please calculate 42 + 58 using the Calculator gadget",
          { gadgets: ["basic"], maxIterations: 3 },
        );

        // Override the client with mock client
        const mockClient = createMockE2EClient();
        agent.client = mockClient;

        const events = await collectAllEvents(agent.run());

        // Verify we got gadget results
        const gadgetResults = filterEventsByType(events, "gadget_result");
        expect(gadgetResults.length).toBeGreaterThan(0);

        // Verify the calculation was performed correctly
        const calculatorResult = gadgetResults.find((r) => r.result.gadgetName === "Calculator");
        expect(calculatorResult).toBeDefined();
        expect(calculatorResult?.result.result).toContain("100");
      },
      TEST_TIMEOUTS.QUICK,
    );

    it(
      "executes string manipulation with proper context",
      async () => {
        // Setup mock for string reverse
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("reverse")
          .whenMessageContains("Hello World")
          .returnsGadgetCall("StringManipulator", {
            operation: "reverse",
            text: "Hello World",
          })
          .register();

        const { agent } = createSimpleTestSetup(
          'Please reverse the text "Hello World" using the StringManipulator gadget',
          { gadgets: ["basic"], maxIterations: 3 },
        );

        // Override with mock client
        const mockClient = createMockE2EClient();
        agent.client = mockClient;

        const events = await collectAllEvents(agent.run());

        // Verify gadget was called
        const gadgetResults = filterEventsByType(events, "gadget_result");
        const stringResult = gadgetResults.find((r) => r.result.gadgetName === "StringManipulator");

        expect(stringResult).toBeDefined();
        expect(stringResult?.result.result).toBe("dlroW olleH");
      },
      TEST_TIMEOUTS.QUICK,
    );
  });

  describe("Multiple Gadget Calls", () => {
    it(
      "performs sequential gadget operations",
      async () => {
        // Setup mock that returns multiple gadget calls
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .when(async (context) => {
            const lastMsg = context.messages[context.messages.length - 1]?.content || "";
            return (
              typeof lastMsg === "string" &&
              lastMsg.includes("10 * 5") &&
              lastMsg.includes("50 + 25")
            );
          })
          .withResponse({
            text: "I'll perform both calculations.\n\n",
            gadgetCalls: [
              { gadgetName: "Calculator", parameters: { operation: "multiply", a: 10, b: 5 } },
              { gadgetName: "Calculator", parameters: { operation: "add", a: 50, b: 25 } },
            ],
          })
          .register();

        const registry = setupE2ERegistry();
        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("openai:gpt-5-nano")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withMaxIterations(5)
          .ask(`Please do the following:
        1. Calculate 10 * 5 using Calculator
        2. Then calculate 50 + 25 using Calculator
        3. Report both results`);

        const events = await collectAllEvents(agent.run());

        // Verify multiple gadget calls were made
        const gadgetResults = filterEventsByType(events, "gadget_result");
        expect(gadgetResults.length).toBeGreaterThanOrEqual(2);

        // Verify both calculations were performed
        const results = gadgetResults.map((r) => r.result.result);
        expect(results.some((r) => r?.includes("50"))).toBe(true);
        expect(results.some((r) => r?.includes("75"))).toBe(true);
      },
      TEST_TIMEOUTS.STANDARD,
    );

    it(
      "handles different gadget types in one conversation",
      async () => {
        // Setup mock for mixed gadget types
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .when(async (context) => {
            const lastMsg = context.messages[context.messages.length - 1]?.content || "";
            return (
              typeof lastMsg === "string" &&
              lastMsg.includes("GetCurrentTime") &&
              lastMsg.includes("StringManipulator") &&
              lastMsg.includes("Calculator")
            );
          })
          .withResponse({
            text: "I'll execute all three gadgets.\n\n",
            gadgetCalls: [
              { gadgetName: "GetCurrentTime", parameters: { format: "iso" } },
              {
                gadgetName: "StringManipulator",
                parameters: { operation: "uppercase", text: "test" },
              },
              { gadgetName: "Calculator", parameters: { operation: "add", a: 15, b: 25 } },
            ],
          })
          .register();

        const registry = setupE2ERegistry();
        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("openai:gpt-5-nano")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withMaxIterations(5)
          .ask(`Please:
        1. Get the current time using GetCurrentTime gadget
        2. Convert "test" to uppercase using StringManipulator
        3. Add 15 + 25 using Calculator`);

        const events = await collectAllEvents(agent.run());

        const gadgetResults = filterEventsByType(events, "gadget_result");

        // Verify all three gadget types were called
        const gadgetNames = new Set(gadgetResults.map((r) => r.result.gadgetName));
        expect(gadgetNames.has("GetCurrentTime")).toBe(true);
        expect(gadgetNames.has("StringManipulator")).toBe(true);
        expect(gadgetNames.has("Calculator")).toBe(true);

        // Verify specific results
        const stringResult = gadgetResults.find((r) => r.result.gadgetName === "StringManipulator");
        expect(stringResult?.result.result).toBe("TEST");

        const calcResult = gadgetResults.find(
          (r) => r.result.gadgetName === "Calculator" && r.result.result?.includes("40"),
        );
        expect(calcResult).toBeDefined();
      },
      TEST_TIMEOUTS.STANDARD,
    );
  });

  describe("Error Handling and Recovery", () => {
    it(
      "handles invalid gadget parameters gracefully",
      async () => {
        // Setup mock for division by zero
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("divide")
          .whenMessageContains("100")
          .whenMessageContains("by 0")
          .returnsGadgetCall("Calculator", {
            operation: "divide",
            a: 100,
            b: 0,
          })
          .register();

        const registry = setupE2ERegistry();
        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("openai:gpt-5-nano")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withMaxIterations(3)
          .ask("Try to divide 100 by 0 using the Calculator gadget");

        const events = await collectAllEvents(agent.run());

        // Should handle the division by zero error
        const gadgetResults = filterEventsByType(events, "gadget_result");
        const divisionResult = gadgetResults.find((r) => r.result.gadgetName === "Calculator");

        // Should complete without crashing
        expect(gadgetResults.length).toBeGreaterThan(0);
        expect(divisionResult).toBeDefined();
        if (divisionResult?.result.result) {
          expect(divisionResult.result.result).toContain("Division by zero");
        }
      },
      TEST_TIMEOUTS.QUICK,
    );
  });

  describe("Text-Only Responses", () => {
    it(
      "handles prompts that do not require gadgets",
      async () => {
        // Setup mock for text-only response
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("Explain what")
          .whenMessageContains("Calculator gadget")
          .returns(
            "The Calculator gadget performs basic arithmetic operations including addition, " +
              "subtraction, multiplication, and division. It takes two numbers and an operation " +
              "as parameters and returns the computed result.",
          )
          .register();

        const registry = setupE2ERegistry();
        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        // Note: textOnlyHandler is not supported in AgentBuilder
        const agent = new AgentBuilder(client)
          .withModel("openai:gpt-5-nano")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withMaxIterations(2)
          .ask("Explain what the Calculator gadget does without using it");

        const events = await collectAllEvents(agent.run());

        // LLM should respond with text
        const textEvents = filterEventsByType(events, "text");

        // Should have some kind of response
        expect(events.length).toBeGreaterThan(0);

        // Should mention calculator functionality
        if (textEvents.length > 0) {
          const finalText = textEvents.map((e) => e.content).join(" ");
          expect(validateResponse(finalText, ["calculator"])).toBe(true);
        }
      },
      TEST_TIMEOUTS.QUICK,
    );
  });

  describe("New Simplified Format Validation", () => {
    it(
      "correctly handles the new gadget invocation format",
      async () => {
        // Setup mock for new format
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("123")
          .whenMessageContains("456")
          .returnsGadgetCall("Calculator", {
            operation: "add",
            a: 123,
            b: 456,
          })
          .register();

        const registry = setupE2ERegistry();
        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        // Note: parameterFormat is not supported in AgentBuilder
        const agent = new AgentBuilder(client)
          .withModel("openai:gpt-5-nano")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withMaxIterations(3)
          .ask("Calculate 123 + 456 using Calculator");

        const events = await collectAllEvents(agent.run());

        // Verify gadget was called successfully
        const gadgetResults = filterEventsByType(events, "gadget_result");
        expect(gadgetResults.length).toBeGreaterThan(0);

        const result = gadgetResults[0];
        expect(result.result.gadgetName).toBe("Calculator");
        expect(result.result.result).toContain("579");

        // The invocation ID should be auto-generated (not required from LLM)
        expect(result.result.invocationId).toBeDefined();
      },
      TEST_TIMEOUTS.QUICK,
    );
  });

  describe("Conversation Context", () => {
    it(
      "maintains context across multiple iterations",
      async () => {
        // First mock: respond to initial request with first calculation
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("20 + 30")
          .whenMessageContains("multiply that result by 2")
          .returnsGadgetCall("Calculator", {
            operation: "add",
            a: 20,
            b: 30,
          })
          .once()
          .register();

        // Second mock: respond to gadget result with multiplication
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .when(async (context) => {
            // Check if there's a gadget result for 50 in conversation
            return context.messages.some((msg) => {
              if (typeof msg.content === "string") {
                return msg.content.includes("50");
              }
              return false;
            });
          })
          .returnsGadgetCall("Calculator", {
            operation: "multiply",
            a: 50,
            b: 2,
          })
          .register();

        const registry = setupE2ERegistry();
        const client = createMockE2EClient();
        const logger = createLogger({ type: "hidden" });

        const agent = new AgentBuilder(client)
          .withModel("openai:gpt-5-nano")
          .withSystem("You are a helpful math tutor. Remember all calculations you perform.")
          .withGadgets(...registry.getAll())
          .withLogger(logger)
          .withMaxIterations(4)
          .ask(`First calculate 20 + 30, then multiply that result by 2`);

        const events = await collectAllEvents(agent.run());

        const gadgetResults = filterEventsByType(events, "gadget_result");

        // Should have performed both calculations
        expect(gadgetResults.length).toBeGreaterThanOrEqual(2);

        // First should be addition
        const addResult = gadgetResults.find((r) => r.result.result?.includes("50"));
        expect(addResult).toBeDefined();

        // Second should be multiplication using the previous result
        const multiplyResult = gadgetResults.find((r) => r.result.result?.includes("100"));
        expect(multiplyResult).toBeDefined();
      },
      TEST_TIMEOUTS.STANDARD,
    );
  });
});
