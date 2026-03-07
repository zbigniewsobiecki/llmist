/**
 * Tests for the mismatch detection and mergeDescriptions() fallback path in schema-to-json.ts.
 *
 * The source code (schema-to-json.ts) checks schema._def.description to detect Zod instance
 * mismatches (where toJSONSchema strips descriptions). In Zod v3, descriptions were stored
 * in _def.description. In Zod v4, they moved to the schema instance directly.
 *
 * We use vi.mock to control toJSONSchema output AND manually set _def properties to simulate
 * the Zod v3 structure that the mismatch detection code was designed for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";
import { defaultLogger } from "../logging/logger.js";
import { schemaToJSONSchema } from "./schema-to-json.js";

// Mock zod to control toJSONSchema output and simulate instance mismatch.
// vi.mock is hoisted to top of file by Vitest and intercepts module resolution.
// The source file (schema-to-json.ts) uses `import * as z from "zod"` and calls z.toJSONSchema(),
// so mocking the module-level `toJSONSchema` export intercepts those calls.
vi.mock("zod", async (importActual) => {
  const actual = await importActual<typeof import("zod")>();
  return {
    ...actual,
    toJSONSchema: vi.fn(actual.toJSONSchema),
  };
});

/**
 * Creates a fake Zod schema object that simulates Zod v3's _def structure with descriptions.
 * The mismatch detection code reads schema._def.description, which was how Zod v3 stored descriptions.
 * In Zod v4, descriptions are stored differently, so we simulate v3 structure here.
 */
function createMockZodSchema(options: {
  description?: string;
  typeName?: string;
  shape?: Record<string, unknown>;
  innerType?: unknown;
  type?: unknown; // for arrays
  // biome-ignore lint/suspicious/noExplicitAny: intentional - simulating Zod schema structure
}): any {
  const def: Record<string, unknown> = {};
  if (options.description) def.description = options.description;
  if (options.typeName) def.typeName = options.typeName;
  if (options.shape) def.shape = options.shape;
  if (options.innerType !== undefined) def.innerType = options.innerType;
  if (options.type !== undefined) def.type = options.type;

  return { _def: def };
}

