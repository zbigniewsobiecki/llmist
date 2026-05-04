import type OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_CHARS_PER_TOKEN } from "./constants.js";
import { createOpenAIProviderFromEnv, OpenAIChatProvider } from "./openai.js";
import { openaiImageModels } from "./openai-image-models.js";
import { openaiSpeechModels } from "./openai-speech-models.js";

describe("OpenAIChatProvider", () => {
  describe("supports", () => {
    it("supports openai provider", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenAIChatProvider(mockClient);

      expect(provider.supports({ provider: "openai", name: "gpt-4" })).toBe(true);
    });

    it("does not support other providers", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenAIChatProvider(mockClient);

      expect(provider.supports({ provider: "anthropic", name: "claude" })).toBe(false);
      expect(provider.supports({ provider: "gemini", name: "gemini-pro" })).toBe(false);
    });
  });

  describe("stream", () => {
    it("maps messages correctly", async () => {
      const createSpy = vi.fn().mockResolvedValue(
        (async function* () {
          yield {
            choices: [{ delta: { content: "test" }, finish_reason: null }],
          };
        })(),
      );

      const mockClient = {
        chat: {
          completions: {
            create: createSpy,
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenAIChatProvider(mockClient);

      const options = {
        model: "gpt-4",
        messages: [
          { role: "system" as const, content: "System" },
          { role: "user" as const, content: "Hello" },
          { role: "assistant" as const, content: "Hi" },
        ],
      };

      await provider.stream(options, { provider: "openai", name: "gpt-4" }).next();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-4",
          messages: [
            { role: "system", content: "System", name: undefined },
            { role: "user", content: "Hello", name: undefined },
            { role: "assistant", content: "Hi", name: undefined },
          ],
          stream: true,
        }),
        undefined, // signal options
      );
    });

    it("includes optional parameters", async () => {
      const createSpy = vi.fn().mockResolvedValue((async function* () {})());

      const mockClient = {
        chat: {
          completions: {
            create: createSpy,
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenAIChatProvider(mockClient);

      const options = {
        model: "gpt-4",
        messages: [{ role: "user" as const, content: "Test" }],
        maxTokens: 100,
        temperature: 0.7,
        topP: 0.9,
        stopSequences: ["STOP"],
      };

      await provider.stream(options, { provider: "openai", name: "gpt-4" }).next();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          max_completion_tokens: 100,
          temperature: 0.7,
          top_p: 0.9,
          stop: ["STOP"],
        }),
        undefined, // signal options
      );
    });

    it("omits temperature when the model does not support it", async () => {
      const createSpy = vi.fn().mockResolvedValue((async function* () {})());

      const mockClient = {
        chat: {
          completions: {
            create: createSpy,
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenAIChatProvider(mockClient);

      const options = {
        model: "openai:gpt-5-nano",
        messages: [{ role: "user" as const, content: "Test" }],
        temperature: 0.5,
        extra: { temperature: 0.25, foo: "bar" },
      };

      // Pass a spec with supportsTemperature: false
      const spec = {
        provider: "openai",
        modelId: "gpt-5-nano",
        displayName: "GPT-5 Nano",
        contextWindow: 400000,
        maxOutputTokens: 128000,
        pricing: { input: 0.25, output: 2.0 },
        knowledgeCutoff: "2024-05-31",
        features: {
          streaming: true,
          functionCalling: true,
          vision: true,
          structuredOutputs: true,
          fineTuning: true,
        },
        metadata: { supportsTemperature: false },
      };

      await provider.stream(options, { provider: "openai", name: "gpt-5-nano" }, spec).next();

      expect(createSpy).toHaveBeenCalledTimes(1);
      const payload = createSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload).not.toHaveProperty("temperature");
      expect(payload).toHaveProperty("foo", "bar");
    });

    it("extracts text from chunks", async () => {
      const mockStream = (async function* () {
        yield {
          choices: [{ delta: { content: "Hello" }, finish_reason: null }],
        };
        yield {
          choices: [{ delta: { content: " world" }, finish_reason: null }],
        };
      })();

      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue(mockStream),
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenAIChatProvider(mockClient);

      const stream = provider.stream(
        {
          model: "gpt-4",
          messages: [{ role: "user" as const, content: "Test" }],
        },
        { provider: "openai", name: "gpt-4" },
      );

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        { text: "Hello", rawEvent: expect.any(Object) },
        { text: " world", rawEvent: expect.any(Object) },
      ]);
    });

    it("detects finish reason", async () => {
      const mockStream = (async function* () {
        yield {
          choices: [{ delta: { content: "Done" }, finish_reason: null }],
        };
        yield {
          choices: [{ delta: {}, finish_reason: "stop" }],
        };
      })();

      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue(mockStream),
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenAIChatProvider(mockClient);

      const stream = provider.stream(
        {
          model: "gpt-4",
          messages: [{ role: "user" as const, content: "Test" }],
        },
        { provider: "openai", name: "gpt-4" },
      );

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toContainEqual(expect.objectContaining({ text: "", finishReason: "stop" }));
    });

    it("handles multiple choices by joining text", async () => {
      const mockStream = (async function* () {
        yield {
          choices: [
            { delta: { content: "First" }, finish_reason: null },
            { delta: { content: "Second" }, finish_reason: null },
          ],
        };
      })();

      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue(mockStream),
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenAIChatProvider(mockClient);

      const stream = provider.stream(
        {
          model: "gpt-4",
          messages: [{ role: "user" as const, content: "Test" }],
        },
        { provider: "openai", name: "gpt-4" },
      );

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks[0]).toMatchObject({ text: "FirstSecond" });
    });
  });

  describe("abort signal propagation", () => {
    it("passes abort signal to SDK when provided", async () => {
      const createSpy = vi.fn().mockResolvedValue((async function* () {})());

      const mockClient = {
        chat: {
          completions: {
            create: createSpy,
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenAIChatProvider(mockClient);

      const controller = new AbortController();
      const options = {
        model: "gpt-4",
        messages: [{ role: "user" as const, content: "Test" }],
        signal: controller.signal,
      };

      await provider.stream(options, { provider: "openai", name: "gpt-4" }).next();

      expect(createSpy).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it("does not pass signal options when signal is not provided", async () => {
      const createSpy = vi.fn().mockResolvedValue((async function* () {})());

      const mockClient = {
        chat: {
          completions: {
            create: createSpy,
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenAIChatProvider(mockClient);

      const options = {
        model: "gpt-4",
        messages: [{ role: "user" as const, content: "Test" }],
      };

      await provider.stream(options, { provider: "openai", name: "gpt-4" }).next();

      // When no signal is provided, second argument should be undefined
      expect(createSpy).toHaveBeenCalledWith(expect.any(Object), undefined);
    });
  });

  describe("countTokens", () => {
    it("counts tokens for simple messages", async () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenAIChatProvider(mockClient);

      const count = await provider.countTokens(
        [{ role: "user" as const, content: "Hello world" }],
        { provider: "openai", name: "gpt-4" },
      );

      // Token count should be reasonable (>0, <100 for "Hello world")
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(100);
    });

    it("counts tokens for multiple messages", async () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenAIChatProvider(mockClient);

      const count = await provider.countTokens(
        [
          { role: "system" as const, content: "You are a helpful assistant" },
          { role: "user" as const, content: "Hello" },
          { role: "assistant" as const, content: "Hi there!" },
          { role: "user" as const, content: "How are you?" },
        ],
        { provider: "openai", name: "gpt-4" },
      );

      expect(count).toBeGreaterThan(0);
    });

    it("handles messages with names", async () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenAIChatProvider(mockClient);

      const count = await provider.countTokens(
        [{ role: "user" as const, content: "Test", name: "Alice" }],
        { provider: "openai", name: "gpt-4" },
      );

      expect(count).toBeGreaterThan(0);
    });

    it("uses fallback estimation for unknown models", async () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenAIChatProvider(mockClient);

      const count = await provider.countTokens(
        [{ role: "user" as const, content: "Hello world" }],
        { provider: "openai", name: "unknown-model-xyz" },
      );

      // Should still return a reasonable count using gpt-4o fallback
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(100);
    });

    it("handles empty message content with defensive checks", async () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenAIChatProvider(mockClient);

      const count = await provider.countTokens([{ role: "user" as const, content: "" }], {
        provider: "openai",
        name: "gpt-4",
      });

      // Should handle empty content gracefully
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it("properly cleans up encoding resources", async () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenAIChatProvider(mockClient);

      // This test verifies that encoding.free() is called even if there's an error
      // We can't easily test this directly, but we can verify the function completes
      await expect(
        provider.countTokens([{ role: "user" as const, content: "Test" }], {
          provider: "openai",
          name: "gpt-4",
        }),
      ).resolves.toBeGreaterThan(0);
    });

    it("returns reasonable counts for long messages", async () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenAIChatProvider(mockClient);

      const longContent = "This is a test message. ".repeat(100);
      const count = await provider.countTokens([{ role: "user" as const, content: longContent }], {
        provider: "openai",
        name: "gpt-4",
      });

      // Long message should have more tokens
      expect(count).toBeGreaterThan(100);
    });
  });

  describe("multimodal content conversion", () => {
    it("should convert URL image to OpenAI image_url format", async () => {
      const createSpy = vi.fn().mockResolvedValue((async function* () {})());

      const mockClient = {
        chat: {
          completions: {
            create: createSpy,
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenAIChatProvider(mockClient);

      const options = {
        model: "gpt-4o",
        messages: [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "What is in this image?" },
              {
                type: "image" as const,
                source: {
                  type: "url" as const,
                  url: "https://example.com/image.png",
                },
              },
            ],
          },
        ],
      };

      await provider.stream(options, { provider: "openai", name: "gpt-4o" }).next();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "What is in this image?" },
                {
                  type: "image_url",
                  image_url: { url: "https://example.com/image.png" },
                },
              ],
            },
          ],
        }),
        undefined,
      );
    });

    it("should convert base64 image to data URL format", async () => {
      const createSpy = vi.fn().mockResolvedValue((async function* () {})());

      const mockClient = {
        chat: {
          completions: {
            create: createSpy,
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenAIChatProvider(mockClient);

      const options = {
        model: "gpt-4o",
        messages: [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "Describe this" },
              {
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  mediaType: "image/png",
                  data: "iVBORw0KGgoAAAANSUhEUg==",
                },
              },
            ],
          },
        ],
      };

      await provider.stream(options, { provider: "openai", name: "gpt-4o" }).next();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Describe this" },
                {
                  type: "image_url",
                  image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" },
                },
              ],
            },
          ],
        }),
        undefined,
      );
    });

    it("should handle multiple images in one message", async () => {
      const createSpy = vi.fn().mockResolvedValue((async function* () {})());

      const mockClient = {
        chat: {
          completions: {
            create: createSpy,
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenAIChatProvider(mockClient);

      const options = {
        model: "gpt-4o",
        messages: [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "Compare these images" },
              {
                type: "image" as const,
                source: { type: "url" as const, url: "https://example.com/image1.png" },
              },
              {
                type: "image" as const,
                source: { type: "url" as const, url: "https://example.com/image2.png" },
              },
            ],
          },
        ],
      };

      await provider.stream(options, { provider: "openai", name: "gpt-4o" }).next();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Compare these images" },
                { type: "image_url", image_url: { url: "https://example.com/image1.png" } },
                { type: "image_url", image_url: { url: "https://example.com/image2.png" } },
              ],
            },
          ],
        }),
        undefined,
      );
    });

    it("should throw error for audio content", async () => {
      const createSpy = vi.fn().mockResolvedValue((async function* () {})());

      const mockClient = {
        chat: {
          completions: {
            create: createSpy,
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenAIChatProvider(mockClient);

      const options = {
        model: "gpt-4o",
        messages: [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "Transcribe this" },
              {
                type: "audio" as const,
                source: {
                  type: "base64" as const,
                  mediaType: "audio/mp3",
                  data: "SGVsbG8gV29ybGQ=",
                },
              },
            ],
          },
        ],
      };

      const stream = provider.stream(options, { provider: "openai", name: "gpt-4o" });

      await expect(stream.next()).rejects.toThrow(
        "OpenAI chat completions do not support audio input",
      );
    });

    it("should keep simple string content as-is for user messages", async () => {
      const createSpy = vi.fn().mockResolvedValue((async function* () {})());

      const mockClient = {
        chat: {
          completions: {
            create: createSpy,
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenAIChatProvider(mockClient);

      const options = {
        model: "gpt-4",
        messages: [{ role: "user" as const, content: "Simple text message" }],
      };

      await provider.stream(options, { provider: "openai", name: "gpt-4" }).next();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: "Simple text message", name: undefined }],
        }),
        undefined,
      );
    });

    it("should extract text from multimodal content for system messages", async () => {
      const createSpy = vi.fn().mockResolvedValue((async function* () {})());

      const mockClient = {
        chat: {
          completions: {
            create: createSpy,
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenAIChatProvider(mockClient);

      const options = {
        model: "gpt-4",
        messages: [
          {
            role: "system" as const,
            content: [
              { type: "text" as const, text: "You are helpful" },
              { type: "text" as const, text: " and concise" },
            ],
          },
        ],
      };

      await provider.stream(options, { provider: "openai", name: "gpt-4" }).next();

      // System messages should have text extracted and concatenated
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "system", content: "You are helpful and concise", name: undefined }],
        }),
        undefined,
      );
    });
  });

  describe("image generation", () => {
    describe("getImageModelSpecs", () => {
      it("returns the full list of openai image model specs", () => {
        const mockClient = {} as OpenAI;
        const provider = new OpenAIChatProvider(mockClient);

        const specs = provider.getImageModelSpecs();

        expect(specs).toBe(openaiImageModels);
        expect(specs.length).toBeGreaterThan(0);
        // Should include DALL-E 2, DALL-E 3, and GPT Image models
        const modelIds = specs.map((s) => s.modelId);
        expect(modelIds).toContain("dall-e-2");
        expect(modelIds).toContain("dall-e-3");
        expect(modelIds).toContain("gpt-image-1");
      });
    });

    describe("supportsImageGeneration", () => {
      it("returns true for DALL-E 3", () => {
        const mockClient = {} as OpenAI;
        const provider = new OpenAIChatProvider(mockClient);

        expect(provider.supportsImageGeneration("dall-e-3")).toBe(true);
      });

      it("returns true for DALL-E 2", () => {
        const mockClient = {} as OpenAI;
        const provider = new OpenAIChatProvider(mockClient);

        expect(provider.supportsImageGeneration("dall-e-2")).toBe(true);
      });

      it("returns true for GPT Image models", () => {
        const mockClient = {} as OpenAI;
        const provider = new OpenAIChatProvider(mockClient);

        expect(provider.supportsImageGeneration("gpt-image-1")).toBe(true);
        expect(provider.supportsImageGeneration("gpt-image-1.5")).toBe(true);
        expect(provider.supportsImageGeneration("gpt-image-1-mini")).toBe(true);
      });

      it("returns false for non-image models", () => {
        const mockClient = {} as OpenAI;
        const provider = new OpenAIChatProvider(mockClient);

        expect(provider.supportsImageGeneration("gpt-4")).toBe(false);
        expect(provider.supportsImageGeneration("gpt-4o")).toBe(false);
        expect(provider.supportsImageGeneration("dall-e-unknown")).toBe(false);
      });
    });

    describe("generateImage", () => {
      it("generates image with DALL-E 3 including quality and response_format", async () => {
        const generateSpy = vi.fn().mockResolvedValue({
          data: [{ url: "https://example.com/dalle3-image.png", b64_json: null }],
        });

        const mockClient = {
          images: {
            generate: generateSpy,
          },
        } as unknown as OpenAI;

        const provider = new OpenAIChatProvider(mockClient);

        const result = await provider.generateImage({
          model: "dall-e-3",
          prompt: "A futuristic city skyline",
          size: "1024x1024",
          quality: "hd",
          responseFormat: "url",
        });

        expect(generateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            model: "dall-e-3",
            prompt: "A futuristic city skyline",
            size: "1024x1024",
            quality: "hd",
            response_format: "url",
          }),
        );
        // DALL-E 3 should NOT be flagged as isDallE2 or isGptImage
        const callArgs = generateSpy.mock.calls[0][0] as Record<string, unknown>;
        expect(callArgs).toHaveProperty("quality");
        expect(callArgs).toHaveProperty("response_format");
        expect(result.images).toHaveLength(1);
        expect(result.images[0].url).toBe("https://example.com/dalle3-image.png");
        expect(result.model).toBe("dall-e-3");
      });

      it("generates image with DALL-E 3 using default quality when not specified", async () => {
        const generateSpy = vi.fn().mockResolvedValue({
          data: [{ url: "https://example.com/dalle3-standard.png", b64_json: null }],
        });

        const mockClient = {
          images: {
            generate: generateSpy,
          },
        } as unknown as OpenAI;

        const provider = new OpenAIChatProvider(mockClient);

        await provider.generateImage({
          model: "dall-e-3",
          prompt: "A peaceful mountain landscape",
        });

        const callArgs = generateSpy.mock.calls[0][0] as Record<string, unknown>;
        // quality defaults to "standard" from spec
        expect(callArgs).toHaveProperty("quality", "standard");
        // response_format defaults to "url" when not specified
        expect(callArgs).toHaveProperty("response_format", "url");
      });

      it("generates image with DALL-E 2 without quality parameter", async () => {
        const generateSpy = vi.fn().mockResolvedValue({
          data: [{ url: "https://example.com/dalle2-image.png", b64_json: null }],
        });

        const mockClient = {
          images: {
            generate: generateSpy,
          },
        } as unknown as OpenAI;

        const provider = new OpenAIChatProvider(mockClient);

        const result = await provider.generateImage({
          model: "dall-e-2",
          prompt: "A cartoon cat",
          size: "512x512",
          n: 2,
        });

        expect(generateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            model: "dall-e-2",
            prompt: "A cartoon cat",
            size: "512x512",
            n: 2,
          }),
        );

        // DALL-E 2 must NOT include the quality parameter
        const callArgs = generateSpy.mock.calls[0][0] as Record<string, unknown>;
        expect(callArgs).not.toHaveProperty("quality");
        // DALL-E 2 must NOT include response_format
        expect(callArgs).not.toHaveProperty("response_format");

        expect(result.images).toHaveLength(1);
        expect(result.model).toBe("dall-e-2");
        expect(result.usage.size).toBe("512x512");
      });

      it("generates image with GPT Image model without quality or response_format", async () => {
        const generateSpy = vi.fn().mockResolvedValue({
          data: [{ url: "https://example.com/gpt-image.png", b64_json: null }],
        });

        const mockClient = {
          images: {
            generate: generateSpy,
          },
        } as unknown as OpenAI;

        const provider = new OpenAIChatProvider(mockClient);

        const result = await provider.generateImage({
          model: "gpt-image-1",
          prompt: "A photorealistic apple",
          size: "1024x1024",
          quality: "high",
        });

        expect(generateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            model: "gpt-image-1",
            prompt: "A photorealistic apple",
            size: "1024x1024",
          }),
        );

        // GPT Image models must NOT include quality (uses different API param) or response_format
        const callArgs = generateSpy.mock.calls[0][0] as Record<string, unknown>;
        expect(callArgs).not.toHaveProperty("quality");
        expect(callArgs).not.toHaveProperty("response_format");

        expect(result.images).toHaveLength(1);
        expect(result.model).toBe("gpt-image-1");
      });

      it("generates image with gpt-image-1.5 model (also a GPT Image model)", async () => {
        const generateSpy = vi.fn().mockResolvedValue({
          data: [{ url: "https://example.com/gpt-image-1-5.png", b64_json: null }],
        });

        const mockClient = {
          images: {
            generate: generateSpy,
          },
        } as unknown as OpenAI;

        const provider = new OpenAIChatProvider(mockClient);

        await provider.generateImage({
          model: "gpt-image-1.5",
          prompt: "A vibrant sunset",
        });

        // gpt-image-1.5 starts with "gpt-image" so isGptImage is true
        const callArgs = generateSpy.mock.calls[0][0] as Record<string, unknown>;
        expect(callArgs).not.toHaveProperty("quality");
        expect(callArgs).not.toHaveProperty("response_format");
      });

      it("returns correct usage metadata in result", async () => {
        const generateSpy = vi.fn().mockResolvedValue({
          data: [
            { url: "https://example.com/img1.png", b64_json: null },
            { url: "https://example.com/img2.png", b64_json: null },
          ],
        });

        const mockClient = {
          images: {
            generate: generateSpy,
          },
        } as unknown as OpenAI;

        const provider = new OpenAIChatProvider(mockClient);

        const result = await provider.generateImage({
          model: "dall-e-2",
          prompt: "Two cute dogs",
          size: "256x256",
          n: 2,
        });

        expect(result.usage).toEqual({
          imagesGenerated: 2,
          size: "256x256",
          quality: "standard",
        });
      });

      it("handles response with revised_prompt", async () => {
        const generateSpy = vi.fn().mockResolvedValue({
          data: [
            {
              url: "https://example.com/revised.png",
              b64_json: null,
              revised_prompt: "A vivid, photorealistic futuristic city skyline at dusk",
            },
          ],
        });

        const mockClient = {
          images: {
            generate: generateSpy,
          },
        } as unknown as OpenAI;

        const provider = new OpenAIChatProvider(mockClient);

        const result = await provider.generateImage({
          model: "dall-e-3",
          prompt: "Futuristic city at dusk",
        });

        expect(result.images[0].revisedPrompt).toBe(
          "A vivid, photorealistic futuristic city skyline at dusk",
        );
        expect(result.images[0].url).toBe("https://example.com/revised.png");
      });

      it("handles empty data array from API response", async () => {
        const generateSpy = vi.fn().mockResolvedValue({
          data: [],
        });

        const mockClient = {
          images: {
            generate: generateSpy,
          },
        } as unknown as OpenAI;

        const provider = new OpenAIChatProvider(mockClient);

        const result = await provider.generateImage({
          model: "dall-e-3",
          prompt: "Nothing",
        });

        expect(result.images).toHaveLength(0);
        expect(result.usage.imagesGenerated).toBe(0);
      });

      it("uses default size and n=1 when not specified", async () => {
        const generateSpy = vi.fn().mockResolvedValue({
          data: [{ url: "https://example.com/default.png", b64_json: null }],
        });

        const mockClient = {
          images: {
            generate: generateSpy,
          },
        } as unknown as OpenAI;

        const provider = new OpenAIChatProvider(mockClient);

        await provider.generateImage({
          model: "dall-e-3",
          prompt: "A simple test",
        });

        const callArgs = generateSpy.mock.calls[0][0] as Record<string, unknown>;
        expect(callArgs).toHaveProperty("n", 1);
        // Should use spec's defaultSize "1024x1024"
        expect(callArgs).toHaveProperty("size", "1024x1024");
      });
    });
  });

  describe("speech generation", () => {
    describe("getSpeechModelSpecs", () => {
      it("returns the full list of openai speech model specs", () => {
        const mockClient = {} as OpenAI;
        const provider = new OpenAIChatProvider(mockClient);

        const specs = provider.getSpeechModelSpecs();

        expect(specs).toBe(openaiSpeechModels);
        expect(specs.length).toBeGreaterThan(0);
        // Should include tts-1, tts-1-hd models
        const modelIds = specs.map((s) => s.modelId);
        expect(modelIds).toContain("tts-1");
        expect(modelIds).toContain("tts-1-hd");
      });

      it("returns specs with correct structure", () => {
        const mockClient = {} as OpenAI;
        const provider = new OpenAIChatProvider(mockClient);

        const specs = provider.getSpeechModelSpecs();
        const tts1Spec = specs.find((s) => s.modelId === "tts-1");

        expect(tts1Spec).toBeDefined();
        expect(tts1Spec?.provider).toBe("openai");
        expect(tts1Spec?.defaultVoice).toBe("alloy");
        expect(tts1Spec?.defaultFormat).toBe("mp3");
        expect(tts1Spec?.voices).toContain("alloy");
        expect(tts1Spec?.voices).toContain("nova");
      });
    });

    describe("supportsSpeechGeneration", () => {
      it("returns true for tts-1", () => {
        const mockClient = {} as OpenAI;
        const provider = new OpenAIChatProvider(mockClient);

        expect(provider.supportsSpeechGeneration("tts-1")).toBe(true);
      });

      it("returns true for tts-1-hd", () => {
        const mockClient = {} as OpenAI;
        const provider = new OpenAIChatProvider(mockClient);

        expect(provider.supportsSpeechGeneration("tts-1-hd")).toBe(true);
      });

      it("returns false for non-speech models", () => {
        const mockClient = {} as OpenAI;
        const provider = new OpenAIChatProvider(mockClient);

        expect(provider.supportsSpeechGeneration("gpt-4")).toBe(false);
        expect(provider.supportsSpeechGeneration("dall-e-3")).toBe(false);
        expect(provider.supportsSpeechGeneration("tts-unknown")).toBe(false);
      });
    });

    describe("generateSpeech", () => {
      it("calls client.audio.speech.create and returns ArrayBuffer", async () => {
        const mockArrayBuffer = new ArrayBuffer(1024);
        const speechCreateSpy = vi.fn().mockResolvedValue({
          arrayBuffer: async () => mockArrayBuffer,
        });

        const mockClient = {
          audio: {
            speech: {
              create: speechCreateSpy,
            },
          },
        } as unknown as OpenAI;

        const provider = new OpenAIChatProvider(mockClient);

        const result = await provider.generateSpeech({
          model: "tts-1",
          input: "Hello, world!",
          voice: "alloy",
          responseFormat: "mp3",
          speed: 1.0,
        });

        expect(speechCreateSpy).toHaveBeenCalledTimes(1);
        expect(result.audio).toBe(mockArrayBuffer);
        expect(result.model).toBe("tts-1");
        expect(result.format).toBe("mp3");
      });

      it("resolves default voice to alloy when not specified", async () => {
        const speechCreateSpy = vi.fn().mockResolvedValue({
          arrayBuffer: async () => new ArrayBuffer(0),
        });

        const mockClient = {
          audio: {
            speech: {
              create: speechCreateSpy,
            },
          },
        } as unknown as OpenAI;

        const provider = new OpenAIChatProvider(mockClient);

        await provider.generateSpeech({
          model: "tts-1",
          input: "Test input",
        });

        expect(speechCreateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            voice: "alloy",
          }),
        );
      });

      it("resolves default format to mp3 when not specified", async () => {
        const speechCreateSpy = vi.fn().mockResolvedValue({
          arrayBuffer: async () => new ArrayBuffer(0),
        });

        const mockClient = {
          audio: {
            speech: {
              create: speechCreateSpy,
            },
          },
        } as unknown as OpenAI;

        const provider = new OpenAIChatProvider(mockClient);

        await provider.generateSpeech({
          model: "tts-1",
          input: "Test input",
        });

        expect(speechCreateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            response_format: "mp3",
          }),
        );

        const result = await provider.generateSpeech({
          model: "tts-1",
          input: "Test input",
        });
        expect(result.format).toBe("mp3");
      });

      it("resolves default speed to 1.0 when not specified", async () => {
        const speechCreateSpy = vi.fn().mockResolvedValue({
          arrayBuffer: async () => new ArrayBuffer(0),
        });

        const mockClient = {
          audio: {
            speech: {
              create: speechCreateSpy,
            },
          },
        } as unknown as OpenAI;

        const provider = new OpenAIChatProvider(mockClient);

        await provider.generateSpeech({
          model: "tts-1",
          input: "Test input",
        });

        expect(speechCreateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            speed: 1.0,
          }),
        );
      });

      it("uses custom voice, format, and speed when provided", async () => {
        const speechCreateSpy = vi.fn().mockResolvedValue({
          arrayBuffer: async () => new ArrayBuffer(0),
        });

        const mockClient = {
          audio: {
            speech: {
              create: speechCreateSpy,
            },
          },
        } as unknown as OpenAI;

        const provider = new OpenAIChatProvider(mockClient);

        await provider.generateSpeech({
          model: "tts-1-hd",
          input: "Custom params test",
          voice: "nova",
          responseFormat: "opus",
          speed: 1.5,
        });

        expect(speechCreateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            model: "tts-1-hd",
            input: "Custom params test",
            voice: "nova",
            response_format: "opus",
            speed: 1.5,
          }),
        );
      });

      it("includes cost calculation in the result", async () => {
        const speechCreateSpy = vi.fn().mockResolvedValue({
          arrayBuffer: async () => new ArrayBuffer(0),
        });

        const mockClient = {
          audio: {
            speech: {
              create: speechCreateSpy,
            },
          },
        } as unknown as OpenAI;

        const provider = new OpenAIChatProvider(mockClient);

        const input = "Hello, this is a test for cost calculation.";
        const result = await provider.generateSpeech({
          model: "tts-1",
          input,
        });

        // tts-1 pricing: $0.000015 per character
        const expectedCost = input.length * 0.000015;
        expect(result.cost).toBeDefined();
        expect(result.cost).toBeCloseTo(expectedCost, 10);
      });

      it("includes cost calculation for tts-1-hd (higher rate)", async () => {
        const speechCreateSpy = vi.fn().mockResolvedValue({
          arrayBuffer: async () => new ArrayBuffer(0),
        });

        const mockClient = {
          audio: {
            speech: {
              create: speechCreateSpy,
            },
          },
        } as unknown as OpenAI;

        const provider = new OpenAIChatProvider(mockClient);

        const input = "HD quality test";
        const result = await provider.generateSpeech({
          model: "tts-1-hd",
          input,
        });

        // tts-1-hd pricing: $0.00003 per character (2x tts-1)
        const expectedCost = input.length * 0.00003;
        expect(result.cost).toBeDefined();
        expect(result.cost).toBeCloseTo(expectedCost, 10);
      });

      it("returns correct usage with character count", async () => {
        const speechCreateSpy = vi.fn().mockResolvedValue({
          arrayBuffer: async () => new ArrayBuffer(0),
        });

        const mockClient = {
          audio: {
            speech: {
              create: speechCreateSpy,
            },
          },
        } as unknown as OpenAI;

        const provider = new OpenAIChatProvider(mockClient);

        const input = "Count my characters";
        const result = await provider.generateSpeech({
          model: "tts-1",
          input,
        });

        expect(result.usage).toEqual({
          characterCount: input.length,
        });
      });

      it("passes the input text to the API", async () => {
        const speechCreateSpy = vi.fn().mockResolvedValue({
          arrayBuffer: async () => new ArrayBuffer(0),
        });

        const mockClient = {
          audio: {
            speech: {
              create: speechCreateSpy,
            },
          },
        } as unknown as OpenAI;

        const provider = new OpenAIChatProvider(mockClient);

        const inputText = "The quick brown fox jumps over the lazy dog";
        await provider.generateSpeech({
          model: "tts-1",
          input: inputText,
        });

        expect(speechCreateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            input: inputText,
            model: "tts-1",
          }),
        );
      });
    });
  });

  describe("normalizeProviderStream with usage", () => {
    it("should extract usage with cached tokens", async () => {
      const mockStream = (async function* () {
        yield {
          choices: [{ delta: { content: "Hello" }, finish_reason: null }],
        };
        yield {
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
            prompt_tokens_details: { cached_tokens: 25 },
          },
        };
      })();

      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue(mockStream),
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenAIChatProvider(mockClient);

      const stream = provider.stream(
        {
          model: "gpt-4",
          messages: [{ role: "user" as const, content: "Test" }],
        },
        { provider: "openai", name: "gpt-4" },
      );

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const finalChunk = chunks.find((c) => c.usage);
      expect(finalChunk).toBeDefined();
      expect(finalChunk?.usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cachedInputTokens: 25,
      });
    });

    it("should handle usage without cached tokens", async () => {
      const mockStream = (async function* () {
        yield {
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
            // No prompt_tokens_details
          },
        };
      })();

      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue(mockStream),
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenAIChatProvider(mockClient);

      const stream = provider.stream(
        {
          model: "gpt-4",
          messages: [{ role: "user" as const, content: "Test" }],
        },
        { provider: "openai", name: "gpt-4" },
      );

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const finalChunk = chunks.find((c) => c.usage);
      expect(finalChunk?.usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cachedInputTokens: 0,
      });
    });

    it("should handle empty choices array", async () => {
      const mockStream = (async function* () {
        yield {
          choices: [],
        };
        yield {
          choices: [{ delta: { content: "Hello" }, finish_reason: null }],
        };
      })();

      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue(mockStream),
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenAIChatProvider(mockClient);

      const stream = provider.stream(
        {
          model: "gpt-4",
          messages: [{ role: "user" as const, content: "Test" }],
        },
        { provider: "openai", name: "gpt-4" },
      );

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      // Should only get the chunk with actual content
      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe("Hello");
    });
  });

  describe("reasoning config mapping", () => {
    it("passes reasoning params to API when options.reasoning is provided", async () => {
      const createSpy = vi.fn().mockResolvedValue((async function* () {})());

      const mockClient = {
        chat: {
          completions: {
            create: createSpy,
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenAIChatProvider(mockClient);

      await provider
        .stream(
          {
            model: "o1",
            messages: [{ role: "user" as const, content: "Complex reasoning task" }],
            reasoning: { enabled: true, effort: "high" },
          },
          { provider: "openai", name: "o1" },
        )
        .next();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoning: { effort: "high" },
        }),
        undefined,
      );
    });

    it("omits reasoning param when options.reasoning is not set", async () => {
      const createSpy = vi.fn().mockResolvedValue((async function* () {})());

      const mockClient = {
        chat: {
          completions: {
            create: createSpy,
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenAIChatProvider(mockClient);

      await provider
        .stream(
          {
            model: "gpt-4o",
            messages: [{ role: "user" as const, content: "Simple task" }],
          },
          { provider: "openai", name: "gpt-4o" },
        )
        .next();

      const payload = createSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload).not.toHaveProperty("reasoning");
    });
  });

  describe("countTokens with multimodal content", () => {
    it("counts tokens for messages with text and image parts", async () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenAIChatProvider(mockClient);

      const count = await provider.countTokens(
        [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "What is in this image?" },
              {
                type: "image" as const,
                source: { type: "url" as const, url: "https://example.com/image.png" },
              },
            ],
          },
        ],
        { provider: "openai", name: "gpt-4o" },
      );

      // Should include text tokens + image estimate (765 tokens)
      expect(count).toBeGreaterThan(765);
    });

    it("adds 765 tokens per image (default/low detail mode)", async () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenAIChatProvider(mockClient);

      const textOnlyCount = await provider.countTokens(
        [{ role: "user" as const, content: "Hello" }],
        { provider: "openai", name: "gpt-4o" },
      );

      const withImageCount = await provider.countTokens(
        [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "Hello" },
              {
                type: "image" as const,
                source: { type: "url" as const, url: "https://example.com/image.png" },
              },
            ],
          },
        ],
        { provider: "openai", name: "gpt-4o" },
      );

      // Image adds 765 tokens
      expect(withImageCount - textOnlyCount).toBe(765);
    });

    it("adds 765 tokens per image for each image in multimodal content", async () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenAIChatProvider(mockClient);

      const singleImageCount = await provider.countTokens(
        [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "Compare these" },
              {
                type: "image" as const,
                source: { type: "url" as const, url: "https://example.com/img1.png" },
              },
            ],
          },
        ],
        { provider: "openai", name: "gpt-4o" },
      );

      const twoImageCount = await provider.countTokens(
        [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "Compare these" },
              {
                type: "image" as const,
                source: { type: "url" as const, url: "https://example.com/img1.png" },
              },
              {
                type: "image" as const,
                source: { type: "url" as const, url: "https://example.com/img2.png" },
              },
            ],
          },
        ],
        { provider: "openai", name: "gpt-4o" },
      );

      // Second image adds another 765 tokens
      expect(twoImageCount - singleImageCount).toBe(765);
    });

    it("counts tokens across multiple messages with images", async () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenAIChatProvider(mockClient);

      const count = await provider.countTokens(
        [
          { role: "system" as const, content: "You are a vision assistant." },
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "Describe this image" },
              {
                type: "image" as const,
                source: { type: "url" as const, url: "https://example.com/image.png" },
              },
            ],
          },
        ],
        { provider: "openai", name: "gpt-4o" },
      );

      // Should have substantial token count including 765 image tokens
      expect(count).toBeGreaterThan(765);
    });

    it("counts image tokens from base64 images", async () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenAIChatProvider(mockClient);

      const textOnlyCount = await provider.countTokens(
        [{ role: "user" as const, content: "Hello" }],
        { provider: "openai", name: "gpt-4o" },
      );

      const withBase64ImageCount = await provider.countTokens(
        [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "Hello" },
              {
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  mediaType: "image/png",
                  data: "iVBORw0KGgoAAAANSUhEUg==",
                },
              },
            ],
          },
        ],
        { provider: "openai", name: "gpt-4o" },
      );

      // Base64 images also get 765 token estimate
      expect(withBase64ImageCount - textOnlyCount).toBe(765);
    });
  });

  describe("countTokens constants and scaling validation", () => {
    it("token count scales with text length", async () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenAIChatProvider(mockClient);

      // FALLBACK_CHARS_PER_TOKEN is 4; use a long text to ensure scaling is visible
      const shortText = "Hi";
      const longText = "A".repeat(FALLBACK_CHARS_PER_TOKEN * 10); // 40 chars = ~10 tokens

      const shortCount = await provider.countTokens(
        [{ role: "user" as const, content: shortText }],
        { provider: "openai", name: "gpt-4" },
      );
      const longCount = await provider.countTokens([{ role: "user" as const, content: longText }], {
        provider: "openai",
        name: "gpt-4",
      });

      // Long message should have significantly more tokens than short one
      expect(longCount).toBeGreaterThan(shortCount);
    });

    it("FALLBACK_CHARS_PER_TOKEN constant equals 2", async () => {
      // Conservative fallback: 2 chars/token errs on overestimating tokens,
      // which is safer for compaction triggers and output limiting
      expect(FALLBACK_CHARS_PER_TOKEN).toBe(2);
    });

    it("image token estimation adds 765 tokens on the tiktoken path", async () => {
      // Both the tiktoken path and the fallback path add 765 tokens per image;
      // this test exercises the tiktoken path (gpt-4 is a supported model)
      const mockClient = {} as OpenAI;
      const provider = new OpenAIChatProvider(mockClient);

      const textOnlyCount = await provider.countTokens(
        [{ role: "user" as const, content: "A".repeat(400) }],
        { provider: "openai", name: "gpt-4" },
      );

      const withImageCount = await provider.countTokens(
        [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "A".repeat(400) },
              {
                type: "image" as const,
                source: { type: "url" as const, url: "https://example.com/img.png" },
              },
            ],
          },
        ],
        { provider: "openai", name: "gpt-4" },
      );

      expect(withImageCount - textOnlyCount).toBe(765);
    });

    it("fallback estimate is more conservative than tiktoken for typical text", async () => {
      const mockClient = {} as OpenAI;
      const chars = "Hello world this is a test message";
      const fallbackEstimate = Math.ceil(chars.length / FALLBACK_CHARS_PER_TOKEN);

      // With FALLBACK_CHARS_PER_TOKEN=2, the fallback overestimates token count.
      // This is intentional: safer for compaction and output limiting.
      const provider = new OpenAIChatProvider(mockClient);
      const tiktokenCount = await provider.countTokens(
        [{ role: "user" as const, content: chars }],
        { provider: "openai", name: "gpt-4" },
      );

      expect(fallbackEstimate).toBeGreaterThanOrEqual(tiktokenCount);
    });
  });
});

