/**
 * Integration tests for the CLI's --mcp-server / --mcp-trust flag → AgentBuilder
 * wiring.
 *
 * Verifies the flags produce the right specs and that they reach the
 * AgentBuilder. End-to-end agent-loop tests with real MCP servers live in
 * the e2e directory.
 */

import { AgentBuilder, type McpServerSpec } from "llmist";
import { describe, expect, it } from "vitest";
import { parseMcpServerFlags } from "./mcp-options.js";

describe("CLI --mcp-server → builder integration", () => {
  it("parsed specs flow into AgentBuilder.withMcpServer", () => {
    const specs = parseMcpServerFlags(["fs=npx -- -y server-filesystem /tmp"], []);
    const builder = new AgentBuilder().withModel("openai:gpt-5-nano");
    for (const s of specs) {
      builder.withMcpServer(s);
    }
    const stored = builder.getMcpServerSpecs();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      name: "fs",
      transport: "stdio",
      command: "npx",
      args: ["-y", "server-filesystem", "/tmp"],
    });
  });

  it("trust flag propagates", () => {
    const specs = parseMcpServerFlags(["fs=node"], ["fs"]);
    const builder = new AgentBuilder().withModel("openai:gpt-5-nano");
    specs.forEach((s) => builder.withMcpServer(s));
    expect(builder.getMcpServerSpecs()[0]?.trust).toBe(true);
  });

  it("multiple --mcp-server flags accumulate in order", () => {
    const specs: McpServerSpec[] = parseMcpServerFlags(["a=node", "b=python3"], []);
    const builder = new AgentBuilder().withModel("openai:gpt-5-nano");
    specs.forEach((s) => builder.withMcpServer(s));
    expect(builder.getMcpServerSpecs().map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("no --mcp-server flags leaves builder empty", () => {
    const specs = parseMcpServerFlags([], []);
    const builder = new AgentBuilder().withModel("openai:gpt-5-nano");
    specs.forEach((s) => builder.withMcpServer(s));
    expect(builder.getMcpServerSpecs()).toEqual([]);
  });
});
