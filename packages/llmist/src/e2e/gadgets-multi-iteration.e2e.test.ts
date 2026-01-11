import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockLLM } from "../../../testing/src/index.js";
import type { Agent } from "../agent/agent.js";
import { AgentBuilder } from "../agent/builder.js";
import { createLogger } from "../logging/logger.js";
import { clearAllMocks, createMockE2EClient } from "./mock-setup.js";
import {
  ConditionalGadget,
  collectAllEvents,
  DataAccumulatorGadget,
  filterEventsByType,
  MockHumanInputProvider,
  StateTrackerGadget,
  setupExtendedE2ERegistry,
  TestStateManager,
} from "./setup.js";

/**
 * E2E tests for gadget system features and multi-iteration workflows using mocks
 * Tests parameter formats, loop control, state persistence, and complex scenarios
 */
describe("E2E: Gadgets and Multi-Iteration Workflows", () => {
  beforeEach(() => {
    clearAllMocks();
    // Reset static state in gadgets
    StateTrackerGadget.resetCounter();
    DataAccumulatorGadget.clear();
    ConditionalGadget.clearHistory();
  });

  afterEach(() => {
    clearAllMocks();
  });

  describe("Parameter Format Tests", () => {
    it("handles JSON format with nested objects", async () => {
      // Mock for Calculator multiply operation
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .whenMessageContains("Calculator gadget")
        .whenMessageContains("multiply")
        .returnsGadgetCall("Calculator", {
          operation: "multiply",
          a: 7,
          b: 8,
        })
        .register();

      const registry = setupExtendedE2ERegistry();
      const client = createMockE2EClient();
      const logger = createLogger({ type: "hidden" });

      // Note: parameterFormat is not supported in AgentBuilder
      const agent = new AgentBuilder(client)
        .withModel("openai:gpt-5-nano")
        .withGadgets(...registry.getAll())
        .withLogger(logger)
        .withMaxIterations(2)
        .ask(`Please use the Calculator gadget with these JSON parameters:
        {
          "operation": "multiply",
          "a": 7,
          "b": 8
        }`);

      const events = await collectAllEvents(agent.run());

      const gadgetResults = filterEventsByType(events, "gadget_result");
      expect(gadgetResults.length).toBeGreaterThan(0);

      const calcResult = gadgetResults.find((r) => r.result.gadgetName === "Calculator");
      expect(calcResult).toBeDefined();
      expect(calcResult?.result.result).toContain("56");
    });

    it("handles YAML format with simple key-value pairs", async () => {
      // Mock for StringManipulator uppercase operation
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .whenMessageContains("StringManipulator")
        .whenMessageContains("YAML")
        .returnsGadgetCall("StringManipulator", {
          operation: "uppercase",
          text: "hello yaml",
        })
        .register();

      const registry = setupExtendedE2ERegistry();
      const client = createMockE2EClient();
      const logger = createLogger({ type: "hidden" });

      // Note: parameterFormat is not supported in AgentBuilder
      const agent = new AgentBuilder(client)
        .withModel("openai:gpt-5-nano")
        .withGadgets(...registry.getAll())
        .withLogger(logger)
        .withMaxIterations(2)
        .ask(`Use the StringManipulator gadget with YAML parameters:
        operation: uppercase
        text: hello yaml`);

      const events = await collectAllEvents(agent.run());

      const gadgetResults = filterEventsByType(events, "gadget_result");
      const stringResult = gadgetResults.find((r) => r.result.gadgetName === "StringManipulator");

      expect(stringResult).toBeDefined();
      expect(stringResult?.result.result).toBe("HELLO YAML");
    });

    it("auto-detects parameter format", async () => {
      // First gadget call - Calculator with JSON
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .whenMessageContains("Calculator with JSON")
        .returnsGadgetCall("Calculator", {
          operation: "add",
          a: 10,
          b: 20,
        })
        .once()
        .register();

      // Second gadget call - StringManipulator with YAML
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .when(async (context) => {
          // Only match after we've seen the Calculator result
          // Result is in a user message (format: "Result: 10 + 20 = 30")
          const hasCalcResult = context.messages.some(
            (msg) => typeof msg.content === "string" && msg.content.includes("30"),
          );
          return hasCalcResult;
        })
        .returnsGadgetCall("StringManipulator", {
          operation: "lowercase",
          text: "AUTO DETECT",
        })
        .once()
        .register();

      const registry = setupExtendedE2ERegistry();
      const client = createMockE2EClient();
      const logger = createLogger({ type: "hidden" });

      // Note: parameterFormat is not supported in AgentBuilder
      const agent = new AgentBuilder(client)
        .withModel("openai:gpt-5-nano")
        .withGadgets(...registry.getAll())
        .withLogger(logger)
        .withMaxIterations(3)
        .ask(`First use Calculator with JSON {"operation": "add", "a": 10, "b": 20}
        Then use StringManipulator with YAML:
        operation: lowercase
        text: AUTO DETECT`);

      const events = await collectAllEvents(agent.run());

      const gadgetResults = filterEventsByType(events, "gadget_result");

      // Should have both gadget calls
      expect(gadgetResults.length).toBeGreaterThanOrEqual(2);

      const calcResult = gadgetResults.find(
        (r) => r.result.gadgetName === "Calculator" && r.result.result?.includes("30"),
      );
      expect(calcResult).toBeDefined();

      const stringResult = gadgetResults.find((r) => r.result.gadgetName === "StringManipulator");
      expect(stringResult?.result.result).toBe("auto detect");
    });
  });

  describe("Multi-Iteration Workflow Tests", () => {
    it("maintains state across multiple iterations", async () => {
      // First iteration: increment by 1
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .when(async (context) => {
          const lastMsg = context.messages[context.messages.length - 1]?.content || "";
          return (
            typeof lastMsg === "string" &&
            lastMsg.includes("StateTracker") &&
            !context.messages.some(
              (m) => typeof m.content === "string" && m.content.includes("Counter"),
            )
          );
        })
        .returnsGadgetCall("StateTracker", {
          operation: "increment",
          value: 1,
        })
        .once()
        .register();

      // Second iteration: increment by 2
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .when(async (context) => {
          const hasFirstIncrement = context.messages.some(
            (m) => typeof m.content === "string" && m.content.includes("Counter incremented by 1"),
          );
          return hasFirstIncrement;
        })
        .returnsGadgetCall("StateTracker", {
          operation: "increment",
          value: 2,
        })
        .once()
        .register();

      // Third iteration: get current value
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .when(async (context) => {
          const hasBothIncrements = context.messages.some(
            (m) => typeof m.content === "string" && m.content.includes("Counter incremented by 2"),
          );
          return hasBothIncrements;
        })
        .returnsGadgetCall("StateTracker", {
          operation: "get",
        })
        .once()
        .register();

      // Final iteration: report result
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .when(async (context) => {
          const hasGetResult = context.messages.some(
            (m) => typeof m.content === "string" && m.content.includes("Current counter value: 3"),
          );
          return hasGetResult;
        })
        .returns("RESULT: 3")
        .register();

      const registry = setupExtendedE2ERegistry();
      const client = createMockE2EClient();
      const logger = createLogger({ type: "hidden" });

      // Note: parameterFormat is not supported in AgentBuilder
      const agent = new AgentBuilder(client)
        .withModel("openai:gpt-5-nano")
        .withSystem(`You are a test assistant. When you complete a sequence of operations, always end your response with a result in this exact format:
RESULT: <value>

Where <value> is the numeric result. Do not use words for numbers.`)
        .withGadgets(...registry.getAll())
        .withLogger(logger)
        .withMaxIterations(4)
        .ask(`Execute this sequence:
        1. Use StateTracker gadget with operation="increment" and value=1
        2. Use StateTracker gadget with operation="increment" and value=2
        3. Use StateTracker gadget with operation="get" to retrieve the current value

        When done, report the final counter value using the RESULT: format.`);

      const events = await collectAllEvents(agent.run());

      const gadgetResults = filterEventsByType(events, "gadget_result");

      // Should have at least 3 StateTracker calls
      const stateTrackerCalls = gadgetResults.filter((r) => r.result.gadgetName === "StateTracker");
      expect(stateTrackerCalls.length).toBeGreaterThanOrEqual(3);

      // Check final value is 3 (1 + 2)
      const getResult = stateTrackerCalls.find((r) =>
        r.result.result?.includes("Current counter value:"),
      );
      expect(getResult?.result.result).toContain("3");

      // Verify response includes the result
      const textEvents = filterEventsByType(events, "text");
      const finalText = textEvents.map((e) => e.content).join(" ");

      const resultMatch = finalText.match(/RESULT:\s*(\d+)/i);
      if (resultMatch) {
        expect(resultMatch[1]).toBe("3");
      } else {
        expect(/\b3\b/.test(finalText)).toBe(true);
      }
    });

    it("accumulates data across iterations", async () => {
      // Setup mocks for accumulator operations
      let callCount = 0;
      const operations = [
        { operation: "add", data: 10 },
        { operation: "add", data: 15 },
        { operation: "concatenate", data: "Hello" },
        { operation: "concatenate", data: "World" },
        { operation: "get" },
      ];

      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .whenMessageContains("DataAccumulator")
        .withResponse(() => {
          if (callCount >= operations.length) {
            return { text: "All operations completed" };
          }
          const params = operations[callCount++];
          return {
            gadgetCalls: [{ gadgetName: "DataAccumulator", parameters: params }],
          };
        })
        .register();

      const registry = setupExtendedE2ERegistry();
      const client = createMockE2EClient();
      const logger = createLogger({ type: "hidden" });

      // Note: parameterFormat is not supported in AgentBuilder
      const agent = new AgentBuilder(client)
        .withModel("openai:gpt-5-nano")
        .withGadgets(...registry.getAll())
        .withLogger(logger)
        .withMaxIterations(5)
        .ask(`Please accumulate data:
        1. Use DataAccumulator to add number 10
        2. Use DataAccumulator to add number 15
        3. Use DataAccumulator to concatenate string "Hello"
        4. Use DataAccumulator to concatenate string "World"
        5. Use DataAccumulator to get all accumulated data`);

      const events = await collectAllEvents(agent.run());

      const gadgetResults = filterEventsByType(events, "gadget_result");
      const accumulatorCalls = gadgetResults.filter(
        (r) => r.result.gadgetName === "DataAccumulator",
      );

      expect(accumulatorCalls.length).toBeGreaterThanOrEqual(5);

      // Check final accumulated values
      const getResult = accumulatorCalls.find((r) => r.result.result?.includes("Numbers sum:"));
      expect(getResult).toBeDefined();
      expect(getResult?.result.result).toContain("25"); // 10 + 15
      expect(getResult?.result.result).toContain("Hello World");
    });

    it("reaches max iterations limit", async () => {
      // Mock that returns increment gadget calls
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .whenMessageContains("StateTracker")
        .returnsGadgetCall("StateTracker", {
          operation: "increment",
          value: 1,
        })
        .register();

      const registry = setupExtendedE2ERegistry();
      const client = createMockE2EClient();
      const logger = createLogger({ type: "hidden" });

      // Note: parameterFormat is not supported in AgentBuilder
      const agent = new AgentBuilder(client)
        .withModel("openai:gpt-5-nano")
        .withGadgets(...registry.getAll())
        .withLogger(logger)
        .withMaxIterations(3)
        .ask(`Keep using StateTracker to increment by 1 repeatedly`);

      const events = await collectAllEvents(agent.run());

      const gadgetResults = filterEventsByType(events, "gadget_result");

      // Should have StateTracker calls limited by max iterations
      const stateTrackerCalls = gadgetResults.filter((r) => r.result.gadgetName === "StateTracker");

      expect(stateTrackerCalls.length).toBeGreaterThanOrEqual(2);
      expect(gadgetResults.length).toBeGreaterThan(0);
    });
  });

  describe("Loop Control Tests", () => {
    it("breaks loop when threshold is reached", async () => {
      // First LoopBreaker call: below threshold
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .when(async (context) => {
          // Match on first call - before any results exist
          const hasResults = context.messages.some(
            (m) => typeof m.content === "string" && m.content.includes("Result:"),
          );
          return !hasResults;
        })
        .returnsGadgetCall("LoopBreaker", {
          currentValue: 3,
          threshold: 5,
        })
        .once()
        .register();

      // Second LoopBreaker call: exceeds threshold
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .when(async (context) => {
          // Match after first call - when "below threshold" result exists
          const hasFirstCall = context.messages.some(
            (m) => typeof m.content === "string" && m.content.includes("below threshold"),
          );
          return hasFirstCall;
        })
        .returnsGadgetCall("LoopBreaker", {
          currentValue: 6,
          threshold: 5,
        })
        .register();

      const registry = setupExtendedE2ERegistry();
      const client = createMockE2EClient();
      const logger = createLogger({ type: "hidden" });

      // Note: parameterFormat is not supported in AgentBuilder
      const agent = new AgentBuilder(client)
        .withModel("openai:gpt-5-nano")
        .withGadgets(...registry.getAll())
        .withLogger(logger)
        .withMaxIterations(5)
        .ask(`Use the LoopBreaker gadget twice:

        First call example:
        !!!GADGET_START:LoopBreaker
        {"currentValue": 3, "threshold": 5}
        !!!GADGET_END:

        Then make a second call:
        !!!GADGET_START:LoopBreaker
        {"currentValue": 6, "threshold": 5}
        !!!GADGET_END:

        The second call should break the agent.`);

      const events = await collectAllEvents(agent.run());

      const gadgetResults = filterEventsByType(events, "gadget_result");
      const loopBreakerCalls = gadgetResults.filter((r) => r.result.gadgetName === "LoopBreaker");

      expect(loopBreakerCalls.length).toBeGreaterThanOrEqual(2);

      // First call should not break
      const firstCall = loopBreakerCalls[0];
      expect(firstCall?.result.result).toContain("below threshold");

      // Second call should break
      const secondCall = loopBreakerCalls[1];
      expect(secondCall?.result.result).toMatch(/threshold|break|exceed/i);
      expect(secondCall?.result.breaksLoop).toBe(true);
    });

    it("completes current iteration before breaking", async () => {
      // Mock for multiple gadgets in single iteration
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .whenMessageContains("StateTracker")
        .whenMessageContains("LoopBreaker")
        .withResponse({
          gadgetCalls: [
            { gadgetName: "StateTracker", parameters: { operation: "increment", value: 5 } },
            { gadgetName: "LoopBreaker", parameters: { currentValue: 10, threshold: 5 } },
            { gadgetName: "StateTracker", parameters: { operation: "get" } },
          ],
        })
        .register();

      const registry = setupExtendedE2ERegistry();
      const client = createMockE2EClient();
      const logger = createLogger({ type: "hidden" });

      // Note: parameterFormat is not supported in AgentBuilder
      const agent = new AgentBuilder(client)
        .withModel("openai:gpt-5-nano")
        .withGadgets(...registry.getAll())
        .withLogger(logger)
        .withMaxIterations(5)
        .ask(`In one response:
        1. Use StateTracker to increment by 5
        2. Use LoopBreaker with currentValue: 10, threshold: 5 (this will break)
        3. Use StateTracker to get the value
        All three should execute even though LoopBreaker breaks the loop`);

      const events = await collectAllEvents(agent.run());

      const gadgetResults = filterEventsByType(events, "gadget_result");

      // Should have all three gadget calls
      expect(gadgetResults.length).toBeGreaterThanOrEqual(3);

      const stateTrackerCalls = gadgetResults.filter((r) => r.result.gadgetName === "StateTracker");
      expect(stateTrackerCalls.length).toBeGreaterThanOrEqual(2);

      const loopBreakerCall = gadgetResults.find((r) => r.result.gadgetName === "LoopBreaker");
      expect(loopBreakerCall?.result.breaksLoop).toBe(true);
    });
  });

  describe("Human Input Tests", () => {
    it("handles human input requests with mock provider", async () => {
      // First iteration: ask for user input
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .whenMessageContains("UserInput")
        .whenMessageContains("favorite color")
        .returnsGadgetCall("UserInput", {
          question: "What is your favorite color?",
        })
        .once()
        .register();

      // Second iteration: acknowledge the input
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .when(async (context) => {
          return context.messages.some(
            (m) => typeof m.content === "string" && m.content.includes("blue"),
          );
        })
        .returns("I received your answer: blue")
        .register();

      const registry = setupExtendedE2ERegistry();
      const client = createMockE2EClient();
      const logger = createLogger({ type: "hidden" });

      const mockInputProvider = new MockHumanInputProvider({
        "favorite color": "blue",
        "favorite number": "42",
      });

      // Note: parameterFormat is not supported in AgentBuilder
      const agent = new AgentBuilder(client)
        .withModel("openai:gpt-5-nano")
        .withGadgets(...registry.getAll())
        .withLogger(logger)
        .withMaxIterations(3)
        .onHumanInput((question) => mockInputProvider.provideInput(question))
        .ask(`Use the UserInput gadget to ask "What is your favorite color?".

        Example gadget call:
        !!!GADGET_START:UserInput
        {"question": "What is your favorite color?"}
        !!!GADGET_END:

        After receiving the result, acknowledge it.`);

      const events = await collectAllEvents(agent.run());

      const gadgetResults = filterEventsByType(events, "gadget_result");
      const userInputCall = gadgetResults.find((r) => r.result.gadgetName === "UserInput");

      expect(userInputCall).toBeDefined();
      expect(userInputCall?.result.result).toBe("blue");
    });

    it("incorporates human input into conversation flow", async () => {
      // First: ask for number
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .when(async (context) => {
          // Match on first call - user prompt mentions UserInput
          // Don't check for "number" as it's in the initial prompt
          return context.messages.some(
            (m) => typeof m.content === "string" && m.content.includes("UserInput"),
          );
        })
        .returnsGadgetCall("UserInput", {
          question: "Please enter a number",
        })
        .once()
        .register();

      // Second: multiply by 2
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .when(async (context) => {
          return context.messages.some(
            (m) => typeof m.content === "string" && m.content.includes("25"),
          );
        })
        .returnsGadgetCall("Calculator", {
          operation: "multiply",
          a: 25,
          b: 2,
        })
        .register();

      const registry = setupExtendedE2ERegistry();
      const client = createMockE2EClient();
      const logger = createLogger({ type: "hidden" });

      const mockInputProvider = new MockHumanInputProvider({
        number: "25",
      });

      // Note: parameterFormat is not supported in AgentBuilder
      const agent = new AgentBuilder(client)
        .withModel("openai:gpt-5-nano")
        .withGadgets(...registry.getAll())
        .withLogger(logger)
        .withMaxIterations(4)
        .onHumanInput((question) => mockInputProvider.provideInput(question))
        .ask(`Ask the user for a number using UserInput,
        then use Calculator to multiply that number by 2`);

      const events = await collectAllEvents(agent.run());

      const gadgetResults = filterEventsByType(events, "gadget_result");

      // Should have UserInput and Calculator calls
      const userInputCall = gadgetResults.find((r) => r.result.gadgetName === "UserInput");
      expect(userInputCall?.result.result).toBe("25");

      const calcCall = gadgetResults.find(
        (r) => r.result.gadgetName === "Calculator" && r.result.result?.includes("50"),
      );
      expect(calcCall).toBeDefined();
    });
  });

  describe("Complex Scenario Tests", () => {
    it("executes conditional actions based on iteration", async () => {
      // Setup sequential conditional calls
      let conditionalCallCount = 0;
      const conditionalParams = [
        { iteration: 1, condition: "first", action: "Initialize" },
        { iteration: 2, condition: "even", action: "Process even" },
        { iteration: 3, condition: "odd", action: "Process odd" },
      ];

      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .when(() => true) // Always match - let withResponse handle the logic
        .withResponse(() => {
          const params = conditionalParams[conditionalCallCount++];
          if (!params) {
            return { text: "All iterations complete" };
          }
          return {
            gadgetCalls: [{ gadgetName: "ConditionalAction", parameters: params }],
          };
        })
        .register();

      const registry = setupExtendedE2ERegistry();
      const client = createMockE2EClient();
      const logger = createLogger({ type: "hidden" });

      // Note: parameterFormat is not supported in AgentBuilder
      const agent = new AgentBuilder(client)
        .withModel("openai:gpt-5-nano")
        .withGadgets(...registry.getAll())
        .withLogger(logger)
        .withMaxIterations(4)
        .ask(`Use ConditionalAction gadget:
        1. On iteration 1 with condition "first", action "Initialize"
        2. On iteration 2 with condition "even", action "Process even"
        3. On iteration 3 with condition "odd", action "Process odd"`);

      const events = await collectAllEvents(agent.run());

      const gadgetResults = filterEventsByType(events, "gadget_result");
      const conditionalCalls = gadgetResults.filter(
        (r) => r.result.gadgetName === "ConditionalAction",
      );

      expect(conditionalCalls.length).toBeGreaterThanOrEqual(3);

      // Check history
      const history = ConditionalGadget.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(3);

      // Verify first condition was met
      const firstIterResult = conditionalCalls.find((r) =>
        r.result.result?.includes("Condition 'first' met"),
      );
      expect(firstIterResult).toBeDefined();
    });

    it("combines multiple gadget types in complex workflow", async () => {
      // Setup mocks for complex workflow
      let workflowStep = 0;
      const workflowSteps = [
        { gadgetName: "GetCurrentTime", parameters: { format: "iso" } },
        { gadgetName: "StateTracker", parameters: { operation: "increment", value: 3 } },
        { gadgetName: "DataAccumulator", parameters: { operation: "add", value: 20 } },
        { gadgetName: "Calculator", parameters: { operation: "add", a: 15, b: 25 } },
        {
          gadgetName: "StringManipulator",
          parameters: { operation: "uppercase", text: "workflow test" },
        },
      ];

      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .when(async () => workflowStep < workflowSteps.length)
        .withResponse(() => {
          if (workflowStep >= workflowSteps.length) {
            return { text: "All workflow steps complete" };
          }
          const step = workflowSteps[workflowStep++];
          return {
            text: `Executing ${step.gadgetName}...\n\n`,
            gadgetCalls: [step],
          };
        })
        .register();

      const registry = setupExtendedE2ERegistry();
      const client = createMockE2EClient();
      const logger = createLogger({ type: "hidden" });
      const stateManager = new TestStateManager();

      // Note: parameterFormat is not supported in AgentBuilder
      const agent = new AgentBuilder(client)
        .withModel("openai:gpt-5-nano")
        .withGadgets(...registry.getAll())
        .withLogger(logger)
        .withMaxIterations(5)
        .ask(`Complete this workflow:
        1. Get current time with GetCurrentTime (format: iso)
        2. Use StateTracker to increment by 3
        3. Use DataAccumulator to add number 20
        4. Use Calculator to add 15 + 25
        5. Use StringManipulator to uppercase "workflow test"
        Report all results`);

      const events = await collectAllEvents(agent.run());

      const gadgetResults = filterEventsByType(events, "gadget_result");

      // Track execution
      gadgetResults.forEach((result) => {
        stateManager.track(result.result.gadgetName, 0, result.result.result);
      });

      // Verify all gadget types were called
      const gadgetNames = new Set(gadgetResults.map((r) => r.result.gadgetName));
      expect(gadgetNames.has("GetCurrentTime")).toBe(true);
      expect(gadgetNames.has("StateTracker")).toBe(true);
      expect(gadgetNames.has("DataAccumulator")).toBe(true);
      expect(gadgetNames.has("Calculator")).toBe(true);
      expect(gadgetNames.has("StringManipulator")).toBe(true);

      // Verify specific results
      const calcResult = gadgetResults.find(
        (r) => r.result.gadgetName === "Calculator" && r.result.result?.includes("40"),
      );
      expect(calcResult).toBeDefined();

      const stringResult = gadgetResults.find((r) => r.result.gadgetName === "StringManipulator");
      expect(stringResult?.result.result).toBe("WORKFLOW TEST");

      // Verify state manager tracked everything
      expect(stateManager.getHistory().length).toBeGreaterThanOrEqual(5);
    });

    it("handles errors gracefully and continues execution", async () => {
      // Setup mocks for error handling
      let errorStep = 0;
      const errorSteps = [
        { gadgetName: "Calculator", parameters: { operation: "divide", a: 10, b: 0 } },
        { gadgetName: "StateTracker", parameters: { operation: "increment", value: 1 } },
        {
          gadgetName: "StringManipulator",
          parameters: { operation: "reverse", text: "error recovery" },
        },
      ];

      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .when(async () => errorStep < errorSteps.length)
        .withResponse(() => {
          if (errorStep >= errorSteps.length) {
            return { text: "Error handling complete" };
          }
          const step = errorSteps[errorStep++];
          return {
            gadgetCalls: [step],
          };
        })
        .register();

      const registry = setupExtendedE2ERegistry();
      const client = createMockE2EClient();
      const logger = createLogger({ type: "hidden" });

      // Note: parameterFormat is not supported in AgentBuilder
      const agent = new AgentBuilder(client)
        .withModel("openai:gpt-5-nano")
        .withGadgets(...registry.getAll())
        .withLogger(logger)
        .withMaxIterations(4)
        .ask(`Try these operations:
        1. Use Calculator to divide 10 by 0 (this will error)
        2. Use StateTracker to increment by 1 (should still work)
        3. Use StringManipulator to reverse "error recovery"
        Continue even if there are errors`);

      const events = await collectAllEvents(agent.run());

      const gadgetResults = filterEventsByType(events, "gadget_result");

      // Should have attempted all operations
      expect(gadgetResults.length).toBeGreaterThanOrEqual(3);

      // Check division by zero error
      const divisionResult = gadgetResults.find(
        (r) =>
          r.result.gadgetName === "Calculator" &&
          (r.result.error || r.result.result?.includes("Division by zero")),
      );
      expect(divisionResult).toBeDefined();

      // Verify other gadgets still executed
      const stateTrackerResult = gadgetResults.find((r) => r.result.gadgetName === "StateTracker");
      expect(stateTrackerResult).toBeDefined();

      const stringResult = gadgetResults.find((r) => r.result.gadgetName === "StringManipulator");
      expect(stringResult?.result.result).toBe("yrevocer rorre");
    });

    it("processes multiple gadgets in parallel within single iteration", async () => {
      // Mock returns all three gadgets at once
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .whenMessageContains("parallel")
        .withResponse({
          text: "Executing three gadgets in parallel...\n\n",
          gadgetCalls: [
            { gadgetName: "Calculator", parameters: { operation: "add", a: 5, b: 7 } },
            {
              gadgetName: "StringManipulator",
              parameters: { operation: "reverse", text: "parallel" },
            },
            { gadgetName: "GetCurrentTime", parameters: { format: "unix" } },
          ],
        })
        .register();

      const registry = setupExtendedE2ERegistry();
      const client = createMockE2EClient();
      const logger = createLogger({ type: "hidden" });

      // Note: parameterFormat is not supported in AgentBuilder
      const agent = new AgentBuilder(client)
        .withModel("openai:gpt-5-nano")
        .withGadgets(...registry.getAll())
        .withLogger(logger)
        .withMaxIterations(2)
        .ask(`In a single response, call these three gadgets in parallel:
        - Calculator: add 5 + 7
        - StringManipulator: reverse "parallel"
        - GetCurrentTime: format unix
        All three should execute in the same iteration`);

      const events = await collectAllEvents(agent.run());

      const gadgetResults = filterEventsByType(events, "gadget_result");

      // Should have all three gadgets
      expect(gadgetResults.length).toBeGreaterThanOrEqual(3);

      // Verify all three gadget types
      const gadgetNames = gadgetResults.map((r) => r.result.gadgetName);
      expect(gadgetNames).toContain("Calculator");
      expect(gadgetNames).toContain("StringManipulator");
      expect(gadgetNames).toContain("GetCurrentTime");

      // Verify specific results
      const calcResult = gadgetResults.find((r) => r.result.gadgetName === "Calculator");
      expect(calcResult?.result.result).toContain("12");

      const stringResult = gadgetResults.find((r) => r.result.gadgetName === "StringManipulator");
      expect(stringResult?.result.result).toBe("lellarap");
    });
  });

  describe("Edge Cases", () => {
    it("handles empty parameters with defaults", async () => {
      // Mock returns StateTracker without params
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .whenMessageContains("StateTracker")
        .whenMessageContains("without specifying")
        .returnsGadgetCall("StateTracker", {
          operation: "increment",
        })
        .register();

      const registry = setupExtendedE2ERegistry();
      const client = createMockE2EClient();
      const logger = createLogger({ type: "hidden" });

      // Note: parameterFormat is not supported in AgentBuilder
      const agent = new AgentBuilder(client)
        .withModel("openai:gpt-5-nano")
        .withGadgets(...registry.getAll())
        .withLogger(logger)
        .withMaxIterations(2)
        .ask(`Use StateTracker without specifying any parameters (should use defaults)`);

      const events = await collectAllEvents(agent.run());

      const gadgetResults = filterEventsByType(events, "gadget_result");
      const stateTrackerResult = gadgetResults.find((r) => r.result.gadgetName === "StateTracker");

      // Should increment by default value (1)
      expect(stateTrackerResult).toBeDefined();
      expect(stateTrackerResult?.result.result).toContain("incremented by 1");
    });

    it("recovers from malformed parameters", async () => {
      // First attempt with invalid operation
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .when(async (context) => {
          const lastMsg = context.messages[context.messages.length - 1]?.content || "";
          return (
            typeof lastMsg === "string" &&
            lastMsg.includes("divide_by_zero") &&
            !context.messages.some(
              (m) => typeof m.content === "string" && m.content.includes("invalid"),
            )
          );
        })
        .returnsGadgetCall("Calculator", {
          operation: "divide_by_zero",
          a: 10,
          b: 5,
        })
        .once()
        .register();

      // Second attempt with correct operation
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .when(async (context) => {
          return context.messages.some(
            (m) => typeof m.content === "string" && m.content.includes("invalid"),
          );
        })
        .returnsGadgetCall("Calculator", {
          operation: "add",
          a: 10,
          b: 5,
        })
        .register();

      const registry = setupExtendedE2ERegistry();
      const client = createMockE2EClient();
      const logger = createLogger({ type: "hidden" });

      // Note: parameterFormat is not supported in AgentBuilder
      const agent = new AgentBuilder(client)
        .withModel("openai:gpt-5-nano")
        .withGadgets(...registry.getAll())
        .withLogger(logger)
        .withMaxIterations(3)
        .ask(`First try Calculator with invalid operation "divide_by_zero"
        Then use Calculator correctly with operation "add", a: 10, b: 5`);

      const events = await collectAllEvents(agent.run());

      const gadgetResults = filterEventsByType(events, "gadget_result");

      // Should have at least one successful Calculator call
      const successfulCalc = gadgetResults.find(
        (r) => r.result.gadgetName === "Calculator" && r.result.result?.includes("15"),
      );
      expect(successfulCalc).toBeDefined();
    });
  });
});
