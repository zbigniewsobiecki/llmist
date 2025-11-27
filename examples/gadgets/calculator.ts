import { z } from "zod";
import { createGadget } from "../../src/index.js";

export const calculator = createGadget({
  name: "Calculator",
  description: "Performs arithmetic: add, subtract, multiply, divide",
  schema: z.object({
    operation: z.enum(["add", "subtract", "multiply", "divide"]).describe("The operation"),
    a: z.number().describe("First number"),
    b: z.number().describe("Second number"),
  }),
  examples: [
    {
      params: { operation: "add", a: 15, b: 23 },
      output: "38",
      comment: "Add two numbers",
    },
    {
      params: { operation: "divide", a: 100, b: 4 },
      output: "25",
      comment: "Divide numbers",
    },
  ],
  execute: ({ operation, a, b }) => {
    switch (operation) {
      case "add":
        return String(a + b);
      case "subtract":
        return String(a - b);
      case "multiply":
        return String(a * b);
      case "divide":
        return b !== 0 ? String(a / b) : "Error: Division by zero";
    }
  },
});
