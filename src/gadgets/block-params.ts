import { GADGET_ARG_PREFIX } from "../core/constants.js";

export interface BlockParseOptions {
  /** Prefix that declares an argument. Default: "!!!ARG:" */
  argPrefix?: string;
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
  options?: BlockParseOptions
): Record<string, unknown> {
  const argPrefix = options?.argPrefix ?? GADGET_ARG_PREFIX;
  const result: Record<string, unknown> = {};
  const seenPointers = new Set<string>();

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
        setByPointer(result, pointer, "");
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

    setByPointer(result, pointer, value);
  }

  return result;
}

/**
 * Coerce a string value to its appropriate primitive type.
 * - "true" / "false" → boolean
 * - Numeric strings → number
 * - Everything else stays string
 *
 * Only coerces single-line values to avoid accidentally converting
 * code or multiline content that happens to look like a number/boolean.
 */
function coerceValue(value: string): string | number | boolean {
  // Don't coerce multiline values - they're likely code/content
  if (value.includes("\n")) {
    return value;
  }

  const trimmed = value.trim();

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
 * Values are automatically coerced to appropriate types (boolean, number)
 * for single-line values.
 *
 * @param obj - Target object to modify
 * @param pointer - JSON Pointer path without leading /
 * @param value - Value to set (string that may be coerced)
 * @throws Error if array index gaps detected
 */
function setByPointer(
  obj: Record<string, unknown>,
  pointer: string,
  value: string
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

  // Coerce the value to appropriate type
  const coercedValue = coerceValue(value);

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
