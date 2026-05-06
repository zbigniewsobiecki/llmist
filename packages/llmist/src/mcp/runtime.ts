/**
 * Runtime orchestration for MCP-attached agents. This file is dynamic-imported
 * by Agent.run() only when at least one MCP server is configured, so agents
 * that don't use MCP never load the SDK.
 *
 * @module mcp/runtime
 */

import type { ILogObj, Logger } from "tslog";
import { LLMMessageBuilder } from "../core/messages.js";
import type { GadgetRegistry } from "../gadgets/registry.js";
import type { PrefixConfig } from "../agent/agent.js";
import type { ConversationManager } from "../agent/conversation-manager.js";
import { McpClient } from "./client.js";
import { McpLifecycle } from "./lifecycle.js";
import { resolveToolNames, type ServerToolList } from "./multi-server.js";
import { mcpPromptToSkill, type McpPromptSkill } from "./prompt-adapter.js";
import { mcpToolToGadget } from "./tool-adapter.js";
import type { McpServerSpec } from "./types.js";

export interface SetupMcpServersOptions {
  specs: McpServerSpec[];
  registry: GadgetRegistry;
  conversation: ConversationManager;
  prefixConfig?: PrefixConfig;
  systemPrompt?: string;
  logger: Logger<ILogObj>;
  /** Receives discovered MCP prompts as skill-shaped artifacts for slash invocation. */
  onPromptDiscovered?: (skill: McpPromptSkill) => void;
}

/**
 * Setup MCP servers attached to an agent.
 *
 * - Connects each server in parallel.
 * - Lists tools and registers them as adapter gadgets in the agent's registry.
 * - Rebuilds the conversation's base (system + gadget catalog) messages so
 *   the LLM sees the full effective gadget set.
 *
 * Returns an `McpLifecycle` instance the caller must close at agent teardown.
 *
 * If a server fails to connect, the failure is logged and that server is
 * skipped — the agent continues with whatever servers connected
 * successfully. (Plan 2 will polish this with hook-driven error events.)
 */
export async function setupMcpServers(
  opts: SetupMcpServersOptions,
): Promise<McpLifecycle> {
  const { specs, registry, conversation, prefixConfig, systemPrompt, logger, onPromptDiscovered } = opts;

  const lifecycle = new McpLifecycle();
  lifecycle.installSignalHandlers();

  // Phase 1: connect every server in parallel, list its tools.
  type ConnectedServer = { client: McpClient; serverToolList: ServerToolList };
  const connected: ConnectedServer[] = [];

  await Promise.all(
    specs.map(async (spec) => {
      const client = new McpClient(spec);
      try {
        await client.connect();
      } catch (err) {
        logger.warn(
          `MCP server "${spec.name}" failed to connect — skipping. Reason: ${(err as Error).message}`,
        );
        return;
      }
      lifecycle.register(client);

      // Capability negotiation: only fetch tools if the server advertises them.
      const caps = client.serverCapabilities;
      const hasTools = caps?.tools !== undefined;

      let tools: import("./types.js").McpToolDescriptor[] = [];
      if (hasTools) {
        try {
          tools = await client.listTools();
        } catch (err) {
          logger.warn(
            `MCP server "${spec.name}" listTools failed — skipping. Reason: ${(err as Error).message}`,
          );
          return;
        }
      } else {
        logger.debug(
          `MCP server "${spec.name}" did not advertise tools capability — skipping listTools.`,
        );
      }

      // Surface unsupported-primitive warnings once.
      if (caps?.resources !== undefined) {
        logger.debug(
          `MCP server "${spec.name}" advertises 'resources' capability — not yet implemented in llmist (deferred to v1.5).`,
        );
      }

      // Discover prompts (capability-gated).
      if (caps?.prompts !== undefined && onPromptDiscovered) {
        try {
          const prompts = await client.listPrompts();
          for (const p of prompts) {
            onPromptDiscovered(mcpPromptToSkill(p, client));
          }
        } catch (err) {
          logger.debug(
            `MCP server "${spec.name}" listPrompts failed — skipping prompts. Reason: ${(err as Error).message}`,
          );
        }
      }

      connected.push({ client, serverToolList: { server: spec, tools } });
    }),
  );

  // Phase 2: resolve tool name conflicts, then register each as a gadget.
  const resolved = resolveToolNames(connected.map((c) => c.serverToolList));

  for (const r of resolved) {
    const cs = connected.find((c) => c.serverToolList.server.name === r.server.name);
    if (!cs) continue;
    for (const tool of r.tools) {
      const gadget = mcpToolToGadget(tool, cs.client, { prefix: r.prefix });
      try {
        registry.register(gadget.name ?? tool.name, gadget);
      } catch (err) {
        logger.warn(
          `MCP server "${r.server.name}" tool "${tool.name}" was not registered: ${(err as Error).message}`,
        );
      }
    }
  }

  // Rebuild conversation base messages so the system prompt's gadget catalog
  // includes the freshly-added MCP-backed gadgets.
  const builder = new LLMMessageBuilder();
  if (typeof systemPrompt === "string" && systemPrompt.length > 0) {
    builder.addSystem(systemPrompt);
  }
  builder.addGadgets(registry.getAll(), {
    startPrefix: prefixConfig?.gadgetStartPrefix,
    endPrefix: prefixConfig?.gadgetEndPrefix,
    argPrefix: prefixConfig?.gadgetArgPrefix,
  });
  conversation.replaceBaseMessages(builder.build());

  return lifecycle;
}
