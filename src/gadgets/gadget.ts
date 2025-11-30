import * as yaml from "js-yaml";
import type { ZodTypeAny } from "zod";

import { GADGET_ARG_PREFIX } from "../core/constants.js";
import type { ParameterFormat } from "./parser.js";
import { schemaToJSONSchema } from "./schema-to-json.js";
import { validateGadgetSchema } from "./schema-validator.js";
import type { GadgetExample } from "./types.js";
import { formatParamsAsXml } from "./xml-params.js";

/**
 * Common heredoc delimiter names, in order of preference.
 * We try these until we find one that doesn't appear in the content.
 */
const HEREDOC_DELIMITERS = [
  "__GADGET_PARAM_EOF__",
  "__GADGET_PARAM_END__",
  "__GADGET_PARAM_DOC__",
  "__GADGET_PARAM_CONTENT__",
  "__GADGET_PARAM_TEXT__",
  "__GADGET_PARAM_HEREDOC__",
  "__GADGET_PARAM_DATA__",
  "__GADGET_PARAM_BLOCK__",
];

/**
 * Find a safe heredoc delimiter that doesn't appear alone on a line in the content.
 */
function findSafeDelimiter(content: string): string {
  const lines = content.split("\n");
  for (const delimiter of HEREDOC_DELIMITERS) {
    // Check if this delimiter appears alone on any line
    const regex = new RegExp(`^${delimiter}\\s*$`);
    const isUsed = lines.some((line) => regex.test(line));
    if (!isUsed) {
      return delimiter;
    }
  }
  // Fallback: generate a unique delimiter with a number suffix
  let counter = 1;
  while (counter < 1000) {
    const delimiter = `__GADGET_PARAM_${counter}__`;
    const regex = new RegExp(`^${delimiter}\\s*$`);
    const isUsed = lines.some((line) => regex.test(line));
    if (!isUsed) {
      return delimiter;
    }
    counter++;
  }
  // Last resort (should never happen)
  return "HEREDOC_FALLBACK";
}

/**
 * Format a value for YAML output, using heredoc syntax for multiline strings.
 * This teaches LLMs to use heredoc syntax which is cleaner and doesn't require indentation.
 */
function formatYamlValue(value: unknown, indent: string = ""): string {
  if (typeof value === "string") {
    const lines = value.split("\n");
    if (lines.length === 1 && !value.includes(":") && !value.startsWith("-")) {
      // Simple single-line string without special chars - can use plain style
      return value;
    }
    // Use heredoc syntax for multiline or strings with special chars
    const delimiter = findSafeDelimiter(value);
    return `<<<${delimiter}\n${value}\n${delimiter}`;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value === null || value === undefined) {
    return "null";
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((item) => `${indent}- ${formatYamlValue(item, indent + "  ")}`);
    return "\n" + items.join("\n");
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const lines = entries.map(([k, v]) => {
      const formattedValue = formatYamlValue(v, indent + "  ");
      // If value starts with newline (arrays/objects), don't add space after colon
      if (formattedValue.startsWith("\n") || formattedValue.startsWith("|")) {
        return `${indent}${k}: ${formattedValue}`;
      }
      return `${indent}${k}: ${formattedValue}`;
    });
    return "\n" + lines.join("\n");
  }

  // Fallback to yaml.dump for complex types
  return yaml.dump(value).trimEnd();
}

/**
 * Format parameters object as YAML with pipe multiline syntax for all string values.
 * This ensures examples teach LLMs to use the correct pattern.
 */
function formatParamsAsYaml(params: Record<string, unknown>): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    const formattedValue = formatYamlValue(value, "");
    if (formattedValue.startsWith("\n")) {
      // Object or array - value on next lines (no space before newline)
      lines.push(`${key}:${formattedValue}`);
    } else {
      // Simple value or pipe multiline - space before value
      lines.push(`${key}: ${formattedValue}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format a TOML inline table (object).
 * TOML uses { key = value, key2 = value2 } syntax, NOT JSON's {"key": value}.
 * This is critical because LLMs copy the examples we show them in the prompt.
 */
function formatTomlInlineTable(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj).map(([k, v]) => `${k} = ${formatTomlValue(v)}`);
  return `{ ${entries.join(", ")} }`;
}

/**
 * Format a value for TOML output, using heredoc syntax for multiline content.
 * This teaches LLMs to use the heredoc syntax which is cleaner for multi-line strings.
 *
 * IMPORTANT: Arrays and objects must use TOML inline table syntax, NOT JSON.stringify().
 * If we use JSON.stringify(), the LLM will copy the JSON syntax and the parser will fail.
 */
function formatTomlValue(value: unknown): string {
  if (typeof value === "string") {
    if (value.includes("\n")) {
      // Multiline: use heredoc syntax
      const delimiter = findSafeDelimiter(value);
      return `<<<${delimiter}\n${value}\n${delimiter}`;
    }
    // Single line: use regular quoted string
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value === null || value === undefined) {
    // TOML doesn't have null, use empty string
    return '""';
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    // Format array elements with proper TOML syntax
    const items = value.map((item) => {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        // Inline table for objects in arrays
        return formatTomlInlineTable(item as Record<string, unknown>);
      }
      return formatTomlValue(item);
    });
    return `[${items.join(", ")}]`;
  }

  if (typeof value === "object") {
    // Use proper TOML inline table syntax for objects
    return formatTomlInlineTable(value as Record<string, unknown>);
  }

  return JSON.stringify(value);
}

/**
 * Format parameters object as TOML.
 */
function formatParamsAsToml(params: Record<string, unknown>): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    lines.push(`${key} = ${formatTomlValue(value)}`);
  }

  return lines.join("\n");
}

/**
 * Format parameters object as Block format.
 * Uses JSON Pointer paths for nested structures.
 */
function formatParamsAsBlock(
  params: Record<string, unknown>,
  prefix: string = "",
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
          lines.push(formatParamsAsBlock(item as Record<string, unknown>, itemPath));
        } else {
          lines.push(`${GADGET_ARG_PREFIX}${itemPath}`);
          lines.push(String(item));
        }
      });
    } else if (typeof value === "object" && value !== null) {
      // Nested objects: recurse with path prefix
      lines.push(formatParamsAsBlock(value as Record<string, unknown>, fullPath));
    } else {
      // Simple values
      lines.push(`${GADGET_ARG_PREFIX}${fullPath}`);
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
   * @deprecated Use getInstruction(format) instead for format-specific schemas
   */
  get instruction(): string {
    return this.getInstruction("yaml");
  }

  /**
   * Generate instruction text for the LLM with format-specific schema.
   * Combines name, description, and parameter schema into a formatted instruction.
   *
   * @param format - Format for the schema representation ('json' | 'yaml' | 'toml' | 'auto')
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

      // Use plain text schema description for all formats to avoid format confusion
      parts.push("\n\nParameters:");
      parts.push(formatSchemaAsPlainText(jsonSchema));
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
        } else if (format === "toml") {
          parts.push(formatParamsAsToml(example.params as Record<string, unknown>));
        } else if (format === "xml") {
          parts.push(formatParamsAsXml(example.params as Record<string, unknown>));
        } else if (format === "block") {
          parts.push(formatParamsAsBlock(example.params as Record<string, unknown>));
        } else {
          // Use custom formatter that applies pipe multiline syntax for strings
          parts.push(formatParamsAsYaml(example.params as Record<string, unknown>));
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
