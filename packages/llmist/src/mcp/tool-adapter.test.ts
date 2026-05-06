/**
 * Tests for the MCP tool → native gadget adapter.
 *
 * Each MCP tool descriptor (name, description, JSON Schema input, content
 * blocks output) is wrapped as a native createGadget instance so the existing
 * gadget executor consumes it without knowing about MCP.
 */

import { describe, expect, it, vi } from "vitest";

import { mcpToolToGadget } from "./tool-adapter.js";
import type { McpToolDescriptor, McpToolResult } from "./types.js";

interface FakeClient {
  callTool: ReturnType<typeof vi.fn>;
  readonly serverName: string;
}

function fakeClient(opts: {
  reply?: McpToolResult;
  serverName?: string;
}): FakeClient {
  return {
    serverName: opts.serverName ?? "fake",
    callTool: vi.fn(async (_name: string, _args: unknown) => {
      return (
        opts.reply ?? { content: [{ type: "text", text: "ok" }], isError: false }
      );
    }),
  };
}

describe("mcpToolToGadget", () => {
  it("wraps an MCP tool with name, description, and Zod-validated schema", () => {
    const tool: McpToolDescriptor = {
      name: "read_file",
      description: "reads a file",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    };
    const gadget = mcpToolToGadget(tool, fakeClient({}) as never);
    expect(gadget.name).toBe("read_file");
    expect(gadget.description).toBe("reads a file");
    expect(gadget.parameterSchema).toBeDefined();
    expect(gadget.parameterSchema?.safeParse({ path: "/etc/hosts" }).success).toBe(
      true,
    );
    expect(gadget.parameterSchema?.safeParse({}).success).toBe(false);
  });

  it("executes by delegating to client.callTool with the original tool name", async () => {
    const client = fakeClient({});
    const tool: McpToolDescriptor = {
      name: "echo",
      inputSchema: { type: "object", properties: { msg: { type: "string" } } },
    };
    const gadget = mcpToolToGadget(tool, client as never);
    await gadget.execute({ msg: "hi" } as never);
    expect(client.callTool).toHaveBeenCalledWith("echo", { msg: "hi" });
  });

  it("joins multiple text content blocks with newlines", async () => {
    const client = fakeClient({
      reply: {
        content: [
          { type: "text", text: "line 1" },
          { type: "text", text: "line 2" },
        ],
      },
    });
    const tool: McpToolDescriptor = { name: "t" };
    const gadget = mcpToolToGadget(tool, client as never);
    const result = await gadget.execute({} as never);
    expect(typeof result === "string" ? result : (result as { result?: string }).result).toBe(
      "line 1\nline 2",
    );
  });

  it("converts isError=true into a thrown gadget error", async () => {
    const client = fakeClient({
      reply: {
        content: [{ type: "text", text: "boom" }],
        isError: true,
      },
    });
    const tool: McpToolDescriptor = { name: "t" };
    const gadget = mcpToolToGadget(tool, client as never);
    await expect(gadget.execute({} as never)).rejects.toThrow(/boom/);
  });

  it("converts an image content block into a media output", async () => {
    const fakeBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGP4DwQACfsD/Z8eLjkAAAAASUVORK5CYII=";
    const client = fakeClient({
      reply: {
        content: [
          { type: "image", data: fakeBase64, mimeType: "image/png" },
          { type: "text", text: "captured" },
        ],
      },
    });
    const tool: McpToolDescriptor = { name: "screenshot" };
    const gadget = mcpToolToGadget(tool, client as never);
    const result = await gadget.execute({} as never);
    expect(typeof result).toBe("object");
    const r = result as { result: string; media?: Array<{ kind: string; mimeType: string }> };
    expect(r.result).toContain("captured");
    expect(r.media).toBeDefined();
    expect(r.media?.[0]?.kind).toBe("image");
    expect(r.media?.[0]?.mimeType).toBe("image/png");
  });

  it("handles tools with no inputSchema as zero-arg", () => {
    const tool: McpToolDescriptor = { name: "ping" };
    const gadget = mcpToolToGadget(tool, fakeClient({}) as never);
    expect(gadget.parameterSchema?.safeParse({}).success).toBe(true);
  });

  it("applies a name prefix when provided", () => {
    const tool: McpToolDescriptor = {
      name: "read_file",
      inputSchema: { type: "object" },
    };
    const gadget = mcpToolToGadget(tool, fakeClient({}) as never, {
      prefix: "fs__",
    });
    expect(gadget.name).toBe("fs__read_file");
  });

  it("passes through unknown content kinds as JSON-stringified text", async () => {
    const client = fakeClient({
      reply: {
        content: [
          { type: "text", text: "main" },
          { type: "weird", payload: { foo: 1 } } as never,
        ],
      },
    });
    const tool: McpToolDescriptor = { name: "t" };
    const gadget = mcpToolToGadget(tool, client as never);
    const result = await gadget.execute({} as never);
    const text = typeof result === "string" ? result : (result as { result: string }).result;
    expect(text).toContain("main");
    expect(text).toContain('"weird"');
  });
});