describe("schemaToJSONSchema mismatch detection and mergeDescriptions()", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Reset mock implementations for z.toJSONSchema back to pass-through
    vi.mocked(z.toJSONSchema).mockReset();
    // Set up warn spy
    warnSpy = vi.spyOn(defaultLogger, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(z.toJSONSchema).mockReset();
    warnSpy?.mockRestore();
  });

  describe("mismatch detection path", () => {
    it("logs warning when toJSONSchema strips root-level description", () => {
      // Create a schema with description in _def (simulates Zod v3 structure)
      const mockSchema = createMockZodSchema({ description: "Root description" });

      // toJSONSchema returns schema WITHOUT description (simulating mismatch)
      vi.mocked(z.toJSONSchema).mockReturnValue({
        type: "string",
      });

      schemaToJSONSchema(mockSchema);

      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Zod instance mismatch detected"),
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('import { z } from "llmist"'));
    });

    it("includes mismatch count in warning message", () => {
      // Simulate 3 descriptions in _def that are missing from JSON output
      const mockSchema = createMockZodSchema({
        typeName: "ZodObject",
        shape: {
          a: createMockZodSchema({ description: "Field A" }),
          b: createMockZodSchema({ description: "Field B" }),
          c: createMockZodSchema({ description: "Field C" }),
        },
      });

      vi.mocked(z.toJSONSchema).mockReturnValue({
        type: "object",
        properties: {
          a: { type: "string" },
          b: { type: "string" },
          c: { type: "string" },
        },
      });

      schemaToJSONSchema(mockSchema);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("3 description(s) lost"));
    });

    it("does not warn when toJSONSchema preserves all descriptions", () => {
      const mockSchema = createMockZodSchema({ description: "A description" });

      // Return schema WITH description (no mismatch)
      vi.mocked(z.toJSONSchema).mockReturnValue({
        type: "string",
        description: "A description",
      });

      schemaToJSONSchema(mockSchema);

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("does not warn when no descriptions exist in schema _def", () => {
      const mockSchema = createMockZodSchema({ typeName: "ZodString" });

      vi.mocked(z.toJSONSchema).mockReturnValue({
        type: "string",
      });

      schemaToJSONSchema(mockSchema);

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("detects mismatch for object property descriptions", () => {
      const mockSchema = createMockZodSchema({
        typeName: "ZodObject",
        shape: {
          query: createMockZodSchema({ description: "Search query" }),
          limit: createMockZodSchema({ description: "Max results" }),
        },
      });

      vi.mocked(z.toJSONSchema).mockReturnValue({
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
      });

      schemaToJSONSchema(mockSchema);

      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("2 description(s) lost"));
    });
  });

  describe("mergeDescriptions() for nested object properties", () => {
    it("recovers descriptions for nested object properties", () => {
      const nameSchema = createMockZodSchema({ description: "User name" });
      const emailSchema = createMockZodSchema({ description: "User email" });
      const userSchema = createMockZodSchema({
        typeName: "ZodObject",
        description: "User information",
        shape: { name: nameSchema, email: emailSchema },
      });
      const rootSchema = createMockZodSchema({
        typeName: "ZodObject",
        shape: { user: userSchema },
      });

      vi.mocked(z.toJSONSchema).mockReturnValue({
        type: "object",
        properties: {
          user: {
            type: "object",
            properties: {
              name: { type: "string" },
              email: { type: "string" },
            },
          },
        },
      });

      const result = schemaToJSONSchema(rootSchema);

      const properties = result.properties as Record<string, Record<string, unknown>>;
      expect(properties.user.description).toBe("User information");

      const userProps = properties.user.properties as Record<string, { description?: string }>;
      expect(userProps.name.description).toBe("User name");
      expect(userProps.email.description).toBe("User email");
    });

    it("recovers descriptions for deeply nested object properties", () => {
      const valueSchema = createMockZodSchema({ description: "Deep value" });
      const level2Schema = createMockZodSchema({
        typeName: "ZodObject",
        description: "Level 2",
        shape: { value: valueSchema },
      });
      const level1Schema = createMockZodSchema({
        typeName: "ZodObject",
        description: "Level 1",
        shape: { level2: level2Schema },
      });
      const rootSchema = createMockZodSchema({
        typeName: "ZodObject",
        shape: { level1: level1Schema },
      });

      vi.mocked(z.toJSONSchema).mockReturnValue({
        type: "object",
        properties: {
          level1: {
            type: "object",
            properties: {
              level2: {
                type: "object",
                properties: {
                  value: { type: "string" },
                },
              },
            },
          },
        },
      });

      const result = schemaToJSONSchema(rootSchema);

      const l1 = (result.properties as Record<string, Record<string, unknown>>).level1;
      expect(l1.description).toBe("Level 1");

      const l2 = (l1.properties as Record<string, Record<string, unknown>>).level2;
      expect(l2.description).toBe("Level 2");

      const valueResult = (l2.properties as Record<string, { description?: string }>).value;
      expect(valueResult.description).toBe("Deep value");
    });

    it("recovers multiple property descriptions in nested objects", () => {
      const configSchema = createMockZodSchema({
        typeName: "ZodObject",
        description: "Configuration",
        shape: {
          timeout: createMockZodSchema({ description: "Timeout in ms" }),
          retries: createMockZodSchema({ description: "Retry count" }),
          endpoint: createMockZodSchema({ description: "API endpoint" }),
        },
      });
      const rootSchema = createMockZodSchema({
        typeName: "ZodObject",
        shape: { config: configSchema },
      });

      vi.mocked(z.toJSONSchema).mockReturnValue({
        type: "object",
        properties: {
          config: {
            type: "object",
            properties: {
              timeout: { type: "number" },
              retries: { type: "number" },
              endpoint: { type: "string" },
            },
          },
        },
      });

      const result = schemaToJSONSchema(rootSchema);

      const properties = result.properties as Record<string, Record<string, unknown>>;
      expect(properties.config.description).toBe("Configuration");

      const configProps = properties.config.properties as Record<string, { description?: string }>;
      expect(configProps.timeout.description).toBe("Timeout in ms");
      expect(configProps.retries.description).toBe("Retry count");
      expect(configProps.endpoint.description).toBe("API endpoint");
    });
  });

  describe("mergeDescriptions() for array item descriptions", () => {
    it("recovers description for array field and its items", () => {
      const itemSchema = createMockZodSchema({ description: "Tag name" });
      const arraySchema = createMockZodSchema({
        typeName: "ZodArray",
        description: "List of tags",
        type: itemSchema,
      });
      const rootSchema = createMockZodSchema({
        typeName: "ZodObject",
        shape: { tags: arraySchema },
      });

      vi.mocked(z.toJSONSchema).mockReturnValue({
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string" },
          },
        },
      });

      const result = schemaToJSONSchema(rootSchema);

      const properties = result.properties as Record<string, Record<string, unknown>>;
      expect(properties.tags.description).toBe("List of tags");
      const items = properties.tags.items as { description?: string };
      expect(items.description).toBe("Tag name");
    });

    it("recovers description for root-level array schema", () => {
      const itemSchema = createMockZodSchema({ description: "Score value" });
      const rootSchema = createMockZodSchema({
        typeName: "ZodArray",
        description: "Score list",
        type: itemSchema,
      });

      vi.mocked(z.toJSONSchema).mockReturnValue({
        type: "array",
        items: { type: "number" },
      });

      const result = schemaToJSONSchema(rootSchema);

      expect(result.description).toBe("Score list");
      const items = result.items as { description?: string };
      expect(items.description).toBe("Score value");
    });

    it("recovers description for array of objects", () => {
      const objectItemSchema = createMockZodSchema({
        typeName: "ZodObject",
        description: "User object",
        shape: {
          id: createMockZodSchema({ description: "User ID" }),
          name: createMockZodSchema({ description: "User name" }),
        },
      });
      const arraySchema = createMockZodSchema({
        typeName: "ZodArray",
        description: "Users list",
        type: objectItemSchema,
      });
      const rootSchema = createMockZodSchema({
        typeName: "ZodObject",
        shape: { users: arraySchema },
      });

      vi.mocked(z.toJSONSchema).mockReturnValue({
        type: "object",
        properties: {
          users: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
              },
            },
          },
        },
      });

      const result = schemaToJSONSchema(rootSchema);

      const properties = result.properties as Record<string, Record<string, unknown>>;
      expect(properties.users.description).toBe("Users list");

      const items = properties.users.items as Record<string, unknown>;
      expect(items.description).toBe("User object");

      const itemProps = items.properties as Record<string, { description?: string }>;
      expect(itemProps.id.description).toBe("User ID");
      expect(itemProps.name.description).toBe("User name");
    });
  });

  describe("mergeDescriptions() for optional type descriptions", () => {
    it("recovers description through optional wrapper", () => {
      // ZodOptional wraps an inner type - the detection/merge recurses through it
      const innerSchema = createMockZodSchema({ description: "User nickname" });
      const optionalSchema = createMockZodSchema({
        typeName: "ZodOptional",
        innerType: innerSchema,
      });
      const rootSchema = createMockZodSchema({
        typeName: "ZodObject",
        shape: { nickname: optionalSchema },
      });

      vi.mocked(z.toJSONSchema).mockReturnValue({
        type: "object",
        properties: {
          nickname: { type: "string" },
        },
      });

      const result = schemaToJSONSchema(rootSchema);

      const properties = result.properties as Record<string, { description?: string }>;
      expect(properties.nickname.description).toBe("User nickname");
    });

    it("recovers description for optional inner object", () => {
      const innerObjectSchema = createMockZodSchema({
        typeName: "ZodObject",
        description: "Config object",
        shape: {
          key: createMockZodSchema({ description: "Config key" }),
        },
      });
      const optionalSchema = createMockZodSchema({
        typeName: "ZodOptional",
        innerType: innerObjectSchema,
      });
      const rootSchema = createMockZodSchema({
        typeName: "ZodObject",
        shape: { config: optionalSchema },
      });

      vi.mocked(z.toJSONSchema).mockReturnValue({
        type: "object",
        properties: {
          config: {
            type: "object",
            properties: {
              key: { type: "string" },
            },
          },
        },
      });

      const result = schemaToJSONSchema(rootSchema);

      const properties = result.properties as Record<string, Record<string, unknown>>;
      expect(properties.config.description).toBe("Config object");
      const configProps = properties.config.properties as Record<string, { description?: string }>;
      expect(configProps.key.description).toBe("Config key");
    });
  });

  describe("mergeDescriptions() for nullable type descriptions", () => {
    it("recovers description through nullable wrapper", () => {
      const innerSchema = createMockZodSchema({ description: "Middle name" });
      const nullableSchema = createMockZodSchema({
        typeName: "ZodNullable",
        innerType: innerSchema,
      });
      const rootSchema = createMockZodSchema({
        typeName: "ZodObject",
        shape: { middleName: nullableSchema },
      });

      vi.mocked(z.toJSONSchema).mockReturnValue({
        type: "object",
        properties: {
          middleName: { type: "string" },
        },
      });

      const result = schemaToJSONSchema(rootSchema);

      const properties = result.properties as Record<string, { description?: string }>;
      expect(properties.middleName.description).toBe("Middle name");
    });

    it("recovers description for nullable inner type with nested properties", () => {
      const innerSchema = createMockZodSchema({ description: "Score value" });
      const nullableSchema = createMockZodSchema({
        typeName: "ZodNullable",
        innerType: innerSchema,
      });
      const rootSchema = createMockZodSchema({
        typeName: "ZodObject",
        shape: { score: nullableSchema },
      });

      vi.mocked(z.toJSONSchema).mockReturnValue({
        type: "object",
        properties: {
          score: { type: "number" },
        },
      });

      const result = schemaToJSONSchema(rootSchema);

      const properties = result.properties as Record<string, { description?: string }>;
      expect(properties.score.description).toBe("Score value");
    });
  });

  describe("mergeDescriptions() for types with default values", () => {
    it("recovers description through default wrapper", () => {
      const innerSchema = createMockZodSchema({ description: "Number of retries" });
      const defaultSchema = createMockZodSchema({
        typeName: "ZodDefault",
        innerType: innerSchema,
      });
      const rootSchema = createMockZodSchema({
        typeName: "ZodObject",
        shape: { retries: defaultSchema },
      });

      vi.mocked(z.toJSONSchema).mockReturnValue({
        type: "object",
        properties: {
          retries: { type: "number", default: 3 },
        },
      });

      const result = schemaToJSONSchema(rootSchema);

      const properties = result.properties as Record<
        string,
        { description?: string; default?: number }
      >;
      expect(properties.retries.description).toBe("Number of retries");
      expect(properties.retries.default).toBe(3);
    });

    it("recovers description for string field with default value", () => {
      const innerSchema = createMockZodSchema({ description: "User locale" });
      const defaultSchema = createMockZodSchema({
        typeName: "ZodDefault",
        innerType: innerSchema,
      });
      const rootSchema = createMockZodSchema({
        typeName: "ZodObject",
        shape: { locale: defaultSchema },
      });

      vi.mocked(z.toJSONSchema).mockReturnValue({
        type: "object",
        properties: {
          locale: { type: "string", default: "en" },
        },
      });

      const result = schemaToJSONSchema(rootSchema);

      const properties = result.properties as Record<
        string,
        { description?: string; default?: string }
      >;
      expect(properties.locale.description).toBe("User locale");
      expect(properties.locale.default).toBe("en");
    });

    it("recovers description for boolean with default value", () => {
      const innerSchema = createMockZodSchema({ description: "Feature enabled flag" });
      const defaultSchema = createMockZodSchema({
        typeName: "ZodDefault",
        innerType: innerSchema,
      });
      const rootSchema = createMockZodSchema({
        typeName: "ZodObject",
        shape: { enabled: defaultSchema },
      });

      vi.mocked(z.toJSONSchema).mockReturnValue({
        type: "object",
        properties: {
          enabled: { type: "boolean", default: true },
        },
      });

      const result = schemaToJSONSchema(rootSchema);

      const properties = result.properties as Record<
        string,
        { description?: string; default?: boolean }
      >;
      expect(properties.enabled.description).toBe("Feature enabled flag");
      expect(properties.enabled.default).toBe(true);
    });
  });

  describe("mergeDescriptions() for root-level schema description", () => {
    it("recovers root-level description when mismatch occurs", () => {
      const mockSchema = createMockZodSchema({ description: "Root description" });

      vi.mocked(z.toJSONSchema).mockReturnValue({
        type: "string",
      });

      const result = schemaToJSONSchema(mockSchema);

      expect(result.description).toBe("Root description");
    });

    it("returns schema unchanged when no descriptions exist at root", () => {
      const mockSchema = createMockZodSchema({});

      vi.mocked(z.toJSONSchema).mockReturnValue({
        type: "string",
      });

      const result = schemaToJSONSchema(mockSchema);

      expect(result.description).toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("recovers description when object has both root and nested descriptions", () => {
      const nameSchema = createMockZodSchema({ description: "Person name" });
      const rootSchema = createMockZodSchema({
        typeName: "ZodObject",
        description: "Person record",
        shape: { name: nameSchema },
      });

      vi.mocked(z.toJSONSchema).mockReturnValue({
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });

      const result = schemaToJSONSchema(rootSchema);

      expect(result.description).toBe("Person record");
      const properties = result.properties as Record<string, { description?: string }>;
      expect(properties.name.description).toBe("Person name");
    });
  });
});
