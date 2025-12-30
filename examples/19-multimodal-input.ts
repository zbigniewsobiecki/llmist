/**
 * Multimodal Input: Images and Audio in Messages
 *
 * Run: npx tsx examples/19-multimodal-input.ts
 *
 * Demonstrates sending images and audio alongside text in LLM messages.
 * This complements the multimodal OUTPUT examples (18-multimodal-gadget.ts).
 *
 * Note: Requires API keys:
 * - OPENAI_API_KEY for OpenAI vision
 * - ANTHROPIC_API_KEY for Claude vision
 * - GEMINI_API_KEY for Gemini (vision + audio)
 */

import { imageFromUrl, LLMist, LLMMessageBuilder, text } from "llmist";

// =============================================================================
// 1. Quick Vision Analysis with llmist.vision namespace
// =============================================================================

async function demoVisionNamespace() {
  console.log("=== 1. Vision Namespace (One-shot Analysis) ===\n");

  const client = new LLMist();

  // Check which models support vision
  console.log("Models with vision support:", client.vision.listModels().slice(0, 5), "...\n");

  // Note: In a real scenario, you would use an actual image file
  // For this demo, we'll show the API pattern

  console.log(`
Example code:
  const description = await client.vision.analyze({
    model: "gpt-4o",
    image: await readFile("photo.jpg"),
    prompt: "Describe this image in detail",
  });
`);

  console.log(
    "Vision namespace supports: analyze(), analyzeWithUsage(), supportsModel(), listModels()\n",
  );
}

// =============================================================================
// 2. Direct Streaming with Multimodal Content
// =============================================================================

async function demoDirectStream() {
  console.log("=== 2. Direct Streaming with Images ===\n");

  const client = new LLMist();

  // Create a message with image using the content part helpers
  const messages = [
    {
      role: "user" as const,
      content: [
        text("What's in this image?"),
        // In a real scenario: imageFromBuffer(await readFile("image.jpg"))
        // For demo, showing URL-based image (OpenAI only)
        imageFromUrl(
          "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/200px-PNG_transparency_demonstration_1.png",
        ),
      ],
    },
  ];

  console.log("Sending image URL to model...\n");

  try {
    process.stdout.write("Response: ");
    for await (const chunk of client.stream({
      model: "openai:gpt-4o",
      messages,
      maxTokens: 300,
    })) {
      process.stdout.write(chunk.text);
    }
    console.log("\n");
  } catch (_error) {
    console.log("(Requires OPENAI_API_KEY - showing code pattern instead)\n");
    console.log(`
Example code:
  for await (const chunk of client.stream({
    model: "openai:gpt-4o",
    messages: [
      { role: "user", content: [
        text("What's in this image?"),
        imageFromUrl("https://example.com/image.jpg"),
      ]}
    ],
  })) {
    process.stdout.write(chunk.text);
  }
`);
  }
}

// =============================================================================
// 3. LLMMessageBuilder Multimodal Methods
// =============================================================================

function demoMessageBuilder() {
  console.log("=== 3. LLMMessageBuilder Multimodal Methods ===\n");

  // Using the new multimodal builder methods
  const builder = new LLMMessageBuilder();

  // Add system message
  builder.addSystem("You are a helpful assistant that analyzes images.");

  // Method 1: addUserWithImage - text + buffer/base64
  // builder.addUserWithImage("What's this?", imageBuffer);

  // Method 2: addUserWithImageUrl - text + URL (OpenAI only)
  builder.addUserWithImageUrl("Describe this:", "https://example.com/photo.jpg");

  // Method 3: addUserMultimodal - full control over content parts
  // builder.addUserMultimodal([
  //   text("Compare these two images:"),
  //   imageFromBuffer(image1),
  //   imageFromBuffer(image2),
  // ]);

  const messages = builder.build();
  console.log("Built messages:", JSON.stringify(messages, null, 2).slice(0, 500), "...\n");
}

