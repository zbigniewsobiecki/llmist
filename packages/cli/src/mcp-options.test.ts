/**
 * Tests for CLI parsing of `--mcp-server` and `--mcp-trust` flags.
 */

import { describe, expect, it } from "vitest";

import { parseMcpServerFlags } from "./mcp-options.js";

describe("parseMcpServerFlags", () => {
  it("returns an empty array when no flags are present", () => {
    expect(parseMcpServerFlags([], [])).toEqual([]);
  });

  it("parses a single name=command flag", () => {
    const specs = parseMcpServerFlags(["fs=node"], []);
    expect(specs).toEqual([{ name: "fs", transport: "stdio", command: "node", args: [] }]);
  });

  it("supports multiple --mcp-server flags accumulating", () => {
    const specs = parseMcpServerFlags(["fs=node", "py=python3"], []);
    expect(specs.map((s) => s.name)).toEqual(["fs", "py"]);
    expect(specs.map((s) => s.command)).toEqual(["node", "python3"]);
  });

  it("supports embedded args within a single value via the '--' delimiter form", () => {
    const specs = parseMcpServerFlags(
      ["fs=npx -- -y @modelcontextprotocol/server-filesystem /tmp"],
      [],
    );
    expect(specs).toEqual([
      {
        name: "fs",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      },
    ]);
  });

  it("rejects malformed values (no '=')", () => {
    expect(() => parseMcpServerFlags(["nofield"], [])).toThrow(/format/i);
  });

  it("rejects empty command", () => {
    expect(() => parseMcpServerFlags(["fs="], [])).toThrow(/command/i);
  });

  it("rejects duplicate server names", () => {
    expect(() => parseMcpServerFlags(["fs=node", "fs=python"], [])).toThrow(/duplicate/i);
  });

  it("applies --mcp-trust to the matching server", () => {
    const specs = parseMcpServerFlags(["fs=node"], ["fs"]);
    expect(specs[0]?.trust).toBe(true);
  });

  it("--mcp-trust for an unknown name is a no-op (warns at the call site)", () => {
    const specs = parseMcpServerFlags(["fs=node"], ["nonexistent"]);
    expect(specs[0]?.trust).not.toBe(true);
  });

  it("trim whitespace around name and command", () => {
    const specs = parseMcpServerFlags(["  fs  =  node  "], []);
    expect(specs[0]).toEqual({
      name: "fs",
      transport: "stdio",
      command: "node",
      args: [],
    });
  });
});
