import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";

import { OpenAIChatProvider } from "./openai.js";

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
});
