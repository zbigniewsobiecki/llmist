/**
 * Tests for the native gadget → MCP tool exporter.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createGadget } from "../gadgets/create-gadget.js";
import { schemaToJSONSchema } from "../gadgets/schema-to-json.js";
import {
  gadgetResultToMcpContent,
  gadgetToMcpTool,
  runGadgetForMcp,
} from "./gadget-exporter.js";

describe("gadgetToMcpTool", () => {
  it("exports a Zod-schema gadget — name, description, inputSchema match", () => {
    const calc = createGadget({
      name: "Calculator",
      description: "Adds two numbers",
      schema: z.object({
        a: z.number().describe("first"),
        b: z.number().describe("second"),
      }),
      execute: ({ a, b }) => String(a + b),
    });
    const tool = gadgetToMcpTool(calc);
    expect(tool.name).toBe("Calculator");
    expect(tool.description).toBe("Adds two numbers");
    expect(tool.inputSchema).toEqual(
      schemaToJSONSchema(z.object({ a: z.number().describe("first"), b: z.number().describe("second") })),
    );
  });

  it("emits an empty object inputSchema when the gadget has no parameter schema", () => {
    const ping = createGadget({
      name: "Ping",
      description: "no args",
      schema: z.object({}),
      execute: () => "pong",
    });
    const tool = gadgetToMcpTool(ping);
    expect(tool.inputSchema).toBeDefined();
    expect((tool.inputSchema as { type?: string }).type).toBe("object");
  });

  it("synthesizes a description when the gadget lacks one", () => {
    const noDesc = createGadget({
      name: "Bare",
      description: "",
      schema: z.object({}),
      execute: () => "ok",
    });
    const tool = gadgetToMcpTool(noDesc);
    expect(typeof tool.description).toBe("string");
    expect(tool.description.length).toBeGreaterThan(0);
  });
});

describe("gadgetResultToMcpContent", () => {
  it("string result → single text content block", () => {
    const blocks = gadgetResultToMcpContent("hello");
    expect(blocks).toEqual([{ type: "text", text: "hello" }]);
  });

  it("object with result and media → text + image blocks", () => {
    const blocks = gadgetResultToMcpContent({
      result: "captured",
      media: [
        { kind: "image", data: "AAAA", mimeType: "image/png" },
      ],
    });
    expect(blocks).toContainEqual({ type: "text", text: "captured" });
    expect(blocks).toContainEqual({
      type: "image",
      data: "AAAA",
      mimeType: "image/png",
    });
  });

  it("non-string non-media value is JSON-stringified", () => {
    const blocks = gadgetResultToMcpContent({ foo: 1 } as never);
    expect(blocks[0]).toEqual({ type: "text", text: '{"foo":1}' });
  });
});

describe("runGadgetForMcp", () => {
  it("returns content blocks from a successful gadget execution", async () => {
    const greet = createGadget({
      name: "Greet",
      description: "greets",
      schema: z.object({ name: z.string() }),
      execute: ({ name }) => `hello ${name}`,
    });
    const res = await runGadgetForMcp(greet, { name: "world" });
    expect(res.isError).toBeFalsy();
    expect(res.content).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("returns isError=true when the gadget throws", async () => {
    const boom = createGadget({
      name: "Boom",
      description: "always fails",
      schema: z.object({}),
      execute: () => {
        throw new Error("kaboom");
      },
    });
    const res = await runGadgetForMcp(boom, {});
    expect(res.isError).toBe(true);
    expect(res.content[0]).toMatchObject({ type: "text" });
    expect((res.content[0] as { text: string }).text).toContain("kaboom");
  });

  it("returns isError=true when params fail Zod validation", async () => {
    const strict = createGadget({
      name: "Strict",
      description: "needs n",
      schema: z.object({ n: z.number() }),
      execute: ({ n }) => String(n * 2),
    });
    const res = await runGadgetForMcp(strict, { n: "not a number" });
    expect(res.isError).toBe(true);
  });
});
