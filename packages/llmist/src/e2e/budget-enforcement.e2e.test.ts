import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockLLM } from "../../../testing/src/index.js";
import { AgentBuilder } from "../agent/builder.js";
import { BudgetPricingUnavailableError } from "../gadgets/exceptions.js";
import { createLogger } from "../logging/logger.js";
import { TEST_TIMEOUTS } from "./fixtures.js";
import { clearAllMocks, createMockE2EClient } from "./mock-setup.js";
import { collectAllEvents, setupE2ERegistry } from "./setup.js";

describe("E2E: Budget Enforcement", () => {
  beforeEach(() => {
    clearAllMocks();
  });

  afterEach(() => {
    clearAllMocks();
  });

  it(
    "stops loop when budget is exceeded",
    async () => {
      // Register model with known pricing: $10/1M input, $30/1M output
      const client = createMockE2EClient();
      client.modelRegistry.registerModel({
        provider: "openai",
        modelId: "gpt-5-nano",
        displayName: "GPT-5 Nano",
        contextWindow: 128000,
        maxOutputTokens: 16384,
        pricing: { input: 10, output: 30 },
        knowledgeCutoff: "2025-01",
        features: { streaming: true, functionCalling: true, vision: false },
      });

      // Mock LLM that always returns a gadget call (so the loop continues)
      // With usage of 1000 input + 500 output tokens per call
      // Cost per call: (1000/1M)*10 + (500/1M)*30 = 0.01 + 0.015 = $0.025
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .returnsGadgetCall("Calculator", { operation: "add", a: 1, b: 1 })
        .withUsage({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 })
        .register();

      const registry = setupE2ERegistry();
      const logger = createLogger({ type: "hidden" });

      // Budget of $0.05 should allow ~2 iterations ($0.025 each)
      const agent = new AgentBuilder(client)
        .withModel("openai:gpt-5-nano")
        .withGadgets(...registry.getAll())
        .withMaxIterations(20)
        .withBudget(0.05)
        .withLogger(logger)
        .ask("Calculate 1 + 1 repeatedly");

      const events = await collectAllEvents(agent.run());

      // Should have stopped before 20 iterations due to budget
      const gadgetResults = events.filter((e) => e.type === "gadget_result");
      expect(gadgetResults.length).toBeLessThan(20);
      expect(gadgetResults.length).toBeGreaterThan(0);
    },
    TEST_TIMEOUTS.STANDARD,
  );

  it("throws BudgetPricingUnavailableError for model with no pricing", () => {
    const client = createMockE2EClient();
    const registry = setupE2ERegistry();
    const logger = createLogger({ type: "hidden" });

    expect(() => {
      new AgentBuilder(client)
        .withModel("unknown-model-without-pricing")
        .withGadgets(...registry.getAll())
        .withBudget(1.0)
        .withLogger(logger)
        .ask("Hello");
    }).toThrow(BudgetPricingUnavailableError);
  });

  it(
    "allows agent to run normally when no budget is set",
    async () => {
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .returns("Hello! I can help you with that.")
        .register();

      const client = createMockE2EClient();
      const registry = setupE2ERegistry();
      const logger = createLogger({ type: "hidden" });

      const agent = new AgentBuilder(client)
        .withModel("openai:gpt-5-nano")
        .withGadgets(...registry.getAll())
        .withMaxIterations(5)
        .withLogger(logger)
        .ask("Say hello");

      const events = await collectAllEvents(agent.run());

      // Should complete normally (text-only response terminates loop)
      const textEvents = events.filter((e) => e.type === "text");
      expect(textEvents.length).toBeGreaterThan(0);
    },
    TEST_TIMEOUTS.QUICK,
  );

  it(
    "maxIterations hit before budget stops the loop",
    async () => {
      const client = createMockE2EClient();
      client.modelRegistry.registerModel({
        provider: "openai",
        modelId: "gpt-5-nano",
        displayName: "GPT-5 Nano",
        contextWindow: 128000,
        maxOutputTokens: 16384,
        pricing: { input: 10, output: 30 },
        knowledgeCutoff: "2025-01",
        features: { streaming: true, functionCalling: true, vision: false },
      });

      // Each call costs $0.025 with these tokens
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .returnsGadgetCall("Calculator", { operation: "add", a: 1, b: 1 })
        .withUsage({ inputTokens: 1000, outputTokens: 500, totalTokens: 1500 })
        .register();

      const registry = setupE2ERegistry();
      const logger = createLogger({ type: "hidden" });

      // Budget of $100 is very generous, but maxIterations of 2 should stop first
      const agent = new AgentBuilder(client)
        .withModel("openai:gpt-5-nano")
        .withGadgets(...registry.getAll())
        .withMaxIterations(2)
        .withBudget(100)
        .withLogger(logger)
        .ask("Calculate 1 + 1 repeatedly");

      const events = await collectAllEvents(agent.run());

      // Should have stopped at 2 iterations (maxIterations), not budget
      const gadgetResults = events.filter((e) => e.type === "gadget_result");
      expect(gadgetResults.length).toBeLessThanOrEqual(2);
    },
    TEST_TIMEOUTS.STANDARD,
  );
});
