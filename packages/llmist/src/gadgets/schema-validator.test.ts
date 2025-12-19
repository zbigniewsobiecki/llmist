import { describe, expect, it } from "bun:test";
import { z } from "zod";

import { validateGadgetSchema } from "./schema-validator.js";

describe("validateGadgetSchema", () => {
  describe("detects z.unknown() usage", () => {
    it("throws error for z.unknown() at top level", () => {
      const schema = z.object({
        id: z.string(),
        content: z.unknown(),
      });

      expect(() => validateGadgetSchema(schema, "TestGadget")).toThrow(
        /Gadget "TestGadget" uses z\.unknown\(\)/,
      );
      expect(() => validateGadgetSchema(schema, "TestGadget")).toThrow(
        /Problematic fields: content/,
      );
    });

    it("throws error for z.unknown() in nested objects", () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          metadata: z.unknown(),
        }),
      });

      expect(() => validateGadgetSchema(schema, "NestedGadget")).toThrow(/metadata/);
    });

    it("throws error for z.unknown() in deeply nested objects", () => {
      const schema = z.object({
        level1: z.object({
          level2: z.object({
            level3: z.object({
              data: z.unknown(),
            }),
          }),
        }),
      });

      expect(() => validateGadgetSchema(schema, "DeepGadget")).toThrow(/data/);
    });

    it("throws error for multiple z.unknown() fields", () => {
      const schema = z.object({
        field1: z.unknown(),
        field2: z.string(),
        field3: z.unknown(),
      });

      expect(() => validateGadgetSchema(schema, "MultiGadget")).toThrow(/field1, field3/);
    });

    it("provides helpful error message with suggestions", () => {
      const schema = z.object({
        content: z.unknown(),
      });

      expect(() => validateGadgetSchema(schema, "HelpfulGadget")).toThrow(
        /z\.record\(z\.string\(\)\)/,
      );
      expect(() => validateGadgetSchema(schema, "HelpfulGadget")).toThrow(
        /z\.object\(\{}\)\.passthrough\(\)/,
      );
      expect(() => validateGadgetSchema(schema, "HelpfulGadget")).toThrow(/Example fixes/);
    });
  });

  describe("allows valid schema patterns", () => {
    it("allows z.string(), z.number(), z.boolean()", () => {
      const schema = z.object({
        str: z.string(),
        num: z.number(),
        bool: z.boolean(),
      });

      expect(() => validateGadgetSchema(schema, "PrimitiveGadget")).not.toThrow();
    });

    it("rejects z.record(z.string()) - use .passthrough() instead", () => {
      const schema = z.object({
        id: z.string(),
        content: z.record(z.string()),
      });

      expect(() => validateGadgetSchema(schema, "RecordGadget")).toThrow(/cannot be serialized/);
    });

    it("allows z.object({}).passthrough() for flexible objects", () => {
      const schema = z.object({
        id: z.string(),
        content: z.object({}).passthrough(),
      });

      expect(() => validateGadgetSchema(schema, "PassthroughGadget")).not.toThrow();
    });

    it("allows z.array(z.string()) for arrays with typed items", () => {
      const schema = z.object({
        id: z.string(),
        items: z.array(z.string()),
      });

      expect(() => validateGadgetSchema(schema, "ArrayGadget")).not.toThrow();
    });

    it("detects z.any() since it produces same incomplete schema as z.unknown()", () => {
      const schema = z.object({
        id: z.string(),
        data: z.any(),
      });

      // z.any() and z.unknown() both produce {} in JSON Schema
      expect(() => validateGadgetSchema(schema, "AnyGadget")).toThrow(/uses z\.unknown\(\)/);
    });

    it("allows union types with z.union()", () => {
      const schema = z.object({
        content: z.union([z.string(), z.object({ text: z.string() })]),
      });

      expect(() => validateGadgetSchema(schema, "UnionGadget")).not.toThrow();
    });

    it("allows discriminated unions", () => {
      const schema = z.object({
        content: z.discriminatedUnion("type", [
          z.object({ type: z.literal("text"), value: z.string() }),
          z.object({ type: z.literal("number"), value: z.number() }),
        ]),
      });

      expect(() => validateGadgetSchema(schema, "DiscriminatedGadget")).not.toThrow();
    });

    it("allows nested objects with specific structure", () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          email: z.string(),
          metadata: z.object({}).passthrough(),
        }),
      });

      expect(() => validateGadgetSchema(schema, "NestedGadget")).not.toThrow();
    });

    it("allows optional fields", () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
        nullable: z.string().nullable(),
      });

      expect(() => validateGadgetSchema(schema, "OptionalGadget")).not.toThrow();
    });

    it("allows arrays of specific types", () => {
      const schema = z.object({
        strings: z.array(z.string()),
        objects: z.array(z.object({ id: z.string() })),
      });

      expect(() => validateGadgetSchema(schema, "TypedArrayGadget")).not.toThrow();
    });
  });

  describe("edge cases", () => {
    it("handles empty object schema", () => {
      const schema = z.object({});

      expect(() => validateGadgetSchema(schema, "EmptyGadget")).not.toThrow();
    });

    it("handles schemas with only descriptions", () => {
      const schema = z.object({
        id: z.string().describe("User ID"),
        name: z.string().describe("User name"),
      });

      expect(() => validateGadgetSchema(schema, "DescribedGadget")).not.toThrow();
    });

    it("handles schemas with default values", () => {
      const schema = z.object({
        count: z.number().default(0),
        tags: z.array(z.string()).default([]),
      });

      expect(() => validateGadgetSchema(schema, "DefaultGadget")).not.toThrow();
    });

    it("detects z.unknown() in array items", () => {
      const schema = z.object({
        id: z.string(),
        // Note: This is different from z.array(z.unknown()) which is allowed
        // This tests if we somehow get unknown in a nested way
        nested: z.object({
          items: z.unknown(),
        }),
      });

      expect(() => validateGadgetSchema(schema, "ArrayItemGadget")).toThrow(/items/);
    });

    it("handles complex nested structures", () => {
      const schema = z.object({
        data: z.object({
          user: z.object({
            profile: z.object({
              settings: z.object({}).passthrough(),
              preferences: z.array(z.object({ key: z.string(), value: z.string() })),
            }),
          }),
        }),
      });

      expect(() => validateGadgetSchema(schema, "ComplexGadget")).not.toThrow();
    });
  });

  describe("error message quality", () => {
    it("includes gadget name in error", () => {
      const schema = z.object({
        bad: z.unknown(),
      });

      expect(() => validateGadgetSchema(schema, "MySpecialGadget")).toThrow(/MySpecialGadget/);
    });

    it("lists all problematic fields", () => {
      const schema = z.object({
        field1: z.unknown(),
        field2: z.unknown(),
        field3: z.unknown(),
      });

      try {
        validateGadgetSchema(schema, "Test");
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain("field1");
        expect(message).toContain("field2");
        expect(message).toContain("field3");
      }
    });

    it("provides actionable suggestions", () => {
      const schema = z.object({
        content: z.unknown(),
      });

      try {
        validateGadgetSchema(schema, "Test");
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain("z.record(z.string())");
        expect(message).toContain("z.object({}).passthrough()");
        expect(message).toContain("z.array(z.string())");
        expect(message).toContain("Example fixes:");
      }
    });
  });
});
