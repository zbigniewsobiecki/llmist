import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createGadget } from "./create-gadget.js";
import type { BaseGadget } from "./gadget.js";

describe("createGadget", () => {
  it("should create a gadget with correct properties", () => {
    const gadget = createGadget({
      name: "TestGadget",
      description: "A test gadget",
      schema: z.object({
        input: z.string(),
      }),
      execute: ({ input }) => `Got: ${input}`,
    });

    expect(gadget).toBeInstanceOf(Object);
    expect(gadget.name).toBe("TestGadget");
    expect(gadget.description).toBe("A test gadget");
    expect(gadget.parameterSchema).toBeDefined();
  });

  it("should execute with typed parameters", () => {
    const gadget = createGadget({
      description: "Calculator",
      schema: z.object({
        a: z.number(),
        b: z.number(),
      }),
      execute: ({ a, b }) => String(a + b),
    });

    const result = gadget.execute({ a: 5, b: 3 });
    expect(result).toBe("8");
  });

  it("should support async execution", async () => {
    const gadget = createGadget({
      description: "Async gadget",
      schema: z.object({
        delay: z.number(),
      }),
      execute: async ({ delay }) => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return "Done";
      },
    });

    const result = await gadget.execute({ delay: 10 });
    expect(result).toBe("Done");
  });

  it("should support complex schema types", () => {
    const gadget = createGadget({
      description: "Complex gadget",
      schema: z.object({
        operation: z.enum(["add", "subtract", "multiply"]),
        numbers: z.array(z.number()),
        options: z
          .object({
            round: z.boolean().default(false),
          })
          .optional(),
      }),
      execute: ({ operation, numbers, options }) => {
        let result = numbers[0];
        for (let i = 1; i < numbers.length; i++) {
          switch (operation) {
            case "add":
              result += numbers[i];
              break;
            case "subtract":
              result -= numbers[i];
              break;
            case "multiply":
              result *= numbers[i];
              break;
          }
        }
        if (options?.round) {
          result = Math.round(result);
        }
        return String(result);
      },
    });

    const result1 = gadget.execute({
      operation: "add",
      numbers: [1, 2, 3],
    });
    expect(result1).toBe("6");

    const result2 = gadget.execute({
      operation: "multiply",
      numbers: [2, 3, 4],
      options: { round: true },
    });
    expect(result2).toBe("24");
  });

  it("should support optional timeout", () => {
    const gadget = createGadget({
      description: "Timed gadget",
      schema: z.object({
        input: z.string(),
      }),
      execute: ({ input }) => input,
      timeoutMs: 5000,
    });

    expect(gadget.timeoutMs).toBe(5000);
  });

  it("should work with empty schema", () => {
    const gadget = createGadget({
      description: "No params gadget",
      schema: z.object({}),
      execute: () => "Hello",
    });

    const result = gadget.execute({});
    expect(result).toBe("Hello");
  });

  it("should preserve schema validation", () => {
    const gadget = createGadget({
      description: "Validated gadget",
      schema: z.object({
        email: z.string().email(),
        age: z.number().min(0).max(150),
      }),
      execute: ({ email, age }) => `${email} is ${age} years old`,
    });

    // Valid input
    const result = gadget.execute({
      email: "test@example.com",
      age: 25,
    });
    expect(result).toBe("test@example.com is 25 years old");
  });

  it("should support describe() on schema fields", () => {
    const gadget = createGadget({
      description: "Documented gadget",
      schema: z.object({
        city: z.string().describe("The city name"),
        country: z.string().describe("The country name"),
      }),
      execute: ({ city, country }) => `${city}, ${country}`,
    });

    const instruction = gadget.getInstruction("json");
    expect(instruction).toContain("city");
    expect(instruction).toContain("country");
  });

  it("should generate proper instructions", () => {
    const gadget = createGadget({
      name: "WeatherGadget",
      description: "Gets weather information",
      schema: z.object({
        location: z.string().describe("Location to get weather for"),
      }),
      execute: ({ location }) => `Weather in ${location}`,
    });

    const instruction = gadget.getInstruction("json");
    expect(instruction).toContain("Gets weather information");
    expect(instruction).toContain("location");
  });
});
