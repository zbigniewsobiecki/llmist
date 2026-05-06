/**
 * Tests for translating TOML `[mcp.servers.<name>]` blocks into McpServerSpec.
 */

import { describe, expect, it } from "vitest";

import {
  mcpServersTomlToSpecs,
  validateMcpServersConfig,
} from "./mcp-toml.js";

describe("validateMcpServersConfig", () => {
  it("accepts a valid stdio block", () => {
    const errors = validateMcpServersConfig({
      servers: {
        fs: {
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        },
      },
    });
    expect(errors).toEqual([]);
  });

  it("accepts a valid http block", () => {
    const errors = validateMcpServersConfig({
      servers: {
        api: {
          transport: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer xyz" },
        },
      },
    });
    expect(errors).toEqual([]);
  });

  it("rejects a block missing transport", () => {
    const errors = validateMcpServersConfig({
      servers: { fs: { command: "node" } as never },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/transport/i);
  });

  it("rejects a stdio block missing command", () => {
    const errors = validateMcpServersConfig({
      servers: { fs: { transport: "stdio" } as never },
    });
    expect(errors[0]).toMatch(/command/i);
  });

  it("rejects an http block missing url", () => {
    const errors = validateMcpServersConfig({
      servers: { api: { transport: "http" } as never },
    });
    expect(errors[0]).toMatch(/url/i);
  });

  it("rejects an unknown transport value", () => {
    const errors = validateMcpServersConfig({
      servers: { x: { transport: "websocket" as never, url: "ws://x" } as never },
    });
    expect(errors[0]).toMatch(/transport/i);
  });

  it("warns when no servers are configured (returns empty errors)", () => {
    expect(validateMcpServersConfig({})).toEqual([]);
    expect(validateMcpServersConfig({ servers: {} })).toEqual([]);
  });
});

describe("mcpServersTomlToSpecs", () => {
  it("converts stdio + http blocks into McpServerSpec values", () => {
    const specs = mcpServersTomlToSpecs({
      servers: {
        fs: {
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
          trust: true,
        },
        api: {
          transport: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer xyz" },
        },
      },
    });
    expect(specs).toHaveLength(2);
    const fs = specs.find((s) => s.name === "fs")!;
    const api = specs.find((s) => s.name === "api")!;
    expect(fs.transport).toBe("stdio");
    expect((fs as { command: string }).command).toBe("npx");
    expect((fs as { trust?: boolean }).trust).toBe(true);
    expect(api.transport).toBe("http");
    expect((api as { url: string }).url).toBe("https://example.com/mcp");
  });

  it("skips disabled servers", () => {
    const specs = mcpServersTomlToSpecs({
      servers: {
        fs: { transport: "stdio", command: "node", enabled: false },
      },
    });
    expect(specs).toEqual([]);
  });

  it("preserves timeout-ms as timeoutMs", () => {
    const specs = mcpServersTomlToSpecs({
      servers: {
        fs: { transport: "stdio", command: "node", "timeout-ms": 30000 },
      },
    });
    expect((specs[0] as { timeoutMs?: number }).timeoutMs).toBe(30000);
  });

  it("returns empty when no servers section", () => {
    expect(mcpServersTomlToSpecs(undefined)).toEqual([]);
    expect(mcpServersTomlToSpecs({})).toEqual([]);
  });
});
