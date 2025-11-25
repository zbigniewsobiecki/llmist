import { describe, expect, it } from "vitest";
import { z } from "zod";

import { Gadget } from "./typed-gadget.js";

describe("Gadget", () => {
  it("should create a typed gadget class", () => {
    class TestGadget extends Gadget({
      description: "A test gadget",
      schema: z.object({
        input: z.string(),
      }),
    }) {
      execute(params: Record<string, unknown>): string {
        const { input } = params as this["params"];
        return `Got: ${input}`;
      }
    }

    const gadget = new TestGadget();
    expect(gadget.description).toBe("A test gadget");
    expect(gadget.parameterSchema).toBeDefined();
  });

  it("should execute with typed parameters", () => {
    class Calculator extends Gadget({
      description: "Calculator",
      schema: z.object({
        a: z.number(),
        b: z.number(),
        operation: z.enum(["add", "subtract"]),
      }),
    }) {
      execute(params: Record<string, unknown>): string {
        const { a, b, operation } = params as this["params"];
        const result = operation === "add" ? a + b : a - b;
        return String(result);
      }
    }

    const calc = new Calculator();
    const result = calc.execute({ a: 10, b: 3, operation: "add" });
    expect(result).toBe("13");
  });

  it("should support async execution", async () => {
    class AsyncGadget extends Gadget({
      description: "Async gadget",
      schema: z.object({
        delay: z.number(),
        message: z.string(),
      }),
    }) {
      async execute(params: Record<string, unknown>): Promise<string> {
        const { delay, message } = params as this["params"];
        await new Promise((resolve) => setTimeout(resolve, delay));
        return message;
      }
    }

    const gadget = new AsyncGadget();
    const result = await gadget.execute({ delay: 10, message: "Done!" });
    expect(result).toBe("Done!");
  });

  it("should support complex nested schemas", () => {
    class ComplexGadget extends Gadget({
      description: "Complex gadget",
      schema: z.object({
        user: z.object({
          name: z.string(),
          age: z.number(),
        }),
        preferences: z.object({
          theme: z.enum(["light", "dark"]),
          notifications: z.boolean(),
        }),
      }),
    }) {
      execute(params: Record<string, unknown>): string {
        const { user, preferences } = params as this["params"];
        return `${user.name} (${user.age}) prefers ${preferences.theme}`;
      }
    }

    const gadget = new ComplexGadget();
    const result = gadget.execute({
      user: { name: "Alice", age: 30 },
      preferences: { theme: "dark", notifications: true },
    });
    expect(result).toBe("Alice (30) prefers dark");
  });

  it("should support optional name", () => {
    class NamedGadget extends Gadget({
      name: "CustomName",
      description: "Named gadget",
      schema: z.object({}),
    }) {
      execute(): string {
        return "Hello";
      }
    }

    const gadget = new NamedGadget();
    expect(gadget.name).toBe("CustomName");
  });

  it("should support optional timeout", () => {
    class TimedGadget extends Gadget({
      description: "Timed gadget",
      schema: z.object({}),
      timeoutMs: 3000,
    }) {
      execute(): string {
        return "Done";
      }
    }

    const gadget = new TimedGadget();
    expect(gadget.timeoutMs).toBe(3000);
  });

  it("should work with empty schema", () => {
    class EmptyGadget extends Gadget({
      description: "No params",
      schema: z.object({}),
    }) {
      execute(): string {
        return "Hello";
      }
    }

    const gadget = new EmptyGadget();
    const result = gadget.execute({});
    expect(result).toBe("Hello");
  });

  it("should support array types in schema", () => {
    class ArrayGadget extends Gadget({
      description: "Array gadget",
      schema: z.object({
        numbers: z.array(z.number()),
        strings: z.array(z.string()),
      }),
    }) {
      execute(params: Record<string, unknown>): string {
        const { numbers, strings } = params as this["params"];
        const sum = numbers.reduce((a, b) => a + b, 0);
        const joined = strings.join(", ");
        return `Sum: ${sum}, Strings: ${joined}`;
      }
    }

    const gadget = new ArrayGadget();
    const result = gadget.execute({
      numbers: [1, 2, 3],
      strings: ["a", "b", "c"],
    });
    expect(result).toBe("Sum: 6, Strings: a, b, c");
  });

  it("should support optional fields", () => {
    class OptionalGadget extends Gadget({
      description: "Optional fields",
      schema: z.object({
        required: z.string(),
        optional: z.string().optional(),
      }),
    }) {
      execute(params: Record<string, unknown>): string {
        const { required, optional } = params as this["params"];
        return optional ? `${required} and ${optional}` : required;
      }
    }

    const gadget = new OptionalGadget();

    const result1 = gadget.execute({ required: "Hello" });
    expect(result1).toBe("Hello");

    const result2 = gadget.execute({ required: "Hello", optional: "World" });
    expect(result2).toBe("Hello and World");
  });

  it("should support default values", () => {
    class DefaultGadget extends Gadget({
      description: "Default values",
      schema: z.object({
        count: z.number().default(10),
        message: z.string().default("Hello"),
      }),
    }) {
      execute(params: Record<string, unknown>): string {
        const { count, message } = params as this["params"];
        return `${message} x${count}`;
      }
    }

    const gadget = new DefaultGadget();

    // Note: defaults are applied by Zod during validation, not in execute
    // This test just ensures the schema accepts the params
    const result = gadget.execute({ count: 5, message: "Hi" });
    expect(result).toBe("Hi x5");
  });

  it("should generate proper instructions", () => {
    class DocumentedGadget extends Gadget({
      name: "MyGadget",
      description: "A well-documented gadget",
      schema: z.object({
        param1: z.string().describe("The first parameter"),
        param2: z.number().describe("The second parameter"),
      }),
    }) {
      execute(): string {
        return "Done";
      }
    }

    const gadget = new DocumentedGadget();
    const instruction = gadget.getInstruction("json");

    expect(instruction).toContain("A well-documented gadget");
    expect(instruction).toContain("param1");
    expect(instruction).toContain("param2");
  });

  it("should inherit from base Gadget class", () => {
    class TestGadget extends Gadget({
      description: "Test",
      schema: z.object({}),
    }) {
      execute(): string {
        return "Test";
      }
    }

    const gadget = new TestGadget();
    expect(typeof gadget.getInstruction).toBe("function");
    expect(gadget.description).toBeDefined();
    expect(gadget.parameterSchema).toBeDefined();
  });
});
