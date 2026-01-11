/**
 * Tests for multimodal mock support (images, audio).
 *
 * These tests verify:
 * - Multimodal matchers (whenMessageHasImage, whenMessageHasAudio)
 * - Multimodal response helpers (returnsImage, returnsAudio)
 * - Image and speech generation mocking
 */

import { imageFromBase64, text } from "llmist";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockClient, getMockManager, mockLLM } from "./index.js";

describe("Multimodal Mock Matchers", () => {
  beforeEach(() => {
    getMockManager().clear();
  });

  afterEach(() => {
    getMockManager().clear();
  });

  describe("whenMessageHasImage", () => {
    it("matches when message contains an image", async () => {
      mockLLM().whenMessageHasImage().returns("I see an image of a sunset.").register();

      const client = createMockClient();

      const stream = client.stream({
        model: "openai:gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              text("What's in this image?"),
              imageFromBase64("SGVsbG8gV29ybGQ=", "image/jpeg"),
            ],
          },
        ],
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        if (chunk.text) chunks.push(chunk.text);
      }

      expect(chunks.join("")).toContain("sunset");
    });

    it("does not match when message has no image", async () => {
      mockLLM().whenMessageHasImage().returns("I see an image").register();

      mockLLM().forProvider("openai").returns("No image found").register();

      const client = createMockClient();

      const stream = client.stream({
        model: "openai:gpt-4o",
        messages: [{ role: "user", content: "Hello" }],
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        if (chunk.text) chunks.push(chunk.text);
      }

      expect(chunks.join("")).toContain("No image found");
    });
  });

  describe("whenMessageHasAudio", () => {
    it("matches when message contains audio", async () => {
      // Import audio helper from llmist
      const { audioFromBase64 } = await import("llmist");

      mockLLM().whenMessageHasAudio().returns("I hear music playing.").register();

      const client = createMockClient();

      const stream = client.stream({
        model: "gemini:gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [text("What do you hear?"), audioFromBase64("YXVkaW9fZGF0YQ==", "audio/mp3")],
          },
        ],
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        if (chunk.text) chunks.push(chunk.text);
      }

      expect(chunks.join("")).toContain("music");
    });
  });

  describe("whenImageCount", () => {
    it("matches based on image count", async () => {
      mockLLM()
        .whenImageCount((n) => n >= 2)
        .returns("I see multiple images")
        .register();

      mockLLM().whenMessageHasImage().returns("I see one image").register();

      const client = createMockClient();

      // Single image
      const stream1 = client.stream({
        model: "openai:gpt-4o",
        messages: [
          {
            role: "user",
            content: [text("Compare these"), imageFromBase64("aW1hZ2Ux", "image/png")],
          },
        ],
      });

      const chunks1: string[] = [];
      for await (const chunk of stream1) {
        if (chunk.text) chunks1.push(chunk.text);
      }
      expect(chunks1.join("")).toContain("one image");

      // Multiple images
      const stream2 = client.stream({
        model: "openai:gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              text("Compare these"),
              imageFromBase64("aW1hZ2Ux", "image/png"),
              imageFromBase64("aW1hZ2Uy", "image/png"),
            ],
          },
        ],
      });

      const chunks2: string[] = [];
      for await (const chunk of stream2) {
        if (chunk.text) chunks2.push(chunk.text);
      }
      expect(chunks2.join("")).toContain("multiple images");
    });
  });
});

describe("Multimodal Response Helpers", () => {
  beforeEach(() => {
    getMockManager().clear();
  });

  afterEach(() => {
    getMockManager().clear();
  });

  describe("returnsImage", () => {
    it("creates response with image data from base64 string", () => {
      const builder = mockLLM().forModel("dall-e-3").returnsImage("iVBORw0KGgoAAAANS", "image/png");

      // Access internal state through the build() result
      const registration = builder.build();
      expect(registration.response.images).toHaveLength(1);
      expect(registration.response.images?.[0].mimeType).toBe("image/png");
    });

    it("creates response with image data from buffer", () => {
      // PNG magic bytes
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      const builder = mockLLM().forModel("dall-e-3").returnsImage(pngBuffer);

      const registration = builder.build();
      expect(registration.response.images).toHaveLength(1);
      expect(registration.response.images?.[0].mimeType).toBe("image/png");
    });

    it("throws when base64 string provided without MIME type", () => {
      expect(() => {
        mockLLM().forModel("dall-e-3").returnsImage("some-base64-data").build();
      }).toThrow("MIME type is required");
    });
  });

  describe("returnsImages", () => {
    it("creates response with multiple images", () => {
      // JPEG magic bytes
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

      const builder = mockLLM()
        .forModel("dall-e-3")
        .returnsImages([
          { data: jpegBuffer },
          { data: jpegBuffer, revisedPrompt: "A beautiful sunset" },
        ]);

      const registration = builder.build();
      expect(registration.response.images).toHaveLength(2);
      expect(registration.response.images?.[1].revisedPrompt).toBe("A beautiful sunset");
    });
  });

  describe("returnsAudio", () => {
    it("creates response with audio data from buffer", () => {
      // MP3 ID3 header
      const mp3Buffer = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00]);

      const builder = mockLLM().forModel("tts-1").returnsAudio(mp3Buffer);

      const registration = builder.build();
      expect(registration.response.audio).toBeDefined();
      expect(registration.response.audio?.mimeType).toBe("audio/mp3");
    });

    it("creates response with audio data from base64 string", () => {
      const builder = mockLLM().forModel("tts-1").returnsAudio("YXVkaW9fZGF0YQ==", "audio/wav");

      const registration = builder.build();
      expect(registration.response.audio?.mimeType).toBe("audio/wav");
    });
  });
});

describe("Mock Adapter Multimodal Generation", () => {
  beforeEach(() => {
    getMockManager().clear();
  });

  afterEach(() => {
    getMockManager().clear();
  });

  describe("generateImage", () => {
    it("returns mock image generation result", async () => {
      // PNG magic bytes
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      mockLLM().forModel("dall-e-3").returnsImage(pngBuffer).register();

      const client = createMockClient();

      const result = await client.image.generate({
        model: "dall-e-3",
        prompt: "A sunset over mountains",
      });

      expect(result.images).toHaveLength(1);
      expect(result.images[0].b64Json).toBeDefined();
      expect(result.model).toBe("dall-e-3");
      expect(result.cost).toBe(0); // Mocks have zero cost
    });

    it("throws when no image mock registered", async () => {
      const client = createMockClient();

      await expect(
        client.image.generate({
          model: "dall-e-3",
          prompt: "A sunset",
        }),
      ).rejects.toThrow("No mock registered for image generation");
    });
  });

  describe("generateSpeech", () => {
    it("returns mock speech generation result", async () => {
      // MP3 ID3 header
      const mp3Buffer = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00]);

      mockLLM().forModel("tts-1").returnsAudio(mp3Buffer).register();

      const client = createMockClient();

      const result = await client.speech.generate({
        model: "tts-1",
        input: "Hello, world!",
        voice: "nova",
      });

      expect(result.audio).toBeDefined();
      expect(result.audio.byteLength).toBeGreaterThan(0);
      expect(result.format).toBe("mp3");
      expect(result.model).toBe("tts-1");
      expect(result.cost).toBe(0); // Mocks have zero cost
    });

    it("throws when no audio mock registered", async () => {
      const client = createMockClient();

      await expect(
        client.speech.generate({
          model: "tts-1",
          input: "Hello",
          voice: "nova",
        }),
      ).rejects.toThrow("No mock registered for speech generation");
    });
  });
});
