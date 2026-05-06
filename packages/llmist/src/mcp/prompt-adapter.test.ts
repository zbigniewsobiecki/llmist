/**
 * Tests for the MCP prompt → llmist Skill adapter.
 *
 * MCP prompts are templates the server can render to a list of messages
 * given some arguments. We surface them as llmist Skills so they:
 * - Show up as `/<prompt-name>` slash invocations in the CLI
 * - Are loadable via the existing skill-loading meta-gadget
 * - Compose with the rest of the skills system
 */

import { describe, expect, it, vi } from "vitest";

import { mcpPromptToSkill } from "./prompt-adapter.js";
import type { McpPromptDescriptor } from "./types.js";

interface FakeClient {
  serverName: string;
  getPrompt: ReturnType<typeof vi.fn>;
}

function fakeClient(
  opts: {
    reply?: {
      description?: string;
      messages: Array<{ role: "user" | "assistant"; content: { type: string; text?: string } }>;
    };
    serverName?: string;
  } = {},
): FakeClient {
  return {
    serverName: opts.serverName ?? "fake",
    getPrompt: vi.fn(
      async () =>
        opts.reply ?? {
          description: "rendered",
          messages: [{ role: "user" as const, content: { type: "text", text: "hello" } }],
        },
    ),
  };
}

describe("mcpPromptToSkill", () => {
  it("maps prompt descriptor → skill metadata (name, description)", () => {
    const desc: McpPromptDescriptor = {
      name: "code-review",
      description: "Reviews code for bugs",
    };
    const skill = mcpPromptToSkill(desc, fakeClient() as never);
    expect(skill.name).toBe("code-review");
    expect(skill.description).toBe("Reviews code for bugs");
  });

  it("synthesizes a description when missing", () => {
    const desc: McpPromptDescriptor = { name: "raw" };
    const skill = mcpPromptToSkill(desc, fakeClient() as never);
    expect(skill.description).toMatch(/raw/i);
  });

  it("getInstructions calls client.getPrompt and joins text content", async () => {
    const client = fakeClient({
      reply: {
        messages: [
          { role: "user", content: { type: "text", text: "review this:" } },
          { role: "user", content: { type: "text", text: "<code>" } },
        ],
      },
    });
    const skill = mcpPromptToSkill({ name: "review" }, client as never);
    const instructions = await skill.getInstructions();
    expect(client.getPrompt).toHaveBeenCalledWith("review", {});
    expect(instructions).toContain("review this:");
    expect(instructions).toContain("<code>");
  });

  it("preserves prompt arguments on metadata", () => {
    const desc: McpPromptDescriptor = {
      name: "review",
      arguments: [
        { name: "language", description: "Programming language", required: true },
        { name: "style", description: "Style guide", required: false },
      ],
    };
    const skill = mcpPromptToSkill(desc, fakeClient() as never);
    expect(skill.metadata.arguments).toEqual([
      { name: "language", description: "Programming language", required: true },
      { name: "style", description: "Style guide", required: false },
    ]);
  });

  it("applies a name prefix when provided", () => {
    const skill = mcpPromptToSkill({ name: "review" }, fakeClient() as never, { prefix: "fs__" });
    expect(skill.name).toBe("fs__review");
  });

  it("invocable flags default to user-invocable + model-invocable", () => {
    const skill = mcpPromptToSkill({ name: "review" }, fakeClient() as never);
    expect(skill.isUserInvocable).toBe(true);
    expect(skill.isModelInvocable).toBe(true);
  });
});
