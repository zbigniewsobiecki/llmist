/**
 * Tests for the minimal JSON Schema → Zod converter used to wrap MCP tool
 * input schemas as native Zod schemas for the gadget executor.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { JsonSchemaConversionError } from "./errors.js";
import { jsonSchemaToZod } from "./json-schema-to-zod.js";

describe("jsonSchemaToZod", () => {
  it("converts a string schema with description and default", () => {
    const schema = jsonSchemaToZod({ type: "string", description: "foo", default: "bar" });
    expect(schema.parse(undefined)).toBe("bar");
    expect(schema.parse("hello")).toBe("hello");
    const meta = z.toJSONSchema(schema);
    expect(meta.description).toBe("foo");
  });

  it("converts a number schema", () => {
    const schema = jsonSchemaToZod({ type: "number" });
    expect(schema.parse(3.14)).toBe(3.14);
    expect(() => schema.parse("nope")).toThrow();
  });

  it("converts an integer schema as int-constrained number", () => {
    const schema = jsonSchemaToZod({ type: "integer" });
    expect(schema.parse(7)).toBe(7);
    expect(() => schema.parse(7.5)).toThrow();
  });

  it("converts a boolean schema", () => {
    const schema = jsonSchemaToZod({ type: "boolean" });
    expect(schema.parse(true)).toBe(true);
    expect(() => schema.parse("no")).toThrow();
  });

  it("converts a string enum", () => {
    const schema = jsonSchemaToZod({ type: "string", enum: ["a", "b"] });
    expect(schema.parse("a")).toBe("a");
    expect(() => schema.parse("c")).toThrow();
  });

  it("converts an array of strings", () => {
    const schema = jsonSchemaToZod({ type: "array", items: { type: "string" } });
    expect(schema.parse(["x", "y"])).toEqual(["x", "y"]);
    expect(() => schema.parse(["x", 1])).toThrow();
  });

  it("converts an object with required and optional fields", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: { x: { type: "string" }, y: { type: "number" } },
      required: ["x"],
    });
    expect(schema.parse({ x: "hi" })).toEqual({ x: "hi" });
    expect(schema.parse({ x: "hi", y: 5 })).toEqual({ x: "hi", y: 5 });
    expect(() => schema.parse({ y: 5 })).toThrow();
  });

  it("converts a nested object", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        outer: {
          type: "object",
          properties: { inner: { type: "string" } },
          required: ["inner"],
        },
      },
      required: ["outer"],
    });
    expect(schema.parse({ outer: { inner: "deep" } })).toEqual({
      outer: { inner: "deep" },
    });
    expect(() => schema.parse({ outer: {} })).toThrow();
  });

  it("passes through missing or unknown type as z.unknown()", () => {
    const schema = jsonSchemaToZod({});
    expect(schema.parse({ anything: 1 })).toEqual({ anything: 1 });
    expect(schema.parse(null)).toBe(null);
    expect(schema.parse("free")).toBe("free");
  });

  it("respects nullable: true on a primitive", () => {
    const schema = jsonSchemaToZod({ type: "string", nullable: true });
    expect(schema.parse(null)).toBe(null);
    expect(schema.parse("hi")).toBe("hi");
  });

  it("converts oneOf with two primitive types as z.union", () => {
    const schema = jsonSchemaToZod({
      oneOf: [{ type: "string" }, { type: "number" }],
    });
    expect(schema.parse("a")).toBe("a");
    expect(schema.parse(42)).toBe(42);
    expect(() => schema.parse(true)).toThrow();
  });

  it("converts anyOf the same as oneOf for primitive unions", () => {
    const schema = jsonSchemaToZod({
      anyOf: [{ type: "string" }, { type: "number" }],
    });
    expect(schema.parse(1)).toBe(1);
    expect(schema.parse("x")).toBe("x");
  });

  it("throws JsonSchemaConversionError on $ref", () => {
    expect(() => jsonSchemaToZod({ $ref: "#/definitions/Foo" })).toThrow(
      JsonSchemaConversionError,
    );
  });

  it("throws JsonSchemaConversionError on allOf", () => {
    expect(() =>
      jsonSchemaToZod({ allOf: [{ type: "string" }, { type: "number" }] }),
    ).toThrow(JsonSchemaConversionError);
  });

  it("treats an object schema with no properties as an unknown record", () => {
    const schema = jsonSchemaToZod({ type: "object" });
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ k: "v" })).toEqual({ k: "v" });
  });
});
