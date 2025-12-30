import { describe, expect, it } from "vitest";
import { type ZodError, z } from "zod";
import { GadgetExecutionErrorFormatter } from "./error-formatter.js";
import { Gadget } from "./typed-gadget.js";

// Test gadget with schema and examples
class CalculatorGadget extends Gadget({
  description: "Performs basic arithmetic operations",
  schema: z.object({
    operation: z
      .enum(["add", "subtract", "multiply", "divide"])
      .describe("The operation to perform"),
    a: z.number().describe("First operand"),
    b: z.number().describe("Second operand"),
  }),
  name: "Calculator",
  examples: [
    {
      comment: "Add two numbers",
      params: { operation: "add" as const, a: 5, b: 3 },
      output: "8",
    },
  ],
}) {
  execute(params: Record<string, unknown>): string {
    const { operation, a, b } = params as this["params"];
    switch (operation) {
      case "add":
        return String(a + b);
      case "subtract":
        return String(a - b);
      case "multiply":
        return String(a * b);
      case "divide":
        return String(a / b);
      default:
        return "Unknown operation";
    }
  }
}

// Simple gadget without schema (using AbstractGadget for parameterless gadgets)
import { AbstractGadget } from "./gadget.js";

class SimpleGadget extends AbstractGadget {
  name = "SimpleGadget";
  description = "A simple gadget with no parameters";

  execute(): string {
    return "Done";
  }
}

describe("GadgetExecutionErrorFormatter", () => {
  const formatter = new GadgetExecutionErrorFormatter();

  describe("formatValidationError", () => {
    it("formats single validation error with gadget instructions", () => {
      const gadget = new CalculatorGadget();
      const schema = z.object({
        operation: z.enum(["add", "subtract"]),
        a: z.number(),
        b: z.number(),
      });

      const result = schema.safeParse({ operation: "modulo", a: 5, b: 3 });
      expect(result.success).toBe(false);

      const formatted = formatter.formatValidationError(
        "Calculator",
        (result as { error: ZodError }).error,
        gadget,
      );

      // Check error header
      expect(formatted).toContain("Error: Invalid parameters for 'Calculator':");
      // Check issue is listed
      expect(formatted).toContain("operation:");
      // Check gadget usage is included
      expect(formatted).toContain("Gadget Usage:");
      expect(formatted).toContain("Performs basic arithmetic operations");
      // Check parameters are shown
      expect(formatted).toContain("Parameters:");
      // Check example is included
      expect(formatted).toContain("Examples:");
    });

    it("formats multiple validation errors", () => {
      const gadget = new CalculatorGadget();
      const schema = z.object({
        operation: z.enum(["add"]),
        a: z.number(),
        b: z.number(),
      });

      const result = schema.safeParse({ operation: "bad", a: "not-a-number", b: "also-bad" });
      expect(result.success).toBe(false);

      const formatted = formatter.formatValidationError(
        "Calculator",
        (result as { error: ZodError }).error,
        gadget,
      );

      // Should list all issues
      expect(formatted).toContain("operation:");
      expect(formatted).toContain("a:");
      expect(formatted).toContain("b:");
    });

    it("handles nested path errors", () => {
      const gadget = new SimpleGadget();
      const schema = z.object({
        config: z.object({
          host: z.string(),
          port: z.number(),
        }),
      });

      const result = schema.safeParse({ config: { host: 123, port: "bad" } });
      expect(result.success).toBe(false);

      const formatted = formatter.formatValidationError(
        "SimpleGadget",
        (result as { error: ZodError }).error,
        gadget,
      );

      // Should show nested paths
      expect(formatted).toContain("config.host:");
      expect(formatted).toContain("config.port:");
    });
  });

  describe("formatParseError", () => {
    it("formats parse error with gadget instructions", () => {
      const gadget = new CalculatorGadget();
      const parseError = "Duplicate pointer: operation";

      const formatted = formatter.formatParseError("Calculator", parseError, gadget);

      // Check error header
      expect(formatted).toContain("Error: Failed to parse parameters for 'Calculator':");
      expect(formatted).toContain("Duplicate pointer: operation");
      // Check gadget usage is included
      expect(formatted).toContain("Gadget Usage:");
      expect(formatted).toContain("Performs basic arithmetic operations");
      // Check block format reference
      expect(formatted).toContain("Block Format Reference:");
      expect(formatted).toContain("!!!GADGET_START:Calculator");
      expect(formatted).toContain("!!!ARG:parameterName");
      expect(formatted).toContain("!!!GADGET_END");
    });

    it("formats parse error without gadget (gadget not found case)", () => {
      const parseError = "Array index gap: expected 0, got 1";

      const formatted = formatter.formatParseError("UnknownGadget", parseError, undefined);

      // Check error header
      expect(formatted).toContain("Error: Failed to parse parameters for 'UnknownGadget':");
      expect(formatted).toContain("Array index gap");
      // Should NOT include gadget usage (no gadget)
      expect(formatted).not.toContain("Gadget Usage:");
      // Should still include block format reference
      expect(formatted).toContain("Block Format Reference:");
      expect(formatted).toContain("!!!GADGET_START:UnknownGadget");
    });
  });

  describe("formatRegistryError", () => {
    it("formats registry error with available gadgets", () => {
      const availableGadgets = ["Calculator", "Weather", "Email"];

      const formatted = formatter.formatRegistryError("Calculater", availableGadgets);

      expect(formatted).toContain("Error: Gadget 'Calculater' not found.");
      expect(formatted).toContain("Available gadgets: Calculator, Weather, Email");
    });

    it("handles empty registry", () => {
      const formatted = formatter.formatRegistryError("SomeGadget", []);

      expect(formatted).toContain("Error: Gadget 'SomeGadget' not found.");
      expect(formatted).toContain("No gadgets are currently registered.");
    });
  });

  describe("custom prefixes", () => {
    it("uses custom argument prefix in formatted errors", () => {
      const customFormatter = new GadgetExecutionErrorFormatter({
        argPrefix: "@@PARAM:",
        startPrefix: "@@START:",
        endPrefix: "@@END",
      });

      const gadget = new CalculatorGadget();
      const parseError = "Some parse error";

      const formatted = customFormatter.formatParseError("Calculator", parseError, gadget);

      // Block format reference should use custom prefixes
      expect(formatted).toContain("@@START:Calculator");
      expect(formatted).toContain("@@PARAM:parameterName");
      expect(formatted).toContain("@@END");
    });
  });
});
