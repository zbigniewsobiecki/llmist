/**
 * Multimodal gadget with automatic cost tracking
 *
 * Run: npx tsx examples/18-multimodal-gadget.ts
 *
 * Demonstrates creating gadgets that use image and speech generation
 * with automatic cost tracking via the execution context.
 *
 * Note: Requires OPENAI_API_KEY environment variable.
 */

import { writeFileSync } from "node:fs";
import { createGadget, LLMist } from "llmist";
import { z } from "zod";

// Gadget that generates images with automatic cost reporting
const ImageGenerator = createGadget({
  description: "Generates an image from a text prompt using AI",
  schema: z.object({
    prompt: z.string().describe("Description of the image to generate"),
    style: z.enum(["realistic", "artistic", "cartoon"]).describe("Visual style for the image"),
  }),
  execute: async (params, ctx) => {
    if (!ctx?.llmist) {
      return "Error: LLMist client not available in context";
    }

    // Style-specific prompt enhancement
    const stylePrompts: Record<string, string> = {
      realistic: "photorealistic, high detail, professional photography",
      artistic: "oil painting style, artistic, expressive brushstrokes",
      cartoon: "cartoon illustration, colorful, fun, animated style",
    };

    const enhancedPrompt = `${params.prompt}, ${stylePrompts[params.style]}`;

    // Generate image - cost is automatically tracked!
    const result = await ctx.llmist.image.generate({
      model: "dall-e-3",
      prompt: enhancedPrompt,
      size: "1024x1024",
      quality: "standard",
    });

    if (result.images[0]?.url) {
      return `Image generated successfully!\nURL: ${result.images[0].url}\nCost: $${result.cost?.toFixed(4) ?? "N/A"}`;
    }

    return "Image generated but URL not available (check response format)";
  },
});

// Gadget that generates speech with automatic cost reporting
const SpeechSynthesizer = createGadget({
  description: "Converts text to speech audio using AI",
  schema: z.object({
    text: z.string().describe("Text to convert to speech"),
    voice: z.enum(["nova", "alloy", "echo"]).describe("Voice to use for synthesis"),
    quality: z.enum(["standard", "hd"]).describe("Audio quality"),
  }),
  execute: async (params, ctx) => {
    if (!ctx?.llmist) {
      return "Error: LLMist client not available in context";
    }

    const model = params.quality === "hd" ? "tts-1-hd" : "tts-1";

    // Generate speech - cost is automatically tracked!
    const result = await ctx.llmist.speech.generate({
      model,
      input: params.text,
      voice: params.voice,
      responseFormat: "mp3",
    });

    // Save to temp file
    const filename = `/tmp/llmist-gadget-speech-${Date.now()}.mp3`;
    writeFileSync(filename, Buffer.from(result.audio));

    return `Speech generated successfully!\nFile: ${filename}\nCharacters: ${result.usage.characterCount}\nCost: $${result.cost?.toFixed(6) ?? "N/A"}`;
  },
});

async function main() {
  console.log("=== Multimodal Gadget Example ===\n");

  // Run agent with multimodal gadgets
  const result = await LLMist.createAgent()
    .withModel("haiku")
    .withSystem(`You are a helpful assistant with access to image and speech generation tools.
When asked to create images, use the ImageGenerator gadget.
When asked to create audio, use the SpeechSynthesizer gadget.`)
    .withGadgets(ImageGenerator, SpeechSynthesizer)
    .askWith("Generate an artistic image of a sunset over mountains", {
      onText: (text) => process.stdout.write(text),
      onGadgetCall: (call) => console.log(`\n[Calling ${call.gadgetName}...]`),
      onGadgetResult: (result) => {
        console.log(`[Result: ${result.result}]`);
        if (result.cost !== undefined && result.cost > 0) {
          console.log(`[Gadget cost: $${result.cost.toFixed(4)}]`);
        }
      },
      onSummary: (summary) => {
        console.log(`\n\nTotal cost: $${summary.cost.toFixed(4)}`);
        console.log(`Total iterations: ${summary.iterations}`);
      },
    });

  console.log("\n\n=== Done ===");
}

main().catch(console.error);
