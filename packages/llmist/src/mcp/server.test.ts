/**
 * Tests for the McpServer wrapper that exposes native llmist gadgets and
 * skills as MCP tools and prompts.
 *
 * Uses the SDK's InMemoryTransport linked-pair so we drive a real Client
 * against the server, exercising the full JSON-RPC handshake.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createGadget } from "../gadgets/create-gadget.js";
import { GadgetRegistry } from "../gadgets/registry.js";
import { SkillRegistry } from "../skills/registry.js";
import { Skill } from "../skills/skill.js";
import { createMcpServer } from "./server.js";

function buildGadgetRegistry(): GadgetRegistry {
  const calc = createGadget({
    name: "Calculator",
    description: "Adds two numbers",
    schema: z.object({
      a: z.number().describe("first"),
      b: z.number().describe("second"),
    }),
    execute: ({ a, b }) => String(a + b),
  });
  const reg = new GadgetRegistry();
  reg.registerByClass(calc);
  return reg;
}

function buildSkillRegistry(): SkillRegistry {
  const reg = new SkillRegistry();
  reg.register(
    new Skill({
      metadata: {
        name: "explain",
        description: "Explain in plain language",
      },
      instructions: "Explain the topic in plain language.",
      resources: [],
      sourcePath: "/fixture/SKILL.md",
      sourceDir: "/fixture",
      source: { type: "directory", path: "/fixture" },
    }),
  );
  return reg;
}

async function startServerAndClient(opts: {
  gadgets?: GadgetRegistry;
  skills?: SkillRegistry;
}): Promise<{
  client: Client;
  stop: () => Promise<void>;
}> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const handle = createMcpServer({
    gadgets: opts.gadgets ?? new GadgetRegistry(),
    skills: opts.skills,
  });
  await handle.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    stop: async () => {
      await client.close();
      await handle.stop();
    },
  };
}

describe("McpServer", () => {
  it("advertises tools capability when gadgets are present", async () => {
    const { client, stop } = await startServerAndClient({
      gadgets: buildGadgetRegistry(),
    });
    const caps = client.getServerCapabilities();
    expect(caps?.tools).toBeDefined();
    expect(caps?.prompts).toBeUndefined();
    await stop();
  });

  it("advertises prompts capability when skills are present", async () => {
    const { client, stop } = await startServerAndClient({
      gadgets: buildGadgetRegistry(),
      skills: buildSkillRegistry(),
    });
    const caps = client.getServerCapabilities();
    expect(caps?.tools).toBeDefined();
    expect(caps?.prompts).toBeDefined();
    await stop();
  });

  it("tools/list returns the registered gadgets", async () => {
    const { client, stop } = await startServerAndClient({
      gadgets: buildGadgetRegistry(),
    });
    const result = await client.listTools();
    expect(result.tools.map((t) => t.name)).toEqual(["Calculator"]);
    await stop();
  });

  it("tools/call invokes the gadget and returns the content", async () => {
    const { client, stop } = await startServerAndClient({
      gadgets: buildGadgetRegistry(),
    });
    const result = await client.callTool({
      name: "Calculator",
      arguments: { a: 2, b: 3 },
    });
    expect(result.isError).toBeFalsy();
    expect((result.content as Array<{ type: string; text?: string }>)[0]?.text).toBe("5");
    await stop();
  });

  it("tools/call returns isError=true on schema violation", async () => {
    const { client, stop } = await startServerAndClient({
      gadgets: buildGadgetRegistry(),
    });
    const result = await client.callTool({
      name: "Calculator",
      arguments: { a: "not a number", b: 3 },
    });
    expect(result.isError).toBe(true);
    await stop();
  });

  it("prompts/list returns the registered skills (when skills provided)", async () => {
    const { client, stop } = await startServerAndClient({
      gadgets: buildGadgetRegistry(),
      skills: buildSkillRegistry(),
    });
    const result = await client.listPrompts();
    expect(result.prompts.map((p) => p.name)).toEqual(["explain"]);
    await stop();
  });

  it("prompts/get renders the skill body as a user-role message", async () => {
    const { client, stop } = await startServerAndClient({
      gadgets: buildGadgetRegistry(),
      skills: buildSkillRegistry(),
    });
    const result = await client.getPrompt({ name: "explain" });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.role).toBe("user");
    expect((result.messages[0]?.content as { type: "text"; text: string }).text).toContain(
      "plain language",
    );
    await stop();
  });

  it("stop() closes cleanly", async () => {
    const { stop } = await startServerAndClient({
      gadgets: buildGadgetRegistry(),
    });
    await expect(stop()).resolves.toBeUndefined();
  });
});
