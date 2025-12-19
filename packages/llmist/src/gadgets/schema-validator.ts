import type { ZodTypeAny } from "zod";
import * as z from "zod";

/**
 * Validates that a Zod schema doesn't contain z.unknown() which produces
 * incomplete JSON schemas without type information.
 *
 * @param schema - The Zod schema to validate
 * @param gadgetName - Name of the gadget (for error messages)
 * @throws Error if z.unknown() is detected with helpful suggestions
 */
export function validateGadgetSchema(schema: ZodTypeAny, gadgetName: string): void {
  let jsonSchema;
  try {
    jsonSchema = z.toJSONSchema(schema, { target: "draft-7" });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Gadget "${gadgetName}" has a schema that cannot be serialized to JSON Schema.\n` +
        `This usually happens with unsupported patterns like:\n` +
        `- z.record() - use z.object({}).passthrough() instead\n` +
        `- Complex transforms or custom refinements\n` +
        `- Circular references\n` +
        `\n` +
        `Original error: ${errorMessage}\n` +
        `\n` +
        `Only use schema patterns that Zod v4's native toJSONSchema() supports.`,
    );
  }
  const issues = findUnknownTypes(jsonSchema);

  if (issues.length > 0) {
    const fieldList = issues.join(", ");
    throw new Error(
      `Gadget "${gadgetName}" uses z.unknown() which produces incomplete schemas.\n` +
        `Problematic fields: ${fieldList}\n` +
        `\n` +
        `z.unknown() doesn't generate type information in JSON Schema, making it unclear\n` +
        `to the LLM what data structure to provide.\n` +
        `\n` +
        `Suggestions:\n` +
        `- Use z.object({}).passthrough() for flexible objects\n` +
        `- Use z.record(z.string()) for key-value objects with string values\n` +
        `- Define specific structure if possible\n` +
        `\n` +
        `Example fixes:\n` +
        `  // ❌ Bad\n` +
        `  content: z.unknown()\n` +
        `\n` +
        `  // ✅ Good\n` +
        `  content: z.object({}).passthrough()   // for flexible objects\n` +
        `  content: z.record(z.string())         // for key-value objects\n` +
        `  content: z.array(z.string())          // for arrays of strings\n`,
    );
  }
}

/**
 * Recursively searches a JSON Schema for properties without type information,
 * which indicates z.unknown() usage.
 *
 * @param schema - JSON Schema object to search
 * @param path - Current path in schema (for error reporting)
 * @returns Array of problematic field paths
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findUnknownTypes(schema: any, path: string[] = []): string[] {
  const issues: string[] = [];

  if (!schema || typeof schema !== "object") {
    return issues;
  }

  // Check if we're in a definitions block
  if (schema.definitions) {
    for (const defSchema of Object.values(schema.definitions)) {
      issues.push(...findUnknownTypes(defSchema, []));
    }
  }

  // Check properties of objects
  if (schema.properties) {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const propPath = [...path, propName];

      // Check if this property has no type information
      if (hasNoType(propSchema)) {
        issues.push(propPath.join(".") || propName);
      }

      // Recursively check nested properties
      issues.push(...findUnknownTypes(propSchema, propPath));
    }
  }

  // Check array items
  if (schema.items) {
    const itemPath = [...path, "[]"];
    if (hasNoType(schema.items)) {
      issues.push(itemPath.join("."));
    }
    issues.push(...findUnknownTypes(schema.items, itemPath));
  }

  // Check anyOf/oneOf/allOf unions
  if (schema.anyOf) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema.anyOf.forEach((subSchema: any, index: number) => {
      issues.push(...findUnknownTypes(subSchema, [...path, `anyOf[${index}]`]));
    });
  }

  if (schema.oneOf) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema.oneOf.forEach((subSchema: any, index: number) => {
      issues.push(...findUnknownTypes(subSchema, [...path, `oneOf[${index}]`]));
    });
  }

  if (schema.allOf) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema.allOf.forEach((subSchema: any, index: number) => {
      issues.push(...findUnknownTypes(subSchema, [...path, `allOf[${index}]`]));
    });
  }

  return issues;
}

/**
 * Checks if a schema property has no type information.
 * This indicates z.unknown() usage.
 *
 * A property has "no type" if it:
 * - Is an object
 * - Has no "type" field
 * - Has no "$ref" (reference to definition)
 * - Has no "anyOf", "oneOf", or "allOf" (union types)
 * - Has only "description" or is empty
 *
 * @param prop - Property schema to check
 * @returns true if property has no type information
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasNoType(prop: any): boolean {
  if (!prop || typeof prop !== "object") {
    return false;
  }

  const hasType = prop.type !== undefined;
  const hasRef = prop.$ref !== undefined;
  const hasUnion = prop.anyOf !== undefined || prop.oneOf !== undefined || prop.allOf !== undefined;

  // If it has any type information, it's fine
  if (hasType || hasRef || hasUnion) {
    return false;
  }

  // Check if it only has description and/or other non-type metadata
  const keys = Object.keys(prop);
  const metadataKeys = ["description", "title", "default", "examples"];
  const hasOnlyMetadata = keys.every((key) => metadataKeys.includes(key));

  // If it only has metadata or is empty (besides metadata), it's missing type info
  return hasOnlyMetadata || keys.length === 0;
}
