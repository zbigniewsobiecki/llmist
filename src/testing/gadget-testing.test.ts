import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createGadget } from "../gadgets/create-gadget.js";
import { testGadget, testGadgetBatch } from "./gadget-testing.js";

describe("testGadget", () => {
  it("executes gadget with validated parameters", async () => {
    const calculator = createGadget({
      description: "Add numbers",
      schema: z.object({
        a: z.number(),
        b: z.number(),
      }),
      execute: ({ a, b }) => String(a + b),
    });

    const result = await testGadget(calculator, { a: 5, b: 3 });

    expect(result.result).toBe("8");
    expect(result.error).toBeUndefined();
    expect(result.validatedParams).toEqual({ a: 5, b: 3 });
  });

  it("applies default values from schema", async () => {
    const gadget = createGadget({
      description: "Test defaults",
      schema: z.object({
        value: z.string(),
        count: z.number().default(10),
        enabled: z.boolean().default(false),
      }),
      execute: (params) => JSON.stringify(params),
    });

    const result = await testGadget(gadget, { value: "test" });

    expect(result.result).toBe('{"value":"test","count":10,"enabled":false}');
    expect(result.validatedParams).toEqual({
      value: "test",
      count: 10,
      enabled: false,
    });
  });

  it("returns validation errors for invalid parameters", async () => {
    const gadget = createGadget({
      description: "Strict gadget",
      schema: z.object({
        email: z.string().email(),
        age: z.number().min(0).max(150),
      }),
      execute: () => "done",
    });

    const result = await testGadget(gadget, { email: "not-an-email", age: 200 });

    expect(result.result).toBeUndefined();
    expect(result.error).toContain("Invalid parameters");
    expect(result.error).toContain("email");
    expect(result.error).toContain("age");
  });

  it("catches execution errors", async () => {
    const errorGadget = createGadget({
      description: "Error gadget",
      execute: () => {
        throw new Error("Execution failed!");
      },
    });

    const result = await testGadget(errorGadget, {});

    expect(result.result).toBeUndefined();
    expect(result.error).toBe("Execution failed!");
  });

  it("handles async gadgets", async () => {
    const asyncGadget = createGadget({
      description: "Async gadget",
      schema: z.object({ delay: z.number() }),
      execute: async ({ delay }) => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return "completed";
      },
    });

    const result = await testGadget(asyncGadget, { delay: 10 });

    expect(result.result).toBe("completed");
  });

  it("skips validation when skipValidation is true", async () => {
    const gadget = createGadget({
      description: "Schema gadget",
      schema: z.object({
        required: z.string(),
        count: z.number().default(5),
      }),
      execute: (params) => JSON.stringify(params),
    });

    // Without skipValidation, this would fail due to missing 'required'
    // With skipValidation, it passes through without defaults applied
    const result = await testGadget(gadget, { required: "test" }, { skipValidation: true });

    expect(result.result).toBe('{"required":"test"}');
    // Defaults are not applied when validation is skipped
    expect(result.validatedParams).toEqual({ required: "test" });
  });

  it("handles gadgets without schemas", async () => {
    const noSchemaGadget = createGadget({
      description: "No schema",
      execute: (params) => `received: ${Object.keys(params).join(",")}`,
    });

    const result = await testGadget(noSchemaGadget, { foo: 1, bar: 2 });

    expect(result.result).toBe("received: foo,bar");
    expect(result.validatedParams).toEqual({ foo: 1, bar: 2 });
  });
});

describe("testGadget cost reporting", () => {
  it("returns cost: 0 for gadgets returning strings", async () => {
    const gadget = createGadget({
      description: "Free gadget",
      execute: () => "result",
    });

    const result = await testGadget(gadget, {});

    expect(result.result).toBe("result");
    expect(result.cost).toBe(0);
  });

  it("extracts cost from { result, cost } return values", async () => {
    const paidGadget = createGadget({
      description: "Paid API gadget",
      schema: z.object({ query: z.string() }),
      execute: ({ query }) => ({
        result: `Response for: ${query}`,
        cost: 0.00123,
      }),
    });

    const result = await testGadget(paidGadget, { query: "test" });

    expect(result.result).toBe("Response for: test");
    expect(result.cost).toBe(0.00123);
  });

  it("defaults cost to 0 when result object omits cost", async () => {
    const gadget = createGadget({
      description: "Result object without cost",
      execute: () => ({ result: "done" }),
    });

    const result = await testGadget(gadget, {});

    expect(result.result).toBe("done");
    expect(result.cost).toBe(0);
  });

  it("does not include cost when execution errors", async () => {
    const errorGadget = createGadget({
      description: "Error gadget",
      execute: () => {
        throw new Error("Failed");
      },
    });

    const result = await testGadget(errorGadget, {});

    expect(result.error).toBe("Failed");
    expect(result.cost).toBeUndefined();
  });
});

describe("testGadgetBatch", () => {
  it("tests multiple parameter sets", async () => {
    const calculator = createGadget({
      description: "Calculator",
      schema: z.object({
        a: z.number(),
        b: z.number().default(0),
      }),
      execute: ({ a, b }) => String(a + b),
    });

    const results = await testGadgetBatch(calculator, [
      { a: 1, b: 2 },
      { a: 5 }, // Uses default b=0
      { a: 10, b: -3 },
    ]);

    expect(results).toHaveLength(3);
    expect(results[0].result).toBe("3");
    expect(results[1].result).toBe("5");
    expect(results[2].result).toBe("7");
  });

  it("includes validation errors in batch results", async () => {
    const gadget = createGadget({
      description: "Validator",
      schema: z.object({ value: z.number().positive() }),
      execute: ({ value }) => String(value),
    });

    const results = await testGadgetBatch(gadget, [
      { value: 5 }, // Valid
      { value: -1 }, // Invalid
      { value: 10 }, // Valid
    ]);

    expect(results[0].result).toBe("5");
    expect(results[1].error).toContain("Invalid parameters");
    expect(results[2].result).toBe("10");
  });
});
