/**
 * Tests for the `llmist mcp import-claude-code` parser/emitter.
 *
 * Reads the user's `~/.claude.json` (or `$CLAUDE_CONFIG_HOME` override),
 * extracts MCP server entries, and emits TOML blocks for the llmist config.
 */

import { describe, expect, it } from "vitest";

import {
  claudeCodeJsonToTomlBlocks,
  parseClaudeCodeMcp,
} from "./import-claude-code.js";

describe("parseClaudeCodeMcp", () => {
  it("extracts mcpServers from a top-level claude.json object", () => {
    const raw = {
      mcpServers: {
        fs: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        },
        api: {
          type: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer xyz" },
        },
      },
    };
    const result = parseClaudeCodeMcp(raw);
    expect(result.servers).toHaveLength(2);
    expect(result.warnings).toEqual([]);
    const fs = result.servers.find((s) => s.name === "fs")!;
    const api = result.servers.find((s) => s.name === "api")!;
    expect(fs.spec.transport).toBe("stdio");
    expect((fs.spec as { command: string }).command).toBe("npx");
    expect(api.spec.transport).toBe("http");
    expect((api.spec as { url: string }).url).toBe("https://example.com/mcp");
  });

  it("returns warnings for unsupported entries", () => {
    const raw = {
      mcpServers: {
        weird: { type: "websocket", url: "ws://x" },
      },
    };
    const result = parseClaudeCodeMcp(raw);
    expect(result.servers).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/weird/);
  });

  it("handles per-project mcpServers nested under projects", () => {
    const raw = {
      projects: {
        "/path/to/project": {
          mcpServers: {
            git: { command: "uvx", args: ["mcp-server-git"] },
          },
        },
      },
    };
    const result = parseClaudeCodeMcp(raw);
    expect(result.servers.find((s) => s.name === "git")).toBeDefined();
  });

  it("returns empty when no mcpServers anywhere", () => {
    expect(parseClaudeCodeMcp({})).toEqual({ servers: [], warnings: [] });
  });

  it("ignores explicit type='stdio' (the default)", () => {
    const raw = {
      mcpServers: {
        fs: { type: "stdio", command: "node" },
      },
    };
    const result = parseClaudeCodeMcp(raw);
    expect(result.servers[0]?.spec.transport).toBe("stdio");
  });

  it("preserves env on stdio entries", () => {
    const raw = {
      mcpServers: {
        fs: { command: "node", env: { TZ: "UTC" } },
      },
    };
    const result = parseClaudeCodeMcp(raw);
    expect((result.servers[0]?.spec as { env?: Record<string, string> }).env).toEqual({
      TZ: "UTC",
    });
  });
});

describe("claudeCodeJsonToTomlBlocks", () => {
  it("emits a stdio block with multi-line args formatting", () => {
    const blocks = claudeCodeJsonToTomlBlocks([
      {
        name: "fs",
        spec: {
          name: "fs",
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        },
      },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("[mcp.servers.fs]");
    expect(blocks[0]).toContain('transport = "stdio"');
    expect(blocks[0]).toContain('command = "npx"');
    expect(blocks[0]).toMatch(/args = \[/);
    expect(blocks[0]).toContain('"@modelcontextprotocol/server-filesystem"');
  });

  it("emits an http block with headers", () => {
    const blocks = claudeCodeJsonToTomlBlocks([
      {
        name: "api",
        spec: {
          name: "api",
          transport: "http",
          url: "https://example.com",
          headers: { Authorization: "Bearer xyz" },
        },
      },
    ]);
    expect(blocks[0]).toContain("[mcp.servers.api]");
    expect(blocks[0]).toContain('transport = "http"');
    expect(blocks[0]).toContain('url = "https://example.com"');
    expect(blocks[0]).toMatch(/\[mcp\.servers\.api\.headers\]/);
    expect(blocks[0]).toContain('Authorization = "Bearer xyz"');
  });

  it("escapes quotes in TOML strings", () => {
    const blocks = claudeCodeJsonToTomlBlocks([
      {
        name: "weird",
        spec: {
          name: "weird",
          transport: "stdio",
          command: 'echo "hi"',
        },
      },
    ]);
    expect(blocks[0]).toContain('command = "echo \\"hi\\""');
  });
});
