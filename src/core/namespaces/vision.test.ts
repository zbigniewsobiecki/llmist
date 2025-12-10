/**
 * Tests for VisionNamespace
 *
 * Verifies vision analysis with various image input formats and error handling.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createMockClient, getMockManager, mockLLM } from "../../testing/index.js";

describe("VisionNamespace", () => {
  beforeEach(() => {
    getMockManager().clear();
  });

  afterEach(() => {
    getMockManager().clear();
  });

  describe("analyze()", () => {
    it("analyzes image from Buffer", async () => {
      mockLLM()
        .whenMessageHasImage()
        .returns("This is a photo of a sunset over mountains.")
        .register();

      const client = createMockClient();
      // PNG magic bytes
      const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      const result = await client.vision.analyze({
        model: "openai:gpt-4o",
        image: imageBuffer,
        prompt: "What's in this image?",
      });

      expect(result).toContain("sunset");
    });

    it("analyzes image from Uint8Array", async () => {
      mockLLM()
        .whenMessageHasImage()
        .returns("A beautiful landscape")
        .register();

      const client = createMockClient();
      // JPEG magic bytes
      const imageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

      const result = await client.vision.analyze({
        model: "openai:gpt-4o",
        image: imageData,
        prompt: "Describe this image",
      });

      expect(result).toContain("landscape");
    });

    it("analyzes image from HTTPS URL", async () => {
      mockLLM()
        .whenMessageHasImage()
        .returns("Image shows a diagram")
        .register();

      const client = createMockClient();

      const result = await client.vision.analyze({
        model: "openai:gpt-4o",
        image: "https://example.com/diagram.png",
        prompt: "What does this diagram show?",
      });

      expect(result).toContain("diagram");
    });

    it("analyzes image from HTTP URL", async () => {
      mockLLM()
        .whenMessageHasImage()
        .returns("Chart analysis result")
        .register();

      const client = createMockClient();

      const result = await client.vision.analyze({
        model: "openai:gpt-4o",
        image: "http://example.com/chart.png",
        prompt: "Analyze this chart",
      });

      expect(result).toContain("Chart");
    });

    it("analyzes image from data URL", async () => {
      mockLLM()
        .whenMessageHasImage()
        .returns("Small icon detected")
        .register();

      const client = createMockClient();
      // Small valid PNG as data URL
      const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

      const result = await client.vision.analyze({
        model: "openai:gpt-4o",
        image: dataUrl,
        prompt: "What is this?",
      });

      expect(result).toContain("icon");
    });

    it("analyzes image from base64 string", async () => {
      mockLLM()
        .whenMessageHasImage()
        .returns("Base64 image analyzed successfully")
        .register();

      const client = createMockClient();
      // PNG magic bytes as base64
      const base64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");

      const result = await client.vision.analyze({
        model: "openai:gpt-4o",
        image: base64,
        prompt: "Describe",
      });

      expect(result).toContain("analyzed");
    });

    it("includes system prompt when provided", async () => {
      mockLLM()
        .whenMessageHasImage()
        .returns("Expert analysis: This is a technical diagram.")
        .register();

      const client = createMockClient();
      const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

      const result = await client.vision.analyze({
        model: "openai:gpt-4o",
        image: imageBuffer,
        prompt: "What's in this image?",
        systemPrompt: "You are an expert technical analyst.",
      });

      expect(result).toContain("Expert analysis");
    });

    it("throws error for invalid data URL format", async () => {
      const client = createMockClient();

      await expect(
        client.vision.analyze({
          model: "openai:gpt-4o",
          image: "data:invalid-format",
          prompt: "Describe this",
        }),
      ).rejects.toThrow("Invalid data URL format");
    });

    it("passes maxTokens to the stream", async () => {
      mockLLM()
        .whenMessageHasImage()
        .returns("Brief response")
        .register();

      const client = createMockClient();
      const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

      const result = await client.vision.analyze({
        model: "openai:gpt-4o",
        image: imageBuffer,
        prompt: "Describe briefly",
        maxTokens: 50,
      });

      expect(result).toBe("Brief response");
    });

    it("passes temperature to the stream", async () => {
      mockLLM()
        .whenMessageHasImage()
        .returns("Creative description")
        .register();

      const client = createMockClient();
      const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

      const result = await client.vision.analyze({
        model: "openai:gpt-4o",
        image: imageBuffer,
        prompt: "Describe creatively",
        temperature: 0.9,
      });

      expect(result).toBe("Creative description");
    });
  });

  describe("analyzeWithUsage()", () => {
    it("returns result with usage information", async () => {
      mockLLM()
        .whenMessageHasImage()
        .returns("Detailed analysis of the image")
        .withUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 })
        .register();

      const client = createMockClient();
      const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

      const result = await client.vision.analyzeWithUsage({
        model: "openai:gpt-4o",
        image: imageBuffer,
        prompt: "Analyze this image",
      });

      expect(result.text).toContain("Detailed analysis");
      expect(result.model).toBe("openai:gpt-4o");
      expect(result.usage).toBeDefined();
      expect(result.usage?.inputTokens).toBe(100);
      expect(result.usage?.outputTokens).toBe(50);
    });

    it("handles image from HTTPS URL", async () => {
      mockLLM()
        .whenMessageHasImage()
        .returns("URL image result")
        .withUsage({ inputTokens: 80, outputTokens: 20, totalTokens: 100 })
        .register();

      const client = createMockClient();

      const result = await client.vision.analyzeWithUsage({
        model: "openai:gpt-4o",
        image: "https://example.com/image.jpg",
        prompt: "Describe",
      });

      expect(result.text).toBe("URL image result");
      expect(result.usage?.totalTokens).toBe(100);
    });

    it("handles image from data URL", async () => {
      mockLLM()
        .whenMessageHasImage()
        .returns("Data URL image result")
        .register();

      const client = createMockClient();
      const dataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

      const result = await client.vision.analyzeWithUsage({
        model: "openai:gpt-4o",
        image: dataUrl,
        prompt: "What's this?",
      });

      expect(result.text).toBe("Data URL image result");
    });

    it("throws error for invalid data URL", async () => {
      const client = createMockClient();

      await expect(
        client.vision.analyzeWithUsage({
          model: "openai:gpt-4o",
          image: "data:broken-url",
          prompt: "Describe",
        }),
      ).rejects.toThrow("Invalid data URL format");
    });

    it("handles base64 string with explicit mimeType", async () => {
      mockLLM()
        .whenMessageHasImage()
        .returns("WEBP image result")
        .register();

      const client = createMockClient();
      const base64 = Buffer.from([0x52, 0x49, 0x46, 0x46]).toString("base64");

      const result = await client.vision.analyzeWithUsage({
        model: "openai:gpt-4o",
        image: base64,
        prompt: "Describe",
        mimeType: "image/webp",
      });

      expect(result.text).toBe("WEBP image result");
    });

    it("includes system prompt when provided", async () => {
      mockLLM()
        .whenMessageHasImage()
        .returns("System-guided analysis")
        .register();

      const client = createMockClient();
      const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

      const result = await client.vision.analyzeWithUsage({
        model: "openai:gpt-4o",
        image: imageBuffer,
        prompt: "Analyze",
        systemPrompt: "Be concise",
      });

      expect(result.text).toBe("System-guided analysis");
    });
  });

  describe("supportsModel()", () => {
    it("returns false for unknown models", () => {
      const client = createMockClient();

      // Mock client doesn't have real model registry, so all models return false
      expect(client.vision.supportsModel("unknown-model-xyz")).toBe(false);
    });
  });

  describe("listModels()", () => {
    it("returns array of model IDs", () => {
      const client = createMockClient();

      const models = client.vision.listModels();

      // Should return an array (may be empty for mock client)
      expect(Array.isArray(models)).toBe(true);
    });
  });
});
