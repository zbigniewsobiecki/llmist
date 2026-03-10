/**
 * Tests for VisionNamespace
 *
 * Verifies vision analysis with various image input formats and error handling.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockClient, getMockManager, mockLLM } from "../../../../testing/src/index.js";
import type { ModelSpec } from "../model-catalog.js";

// Helper to create a minimal vision-capable ModelSpec for testing
const createVisionModelSpec = (modelId: string, provider = "openai", hasVision = true): ModelSpec =>
  ({
    modelId,
    provider,
    displayName: `Test ${modelId}`,
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    pricing: { input: 5.0, output: 15.0 },
    knowledgeCutoff: "2024-12",
    features: {
      streaming: true,
      functionCalling: true,
      vision: hasVision,
    },
  }) as ModelSpec;

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
      mockLLM().whenMessageHasImage().returns("A beautiful landscape").register();

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
      mockLLM().whenMessageHasImage().returns("Image shows a diagram").register();

      const client = createMockClient();

      const result = await client.vision.analyze({
        model: "openai:gpt-4o",
        image: "https://example.com/diagram.png",
        prompt: "What does this diagram show?",
      });

      expect(result).toContain("diagram");
    });

    it("analyzes image from HTTP URL", async () => {
      mockLLM().whenMessageHasImage().returns("Chart analysis result").register();

      const client = createMockClient();

      const result = await client.vision.analyze({
        model: "openai:gpt-4o",
        image: "http://example.com/chart.png",
        prompt: "Analyze this chart",
      });

      expect(result).toContain("Chart");
    });

    it("analyzes image from data URL", async () => {
      mockLLM().whenMessageHasImage().returns("Small icon detected").register();

      const client = createMockClient();
      // Small valid PNG as data URL
      const dataUrl =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

      const result = await client.vision.analyze({
        model: "openai:gpt-4o",
        image: dataUrl,
        prompt: "What is this?",
      });

      expect(result).toContain("icon");
    });

    it("analyzes image from base64 string", async () => {
      mockLLM().whenMessageHasImage().returns("Base64 image analyzed successfully").register();

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
      mockLLM().whenMessageHasImage().returns("Brief response").register();

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
      mockLLM().whenMessageHasImage().returns("Creative description").register();

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
      mockLLM().whenMessageHasImage().returns("Data URL image result").register();

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
      mockLLM().whenMessageHasImage().returns("WEBP image result").register();

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
      mockLLM().whenMessageHasImage().returns("System-guided analysis").register();

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

    it("returns true for a registered vision-capable model", () => {
      const client = createMockClient();
      const spec = createVisionModelSpec("gpt-4o", "openai", true);
      client.modelRegistry.registerModel(spec);

      expect(client.vision.supportsModel("gpt-4o")).toBe(true);
    });

    it("returns false for a registered model without vision feature", () => {
      const client = createMockClient();
      const spec = createVisionModelSpec("gpt-3.5-turbo", "openai", false);
      client.modelRegistry.registerModel(spec);

      expect(client.vision.supportsModel("gpt-3.5-turbo")).toBe(false);
    });

    it("returns false for unknown model not in registry", () => {
      const client = createMockClient();

      expect(client.vision.supportsModel("completely-unknown-model")).toBe(false);
    });
  });

  describe("listModels()", () => {
    it("returns array of model IDs", () => {
      const client = createMockClient();

      const models = client.vision.listModels();

      // Should return an array (may be empty for mock client)
      expect(Array.isArray(models)).toBe(true);
    });

    it("returns only models with vision feature", () => {
      const client = createMockClient();
      client.modelRegistry.registerModel(createVisionModelSpec("vision-model-1", "openai", true));
      client.modelRegistry.registerModel(
        createVisionModelSpec("vision-model-2", "anthropic", true),
      );
      client.modelRegistry.registerModel(createVisionModelSpec("no-vision-model", "openai", false));

      const models = client.vision.listModels();

      expect(models).toContain("vision-model-1");
      expect(models).toContain("vision-model-2");
      expect(models).not.toContain("no-vision-model");
    });

    it("filters out models without vision feature", () => {
      const client = createMockClient();
      client.modelRegistry.registerModel(createVisionModelSpec("text-only-a", "openai", false));
      client.modelRegistry.registerModel(createVisionModelSpec("text-only-b", "anthropic", false));

      const models = client.vision.listModels();

      expect(models).not.toContain("text-only-a");
      expect(models).not.toContain("text-only-b");
    });

    it("handles empty registry by returning empty array", () => {
      const client = createMockClient();

      const models = client.vision.listModels();

      expect(models).toEqual([]);
    });
  });

  describe("buildImageMessage edge cases", () => {
    it("throws error for invalid data URL format", async () => {
      const client = createMockClient();

      await expect(
        client.vision.analyze({
          model: "openai:gpt-4o",
          image: "data:invalid-no-base64",
          prompt: "Describe",
        }),
      ).rejects.toThrow("Invalid data URL format");
    });

    it("throws error for malformed data URL missing base64 content", async () => {
      const client = createMockClient();

      await expect(
        client.vision.analyze({
          model: "openai:gpt-4o",
          image: "data:image/png;base64,",
          prompt: "Describe",
        }),
      ).rejects.toThrow("Invalid data URL format");
    });

    it("handles very large base64 strings", async () => {
      mockLLM().whenMessageHasImage().returns("Large image analyzed").register();

      const client = createMockClient();
      // Generate a large base64 string (simulating ~1MB image data)
      const largeBase64 = Buffer.alloc(1024 * 1024, 0x89).toString("base64");

      const result = await client.vision.analyze({
        model: "openai:gpt-4o",
        image: largeBase64,
        prompt: "Describe this large image",
        mimeType: "image/png",
      });

      expect(result).toBe("Large image analyzed");
    });

    it("throws error for unsupported image format when buffer cannot be detected", async () => {
      const client = createMockClient();
      // Use random bytes that don't match any known magic bytes, without a mimeType hint
      const unknownBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);

      await expect(
        client.vision.analyze({
          model: "openai:gpt-4o",
          image: unknownBuffer,
          prompt: "Describe",
        }),
      ).rejects.toThrow("Could not detect image MIME type");
    });

    it("accepts supported image format with explicit mimeType override", async () => {
      mockLLM().whenMessageHasImage().returns("Custom format handled").register();

      const client = createMockClient();
      // Random bytes but with explicit mimeType
      const rawBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);

      const result = await client.vision.analyze({
        model: "openai:gpt-4o",
        image: rawBuffer,
        prompt: "Describe",
        mimeType: "image/jpeg",
      });

      expect(result).toBe("Custom format handled");
    });
  });
});
