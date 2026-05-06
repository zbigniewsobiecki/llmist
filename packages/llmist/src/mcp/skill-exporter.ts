/**
 * Convert native llmist Skills into MCP prompt descriptors and render them
 * on behalf of an MCP server.
 *
 * Plan 3 maps:
 *  - Skill metadata.name → prompt name
 *  - Skill metadata.description → prompt description
 *  - argumentHint (when present) → a single optional `arguments` parameter
 *    (the existing skill-substitution machinery handles `$ARGUMENTS`, `$0`,
 *    `$1`, etc., from a single string)
 *  - Skill body, after argument substitution, becomes a single user-role
 *    text message in the prompt response
 *
 * @module mcp/skill-exporter
 */

import type { Skill } from "../skills/skill.js";
import type { McpPromptArgument, McpPromptDescriptor, McpPromptResult } from "./types.js";

export function skillToMcpPrompt(skill: Skill): McpPromptDescriptor {
  const description =
    skill.description && skill.description.length > 0
      ? skill.description
      : `Native llmist skill "${skill.name}"`;

  const args: McpPromptArgument[] = [];
  if (skill.metadata.argumentHint) {
    args.push({
      name: "arguments",
      description: skill.metadata.argumentHint,
      required: false,
    });
  }

  return {
    name: skill.name,
    description,
    ...(args.length > 0 ? { arguments: args } : {}),
  };
}

/**
 * Render a skill's body as a single MCP prompt message after argument
 * substitution.
 *
 * `args.arguments` is a string interpreted by the existing skill activation
 * pipeline ($ARGUMENTS, $0, $1, ...). We don't try to map MCP's per-argument
 * named parameters into the existing positional substitution model — the
 * skill author already chose the substitution shape.
 */
export async function renderSkillForMcpPrompt(
  skill: Skill,
  args: Record<string, unknown>,
): Promise<McpPromptResult> {
  const argString =
    typeof args.arguments === "string"
      ? args.arguments
      : Object.values(args)
          .filter((v) => typeof v === "string")
          .join(" ");

  const activation = await skill.activate({
    arguments: argString || undefined,
  });

  return {
    description: skill.description,
    messages: [
      {
        role: "user",
        content: { type: "text", text: activation.resolvedInstructions },
      },
    ],
  };
}
