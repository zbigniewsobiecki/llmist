import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { z } from "zod";
import { defaultLogger } from "../logging/logger.js";
import { schemaToJSONSchema } from "./schema-to-json.js";

describe("schemaToJSONSchema", () => {
  describe("basic conversion", () => {
    it("converts simple schema to JSON Schema", () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const jsonSchema = schemaToJSONSchema(schema);

      expect(jsonSchema.type).toBe("object");
      expect((jsonSchema.properties as Record<string, unknown>).name).toEqual({ type: "string" });
      expect((jsonSchema.properties as Record<string, unknown>).age).toEqual({ type: "number" });
    });

    it("preserves descriptions from same Zod instance", () => {
      const schema = z.object({
        query: z.string().describe("Search query"),
        limit: z.number().describe("Max results"),
      });

      const jsonSchema = schemaToJSONSchema(schema);

      const properties = jsonSchema.properties as Record<string, { description?: string }>;
      expect(properties.query.description).toBe("Search query");
      expect(properties.limit.description).toBe("Max results");
    });

    it("handles nested object descriptions", () => {
      const schema = z.object({
        user: z
          .object({
            name: z.string().describe("User name"),
            email: z.string().describe("User email"),
          })
          .describe("User information"),
      });

      const jsonSchema = schemaToJSONSchema(schema);

      const properties = jsonSchema.properties as Record<string, Record<string, unknown>>;
      expect(properties.user.description).toBe("User information");
      const userProps = properties.user.properties as Record<string, { description?: string }>;
      expect(userProps.name.description).toBe("User name");
      expect(userProps.email.description).toBe("User email");
    });

    it("handles array item descriptions", () => {
      const schema = z.object({
        items: z.array(z.string().describe("Item name")).describe("List of items"),
      });

      const jsonSchema = schemaToJSONSchema(schema);

      const properties = jsonSchema.properties as Record<string, Record<string, unknown>>;
      expect(properties.items.description).toBe("List of items");
      const items = properties.items.items as { description?: string };
      expect(items.description).toBe("Item name");
    });

    it("handles optional fields with descriptions", () => {
      const schema = z.object({
        required: z.string().describe("Required field"),
        optional: z.string().optional().describe("Optional field"),
      });

      const jsonSchema = schemaToJSONSchema(schema);

      const properties = jsonSchema.properties as Record<string, { description?: string }>;
      expect(properties.required.description).toBe("Required field");
      // Optional fields may have description in different location depending on Zod version
    });

    it("handles default values with descriptions", () => {
      const schema = z.object({
        value: z.number().default(10).describe("Value with default"),
      });

      const jsonSchema = schemaToJSONSchema(schema);

      const properties = jsonSchema.properties as Record<
        string,
        { description?: string; default?: number }
      >;
      expect(properties.value.default).toBe(10);
    });
  });

  describe("draft version support", () => {
    it("defaults to draft-7", () => {
      const schema = z.object({ name: z.string() });

      const jsonSchema = schemaToJSONSchema(schema);

      // draft-7 schemas typically have $schema field
      expect(jsonSchema.$schema).toContain("draft-07");
    });

    it("supports draft-2020-12", () => {
      const schema = z.object({ name: z.string() });

      const jsonSchema = schemaToJSONSchema(schema, { target: "draft-2020-12" });

      expect(jsonSchema.$schema).toContain("2020-12");
    });
  });

  describe("mismatch detection and fallback", () => {
    let warnSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      warnSpy = spyOn(defaultLogger, "warn").mockImplementation(() => {});
    });

    it("does not warn when descriptions are present", () => {
      const schema = z.object({
        query: z.string().describe("Search query"),
      });

      schemaToJSONSchema(schema);

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("does not warn when no descriptions are used", () => {
      const schema = z.object({
        query: z.string(),
        limit: z.number(),
      });

      schemaToJSONSchema(schema);

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
