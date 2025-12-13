/**
 * Mock gadget utilities for testing.
 *
 * Provides helpers for creating mock gadgets with configurable behavior
 * and call tracking.
 *
 * @module testing/mock-gadget
 */

import type { ZodType } from "zod";
import { AbstractGadget } from "../gadgets/gadget.js";

/**
 * Recorded gadget call for tracking.
 */
export interface RecordedCall {
  /** Parameters passed to execute() */
  params: Record<string, unknown>;
  /** When the call was made */
  timestamp: number;
}

/**
 * Mock gadget with call tracking capabilities.
 */
export interface MockGadget extends AbstractGadget {
  /** Get all recorded calls */
  getCalls(): RecordedCall[];
  /** Get number of times the gadget was executed */
  getCallCount(): number;
  /** Reset call history */
  resetCalls(): void;
  /** Check if gadget was called with specific params (partial match) */
  wasCalledWith(params: Partial<Record<string, unknown>>): boolean;
  /** Get the last call's parameters */
  getLastCall(): RecordedCall | undefined;
}

/**
 * Configuration for creating a mock gadget.
 */
export interface MockGadgetConfig<TSchema extends ZodType = ZodType> {
  /** Gadget name (required) */
  name: string;
  /** Gadget description */
  description?: string;
  /** Parameter schema */
  schema?: TSchema;
  /** Static result to return */
  result?: string;
  /** Dynamic result based on parameters */
  resultFn?: (params: Record<string, unknown>) => string | Promise<string>;
  /** Error to throw on execution */
  error?: Error | string;
  /** Enable call tracking (default: true) */
  trackCalls?: boolean;
  /** Execution delay in ms */
  delayMs?: number;
  /** Gadget timeout setting */
  timeoutMs?: number;
}

/**
 * Implementation of MockGadget.
 */
class MockGadgetImpl extends AbstractGadget implements MockGadget {
  override name: string;
  override description: string;
  override parameterSchema?: ZodType;
  override timeoutMs?: number;

  private calls: RecordedCall[] = [];
  private readonly resultValue?: string;
  private readonly resultFn?: (params: Record<string, unknown>) => string | Promise<string>;
  private readonly errorToThrow?: Error;
  private readonly delayMs: number;
  private readonly shouldTrackCalls: boolean;

  constructor(config: MockGadgetConfig) {
    super();
    this.name = config.name;
    this.description = config.description ?? `Mock gadget: ${config.name}`;
    this.parameterSchema = config.schema;
    this.resultValue = config.result;
    this.resultFn = config.resultFn;
    this.delayMs = config.delayMs ?? 0;
    this.shouldTrackCalls = config.trackCalls ?? true;
    this.timeoutMs = config.timeoutMs;

    if (config.error) {
      this.errorToThrow = typeof config.error === "string" ? new Error(config.error) : config.error;
    }
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    if (this.shouldTrackCalls) {
      this.calls.push({ params: { ...params }, timestamp: Date.now() });
    }

    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    if (this.errorToThrow) {
      throw this.errorToThrow;
    }

    if (this.resultFn) {
      return this.resultFn(params);
    }

    return this.resultValue ?? "mock result";
  }

  getCalls(): RecordedCall[] {
    return [...this.calls];
  }

  getCallCount(): number {
    return this.calls.length;
  }

  resetCalls(): void {
    this.calls = [];
  }

  wasCalledWith(params: Partial<Record<string, unknown>>): boolean {
    return this.calls.some((call) =>
      Object.entries(params).every(([key, value]) => call.params[key] === value),
    );
  }

  getLastCall(): RecordedCall | undefined {
    return this.calls.length > 0 ? this.calls[this.calls.length - 1] : undefined;
  }
}

/**
 * Create a mock gadget for testing.
 *
 * @param config - Mock gadget configuration
 * @returns MockGadget instance with call tracking
 *
 * @example
 * ```typescript
 * import { createMockGadget } from 'llmist/testing';
 * import { z } from 'zod';
 *
 * const calculator = createMockGadget({
 *   name: 'Calculator',
 *   schema: z.object({ a: z.number(), b: z.number() }),
 *   resultFn: ({ a, b }) => String(Number(a) + Number(b)),
 * });
 *
 * // Use in tests
 * const registry = new GadgetRegistry();
 * registry.registerByClass(calculator);
 *
 * // After running agent...
 * expect(calculator.getCallCount()).toBe(1);
 * expect(calculator.wasCalledWith({ a: 5 })).toBe(true);
 * ```
 */
export function createMockGadget<TSchema extends ZodType>(
  config: MockGadgetConfig<TSchema>,
): MockGadget {
  return new MockGadgetImpl(config);
}

/**
 * Fluent builder for creating mock gadgets.
 *
 * @example
 * ```typescript
 * import { mockGadget } from 'llmist/testing';
 * import { z } from 'zod';
 *
 * const mock = mockGadget()
 *   .withName('Weather')
 *   .withDescription('Get weather for a city')
 *   .withSchema(z.object({ city: z.string() }))
 *   .returns('Sunny, 72F')
 *   .trackCalls()
 *   .build();
 *
 * // Or for error testing
 * const errorMock = mockGadget()
 *   .withName('Unstable')
 *   .throws('Service unavailable')
 *   .build();
 * ```
 */
export class MockGadgetBuilder {
  private config: MockGadgetConfig = { name: "MockGadget" };

  /**
   * Set the gadget name.
   */
  withName(name: string): this {
    this.config.name = name;
    return this;
  }

  /**
   * Set the gadget description.
   */
  withDescription(description: string): this {
    this.config.description = description;
    return this;
  }

  /**
   * Set the parameter schema.
   */
  withSchema<T extends ZodType>(schema: T): MockGadgetBuilder {
    this.config.schema = schema;
    return this;
  }

  /**
   * Set a static result to return.
   */
  returns(result: string): this {
    this.config.result = result;
    this.config.resultFn = undefined;
    return this;
  }

  /**
   * Set a dynamic result function.
   */
  returnsAsync(resultFn: (params: Record<string, unknown>) => string | Promise<string>): this {
    this.config.resultFn = resultFn;
    this.config.result = undefined;
    return this;
  }

  /**
   * Make the gadget throw an error on execution.
   */
  throws(error: Error | string): this {
    this.config.error = error;
    return this;
  }

  /**
   * Add execution delay.
   */
  withDelay(ms: number): this {
    this.config.delayMs = ms;
    return this;
  }

  /**
   * Set timeout for the gadget.
   */
  withTimeout(ms: number): this {
    this.config.timeoutMs = ms;
    return this;
  }

  /**
   * Enable call tracking (enabled by default).
   */
  trackCalls(): this {
    this.config.trackCalls = true;
    return this;
  }

  /**
   * Disable call tracking.
   */
  noTracking(): this {
    this.config.trackCalls = false;
    return this;
  }

  /**
   * Build the mock gadget.
   */
  build(): MockGadget {
    return createMockGadget(this.config);
  }
}

/**
 * Create a fluent builder for mock gadgets.
 *
 * @returns New MockGadgetBuilder instance
 *
 * @example
 * ```typescript
 * const mock = mockGadget()
 *   .withName('Search')
 *   .withSchema(z.object({ query: z.string() }))
 *   .returnsAsync(async ({ query }) => {
 *     return `Results for: ${query}`;
 *   })
 *   .build();
 * ```
 */
export function mockGadget(): MockGadgetBuilder {
  return new MockGadgetBuilder();
}
