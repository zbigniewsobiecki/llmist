/**
 * Function-based gadget creation helper.
 *
 * For simple gadgets, use createGadget() instead of defining a class.
 * Parameters are automatically typed from the Zod schema.
 *
 * @example
 * ```typescript
 * const calculator = createGadget({
 *   description: "Performs arithmetic operations",
 *   schema: z.object({
 *     operation: z.enum(["add", "subtract"]),
 *     a: z.number(),
 *     b: z.number(),
 *   }),
 *   execute: ({ operation, a, b }) => {
 *     // Automatically typed!
 *     return operation === "add" ? String(a + b) : String(a - b);
 *   },
 * });
 * ```
 */

import type { ZodType } from "zod";
import { BaseGadget } from "./gadget.js";

/**
 * Infer the TypeScript type from a Zod schema.
 */
type InferSchema<T> = T extends ZodType<infer U> ? U : never;

/**
 * Configuration for creating a function-based gadget.
 */
export interface CreateGadgetConfig<TSchema extends ZodType> {
  /** Optional custom name (defaults to "FunctionGadget") */
  name?: string;

  /** Human-readable description of what the gadget does */
  description: string;

  /** Zod schema for parameter validation */
  schema: TSchema;

  /** Execution function with typed parameters */
  execute: (params: InferSchema<TSchema>) => string | Promise<string>;

  /** Optional timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Creates a gadget from a function (simpler than class-based approach).
 *
 * This is perfect for simple gadgets where you don't need the full
 * power of a class. Parameters are automatically typed from the schema.
 *
 * @param config - Configuration with execute function and schema
 * @returns Gadget instance ready to be registered
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { createGadget } from 'llmist';
 *
 * // Simple calculator gadget
 * const calculator = createGadget({
 *   description: "Performs arithmetic operations",
 *   schema: z.object({
 *     operation: z.enum(["add", "subtract", "multiply", "divide"]),
 *     a: z.number().describe("First number"),
 *     b: z.number().describe("Second number"),
 *   }),
 *   execute: ({ operation, a, b }) => {
 *     // Parameters are automatically typed!
 *     switch (operation) {
 *       case "add": return String(a + b);
 *       case "subtract": return String(a - b);
 *       case "multiply": return String(a * b);
 *       case "divide": return String(a / b);
 *     }
 *   },
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Async gadget with custom name and timeout
 * const weather = createGadget({
 *   name: "weather",
 *   description: "Fetches current weather for a city",
 *   schema: z.object({
 *     city: z.string().min(1).describe("City name"),
 *   }),
 *   timeoutMs: 10000,
 *   execute: async ({ city }) => {
 *     const response = await fetch(`https://api.weather.com/${city}`);
 *     const data = await response.json();
 *     return `Weather in ${city}: ${data.description}, ${data.temp}°C`;
 *   },
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Use with agent
 * const agent = LLMist.createAgent()
 *   .withGadgets(calculator, weather)
 *   .ask("What's the weather in Paris and what's 10 + 5?");
 * ```
 */
export function createGadget<TSchema extends ZodType>(
  config: CreateGadgetConfig<TSchema>,
): BaseGadget {
  class DynamicGadget extends BaseGadget {
    name = config.name;
    description = config.description;
    parameterSchema = config.schema;
    timeoutMs = config.timeoutMs;

    execute(params: Record<string, unknown>): string | Promise<string> {
      // Cast to inferred type and call user's function
      return config.execute(params as InferSchema<TSchema>);
    }
  }

  return new DynamicGadget();
}
