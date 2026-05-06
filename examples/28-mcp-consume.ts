/**
 * Example 28: Consume an MCP server from an llmist agent
 *
 * Connects to the public Filesystem MCP server (spawned via npx) and lets
 * the agent use its tools (`list_directory`, `read_file`, etc.) alongside
 * any native gadgets. This is the consume side of llmist's bidirectional
 * MCP support shipped in spec 001 / plan 1 (foundation).
 *
 * Prereqs:
 *   - Node.js >= 22
 *   - One of: OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY in env
 *   - npx (in default allowlist; no opt-in needed)
 *   - A directory the server can read, by default /tmp
 *
 * Run:
 *   npx tsx examples/28-mcp-consume.ts
 *
 * Try other servers:
 *   - Replace the command/args with any stdio MCP server you have installed.
 *   - For non-allowlisted commands, set `trust: true` on the spec.
 */

import { LLMist } from "llmist";

const targetDir = process.env.MCP_FS_TARGET ?? "/tmp";

const answer = await LLMist.createAgent()
  .withModel("sonnet")
  .withMcpServer({
    name: "filesystem",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", targetDir],
  })
  .askAndCollect(
    `List the files in ${targetDir} using the filesystem tools. Tell me how many files there are and the first three names.`,
  );

console.log("\n--- Answer ---\n");
console.log(answer);
