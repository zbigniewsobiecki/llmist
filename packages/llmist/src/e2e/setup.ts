import { mock } from "bun:test";
import * as path from "node:path";
import * as dotenv from "dotenv";
import { z } from "zod";

import { LLMist } from "../core/client.js";
import { TaskCompletionSignal, HumanInputRequiredException } from "../gadgets/exceptions.js";
import { GadgetRegistry } from "../gadgets/registry.js";
import { Gadget } from "../gadgets/typed-gadget.js";
import type { StreamEvent } from "../gadgets/types.js";
import { createMockClient } from "../../../testing/src/index.js";

// Load environment variables from .env file
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

/**
 * Validates that required environment variables are set for E2E tests with real API calls
 * Returns true if API keys are available, false otherwise
 */
export function hasE2EApiKeys(): boolean {
  const openAIKey = process.env.OPENAI_API_KEY;
  return !!(openAIKey && openAIKey.startsWith("sk-"));
}

/**
 * Creates a LLMist configured for E2E testing
 * Uses mock client when API keys are not available, allowing tests to run without real API calls
 */
export function createE2EClient(): LLMist {
  // Use mock client if API keys aren't available
  if (!hasE2EApiKeys()) {
    return createMockClient();
  }

  // Auto-discover providers from environment when API keys are available
  return new LLMist({
    autoDiscoverProviders: true,
    defaultProvider: "openai",
  });
}

/**
 * Test gadget for mathematical operations
 */
export class CalculatorGadget extends Gadget({
  name: "Calculator",
  description: "Performs basic arithmetic operations",
  schema: z.object({
    operation: z
      .enum(["add", "subtract", "multiply", "divide"])
      .describe("The arithmetic operation to perform"),
    a: z.number().describe("First number"),
    b: z.number().describe("Second number"),
  }),
}) {
  execute(params: this["params"]): string {
    const { operation, a, b } = params;

    switch (operation) {
      case "add":
        return `${a} + ${b} = ${a + b}`;
      case "subtract":
        return `${a} - ${b} = ${a - b}`;
      case "multiply":
        return `${a} * ${b} = ${a * b}`;
      case "divide":
        if (b === 0) return "Error: Division by zero";
        return `${a} / ${b} = ${a / b}`;
      default:
        return "Error: Unknown operation";
    }
  }
}

/**
 * Test gadget for string manipulation
 */
export class StringManipulatorGadget extends Gadget({
  name: "StringManipulator",
  description: "Manipulates text strings in various ways",
  schema: z.object({
    operation: z
      .enum(["uppercase", "lowercase", "reverse", "length"])
      .describe("The string operation to perform"),
    text: z.string().describe("The text to manipulate"),
  }),
}) {
  execute(params: this["params"]): string {
    const { operation, text } = params;

    switch (operation) {
      case "uppercase":
        return text.toUpperCase();
      case "lowercase":
        return text.toLowerCase();
      case "reverse":
        return text.split("").reverse().join("");
      case "length":
        return `Length: ${text.length} characters`;
      default:
        return "Error: Unknown operation";
    }
  }
}

/**
 * Test gadget for getting current time
 */
export class TimeGadget extends Gadget({
  name: "GetCurrentTime",
  description: "Gets the current date and time",
  schema: z.object({
    format: z.enum(["iso", "locale", "unix"]).describe("The format for the time").default("iso"),
  }),
}) {
  execute(params: this["params"]): string {
    const { format } = params;
    const now = new Date();

    switch (format) {
      case "iso":
        return now.toISOString();
      case "locale":
        return now.toLocaleString();
      case "unix":
        return String(Math.floor(now.getTime() / 1000));
      default:
        return now.toISOString();
    }
  }
}

/**
 * Collects all events from an async generator
 */
export async function collectAllEvents(
  generator: AsyncGenerator<StreamEvent>,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

/**
 * Filters events by type
 */
export function filterEventsByType<T extends StreamEvent["type"]>(
  events: StreamEvent[],
  type: T,
): Extract<StreamEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<StreamEvent, { type: T }>[];
}

