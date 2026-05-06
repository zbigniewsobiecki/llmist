/**
 * Tests for the McpClient wrapper.
 *
 * Uses the SDK's InMemoryTransport linked-pair to drive a real Server
 * implementation in-process — this exercises the JSON-RPC handshake and
 * tool dispatch without spawning a child process.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import { McpClient } from "./client.js";
import { McpUntrustedCommandError } from "./errors.js";

interface FakeServerOpts {
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>;
  call?: (
    name: string,
    args: unknown,
  ) => { content: Array<{ type: string; text?: string }>; isError?: boolean };
}

async function startFakeServer(
  opts: FakeServerOpts,
): Promise<{ clientTransport: InMemoryTransport; close: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new Server(
    { name: "fake-server", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema ?? { type: "object", properties: {} },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (opts.call) {
      return opts.call(req.params.name, req.params.arguments);
    }
    return {
      content: [{ type: "text", text: `called ${req.params.name}` }],
    };
  });
  await server.connect(serverTransport);
  return {
    clientTransport,
    close: async () => {
      await server.close();
    },
  };
}

describe("McpClient", () => {
  it("connect + listTools returns advertised tools", async () => {
    const { clientTransport, close } = await startFakeServer({
      tools: [
        { name: "echo", description: "echoes the input" },
        { name: "ping" },
      ],
    });

    const client = new McpClient(
      { name: "test", transport: "stdio", command: "node" },
      { transport: clientTransport },
    );
    await client.connect();
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["echo", "ping"]);
    expect(tools[0]?.description).toBe("echoes the input");
    await client.close();
    await close();
  });

  it("callTool returns content blocks", async () => {
    const { clientTransport, close } = await startFakeServer({
      tools: [{ name: "greet" }],
      call: (name, args) => ({
        content: [
          {
            type: "text",
            text: `hello ${(args as { name?: string })?.name ?? "world"}`,
          },
        ],
      }),
    });

    const client = new McpClient(
      { name: "test", transport: "stdio", command: "node" },
      { transport: clientTransport },
    );
    await client.connect();
    const res = await client.callTool("greet", { name: "Zbigniew" });
    expect(res.isError).not.toBe(true);
    expect(res.content).toEqual([{ type: "text", text: "hello Zbigniew" }]);
    await client.close();
    await close();
  });

  it("callTool with isError=true response surfaces the error result", async () => {
    const { clientTransport, close } = await startFakeServer({
      tools: [{ name: "boom" }],
      call: () => ({
        content: [{ type: "text", text: "failed" }],
        isError: true,
      }),
    });

    const client = new McpClient(
      { name: "test", transport: "stdio", command: "node" },
      { transport: clientTransport },
    );
    await client.connect();
    const res = await client.callTool("boom", {});
    expect(res.isError).toBe(true);
    expect(res.content[0]).toEqual({ type: "text", text: "failed" });
    await client.close();
    await close();
  });

  it("close is idempotent", async () => {
    const { clientTransport, close } = await startFakeServer({ tools: [] });
    const client = new McpClient(
      { name: "test", transport: "stdio", command: "node" },
      { transport: clientTransport },
    );
    await client.connect();
    await client.close();
    await client.close(); // should not throw
    await close();
  });

  it("connect rejects with McpUntrustedCommandError when command not allowlisted and trust=false", async () => {
    // No injected transport, so the production path runs and the allowlist
    // gate fires before any spawn.
    const client = new McpClient({
      name: "danger",
      transport: "stdio",
      command: "rm",
    });
    await expect(client.connect()).rejects.toThrow(McpUntrustedCommandError);
  });

  it("serverCapabilities is exposed after initialize", async () => {
    const { clientTransport, close } = await startFakeServer({ tools: [] });
    const client = new McpClient(
      { name: "test", transport: "stdio", command: "node" },
      { transport: clientTransport },
    );
    await client.connect();
    expect(client.serverCapabilities).not.toBeNull();
    expect(client.serverCapabilities?.tools).toBeDefined();
    await client.close();
    await close();
  });

  it("listTools throws if called before connect", async () => {
    const client = new McpClient({
      name: "test",
      transport: "stdio",
      command: "node",
    });
    await expect(client.listTools()).rejects.toThrow();
  });
});
