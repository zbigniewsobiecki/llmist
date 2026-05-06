/**
 * Example 29: Expose llmist gadgets as an MCP server (programmatic)
 *
 * Wraps a small calculator gadget into an MCP stdio server. Any MCP client
 * (Claude Code, Cursor, ChatGPT desktop, OpenAI Agents SDK, Cline) can be
 * pointed at this script and it'll discover and call the gadget.
 *
 * Run as a one-shot:
 *   npx tsx examples/29-mcp-expose.ts
 * (Pipes empty stdout if not connected to an MCP client. Use `npx
 * @modelcontextprotocol/inspector tsx examples/29-mcp-expose.ts` to
 * interact via the official Inspector UI.)
 *
 * To wire into Claude Code's `~/.claude.json`:
 *   {
 *     "mcpServers": {
 *       "llmist-calc": {
 *         "command": "npx",
 *         "args": ["tsx", "/abs/path/to/examples/29-mcp-expose.ts"]
 *       }
 *     }
 *   }
 *
 * The CLI variant ships as `llmist mcp serve --gadgets <spec>`.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createGadget, createMcpServer, GadgetRegistry, z } from "llmist";

const calc = createGadget({
  name: "Calculator",
  description: "Adds two numbers",
  schema: z.object({
    a: z.number().describe("first number"),
    b: z.number().describe("second number"),
  }),
  execute: ({ a, b }) => String(a + b),
});

const registry = new GadgetRegistry();
registry.registerByClass(calc);

const handle = createMcpServer({ gadgets: registry });

const transport = new StdioServerTransport();
await handle.connect(transport);

const stop = async () => {
  await handle.stop();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.stdin.on("end", stop);