describe("createOpenAIProviderFromEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("creates provider when OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "sk-test-key-123";

    const provider = createOpenAIProviderFromEnv();

    expect(provider).toBeInstanceOf(OpenAIChatProvider);
    expect(provider?.providerId).toBe("openai");
  });

  it("returns null when OPENAI_API_KEY is not set", () => {
    delete process.env.OPENAI_API_KEY;

    const provider = createOpenAIProviderFromEnv();

    expect(provider).toBeNull();
  });

  it("returns null when OPENAI_API_KEY is an empty string", () => {
    process.env.OPENAI_API_KEY = "";

    const provider = createOpenAIProviderFromEnv();

    expect(provider).toBeNull();
  });

  it("returns null when OPENAI_API_KEY is only whitespace", () => {
    process.env.OPENAI_API_KEY = "   ";

    const provider = createOpenAIProviderFromEnv();

    expect(provider).toBeNull();
  });

  it("trims whitespace from the API key", () => {
    process.env.OPENAI_API_KEY = "  sk-test-key  ";

    const provider = createOpenAIProviderFromEnv();

    expect(provider).toBeInstanceOf(OpenAIChatProvider);
  });

  it("created provider supports openai descriptor", () => {
    process.env.OPENAI_API_KEY = "sk-test-key-456";

    const provider = createOpenAIProviderFromEnv();

    expect(provider?.supports({ provider: "openai", name: "gpt-4" })).toBe(true);
    expect(provider?.supports({ provider: "anthropic", name: "claude-3" })).toBe(false);
  });
});
