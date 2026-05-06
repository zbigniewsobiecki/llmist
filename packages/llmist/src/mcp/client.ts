/**
 * Wraps the official MCP SDK's stdio Client into a small, llmist-flavored
 * surface. Encapsulates the SDK so the rest of llmist depends on the typed
 * shapes in `./types.ts` rather than vendor types.
 *
 * Lazy-imports the SDK so agents that don't use MCP pay zero overhead at
 * load time.
 *
 * @module mcp/client
 */

import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { assertCommandAllowed } from "./allowlist.js";
import { McpConnectError, McpTimeoutError, McpToolCallError } from "./errors.js";
import type {
  McpPromptDescriptor,
  McpPromptResult,
  McpServerCapabilities,
  McpServerSpec,
  McpToolDescriptor,
  McpToolResult,
} from "./types.js";

interface SdkClientLike {
  connect(transport: Transport): Promise<void>;
  close(): Promise<void>;
  listTools(): Promise<{ tools: McpToolDescriptor[] }>;
  callTool(params: { name: string; arguments?: unknown }): Promise<{
    content: unknown[];
    isError?: boolean;
  }>;
  listPrompts?(): Promise<{ prompts: McpPromptDescriptor[] }>;
  getPrompt?(params: { name: string; arguments?: Record<string, unknown> }): Promise<{
    description?: string;
    messages: Array<{ role: "user" | "assistant"; content: unknown }>;
  }>;
  getServerCapabilities(): McpServerCapabilities | undefined;
}

let cachedSdk: Promise<{
  Client: new (
    info: { name: string; version: string },
    opts?: { capabilities?: object },
  ) => SdkClientLike;
  StdioClientTransport: new (params: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }) => Transport & { pid: number | null };
  StreamableHTTPClientTransport: new (
    url: URL,
    opts?: { requestInit?: { headers?: Record<string, string> } },
  ) => Transport;
}> | null = null;

async function loadSdk() {
  if (!cachedSdk) {
    cachedSdk = (async () => {
      const [client, stdio, http] = await Promise.all([
        import("@modelcontextprotocol/sdk/client/index.js"),
        import("@modelcontextprotocol/sdk/client/stdio.js"),
        import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
      ]);
      return {
        Client: client.Client as unknown as new (
          info: { name: string; version: string },
          opts?: { capabilities?: object },
        ) => SdkClientLike,
        StdioClientTransport: stdio.StdioClientTransport,
        StreamableHTTPClientTransport: http.StreamableHTTPClientTransport as unknown as new (
          url: URL,
          opts?: { requestInit?: { headers?: Record<string, string> } },
        ) => Transport,
      };
    })();
  }
  return cachedSdk;
}

export interface McpClientOptions {
  /**
   * Inject a pre-built transport for testing. When omitted, the client
   * builds a stdio transport from the spec at connect() time.
   */
  transport?: Transport;
  /**
   * Override the client identity sent during initialize.
   */
  clientInfo?: { name: string; version: string };
}

const DEFAULT_CLIENT_INFO = { name: "llmist", version: "0.0.0" };

export class McpClient {
  private sdkClient: SdkClientLike | null = null;
  private spawnedPid: number | null = null;
  private closed = false;
  private readonly injectedTransport?: Transport;
  private readonly clientInfo: { name: string; version: string };

  constructor(
    readonly spec: McpServerSpec,
    opts?: McpClientOptions,
  ) {
    this.injectedTransport = opts?.transport;
    this.clientInfo = opts?.clientInfo ?? DEFAULT_CLIENT_INFO;
  }

  get serverName(): string {
    return this.spec.name;
  }

  get pid(): number | null {
    return this.spawnedPid;
  }

  get serverCapabilities(): McpServerCapabilities | null {
    if (!this.sdkClient) return null;
    return this.sdkClient.getServerCapabilities() ?? null;
  }

