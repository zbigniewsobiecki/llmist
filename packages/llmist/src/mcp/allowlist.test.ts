/**
 * Tests for the MCP STDIO command allowlist that mitigates the CVE-2026-30623
 * family of stdio-spawn RCE vulnerabilities.
 */

import { describe, expect, it } from "vitest";
import {
  assertCommandAllowed,
  DEFAULT_MCP_COMMAND_ALLOWLIST,
} from "./allowlist.js";
import { McpUntrustedCommandError } from "./errors.js";

describe("DEFAULT_MCP_COMMAND_ALLOWLIST", () => {
  it("contains the expected runtimes", () => {
    expect(DEFAULT_MCP_COMMAND_ALLOWLIST.has("npx")).toBe(true);
    expect(DEFAULT_MCP_COMMAND_ALLOWLIST.has("node")).toBe(true);
    expect(DEFAULT_MCP_COMMAND_ALLOWLIST.has("uvx")).toBe(true);
    expect(DEFAULT_MCP_COMMAND_ALLOWLIST.has("python")).toBe(true);
    expect(DEFAULT_MCP_COMMAND_ALLOWLIST.has("python3")).toBe(true);
    expect(DEFAULT_MCP_COMMAND_ALLOWLIST.has("deno")).toBe(true);
    expect(DEFAULT_MCP_COMMAND_ALLOWLIST.has("bun")).toBe(true);
  });
});

describe("assertCommandAllowed", () => {
  it("accepts an allowlisted bare command", () => {
    expect(() => assertCommandAllowed("npx", false)).not.toThrow();
  });

  it("accepts an allowlisted command via absolute path (basename match)", () => {
    expect(() =>
      assertCommandAllowed("/usr/local/bin/node", false),
    ).not.toThrow();
  });

  it("rejects a non-allowlisted command without trust", () => {
    expect(() => assertCommandAllowed("curl", false)).toThrow(
      McpUntrustedCommandError,
    );
  });

  it("accepts a non-allowlisted command when trust=true", () => {
    expect(() => assertCommandAllowed("curl", true)).not.toThrow();
  });

  it("rejects a command that contains whitespace (must split args separately)", () => {
    expect(() => assertCommandAllowed("npx -y something", false)).toThrow(
      McpUntrustedCommandError,
    );
  });

  it("rejects shell metacharacters", () => {
    expect(() => assertCommandAllowed("npx;rm -rf /", false)).toThrow(
      McpUntrustedCommandError,
    );
    expect(() => assertCommandAllowed("npx|cat", false)).toThrow(
      McpUntrustedCommandError,
    );
    expect(() => assertCommandAllowed("npx&node", false)).toThrow(
      McpUntrustedCommandError,
    );
  });

  it("error message includes the command and the opt-in instructions", () => {
    try {
      assertCommandAllowed("badbin", false);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(McpUntrustedCommandError);
      const msg = (e as Error).message;
      expect(msg).toContain("badbin");
      expect(msg).toMatch(/trust: true|trust = true|--mcp-trust/);
    }
  });

  it("respects a custom allowlist when provided", () => {
    const custom = new Set(["mybin"]);
    expect(() => assertCommandAllowed("mybin", false, custom)).not.toThrow();
    expect(() => assertCommandAllowed("npx", false, custom)).toThrow(
      McpUntrustedCommandError,
    );
  });

  it("rejects empty command", () => {
    expect(() => assertCommandAllowed("", false)).toThrow(
      McpUntrustedCommandError,
    );
  });
});
