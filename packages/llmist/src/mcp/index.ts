/**
 * Model Context Protocol (MCP) integration for llmist.
 *
 * Plan 1 — foundation: stdio consumer with allowlist security baseline.
 * Plan 2 — adds Streamable HTTP, multi-server, prompts, error isolation.
 * Plan 3 — adds the `llmist mcp serve` exposer.
 *
 * @module mcp
 */

export {
  assertCommandAllowed,
  DEFAULT_MCP_COMMAND_ALLOWLIST,
} from "./allowlist.js";
export { McpClient, type McpClientOptions } from "./client.js";
export {
  JsonSchemaConversionError,
  McpConnectError,
  McpError,
  McpToolCallError,
  McpUntrustedCommandError,
} from "./errors.js";
export {
  gadgetResultToMcpContent,
  gadgetToMcpTool,
  runGadgetForMcp,
} from "./gadget-exporter.js";
export { type JSONSchemaLike, jsonSchemaToZod } from "./json-schema-to-zod.js";
export { McpLifecycle } from "./lifecycle.js";
export {
  type CreateMcpServerOptions,
  createMcpServer,
  type McpServerHandle,
} from "./server.js";
export { renderSkillForMcpPrompt, skillToMcpPrompt } from "./skill-exporter.js";
export { type McpToolAdapterOptions, mcpToolToGadget } from "./tool-adapter.js";
export type {
  HttpMcpServerSpec,
  McpContentBlock,
  McpPromptArgument,
  McpPromptDescriptor,
  McpPromptMessage,
  McpPromptResult,
  McpServerCapabilities,
  McpServerSpec,
  McpToolDescriptor,
  McpToolResult,
  StdioMcpServerSpec,
} from "./types.js";
