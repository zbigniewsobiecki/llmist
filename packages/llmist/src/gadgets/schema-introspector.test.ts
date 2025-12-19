import { describe, expect, it } from "bun:test";
import { z } from "zod";

import { SchemaIntrospector } from "./schema-introspector.js";

describe("SchemaIntrospector", () => {
  describe("primitive types", () => {
    it("returns 'string' for ZodString", () => {
      const schema = z.object({ name: z.string() });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("name")).toBe("string");
    });

    it("returns 'number' for ZodNumber", () => {
      const schema = z.object({ count: z.number() });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("count")).toBe("number");
    });

    it("returns 'boolean' for ZodBoolean", () => {
      const schema = z.object({ enabled: z.boolean() });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("enabled")).toBe("boolean");
    });

    it("returns 'number' for ZodBigInt", () => {
      const schema = z.object({ bigNum: z.bigint() });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("bigNum")).toBe("number");
    });
  });

  describe("optional and nullable wrappers", () => {
    it("unwraps optional to get base type", () => {
      const schema = z.object({ id: z.string().optional() });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("id")).toBe("string");
    });

    it("unwraps nullable to get base type", () => {
      const schema = z.object({ value: z.number().nullable() });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("value")).toBe("number");
    });

    it("unwraps default to get base type", () => {
      const schema = z.object({ status: z.string().default("active") });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("status")).toBe("string");
    });

    it("unwraps multiple wrappers", () => {
      const schema = z.object({
        field: z.number().optional().nullable().default(0),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("field")).toBe("number");
    });

    it("unwraps catch to get base type", () => {
      const schema = z.object({ safe: z.string().catch("default") });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("safe")).toBe("string");
    });
  });

  describe("nested objects", () => {
    it("navigates single level nesting", () => {
      const schema = z.object({
        config: z.object({
          timeout: z.number(),
        }),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("config/timeout")).toBe("number");
    });

    it("navigates deeply nested objects", () => {
      const schema = z.object({
        data: z.object({
          metadata: z.object({
            info: z.object({
              name: z.string(),
            }),
          }),
        }),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("data/metadata/info/name")).toBe("string");
    });

    it("returns 'unknown' for non-existent nested path", () => {
      const schema = z.object({
        config: z.object({
          timeout: z.number(),
        }),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("config/missing")).toBe("unknown");
    });

    it("handles optional nested objects", () => {
      const schema = z.object({
        config: z
          .object({
            timeout: z.number(),
          })
          .optional(),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("config/timeout")).toBe("number");
    });
  });

  describe("arrays", () => {
    it("returns element type for array index", () => {
      const schema = z.object({
        items: z.array(z.string()),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("items/0")).toBe("string");
      expect(introspector.getTypeAtPath("items/1")).toBe("string");
      expect(introspector.getTypeAtPath("items/999")).toBe("string");
    });

    it("returns element type for number arrays", () => {
      const schema = z.object({
        counts: z.array(z.number()),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("counts/0")).toBe("number");
    });

    it("handles array of objects", () => {
      const schema = z.object({
        users: z.array(
          z.object({
            name: z.string(),
            age: z.number(),
          }),
        ),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("users/0/name")).toBe("string");
      expect(introspector.getTypeAtPath("users/0/age")).toBe("number");
      expect(introspector.getTypeAtPath("users/5/name")).toBe("string");
    });

    it("returns 'unknown' for non-numeric array key", () => {
      const schema = z.object({
        items: z.array(z.string()),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("items/abc")).toBe("unknown");
    });
  });

  describe("tuples", () => {
    it("returns type for tuple index", () => {
      const schema = z.object({
        pair: z.tuple([z.string(), z.number()]),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("pair/0")).toBe("string");
      expect(introspector.getTypeAtPath("pair/1")).toBe("number");
    });

    it("returns 'unknown' for out-of-bounds tuple index", () => {
      const schema = z.object({
        pair: z.tuple([z.string(), z.number()]),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("pair/2")).toBe("unknown");
    });
  });

  describe("records", () => {
    it("returns value type for any key", () => {
      const schema = z.object({
        mapping: z.record(z.string(), z.number()),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("mapping/anyKey")).toBe("number");
      expect(introspector.getTypeAtPath("mapping/anotherKey")).toBe("number");
    });
  });

  describe("union types", () => {
    // Unions always return 'unknown' to let auto-coercion decide
    // Since multiple types are valid, we can't definitively determine intent

    it("returns unknown for union with string and number", () => {
      const schema = z.object({
        value: z.union([z.string(), z.number()]),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("value")).toBe("unknown");
    });

    it("returns unknown for union with number first", () => {
      const schema = z.object({
        value: z.union([z.number(), z.string()]),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("value")).toBe("unknown");
    });

    it("returns unknown for triple union", () => {
      const schema = z.object({
        value: z.union([z.number(), z.boolean(), z.string()]),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("value")).toBe("unknown");
    });

    it("returns unknown for union of primitives without string", () => {
      const schema = z.object({
        value: z.union([z.number(), z.boolean()]),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("value")).toBe("unknown");
    });

    it("returns unknown for union of booleans", () => {
      const schema = z.object({
        value: z.union([z.boolean(), z.literal(true)]),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("value")).toBe("unknown");
    });

    it("returns 'unknown' for union with only complex types", () => {
      const schema = z.object({
        value: z.union([z.object({ a: z.string() }), z.array(z.number())]),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("value")).toBe("unknown");
    });
  });

  describe("discriminated unions", () => {
    it("returns 'unknown' for discriminated union (complex)", () => {
      const schema = z.object({
        result: z.discriminatedUnion("type", [
          z.object({ type: z.literal("success"), data: z.string() }),
          z.object({ type: z.literal("error"), message: z.string() }),
        ]),
      });
      const introspector = new SchemaIntrospector(schema);
      // Discriminated unions are complex - return unknown
      expect(introspector.getTypeAtPath("result")).toBe("unknown");
    });
  });

  describe("intersections", () => {
    it("returns same type if both sides match", () => {
      const schema = z.object({
        value: z.intersection(z.string(), z.string()),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("value")).toBe("string");
    });

    it("prefers string in intersection", () => {
      const schema = z.object({
        value: z.intersection(z.string(), z.number()),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("value")).toBe("string");
    });
  });

  describe("literals", () => {
    it("returns 'string' for string literal", () => {
      const schema = z.object({
        status: z.literal("active"),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("status")).toBe("string");
    });

    it("returns 'number' for number literal", () => {
      const schema = z.object({
        code: z.literal(200),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("code")).toBe("number");
    });

    it("returns 'boolean' for boolean literal", () => {
      const schema = z.object({
        flag: z.literal(true),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("flag")).toBe("boolean");
    });
  });

  describe("enums", () => {
    it("returns 'string' for string enum", () => {
      const schema = z.object({
        status: z.enum(["pending", "active", "done"]),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("status")).toBe("string");
    });

    it("returns 'string' for native enum", () => {
      enum Status {
        Pending = "pending",
        Active = "active",
      }
      const schema = z.object({
        status: z.nativeEnum(Status),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("status")).toBe("string");
    });
  });

  describe("transforms and effects", () => {
    it("returns 'unknown' for transform (let Zod handle it)", () => {
      const schema = z.object({
        transformed: z.string().transform((s) => parseInt(s)),
      });
      const introspector = new SchemaIntrospector(schema);
      // Transforms expect input type, so return unknown to let auto-coercion decide
      expect(introspector.getTypeAtPath("transformed")).toBe("unknown");
    });

    it("returns base type for refine (Zod v4 keeps base type)", () => {
      const schema = z.object({
        positive: z.number().refine((n) => n > 0),
      });
      const introspector = new SchemaIntrospector(schema);
      // In Zod v4, refine just adds checks but keeps the base type
      // This is correct - we want to coerce to number since that's what's expected
      expect(introspector.getTypeAtPath("positive")).toBe("number");
    });

    it("returns 'unknown' for preprocess", () => {
      const schema = z.object({
        processed: z.preprocess((val) => String(val), z.string()),
      });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("processed")).toBe("unknown");
    });
  });

  describe("lazy schemas", () => {
    it("returns 'unknown' for lazy (recursive types)", () => {
      interface Category {
        name: string;
        subcategories: Category[];
      }
      const categorySchema: z.ZodType<Category> = z.lazy(() =>
        z.object({
          name: z.string(),
          subcategories: z.array(categorySchema),
        }),
      );
      const schema = z.object({ category: categorySchema });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("category")).toBe("unknown");
    });
  });

  describe("edge cases", () => {
    it("returns 'unknown' for non-existent top-level path", () => {
      const schema = z.object({ name: z.string() });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("missing")).toBe("unknown");
    });

    it("returns 'unknown' for empty path", () => {
      const schema = z.object({ name: z.string() });
      const introspector = new SchemaIntrospector(schema);
      // Empty path refers to the root object itself
      expect(introspector.getTypeAtPath("")).toBe("unknown");
    });

    it("handles ZodAny", () => {
      const schema = z.object({ anything: z.any() });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("anything")).toBe("unknown");
    });

    it("handles ZodUnknown", () => {
      const schema = z.object({ unknown: z.unknown() });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("unknown")).toBe("unknown");
    });

    it("handles ZodNever", () => {
      const schema = z.object({ never: z.never() });
      const introspector = new SchemaIntrospector(schema);
      expect(introspector.getTypeAtPath("never")).toBe("unknown");
    });

    it("returns 'unknown' when trying to navigate into primitive", () => {
      const schema = z.object({ name: z.string() });
      const introspector = new SchemaIntrospector(schema);
      // Can't access "name/length" - name is a string, not an object
      expect(introspector.getTypeAtPath("name/length")).toBe("unknown");
    });
  });

  describe("caching", () => {
    it("returns cached result for repeated queries", () => {
      const schema = z.object({
        id: z.string(),
        count: z.number(),
      });
      const introspector = new SchemaIntrospector(schema);

      // First calls
      expect(introspector.getTypeAtPath("id")).toBe("string");
      expect(introspector.getTypeAtPath("count")).toBe("number");

      // Repeated calls should return same results (from cache)
      expect(introspector.getTypeAtPath("id")).toBe("string");
      expect(introspector.getTypeAtPath("count")).toBe("number");
    });
  });

  describe("real-world scenarios", () => {
    it("handles TodoUpsert-like schema", () => {
      const schema = z.object({
        id: z.string().optional(),
        content: z.string().min(1),
        status: z.enum(["pending", "in_progress", "done"]).default("pending"),
      });
      const introspector = new SchemaIntrospector(schema);

      expect(introspector.getTypeAtPath("id")).toBe("string");
      expect(introspector.getTypeAtPath("content")).toBe("string");
      expect(introspector.getTypeAtPath("status")).toBe("string");
    });

    it("handles complex API response schema", () => {
      const schema = z.object({
        success: z.boolean(),
        data: z.object({
          users: z.array(
            z.object({
              id: z.string(),
              age: z.number(),
              active: z.boolean(),
              role: z.enum(["admin", "user"]),
              metadata: z
                .object({
                  lastLogin: z.string().optional(),
                  loginCount: z.number().default(0),
                })
                .optional(),
            }),
          ),
          pagination: z.object({
            page: z.number(),
            total: z.number(),
          }),
        }),
        error: z.string().nullable(),
      });
      const introspector = new SchemaIntrospector(schema);

      expect(introspector.getTypeAtPath("success")).toBe("boolean");
      expect(introspector.getTypeAtPath("data/users/0/id")).toBe("string");
      expect(introspector.getTypeAtPath("data/users/0/age")).toBe("number");
      expect(introspector.getTypeAtPath("data/users/0/active")).toBe("boolean");
      expect(introspector.getTypeAtPath("data/users/0/role")).toBe("string");
      expect(introspector.getTypeAtPath("data/users/0/metadata/lastLogin")).toBe("string");
      expect(introspector.getTypeAtPath("data/users/0/metadata/loginCount")).toBe("number");
      expect(introspector.getTypeAtPath("data/pagination/page")).toBe("number");
      expect(introspector.getTypeAtPath("error")).toBe("string");
    });

    it("handles schema with mixed string and number IDs in union", () => {
      const schema = z.object({
        id: z.union([z.string(), z.number()]),
        items: z.array(
          z.object({
            itemId: z.union([z.string(), z.number()]),
          }),
        ),
      });
      const introspector = new SchemaIntrospector(schema);

      // Unions return 'unknown' to let auto-coercion handle ambiguous cases
      expect(introspector.getTypeAtPath("id")).toBe("unknown");
      expect(introspector.getTypeAtPath("items/0/itemId")).toBe("unknown");
    });
  });
});
