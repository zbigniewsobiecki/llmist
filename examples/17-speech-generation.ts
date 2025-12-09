/**
 * Speech generation (Text-to-Speech) with llmist
 *
 * Run: bunx tsx examples/17-speech-generation.ts
 *
 * Demonstrates generating speech audio using:
 * - OpenAI TTS-1 (standard quality, fast)
 * - OpenAI TTS-1-HD (high quality)
 *
 * Note: Requires OPENAI_API_KEY environment variable.
 */

import { writeFileSync } from "node:fs";
import { LLMist } from "llmist";

async function main() {
  console.log("=== Speech Generation with llmist ===\n");

  const client = new LLMist();

  // Example 1: Generate speech with standard TTS
  console.log("1. Generating speech with TTS-1 (standard)...");
  const result = await client.speech.generate({
    model: "tts-1",
    input: "Hello! Welcome to llmist. This is a demonstration of text-to-speech generation.",
    voice: "nova",
    responseFormat: "mp3",
  });

  const filename1 = "/tmp/llmist-speech-standard.mp3";
  writeFileSync(filename1, Buffer.from(result.audio));
  console.log(`   Saved to: ${filename1}`);
  console.log(`   Characters: ${result.usage.characterCount}`);
  console.log(`   Format: ${result.format}`);
  if (result.cost !== undefined) {
    console.log(`   Cost: $${result.cost.toFixed(6)}`);
  }
  console.log();

  // Example 2: Generate speech with HD quality
  console.log("2. Generating speech with TTS-1-HD (high quality)...");
  const hdResult = await client.speech.generate({
    model: "tts-1-hd",
    input: "High definition audio provides richer, clearer voice synthesis for professional applications.",
    voice: "alloy",
    responseFormat: "mp3",
    speed: 0.9, // Slightly slower for clarity
  });

  const filename2 = "/tmp/llmist-speech-hd.mp3";
  writeFileSync(filename2, Buffer.from(hdResult.audio));
  console.log(`   Saved to: ${filename2}`);
  console.log(`   Characters: ${hdResult.usage.characterCount}`);
  if (hdResult.cost !== undefined) {
    console.log(`   Cost: $${hdResult.cost.toFixed(6)}`);
  }
  console.log();

  // Example 3: Different voices
  console.log("3. Trying different voices...");
  const voices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
  for (const voice of voices.slice(0, 3)) {
    const voiceResult = await client.speech.generate({
      model: "tts-1",
      input: `This is the ${voice} voice.`,
      voice,
    });
    console.log(`   ${voice}: ${voiceResult.usage.characterCount} chars, $${voiceResult.cost?.toFixed(6) ?? "N/A"}`);
  }
  console.log();

  // Example 4: List available speech models
  console.log("4. Available speech models:");
  const models = client.speech.listModels();
  for (const model of models) {
    console.log(`   - ${model.modelId} (${model.displayName})`);
    if (model.voices) {
      console.log(`     Voices: ${model.voices.slice(0, 5).join(", ")}${model.voices.length > 5 ? "..." : ""}`);
    }
    if (model.formats) {
      console.log(`     Formats: ${model.formats.join(", ")}`);
    }
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
