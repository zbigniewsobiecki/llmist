/**
 * Mock setup utilities for E2E tests using the mock testing system
 * Provides helpers for creating common mock scenarios with realistic responses
 */

import { createMockClient, getMockManager, mockLLM } from "../../../testing/src/index.js";

/**
 * Creates a mock client with automatic cleanup
 * Use this instead of createE2EClient() in tests that don't need real API calls
 */
export function createMockE2EClient() {
  return createMockClient();
}

/**
 * Setup mocks for basic gadget execution tests
 * Registers mocks that return gadget invocations for calculator and string manipulator
 */
export function setupCalculatorMocks() {
  // Mock for simple Calculator usage
  mockLLM()
    .forModel("gpt-5-nano")
    .whenMessageContains("calculate")
    .whenMessageContains("42")
    .whenMessageContains("58")
    .returnsGadgetCall("Calculator", {
      operation: "add",
      a: 42,
      b: 58,
    })
    .register();

  // Mock for Calculator with division
  mockLLM()
    .forModel("gpt-5-nano")
    .whenMessageContains("calculate")
    .whenMessageContains("100")
    .whenMessageContains("4")
    .returnsGadgetCall("Calculator", {
      operation: "divide",
      a: 100,
      b: 4,
    })
    .register();
}

/**
 * Setup mocks for string manipulation tests
 */
export function setupStringManipulatorMocks() {
  mockLLM()
    .forModel("gpt-5-nano")
    .whenMessageContains("reverse")
    .whenMessageContains("Hello World")
    .returnsGadgetCall("StringManipulator", {
      operation: "reverse",
      text: "Hello World",
    })
    .register();

  mockLLM()
    .forModel("gpt-5-nano")
    .whenMessageContains("uppercase")
    .whenMessageContains("test")
    .returnsGadgetCall("StringManipulator", {
      operation: "uppercase",
      text: "test",
    })
    .register();
}

/**
 * Setup mocks for multi-gadget workflows
 */
export function setupMultiGadgetMocks() {
  // Mock that returns multiple gadget calls
  mockLLM()
    .forModel("gpt-5-nano")
    .when(async (context) => {
      const lastMessage = context.messages[context.messages.length - 1]?.content || "";
      return (
        typeof lastMessage === "string" &&
        lastMessage.includes("10 * 5") &&
        lastMessage.includes("50 + 25")
      );
    })
    .returns((context) => {
      return {
        text: "I'll perform both calculations.\n\n",
        gadgetCalls: [
          {
            gadgetName: "Calculator",
            parameters: { operation: "multiply", a: 10, b: 5 },
          },
          {
            gadgetName: "Calculator",
            parameters: { operation: "add", a: 50, b: 25 },
          },
        ],
      };
    })
    .register();

  // Mock for mixed gadget types
  mockLLM()
    .forModel("gpt-5-nano")
    .when(async (context) => {
      const lastMessage = context.messages[context.messages.length - 1]?.content || "";
      return (
        typeof lastMessage === "string" &&
        lastMessage.includes("GetCurrentTime") &&
        lastMessage.includes("StringManipulator") &&
        lastMessage.includes("Calculator")
      );
    })
    .returns({
      text: "I'll execute all three gadgets.\n\n",
      gadgetCalls: [
        { gadgetName: "GetCurrentTime", parameters: { format: "iso" } },
        { gadgetName: "StringManipulator", parameters: { operation: "uppercase", text: "test" } },
        { gadgetName: "Calculator", parameters: { operation: "add", a: 15, b: 25 } },
      ],
    })
    .register();
}

/**
 * Setup mocks for error handling tests
 */
export function setupErrorHandlingMocks() {
  mockLLM()
    .forModel("gpt-5-nano")
    .whenMessageContains("divide")
    .whenMessageContains("by 0")
    .returnsGadgetCall("Calculator", {
      operation: "divide",
      a: 100,
      b: 0,
    })
    .register();
}

/**
 * Setup mocks for text-only responses (no gadgets)
 */
export function setupTextOnlyMocks() {
  mockLLM()
    .forModel("gpt-5-nano")
    .whenMessageContains("explain what")
    .whenMessageContains("Calculator gadget")
    .returns(
      "The Calculator gadget performs basic arithmetic operations including addition, " +
        "subtraction, multiplication, and division. It takes two numbers and an operation " +
        "as parameters and returns the computed result.",
    )
    .register();
}

/**
 * Setup mocks for new parameter format tests
 */
export function setupNewFormatMocks() {
  mockLLM()
    .forModel("gpt-5-nano")
    .whenMessageContains("123")
    .whenMessageContains("456")
    .returnsGadgetCall("Calculator", {
      operation: "add",
      a: 123,
      b: 456,
    })
    .register();
}

/**
 * Setup mocks for conversation context tests
 */
export function setupContextMocks() {
  // First iteration: 20 + 30
  mockLLM()
    .forModel("gpt-5-nano")
    .whenMessageContains("20 + 30")
    .whenMessageContains("multiply that result by 2")
    .returnsGadgetCall("Calculator", {
      operation: "add",
      a: 20,
      b: 30,
    })
    .once()
    .register();

  // Second iteration: multiply by 2 (context-aware)
  mockLLM()
    .forModel("gpt-5-nano")
    .when(async (context) => {
      // Check if there's a gadget result for 50 in conversation
      const hasResult50 = context.messages.some((msg) => {
        if (typeof msg.content === "string") {
          return msg.content.includes("50") && msg.role === "assistant";
        }
        return false;
      });
      return hasResult50;
    })
    .returnsGadgetCall("Calculator", {
      operation: "multiply",
      a: 50,
      b: 2,
    })
    .register();
}

/**
 * Clear all registered mocks
 * Call this in afterEach or beforeEach to ensure test isolation
 */
export function clearAllMocks() {
  getMockManager().clear();
}
