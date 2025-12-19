/**
 * Zod schema to JSON Schema conversion with instance mismatch detection.
 *
 * When consumers use their own `import { z } from "zod"` instead of
 * `import { z } from "llmist"`, the `.describe()` metadata can be lost
 * because Zod stores metadata on schema instances and `toJSONSchema()`
 * only reads from schemas created by the same Zod module instance.
 *
 * This module provides a `schemaToJSONSchema()` function that:
 * 1. Converts Zod schema to JSON Schema using the standard API
 * 2. Detects if descriptions were lost due to instance mismatch
 * 3. Logs a warning recommending `import { z } from "llmist"`
 * 4. Falls back to extracting descriptions from `schema._def`
 *
 * @module gadgets/schema-to-json
 */

import type { ZodTypeAny } from "zod";
import * as z from "zod";
import { defaultLogger } from "../logging/logger.js";

/**
 * Convert a Zod schema to JSON Schema with description fallback.
 *
 * If descriptions exist in schema._def but are missing from the generated
 * JSON Schema (indicating a Zod instance mismatch), this function:
 * 1. Logs a warning recommending `import { z } from "llmist"`
 * 2. Extracts descriptions from _def and merges them into the JSON Schema
 *
 * @param schema - Zod schema to convert
 * @param options - Conversion options (target JSON Schema version)
 * @returns JSON Schema object with descriptions preserved
 *
 * @example
 * ```typescript
 * import { schemaToJSONSchema } from './schema-to-json.js';
 * import { z } from 'zod';
 *
 * const schema = z.object({
 *   name: z.string().describe('User name'),
 * });
 *
 * const jsonSchema = schemaToJSONSchema(schema);
 * // { type: 'object', properties: { name: { type: 'string', description: 'User name' } } }
 * ```
 */
export function schemaToJSONSchema(
  schema: ZodTypeAny,
  options?: { target?: "draft-7" | "draft-2020-12" },
): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, options ?? { target: "draft-7" });

  // Check for instance mismatch by comparing _def descriptions with JSON schema
  const mismatches = detectDescriptionMismatch(schema, jsonSchema);

  if (mismatches.length > 0) {
    defaultLogger.warn(
      `Zod instance mismatch detected: ${mismatches.length} description(s) lost. ` +
        `For best results, use: import { z } from "llmist"`,
    );

    // Merge descriptions from _def into JSON schema
    return mergeDescriptions(schema, jsonSchema);
  }

  return jsonSchema;
}

/**
 * Detect if schema._def contains descriptions that are missing from JSON schema.
 * Returns array of paths where descriptions were lost.
 */
function detectDescriptionMismatch(
  schema: ZodTypeAny,
  jsonSchema: Record<string, unknown>,
): string[] {
  const mismatches: string[] = [];

  function checkSchema(zodSchema: ZodTypeAny, json: unknown, path: string): void {
    if (!zodSchema || typeof zodSchema !== "object") return;

    const def = zodSchema._def as unknown as Record<string, unknown> | undefined;
    const jsonObj = json as Record<string, unknown> | undefined;

    // Check if _def has description but JSON schema doesn't
    if (def?.description && !jsonObj?.description) {
      mismatches.push(path || "root");
    }

    // Recursively check object properties
    if (def?.typeName === "ZodObject" && def?.shape) {
      const shape =
        typeof def.shape === "function"
          ? (def.shape as () => Record<string, ZodTypeAny>)()
          : def.shape;
      for (const [key, fieldSchema] of Object.entries(shape as Record<string, ZodTypeAny>)) {
        const properties = jsonObj?.properties as Record<string, unknown> | undefined;
        const jsonProp = properties?.[key];
        checkSchema(fieldSchema, jsonProp, path ? `${path}.${key}` : key);
      }
    }

    // Check array items
    if (def?.typeName === "ZodArray" && def?.type) {
      checkSchema(def.type as ZodTypeAny, jsonObj?.items, path ? `${path}[]` : "[]");
    }

    // Check optional/nullable wrapped types
    if ((def?.typeName === "ZodOptional" || def?.typeName === "ZodNullable") && def?.innerType) {
      checkSchema(def.innerType as ZodTypeAny, json, path);
    }

    // Check default wrapped types
    if (def?.typeName === "ZodDefault" && def?.innerType) {
      checkSchema(def.innerType as ZodTypeAny, json, path);
    }
  }

  checkSchema(schema, jsonSchema, "");
  return mismatches;
}

/**
 * Merge descriptions from schema._def into JSON schema.
 * Returns a new JSON schema object with descriptions filled in from _def.
 */
function mergeDescriptions(
  schema: ZodTypeAny,
  jsonSchema: Record<string, unknown>,
): Record<string, unknown> {
  function merge(zodSchema: ZodTypeAny, json: unknown): unknown {
    if (!json || typeof json !== "object") return json;

    const def = zodSchema._def as unknown as Record<string, unknown> | undefined;
    const jsonObj = json as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...jsonObj };

    // Copy description from _def if missing in JSON
    if (def?.description && !jsonObj.description) {
      merged.description = def.description;
    }

    // Recursively merge object properties
    if (def?.typeName === "ZodObject" && def?.shape && jsonObj.properties) {
      const shape =
        typeof def.shape === "function"
          ? (def.shape as () => Record<string, ZodTypeAny>)()
          : def.shape;
      const properties = jsonObj.properties as Record<string, unknown>;
      merged.properties = { ...properties };
      for (const [key, fieldSchema] of Object.entries(shape as Record<string, ZodTypeAny>)) {
        if (properties[key]) {
          (merged.properties as Record<string, unknown>)[key] = merge(fieldSchema, properties[key]);
        }
      }
    }

    // Merge array items
    if (def?.typeName === "ZodArray" && def?.type && jsonObj.items) {
      merged.items = merge(def.type as ZodTypeAny, jsonObj.items);
    }

    // Handle optional/nullable wrapped types
    if ((def?.typeName === "ZodOptional" || def?.typeName === "ZodNullable") && def?.innerType) {
      return merge(def.innerType as ZodTypeAny, json);
    }

    // Handle default wrapped types
    if (def?.typeName === "ZodDefault" && def?.innerType) {
      return merge(def.innerType as ZodTypeAny, json);
    }

    return merged;
  }

  return merge(schema, jsonSchema) as Record<string, unknown>;
}
