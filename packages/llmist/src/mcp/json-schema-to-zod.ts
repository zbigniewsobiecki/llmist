/**
 * Minimal JSON Schema → Zod converter for MCP tool input schemas.
 *
 * MCP tool descriptors expose `inputSchema` as JSON Schema (typically a
 * subset of draft-2020-12 with `type`, `properties`, `required`, `items`,
 * `enum`, `default`, `description`, `nullable`). This converter handles
 * exactly that subset — anything richer ($ref, allOf, format-only schemas,
 * non-primitive oneOf composition) throws so we surface the gap rather than
 * silently coercing a wrong schema.
 *
 * @module mcp/json-schema-to-zod
 */

import { z, type ZodTypeAny } from "zod";
import { JsonSchemaConversionError } from "./errors.js";

export interface JSONSchemaLike {
  type?: string | string[];
  description?: string;
  default?: unknown;
  enum?: unknown[];
  nullable?: boolean;
  properties?: Record<string, JSONSchemaLike>;
  required?: string[];
  items?: JSONSchemaLike | JSONSchemaLike[];
  oneOf?: JSONSchemaLike[];
  anyOf?: JSONSchemaLike[];
  allOf?: JSONSchemaLike[];
  $ref?: string;
  // Tolerate but ignore unknown keys (e.g. $schema, title, examples).
  [k: string]: unknown;
}

/**
 * Convert a JSON Schema fragment into a Zod schema.
 *
 * Throws JsonSchemaConversionError on features that have no clean Zod analog
 * in the MCP subset.
 */
export function jsonSchemaToZod(schema: JSONSchemaLike | undefined): ZodTypeAny {
  if (!schema || typeof schema !== "object") {
    return z.unknown();
  }

  if (schema.$ref) {
    throw new JsonSchemaConversionError(
      "$ref is not supported in MCP tool schemas",
      schema,
    );
  }
  if (schema.allOf) {
    throw new JsonSchemaConversionError(
      "allOf is not supported (MCP tools should use a single composed schema)",
      schema,
    );
  }

  // Union via oneOf / anyOf (primitives only — non-primitive composition is
  // outside the supported subset).
  const union = schema.oneOf ?? schema.anyOf;
  if (union) {
    if (!Array.isArray(union) || union.length < 2) {
      throw new JsonSchemaConversionError(
        "oneOf/anyOf must have at least two members",
        schema,
      );
    }
    const branches = union.map((m) => jsonSchemaToZod(m));
    return applyDecorators(
      z.union(branches as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]),
      schema,
    );
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  if (type === undefined && schema.enum && Array.isArray(schema.enum)) {
    return applyDecorators(buildEnum(schema.enum), schema);
  }

  if (type === undefined) {
    return applyDecorators(z.unknown(), schema);
  }

  switch (type) {
    case "string": {
      let s: ZodTypeAny;
      if (schema.enum && Array.isArray(schema.enum)) {
        s = buildEnum(schema.enum);
      } else {
        s = z.string();
      }
      return applyDecorators(s, schema);
    }

    case "number":
      return applyDecorators(z.number(), schema);

    case "integer":
      return applyDecorators(z.number().int(), schema);

    case "boolean":
      return applyDecorators(z.boolean(), schema);

    case "null":
      return applyDecorators(z.null(), schema);

    case "array": {
      const items = schema.items;
      if (Array.isArray(items)) {
        throw new JsonSchemaConversionError(
          "tuple-style items arrays are not supported",
          schema,
        );
      }
      const inner = items ? jsonSchemaToZod(items) : z.unknown();
      return applyDecorators(z.array(inner), schema);
    }

    case "object": {
      const props = schema.properties ?? {};
      const required = new Set(schema.required ?? []);
      const keys = Object.keys(props);
      if (keys.length === 0) {
        // No declared properties → permissive record.
        return applyDecorators(z.record(z.string(), z.unknown()), schema);
      }
      const shape: Record<string, ZodTypeAny> = {};
      for (const key of keys) {
        const inner = jsonSchemaToZod(props[key]);
        shape[key] = required.has(key) ? inner : inner.optional();
      }
      return applyDecorators(z.object(shape), schema);
    }

    default:
      throw new JsonSchemaConversionError(
        `unknown JSON Schema type "${type}"`,
        schema,
      );
  }
}

function buildEnum(values: unknown[]): ZodTypeAny {
  if (values.every((v) => typeof v === "string")) {
    const literals = values as string[];
    if (literals.length === 0) {
      throw new JsonSchemaConversionError("enum cannot be empty", values);
    }
    return z.enum(literals as [string, ...string[]]);
  }
  // Non-string enums become a union of literals.
  const literals = values.map((v) => z.literal(v as string | number | boolean));
  if (literals.length === 0) {
    throw new JsonSchemaConversionError("enum cannot be empty", values);
  }
  if (literals.length === 1) {
    return literals[0]!;
  }
  return z.union(literals as unknown as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
}

function applyDecorators(base: ZodTypeAny, schema: JSONSchemaLike): ZodTypeAny {
  let s = base;
  if (schema.nullable === true) {
    s = s.nullable();
  }
  if (schema.description) {
    s = s.describe(schema.description);
  }
  if (schema.default !== undefined) {
    s = s.default(schema.default as never);
  }
  return s;
}