/**
 * Sets up test registry with E2E gadgets
 */
export function setupE2ERegistry(): GadgetRegistry {
  const registry = new GadgetRegistry();

  // Register test gadgets
  registry.registerByClass(new CalculatorGadget());
  registry.registerByClass(new StringManipulatorGadget());
  registry.registerByClass(new TimeGadget());

  return registry;
}

/**
 * Retry helper for flaky network operations
 */
export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, delay = 1000): Promise<T> {
  let lastError: Error | undefined;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on non-retryable errors
      if (
        error instanceof Error &&
        (error.message.includes("API key") ||
          error.message.includes("Invalid") ||
          error.message.includes("Unauthorized"))
      ) {
        throw error;
      }

      // Wait before retrying
      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
      }
    }
  }

  throw lastError || new Error("Max retries exceeded");
}

/**
 * Validates that a response contains expected content
 */
export function validateResponse(response: string, expectedPatterns: string[]): boolean {
  const lowerResponse = response.toLowerCase();
  return expectedPatterns.every((pattern) => lowerResponse.includes(pattern.toLowerCase()));
}

/**
 * Creates a mock console to suppress logs in tests
 */
export function suppressLogs(): () => void {
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };

  console.log = mock();
  console.warn = mock();
  console.error = mock();

  return () => {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  };
}

/**
 * Calculates estimated cost for OpenAI API usage
 * Based on GPT-3.5-turbo pricing (as of 2024)
 */
export function estimateCost(inputTokens: number, outputTokens: number): string {
  const INPUT_COST_PER_1K = 0.0015; // $0.0015 per 1K tokens
  const OUTPUT_COST_PER_1K = 0.002; // $0.002 per 1K tokens

  const inputCost = (inputTokens / 1000) * INPUT_COST_PER_1K;
  const outputCost = (outputTokens / 1000) * OUTPUT_COST_PER_1K;
  const totalCost = inputCost + outputCost;

  return `$${totalCost.toFixed(4)} (Input: ${inputTokens} tokens, Output: ${outputTokens} tokens)`;
}

/**
 * State tracking gadget for testing persistence across iterations
 */
export class StateTrackerGadget extends Gadget({
  name: "StateTracker",
  description: "Tracks state across iterations, incrementing a counter each time",
  schema: z.object({
    operation: z
      .enum(["increment", "get", "reset"])
      .describe("Operation to perform on the counter")
      .default("increment"),
    value: z.number().describe("Value to add when incrementing").default(1),
  }),
}) {
  private static counter = 0;

  execute(params: this["params"]): string {
    const { operation, value } = params;

    switch (operation) {
      case "increment":
        StateTrackerGadget.counter += value;
        return `Counter incremented by ${value}. New value: ${StateTrackerGadget.counter}`;
      case "get":
        return `Current counter value: ${StateTrackerGadget.counter}`;
      case "reset":
        StateTrackerGadget.counter = 0;
        return "Counter reset to 0";
      default:
        return `Unknown operation: ${operation}`;
    }
  }

  static resetCounter(): void {
    StateTrackerGadget.counter = 0;
  }
}

/**
 * Loop breaking gadget for testing TaskCompletionSignal
 */
export class LoopBreakerGadget extends Gadget({
  name: "LoopBreaker",
  description: "Breaks the agent loop when a condition is met",
  schema: z.object({
    threshold: z.number().describe("Value that triggers loop break").default(5),
    currentValue: z.number().describe("Current value to check against threshold"),
    message: z.string().describe("Message to return when breaking").optional(),
  }),
}) {
  execute(params: this["params"]): string {
    const { threshold, currentValue, message } = params;

    if (currentValue >= threshold) {
      const breakMessage = message || `Threshold ${threshold} reached with value ${currentValue}`;
      throw new TaskCompletionSignal(breakMessage);
    }

    return `Current value ${currentValue} is below threshold ${threshold}`;
  }
}

