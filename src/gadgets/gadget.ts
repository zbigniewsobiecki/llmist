import * as yaml from "js-yaml";
import type { ZodTypeAny } from "zod";

import type { ParameterFormat } from "./parser.js";
import { schemaToJSONSchema } from "./schema-to-json.js";
import { validateGadgetSchema } from "./schema-validator.js";
import type { GadgetExample } from "./types.js";

/**
 * Internal base class for gadgets. Most users should use the `Gadget` class
 * (formerly TypedGadget) or `createGadget()` function instead, as they provide
 * better type safety and simpler APIs.
 *
 * @internal
 */
export abstract class BaseGadget {
  /**
   * The name of the gadget. Used for identification when LLM calls it.
   * If not provided, defaults to the class name.
   */
  name?: string;

  /**
   * Human-readable description of what the gadget does.
   */
  abstract description: string;

  /**
   * Optional Zod schema describing the expected input payload. When provided,
   * it will be validated before execution and transformed into a JSON Schema
   * representation that is surfaced to the LLM as part of the instructions.
   */
  parameterSchema?: ZodTypeAny;

  /**
   * Optional timeout in milliseconds for gadget execution.
   * If execution exceeds this timeout, a TimeoutException will be thrown.
   * If not set, the global defaultGadgetTimeoutMs from runtime options will be used.
   * Set to 0 or undefined to disable timeout for this gadget.
   */
  timeoutMs?: number;

  /**
   * Optional usage examples to help LLMs understand proper invocation.
   * Examples are rendered in getInstruction() alongside the schema.
   *
   * Note: Uses broader `unknown` type to allow typed examples from subclasses
   * while maintaining runtime compatibility.
   */
  examples?: GadgetExample<unknown>[];

  /**
   * Execute the gadget with the given parameters.
   * Can be synchronous or asynchronous.
   *
   * @param params - Parameters passed from the LLM
   * @returns Result as a string
   */
  abstract execute(params: Record<string, unknown>): string | Promise<string>;

  /**
   * Auto-generated instruction text for the LLM.
   * Combines name, description, and parameter schema into a formatted instruction.
   * @deprecated Use getInstruction(format) instead for format-specific schemas
   */
  get instruction(): string {
    return this.getInstruction("yaml");
  }

  /**
   * Generate instruction text for the LLM with format-specific schema.
   * Combines name, description, and parameter schema into a formatted instruction.
   *
   * @param format - Format for the schema representation ('json' | 'yaml' | 'auto')
   * @returns Formatted instruction string
   */
  getInstruction(format: ParameterFormat = "json"): string {
    const parts: string[] = [];

    // Add description
    parts.push(this.description);

    if (this.parameterSchema) {
      // Validate that the schema doesn't use z.unknown() and can be serialized
      const gadgetName = this.name ?? this.constructor.name;
      validateGadgetSchema(this.parameterSchema, gadgetName);

      const jsonSchema = schemaToJSONSchema(this.parameterSchema, {
        target: "draft-7",
      });

      if (format === "json" || format === "auto") {
        parts.push("\n\nInput Schema (JSON):");
        parts.push(JSON.stringify(jsonSchema, null, 2));
      } else {
        const yamlSchema = yaml.dump(jsonSchema).trimEnd();
        parts.push("\n\nInput Schema (YAML):");
        parts.push(yamlSchema);
      }
    }

    // Render examples if present
    if (this.examples && this.examples.length > 0) {
      parts.push("\n\nExamples:");

      this.examples.forEach((example, index) => {
        // Add blank line between examples (but not before the first one)
        if (index > 0) {
          parts.push("");
        }

        // Add comment if provided
        if (example.comment) {
          parts.push(`# ${example.comment}`);
        }

        // Render params in the appropriate format
        parts.push("Input:");
        if (format === "json" || format === "auto") {
          parts.push(JSON.stringify(example.params, null, 2));
        } else {
          parts.push(yaml.dump(example.params).trimEnd());
        }

        // Render output if provided
        if (example.output !== undefined) {
          parts.push("Output:");
          parts.push(example.output);
        }
      });
    }

    return parts.join("\n");
  }
}
