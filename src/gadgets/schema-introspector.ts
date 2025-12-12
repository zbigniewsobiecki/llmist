import type { ZodTypeAny } from "zod";

/**
 * Helper to safely access Zod's internal _def structure.
 * Zod's _def is not publicly typed, so we cast through unknown.
 */
function getDef(schema: ZodTypeAny): Record<string, unknown> {
  return schema._def as unknown as Record<string, unknown>;
}

/**
 * Type hints that guide value coercion.
 * - 'string': Keep the value as a string, no coercion
 * - 'number': Coerce to number if possible
 * - 'boolean': Coerce to boolean if possible
 * - 'unknown': Use default auto-coercion logic (backwards compatible)
 */
export type TypeHint = "string" | "number" | "boolean" | "unknown";

/**
 * Get the type name from a Zod schema's _def.
 * Handles both Zod v3 (typeName) and Zod v4 (type) structures.
 * Note: We cast _def to any since Zod's internal structure isn't publicly typed.
 */
function getTypeName(schema: ZodTypeAny): string | undefined {
  const def = getDef(schema);
  // Zod v4 uses _def.type, Zod v3 uses _def.typeName
  return (def?.type ?? def?.typeName) as string | undefined;
}

/**
 * Get the shape from a Zod object schema's _def.
 * Handles both Zod v3 (shape()) and Zod v4 (shape) structures.
 * Note: We cast _def to any since Zod's internal structure isn't publicly typed.
 */
function getShape(schema: ZodTypeAny): Record<string, ZodTypeAny> | undefined {
  const def = getDef(schema);
  // Zod v4 uses _def.shape directly, Zod v3 uses _def.shape()
  if (typeof def?.shape === "function") {
    return (def.shape as () => Record<string, ZodTypeAny>)();
  }
  return def?.shape as Record<string, ZodTypeAny> | undefined;
}

/**
 * Introspects Zod schemas to determine expected types at JSON pointer paths.
 *
 * This enables schema-aware type coercion - instead of blindly converting
 * "1" to a number, the parser can check if the schema expects a string
 * and preserve the original value.
 *
 * Design decisions:
 * - Union types prefer string over other primitives (preserves LLM intent)
 * - Transform/effect schemas return 'unknown' (let Zod handle transformation)
 * - Invalid paths return 'unknown' (fall back to auto-coercion)
 *
 * @example
 * ```typescript
 * const schema = z.object({
 *   id: z.string(),
 *   count: z.number(),
 *   config: z.object({ timeout: z.number() })
 * });
 *
 * const introspector = new SchemaIntrospector(schema);
 * introspector.getTypeAtPath("id");           // 'string'
 * introspector.getTypeAtPath("count");        // 'number'
 * introspector.getTypeAtPath("config/timeout"); // 'number'
 * introspector.getTypeAtPath("unknown");      // 'unknown'
 * ```
 */
export class SchemaIntrospector {
  private readonly schema: ZodTypeAny;
  private readonly cache = new Map<string, TypeHint>();

  constructor(schema: ZodTypeAny) {
    this.schema = schema;
  }

  /**
   * Get the expected type at a JSON pointer path.
   *
   * @param pointer - JSON pointer path without leading / (e.g., "config/timeout", "items/0")
   * @returns Type hint for coercion decision
   */
  getTypeAtPath(pointer: string): TypeHint {
    // Check cache first
    const cached = this.cache.get(pointer);
    if (cached !== undefined) {
      return cached;
    }

    const result = this.resolveTypeAtPath(pointer);
    this.cache.set(pointer, result);
    return result;
  }

  /**
   * Internal method to resolve type at path without caching.
   */
  private resolveTypeAtPath(pointer: string): TypeHint {
    // Empty pointer means the root - shouldn't happen for parameters
    if (!pointer) {
      return this.getBaseType(this.schema);
    }

    const segments = pointer.split("/");
    let current: ZodTypeAny = this.schema;

    for (const segment of segments) {
      // Unwrap any wrapper types (optional, default, nullable, etc.)
      current = this.unwrapSchema(current);

      // Navigate based on schema type
      const typeName = getTypeName(current);

      if (typeName === "object" || typeName === "ZodObject") {
        // Navigate into object property
        const shape = getShape(current);
        if (!shape || !(segment in shape)) {
          return "unknown"; // Property doesn't exist in schema
        }
        current = shape[segment];
      } else if (typeName === "array" || typeName === "ZodArray") {
        // For array indices, get element type
        if (!/^\d+$/.test(segment)) {
          return "unknown"; // Not a numeric index
        }
        // Zod v4 uses _def.element, Zod v3 uses _def.type
        const def = getDef(current);
        const elementType = (def?.element ?? def?.type) as ZodTypeAny | undefined;
        if (!elementType) {
          return "unknown";
        }
        current = elementType;
      } else if (typeName === "tuple" || typeName === "ZodTuple") {
        // For tuples, get element at specific index
        if (!/^\d+$/.test(segment)) {
          return "unknown";
        }
        const index = parseInt(segment, 10);
        const def = getDef(current);
        const items = def?.items as ZodTypeAny[] | undefined;
        if (!items || index >= items.length) {
          return "unknown";
        }
        current = items[index];
      } else if (typeName === "record" || typeName === "ZodRecord") {
        // For records, all values have the same type
        // Zod v4 uses _def.valueType, Zod v3 uses _def.valueType
        const def = getDef(current);
        const valueType = def?.valueType as ZodTypeAny | undefined;
        if (!valueType) {
          return "unknown";
        }
        current = valueType;
      } else {
        // Can't navigate further (e.g., trying to access property on a string)
        return "unknown";
      }
    }

    // Get the base type of the final schema
    return this.getBaseType(current);
  }

