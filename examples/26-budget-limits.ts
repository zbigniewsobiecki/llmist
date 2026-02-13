/**
 * Budget Limits: Controlling agent spend with .withBudget()
 *
 * The budget feature sets a hard USD limit on agent execution.
 * When cumulative cost reaches the budget, the loop exits gracefully.
 * Budget tracks all costs: LLM calls, paid gadgets, and subagent costs.
 *
 * Run: npx tsx examples/26-budget-limits.ts
 */

import { LLMist } from "llmist";

async function main() {
  console.log("=== Budget Limits ===\n");

  // ---------------------------------------------------------------
  // 1. Basic budget limit
  // ---------------------------------------------------------------
  console.log("1. Basic budget limit ($0.05):");
  const agent1 = LLMist.createAgent()
    .withModel("sonnet")
    .withMaxIterations(50) // High cap, budget will stop us first
    .withBudget(0.05) // Hard stop at $0.05
    .ask("List 10 interesting facts about space, one at a time.");

  for await (const event of agent1.run()) {
    if (event.type === "text") {
      process.stdout.write(event.content);
    }
  }

  const tree1 = agent1.getExecutionTree();
  console.log(`\n  Total cost: $${tree1.getTotalCost().toFixed(4)}`);
  console.log(`  Total calls: ${tree1.getAllNodes().filter((n) => n.type === "llm_call").length}`);

  // ---------------------------------------------------------------
  // 2. Budget with hook-based 80% warning
  // ---------------------------------------------------------------
  console.log("\n\n2. Budget with 80% warning hook ($0.10):");
  const agent2 = LLMist.createAgent()
    .withModel("sonnet")
    .withMaxIterations(50)
    .withBudget(0.1)
    .withHooks({
      controllers: {
        beforeLLMCall: async (ctx) => {
          if (ctx.budget && ctx.totalCost >= ctx.budget * 0.8) {
            console.log(
              `\n  [WARNING] 80% of budget used: $${ctx.totalCost.toFixed(4)}/$${ctx.budget}`,
            );
          }
          return { action: "proceed" };
        },
      },
    })
    .ask("Tell me a detailed story about a robot learning to paint.");

  for await (const event of agent2.run()) {
    if (event.type === "text") {
      process.stdout.write(event.content);
    }
  }

  const tree2 = agent2.getExecutionTree();
  console.log(`\n  Total cost: $${tree2.getTotalCost().toFixed(4)}`);
}

main().catch(console.error);
