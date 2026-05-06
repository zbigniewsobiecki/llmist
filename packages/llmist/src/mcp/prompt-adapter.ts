/**
 * Adapter that wraps an MCP prompt descriptor as an llmist Skill-shaped
 * artifact, so MCP prompts compose with the existing skill subsystem
 * (slash invocation, skill registry, load-skill meta-gadget).
 *
 * The shape returned mirrors the public surface of `Skill` that llmist
 * consumers use (name, description, getInstructions, invocable flags),
 * plus a `mcpArguments` field for MCP-specific argument metadata.
 *
 * @module mcp/prompt-adapter
 */

import type { McpClient } from "./client.js";
import type { McpContentBlock, McpPromptArgument, McpPromptDescriptor } from "./types.js";

export interface McpPromptSkillOptions {
  /** Prefix prepended to the skill name. Used for multi-server name conflict resolution. */
  prefix?: string;
}

export interface McpPromptSkillMetadata {
  name: string;
  description: string;
  arguments?: McpPromptArgument[];
}

export class McpPromptSkill {
  readonly name: string;
  readonly description: string;
  readonly metadata: McpPromptSkillMetadata;
  readonly isUserInvocable: boolean = true;
  readonly isModelInvocable: boolean = true;

  private readonly client: McpClient;
  private readonly mcpToolName: string;

  constructor(
    descriptor: McpPromptDescriptor,
    client: McpClient,
    opts?: McpPromptSkillOptions,
  ) {
    const prefix = opts?.prefix ?? "";
    this.name = prefix + descriptor.name;
    this.description =
      descriptor.description ??
      `MCP prompt "${descriptor.name}" from server "${client.serverName}"`;
    this.metadata = {
      name: this.name,
      description: this.description,
      ...(descriptor.arguments ? { arguments: descriptor.arguments } : {}),
    };
    this.client = client;
    this.mcpToolName = descriptor.name;
  }

  /**
   * Render the prompt by calling the MCP server's prompts/get with the
   * supplied arguments and joining the resulting message text.
   */
  async getInstructions(args?: Record<string, unknown>): Promise<string> {
    const result = await this.client.getPrompt(this.mcpToolName, args ?? {});
    const parts: string[] = [];
    for (const m of result.messages) {
      const c = m.content as McpContentBlock;
      if (c.type === "text" && typeof (c as { text?: unknown }).text === "string") {
        parts.push((c as { text: string }).text);
      } else {
        try {
          parts.push(JSON.stringify(c));
        } catch {
          parts.push(String(c));
        }
      }
    }
    return parts.join("\n");
  }
}

export function mcpPromptToSkill(
  descriptor: McpPromptDescriptor,
  client: McpClient,
  opts?: McpPromptSkillOptions,
): McpPromptSkill {
  return new McpPromptSkill(descriptor, client, opts);
}
