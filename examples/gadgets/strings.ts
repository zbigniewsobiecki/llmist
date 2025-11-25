import { z } from "zod";
import { createGadget } from "../../src/index.js";

export const stringProcessor = createGadget({
  name: "StringProcessor",
  description: "Processes strings: reverse, uppercase, lowercase, length, wordcount",
  schema: z.object({
    text: z.string().describe("The text to process"),
    operation: z
      .enum(["reverse", "uppercase", "lowercase", "length", "wordcount"])
      .describe("Operation to apply"),
  }),
  execute: ({ text, operation }) => {
    switch (operation) {
      case "reverse":
        return text.split("").reverse().join("");
      case "uppercase":
        return text.toUpperCase();
      case "lowercase":
        return text.toLowerCase();
      case "length":
        return String(text.length);
      case "wordcount":
        return String(text.trim().split(/\s+/).filter(Boolean).length);
    }
  },
});