  async connect(): Promise<void> {
    if (this.sdkClient) return;

    let transport: Transport;
    if (this.injectedTransport) {
      transport = this.injectedTransport;
    } else if (this.spec.transport === "stdio") {
      // Production stdio path — spawn a child process via the SDK's stdio
      // transport, gated by the allowlist.
      assertCommandAllowed(this.spec.command, this.spec.trust === true);
      const { StdioClientTransport } = await loadSdk();
      const stdioTransport = new StdioClientTransport({
        command: this.spec.command,
        args: this.spec.args,
        env: this.spec.env,
      });
      transport = stdioTransport;
      this.spawnedPid = null; // populated after start
    } else {
      // Streamable HTTP path — no allowlist gating (no process spawn).
      const { StreamableHTTPClientTransport } = await loadSdk();
      let url: URL;
      try {
        url = new URL(this.spec.url);
      } catch (err) {
        throw new McpConnectError(
          `MCP server "${this.spec.name}" has an invalid URL: ${(err as Error).message}`,
          { serverName: this.spec.name, cause: err },
        );
      }
      transport = new StreamableHTTPClientTransport(url, {
        requestInit: this.spec.headers ? { headers: this.spec.headers } : undefined,
      });
    }

    const { Client } = await loadSdk();
    const client = new Client(this.clientInfo, { capabilities: {} });

    try {
      await this.withTimeout(() => client.connect(transport), "connect");
    } catch (err) {
      throw new McpConnectError(
        `Failed to connect to MCP server "${this.spec.name}": ${(err as Error).message}`,
        { serverName: this.spec.name, cause: err },
      );
    }

    this.sdkClient = client;

    // Capture pid if the production stdio transport exposed one.
    const maybePid = (transport as { pid?: number | null }).pid;
    if (typeof maybePid === "number") {
      this.spawnedPid = maybePid;
    }
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const client = this.requireClient();
    const res = await this.withTimeout(() => client.listTools(), "tools/list");
    return res.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  async callTool(name: string, args: unknown): Promise<McpToolResult> {
    const client = this.requireClient();
    try {
      const res = await this.withTimeout(
        () =>
          client.callTool({
            name,
            arguments: (args as Record<string, unknown> | undefined) ?? {},
          }),
        `tools/call ${name}`,
      );
      return {
        content: (res.content as McpToolResult["content"]) ?? [],
        isError: res.isError,
      };
    } catch (err) {
      throw new McpToolCallError(
        name,
        `MCP tool call "${name}" on server "${this.spec.name}" failed: ${(err as Error).message}`,
        { serverName: this.spec.name, cause: err },
      );
    }
  }

  async listPrompts(): Promise<McpPromptDescriptor[]> {
    const client = this.requireClient();
    if (!client.listPrompts) {
      return [];
    }
    const listPrompts = client.listPrompts.bind(client);
    const res = await this.withTimeout(() => listPrompts(), "prompts/list");
    return res.prompts.map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    }));
  }

  async getPrompt(name: string, args?: Record<string, unknown>): Promise<McpPromptResult> {
    const client = this.requireClient();
    if (!client.getPrompt) {
      throw new McpToolCallError(name, "Server has no getPrompt method", {
        serverName: this.spec.name,
      });
    }
    const getPrompt = client.getPrompt.bind(client);
    try {
      const res = await this.withTimeout(
        () => getPrompt({ name, arguments: args ?? {} }),
        `prompts/get ${name}`,
      );
      return {
        description: res.description,
        messages: res.messages.map((m) => ({
          role: m.role,
          content: m.content as McpPromptResult["messages"][number]["content"],
        })),
      };
    } catch (err) {
      throw new McpToolCallError(
        name,
        `MCP prompts/get "${name}" on server "${this.spec.name}" failed: ${(err as Error).message}`,
        { serverName: this.spec.name, cause: err },
      );
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.sdkClient) {
      try {
        await this.sdkClient.close();
      } catch {
        // Closing on a teardown path must not throw.
      }
      this.sdkClient = null;
    }
  }

  private requireClient(): SdkClientLike {
    if (!this.sdkClient) {
      throw new McpConnectError(
        `MCP client for server "${this.spec.name}" is not connected. Call connect() first.`,
        { serverName: this.spec.name },
      );
    }
    return this.sdkClient;
  }

  private async withTimeout<T>(fn: () => Promise<T>, operation: string): Promise<T> {
    const timeoutMs = this.spec.timeoutMs;
    if (timeoutMs === undefined || timeoutMs <= 0) {
      return fn();
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new McpTimeoutError(operation, timeoutMs, this.spec.name));
      }, timeoutMs);

      fn()
        .then((result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          reject(err);
        });
    });
  }
}
