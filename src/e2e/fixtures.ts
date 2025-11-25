/**
 * Consolidated test fixtures and utilities for E2E tests
 * Provides reusable test setup patterns, timeout constants, and builder utilities
 */

import type { Agent } from "../agent/agent.js";
import { AgentBuilder } from "../agent/builder.js";
import type { LLMist } from "../core/client.js";
import type { BaseGadget } from "../gadgets/gadget.js";
import { GadgetRegistry } from "../gadgets/registry.js";
import { createLogger } from "../logging/logger.js";
import type { Logger } from "../logging/types.js";
import {
  CalculatorGadget,
  ConditionalGadget,
  createE2EClient,
  DataAccumulatorGadget,
  LoopBreakerGadget,
  StateTrackerGadget,
  StringManipulatorGadget,
  TimeGadget,
  UserInputGadget,
} from "./setup.js";

/**
 * Standardized timeout constants for different test complexity levels
 */
export const TEST_TIMEOUTS = {
  /** Quick operations like simple gadget calls (30s) */
  QUICK: 30000,
  /** Standard multi-iteration tests (45s) */
  STANDARD: 45000,
  /** Complex tests with multiple gadget types (60s) */
  COMPLEX: 60000,
  /** Heavy tests with many iterations or provider comparisons (90s) */
  HEAVY: 90000,
  /** Maximum timeout for stress tests (120s) */
  MAX: 120000,
} as const;

/**
 * Gadget groups for registry setup
 */
export const GADGET_GROUPS = {
  /** Basic gadgets for simple tests */
  basic: [
    () => new CalculatorGadget(),
    () => new StringManipulatorGadget(),
    () => new TimeGadget(),
  ],
  /** Extended gadgets including state management */
  extended: [
    () => new StateTrackerGadget(),
    () => new DataAccumulatorGadget(),
    () => new ConditionalGadget(),
  ],
  /** Control flow and interaction gadgets */
  control: [() => new LoopBreakerGadget(), () => new UserInputGadget()],
} as const;

/**
 * Test fixture configuration options
 */
export interface TestFixtureOptions {
  /** Which gadget groups to include */
  gadgets?: Array<keyof typeof GADGET_GROUPS>;
  /** Custom gadgets to add */
  customGadgets?: BaseGadget[];
  /** Whether to clear registry before setup */
  clearRegistry?: boolean;
  /** Logger configuration */
  logLevel?: "hidden" | "error" | "warn" | "info" | "debug";
}

/**
 * Complete test fixture with all necessary components
 */
export interface TestFixture {
  client: LLMist;
  registry: GadgetRegistry;
  logger: Logger;
  cleanup: () => void;
}

/**
 * Creates a complete test fixture with standardized setup
 */
export function createTestFixture(options: TestFixtureOptions = {}): TestFixture {
  const { gadgets = ["basic"], customGadgets = [], logLevel = "hidden" } = options;

  // Create a new registry instance
  const registry = new GadgetRegistry();

  // Register selected gadget groups
  for (const group of gadgets) {
    const gadgetFactories = GADGET_GROUPS[group];
    if (gadgetFactories) {
      for (const factory of gadgetFactories) {
        registry.registerByClass(factory());
      }
    }
  }

  // Register custom gadgets
  for (const gadget of customGadgets) {
    registry.registerByClass(gadget);
  }

  // Create client with options from configuration
  // Currently using defaults from createE2EClient, but this could be extended
  // to use clientOptions when createE2EClient is updated to accept options
  const client = createE2EClient();
  const logger = createLogger({ type: logLevel });

  // Cleanup function (no longer needed with new instances, but kept for compatibility)
  const cleanup = () => {
    // No-op: each test gets a fresh registry instance
  };

  return {
    client,
    registry,
    logger,
    cleanup,
  };
}

/**
 * Builder pattern for test Agent configuration
 */
