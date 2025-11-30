/**
 * Interactive prompts for schema-driven gadget parameter input.
 * Converts Zod schemas to JSON Schema for introspection and prompts
 * users for each parameter with type hints, descriptions, and defaults.
 *
 * @module cli/gadget-prompts
 */

import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import type { ZodTypeAny } from "zod";

import { schemaToJSONSchema } from "../gadgets/schema-to-json.js";

/**
 * Context for interactive prompting.
 */
export interface PromptContext {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
}

/**
 * JSON Schema property representation for a single field.
 */
interface JsonSchemaProperty {
  type?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: { type?: string; enum?: string[] };
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/**
 * Prompts user for parameter values based on Zod schema.
 * Displays type hints, descriptions, and defaults for each field.
 * Returns validated and transformed parameters.
 *
 * @param schema - Zod schema describing expected parameters
 * @param ctx - I/O context for prompts
 * @returns Object containing user-provided parameter values
 */
export async function promptForParameters(
  schema: ZodTypeAny | undefined,
  ctx: PromptContext,
): Promise<Record<string, unknown>> {
  if (!schema) {
    return {}; // No parameters required
  }

  const jsonSchema = schemaToJSONSchema(schema, { target: "draft-7" }) as {
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
  };

  if (!jsonSchema.properties || Object.keys(jsonSchema.properties).length === 0) {
    return {};
  }

  const rl = createInterface({ input: ctx.stdin, output: ctx.stdout });
  const params: Record<string, unknown> = {};

  try {
    for (const [key, prop] of Object.entries(jsonSchema.properties)) {
      const value = await promptForField(rl, key, prop, jsonSchema.required ?? []);
      if (value !== undefined) {
        params[key] = value;
      }
    }
  } finally {
    rl.close();
  }

  // Validate and apply defaults/transforms through Zod
  const result = schema.safeParse(params);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid parameters:\n${issues}`);
  }

  return result.data as Record<string, unknown>;
}

/**
 * Prompts for a single field value with type-aware formatting.
 */
async function promptForField(
  rl: ReturnType<typeof createInterface>,
  key: string,
  prop: JsonSchemaProperty,
  required: string[],
): Promise<unknown> {
  const isRequired = required.includes(key);
  const typeHint = formatTypeHint(prop);
  const defaultHint =
    prop.default !== undefined ? chalk.dim(` [default: ${JSON.stringify(prop.default)}]`) : "";
  const requiredMarker = isRequired ? chalk.red("*") : "";

  // Build prompt with description
  let prompt = `\n${chalk.cyan.bold(key)}${requiredMarker}`;
  if (prop.description) {
    prompt += chalk.dim(` - ${prop.description}`);
  }
  prompt += `\n  ${typeHint}${defaultHint}\n  ${chalk.green(">")} `;

  const answer = await rl.question(prompt);
  const trimmed = answer.trim();

  // Handle empty input
  if (!trimmed) {
    if (prop.default !== undefined) {
      return undefined; // Let Zod apply default
    }
    if (!isRequired) {
      return undefined; // Optional field, skip
    }
    throw new Error(`Parameter '${key}' is required.`);
  }

  // Parse based on type
  return parseValue(trimmed, prop, key);
}

/**
 * Formats the type hint for display (e.g., "(number)", "(add | subtract)").
 */
function formatTypeHint(prop: JsonSchemaProperty): string {
  // Enum types: show allowed values
  if (prop.enum) {
    return chalk.yellow(`(${prop.enum.join(" | ")})`);
  }

  // Array types: show item type
  if (prop.type === "array") {
    const items = prop.items;
    if (items?.enum) {
      return chalk.yellow(`(${items.enum.join(" | ")})[] comma-separated`);
    }
    const itemType = items?.type ?? "any";
    return chalk.yellow(`(${itemType}[]) comma-separated`);
  }

  // Object types: indicate nested structure
  if (prop.type === "object" && prop.properties) {
    return chalk.yellow("(object) enter as JSON");
  }

  // Simple types
  return chalk.yellow(`(${prop.type ?? "any"})`);
}

/**
 * Parses a string value into the appropriate type based on schema.
 */
function parseValue(input: string, prop: JsonSchemaProperty, key: string): unknown {
  const type = prop.type;

  // Numbers
  if (type === "number" || type === "integer") {
    const num = Number(input);
    if (Number.isNaN(num)) {
      throw new Error(`Invalid number for '${key}': ${input}`);
    }
    if (type === "integer" && !Number.isInteger(num)) {
      throw new Error(`Expected integer for '${key}', got: ${input}`);
    }
    return num;
  }

  // Booleans
  if (type === "boolean") {
    const lower = input.toLowerCase();
    if (["true", "yes", "1", "y"].includes(lower)) return true;
    if (["false", "no", "0", "n"].includes(lower)) return false;
    throw new Error(`Invalid boolean for '${key}': ${input} (use true/false, yes/no, 1/0)`);
  }

  // Arrays (comma-separated)
  if (type === "array") {
    const items = input.split(",").map((s) => s.trim()).filter(Boolean);
    const itemType = prop.items?.type;

    // Convert array items to appropriate type
    if (itemType === "number" || itemType === "integer") {
      return items.map((item) => {
        const num = Number(item);
        if (Number.isNaN(num)) throw new Error(`Invalid number in '${key}' array: ${item}`);
        return num;
      });
    }
    if (itemType === "boolean") {
      return items.map((item) => {
        const lower = item.toLowerCase();
        if (["true", "yes", "1", "y"].includes(lower)) return true;
        if (["false", "no", "0", "n"].includes(lower)) return false;
        throw new Error(`Invalid boolean in '${key}' array: ${item}`);
      });
    }
    return items; // String array
  }

  // Objects (parse as JSON)
  if (type === "object") {
    try {
      return JSON.parse(input);
    } catch {
      throw new Error(`Invalid JSON for '${key}': ${input}`);
    }
  }

  // String (default) - also handles enums which are validated by Zod
  return input;
}

/**
 * Reads JSON parameters from stdin (for non-TTY piped input).
 *
 * @param stdin - Readable stream to read from
 * @returns Parsed JSON object
 */
export async function readStdinJson(stdin: NodeJS.ReadableStream): Promise<Record<string, unknown>> {
  const chunks: string[] = [];

  for await (const chunk of stdin) {
    if (typeof chunk === "string") {
      chunks.push(chunk);
    } else {
      chunks.push(chunk.toString("utf8"));
    }
  }

  const content = chunks.join("").trim();

  if (!content) {
    return {}; // Empty stdin, use defaults
  }

  try {
    const parsed = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Stdin must contain a JSON object, not an array or primitive.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON from stdin: ${error.message}`);
    }
    throw error;
  }
}
