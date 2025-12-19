import type { ZodTypeAny } from "zod";
import { GADGET_ARG_PREFIX } from "../core/constants.js";
import { SchemaIntrospector, type TypeHint } from "./schema-introspector.js";

export interface BlockParseOptions {
  /** Prefix that declares an argument. Default: "!!!ARG:" */
  argPrefix?: string;
  /** Optional Zod schema for schema-aware type coercion */
  schema?: ZodTypeAny;
}

/**
 * Parse block format parameters into an object.
 *
 * Block format uses !!!ARG:pointer syntax where pointer is a JSON Pointer
 * path (without leading /) that defines where to place the value.
 *
 * Example input:
 * ```
 * !!!ARG:filename
 * calculator.ts
 * !!!ARG:config/timeout
 * 30
 * !!!ARG:items/0
 * first
 * ```
 *
 * Produces:
 * ```json
 * {
 *   "filename": "calculator.ts",
 *   "config": { "timeout": 30 },
 *   "items": ["first"]
 * }
 * ```
 *
 * Single-line values are automatically coerced:
 * - "true" / "false" → boolean
 * - Numeric strings → number
 * - Multiline values always stay as strings (for code/content)
 *
 * @param content - Raw parameter content (after gadget name line, before end marker)
 * @param options - Parser options
 * @returns Parsed parameters object with coerced values
 * @throws Error if duplicate pointers or invalid array indices
 */
export function parseBlockParams(
  content: string,
  options?: BlockParseOptions,
): Record<string, unknown> {
  const argPrefix = options?.argPrefix ?? GADGET_ARG_PREFIX;
  const result: Record<string, unknown> = {};
  const seenPointers = new Set<string>();

  // Create schema introspector if schema is provided
  const introspector = options?.schema ? new SchemaIntrospector(options.schema) : undefined;

  // Split content by arg prefix to get individual arg entries
  // First element will be empty or whitespace before first arg
  const parts = content.split(argPrefix);

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];

    // Find the pointer (first line) and value (rest)
    const newlineIndex = part.indexOf("\n");
    if (newlineIndex === -1) {
      // Arg with no value (just the pointer line)
      const pointer = part.trim();
      if (pointer) {
        if (seenPointers.has(pointer)) {
          throw new Error(`Duplicate pointer: ${pointer}`);
        }
        seenPointers.add(pointer);
        setByPointer(result, pointer, "", introspector);
      }
      continue;
    }

    const pointer = part.substring(0, newlineIndex).trim();
    let value = part.substring(newlineIndex + 1);

    // Strip single trailing newline if present (per spec)
    if (value.endsWith("\n")) {
      value = value.slice(0, -1);
    }

    if (!pointer) {
      continue; // Skip empty pointers
    }

    if (seenPointers.has(pointer)) {
      throw new Error(`Duplicate pointer: ${pointer}`);
    }
    seenPointers.add(pointer);

    setByPointer(result, pointer, value, introspector);
  }

  return result;
}

/**
 * Coerce a string value to its appropriate primitive type.
 *
 * When an `expectedType` hint is provided (from schema introspection), the coercion
 * respects the schema's expected type:
 * - 'string': Keep value as string, no coercion
 * - 'number': Coerce to number if valid
 * - 'boolean': Coerce to boolean if "true"/"false"
 * - 'unknown': Use auto-coercion logic (backwards compatible)
 *
 * Without a type hint (undefined), uses auto-coercion:
 * - "true" / "false" → boolean
 * - Numeric strings → number
 * - Everything else stays string
 *
 * Multiline values are never coerced (likely code/content).
 *
 * @param value - The string value to coerce
 * @param expectedType - Optional type hint from schema introspection
 * @returns Coerced value
 */
function coerceValue(value: string, expectedType?: TypeHint): string | number | boolean {
  // Don't coerce multiline values - they're likely code/content
  if (value.includes("\n")) {
    return value;
  }

  const trimmed = value.trim();

  // If schema provides a type hint, respect it
  if (expectedType === "string") {
    // Keep as string - no coercion at all
    return value;
  }

  if (expectedType === "boolean") {
    // Only coerce recognized boolean strings
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    // Invalid boolean - keep as string for Zod to report error
    return value;
  }

  if (expectedType === "number") {
    // Attempt to coerce to number
    const num = Number(trimmed);
    if (!isNaN(num) && isFinite(num) && trimmed !== "") {
      return num;
    }
    // Invalid number - keep as string for Zod to report error
    return value;
  }

  // expectedType === 'unknown' or undefined: use auto-coercion logic
  // This maintains backwards compatibility when no schema is provided
  // or when schema introspection can't determine the type

  // Boolean coercion
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  // Number coercion - only for values that look clearly numeric
  // Avoid coercing things like "123abc" or empty strings
  if (trimmed !== "" && /^-?\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!isNaN(num) && isFinite(num)) {
      return num;
    }
  }

  return value;
}

/**
 * Set a value in an object using a JSON Pointer path (without leading /).
 *
 * Handles:
 * - Simple keys: "name" → { name: value }
 * - Nested paths: "config/timeout" → { config: { timeout: value } }
 * - Array indices: "items/0" → { items: [value] }
 *
 * Values are coerced based on the schema's expected type when an introspector
 * is provided. Without a schema, falls back to auto-coercion (backwards compatible).
 *
 * @param obj - Target object to modify
 * @param pointer - JSON Pointer path without leading /
 * @param value - Value to set (string that may be coerced)
 * @param introspector - Optional schema introspector for type-aware coercion
 * @throws Error if array index gaps detected
 */
function setByPointer(
  obj: Record<string, unknown>,
  pointer: string,
  value: string,
  introspector?: SchemaIntrospector,
): void {
  const segments = pointer.split("/");
  let current: Record<string, unknown> | unknown[] = obj;

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    const nextSegment = segments[i + 1];
    const nextIsArrayIndex = /^\d+$/.test(nextSegment);

    if (Array.isArray(current)) {
      const index = parseInt(segment, 10);
      if (isNaN(index) || index < 0) {
        throw new Error(`Invalid array index: ${segment}`);
      }
      // Validate no gaps
      if (index > current.length) {
        throw new Error(`Array index gap: expected ${current.length}, got ${index}`);
      }
      if (current[index] === undefined) {
        current[index] = nextIsArrayIndex ? [] : {};
      }
      current = current[index] as Record<string, unknown> | unknown[];
    } else {
      // current is an object
      const rec = current as Record<string, unknown>;
      if (rec[segment] === undefined) {
        rec[segment] = nextIsArrayIndex ? [] : {};
      }
      current = rec[segment] as Record<string, unknown> | unknown[];
    }
  }

  // Set the final value
  const lastSegment = segments[segments.length - 1];

  // Get expected type from schema if available, then coerce accordingly
  const expectedType = introspector?.getTypeAtPath(pointer);
  const coercedValue = coerceValue(value, expectedType);

  if (Array.isArray(current)) {
    const index = parseInt(lastSegment, 10);
    if (isNaN(index) || index < 0) {
      throw new Error(`Invalid array index: ${lastSegment}`);
    }
    // Validate no gaps
    if (index > current.length) {
      throw new Error(`Array index gap: expected ${current.length}, got ${index}`);
    }
    current[index] = coercedValue;
  } else {
    (current as Record<string, unknown>)[lastSegment] = coercedValue;
  }
}