export class TestAgentBuilder {
  private builder: AgentBuilder;
  private userPrompt?: string;
  private gadgets: BaseGadget[] = [];

  constructor(fixture: TestFixture) {
    this.builder = new AgentBuilder(fixture.client);
    this.builder.withLogger(fixture.logger);
    this.builder.withModel("openai:gpt-5-nano"); // Default model
    this.builder.withMaxIterations(10); // Default max iterations
    this.gadgets = fixture.registry.getAll();
  }

  withModel(model: string): this {
    this.builder.withModel(model);
    return this;
  }

  withPrompt(userPrompt: string, systemPrompt?: string): this {
    this.userPrompt = userPrompt;
    if (systemPrompt) {
      this.builder.withSystem(systemPrompt);
    }
    return this;
  }

  withMaxIterations(max: number): this {
    this.builder.withMaxIterations(max);
    return this;
  }

  withTextOnlyHandler(handler: "terminate" | "continue" | "retry"): this {
    // Note: textOnlyHandler is not directly supported in AgentBuilder
    // This would need to be added to AgentBuilder if needed
    return this;
  }

  withParameterFormat(format: "yaml" | "json"): this {
    // Note: parameterFormat is not directly supported in AgentBuilder
    // This would need to be added to AgentBuilder if needed
    return this;
  }

  build(): Agent {
    if (!this.userPrompt) {
      throw new Error("User prompt is required");
    }

    // Add all gadgets from the registry
    if (this.gadgets.length > 0) {
      this.builder.withGadgets(...this.gadgets);
    }

    return this.builder.ask(this.userPrompt);
  }
}

/**
 * Creates a standardized Agent for testing
 */
export function createAgent(fixture: TestFixture, userPrompt: string, options: any = {}): Agent {
  return new TestAgentBuilder(fixture)
    .withPrompt(userPrompt, options.systemPrompt)
    .withModel(options.model || "openai:gpt-5-nano")
    .withMaxIterations(options.maxIterations || 10)
    .withTextOnlyHandler(options.textOnlyHandler || "terminate")
    .withParameterFormat(options.parameterFormat || "yaml")
    .build();
}

/**
 * Helper to create a simple test setup in one line
 * Usage: const { client, registry, logger, agent } = createSimpleTestSetup('Do something');
 */
export function createSimpleTestSetup(
  userPrompt: string,
  options: TestFixtureOptions & Partial<Agent["config"]> = {},
): TestFixture & { agent: Agent } {
  const fixture = createTestFixture(options);
  const agent = createAgent(fixture, userPrompt, options);

  return {
    ...fixture,
    agent,
  };
}

/**
 * Consolidated registry setup that replaces both setupE2ERegistry and setupExtendedE2ERegistry
 */
export function setupTestRegistry(extended: boolean = false): GadgetRegistry {
  const gadgets = extended ? ["basic", "extended", "control"] : ["basic"];
  const registry = new GadgetRegistry();

  // Register selected gadget groups
  for (const group of gadgets) {
    const gadgetFactories = GADGET_GROUPS[group];
    if (gadgetFactories) {
      for (const factory of gadgetFactories) {
        registry.registerByClass(factory());
      }
    }
  }

  return registry;
}

/**
 * Helper to determine appropriate timeout based on test complexity
 */
export function getTestTimeout(options: {
  iterations?: number;
  gadgetCount?: number;
  providerCount?: number;
}): number {
  const { iterations = 1, gadgetCount = 1, providerCount = 1 } = options;

  // Calculate complexity score
  const complexity = iterations * gadgetCount * providerCount;

  if (complexity <= 3) return TEST_TIMEOUTS.QUICK;
  if (complexity <= 10) return TEST_TIMEOUTS.STANDARD;
  if (complexity <= 20) return TEST_TIMEOUTS.COMPLEX;
  if (complexity <= 40) return TEST_TIMEOUTS.HEAVY;
  return TEST_TIMEOUTS.MAX;
}
