/**
 * Model catalog: Query models, estimate costs, find cheapest
 *
 * Run: bunx tsx examples/06-model-catalog.ts
 */

import { LLMist } from "llmist";

async function main() {
  console.log("=== Model Catalog Examples ===\n");

  const client = new LLMist();
  const registry = client.modelRegistry;

  // ==========================================================================
  // 1. List all available models
  // ==========================================================================
  console.log("1. Available models by provider:\n");

  const providers = ["openai", "anthropic", "gemini"];
  for (const provider of providers) {
    const models = registry.listModels(provider);
    console.log(`   ${provider}: ${models.length} models`);
    models.slice(0, 3).forEach((m) => {
      console.log(`     - ${m.modelId} (${m.displayName})`);
    });
    if (models.length > 3) {
      console.log(`     ... and ${models.length - 3} more`);
    }
  }

  console.log();

  // ==========================================================================
  // 2. Get model specs
  // ==========================================================================
  console.log("2. Model specifications:\n");

  const modelIds = ["gpt-5", "claude-sonnet-4-5-20250929", "gemini-3-pro-preview"];
  for (const modelId of modelIds) {
    const spec = registry.getModelSpec(modelId);
    if (spec) {
      console.log(`   ${spec.displayName}:`);
      console.log(`     Context: ${spec.contextWindow.toLocaleString()} tokens`);
      console.log(`     Max output: ${spec.maxOutputTokens.toLocaleString()} tokens`);
      console.log(`     Price: $${spec.pricing.input}/1M in, $${spec.pricing.output}/1M out`);
      console.log();
    }
  }

  // ==========================================================================
  // 3. Cost estimation
  // ==========================================================================
  console.log("3. Cost estimation (10K input, 2K output tokens):\n");

  for (const modelId of modelIds) {
    const cost = registry.estimateCost(modelId, 10_000, 2_000);
    if (cost) {
      console.log(`   ${modelId}:`);
      console.log(`     Input: $${cost.inputCost.toFixed(4)}`);
      console.log(`     Output: $${cost.outputCost.toFixed(4)}`);
      console.log(`     Total: $${cost.totalCost.toFixed(4)}`);
      console.log();
    }
  }

  // ==========================================================================
  // 4. Find cheapest model
  // ==========================================================================
  console.log("4. Cheapest models for 10K/2K tokens:\n");

  const cheapestOverall = registry.getCheapestModel(10_000, 2_000);
  if (cheapestOverall) {
    const cost = registry.estimateCost(cheapestOverall.modelId, 10_000, 2_000);
    console.log(`   Overall: ${cheapestOverall.modelId} ($${cost?.totalCost.toFixed(4)})`);
  }

  for (const provider of providers) {
    const cheapest = registry.getCheapestModel(10_000, 2_000, provider);
    if (cheapest) {
      const cost = registry.estimateCost(cheapest.modelId, 10_000, 2_000);
      console.log(`   ${provider}: ${cheapest.modelId} ($${cost?.totalCost.toFixed(4)})`);
    }
  }

  console.log();

  // ==========================================================================
  // 5. Feature queries
  // ==========================================================================
  console.log("5. Models by feature:\n");

  const visionModels = registry.getModelsByFeature("vision");
  console.log(`   Vision: ${visionModels.length} models`);
  visionModels.slice(0, 3).forEach((m) => console.log(`     - ${m.modelId}`));

  const reasoningModels = registry.getModelsByFeature("reasoning");
  console.log(`   Reasoning: ${reasoningModels.length} models`);
  reasoningModels.forEach((m) => console.log(`     - ${m.modelId}`));

  console.log();

  // ==========================================================================
  // 6. Token counting + cost
  // ==========================================================================
  console.log("6. Token counting with cost estimate:\n");

  const messages = [
    { role: "system" as const, content: "You are a helpful assistant that writes code." },
    { role: "user" as const, content: "Write a function to calculate fibonacci numbers." },
  ];

  const model = "openai:gpt-5";
  const tokens = await client.countTokens(model, messages);
  const cost = registry.estimateCost("gpt-5", tokens, 500);

  console.log(`   Model: ${model}`);
  console.log(`   Input tokens: ${tokens}`);
  console.log(`   Estimated output: 500`);
  console.log(`   Estimated cost: $${cost?.totalCost.toFixed(4)}`);

  console.log("\n=== Done ===");
}

main().catch(console.error);
