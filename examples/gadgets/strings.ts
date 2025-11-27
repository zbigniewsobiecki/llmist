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
  examples: [
    {
      params: { text: "Hello World", operation: "reverse" },
      output: "dlroW olleH",
      comment: "Reverse a string",
    },
    {
      params: { text: "The quick brown fox", operation: "wordcount" },
      output: "4",
      comment: "Count words in text",
    },
  ],
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