  /**
   * Unwrap schema modifiers (optional, default, nullable, branded, etc.)
   * to get to the underlying type.
   */
  private unwrapSchema(schema: ZodTypeAny): ZodTypeAny {
    let current = schema;
    let iterations = 0;
    const maxIterations = 20; // Prevent infinite loops

    while (iterations < maxIterations) {
      const typeName = getTypeName(current);

      // Check for wrapper types (both Zod v3 and v4 naming)
      const wrapperTypes = [
        "optional",
        "nullable",
        "default",
        "catch",
        "branded",
        "readonly",
        "pipeline",
        "ZodOptional",
        "ZodNullable",
        "ZodDefault",
        "ZodCatch",
        "ZodBranded",
        "ZodReadonly",
        "ZodPipeline",
      ];

      if (typeName && wrapperTypes.includes(typeName)) {
        const def = getDef(current);
        const inner = (def?.innerType ?? def?.in ?? def?.type) as ZodTypeAny | undefined;
        if (!inner || inner === current) break;
        current = inner;
        iterations++;
        continue;
      }

      break;
    }

    return current;
  }

  /**
   * Get the primitive type hint from an unwrapped schema.
   */
  private getBaseType(schema: ZodTypeAny): TypeHint {
    const unwrapped = this.unwrapSchema(schema);
    const typeName = getTypeName(unwrapped);

    // Map both Zod v3 (ZodString) and v4 (string) type names
    switch (typeName) {
      // Primitive types
      case "string":
      case "ZodString":
        return "string";
      case "number":
      case "ZodNumber":
      case "bigint":
      case "ZodBigInt":
        return "number";
      case "boolean":
      case "ZodBoolean":
        return "boolean";

      // Literal types - check the literal value type
      case "literal":
      case "ZodLiteral": {
        // Zod v4 uses _def.values (array), Zod v3 uses _def.value
        const def = getDef(unwrapped);
        const values = def?.values as unknown[] | undefined;
        const value = values?.[0] ?? def?.value;
        if (typeof value === "string") return "string";
        if (typeof value === "number" || typeof value === "bigint") return "number";
        if (typeof value === "boolean") return "boolean";
        return "unknown";
      }

      // Enum - always string keys
      case "enum":
      case "ZodEnum":
      case "nativeEnum":
      case "ZodNativeEnum":
        return "string";

      // Union - return 'unknown' to let auto-coercion decide
      // Since multiple types are valid, we can't definitively say what the LLM intended
      // Auto-coercion will handle common cases (numbers, booleans) appropriately
      case "union":
      case "ZodUnion":
        return "unknown";

      // Discriminated union - complex, return unknown
      case "discriminatedUnion":
      case "ZodDiscriminatedUnion":
        return "unknown";

      // Intersection - check both sides
      case "intersection":
      case "ZodIntersection": {
        const def = getDef(unwrapped);
        const left = def?.left as ZodTypeAny | undefined;
        const right = def?.right as ZodTypeAny | undefined;
        if (!left || !right) return "unknown";

        const leftType = this.getBaseType(left);
        const rightType = this.getBaseType(right);

        // If both are the same type, return it
        if (leftType === rightType) return leftType;
        // If one is string, prefer string
        if (leftType === "string" || rightType === "string") return "string";
        // Otherwise return unknown (complex intersection)
        return "unknown";
      }

      // Effects/transforms - return unknown to let Zod handle it
      case "effects":
      case "ZodEffects":
        // ZodEffects wraps transforms, refinements, etc.
        // The transform expects input in original format, so don't coerce
        return "unknown";

      // Lazy - can't resolve without evaluating
      case "lazy":
      case "ZodLazy":
        return "unknown";

      // Complex types - return unknown
      case "object":
      case "ZodObject":
      case "array":
      case "ZodArray":
      case "tuple":
      case "ZodTuple":
      case "record":
      case "ZodRecord":
      case "map":
      case "ZodMap":
      case "set":
      case "ZodSet":
      case "function":
      case "ZodFunction":
      case "promise":
      case "ZodPromise":
      case "date":
      case "ZodDate":
        return "unknown";

      // Unknown/any/never/void/undefined/null
      case "unknown":
      case "ZodUnknown":
      case "any":
      case "ZodAny":
      case "never":
      case "ZodNever":
      case "void":
      case "ZodVoid":
      case "undefined":
      case "ZodUndefined":
      case "null":
      case "ZodNull":
        return "unknown";

      default:
        return "unknown";
    }
  }
}
