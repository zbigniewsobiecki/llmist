/**
 * Typed errors raised by the MCP integration.
 *
 * These wrap underlying SDK and transport errors so the rest of llmist can
 * react to MCP failures with stable, narrow types instead of catching the
 * SDK's internal error classes.
 *
 * @module mcp/errors
 */

export class McpError extends Error {
  readonly serverName?: string;

  constructor(message: string, serverName?: string) {
    super(message);
    this.name = "McpError";
    this.serverName = serverName;
  }
}

export class McpUntrustedCommandError extends McpError {
  readonly command: string;

  constructor(command: string, serverName?: string) {
    super(
      `Refusing to spawn MCP stdio command "${command}" because its basename ` +
        `is not in the default allowlist. To opt in, set { trust: true } on the ` +
        `server spec (library), or trust = true in your TOML mcp.servers block, ` +
        `or pass --mcp-trust ${serverName ?? "<name>"} on the CLI. ` +
        `See https://llmist.dev/library/advanced/mcp-security/ for context ` +
        `(CVE-2026-30623).`,
      serverName,
    );
    this.name = "McpUntrustedCommandError";
    this.command = command;
  }
}

export class McpConnectError extends McpError {
  readonly cause?: unknown;

  constructor(message: string, opts?: { serverName?: string; cause?: unknown }) {
    super(message, opts?.serverName);
    this.name = "McpConnectError";
    this.cause = opts?.cause;
  }
}

export class McpToolCallError extends McpError {
  readonly toolName: string;
  readonly cause?: unknown;

  constructor(toolName: string, message: string, opts?: { serverName?: string; cause?: unknown }) {
    super(message, opts?.serverName);
    this.name = "McpToolCallError";
    this.toolName = toolName;
    this.cause = opts?.cause;
  }
}

export class McpTimeoutError extends McpError {
  readonly operation: string;
  readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number, serverName?: string) {
    super(
      `MCP operation "${operation}" on server "${serverName ?? "<unknown>"}" timed out after ${timeoutMs}ms`,
      serverName,
    );
    this.name = "McpTimeoutError";
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

export class JsonSchemaConversionError extends Error {
  readonly schemaFragment: unknown;
  readonly reason: string;

  constructor(reason: string, schemaFragment: unknown) {
    super(`JSON Schema → Zod conversion failed: ${reason}`);
    this.name = "JsonSchemaConversionError";
    this.reason = reason;
    this.schemaFragment = schemaFragment;
  }
}
