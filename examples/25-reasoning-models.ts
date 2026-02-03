/**
 * Reasoning Model Support: Using thinking/reasoning capabilities
 *
 * llmist provides first-class support for reasoning models across providers:
 * - OpenAI: o3, o4-mini (reasoning effort)
 * - Anthropic: Claude 4 Opus (extended thinking with budget_tokens)
 * - Google: Gemini 2.5 (thinkingBudget), Gemini 3 (thinkingLevel)
 * - DeepSeek: V3 reasoning (via HuggingFace/OpenRouter)
 *
 * Run: npx tsx examples/25-reasoning-models.ts
 */

import { LLMist } from "llmist";

async function main() {
  console.log("=== Reasoning Model Support ===\n");

  // ─────────────────────────────────────────────────────────────
  // 1. Simple: withReasoning() defaults to "medium" effort
  // ─────────────────────────────────────────────────────────────
  console.log("1. Default medium reasoning with OpenAI o3:");
  const agent1 = LLMist.createAgent()
    .withModel("o3")
    .withReasoning() // Defaults to { enabled: true, effort: "medium" }
    .ask("What is the sum of the first 100 prime numbers?");

  for await (const event of agent1.run()) {
    if (event.type === "thinking") {
      process.stdout.write(`  💭 [thinking] ${event.content.slice(0, 80)}...\n`);
    }
    if (event.type === "text") {
      process.stdout.write(event.content);
    }
    if (event.type === "llm_call_complete" && event.usage) {
      console.log(
        `\n  📊 Tokens — input: ${event.usage.inputTokens}, output: ${event.usage.outputTokens}, reasoning: ${event.usage.reasoningTokens ?? 0}`,
      );
      if (event.thinkingContent) {
        console.log(`  💭 Thinking content: ${event.thinkingContent.slice(0, 100)}...`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 2. Explicit effort level with shorthand
  // ─────────────────────────────────────────────────────────────
  console.log("\n\n2. High reasoning effort with Anthropic Claude:");
  const agent2 = LLMist.createAgent()
    .withModel("opus") // Claude Opus
    .withReasoning("high") // Maps to budget_tokens: 16384
    .ask("Prove that the square root of 2 is irrational.");

  for await (const event of agent2.run()) {
    if (event.type === "thinking") {
      // Thinking events fire during streaming for real-time monitoring
      process.stdout.write(`  💭 `);
    }
    if (event.type === "text") {
      process.stdout.write(event.content);
    }
    if (event.type === "llm_call_complete") {
      console.log(`\n  💰 Cost: $${event.cost?.toFixed(4) ?? "unknown"}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 3. Explicit budget with Anthropic
  // ─────────────────────────────────────────────────────────────
  console.log("\n\n3. Explicit token budget with Anthropic:");
  const agent3 = LLMist.createAgent()
    .withModel("anthropic:claude-4-opus-20250514")
    .withReasoning({ enabled: true, budgetTokens: 10000 })
    .ask("Explain the Riemann hypothesis in simple terms.");

  for await (const event of agent3.run()) {
    if (event.type === "text") {
      process.stdout.write(event.content);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 4. Gemini 2.5 with thinking budget
  // ─────────────────────────────────────────────────────────────
  console.log("\n\n4. Gemini 2.5 with reasoning:");
  const agent4 = LLMist.createAgent()
    .withModel("gemini-2.5-pro")
    .withReasoning("medium") // Maps to thinkingBudget: 8192
    .ask("What are the logical implications of Gödel's incompleteness theorems?");

  for await (const event of agent4.run()) {
    if (event.type === "thinking") {
      process.stdout.write(`  💭 [thought] `);
    }
    if (event.type === "text") {
      process.stdout.write(event.content);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 5. Opt out of reasoning (auto-enabled by default)
  // ─────────────────────────────────────────────────────────────
  console.log("\n\n5. Disabling auto-reasoning:");
  console.log("   Reasoning-capable models auto-enable at 'medium' effort.");
  console.log("   Use withoutReasoning() to opt out:\n");

  const agent5 = LLMist.createAgent()
    .withModel("o3")
    .withoutReasoning() // Explicitly disable reasoning
    .ask("Hello, just respond briefly.");

  for await (const event of agent5.run()) {
    if (event.type === "text") {
      process.stdout.write(event.content);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 6. Collecting thinking content with askAndCollect
  // ─────────────────────────────────────────────────────────────
  console.log("\n\n6. Using collectEvents for full event access:");
  const { collectEvents } = await import("llmist");

  const agent6 = LLMist.createAgent()
    .withModel("o3")
    .withReasoning("high")
    .ask("Is P = NP? Give a brief opinion.");

  const events = await collectEvents(agent6);

  // Filter for thinking events
  const thinkingEvents = events.filter((e) => e.type === "thinking");
  const completeEvents = events.filter((e) => e.type === "llm_call_complete");

  console.log(`  Total events: ${events.length}`);
  console.log(`  Thinking events: ${thinkingEvents.length}`);
  if (completeEvents.length > 0) {
    const complete = completeEvents[0];
    if (complete.type === "llm_call_complete") {
      console.log(`  Reasoning tokens: ${complete.usage?.reasoningTokens ?? "N/A"}`);
      if (complete.thinkingContent) {
        console.log(`  Thinking preview: "${complete.thinkingContent.slice(0, 120)}..."`);
      }
    }
  }

  console.log("\n\n=== Done ===");
}

main().catch(console.error);
