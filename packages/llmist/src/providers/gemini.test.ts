import type { GoogleGenAI } from "@google/genai";
import { describe, expect, it, vi } from "vitest";

import { GeminiGenerativeProvider } from "./gemini.js";
import { calculateGeminiImageCost } from "./gemini-image-models.js";
import { calculateGeminiSpeechCost } from "./gemini-speech-models.js";

describe("GeminiGenerativeProvider", () => {
  const createClient = () => {
    const stream = (async function* () {})();
    const generateContentStream = vi.fn().mockResolvedValue(stream);
    const models = { generateContentStream };
    const client = { models } as unknown as GoogleGenAI;

    return { client, generateContentStream };
  };

  it("maps messages with system instructions and role conversion", async () => {
    const { client, generateContentStream } = createClient();
    const provider = new GeminiGenerativeProvider(client);

    const options = {
      model: "gemini-1.5-flash",
      messages: [
        { role: "system" as const, content: "Primary instruction" },
        { role: "system" as const, content: "Gadget instructions" },
        { role: "user" as const, content: "Initial request" },
        { role: "assistant" as const, content: "Previous answer" },
        { role: "system" as const, content: "Follow-up system note" },
        { role: "user" as const, content: "Latest question" },
      ],
      maxTokens: 256,
      temperature: 0.4,
      topP: 0.8,
      stopSequences: ["STOP"],
      extra: { safetySettings: [{ category: "some-category", threshold: "block-none" }] },
    };

    const descriptor = { provider: "gemini", name: "gemini-1.5-flash" } as const;
    const stream = provider.stream(options, descriptor);
    await stream.next();

    expect(generateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-1.5-flash",
        contents: [
          // System messages converted to user+model exchanges
          { role: "user", parts: [{ text: "Primary instruction" }] },
          { role: "model", parts: [{ text: "Understood." }] },
          { role: "user", parts: [{ text: "Gadget instructions" }] },
          { role: "model", parts: [{ text: "Understood." }] },
          // Regular messages
          { role: "user", parts: [{ text: "Initial request" }] },
          { role: "model", parts: [{ text: "Previous answer" }] },
          // Inline system converted to user+model
          { role: "user", parts: [{ text: "Follow-up system note" }] },
          { role: "model", parts: [{ text: "Understood." }] },
          { role: "user", parts: [{ text: "Latest question" }] },
        ],
        config: expect.objectContaining({
          // systemInstruction removed - now in contents
          maxOutputTokens: 256,
          temperature: 0.4,
          topP: 0.8,
          stopSequences: ["STOP"],
          safetySettings: [{ category: "some-category", threshold: "block-none" }],
        }),
      }),
    );
  });

  it("omits system instruction when no system messages exist", async () => {
    const { client, generateContentStream } = createClient();
    const provider = new GeminiGenerativeProvider(client);

    const options = {
      model: "gemini-1.5-pro",
      messages: [
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi there" },
      ],
    };

    const stream = provider.stream(options, { provider: "gemini", name: "gemini-1.5-pro" });
    await stream.next();

    expect(generateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-1.5-pro",
        contents: [
          { role: "user", parts: [{ text: "Hello" }] },
          { role: "model", parts: [{ text: "Hi there" }] },
        ],
      }),
    );
  });

  it("uses the first system block even when it appears after other roles", async () => {
    const { client, generateContentStream } = createClient();
    const provider = new GeminiGenerativeProvider(client);

    const options = {
      model: "gemini-1.5-pro",
      messages: [
        { role: "user" as const, content: "Earlier user message" },
        { role: "assistant" as const, content: "Earlier assistant message" },
        { role: "system" as const, content: "Inline instruction" },
        { role: "system" as const, content: "Additional inline instruction" },
        { role: "assistant" as const, content: "Later assistant response" },
      ],
    };

    const stream = provider.stream(options, { provider: "gemini", name: "gemini-1.5-pro" });
    await stream.next();

    expect(generateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-1.5-pro",
        contents: [
          { role: "user", parts: [{ text: "Earlier user message" }] },
          { role: "model", parts: [{ text: "Earlier assistant message" }] },
          // Inline system messages converted to user+model exchanges
          { role: "user", parts: [{ text: "Inline instruction" }] },
          { role: "model", parts: [{ text: "Understood." }] },
          { role: "user", parts: [{ text: "Additional inline instruction" }] },
          // Consecutive model messages merged
          {
            role: "model",
            parts: [{ text: "Understood." }, { text: "Later assistant response" }],
          },
        ],
        config: expect.objectContaining({
          // systemInstruction removed - now in contents
        }),
      }),
    );
  });

  it("merges consecutive assistant messages in initialMessages pattern", async () => {
    const { client, generateContentStream } = createClient();
    const provider = new GeminiGenerativeProvider(client);

    const options = {
      model: "gemini-1.5-pro",
      messages: [
        {
          role: "user" as const,
          content: "Here is my recent activity history in this workspace for your context:",
        },
        { role: "assistant" as const, content: "I see that 1 minute ago - Started agent session" },
        {
          role: "assistant" as const,
          content: "I see that just now - Created section at esp32-chip-variants",
        },
        { role: "assistant" as const, content: "I see that just now - Agent called CreateSection" },
        {
          role: "assistant" as const,
          content: "I see that just now - Created section at esp32-chip-variants.classic-esp32",
        },
        { role: "assistant" as const, content: "I see that just now - Agent called CreateSection" },
        {
          role: "assistant" as const,
          content: "I see that just now - Created section at esp32-chip-variants.esp32-s2",
        },
      ],
    };

    const stream = provider.stream(options, { provider: "gemini", name: "gemini-1.5-pro" });
    await stream.next();

    expect(generateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-1.5-pro",
        contents: [
          {
            role: "user",
            parts: [
              { text: "Here is my recent activity history in this workspace for your context:" },
            ],
          },
          {
            role: "model",
            parts: [
              { text: "I see that 1 minute ago - Started agent session" },
              { text: "I see that just now - Created section at esp32-chip-variants" },
              { text: "I see that just now - Agent called CreateSection" },
              {
                text: "I see that just now - Created section at esp32-chip-variants.classic-esp32",
              },
              { text: "I see that just now - Agent called CreateSection" },
              { text: "I see that just now - Created section at esp32-chip-variants.esp32-s2" },
            ],
          },
        ],
      }),
    );
  });

  describe("abort signal propagation", () => {
    it("passes abort signal to SDK in config when provided", async () => {
      const { client, generateContentStream } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const controller = new AbortController();
      const options = {
        model: "gemini-1.5-flash",
        messages: [{ role: "user" as const, content: "Test" }],
        signal: controller.signal,
      };

      await provider.stream(options, { provider: "gemini", name: "gemini-1.5-flash" }).next();

      // Gemini SDK expects signal in config.abortSignal
      expect(generateContentStream).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            abortSignal: controller.signal,
          }),
        }),
      );
    });

    it("does not include abortSignal in config when signal is not provided", async () => {
      const { client, generateContentStream } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const options = {
        model: "gemini-1.5-flash",
        messages: [{ role: "user" as const, content: "Test" }],
      };

      await provider.stream(options, { provider: "gemini", name: "gemini-1.5-flash" }).next();

      // Verify abortSignal is not in the config
      const callArgs = generateContentStream.mock.calls[0]?.[0] as {
        config?: { abortSignal?: AbortSignal };
      };
      expect(callArgs?.config?.abortSignal).toBeUndefined();
    });
  });

  describe("countTokens", () => {
    it("counts tokens for simple messages", async () => {
      const mockCountTokens = vi.fn().mockResolvedValue({
        totalTokens: 15,
      });

      const mockClient = {
        models: {
          countTokens: mockCountTokens,
        },
      } as unknown as GoogleGenAI;

      const provider = new GeminiGenerativeProvider(mockClient);

      const count = await provider.countTokens(
        [{ role: "user" as const, content: "Hello world" }],
        { provider: "gemini", name: "gemini-1.5-pro" },
      );

      expect(count).toBe(15);
      expect(mockCountTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gemini-1.5-pro",
          contents: [{ role: "user", parts: [{ text: "Hello world" }] }],
        }),
      );
    });

    it("includes system instruction in token count", async () => {
      const mockCountTokens = vi.fn().mockResolvedValue({
        totalTokens: 25,
      });

      const mockClient = {
        models: {
          countTokens: mockCountTokens,
        },
      } as unknown as GoogleGenAI;

      const provider = new GeminiGenerativeProvider(mockClient);

      await provider.countTokens(
        [
          { role: "system" as const, content: "You are helpful" },
          { role: "user" as const, content: "Hello" },
        ],
        { provider: "gemini", name: "gemini-1.5-pro" },
      );

      expect(mockCountTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gemini-1.5-pro",
          contents: [
            // System message converted to user+model exchange
            { role: "user", parts: [{ text: "You are helpful" }] },
            { role: "model", parts: [{ text: "Understood." }] },
            { role: "user", parts: [{ text: "Hello" }] },
          ],
        }),
      );
    });

    it("merges consecutive messages of same role", async () => {
      const mockCountTokens = vi.fn().mockResolvedValue({
        totalTokens: 30,
      });

      const mockClient = {
        models: {
          countTokens: mockCountTokens,
        },
      } as unknown as GoogleGenAI;

      const provider = new GeminiGenerativeProvider(mockClient);

      await provider.countTokens(
        [
          { role: "user" as const, content: "First" },
          { role: "assistant" as const, content: "Response 1" },
          { role: "assistant" as const, content: "Response 2" },
        ],
        { provider: "gemini", name: "gemini-1.5-pro" },
      );

      expect(mockCountTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: [
            { role: "user", parts: [{ text: "First" }] },
            { role: "model", parts: [{ text: "Response 1" }, { text: "Response 2" }] },
          ],
        }),
      );
    });

    it("uses fallback estimation when API fails", async () => {
      const mockCountTokens = vi.fn().mockRejectedValue(new Error("API error"));

      const mockClient = {
        models: {
          countTokens: mockCountTokens,
        },
      } as unknown as GoogleGenAI;

      const provider = new GeminiGenerativeProvider(mockClient);

      const count = await provider.countTokens(
        [{ role: "user" as const, content: "Hello world" }], // "Hello world" = 11 chars
        { provider: "gemini", name: "gemini-1.5-pro" },
      );

      // Fallback: 11 chars / 4 = 2.75, ceil = 3
      expect(count).toBe(3);
    });

    it("handles empty content with defensive checks", async () => {
      const mockCountTokens = vi.fn().mockResolvedValue({
        totalTokens: 5,
      });

      const mockClient = {
        models: {
          countTokens: mockCountTokens,
        },
      } as unknown as GoogleGenAI;

      const provider = new GeminiGenerativeProvider(mockClient);

      const count = await provider.countTokens([{ role: "user" as const, content: "" }], {
        provider: "gemini",
        name: "gemini-1.5-pro",
      });

      expect(count).toBeGreaterThanOrEqual(0);
    });

    it("handles system messages at different positions", async () => {
      const mockCountTokens = vi.fn().mockResolvedValue({
        totalTokens: 40,
      });

      const mockClient = {
        models: {
          countTokens: mockCountTokens,
        },
      } as unknown as GoogleGenAI;

      const provider = new GeminiGenerativeProvider(mockClient);

      await provider.countTokens(
        [
          { role: "user" as const, content: "First user message" },
          { role: "system" as const, content: "System instruction" },
          { role: "assistant" as const, content: "Response" },
        ],
        { provider: "gemini", name: "gemini-1.5-pro" },
      );

      // System message should be converted to user+model exchange in place
      expect(mockCountTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gemini-1.5-pro",
          contents: [
            {
              role: "user",
              parts: [{ text: "First user message" }, { text: "System instruction" }],
            },
            {
              role: "model",
              parts: [{ text: "Understood." }, { text: "Response" }],
            },
          ],
        }),
      );
    });

    it("returns zero when totalTokens is undefined", async () => {
      const mockCountTokens = vi.fn().mockResolvedValue({
        totalTokens: undefined,
      });

      const mockClient = {
        models: {
          countTokens: mockCountTokens,
        },
      } as unknown as GoogleGenAI;

      const provider = new GeminiGenerativeProvider(mockClient);

      const count = await provider.countTokens([{ role: "user" as const, content: "Hello" }], {
        provider: "gemini",
        name: "gemini-1.5-pro",
      });

      expect(count).toBe(0);
    });

    it("handles multimodal content with images in fallback estimation", async () => {
      const mockCountTokens = vi.fn().mockRejectedValue(new Error("API error"));

      const mockClient = {
        models: {
          countTokens: mockCountTokens,
        },
      } as unknown as GoogleGenAI;

      const provider = new GeminiGenerativeProvider(mockClient);

      // Suppress console.warn for this test
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const count = await provider.countTokens(
        [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "What is this?" }, // 13 chars
              {
                type: "image" as const,
                source: { type: "base64" as const, mediaType: "image/png", data: "abc123" },
              },
            ],
          },
        ],
        { provider: "gemini", name: "gemini-1.5-pro" },
      );

      // 13 chars / 4 = 3.25 → 4 tokens + 258 tokens for image = 262
      expect(count).toBe(262);

      warnSpy.mockRestore();
    });

    it("returns zero when messages array is empty", async () => {
      const mockCountTokens = vi.fn().mockResolvedValue({ totalTokens: 0 });

      const mockClient = {
        models: {
          countTokens: mockCountTokens,
        },
      } as unknown as GoogleGenAI;

      const provider = new GeminiGenerativeProvider(mockClient);

      const count = await provider.countTokens([], {
        provider: "gemini",
        name: "gemini-1.5-pro",
      });

      // Empty messages → no contents → returns 0 immediately, skipping API call
      expect(count).toBe(0);
      expect(mockCountTokens).not.toHaveBeenCalled();
    });

    it("handles audio content in fallback estimation", async () => {
      const mockCountTokens = vi.fn().mockRejectedValue(new Error("API error"));

      const mockClient = {
        models: {
          countTokens: mockCountTokens,
        },
      } as unknown as GoogleGenAI;

      const provider = new GeminiGenerativeProvider(mockClient);

      // Suppress console.warn for this test
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const count = await provider.countTokens(
        [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "What do you hear?" }, // 17 chars
              {
                type: "audio" as const,
                source: {
                  type: "base64" as const,
                  mediaType: "audio/mp3",
                  data: "SGVsbG8=",
                },
              },
            ],
          },
        ],
        { provider: "gemini", name: "gemini-1.5-pro" },
      );

      // 17 chars / 4 = 4.25 → 5 tokens + 258 tokens for audio = 263
      expect(count).toBe(263);

      warnSpy.mockRestore();
    });
  });

  describe("multimodal content conversion", () => {
    it("should convert base64 image to Gemini inlineData format", async () => {
      const { client, generateContentStream } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const options = {
        model: "gemini-1.5-flash",
        messages: [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "What is in this image?" },
              {
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  mediaType: "image/png",
                  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                },
              },
            ],
          },
        ],
      };

      const stream = provider.stream(options, { provider: "gemini", name: "gemini-1.5-flash" });
      await stream.next();

      expect(generateContentStream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gemini-1.5-flash",
          contents: [
            {
              role: "user",
              parts: [
                { text: "What is in this image?" },
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                  },
                },
              ],
            },
          ],
        }),
      );
    });

    it("should convert audio content to Gemini inlineData format", async () => {
      const { client, generateContentStream } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const options = {
        model: "gemini-1.5-flash",
        messages: [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "Transcribe this audio" },
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

      const stream = provider.stream(options, { provider: "gemini", name: "gemini-1.5-flash" });
      await stream.next();

      expect(generateContentStream).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: [
            {
              role: "user",
              parts: [
                { text: "Transcribe this audio" },
                {
                  inlineData: {
                    mimeType: "audio/mp3",
                    data: "SGVsbG8gV29ybGQ=",
                  },
                },
              ],
            },
          ],
        }),
      );
    });

    it("should throw error for URL image (not supported by Gemini)", async () => {
      const { client } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const options = {
        model: "gemini-1.5-flash",
        messages: [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "What is this?" },
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

      const stream = provider.stream(options, { provider: "gemini", name: "gemini-1.5-flash" });

      await expect(stream.next()).rejects.toThrow("Gemini does not support image URLs directly");
    });

    it("should throw error for unsupported content type", async () => {
      const { client } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const options = {
        model: "gemini-1.5-flash",
        messages: [
          {
            role: "user" as const,
            // Inject an unsupported content part type via type coercion
            content: [{ type: "video" as any, source: { type: "url", url: "http://x.com" } }],
          },
        ],
      };

      const stream = provider.stream(options, { provider: "gemini", name: "gemini-1.5-flash" });

      await expect(stream.next()).rejects.toThrow("Unsupported content type");
    });

    it("should convert audio inline data with wav mimeType to Gemini inlineData format", async () => {
      const { client, generateContentStream } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const options = {
        model: "gemini-1.5-flash",
        messages: [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "Describe this audio" },
              {
                type: "audio" as const,
                source: {
                  type: "base64" as const,
                  mediaType: "audio/wav",
                  data: "UklGRiQAAABXQVZFZm10IBAAAA==",
                },
              },
            ],
          },
        ],
      };

      const stream = provider.stream(options, { provider: "gemini", name: "gemini-1.5-flash" });
      await stream.next();

      expect(generateContentStream).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: [
            {
              role: "user",
              parts: [
                { text: "Describe this audio" },
                {
                  inlineData: {
                    mimeType: "audio/wav",
                    data: "UklGRiQAAABXQVZFZm10IBAAAA==",
                  },
                },
              ],
            },
          ],
        }),
      );
    });
  });

  describe("caching integration", () => {
    it("includes cachedContent in config when cache manager returns a name", async () => {
      const stream = (async function* () {})();
      const generateContentStream = vi.fn().mockResolvedValue(stream);
      const cacheCreate = vi.fn().mockResolvedValue({
        name: "cachedContents/test-cache",
        expireTime: new Date(Date.now() + 3600_000).toISOString(),
      });
      const cacheDelete = vi.fn().mockResolvedValue({});

      const client = {
        models: { generateContentStream },
        caches: { create: cacheCreate, delete: cacheDelete },
      } as unknown as GoogleGenAI;

      const provider = new GeminiGenerativeProvider(client);

      // Create content large enough to meet the 32768 token threshold
      const longText = "x".repeat(200_000); // ~50k tokens
      const options = {
        model: "gemini-2.5-flash",
        messages: [
          { role: "system" as const, content: longText },
          { role: "user" as const, content: "First question" },
          { role: "assistant" as const, content: "First answer" },
          { role: "user" as const, content: "Follow-up question" },
        ],
        caching: { enabled: true, scope: "conversation" as const },
      };

      const descriptor = { provider: "gemini", name: "gemini-2.5-flash" } as const;
      const s = provider.stream(options, descriptor);
      await s.next();

      expect(generateContentStream).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            cachedContent: "cachedContents/test-cache",
          }),
        }),
      );

      const callArgs = generateContentStream.mock.calls[0][0];
      expect(callArgs.config.toolConfig).toBeUndefined();
    });

    it("strips cached prefix from contents when cache is active", async () => {
      const stream = (async function* () {})();
      const generateContentStream = vi.fn().mockResolvedValue(stream);
      const cacheCreate = vi.fn().mockResolvedValue({
        name: "cachedContents/strip-test",
        expireTime: new Date(Date.now() + 3600_000).toISOString(),
      });
      const cacheDelete = vi.fn().mockResolvedValue({});

      const client = {
        models: { generateContentStream },
        caches: { create: cacheCreate, delete: cacheDelete },
      } as unknown as GoogleGenAI;

      const provider = new GeminiGenerativeProvider(client);

      const longText = "x".repeat(200_000);
      const options = {
        model: "gemini-2.5-flash",
        messages: [
          { role: "system" as const, content: longText },
          { role: "user" as const, content: "First" },
          { role: "assistant" as const, content: "Response" },
          { role: "user" as const, content: "Latest" },
        ],
        caching: { enabled: true, scope: "conversation" as const },
      };

      const s = provider.stream(options, { provider: "gemini", name: "gemini-2.5-flash" });
      await s.next();

      // The contents sent to the API should NOT include the cached prefix
      const callArgs = generateContentStream.mock.calls[0][0];
      const contents = callArgs.contents;

      // Only the uncached portion should remain
      // The last user message ("Latest") should be in the contents
      const allText = contents
        .flatMap((c: { parts: Array<{ text?: string }> }) => c.parts)
        .filter((p: { text?: string }) => "text" in p)
        .map((p: { text: string }) => p.text);
      expect(allText).toContain("Latest");
    });

    it("sends full contents when caching is not configured", async () => {
      const stream = (async function* () {})();
      const generateContentStream = vi.fn().mockResolvedValue(stream);
      const client = {
        models: { generateContentStream },
        caches: { create: vi.fn(), delete: vi.fn() },
      } as unknown as GoogleGenAI;

      const provider = new GeminiGenerativeProvider(client);

      const options = {
        model: "gemini-2.5-flash",
        messages: [
          { role: "system" as const, content: "System" },
          { role: "user" as const, content: "Hello" },
        ],
        // No caching config
      };

      const s = provider.stream(options, { provider: "gemini", name: "gemini-2.5-flash" });
      await s.next();

      const callArgs = generateContentStream.mock.calls[0][0];
      // Should NOT have cachedContent
      expect(callArgs.config.cachedContent).toBeUndefined();
      // toolConfig should be present when not using cached content
      expect(callArgs.config.toolConfig).toEqual({
        functionCallingConfig: { mode: "NONE" },
      });
    });

    it("sends full contents when caching is explicitly disabled", async () => {
      const stream = (async function* () {})();
      const generateContentStream = vi.fn().mockResolvedValue(stream);
      const client = {
        models: { generateContentStream },
        caches: { create: vi.fn(), delete: vi.fn() },
      } as unknown as GoogleGenAI;

      const provider = new GeminiGenerativeProvider(client);

      const options = {
        model: "gemini-2.5-flash",
        messages: [
          { role: "system" as const, content: "System" },
          { role: "user" as const, content: "Hello" },
        ],
        caching: { enabled: false },
      };

      const s = provider.stream(options, { provider: "gemini", name: "gemini-2.5-flash" });
      await s.next();

      const callArgs = generateContentStream.mock.calls[0][0];
      // Should NOT have cachedContent
      expect(callArgs.config.cachedContent).toBeUndefined();
      // toolConfig should be present when not using cached content
      expect(callArgs.config.toolConfig).toEqual({
        functionCallingConfig: { mode: "NONE" },
      });
      // caches.create should NOT have been called
      expect(client.caches.create).not.toHaveBeenCalled();
    });
  });

  describe("normalizeProviderStream", () => {
    it("should extract text from Gemini chunks", async () => {
      const { client } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const mockChunks = [
        {
          candidates: [{ content: { parts: [{ text: "Hello" }] } }],
        },
        {
          candidates: [{ content: { parts: [{ text: " world" }] } }],
        },
      ];

      async function* mockStream() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      const chunks = [];
      for await (const chunk of (provider as any).normalizeProviderStream(mockStream())) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0].text).toBe("Hello");
      expect(chunks[1].text).toBe(" world");
    });

    it("should extract finishReason and usage from final chunk", async () => {
      const { client } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const mockChunks = [
        {
          candidates: [{ content: { parts: [{ text: "Done" }] } }],
        },
        {
          candidates: [{ finishReason: "STOP" }],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
            cachedContentTokenCount: 2,
          },
        },
      ];

      async function* mockStream() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      const chunks = [];
      for await (const chunk of (provider as any).normalizeProviderStream(mockStream())) {
        chunks.push(chunk);
      }

      // First chunk has text
      expect(chunks[0].text).toBe("Done");

      // Second chunk has finishReason and usage
      const finalChunk = chunks.find((c) => c.finishReason);
      expect(finalChunk).toBeDefined();
      expect(finalChunk.finishReason).toBe("STOP");
      expect(finalChunk.usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        cachedInputTokens: 2,
      });
    });

    it("should handle chunks without candidates gracefully", async () => {
      const { client } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const mockChunks = [
        {}, // Empty chunk
        { candidates: null }, // Null candidates
        { candidates: [] }, // Empty candidates array
        { candidates: [{ content: { parts: [{ text: "Finally" }] } }] }, // Valid chunk
      ];

      async function* mockStream() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      const chunks = [];
      for await (const chunk of (provider as any).normalizeProviderStream(mockStream())) {
        chunks.push(chunk);
      }

      // Only the last chunk with actual text should produce output
      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe("Finally");
    });

    it("should handle multiple parts in a single candidate", async () => {
      const { client } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const mockChunks = [
        {
          candidates: [
            {
              content: {
                parts: [{ text: "Part 1" }, { text: " Part 2" }, { text: " Part 3" }],
              },
            },
          ],
        },
      ];

      async function* mockStream() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      const chunks = [];
      for await (const chunk of (provider as any).normalizeProviderStream(mockStream())) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe("Part 1 Part 2 Part 3");
    });

    it("should handle usage without cachedContentTokenCount", async () => {
      const { client } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const mockChunks = [
        {
          candidates: [{ finishReason: "STOP" }],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
            // cachedContentTokenCount is missing
          },
        },
      ];

      async function* mockStream() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      const chunks = [];
      for await (const chunk of (provider as any).normalizeProviderStream(mockStream())) {
        chunks.push(chunk);
      }

      expect(chunks[0].usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        cachedInputTokens: 0, // Defaults to 0
      });
    });

    it("should yield ThinkingChunk when chunk has thought: true parts", async () => {
      const { client } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const mockChunks = [
        {
          candidates: [
            {
              content: {
                parts: [{ text: "I am reasoning about this...", thought: true }],
              },
            },
          ],
        },
      ];

      async function* mockStream() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      const chunks = [];
      for await (const chunk of (provider as any).normalizeProviderStream(mockStream())) {
        chunks.push(chunk);
      }

      // Thinking chunk should be yielded with thinking property
      expect(chunks).toHaveLength(1);
      expect(chunks[0].thinking).toBeDefined();
      expect(chunks[0].thinking.type).toBe("thinking");
      expect(chunks[0].thinking.content).toBe("I am reasoning about this...");
    });

    it("should normalize text content from thinking chunks correctly", async () => {
      const { client } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const mockChunks = [
        {
          candidates: [
            {
              content: {
                parts: [{ text: "First, let me think...", thought: true }],
              },
            },
          ],
        },
        {
          candidates: [
            {
              content: {
                parts: [{ text: "More thoughts here.", thought: true }],
              },
            },
          ],
        },
      ];

      async function* mockStream() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      const chunks = [];
      for await (const chunk of (provider as any).normalizeProviderStream(mockStream())) {
        chunks.push(chunk);
      }

      // Each thinking chunk should yield a separate ThinkingChunk
      expect(chunks).toHaveLength(2);
      expect(chunks[0].thinking.content).toBe("First, let me think...");
      expect(chunks[1].thinking.content).toBe("More thoughts here.");
      // text property should be empty string for thinking-only chunks
      expect(chunks[0].text).toBe("");
      expect(chunks[1].text).toBe("");
    });

    it("should yield ThinkingChunk and TextChunk separately when chunk has both", async () => {
      const { client } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const mockChunks = [
        {
          candidates: [
            {
              content: {
                parts: [
                  { text: "Let me think about this.", thought: true },
                  { text: "The answer is 42." },
                ],
              },
            },
          ],
        },
      ];

      async function* mockStream() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      const chunks = [];
      for await (const chunk of (provider as any).normalizeProviderStream(mockStream())) {
        chunks.push(chunk);
      }

      // Should yield 2 chunks: thinking chunk + text chunk
      expect(chunks).toHaveLength(2);

      // First chunk is the thinking chunk
      expect(chunks[0].thinking).toBeDefined();
      expect(chunks[0].thinking.type).toBe("thinking");
      expect(chunks[0].thinking.content).toBe("Let me think about this.");

      // Second chunk is the text chunk
      expect(chunks[1].text).toBe("The answer is 42.");
      expect(chunks[1].thinking).toBeUndefined();
    });

    it("should include thoughtSignature in ThinkingChunk when present", async () => {
      const { client } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const mockChunks = [
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "Thinking deeply...",
                    thought: true,
                    thoughtSignature: "sig_abc123",
                  },
                ],
              },
            },
          ],
        },
      ];

      async function* mockStream() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      const chunks = [];
      for await (const chunk of (provider as any).normalizeProviderStream(mockStream())) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0].thinking.signature).toBe("sig_abc123");
    });

    it("should handle stream with thinking chunks, text chunks, and final usage", async () => {
      const { client } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const mockChunks = [
        {
          candidates: [
            {
              content: {
                parts: [{ text: "Thinking...", thought: true }],
              },
            },
          ],
        },
        {
          candidates: [
            {
              content: {
                parts: [{ text: "Final answer." }],
              },
            },
          ],
        },
        {
          candidates: [{ finishReason: "STOP" }],
          usageMetadata: {
            promptTokenCount: 20,
            candidatesTokenCount: 8,
            totalTokenCount: 28,
            thoughtsTokenCount: 15,
          },
        },
      ];

      async function* mockStream() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      const chunks = [];
      for await (const chunk of (provider as any).normalizeProviderStream(mockStream())) {
        chunks.push(chunk);
      }

      // Thinking chunk + text chunk + usage chunk
      expect(chunks.length).toBeGreaterThanOrEqual(3);

      const thinkingChunk = chunks.find((c) => c.thinking);
      expect(thinkingChunk).toBeDefined();
      expect(thinkingChunk.thinking.content).toBe("Thinking...");

      const textChunk = chunks.find((c) => c.text === "Final answer.");
      expect(textChunk).toBeDefined();

      const usageChunk = chunks.find((c) => c.usage);
      expect(usageChunk).toBeDefined();
      expect(usageChunk.usage.reasoningTokens).toBe(15);
      expect(usageChunk.finishReason).toBe("STOP");
    });

    it("should handle empty parts array in candidate", async () => {
      const { client } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const mockChunks = [
        {
          candidates: [
            {
              content: {
                parts: [], // Empty parts
              },
            },
          ],
        },
        {
          candidates: [{ content: { parts: [{ text: "After empty" }] } }],
        },
      ];

      async function* mockStream() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      const chunks = [];
      for await (const chunk of (provider as any).normalizeProviderStream(mockStream())) {
        chunks.push(chunk);
      }

      // Empty parts should produce no output; only the valid chunk counts
      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe("After empty");
    });

    it("should handle candidate with no content property", async () => {
      const { client } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const mockChunks = [
        {
          candidates: [
            {
              // No content property at all
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 2,
            totalTokenCount: 7,
          },
        },
      ];

      async function* mockStream() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }

      const chunks = [];
      for await (const chunk of (provider as any).normalizeProviderStream(mockStream())) {
        chunks.push(chunk);
      }

      // Should produce usage/finishReason chunk but no text/thinking
      const usageChunk = chunks.find((c) => c.finishReason === "STOP");
      expect(usageChunk).toBeDefined();
      expect(usageChunk.usage.inputTokens).toBe(5);
    });
  });

  // =========================================================================
  // Image Generation Tests
  // =========================================================================

  describe("generateImage", () => {
    describe("Imagen models (Imagen API path)", () => {
      it("calls generateImages API for imagen-3.0-generate-001 model", async () => {
        const generatedImages = [{ image: { imageBytes: "base64imagedata1" } }];
        const generateImages = vi.fn().mockResolvedValue({ generatedImages });
        const client = { models: { generateImages } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        const result = await provider.generateImage({
          model: "imagen-3.0-generate-001",
          prompt: "A beautiful sunset",
        });

        expect(generateImages).toHaveBeenCalledWith(
          expect.objectContaining({
            model: "imagen-3.0-generate-001",
            prompt: "A beautiful sunset",
            config: expect.objectContaining({
              numberOfImages: 1,
            }),
          }),
        );
        expect(result.images).toHaveLength(1);
        expect(result.images[0].b64Json).toBe("base64imagedata1");
        expect(result.model).toBe("imagen-3.0-generate-001");
      });

      it("calls generateImages API for imagen-4.0-generate-001 model", async () => {
        const generatedImages = [
          { image: { imageBytes: "img1" } },
          { image: { imageBytes: "img2" } },
        ];
        const generateImages = vi.fn().mockResolvedValue({ generatedImages });
        const client = { models: { generateImages } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        const result = await provider.generateImage({
          model: "imagen-4.0-generate-001",
          prompt: "Two cats playing",
          n: 2,
          size: "16:9",
        });

        expect(generateImages).toHaveBeenCalledWith(
          expect.objectContaining({
            model: "imagen-4.0-generate-001",
            prompt: "Two cats playing",
            config: expect.objectContaining({
              numberOfImages: 2,
              aspectRatio: "16:9",
            }),
          }),
        );
        expect(result.images).toHaveLength(2);
        expect(result.images[0].b64Json).toBe("img1");
        expect(result.images[1].b64Json).toBe("img2");
      });

      it("passes correct outputMimeType based on responseFormat", async () => {
        const generatedImages = [{ image: { imageBytes: "pngdata" } }];
        const generateImages = vi.fn().mockResolvedValue({ generatedImages });
        const client = { models: { generateImages } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        await provider.generateImage({
          model: "imagen-4.0-generate-001",
          prompt: "A cat",
          responseFormat: "b64_json",
        });

        expect(generateImages).toHaveBeenCalledWith(
          expect.objectContaining({
            config: expect.objectContaining({
              outputMimeType: "image/png",
            }),
          }),
        );
      });

      it("passes jpeg outputMimeType when responseFormat is not b64_json", async () => {
        const generatedImages = [{ image: { imageBytes: "jpegdata" } }];
        const generateImages = vi.fn().mockResolvedValue({ generatedImages });
        const client = { models: { generateImages } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        await provider.generateImage({
          model: "imagen-4.0-generate-001",
          prompt: "A dog",
          responseFormat: "url",
        });

        expect(generateImages).toHaveBeenCalledWith(
          expect.objectContaining({
            config: expect.objectContaining({
              outputMimeType: "image/jpeg",
            }),
          }),
        );
      });

      it("handles empty generatedImages from API", async () => {
        const generateImages = vi.fn().mockResolvedValue({ generatedImages: [] });
        const client = { models: { generateImages } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        const result = await provider.generateImage({
          model: "imagen-4.0-generate-001",
          prompt: "Nothing",
        });

        expect(result.images).toHaveLength(0);
        expect(result.usage.imagesGenerated).toBe(0);
      });

      it("handles undefined generatedImages from API", async () => {
        const generateImages = vi.fn().mockResolvedValue({});
        const client = { models: { generateImages } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        const result = await provider.generateImage({
          model: "imagen-4.0-generate-001",
          prompt: "Test",
        });

        expect(result.images).toHaveLength(0);
      });

      it("returns correct usage metadata for Imagen model", async () => {
        const generatedImages = [{ image: { imageBytes: "data" } }];
        const generateImages = vi.fn().mockResolvedValue({ generatedImages });
        const client = { models: { generateImages } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        const result = await provider.generateImage({
          model: "imagen-4.0-generate-001",
          prompt: "Test",
          size: "3:4",
        });

        expect(result.usage).toEqual({
          imagesGenerated: 1,
          size: "3:4",
          quality: "standard",
        });
      });
    });

    describe("native Gemini image generation path", () => {
      it("calls generateContent API for gemini-2.5-flash-image model", async () => {
        const generateContent = vi.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [
                  { inlineData: { mimeType: "image/png", data: "base64imgdata" } },
                  { text: "Here is the image" },
                ],
              },
            },
          ],
        });
        const client = { models: { generateContent } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        const result = await provider.generateImage({
          model: "gemini-2.5-flash-image",
          prompt: "A futuristic city",
        });

        expect(generateContent).toHaveBeenCalledWith(
          expect.objectContaining({
            model: "gemini-2.5-flash-image",
            contents: [{ role: "user", parts: [{ text: "A futuristic city" }] }],
            config: expect.objectContaining({
              responseModalities: expect.arrayContaining(["IMAGE", "TEXT"]),
            }),
          }),
        );
        expect(result.images).toHaveLength(1);
        expect(result.images[0].b64Json).toBe("base64imgdata");
        expect(result.model).toBe("gemini-2.5-flash-image");
      });

      it("extracts multiple images from response parts", async () => {
        const generateContent = vi.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [
                  { inlineData: { mimeType: "image/png", data: "img1data" } },
                  { inlineData: { mimeType: "image/png", data: "img2data" } },
                ],
              },
            },
          ],
        });
        const client = { models: { generateContent } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        const result = await provider.generateImage({
          model: "gemini-2.5-flash-image",
          prompt: "Two images please",
        });

        expect(result.images).toHaveLength(2);
        expect(result.images[0].b64Json).toBe("img1data");
        expect(result.images[1].b64Json).toBe("img2data");
      });

      it("ignores text parts in response (only extracts inlineData)", async () => {
        const generateContent = vi.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [
                  { text: "Here is your image:" },
                  { inlineData: { mimeType: "image/jpeg", data: "imgbytes" } },
                ],
              },
            },
          ],
        });
        const client = { models: { generateContent } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        const result = await provider.generateImage({
          model: "gemini-2.5-flash-image",
          prompt: "A landscape",
        });

        expect(result.images).toHaveLength(1);
        expect(result.images[0].b64Json).toBe("imgbytes");
      });

      it("handles response with no candidates", async () => {
        const generateContent = vi.fn().mockResolvedValue({
          candidates: [],
        });
        const client = { models: { generateContent } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        const result = await provider.generateImage({
          model: "gemini-2.5-flash-image",
          prompt: "Test",
        });

        expect(result.images).toHaveLength(0);
      });

      it("handles response with no parts", async () => {
        const generateContent = vi.fn().mockResolvedValue({
          candidates: [{ content: {} }],
        });
        const client = { models: { generateContent } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        const result = await provider.generateImage({
          model: "gemini-2.5-flash-image",
          prompt: "Test",
        });

        expect(result.images).toHaveLength(0);
      });

      it("returns correct usage metadata for native Gemini model", async () => {
        const generateContent = vi.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: "image/png", data: "data" } }],
              },
            },
          ],
        });
        const client = { models: { generateContent } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        const result = await provider.generateImage({
          model: "gemini-2.5-flash-image",
          prompt: "Test",
          size: "9:16",
        });

        expect(result.usage).toEqual({
          imagesGenerated: 1,
          size: "9:16",
          quality: "standard",
        });
      });
    });

    describe("cost calculation for image generation", () => {
      it("calculates cost for Imagen 4 model per image", () => {
        // imagen-4.0-generate-001 costs $0.04 per image
        const cost = calculateGeminiImageCost("imagen-4.0-generate-001", "1:1", 1);
        expect(cost).toBe(0.04);
      });

      it("calculates cost for multiple images", () => {
        // imagen-4.0-generate-001 costs $0.04 per image × 3 = $0.12
        const cost = calculateGeminiImageCost("imagen-4.0-generate-001", "1:1", 3);
        expect(cost).toBeCloseTo(0.12);
      });

      it("calculates cost for Imagen 4 Fast model", () => {
        // imagen-4.0-fast-generate-001 costs $0.02 per image
        const cost = calculateGeminiImageCost("imagen-4.0-fast-generate-001", "1:1", 1);
        expect(cost).toBe(0.02);
      });

      it("calculates cost for Imagen 4 Ultra model", () => {
        // imagen-4.0-ultra-generate-001 costs $0.06 per image
        const cost = calculateGeminiImageCost("imagen-4.0-ultra-generate-001", "1:1", 2);
        expect(cost).toBeCloseTo(0.12);
      });

      it("calculates cost for Gemini 2.5 Flash Image model", () => {
        // gemini-2.5-flash-image costs $0.039 per image
        const cost = calculateGeminiImageCost("gemini-2.5-flash-image", "1:1", 1);
        expect(cost).toBe(0.039);
      });

      it("calculates cost for size-based Gemini 3 Pro Image model", () => {
        // gemini-3-pro-image-preview costs $0.134 per 2K image
        const cost = calculateGeminiImageCost("gemini-3-pro-image-preview", "2K", 1);
        expect(cost).toBe(0.134);
      });

      it("calculates cost for 4K size for Gemini 3 Pro Image model", () => {
        // gemini-3-pro-image-preview costs $0.24 per 4K image
        const cost = calculateGeminiImageCost("gemini-3-pro-image-preview", "4K", 1);
        expect(cost).toBe(0.24);
      });

      it("returns undefined for unknown model", () => {
        const cost = calculateGeminiImageCost("unknown-model", "1:1", 1);
        expect(cost).toBeUndefined();
      });

      it("includes cost in generateImage result for Imagen model", async () => {
        const generatedImages = [{ image: { imageBytes: "data" } }];
        const generateImages = vi.fn().mockResolvedValue({ generatedImages });
        const client = { models: { generateImages } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        const result = await provider.generateImage({
          model: "imagen-4.0-generate-001",
          prompt: "Test",
          size: "1:1",
        });

        // imagen-4.0-generate-001 at $0.04 per image × 1 image
        expect(result.cost).toBe(0.04);
      });

      it("includes cost in generateImage result for native Gemini model", async () => {
        const generateContent = vi.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: "image/png", data: "data" } }],
              },
            },
          ],
        });
        const client = { models: { generateContent } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        const result = await provider.generateImage({
          model: "gemini-2.5-flash-image",
          prompt: "Test",
          size: "1:1",
        });

        // gemini-2.5-flash-image at $0.039 per image × 1 image
        expect(result.cost).toBe(0.039);
      });
    });
  });

  // =========================================================================
  // Speech Generation Tests
  // =========================================================================

  describe("generateSpeech", () => {
    /**
     * Build a mock PCM response with valid base64 data.
     * Uses simple ASCII bytes so atob() works in test environment.
     */
    const buildMockSpeechResponse = (base64PcmData: string) => ({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: "audio/pcm",
                  data: base64PcmData,
                },
              },
            ],
          },
        },
      ],
    });

    it("calls generateContent with AUDIO modality and voice config", async () => {
      // Simple base64-encoded PCM: 8 zero bytes (valid for WAV wrapping)
      const pcmBase64 = btoa(String.fromCharCode(0, 0, 0, 0, 0, 0, 0, 0));
      const generateContent = vi.fn().mockResolvedValue(buildMockSpeechResponse(pcmBase64));
      const client = { models: { generateContent } } as unknown as GoogleGenAI;
      const provider = new GeminiGenerativeProvider(client);

      await provider.generateSpeech({
        model: "gemini-2.5-flash-preview-tts",
        input: "Hello world",
        voice: "Puck",
      });

      expect(generateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ role: "user", parts: [{ text: "Hello world" }] }],
          config: expect.objectContaining({
            responseModalities: expect.arrayContaining(["AUDIO"]),
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: "Puck",
                },
              },
            },
          }),
        }),
      );
    });

    describe("voice config mapping", () => {
      const voices = ["Puck", "Charon", "Kore", "Fenrir", "Aoede"] as const;

      for (const voice of voices) {
        it(`passes voice "${voice}" correctly to speechConfig`, async () => {
          const pcmBase64 = btoa(String.fromCharCode(0, 0, 0, 0));
          const generateContent = vi.fn().mockResolvedValue(buildMockSpeechResponse(pcmBase64));
          const client = { models: { generateContent } } as unknown as GoogleGenAI;
          const provider = new GeminiGenerativeProvider(client);

          await provider.generateSpeech({
            model: "gemini-2.5-flash-preview-tts",
            input: "Test",
            voice,
          });

          expect(generateContent).toHaveBeenCalledWith(
            expect.objectContaining({
              config: expect.objectContaining({
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: voice,
                    },
                  },
                },
              }),
            }),
          );
        });
      }
    });

    describe("WAV container wrapping", () => {
      it("wraps raw PCM data in WAV container (44-byte header)", async () => {
        // 8 raw PCM bytes
        const pcmBytes = [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07];
        const pcmBase64 = btoa(String.fromCharCode(...pcmBytes));
        const generateContent = vi.fn().mockResolvedValue(buildMockSpeechResponse(pcmBase64));
        const client = { models: { generateContent } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        const result = await provider.generateSpeech({
          model: "gemini-2.5-flash-preview-tts",
          input: "Test audio",
          voice: "Charon",
        });

        // WAV header is 44 bytes + PCM data length
        const audioData = new Uint8Array(result.audio);
        expect(audioData.length).toBe(44 + pcmBytes.length);

        // Verify RIFF header signature
        expect(audioData[0]).toBe(0x52); // 'R'
        expect(audioData[1]).toBe(0x49); // 'I'
        expect(audioData[2]).toBe(0x46); // 'F'
        expect(audioData[3]).toBe(0x46); // 'F'

        // Verify WAVE signature at offset 8
        expect(audioData[8]).toBe(0x57); // 'W'
        expect(audioData[9]).toBe(0x41); // 'A'
        expect(audioData[10]).toBe(0x56); // 'V'
        expect(audioData[11]).toBe(0x45); // 'E'
      });

      it("encodes 24kHz sample rate in WAV header", async () => {
        const pcmBytes = new Array(48000).fill(0); // 1 second at 24kHz
        const pcmBase64 = btoa(String.fromCharCode(...pcmBytes));
        const generateContent = vi.fn().mockResolvedValue(buildMockSpeechResponse(pcmBase64));
        const client = { models: { generateContent } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        const result = await provider.generateSpeech({
          model: "gemini-2.5-flash-preview-tts",
          input: "Test",
          voice: "Kore",
        });

        const view = new DataView(result.audio);
        // Sample rate at offset 24 (little-endian uint32)
        const sampleRate = view.getUint32(24, true);
        expect(sampleRate).toBe(24000);

        // Number of channels at offset 22 (uint16)
        const channels = view.getUint16(22, true);
        expect(channels).toBe(1); // mono

        // Bits per sample at offset 34 (uint16)
        const bitsPerSample = view.getUint16(34, true);
        expect(bitsPerSample).toBe(16);
      });

      it("returns wav as format", async () => {
        const pcmBase64 = btoa(String.fromCharCode(0, 0));
        const generateContent = vi.fn().mockResolvedValue(buildMockSpeechResponse(pcmBase64));
        const client = { models: { generateContent } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        const result = await provider.generateSpeech({
          model: "gemini-2.5-flash-preview-tts",
          input: "Test",
          voice: "Fenrir",
        });

        expect(result.format).toBe("wav");
      });
    });

    describe("error handling", () => {
      it("throws error when no audio data in response", async () => {
        const generateContent = vi.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [{ text: "I cannot generate audio" }],
              },
            },
          ],
        });
        const client = { models: { generateContent } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        await expect(
          provider.generateSpeech({
            model: "gemini-2.5-flash-preview-tts",
            input: "Test",
          }),
        ).rejects.toThrow("No audio data in Gemini TTS response");
      });

      it("throws error when candidates array is empty", async () => {
        const generateContent = vi.fn().mockResolvedValue({
          candidates: [],
        });
        const client = { models: { generateContent } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        await expect(
          provider.generateSpeech({
            model: "gemini-2.5-flash-preview-tts",
            input: "Test",
          }),
        ).rejects.toThrow("No audio data in Gemini TTS response");
      });

      it("throws error when response has no candidates", async () => {
        const generateContent = vi.fn().mockResolvedValue({});
        const client = { models: { generateContent } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        await expect(
          provider.generateSpeech({
            model: "gemini-2.5-flash-preview-tts",
            input: "Test",
          }),
        ).rejects.toThrow("No audio data in Gemini TTS response");
      });

      it("throws error when parts contain only text (no inlineData)", async () => {
        const generateContent = vi.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [{ text: "some text" }],
              },
            },
          ],
        });
        const client = { models: { generateContent } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        await expect(
          provider.generateSpeech({
            model: "gemini-2.5-flash-preview-tts",
            input: "Hello",
          }),
        ).rejects.toThrow("No audio data in Gemini TTS response");
      });
    });

    describe("result metadata", () => {
      it("returns correct model in result", async () => {
        const pcmBase64 = btoa(String.fromCharCode(0, 0, 0, 0));
        const generateContent = vi.fn().mockResolvedValue(buildMockSpeechResponse(pcmBase64));
        const client = { models: { generateContent } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        const result = await provider.generateSpeech({
          model: "gemini-2.5-flash-preview-tts",
          input: "Hello world",
          voice: "Aoede",
        });

        expect(result.model).toBe("gemini-2.5-flash-preview-tts");
      });

      it("returns character count in usage", async () => {
        const input = "Hello, this is a test";
        const pcmBase64 = btoa(String.fromCharCode(0, 0, 0, 0));
        const generateContent = vi.fn().mockResolvedValue(buildMockSpeechResponse(pcmBase64));
        const client = { models: { generateContent } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        const result = await provider.generateSpeech({
          model: "gemini-2.5-flash-preview-tts",
          input,
          voice: "Puck",
        });

        expect(result.usage.characterCount).toBe(input.length);
      });

      it("uses default voice from model spec when voice not specified", async () => {
        const pcmBase64 = btoa(String.fromCharCode(0, 0, 0, 0));
        const generateContent = vi.fn().mockResolvedValue(buildMockSpeechResponse(pcmBase64));
        const client = { models: { generateContent } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        await provider.generateSpeech({
          model: "gemini-2.5-flash-preview-tts",
          input: "Test default voice",
          // No voice specified - should use model's defaultVoice ("Zephyr")
        });

        expect(generateContent).toHaveBeenCalledWith(
          expect.objectContaining({
            config: expect.objectContaining({
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: "Zephyr", // Default voice for gemini-2.5-flash-preview-tts
                  },
                },
              },
            }),
          }),
        );
      });

      it("works with gemini-2.5-pro-preview-tts model", async () => {
        const pcmBase64 = btoa(String.fromCharCode(0, 0, 0, 0));
        const generateContent = vi.fn().mockResolvedValue(buildMockSpeechResponse(pcmBase64));
        const client = { models: { generateContent } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        const result = await provider.generateSpeech({
          model: "gemini-2.5-pro-preview-tts",
          input: "Pro TTS test",
          voice: "Charon",
        });

        expect(generateContent).toHaveBeenCalledWith(
          expect.objectContaining({
            model: "gemini-2.5-pro-preview-tts",
          }),
        );
        expect(result.model).toBe("gemini-2.5-pro-preview-tts");
      });
    });

    describe("cost calculation for speech generation", () => {
      it("calculates cost for Flash TTS model based on character count", () => {
        // 750 chars/min at $0.01/min
        const cost = calculateGeminiSpeechCost("gemini-2.5-flash-preview-tts", 750);
        expect(cost).toBeCloseTo(0.01); // 1 minute
      });

      it("calculates cost for Pro TTS model based on character count", () => {
        // 750 chars/min at $0.02/min
        const cost = calculateGeminiSpeechCost("gemini-2.5-pro-preview-tts", 750);
        expect(cost).toBeCloseTo(0.02); // 1 minute
      });

      it("uses provided estimatedMinutes for cost calculation", () => {
        // Flash TTS: $0.01/min × 5 min = $0.05
        const cost = calculateGeminiSpeechCost("gemini-2.5-flash-preview-tts", 0, 5);
        expect(cost).toBeCloseTo(0.05);
      });

      it("returns undefined for unknown speech model", () => {
        const cost = calculateGeminiSpeechCost("unknown-tts-model", 100);
        expect(cost).toBeUndefined();
      });

      it("includes cost in generateSpeech result", async () => {
        const input = "Hello world"; // 11 chars
        const pcmBase64 = btoa(String.fromCharCode(0, 0, 0, 0));
        const generateContent = vi.fn().mockResolvedValue(buildMockSpeechResponse(pcmBase64));
        const client = { models: { generateContent } } as unknown as GoogleGenAI;
        const provider = new GeminiGenerativeProvider(client);

        const result = await provider.generateSpeech({
          model: "gemini-2.5-flash-preview-tts",
          input,
          voice: "Puck",
        });

        // 11 chars / 750 * $0.01 ≈ $0.000147
        const expectedCost = (11 / 750) * 0.01;
        expect(result.cost).toBeCloseTo(expectedCost, 6);
      });
    });
  });
});
