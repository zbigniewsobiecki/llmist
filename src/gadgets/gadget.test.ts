import { describe, expect, it } from "bun:test";
import { z } from "zod";

import { Gadget } from "./typed-gadget.js";

class SchemaGadget extends Gadget({
  name: "SchemaGadget",
  description: "Processes items with structured input.",
  schema: z.object({
    count: z.number().int().min(1).describe("Number of items to process"),
    tags: z.array(z.string()).default([]).describe("Optional tags to apply"),
  }),
}) {
  execute(params: this["params"]): string {
    const { count, tags } = params;
    return `Processed ${count} items with ${tags.length} tags.`;
  }
}

describe("BaseGadget", () => {
  it("includes zod schema in instruction output as YAML", () => {
    const gadget = new SchemaGadget();
    const instruction = gadget.instruction;

    expect(instruction).toContain("Input Schema (YAML):");
    expect(instruction).toContain("type: object");
    expect(instruction).toContain("count:");
    expect(instruction).toContain("description: Number of items to process");
    expect(instruction).toContain("tags:");
  });

  it("includes zod schema in instruction output as JSON when format is json", () => {
    const gadget = new SchemaGadget();
    const instruction = gadget.getInstruction("json");

    expect(instruction).toContain("Input Schema (JSON):");
    expect(instruction).toContain("Processes items with structured input.");

    // Verify it's valid JSON by parsing it
    const jsonMatch = instruction.match(/Input Schema \(JSON\):\n([\s\S]+)/);
    expect(jsonMatch).toBeTruthy();

    if (jsonMatch?.[1]) {
      const jsonSchema = JSON.parse(jsonMatch[1]);

      // Zod v4 returns direct schema (no $ref wrapper)
      expect(jsonSchema).toHaveProperty("type", "object");
      expect(jsonSchema).toHaveProperty("properties");
      expect(jsonSchema.properties).toHaveProperty("count");
      expect(jsonSchema.properties).toHaveProperty("tags");

      // Verify parameter descriptions are included
      expect(jsonSchema.properties.count.description).toBe("Number of items to process");
      expect(jsonSchema.properties.tags.description).toBe("Optional tags to apply");

      // Verify parameter types
      expect(jsonSchema.properties.count.type).toBe("integer");
      expect(jsonSchema.properties.tags.type).toBe("array");

      // Verify parameter constraints
      expect(jsonSchema.properties.count.minimum).toBe(1);
    }
  });

  it("includes zod schema in instruction output as JSON when format is auto", () => {
    const gadget = new SchemaGadget();
    const instruction = gadget.getInstruction("auto");

    expect(instruction).toContain("Input Schema (JSON):");
    expect(instruction).toContain("Processes items with structured input.");
  });

  it("includes all nested properties in JSON schema for complex objects", () => {
    class ComplexGadget extends Gadget({
      name: "ComplexGadget",
      description: "Tests complex nested schemas",
      schema: z.object({
        user: z
          .object({
            name: z.string().describe("User name"),
            email: z.string().email().describe("User email"),
            age: z.number().optional().describe("User age"),
          })
          .describe("User information"),
        items: z
          .array(
            z.object({
              id: z.string(),
              quantity: z.number(),
            }),
          )
          .describe("List of items"),
        metadata: z.object({}).passthrough().describe("Additional metadata"),
      }),
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new ComplexGadget();
    const instruction = gadget.getInstruction("json");

    expect(instruction).toContain("Input Schema (JSON):");

    const jsonMatch = instruction.match(/Input Schema \(JSON\):\n([\s\S]+)/);
    expect(jsonMatch).toBeTruthy();

    if (jsonMatch?.[1]) {
      const jsonSchema = JSON.parse(jsonMatch[1]);

      // Zod v4 returns direct schema (no $ref wrapper)
      // Verify all top-level properties
      expect(jsonSchema.properties).toHaveProperty("user");
      expect(jsonSchema.properties).toHaveProperty("items");
      expect(jsonSchema.properties).toHaveProperty("metadata");

      // Verify nested user properties
      expect(jsonSchema.properties.user.properties).toHaveProperty("name");
      expect(jsonSchema.properties.user.properties).toHaveProperty("email");
      expect(jsonSchema.properties.user.properties).toHaveProperty("age");

      // Verify descriptions are preserved
      expect(jsonSchema.properties.user.description).toBe("User information");
      expect(jsonSchema.properties.user.properties.name.description).toBe("User name");
      expect(jsonSchema.properties.user.properties.email.description).toBe("User email");

      // Verify array item schema
      expect(jsonSchema.properties.items.type).toBe("array");
      expect(jsonSchema.properties.items.items.properties).toHaveProperty("id");
      expect(jsonSchema.properties.items.items.properties).toHaveProperty("quantity");
    }
  });

  it("throws error when using z.unknown() in parameter schema", () => {
    class BadGadget extends Gadget({
      name: "BadGadget",
      description: "Uses z.unknown() which is not allowed",
      schema: z.object({
        id: z.string(),
        content: z.unknown(),
      }),
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new BadGadget();

    expect(() => gadget.getInstruction()).toThrow(/uses z\.unknown\(\)/);
    expect(() => gadget.getInstruction()).toThrow(/BadGadget/);
    expect(() => gadget.getInstruction()).toThrow(/content/);
  });

  it("provides helpful error message with suggestions when z.unknown() is used", () => {
    class UnknownGadget extends Gadget({
      name: "UnknownGadget",
      description: "Test gadget",
      schema: z.object({
        data: z.unknown(),
      }),
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new UnknownGadget();

    try {
      gadget.getInstruction();
      expect.fail("Should have thrown an error");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("z.record(z.string())");
      expect(message).toContain("z.object({}).passthrough()");
      expect(message).toContain("Example fixes:");
    }
  });
});
