/**
 * E2E tests for multimodal INPUT support.
 *
 * These tests validate:
 * - Image and audio content parts in messages
 * - Content conversion across providers (mocked)
 * - Agent builder multimodal methods
 * - Vision namespace functionality
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentBuilder } from "../agent/builder.js";
import { LLMist } from "../core/client.js";
import {
  audioFromBase64,
  imageFromBase64,
  imageFromBuffer,
  imageFromUrl,
  text,
} from "../core/input-content.js";
import { LLMMessageBuilder } from "../core/messages.js";
import { createMockClient, getMockManager, mockLLM } from "../../../testing/src/index.js";

describe("E2E: Multimodal Input Support", () => {
  beforeEach(() => {
    getMockManager().clear();
  });

  afterEach(() => {
    getMockManager().clear();
  });

  describe("Direct Stream with Multimodal Content", () => {
    it("sends image content to OpenAI", async () => {
      mockLLM()
        .forProvider("openai")
        .forModel("gpt-4o")
        .whenMessageContains("describe")
        .returns("I see a beautiful sunset over the ocean.")
        .register();

      const client = createMockClient();

      const stream = client.stream({
        model: "openai:gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              text("Please describe this image:"),
              imageFromBase64("SGVsbG8gV29ybGQ=", "image/jpeg"),
            ],
          },
        ],
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        if (chunk.text) chunks.push(chunk.text);
      }

      const response = chunks.join("");
      expect(response).toContain("sunset");
    });

    it("sends image URL to OpenAI", async () => {
      mockLLM().forProvider("openai").returns("This is a cat playing with yarn.").register();

      const client = createMockClient();

      const stream = client.stream({
        model: "openai:gpt-4o",
        messages: [
          {
            role: "user",
            content: [text("What's in this image?"), imageFromUrl("https://example.com/cat.jpg")],
          },
        ],
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        if (chunk.text) chunks.push(chunk.text);
      }

      const response = chunks.join("");
      expect(response).toContain("cat");
    });

    it("sends image content to Anthropic", async () => {
      mockLLM()
        .forProvider("anthropic")
        .returns("The image shows a mountain landscape with snow-capped peaks.")
        .register();

      const client = createMockClient();

      // PNG magic bytes
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

      const stream = client.stream({
        model: "anthropic:claude-sonnet-4-20250514",
        messages: [
          {
            role: "user",
            content: [text("Describe this scene:"), imageFromBuffer(pngBuffer)],
          },
        ],
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        if (chunk.text) chunks.push(chunk.text);
      }

      const response = chunks.join("");
      expect(response).toContain("mountain");
    });

    it("sends image and audio to Gemini", async () => {
      mockLLM()
        .forProvider("gemini")
        .returns("The image shows a bird singing, and the audio contains chirping sounds.")
        .register();

      const client = createMockClient();

      const stream = client.stream({
        model: "gemini:gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              text("What do you see and hear?"),
              imageFromBase64("aW1hZ2VfZGF0YQ==", "image/jpeg"),
              audioFromBase64("YXVkaW9fZGF0YQ==", "audio/mp3"),
            ],
          },
        ],
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        if (chunk.text) chunks.push(chunk.text);
      }

      const response = chunks.join("");
      expect(response).toContain("bird");
      expect(response).toContain("chirping");
    });
  });

  describe("LLMMessageBuilder Multimodal Methods", () => {
    it("builds message with addUserWithImage", () => {
      const builder = new LLMMessageBuilder();
      // JPEG magic bytes
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      builder.addUserWithImage("Describe this", jpegBuffer);

      const messages = builder.build();

      expect(messages).toHaveLength(1);
      expect(messages[0]?.role).toBe("user");
      expect(Array.isArray(messages[0]?.content)).toBe(true);

      const content = messages[0]?.content as unknown[];
      expect(content).toHaveLength(2);
      expect(content[0]).toHaveProperty("type", "text");
      expect(content[1]).toHaveProperty("type", "image");
    });

    it("builds message with addUserWithImageUrl", () => {
      const builder = new LLMMessageBuilder();
      builder.addUserWithImageUrl("What's this?", "https://example.com/img.png");

      const messages = builder.build();

      const content = messages[0]?.content as unknown[];
      expect(content[1]).toMatchObject({
        type: "image",
        source: { type: "url", url: "https://example.com/img.png" },
      });
    });

    it("builds message with addUserWithAudio", () => {
      const builder = new LLMMessageBuilder();
      // MP3 ID3 magic bytes
      const mp3Buffer = Buffer.from([0x49, 0x44, 0x33, 0x04]);
      builder.addUserWithAudio("Transcribe this", mp3Buffer);

      const messages = builder.build();

      const content = messages[0]?.content as unknown[];
      expect(content[1]).toMatchObject({
        type: "audio",
        source: { type: "base64", mediaType: "audio/mp3" },
      });
    });

    it("builds message with addUserMultimodal", () => {
      const builder = new LLMMessageBuilder();
      builder.addUserMultimodal([
        text("Compare these:"),
        imageFromBase64("aW1hZ2Ux", "image/png"),
        imageFromBase64("aW1hZ2Uy", "image/png"),
      ]);

      const messages = builder.build();

      const content = messages[0]?.content as unknown[];
      expect(content).toHaveLength(3);
    });
  });

  describe("Agent Builder with Multimodal History", () => {
    it("accepts multimodal content in withHistory builder method", () => {
      // Test that the builder accepts multimodal content in history
      const agent = new AgentBuilder(createMockClient())
        .withModel("openai:gpt-4o")
        .withHistory([
          {
            user: [text("Here's a diagram:"), imageFromBase64("ZGlhZ3JhbQ==", "image/png")],
          },
          { assistant: "I see a flowchart showing a process." },
        ])
        .ask("What was the image about?");

      // Verify agent was created successfully with multimodal history
      expect(agent).toBeDefined();
    });

    it("creates agent with askWithImage method", () => {
      // JPEG magic bytes for detection
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

      // Test that askWithImage creates an agent successfully
      const agent = new AgentBuilder(createMockClient())
        .withModel("openai:gpt-4o")
        .askWithImage("What do you see?", jpegBuffer);

      // Verify agent was created successfully
      expect(agent).toBeDefined();
    });
  });

  describe("Content Part Helpers", () => {
    it("text() creates text content part", () => {
      const part = text("Hello, world!");
      expect(part).toEqual({ type: "text", text: "Hello, world!" });
    });

    it("imageFromBase64() creates base64 image part", () => {
      const part = imageFromBase64("SGVsbG8=", "image/jpeg");
      expect(part).toMatchObject({
        type: "image",
        source: { type: "base64", mediaType: "image/jpeg" },
      });
    });

    it("imageFromUrl() creates URL image part", () => {
      const part = imageFromUrl("https://example.com/image.jpg");
      expect(part).toEqual({
        type: "image",
        source: { type: "url", url: "https://example.com/image.jpg" },
      });
    });

    it("imageFromBuffer() auto-detects JPEG", () => {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      const part = imageFromBuffer(jpeg);
      expect(part.source).toMatchObject({
        type: "base64",
        mediaType: "image/jpeg",
      });
    });

    it("imageFromBuffer() auto-detects PNG", () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const part = imageFromBuffer(png);
      expect(part.source).toMatchObject({
        type: "base64",
        mediaType: "image/png",
      });
    });

    it("audioFromBase64() creates audio part", () => {
      const part = audioFromBase64("YXVkaW8=", "audio/mp3");
      expect(part).toMatchObject({
        type: "audio",
        source: { type: "base64", mediaType: "audio/mp3" },
      });
    });
  });

  describe("Mixed Text and Multimodal Messages", () => {
    it("handles conversation with both text and image messages", async () => {
      mockLLM()
        .forProvider("openai")
        .whenMessageContains("comparison")
        .returns("The first image shows a cat, and the second shows a dog.")
        .register();

      const client = createMockClient();

      const stream = client.stream({
        model: "openai:gpt-4o",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "I'm going to show you two images." },
          { role: "assistant", content: "Sure, please share them." },
          {
            role: "user",
            content: [
              text("Here they are. Please give me a comparison:"),
              imageFromBase64("Y2F0X2ltYWdl", "image/jpeg"),
              imageFromBase64("ZG9nX2ltYWdl", "image/jpeg"),
            ],
          },
        ],
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        if (chunk.text) chunks.push(chunk.text);
      }

      const response = chunks.join("");
      expect(response).toContain("cat");
      expect(response).toContain("dog");
    });
  });
});
