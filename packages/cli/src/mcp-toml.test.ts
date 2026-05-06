/**
 * Tests for translating TOML `[mcp.servers.<name>]` blocks into McpServerSpec.
 */

import { describe, expect, it } from "vitest";

import { ConfigError } from "./config.js";
import { mcpServersTomlToSpecs, validateMcpServersConfig } from "./mcp-toml.js";

describe("validateMcpServersConfig", () => {
  it("accepts a valid stdio block", () => {
    const config = validateMcpServersConfig({
      servers: {
        fs: {
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        },
      },
    });
    expect(config.servers?.fs?.transport).toBe("stdio");
  });

  it("accepts a valid http block", () => {
    const config = validateMcpServersConfig({
      servers: {
        api: {
          transport: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer xyz" },
        },
      },
    });
    expect(config.servers?.api?.transport).toBe("http");
  });

  it("rejects a block missing transport", () => {
    expect(() =>
      validateMcpServersConfig({
        servers: { fs: { command: "node" } },
      }),
    ).toThrow(ConfigError);
    expect(() =>
      validateMcpServersConfig({
        servers: { fs: { command: "node" } },
      }),
    ).toThrow("[mcp.servers.fs].transport must be a string");
  });

  it("rejects a stdio block missing command", () => {
    expect(() =>
      validateMcpServersConfig({
        servers: { fs: { transport: "stdio" } },
      }),
    ).toThrow("[mcp.servers.fs].command must be a string");
  });

  it("rejects an http block missing url", () => {
    expect(() =>
      validateMcpServersConfig({
        servers: { api: { transport: "http" } },
      }),
    ).toThrow("[mcp.servers.api].url must be a string");
  });

  it("rejects an unknown transport value", () => {
    expect(() =>
      validateMcpServersConfig({
        servers: { x: { transport: "websocket", url: "ws://x" } },
      }),
    ).toThrow(/transport must be one of/);
  });

  it("accepts when no servers are configured", () => {
    expect(validateMcpServersConfig({})).toEqual({});
    expect(validateMcpServersConfig({ servers: {} })).toEqual({ servers: {} });
  });

  it("rejects bad timeout, args, env, headers, booleans, and unknown keys", () => {
    expect(() =>
      validateMcpServersConfig({
        servers: { fs: { transport: "stdio", command: "node", "timeout-ms": -1 } },
      }),
    ).toThrow("[mcp.servers.fs].timeout-ms must be >= 0");
    expect(() =>
      validateMcpServersConfig({
        servers: { fs: { transport: "stdio", command: "node", args: ["ok", 1] } },
      }),
    ).toThrow("[mcp.servers.fs].args[1] must be a string");
    expect(() =>
      validateMcpServersConfig({
        servers: { fs: { transport: "stdio", command: "node", env: { TOKEN: 123 } } },
      }),
    ).toThrow("[mcp.servers.fs].env.TOKEN must be a string");
    expect(() =>
      validateMcpServersConfig({
        servers: { api: { transport: "http", url: "https://x", headers: { Auth: 123 } } },
      }),
    ).toThrow("[mcp.servers.api].headers.Auth must be a string");
    expect(() =>
      validateMcpServersConfig({
        servers: { fs: { transport: "stdio", command: "node", trust: "yes" } },
      }),
    ).toThrow("[mcp.servers.fs].trust must be a boolean");
    expect(() =>
      validateMcpServersConfig({
        servers: { fs: { transport: "stdio", command: "node", extra: true } },
      }),
    ).toThrow("[mcp.servers.fs].extra is not a valid option");
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
    const fs = specs.find((s) => s.name === "fs");
    const api = specs.find((s) => s.name === "api");
    expect(fs?.transport).toBe("stdio");
    expect((fs as { command: string } | undefined)?.command).toBe("npx");
    expect((fs as { trust?: boolean } | undefined)?.trust).toBe(true);
    expect(api?.transport).toBe("http");
    expect((api as { url: string } | undefined)?.url).toBe("https://example.com/mcp");
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
