import { describe, expect, it } from "bun:test";
import { z } from "zod";

import { Gadget } from "./typed-gadget.js";

describe("Zod v4 toJSONSchema() Compatibility", () => {
  describe("supported patterns", () => {
    it("supports basic types with .optional()", () => {
      class TestGadget extends Gadget({
        name: "TestGadget",
        description: "Test",
        schema: z.object({
          title: z.string(),
          content: z.string().optional(),
        }),
      }) {
        execute(): string {
          return "done";
        }
      }

      const gadget = new TestGadget();
      expect(() => gadget.getInstruction("json")).not.toThrow();
    });

    it("supports nullable strings without .optional()", () => {
      class TestGadget extends Gadget({
        name: "TestGadget",
        description: "Test",
        schema: z.object({
          parentId: z.string().nullable(),
        }),
      }) {
        execute(): string {
          return "done";
        }
      }

      const gadget = new TestGadget();
      expect(() => gadget.getInstruction("json")).not.toThrow();
    });

    it("supports simple nested objects", () => {
      class TestGadget extends Gadget({
        name: "TestGadget",
        description: "Test",
        schema: z.object({
          user: z.object({
            name: z.string(),
            email: z.string(),
          }),
        }),
      }) {
        execute(): string {
          return "done";
        }
      }

      const gadget = new TestGadget();
      expect(() => gadget.getInstruction("json")).not.toThrow();
    });

    it("supports arrays of primitives", () => {
      class TestGadget extends Gadget({
        name: "TestGadget",
        description: "Test",
        schema: z.object({
          tags: z.array(z.string()),
        }),
      }) {
        execute(): string {
          return "done";
        }
      }

      const gadget = new TestGadget();
      expect(() => gadget.getInstruction("json")).not.toThrow();
    });
  });

  describe("more supported patterns", () => {
    it("supports .nullable().optional() combination", () => {
      class TestGadget extends Gadget({
        name: "TestGadget",
        description: "Test",
        // This is used in CreateSectionGadget
        schema: z.object({
          parentSectionId: z.string().nullable().optional(),
        }),
      }) {
        execute(): string {
          return "done";
        }
      }

      const gadget = new TestGadget();
      expect(() => gadget.getInstruction("json")).not.toThrow();
    });

    it("supports .email() refinement", () => {
      class TestGadget extends Gadget({
        name: "TestGadget",
        description: "Test",
        schema: z.object({
          email: z.string().email(),
        }),
      }) {
        execute(): string {
          return "done";
        }
      }

      const gadget = new TestGadget();
      expect(() => gadget.getInstruction("json")).not.toThrow();
    });
  });

  describe("unsupported patterns", () => {
    it("FAILS: z.record(z.string())", () => {
      class TestGadget extends Gadget({
        name: "TestGadget",
        description: "Test",
        schema: z.object({
          metadata: z.record(z.string()),
        }),
      }) {
        execute(): string {
          return "done";
        }
      }

      const gadget = new TestGadget();
      expect(() => gadget.getInstruction("json")).toThrow(/cannot be serialized/);
    });
  });

  describe("alternatives for unsupported patterns", () => {
    it("use z.object({}).passthrough() instead of z.record()", () => {
      class TestGadget extends Gadget({
        name: "TestGadget",
        description: "Test",
        schema: z.object({
          metadata: z.object({}).passthrough(),
        }),
      }) {
        execute(): string {
          return "done";
        }
      }

      const gadget = new TestGadget();
      expect(() => gadget.getInstruction("json")).not.toThrow();
    });
  });

  describe("niu CreateSectionGadget example", () => {
    it("actual niu schema works correctly", () => {
      class CreateSectionGadget extends Gadget({
        name: "CreateSection",
        description: "Create a new content section in the document system",
        schema: z.object({
          title: z.string().min(1).describe("The title for the new section"),
          // The original niu pattern actually works fine!
          parentSectionId: z
            .string()
            .nullable()
            .optional()
            .describe("ID of the parent section (null for root)"),
          content: z.string().optional().describe("Initial content for the section"),
        }),
      }) {
        execute(): string {
          return "done";
        }
      }

      const gadget = new CreateSectionGadget();
      const instruction = gadget.getInstruction("json");

      expect(instruction).toContain("Input Schema (JSON):");
      expect(instruction).toContain("The title for the new section");

      // Verify the schema is actually valid JSON
      const jsonMatch = instruction.match(/Input Schema \(JSON\):\n([\s\S]+)/);
      expect(jsonMatch).toBeTruthy();
      if (jsonMatch?.[1]) {
        const jsonSchema = JSON.parse(jsonMatch[1]);
        expect(jsonSchema.properties).toHaveProperty("title");
        expect(jsonSchema.properties).toHaveProperty("parentSectionId");
        expect(jsonSchema.properties).toHaveProperty("content");

        // Verify descriptions
        expect(jsonSchema.properties.title.description).toBe("The title for the new section");
      }
    });
  });
});
