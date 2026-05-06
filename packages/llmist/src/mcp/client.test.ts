/**
 * Tests for the McpClient wrapper.
 *
 * Uses the SDK's InMemoryTransport linked-pair to drive a real Server
 * implementation in-process — this exercises the JSON-RPC handshake and
 * tool dispatch without spawning a child process.
 */

import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import { McpClient } from "./client.js";
import { McpTimeoutError, McpToolCallError, McpUntrustedCommandError } from "./errors.js";

interface FakeServerOpts {
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>;
  call?: (
    name: string,
    args: unknown,
  ) =>
    | { content: Array<{ type: string; text?: string }>; isError?: boolean }
    | Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>;
  listTools?: () =>
    | {
        tools: Array<{
          name: string;
          description?: string;
          inputSchema?: Record<string, unknown>;
        }>;
      }
    | Promise<{
        tools: Array<{
          name: string;
          description?: string;
          inputSchema?: Record<string, unknown>;
        }>;
      }>;
  listPrompts?: () =>
    | { prompts: Array<{ name: string; description?: string }> }
    | Promise<{ prompts: Array<{ name: string; description?: string }> }>;
  getPrompt?: (name: string) =>
    | { messages: Array<{ role: "user" | "assistant"; content: { type: string; text: string } }> }
    | Promise<{
        messages: Array<{ role: "user" | "assistant"; content: { type: string; text: string } }>;
      }>;
}

async function startFakeServer(
  opts: FakeServerOpts,
): Promise<{ clientTransport: InMemoryTransport; close: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new Server(
    { name: "fake-server", version: "0.0.1" },
    { capabilities: { tools: {}, ...(opts.listPrompts || opts.getPrompt ? { prompts: {} } : {}) } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (opts.listTools) {
      return opts.listTools();
    }
    return {
      tools: opts.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema ?? { type: "object", properties: {} },
      })),
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (opts.call) {
      return opts.call(req.params.name, req.params.arguments);
    }
    return {
      content: [{ type: "text", text: `called ${req.params.name}` }],
    };
  });
  const listPrompts = opts.listPrompts;
  if (listPrompts) {
    server.setRequestHandler(ListPromptsRequestSchema, async () => listPrompts());
  }
  const getPrompt = opts.getPrompt;
  if (getPrompt) {
    server.setRequestHandler(GetPromptRequestSchema, async (req) => getPrompt(req.params.name));
  }
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
      tools: [{ name: "echo", description: "echoes the input" }, { name: "ping" }],
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
      call: (_name, args) => ({
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

  it("listTools rejects with McpTimeoutError when the server never responds", async () => {
    const { clientTransport, close } = await startFakeServer({
      tools: [],
      listTools: () => new Promise(() => {}),
    });

    const client = new McpClient(
      { name: "test", transport: "stdio", command: "node", timeoutMs: 10 },
      { transport: clientTransport },
    );
    await client.connect();
    await expect(client.listTools()).rejects.toThrow(McpTimeoutError);
    await client.close();
    await close();
  });

  it("callTool wraps timeout failures as McpToolCallError", async () => {
    const { clientTransport, close } = await startFakeServer({
      tools: [{ name: "slow" }],
      call: () => new Promise(() => {}),
    });

    const client = new McpClient(
      { name: "test", transport: "stdio", command: "node", timeoutMs: 10 },
      { transport: clientTransport },
    );
    await client.connect();

    try {
      await client.callTool("slow", {});
      throw new Error("Expected callTool to time out");
    } catch (err) {
      expect(err).toBeInstanceOf(McpToolCallError);
      expect((err as McpToolCallError).cause).toBeInstanceOf(McpTimeoutError);
    }

    await client.close();
    await close();
  });

  it("listPrompts and getPrompt honor timeoutMs", async () => {
    const { clientTransport, close } = await startFakeServer({
      tools: [],
      listPrompts: () => new Promise(() => {}),
      getPrompt: () => new Promise(() => {}),
    });

    const client = new McpClient(
      { name: "test", transport: "stdio", command: "node", timeoutMs: 10 },
      { transport: clientTransport },
    );
    await client.connect();
    await expect(client.listPrompts()).rejects.toThrow(McpTimeoutError);

    try {
      await client.getPrompt("slow");
      throw new Error("Expected getPrompt to time out");
    } catch (err) {
      expect(err).toBeInstanceOf(McpToolCallError);
      expect((err as McpToolCallError).cause).toBeInstanceOf(McpTimeoutError);
    }

    await client.close();
    await close();
  });

  it("keeps the client usable after a timed-out operation", async () => {
    let listToolsCalls = 0;
    const { clientTransport, close } = await startFakeServer({
      tools: [],
      listTools: () => {
        listToolsCalls += 1;
        if (listToolsCalls === 1) {
          return new Promise(() => {});
        }
        return { tools: [{ name: "echo", inputSchema: { type: "object", properties: {} } }] };
      },
    });

    const client = new McpClient(
      { name: "test", transport: "stdio", command: "node", timeoutMs: 10 },
      { transport: clientTransport },
    );
    await client.connect();
    await expect(client.listTools()).rejects.toThrow(McpTimeoutError);
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["echo"]);
    await client.close();
    await close();
  });

  it("timeoutMs=0 disables MCP operation timeouts", async () => {
    const { clientTransport, close } = await startFakeServer({
      tools: [{ name: "slow" }],
      call: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { content: [{ type: "text", text: "eventual result" }] };
      },
    });

    const client = new McpClient(
      { name: "test", transport: "stdio", command: "node", timeoutMs: 0 },
      { transport: clientTransport },
    );
    await client.connect();
    const res = await client.callTool("slow", {});
    expect(res.content).toEqual([{ type: "text", text: "eventual result" }]);
    await client.close();
    await close();
  });
});