// =============================================================================
// 4. Agent with Multimodal History
// =============================================================================

async function demoAgentHistory() {
  console.log("=== 4. Agent with Multimodal History ===\n");

  console.log(`
Example code:
  const agent = LLMist.createAgent()
    .withModel("gpt-4o")
    .withHistory([
      // First message includes an image
      { user: [
        text("Here's a chart of our Q3 sales:"),
        imageFromBuffer(chartImage),
      ]},
      { assistant: "I can see the sales chart. Revenue increased 15% compared to Q2." },
    ])
    .ask("What trends do you notice?");

  for await (const event of agent.run()) {
    if (event.type === "chunk") {
      process.stdout.write(event.content);
    }
  }
`);
  console.log("");
}

// =============================================================================
// 5. askWithImage Convenience Method
// =============================================================================

async function demoAskWithImage() {
  console.log("=== 5. askWithImage Convenience Method ===\n");

  console.log(`
Example code:
  const imageBuffer = await readFile("photo.jpg");

  await LLMist.createAgent()
    .withModel("gpt-4o")
    .withSystem("You are an expert art critic.")
    .askWithImage("Analyze this artwork:", imageBuffer)
    .run();

  // Or collect the result directly:
  const analysis = await LLMist.createAgent()
    .withModel("gpt-4o")
    .askWithImage("What's in this photo?", await readFile("scene.jpg"))
    .askAndCollect();
`);
  console.log("");
}

// =============================================================================
// 6. Provider-Specific Features
// =============================================================================

function demoProviderFeatures() {
  console.log("=== 6. Provider-Specific Features ===\n");

  console.log(`
OpenAI:
  - Supports image URLs (imageFromUrl)
  - Supports base64 images (imageFromBuffer, imageFromBase64)
  - NO audio input support

Anthropic (Claude):
  - Base64 images only (imageFromBuffer, imageFromBase64)
  - NO URL images (must download and convert to base64)
  - NO audio input support

Gemini:
  - Base64 images only
  - UNIQUE: Supports audio input! (audioFromBuffer, audioFromBase64)

Example for Gemini with audio:
  import { audioFromBuffer } from "llmist";

  for await (const chunk of client.stream({
    model: "gemini:gemini-2.5-flash",
    messages: [{
      role: "user",
      content: [
        text("What is being said in this audio?"),
        audioFromBuffer(await readFile("recording.mp3")),
      ],
    }],
  })) {
    process.stdout.write(chunk.text);
  }
`);
}

// =============================================================================
// 7. Content Part Helpers Reference
// =============================================================================

function demoContentHelpers() {
  console.log("=== 7. Content Part Helpers Reference ===\n");

  console.log(`
Available helpers from 'llmist':

Text:
  text("Your message")

Images:
  imageFromBuffer(buffer)                    // Auto-detects MIME type
  imageFromBuffer(buffer, "image/jpeg")      // Explicit MIME type
  imageFromBase64(base64String, "image/png") // From base64 string
  imageFromUrl("https://...")                // URL (OpenAI only)

Audio (Gemini only):
  audioFromBuffer(buffer)                    // Auto-detects MIME type
  audioFromBuffer(buffer, "audio/mp3")       // Explicit MIME type
  audioFromBase64(base64String, "audio/wav") // From base64 string

Supported MIME types:
  Images: image/jpeg, image/png, image/gif, image/webp
  Audio:  audio/mp3, audio/mpeg, audio/wav, audio/webm, audio/ogg
`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║           llmist Multimodal INPUT Examples                    ║");
  console.log("║   (Send images and audio alongside text in messages)          ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");

  await demoVisionNamespace();
  await demoDirectStream();
  demoMessageBuilder();
  await demoAgentHistory();
  await demoAskWithImage();
  demoProviderFeatures();
  demoContentHelpers();

  console.log("=== Done ===");
}

main().catch(console.error);
