import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mockLLM, resetMocks } from "./index.js";
import { MockProviderAdapter } from "./mock-adapter.js";
import { MockManager } from "./mock-manager.js";

describe("MockProviderAdapter", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    resetMocks();
  });

  // Helper to collect all chunks from a stream
  async function collectStream(stream: AsyncIterable<any>) {
    const chunks: any[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return chunks;
  }

  describe("stream()", () => {
    test("returns graceful empty-response fallback when no mock matches", async () => {
      // No mocks registered — non-strict mode should return an empty response
      const adapter = new MockProviderAdapter({ strictMode: false });

      const stream = adapter.stream(
        { model: "mock:unknown", messages: [{ role: "user", content: "hi" }] },
        { provider: "mock", name: "unknown" },
      );

      const chunks = await collectStream(stream);

      // Should yield a single empty stop chunk
      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe("");
      expect(chunks[0].finishReason).toBe("stop");
      expect(chunks[0].usage).toBeDefined();
    });

    test("returns matching mock response when a mock is registered", async () => {
      mockLLM().forModel("test-model").returns("Hello from mock!").register();

      const adapter = new MockProviderAdapter();

      const stream = adapter.stream(
        { model: "mock:test-model", messages: [{ role: "user", content: "hi" }] },
        { provider: "mock", name: "test-model" },
      );

      const chunks = await collectStream(stream);
      const text = chunks.map((c) => c.text).join("");
      expect(text).toContain("Hello from mock!");
    });
  });

  describe("generateImage()", () => {
    test("throws an error when no image mock is registered", async () => {
      // No image mock registered
      const adapter = new MockProviderAdapter({ strictMode: false });

      await expect(
        adapter.generateImage({
          model: "dall-e-3",
          prompt: "A sunset over the ocean",
          n: 1,
          size: "1024x1024",
        }),
      ).rejects.toThrow('No mock registered for image generation with model "dall-e-3"');
    });

    test("returns image result when a matching image mock is registered", async () => {
      mockLLM()
        .forModel("dall-e-3")
        .returnsImage(Buffer.from("fake-image-data"), "image/png")
        .register();

      const adapter = new MockProviderAdapter();

      const result = await adapter.generateImage({
        model: "dall-e-3",
        prompt: "A sunset",
        n: 1,
        size: "1024x1024",
      });

      expect(result.images).toHaveLength(1);
      expect(result.model).toBe("dall-e-3");
      expect(result.cost).toBe(0);
    });
  });

  describe("generateSpeech()", () => {
    test("throws an error when no speech mock is registered", async () => {
      const adapter = new MockProviderAdapter({ strictMode: false });

      await expect(
        adapter.generateSpeech({
          model: "tts-1",
          input: "Hello world",
          voice: "alloy",
        }),
      ).rejects.toThrow('No mock registered for speech generation with model "tts-1"');
    });

    test("returns speech result when a matching audio mock is registered", async () => {
      // Use valid MP3 header bytes so audio MIME type detection works
      const mp3Header = Buffer.from([0xff, 0xfb, 0x90, 0x44, 0x00]);
      mockLLM().forModel("tts-1").returnsAudio(mp3Header).register();

      const adapter = new MockProviderAdapter();

      const result = await adapter.generateSpeech({
        model: "tts-1",
        input: "Hello world",
        voice: "alloy",
      });

      expect(result.audio).toBeInstanceOf(ArrayBuffer);
      expect(result.model).toBe("tts-1");
      expect(result.cost).toBe(0);
      expect(result.usage.characterCount).toBe("Hello world".length);
    });

    test("maps MIME types to audio formats correctly", async () => {
      const mp3Header = Buffer.from([0xff, 0xfb, 0x90, 0x44, 0x00]);
      mockLLM().forModel("tts-mp3").returnsAudio(mp3Header).register();

      const adapter = new MockProviderAdapter();

      const result = await adapter.generateSpeech({
        model: "tts-mp3",
        input: "test",
        voice: "alloy",
      });

      expect(result.format).toBe("mp3");
    });
  });

  describe("supportsImageGeneration() and supportsSpeechGeneration()", () => {
    test("supportsImageGeneration() always returns true", () => {
      const adapter = new MockProviderAdapter();
      expect(adapter.supportsImageGeneration("any-model")).toBe(true);
    });

    test("supportsSpeechGeneration() always returns true", () => {
      const adapter = new MockProviderAdapter();
      expect(adapter.supportsSpeechGeneration("any-model")).toBe(true);
    });
  });
});
