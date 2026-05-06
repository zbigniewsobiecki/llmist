/**
 * Public types for the MCP integration.
 *
 * @module mcp/types
 */

/**
 * User-supplied spec describing an MCP server to consume.
 */
export type McpServerSpec = StdioMcpServerSpec | HttpMcpServerSpec;

export interface StdioMcpServerSpec {
  /** Stable server name used for namespacing tools and surfacing in logs. */
  name: string;
  /** Stdio transport — server is spawned as a child process. */
  transport: "stdio";
  /** Executable to spawn. The basename is checked against the allowlist unless trust=true. */
  command: string;
  /** Arguments to pass to the executable. */
  args?: string[];
  /** Optional environment overrides for the spawned child process. */
  env?: Record<string, string>;
  /** Skip the allowlist check for this server. Default false. */
  trust?: boolean;
  /** Per-call timeout in milliseconds for tools/call. Default: no timeout. */
  timeoutMs?: number;
}

export interface HttpMcpServerSpec {
  /** Stable server name. */
  name: string;
  /** Streamable HTTP transport (the modern, non-deprecated remote transport). */
  transport: "http";
  /** Server URL (must include scheme — http:// or https://). */
  url: string;
  /** Optional fixed headers (e.g. Authorization, X-API-Key). */
  headers?: Record<string, string>;
  /** Per-call timeout in milliseconds for tools/call. Default: no timeout. */
  timeoutMs?: number;
}

/**
 * Minimal subset of an MCP tool descriptor that this integration cares about.
 */
export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/**
 * Canonical MCP content block shape used by the SDK.
 *
 * The SDK uses larger union types; this is the subset the adapter handles.
 */
export type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | { type: string; [k: string]: unknown };

/**
 * Result shape returned from a tools/call.
 */
export interface McpToolResult {
  content: McpContentBlock[];
  isError?: boolean;
}

export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptDescriptor {
  name: string;
  description?: string;
  arguments?: McpPromptArgument[];
}

export interface McpPromptMessage {
  role: "user" | "assistant";
  content: McpContentBlock;
}

export interface McpPromptResult {
  description?: string;
  messages: McpPromptMessage[];
}

/**
 * Server capabilities advertised on initialize. Only the fields used by plan 1
 * are typed; richer capabilities arrive in plan 2.
 */
export interface McpServerCapabilities {
  tools?: { listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  resources?: { listChanged?: boolean; subscribe?: boolean };
  // Other capabilities are tolerated as unknown shape.
  [k: string]: unknown;
}
