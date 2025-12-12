/**
 * Image generation with llmist
 *
 * Run: bunx tsx examples/16-image-generation.ts
 *
 * Demonstrates generating images using:
 * - OpenAI DALL-E 3
 * - Google Imagen (if GEMINI_API_KEY is set)
 *
 * Note: Requires OPENAI_API_KEY environment variable.
 */

import { writeFileSync } from "node:fs";
import { LLMist } from "llmist";

async function main() {
  console.log("=== Image Generation with llmist ===\n");

  const client = new LLMist();

  // Example 1: Generate an image with DALL-E 3 (URL response)
  console.log("1. Generating image with DALL-E 3...");
  const result = await client.image.generate({
    model: "dall-e-3",
    prompt: "A serene mountain landscape at sunset, digital art style",
    size: "1024x1024",
    quality: "standard",
  });

  console.log(`   Generated ${result.images.length} image(s)`);
  console.log(`   Size: ${result.usage.size}`);
  console.log(`   Quality: ${result.usage.quality}`);
  if (result.cost !== undefined) {
    console.log(`   Cost: $${result.cost.toFixed(4)}`);
  }
  if (result.images[0]?.url) {
    console.log(`   URL: ${result.images[0].url}`);
  }
  console.log();

  // Example 2: Generate image and save to file (base64 response)
  console.log("2. Generating image and saving to file...");
  const savedResult = await client.image.generate({
    model: "dall-e-3",
    prompt: "A cute robot learning to paint, watercolor illustration",
    size: "1024x1024",
    quality: "hd",
    responseFormat: "b64_json",
  });

  if (savedResult.images[0]?.b64Json) {
    const buffer = Buffer.from(savedResult.images[0].b64Json, "base64");
    const filename = "/tmp/llmist-robot-painter.png";
    writeFileSync(filename, buffer);
    console.log(`   Saved to: ${filename}`);
    console.log(`   Size: ${buffer.length} bytes`);
    if (savedResult.cost !== undefined) {
      console.log(`   Cost: $${savedResult.cost.toFixed(4)}`);
    }
  }
  console.log();

  // Example 3: List available image models
  console.log("3. Available image models:");
  const models = client.image.listModels();
  for (const model of models) {
    console.log(`   - ${model.modelId} (${model.displayName})`);
    if (model.supportedSizes) {
      console.log(`     Sizes: ${model.supportedSizes.join(", ")}`);
    }
  }
  console.log();

  // Example 4: Check model support
  console.log("4. Model support check:");
  console.log(`   dall-e-3: ${client.image.supportsModel("dall-e-3")}`);
  console.log(`   dall-e-2: ${client.image.supportsModel("dall-e-2")}`);
  console.log(
    `   imagen-4.0-generate-001: ${client.image.supportsModel("imagen-4.0-generate-001")}`,
  );

  console.log("\n=== Done ===");
}

main().catch(console.error);
