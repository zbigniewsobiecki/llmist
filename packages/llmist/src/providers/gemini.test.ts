import type { GoogleGenAI } from "@google/genai";
import { describe, expect, it, vi } from "vitest";

import { GeminiGenerativeProvider } from "./gemini.js";

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
  });
});
