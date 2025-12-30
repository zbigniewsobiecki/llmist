#!/usr/bin/env npx tsx
/**
 * Raw SDK reproduction script - sends exact request from llmist log.
 *
 * This script reads the exact messages from /tmp/llmist.develop.log.jsonl
 * and sends them directly via OpenAI SDK, bypassing llmist entirely.
 *
 * Usage:
 *   npx tsx scripts/repro-raw-sdk.ts [provider]
 *
 * Providers:
 *   openai  - Use OpenAI API (default, uses model from log)
 *   gemini  - Use Google AI Studio with gemini-2.0-flash-lite
 *
 * Environment variables:
 *   OPENAI_API_KEY   - Required for openai provider
 *   GEMINI_API_KEY   - Required for gemini provider
 */

import * as fs from "fs";
import OpenAI from "openai";

const provider = process.argv[2] || "openai";

// Read the exact messages from the log file
// biome-ignore lint/suspicious/noExplicitAny: Debug script parsing log files
function extractMessagesFromLog(): { messages: any[]; model: string } | null {
  const logPath = "/tmp/llmist.develop.log.jsonl";

  if (!fs.existsSync(logPath)) {
    console.error(`❌ Log file not found: ${logPath}`);
    return null;
  }

  const lines = fs.readFileSync(logPath, "utf8").split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj["0"] === "LLM request details" && obj["1"]?.messages) {
        return {
          messages: obj["1"].messages,
          model: obj["1"].model?.replace(/^openai:/, "") || "gpt-4o",
        };
      }
    } catch {}
  }

  return null;
}

const logData = extractMessagesFromLog();
if (!logData) {
  console.error("❌ Could not extract messages from log file");
  process.exit(1);
}

// Configure client based on provider
let client: OpenAI;
let model: string;

if (provider === "gemini") {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ GEMINI_API_KEY environment variable is required");
    process.exit(1);
  }
  client = new OpenAI({
    apiKey,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  });
  model = "gemini-2.0-flash-lite";
} else {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("❌ OPENAI_API_KEY environment variable is required");
    process.exit(1);
  }
  client = new OpenAI({ apiKey });
  model = logData.model;
}

console.log(`\n🧪 Testing with provider: ${provider}, model: ${model}\n`);
console.log(`📋 Sending ${logData.messages.length} messages from log\n`);

// Show message summary
for (const msg of logData.messages) {
  const preview = msg.content.slice(0, 80).replace(/\n/g, "\\n");
  console.log(`   [${msg.role}] ${preview}${msg.content.length > 80 ? "..." : ""}`);
}

console.log("\n🚀 Sending request...\n");
console.log("=".repeat(70));

try {
  const response = await client.chat.completions.create({
    model,
    // biome-ignore lint/suspicious/noExplicitAny: Debug script with untyped log data
    messages: logData.messages.map((m: any) => ({
      role: m.role,
      content: m.content,
    })),
    temperature: 0.7,
  });

  const content = response.choices[0]?.message?.content || "";

  console.log("\n📤 RAW RESPONSE:\n");
  console.log(content);
  console.log("\n" + "=".repeat(70));

  // Analysis
  console.log("\n📊 Analysis:");
  console.log(`   Model: ${model}`);
  console.log(
    `   Tokens: ${response.usage?.prompt_tokens} in, ${response.usage?.completion_tokens} out`,
  );

  // Check for gadget markers (TOML uses GDGT-STRT, YAML uses !!!GADGET_START)
  const hasTomlMarker = content.includes("GDGT-STRT:");
  const hasYamlMarker = content.includes("!!!GADGET_START:");
  console.log(
    `   Gadget format: ${hasTomlMarker ? "TOML" : hasYamlMarker ? "YAML" : "Unknown/None"}`,
  );

  // Check if heredoc was used
  const usedHeredoc = content.includes("<<<EOF") || content.includes("<<<END");
  console.log(`   Used heredoc: ${usedHeredoc ? "✅ Yes" : "❌ No"}`);

  // Check for numbered list
  const hasNumberedList = /\d+\.\s/.test(content);
  console.log(`   Numbered list: ${hasNumberedList ? "Yes" : "No"}`);

  if (hasNumberedList && !usedHeredoc) {
    console.log("\n⚠️  POTENTIAL PARSE ERROR: Numbered list without heredoc!");
  }
} catch (error) {
  console.error("\n💥 API Error:", error);
  process.exit(1);
}
