import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createGadget } from "./create-gadget.js";
import { validateAndApplyDefaults, validateGadgetParams } from "./validation.js";

describe("validateAndApplyDefaults", () => {
  it("validates valid parameters", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const result = validateAndApplyDefaults(schema, { name: "John", age: 30 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: "John", age: 30 });
    }
  });

  it("applies default values", () => {
    const schema = z.object({
      name: z.string(),
      count: z.number().default(0),
      enabled: z.boolean().default(true),
    });

    const result = validateAndApplyDefaults(schema, { name: "Test" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: "Test", count: 0, enabled: true });
    }
  });

  it("returns error for invalid parameters", () => {
    const schema = z.object({
      name: z.string().min(1),
      age: z.number().min(0),
    });

    const result = validateAndApplyDefaults(schema, { name: "", age: -5 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Invalid parameters");
      expect(result.issues).toHaveLength(2);
      expect(result.issues[0].path).toBe("name");
      expect(result.issues[1].path).toBe("age");
    }
  });

  it("handles nested object validation", () => {
    const schema = z.object({
      user: z.object({
        email: z.string().email(),
        profile: z.object({
          age: z.number().min(0),
        }),
      }),
    });

    const result = validateAndApplyDefaults(schema, {
      user: {
        email: "invalid",
        profile: { age: -1 },
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.path === "user.email")).toBe(true);
      expect(result.issues.some((i) => i.path === "user.profile.age")).toBe(true);
    }
  });

  it("handles missing required fields", () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    });

    const result = validateAndApplyDefaults(schema, {});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues[0].path).toBe("required");
    }
  });

  it("applies transforms", () => {
    const schema = z.object({
      name: z.string().transform((s) => s.toUpperCase()),
    });

    const result = validateAndApplyDefaults(schema, { name: "test" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: "TEST" });
    }
  });
});

describe("validateGadgetParams", () => {
  it("validates gadget with schema", () => {
    const gadget = createGadget({
      description: "Test gadget",
      schema: z.object({
        a: z.number(),
        b: z.number().default(0),
      }),
      execute: ({ a, b }) => String(a + b),
    });

    const result = validateGadgetParams(gadget, { a: 5 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ a: 5, b: 0 });
    }
  });

  it("returns original params for gadget without schema", () => {
    const gadget = createGadget({
      description: "No schema gadget",
      execute: () => "done",
    });

    const params = { foo: "bar", num: 42 };
    const result = validateGadgetParams(gadget, params);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(params);
    }
  });

  it("returns validation errors for invalid params", () => {
    const gadget = createGadget({
      description: "Test gadget",
      schema: z.object({
        value: z.number().positive(),
      }),
      execute: () => "done",
    });

    const result = validateGadgetParams(gadget, { value: -5 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Invalid parameters");
      expect(result.issues[0].path).toBe("value");
    }
  });
});
