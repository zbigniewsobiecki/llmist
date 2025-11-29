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

describe("BaseGadget examples", () => {
  it("renders single example with comment and output in JSON format", () => {
    class ExampleGadget extends Gadget({
      description: "Test gadget with example",
      schema: z.object({
        value: z.number(),
      }),
      examples: [{ params: { value: 42 }, output: "Result: 42", comment: "Basic usage" }],
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new ExampleGadget();
    const instruction = gadget.getInstruction("json");

    expect(instruction).toContain("Examples:");
    expect(instruction).toContain("# Basic usage");
    expect(instruction).toContain("Input:");
    expect(instruction).toContain('"value": 42');
    expect(instruction).toContain("Output:");
    expect(instruction).toContain("Result: 42");
  });

  it("renders single example in YAML format", () => {
    class YamlExampleGadget extends Gadget({
      description: "Test",
      schema: z.object({ name: z.string() }),
      examples: [{ params: { name: "test" }, output: "hello", comment: "YAML example" }],
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new YamlExampleGadget();
    const instruction = gadget.getInstruction("yaml");

    expect(instruction).toContain("Examples:");
    expect(instruction).toContain("# YAML example");
    expect(instruction).toContain("name: test");
    expect(instruction).toContain("Output:");
    expect(instruction).toContain("hello");
  });

  it("renders multiple examples with blank line separation", () => {
    class MultiExampleGadget extends Gadget({
      description: "Test gadget",
      schema: z.object({ op: z.string() }),
      examples: [
        { params: { op: "first" }, comment: "First example" },
        { params: { op: "second" }, comment: "Second example" },
      ],
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new MultiExampleGadget();
    const instruction = gadget.getInstruction("json");

    expect(instruction).toContain("# First example");
    expect(instruction).toContain("# Second example");
    // Verify blank line between examples (multiple newlines)
    expect(instruction).toMatch(/first"[\s\S]*?\n\n# Second/);
  });

  it("omits Examples section when no examples provided", () => {
    class NoExamplesGadget extends Gadget({
      description: "Test",
      schema: z.object({ x: z.number() }),
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new NoExamplesGadget();
    const instruction = gadget.getInstruction("json");

    expect(instruction).not.toContain("Examples:");
  });

  it("omits Examples section when examples array is empty", () => {
    class EmptyExamplesGadget extends Gadget({
      description: "Test",
      schema: z.object({ x: z.number() }),
      examples: [],
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new EmptyExamplesGadget();
    const instruction = gadget.getInstruction("json");

    expect(instruction).not.toContain("Examples:");
  });

  it("renders example without output", () => {
    class NoOutputGadget extends Gadget({
      description: "Test",
      schema: z.object({ x: z.number() }),
      examples: [{ params: { x: 1 }, comment: "Just input" }],
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new NoOutputGadget();
    const instruction = gadget.getInstruction("json");

    expect(instruction).toContain("Examples:");
    expect(instruction).toContain("# Just input");
    expect(instruction).toContain("Input:");
    expect(instruction).not.toContain("Output:");
  });

  it("renders example without comment", () => {
    class NoCommentGadget extends Gadget({
      description: "Test",
      schema: z.object({ x: z.number() }),
      examples: [{ params: { x: 5 }, output: "five" }],
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new NoCommentGadget();
    const instruction = gadget.getInstruction("json");

    expect(instruction).toContain("Examples:");
    expect(instruction).toContain("Input:");
    expect(instruction).toContain('"x": 5');
    expect(instruction).toContain("Output:");
    expect(instruction).toContain("five");
    // Should not have a # line since no comment
    expect(instruction).not.toMatch(/Examples:\n#/);
  });

  it("renders TOML examples with proper inline table syntax for arrays of objects", () => {
    // This test ensures we use TOML syntax { key = value } NOT JSON syntax {"key": value}
    // The LLM copies examples from the prompt, so incorrect syntax here causes parse errors
    class TomlArrayGadget extends Gadget({
      description: "Test TOML array of objects",
      schema: z.object({
        patterns: z.array(
          z.object({
            regex: z.string(),
            include: z.boolean(),
          }),
        ),
      }),
      examples: [
        {
          params: {
            patterns: [
              { regex: "error", include: true },
              { regex: "debug", include: false },
            ],
          },
          comment: "Filter patterns",
        },
      ],
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new TomlArrayGadget();
    const instruction = gadget.getInstruction("toml");

    // Extract the examples section only (schema uses JSON syntax which is fine)
    const examplesSection = instruction.split("Examples:")[1] || "";

    // Verify TOML syntax is used in examples (key = value), NOT JSON syntax ("key": value)
    expect(examplesSection).toContain("patterns = [");
    expect(examplesSection).toContain("regex = ");
    expect(examplesSection).toContain("include = ");

    // Verify JSON syntax is NOT used in examples
    expect(examplesSection).not.toContain('"regex":');
    expect(examplesSection).not.toContain('"include":');

    // Verify the full pattern looks correct
    expect(examplesSection).toMatch(/\{ regex = "error", include = true \}/);
    expect(examplesSection).toMatch(/\{ regex = "debug", include = false \}/);
  });

  it("renders TOML examples with nested objects using inline table syntax", () => {
    class TomlNestedGadget extends Gadget({
      description: "Test TOML nested objects",
      schema: z.object({
        config: z.object({
          name: z.string(),
          enabled: z.boolean(),
        }),
      }),
      examples: [
        {
          params: {
            config: { name: "test", enabled: true },
          },
        },
      ],
    }) {
      execute(): string {
        return "done";
      }
    }

    const gadget = new TomlNestedGadget();
    const instruction = gadget.getInstruction("toml");

    // Extract the examples section only (schema uses JSON syntax which is fine)
    const examplesSection = instruction.split("Examples:")[1] || "";

    // Verify TOML inline table syntax in examples
    expect(examplesSection).toContain("config = { name = ");
    expect(examplesSection).not.toContain('"name":');
  });
});