/**
 * User input gadget for testing HumanInputRequiredException
 */
export class UserInputGadget extends Gadget({
  name: "UserInput",
  description: "Requests input from the user",
  schema: z.object({
    question: z.string().describe("Question to ask the user").min(1),
    context: z.string().describe("Additional context for the question").optional(),
  }),
}) {
  execute(params: this["params"]): string {
    const { question, context } = params;

    const fullQuestion = context ? `${context}\n\n${question}` : question;

    throw new HumanInputRequiredException(fullQuestion);
  }
}

/**
 * Data accumulator gadget for testing state across iterations
 */
export class DataAccumulatorGadget extends Gadget({
  name: "DataAccumulator",
  description: "Accumulates data across multiple calls",
  schema: z.object({
    operation: z.enum(["add", "concatenate", "get", "clear"]).describe("Operation to perform"),
    data: z.union([z.string(), z.number()]).describe("Data to add or concatenate").optional(),
  }),
}) {
  private static numericData: number[] = [];
  private static stringData: string[] = [];

  execute(params: this["params"]): string {
    const { operation, data } = params;

    switch (operation) {
      case "add":
        if (typeof data === "number") {
          DataAccumulatorGadget.numericData.push(data);
          const sum = DataAccumulatorGadget.numericData.reduce((a, b) => a + b, 0);
          return `Added ${data}. Sum: ${sum}`;
        }
        return "Add operation requires numeric data";

      case "concatenate":
        if (typeof data === "string") {
          DataAccumulatorGadget.stringData.push(data);
          return `Added "${data}". Full text: ${DataAccumulatorGadget.stringData.join(" ")}`;
        }
        return "Concatenate operation requires string data";

      case "get": {
        const sum = DataAccumulatorGadget.numericData.reduce((a, b) => a + b, 0);
        const text = DataAccumulatorGadget.stringData.join(" ");
        return `Numbers sum: ${sum}, Text: "${text}"`;
      }

      case "clear":
        DataAccumulatorGadget.numericData = [];
        DataAccumulatorGadget.stringData = [];
        return "All data cleared";

      default:
        return `Unknown operation: ${operation}`;
    }
  }

  static clear(): void {
    DataAccumulatorGadget.numericData = [];
    DataAccumulatorGadget.stringData = [];
  }
}

/**
 * Conditional gadget for testing context-aware behavior
 */
export class ConditionalGadget extends Gadget({
  name: "ConditionalAction",
  description: "Performs different actions based on iteration count or conditions",
  schema: z.object({
    iteration: z.number().describe("Current iteration number"),
    condition: z.enum(["even", "odd", "first", "last", "specific"]).describe("Condition to check"),
    specificValue: z.number().describe("Specific iteration to match").optional(),
    action: z.string().describe("Action to perform when condition is met"),
  }),
}) {
  private static callHistory: Array<{ iteration: number; action: string }> = [];

  execute(params: this["params"]): string {
    const { iteration, condition, specificValue, action } = params;

    ConditionalGadget.callHistory.push({ iteration, action });

    let conditionMet = false;
    switch (condition) {
      case "even":
        conditionMet = iteration % 2 === 0;
        break;
      case "odd":
        conditionMet = iteration % 2 === 1;
        break;
      case "first":
        conditionMet = iteration === 1;
        break;
      case "specific":
        conditionMet = iteration === specificValue;
        break;
      default:
        return `Unknown condition: ${condition}`;
    }

    if (conditionMet) {
      return `Condition '${condition}' met at iteration ${iteration}. Performing: ${action}`;
    }

    return `Condition '${condition}' not met at iteration ${iteration}`;
  }

  static getHistory(): Array<{ iteration: number; action: string }> {
    return [...ConditionalGadget.callHistory];
  }

  static clearHistory(): void {
    ConditionalGadget.callHistory = [];
  }
}

