/**
 * Wrap the MCP SDK's Server class with llmist semantics: register native
 * gadgets as MCP tools and (optionally) llmist skills as MCP prompts.
 *
 * Lazy-imports the SDK so callers that don't expose anything pay no cost.
 *
 * @module mcp/server
 */

import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { GadgetRegistry } from "../gadgets/registry.js";
import type { SkillRegistry } from "../skills/registry.js";
import { gadgetToMcpTool, runGadgetForMcp } from "./gadget-exporter.js";
import { renderSkillForMcpPrompt, skillToMcpPrompt } from "./skill-exporter.js";

export interface CreateMcpServerOptions {
  gadgets: GadgetRegistry;
  skills?: SkillRegistry;
  /** Override the protocol version advertised. Defaults to 2025-06-18. */
  protocolVersion?: string;
  /** Server identity sent on initialize. */
  serverInfo?: { name: string; version: string };
}

export interface McpServerHandle {
  /** Connect the server to a Transport (stdio, in-memory test transport, etc.). */
  connect(transport: Transport): Promise<void>;
  /** Close the underlying server cleanly. Idempotent. */
  stop(): Promise<void>;
  /** True between connect() and stop(). */
  readonly running: boolean;
}

const DEFAULT_SERVER_INFO = { name: "llmist", version: "0.0.0" };

export function createMcpServer(opts: CreateMcpServerOptions): McpServerHandle {
  const { gadgets, skills } = opts;

  const hasTools = gadgets.getAll().length > 0;
  const hasPrompts = !!skills && skills.size > 0;

  const capabilities: Record<string, unknown> = {};
  if (hasTools) capabilities.tools = {};
  if (hasPrompts) capabilities.prompts = {};

  let sdkServer: {
    connect(t: Transport): Promise<void>;
    close(): Promise<void>;
    setRequestHandler<T>(schema: T, handler: unknown): void;
  } | null = null;
  let running = false;

  async function ensureServer(): Promise<typeof sdkServer & object> {
    if (sdkServer) return sdkServer;
    const [serverMod, typesMod] = await Promise.all([
      import("@modelcontextprotocol/sdk/server/index.js"),
      import("@modelcontextprotocol/sdk/types.js"),
    ]);
    const ServerClass = serverMod.Server as unknown as new (
      info: { name: string; version: string },
      options: { capabilities: Record<string, unknown> },
    ) => {
      connect(t: Transport): Promise<void>;
      close(): Promise<void>;
      setRequestHandler<T>(schema: T, handler: unknown): void;
    };
    const server = new ServerClass(opts.serverInfo ?? DEFAULT_SERVER_INFO, {
      capabilities,
    });

    if (hasTools) {
      server.setRequestHandler(typesMod.ListToolsRequestSchema, async () => ({
        tools: gadgets.getAll().map(gadgetToMcpTool),
      }));
      server.setRequestHandler(
        typesMod.CallToolRequestSchema,
        async (req: { params: { name: string; arguments?: unknown } }) => {
          const gadget = gadgets.get(req.params.name);
          if (!gadget) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `Unknown tool "${req.params.name}". Call tools/list first.`,
                },
              ],
            };
          }
          return runGadgetForMcp(gadget, req.params.arguments ?? {});
        },
      );
    }

    if (hasPrompts && skills) {
      server.setRequestHandler(typesMod.ListPromptsRequestSchema, async () => ({
        prompts: Array.from(skills.getAll()).map(skillToMcpPrompt),
      }));
      server.setRequestHandler(
        typesMod.GetPromptRequestSchema,
        async (req: { params: { name: string; arguments?: Record<string, unknown> } }) => {
          const skill = skills.get(req.params.name);
          if (!skill) {
            throw new Error(`Unknown prompt "${req.params.name}"`);
          }
          const result = await renderSkillForMcpPrompt(skill, req.params.arguments ?? {});
          return result;
        },
      );
    }

    sdkServer = server;
    return server;
  }

  return {
    get running() {
      return running;
    },
    async connect(transport: Transport) {
      const server = await ensureServer();
      await server.connect(transport);
      running = true;
    },
    async stop() {
      if (!sdkServer) return;
      try {
        await sdkServer.close();
      } catch {
        // teardown must not throw
      }
      sdkServer = null;
      running = false;
    },
  };
}
