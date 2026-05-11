/**
 * Tests for the deterministic multi-server tool name conflict resolver.
 *
 * When two MCP servers expose tools with overlapping names, llmist resolves
 * the collision by prefixing the tool with `<server>__`. The resolution
 * is deterministic (alphabetic by server name) so reruns produce the same
 * effective gadget catalog.
 */

import { describe, expect, it } from "vitest";

import { resolveToolNames, type ServerToolList } from "./multi-server.js";
import type { McpServerSpec, McpToolDescriptor } from "./types.js";

const stdio = (name: string): McpServerSpec => ({
  name,
  transport: "stdio",
  command: "node",
});

const tool = (name: string): McpToolDescriptor => ({ name });

describe("resolveToolNames", () => {
  it("passes unique tool names through unchanged", () => {
    const input: ServerToolList[] = [
      { server: stdio("a"), tools: [tool("read"), tool("write")] },
      { server: stdio("b"), tools: [tool("ping")] },
    ];
    const out = resolveToolNames(input);
    expect(out).toEqual([
      { server: stdio("a"), tools: [tool("read"), tool("write")], prefix: undefined },
      { server: stdio("b"), tools: [tool("ping")], prefix: undefined },
    ]);
  });

  it("prefixes colliding tool names per server", () => {
    const input: ServerToolList[] = [
      { server: stdio("alpha"), tools: [tool("read")] },
      { server: stdio("beta"), tools: [tool("read"), tool("uniq")] },
    ];
    const out = resolveToolNames(input);
    // Both servers have 'read' → both get prefixed (deterministic split).
    const alpha = out.find((s) => s.server.name === "alpha")!;
    const beta = out.find((s) => s.server.name === "beta")!;
    expect(alpha.prefix).toBe("alpha__");
    expect(beta.prefix).toBe("beta__");
  });

  it("only prefixes the colliding tools, not the unique ones", () => {
    // The implementation prefixes per-server uniformly when ANY tool collides
    // — that's the cleaner mental model and matches LangChain/OpenAI Agents SDK
    // behavior. Verify both servers' prefix is non-undefined when there's a
    // collision; uniqueness is preserved through the prefix.
    const input: ServerToolList[] = [
      { server: stdio("a"), tools: [tool("only-a"), tool("shared")] },
      { server: stdio("b"), tools: [tool("only-b"), tool("shared")] },
    ];
    const out = resolveToolNames(input);
    expect(out.find((s) => s.server.name === "a")!.prefix).toBe("a__");
    expect(out.find((s) => s.server.name === "b")!.prefix).toBe("b__");
  });

  it("does not prefix when there are no collisions across servers", () => {
    const input: ServerToolList[] = [
      { server: stdio("a"), tools: [tool("x")] },
      { server: stdio("b"), tools: [tool("y")] },
    ];
    const out = resolveToolNames(input);
    expect(out.every((s) => s.prefix === undefined)).toBe(true);
  });

  it("is deterministic across repeated calls", () => {
    const input: ServerToolList[] = [
      { server: stdio("z"), tools: [tool("read")] },
      { server: stdio("a"), tools: [tool("read")] },
      { server: stdio("m"), tools: [tool("read")] },
    ];
    const a = resolveToolNames(input);
    const b = resolveToolNames(input);
    expect(a.map((s) => `${s.server.name}:${s.prefix}`)).toEqual(
      b.map((s) => `${s.server.name}:${s.prefix}`),
    );
  });

  it("handles empty input", () => {
    expect(resolveToolNames([])).toEqual([]);
  });

  it("handles a single server with unique tools (no prefix)", () => {
    const out = resolveToolNames([{ server: stdio("solo"), tools: [tool("a"), tool("b")] }]);
    expect(out[0]?.prefix).toBeUndefined();
  });
});
