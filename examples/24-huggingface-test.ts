/**
 * Hugging Face Provider Test
 *
 * Tests the HuggingFace provider with real API calls to verify:
 * - Basic streaming
 * - Provider selection syntax (:fastest, :cheapest)
 * - Token counting
 */

import { LLMist } from "../packages/llmist/src/index.js";

async function testHuggingFace() {
  console.log("🧪 Testing HuggingFace Provider...\n");

  try {
    // Test 1: Basic streaming with Llama
    console.log("📝 Test 1: Streaming with Llama 3.1 8B");
    console.log("━".repeat(50));
    const agent = LLMist.createAgent()
      .withModel("huggingface:meta-llama/Llama-3.1-8B-Instruct")
      .ask("Count from 1 to 3, one number per line.");

    for await (const event of agent.run()) {
      if (event.type === "text") {
        process.stdout.write(event.content);
      } else if (event.type === "finish") {
        console.log(`\n\n✅ Finished: ${event.finishReason}`);
        if (event.usage) {
          console.log(
            `📊 Tokens: ${event.usage.inputTokens} in, ${event.usage.outputTokens} out, ${event.usage.totalTokens} total`,
          );
        }
      }
    }

    // Test 2: Provider selection syntax
    console.log("\n\n📝 Test 2: Using :fastest provider selection");
    console.log("━".repeat(50));
    const agent2 = LLMist.createAgent()
      .withModel("hf:Qwen/Qwen2.5-7B-Instruct:fastest")
      .ask('Say "Hello from Qwen!" in exactly 5 words.');

    for await (const event of agent2.run()) {
      if (event.type === "text") {
        process.stdout.write(event.content);
      } else if (event.type === "finish") {
        console.log(`\n\n✅ Finished: ${event.finishReason}`);
        if (event.usage) {
          console.log(`📊 Tokens: ${event.usage.inputTokens} in, ${event.usage.outputTokens} out`);
        }
      }
    }

    // Test 3: Model catalog access
    console.log("\n\n📝 Test 3: Model catalog verification");
    console.log("━".repeat(50));
    const client = new LLMist();
    const models = client.modelRegistry.listModels("huggingface");
    console.log(`✅ Found ${models.length} HuggingFace models in catalog`);
    console.log(
      "Sample models:",
      models
        .slice(0, 5)
        .map((m) => m.modelId)
        .join(", "),
    );

    console.log("\n\n🎉 All tests passed!");
  } catch (error) {
    const err = error as Error;
    console.error("\n❌ Test failed:", err.message);
    if (err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

testHuggingFace();