/**
 * Enhanced registry setup with new test gadgets
 */
export function setupExtendedE2ERegistry(): GadgetRegistry {
  const registry = new GadgetRegistry();

  // Register original test gadgets
  registry.registerByClass(new CalculatorGadget());
  registry.registerByClass(new StringManipulatorGadget());
  registry.registerByClass(new TimeGadget());

  // Register new test gadgets
  registry.registerByClass(new StateTrackerGadget());
  registry.registerByClass(new LoopBreakerGadget());
  registry.registerByClass(new UserInputGadget());
  registry.registerByClass(new DataAccumulatorGadget());
  registry.registerByClass(new ConditionalGadget());

  return registry;
}

/**
 * Mock human input provider for testing
 */
export class MockHumanInputProvider {
  private responses: Map<string, string>;
  private callCount = 0;

  constructor(responses: Map<string, string> | Record<string, string>) {
    this.responses = responses instanceof Map ? responses : new Map(Object.entries(responses));
  }

  async provideInput(question: string): Promise<string> {
    this.callCount++;

    // Try exact match first
    if (this.responses.has(question)) {
      return this.responses.get(question)!;
    }

    // Try partial match
    for (const [key, value] of this.responses.entries()) {
      if (question.includes(key)) {
        return value;
      }
    }

    return `Mock response #${this.callCount}`;
  }

  getCallCount(): number {
    return this.callCount;
  }

  reset(): void {
    this.callCount = 0;
  }
}

/**
 * Iteration event collector for multi-iteration tests
 */
export function collectIterationEvents(events: StreamEvent[]): Map<number, StreamEvent[]> {
  const iterationMap = new Map<number, StreamEvent[]>();
  let currentIteration = 0;

  for (const event of events) {
    // Detect iteration boundaries (could be improved with explicit iteration markers)
    if (event.type === "text" && event.content.includes("iteration")) {
      const match = event.content.match(/iteration[:\s]+(\d+)/i);
      if (match) {
        currentIteration = parseInt(match[1], 10);
      }
    }

    if (!iterationMap.has(currentIteration)) {
      iterationMap.set(currentIteration, []);
    }
    iterationMap.get(currentIteration)?.push(event);
  }

  return iterationMap;
}

/**
 * Validates iteration flow
 */
export function validateIterationFlow(events: StreamEvent[], expectedIterations: number): boolean {
  const iterations = collectIterationEvents(events);

  // Check we have the expected number of iterations (0-indexed)
  if (iterations.size < expectedIterations) {
    return false;
  }

  // Check each iteration has some events
  for (let i = 0; i < expectedIterations; i++) {
    if (!iterations.has(i) || iterations.get(i)?.length === 0) {
      return false;
    }
  }

  return true;
}

/**
 * Test state manager for tracking gadget execution
 */
export class TestStateManager {
  private history: Array<{
    gadgetName: string;
    iteration: number;
    result: unknown;
    timestamp: number;
  }> = [];

  track(gadgetName: string, iteration: number, result: unknown): void {
    this.history.push({
      gadgetName,
      iteration,
      result,
      timestamp: Date.now(),
    });
  }

  getHistory(): typeof this.history {
    return [...this.history];
  }

  getGadgetCalls(gadgetName: string): typeof this.history {
    return this.history.filter((h) => h.gadgetName === gadgetName);
  }

  getIterationCalls(iteration: number): typeof this.history {
    return this.history.filter((h) => h.iteration === iteration);
  }

  clear(): void {
    this.history = [];
  }
}

/**
 * Helper to check if we're in CI environment
 */
export function isCI(): boolean {
  return process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
}

/**
 * Skip test if API key is not available
 */
export function skipIfNoAPIKey(provider: "openai" | "anthropic" | "gemini"): boolean {
  const keyMap = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    gemini: "GEMINI_API_KEY",
  };

  const key = process.env[keyMap[provider]];
  return !key || key.length === 0;
}
