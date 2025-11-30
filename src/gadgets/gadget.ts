import type { ZodTypeAny } from "zod";

import { GADGET_ARG_PREFIX } from "../core/constants.js";
import { schemaToJSONSchema } from "./schema-to-json.js";
import { validateGadgetSchema } from "./schema-validator.js";
import type { GadgetExample } from "./types.js";

/**
 * Format parameters object as Block format.
 * Uses JSON Pointer paths for nested structures.
 *
 * @param params - The parameters object to format
 * @param prefix - Path prefix for nested structures (internal use)
 * @param argPrefix - The argument prefix marker (defaults to GADGET_ARG_PREFIX)
 */
function formatParamsAsBlock(
  params: Record<string, unknown>,
  prefix: string = "",
  argPrefix: string = GADGET_ARG_PREFIX,
): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    const fullPath = prefix ? `${prefix}/${key}` : key;

    if (Array.isArray(value)) {
      // Arrays: use numeric indices
      value.forEach((item, index) => {
        const itemPath = `${fullPath}/${index}`;
        if (typeof item === "object" && item !== null) {
          // Nested object in array
          lines.push(formatParamsAsBlock(item as Record<string, unknown>, itemPath, argPrefix));
        } else {
          lines.push(`${argPrefix}${itemPath}`);
          lines.push(String(item));
        }
      });
    } else if (typeof value === "object" && value !== null) {
      // Nested objects: recurse with path prefix
      lines.push(formatParamsAsBlock(value as Record<string, unknown>, fullPath, argPrefix));
    } else {
      // Simple values
      lines.push(`${argPrefix}${fullPath}`);
      lines.push(String(value));
    }
  }

  return lines.join("\n");
}

/**
 * Format JSON Schema as plain text description.
 * This avoids format confusion by presenting parameters in a neutral,
 * human-readable format that works equally well for JSON, YAML, TOML, or XML.
 */
function formatSchemaAsPlainText(schema: Record<string, unknown>, indent = ""): string {
  const lines: string[] = [];
  const properties = (schema.properties || {}) as Record<string, unknown>;
  const required = (schema.required || []) as string[];

  for (const [key, prop] of Object.entries(properties)) {
    const propObj = prop as Record<string, unknown>;
    const type = propObj.type as string;
    const description = propObj.description as string | undefined;
    const isRequired = required.includes(key);
    const enumValues = propObj.enum as string[] | undefined;

    // Build the line
    let line = `${indent}- ${key}`;

    // Add type info
    if (type === "array") {
      const items = propObj.items as Record<string, unknown> | undefined;
      const itemType = items?.type || "any";
      line += ` (array of ${itemType})`;
    } else if (type === "object" && propObj.properties) {
      line += " (object)";
    } else {
      line += ` (${type})`;
    }

    // Add required marker
    if (isRequired) {
      line += " [required]";
    }

    // Add description
    if (description) {
      line += `: ${description}`;
    }

    // Add enum values if present
    if (enumValues) {
      line += ` - one of: ${enumValues.map((v) => `"${v}"`).join(", ")}`;
    }

    lines.push(line);

    // Recurse for nested objects
    if (type === "object" && propObj.properties) {
      lines.push(formatSchemaAsPlainText(propObj, indent + "  "));
    }
  }

  return lines.join("\n");
}

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
   * @deprecated Use getInstruction() instead
   */
  get instruction(): string {
    return this.getInstruction();
  }

  /**
   * Generate instruction text for the LLM.
   * Combines name, description, and parameter schema into a formatted instruction.
   *
   * @param argPrefix - Optional custom argument prefix for block format examples
   * @returns Formatted instruction string
   */
  getInstruction(argPrefix?: string): string {
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

      // Use plain text schema description
      parts.push("\n\nParameters:");
      parts.push(formatSchemaAsPlainText(jsonSchema));
    }

    // Render examples if present
    if (this.examples && this.examples.length > 0) {
      parts.push("\n\nExamples:");

      // Use custom argPrefix if provided, otherwise use default
      const effectiveArgPrefix = argPrefix ?? GADGET_ARG_PREFIX;

      this.examples.forEach((example, index) => {
        // Add blank line between examples (but not before the first one)
        if (index > 0) {
          parts.push("");
        }

        // Add comment if provided
        if (example.comment) {
          parts.push(`# ${example.comment}`);
        }

        // Render params in block format
        parts.push("Input:");
        parts.push(formatParamsAsBlock(example.params as Record<string, unknown>, "", effectiveArgPrefix));

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
