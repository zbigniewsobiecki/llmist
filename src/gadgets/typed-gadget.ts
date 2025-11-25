/**
 * Type-safe gadget factory with automatic parameter inference.
 *
 * Gadget eliminates the need for manual type assertions
 * by automatically inferring parameter types from the Zod schema.
 *
 * @example
 * ```typescript
 * class Calculator extends Gadget({
 *   description: "Performs arithmetic operations",
 *   schema: z.object({
 *     operation: z.enum(["add", "subtract"]),
 *     a: z.number(),
 *     b: z.number(),
 *   }),
 * }) {
 *   // ✨ params is automatically typed!
 *   execute(params: this['params']): string {
 *     const { operation, a, b } = params; // All typed!
 *     return operation === "add" ? String(a + b) : String(a - b);
 *   }
 * }
 * ```
 */

import type { ZodType } from "zod";
import { BaseGadget } from "./gadget.js";

/**
 * Infer the TypeScript type from a Zod schema.
 */
type InferSchema<T> = T extends ZodType<infer U> ? U : never;

/**
 * Configuration for creating a typed gadget.
 */
export interface GadgetConfig<TSchema extends ZodType> {
  /** Human-readable description of what the gadget does */
  description: string;

  /** Zod schema for parameter validation */
  schema: TSchema;

  /** Optional custom name (defaults to class name) */
  name?: string;

  /** Optional timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Factory function to create a typed gadget base class.
 *
 * The returned class automatically infers parameter types from the Zod schema,
 * eliminating the need for manual type assertions in the execute method.
 *
 * @param config - Configuration with description and schema
 * @returns Base class to extend with typed execute method
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { Gadget } from 'llmist';
 *
 * class Calculator extends Gadget({
 *   description: "Performs arithmetic operations",
 *   schema: z.object({
 *     operation: z.enum(["add", "subtract", "multiply", "divide"]),
 *     a: z.number().describe("First number"),
 *     b: z.number().describe("Second number"),
 *   }),
 * }) {
 *   execute(params: this['params']): string {
 *     // params is automatically typed as:
 *     // { operation: "add" | "subtract" | "multiply" | "divide"; a: number; b: number }
 *     const { operation, a, b } = params;
 *
 *     switch (operation) {
 *       case "add": return String(a + b);
 *       case "subtract": return String(a - b);
 *       case "multiply": return String(a * b);
 *       case "divide": return String(a / b);
 *     }
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // With async execution
 * class WeatherGadget extends Gadget({
 *   description: "Fetches weather for a city",
 *   schema: z.object({
 *     city: z.string().min(1).describe("City name"),
 *   }),
 *   timeoutMs: 10000,
 * }) {
 *   async execute(params: this['params']): Promise<string> {
 *     const { city } = params; // Automatically typed as { city: string }
 *     const weather = await fetchWeather(city);
 *     return `Weather in ${city}: ${weather}`;
 *   }
 * }
 * ```
 */
export function Gadget<TSchema extends ZodType>(config: GadgetConfig<TSchema>) {
  abstract class GadgetBase extends BaseGadget {
    description = config.description;
    parameterSchema = config.schema;
    name = config.name;
    timeoutMs = config.timeoutMs;

    /**
     * Type helper property for accessing inferred parameter type.
     * This is used in the execute method signature: `execute(params: this['params'])`
     *
     * Note: This is just for type inference - the actual params in execute()
     * will be Record<string, unknown> which you can safely cast to this['params']
     */
    readonly params!: InferSchema<TSchema>;

    /**
     * Execute the gadget. Subclasses should cast params to this['params'].
     *
     * @param params - Validated parameters from the LLM
     * @returns Result as a string (or Promise<string> for async gadgets)
     *
     * @example
     * ```typescript
     * execute(params: Record<string, unknown>): string {
     *   const typed = params as this['params'];
     *   // Now 'typed' is fully typed!
     *   return String(typed.a + typed.b);
     * }
     * ```
     */
    abstract execute(params: Record<string, unknown>): string | Promise<string>;
  }

  return GadgetBase as {
    new (): GadgetBase & { params: InferSchema<TSchema> };
  };
}
