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
      expect(() => gadget.getInstruction()).not.toThrow();
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
      expect(() => gadget.getInstruction()).not.toThrow();
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
      expect(() => gadget.getInstruction()).not.toThrow();
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
      expect(() => gadget.getInstruction()).not.toThrow();
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
      expect(() => gadget.getInstruction()).not.toThrow();
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
      expect(() => gadget.getInstruction()).not.toThrow();
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
      expect(() => gadget.getInstruction()).toThrow(/cannot be serialized/);
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
      expect(() => gadget.getInstruction()).not.toThrow();
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
      const instruction = gadget.getInstruction();

      // Now uses plain text format with required/optional sections
      expect(instruction).toContain("Parameters:");
      expect(instruction).toContain("1 required, 2 optional");
      expect(instruction).toContain("REQUIRED Parameters:");
      expect(instruction).toContain("OPTIONAL Parameters:");
      expect(instruction).toContain("The title for the new section");

      // Verify all properties are listed in plain text format
      expect(instruction).toContain("- title (string): The title for the new section");
      expect(instruction).toContain("- parentSectionId");
      expect(instruction).toContain("- content (string): Initial content for the section");
    });
  });
});
