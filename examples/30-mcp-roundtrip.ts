/**
 * Example 30: Roundtrip — llmist consumes its own published MCP server
 *
 * Spawns example 29 (the exposer) as a stdio subprocess, then runs an
 * llmist agent that consumes it via withMcpServer. Demonstrates the full
 * loop:
 *   llmist agent ──(mcp client)──▶ stdio ──▶ llmist mcp serve ──▶ Calculator gadget
 *
 * Run:
 *   npx tsx examples/30-mcp-roundtrip.ts
 *
 * Requires one of OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { LLMist } from "llmist";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exposerScript = path.join(__dirname, "29-mcp-expose.ts");

const answer = await LLMist.createAgent()
  .withModel("sonnet")
  .withMcpServer({
    name: "llmist-calc",
    transport: "stdio",
    command: "npx",
    args: ["tsx", exposerScript],
  })
  .askAndCollect("Use the Calculator tool to add 17 and 25, then tell me the result.");

console.log("\n--- Answer ---\n");
console.log(answer);
