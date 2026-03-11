import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import type { AudioContentPart, ImageContentPart } from "../core/input-content.js";
import { AnthropicMessagesProvider } from "./anthropic.js";

describe("AnthropicMessagesProvider", () => {
  describe("supports", () => {
    it("supports anthropic provider", () => {
      const mockClient = {} as Anthropic;
      const provider = new AnthropicMessagesProvider(mockClient);

      expect(provider.supports({ provider: "anthropic", name: "claude-3" })).toBe(true);
    });

    it("does not support other providers", () => {
      const mockClient = {} as Anthropic;
      const provider = new AnthropicMessagesProvider(mockClient);

      expect(provider.supports({ provider: "openai", name: "gpt-4" })).toBe(false);
      expect(provider.supports({ provider: "gemini", name: "gemini-pro" })).toBe(false);
    });
  });

  describe("payload building", () => {
    it("extracts system messages correctly", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const options = {
        model: "claude-3",
        messages: [
          { role: "system" as const, content: "You are helpful" },
          { role: "user" as const, content: "Hello" },
        ],
      };

      await provider.stream(options, { provider: "anthropic", name: "claude-3" }).next();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          system: [
            {
              type: "text",
              text: "You are helpful",
              cache_control: { type: "ephemeral" },
            },
          ],
        }),
        undefined, // signal options
      );
    });

    it("joins multiple system messages", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const options = {
        model: "claude-3",
        messages: [
          { role: "system" as const, content: "First system" },
          { role: "system" as const, content: "Second system" },
          { role: "user" as const, content: "Hello" },
        ],
      };

      await provider.stream(options, { provider: "anthropic", name: "claude-3" }).next();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          system: [
            { type: "text", text: "First system" },
            {
              type: "text",
              text: "Second system",
              cache_control: { type: "ephemeral" },
            },
          ],
        }),
        undefined, // signal options
      );
    });

    it("filters system messages from conversation", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const options = {
        model: "claude-3",
        messages: [
          { role: "system" as const, content: "System" },
          { role: "user" as const, content: "User 1" },
          { role: "assistant" as const, content: "Assistant 1" },
          { role: "user" as const, content: "User 2" },
        ],
      };

      await provider.stream(options, { provider: "anthropic", name: "claude-3" }).next();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: "user", content: [{ type: "text", text: "User 1" }] },
            { role: "assistant", content: [{ type: "text", text: "Assistant 1" }] },
            {
              role: "user",
              content: [{ type: "text", text: "User 2", cache_control: { type: "ephemeral" } }],
            },
          ],
        }),
        undefined, // signal options
      );
    });

    it("includes generation parameters", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const options = {
        model: "claude-3",
        messages: [{ role: "user" as const, content: "Test" }],
        maxTokens: 500,
        temperature: 0.8,
        topP: 0.95,
        stopSequences: ["END"],
      };

      await provider.stream(options, { provider: "anthropic", name: "claude-3" }).next();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 500,
          temperature: 0.8,
          top_p: 0.95,
          stop_sequences: ["END"],
          stream: true,
        }),
        undefined, // signal options
      );
    });

    it("uses default max_tokens when not specified", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const options = {
        model: "claude-3",
        messages: [{ role: "user" as const, content: "Test" }],
      };

      await provider.stream(options, { provider: "anthropic", name: "claude-3" }).next();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 4096, // Default fallback when model not in catalog
        }),
        undefined, // signal options
      );
    });
  });

  describe("stream wrapping", () => {
    it("extracts text from content_block_delta events", async () => {
      const mockStream = (async function* () {
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hello" },
        };
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text: " world" },
        };
      })();

      const mockClient = {
        messages: {
          create: vi.fn().mockReturnValue(mockStream),
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const stream = provider.stream(
        {
          model: "claude-3",
          messages: [{ role: "user" as const, content: "Test" }],
        },
        { provider: "anthropic", name: "claude-3" },
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

    it("detects finish reason from message_delta", async () => {
      const mockStream = (async function* () {
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Done" },
        };
        yield {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
        };
      })();

      const mockClient = {
        messages: {
          create: vi.fn().mockReturnValue(mockStream),
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const stream = provider.stream(
        {
          model: "claude-3",
          messages: [{ role: "user" as const, content: "Test" }],
        },
        { provider: "anthropic", name: "claude-3" },
      );

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toContainEqual(
        expect.objectContaining({ text: "", finishReason: "end_turn" }),
      );
    });

    it("detects finish from message_stop event", async () => {
      const mockStream = (async function* () {
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Text" },
        };
        yield {
          type: "message_stop",
        };
      })();

      const mockClient = {
        messages: {
          create: vi.fn().mockReturnValue(mockStream),
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const stream = provider.stream(
        {
          model: "claude-3",
          messages: [{ role: "user" as const, content: "Test" }],
        },
        { provider: "anthropic", name: "claude-3" },
      );

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toContainEqual(expect.objectContaining({ text: "", finishReason: "stop" }));
    });

    it("ignores non-text delta events", async () => {
      const mockStream = (async function* () {
        yield {
          type: "content_block_start",
          content_block: { type: "text", text: "" },
        };
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hello" },
        };
      })();

      const mockClient = {
        messages: {
          create: vi.fn().mockReturnValue(mockStream),
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const stream = provider.stream(
        {
          model: "claude-3",
          messages: [{ role: "user" as const, content: "Test" }],
        },
        { provider: "anthropic", name: "claude-3" },
      );

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      // Should only have the text delta, not the start event
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({ text: "Hello" });
    });
  });

  describe("abort signal propagation", () => {
    it("passes abort signal to SDK when provided", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const controller = new AbortController();
      const options = {
        model: "claude-3",
        messages: [{ role: "user" as const, content: "Test" }],
        signal: controller.signal,
      };

      await provider.stream(options, { provider: "anthropic", name: "claude-3" }).next();

      expect(createSpy).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it("does not pass signal options when signal is not provided", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const options = {
        model: "claude-3",
        messages: [{ role: "user" as const, content: "Test" }],
      };

      await provider.stream(options, { provider: "anthropic", name: "claude-3" }).next();

      // When no signal is provided, second argument should be undefined
      expect(createSpy).toHaveBeenCalledWith(expect.any(Object), undefined);
    });
  });

  describe("caching opt-out", () => {
    it("omits cache_control from system messages when caching disabled", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const options = {
        model: "claude-3",
        messages: [
          { role: "system" as const, content: "You are helpful" },
          { role: "user" as const, content: "Hello" },
        ],
        caching: { enabled: false },
      };

      await provider.stream(options, { provider: "anthropic", name: "claude-3" }).next();

      const payload = createSpy.mock.calls[0][0];
      // System message should NOT have cache_control
      expect(payload.system).toEqual([{ type: "text", text: "You are helpful" }]);
    });

    it("omits cache_control from user messages when caching disabled", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const options = {
        model: "claude-3",
        messages: [
          { role: "system" as const, content: "System" },
          { role: "user" as const, content: "User 1" },
          { role: "assistant" as const, content: "Response" },
          { role: "user" as const, content: "User 2" },
        ],
        caching: { enabled: false },
      };

      await provider.stream(options, { provider: "anthropic", name: "claude-3" }).next();

      const payload = createSpy.mock.calls[0][0];
      // Last user message should NOT have cache_control
      const lastUserMsg = payload.messages[2];
      expect(lastUserMsg.content).toEqual([{ type: "text", text: "User 2" }]);
      // Verify no cache_control anywhere in messages
      for (const msg of payload.messages) {
        for (const block of msg.content) {
          expect(block).not.toHaveProperty("cache_control");
        }
      }
    });

    it("preserves cache_control markers by default (no caching config)", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const options = {
        model: "claude-3",
        messages: [
          { role: "system" as const, content: "You are helpful" },
          { role: "user" as const, content: "Hello" },
        ],
        // No caching config — should default to enabled (existing behavior)
      };

      await provider.stream(options, { provider: "anthropic", name: "claude-3" }).next();

      const payload = createSpy.mock.calls[0][0];
      // System message SHOULD have cache_control
      expect(payload.system).toEqual([
        {
          type: "text",
          text: "You are helpful",
          cache_control: { type: "ephemeral" },
        },
      ]);
    });

    it("preserves cache_control markers when caching explicitly enabled", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const options = {
        model: "claude-3",
        messages: [
          { role: "system" as const, content: "You are helpful" },
          { role: "user" as const, content: "Hello" },
        ],
        caching: { enabled: true },
      };

      await provider.stream(options, { provider: "anthropic", name: "claude-3" }).next();

      const payload = createSpy.mock.calls[0][0];
      // System message SHOULD have cache_control
      expect(payload.system[0]).toHaveProperty("cache_control");
    });
  });

  describe("countTokens", () => {
    it("counts tokens for simple messages", async () => {
      const mockCountTokens = vi.fn().mockResolvedValue({
        input_tokens: 10,
      });

      const mockClient = {
        messages: {
          countTokens: mockCountTokens,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const count = await provider.countTokens(
        [{ role: "user" as const, content: "Hello world" }],
        { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
      );

      expect(count).toBe(10);
      expect(mockCountTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "Hello world" }],
            },
          ],
        }),
      );
    });

    it("includes system messages in token count", async () => {
      const mockCountTokens = vi.fn().mockResolvedValue({
        input_tokens: 25,
      });

      const mockClient = {
        messages: {
          countTokens: mockCountTokens,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const count = await provider.countTokens(
        [
          { role: "system" as const, content: "You are helpful" },
          { role: "user" as const, content: "Hello" },
        ],
        { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
      );

      expect(count).toBe(25);
      expect(mockCountTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          system: "You are helpful",
        }),
      );
    });

    it("joins multiple system messages", async () => {
      const mockCountTokens = vi.fn().mockResolvedValue({
        input_tokens: 30,
      });

      const mockClient = {
        messages: {
          countTokens: mockCountTokens,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      await provider.countTokens(
        [
          { role: "system" as const, content: "First" },
          { role: "system" as const, content: "Second" },
          { role: "user" as const, content: "Hello" },
        ],
        { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
      );

      expect(mockCountTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          system: "First\n\nSecond",
        }),
      );
    });

    it("uses fallback estimation when API fails", async () => {
      const mockCountTokens = vi.fn().mockRejectedValue(new Error("API error"));

      const mockClient = {
        messages: {
          countTokens: mockCountTokens,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const count = await provider.countTokens(
        [{ role: "user" as const, content: "Hello world" }], // "Hello world" = 11 chars
        { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
      );

      // Fallback: 11 chars / 4 = 2.75, ceil = 3
      expect(count).toBe(3);
    });

    it("handles empty content with defensive checks", async () => {
      const mockCountTokens = vi.fn().mockResolvedValue({
        input_tokens: 5,
      });

      const mockClient = {
        messages: {
          countTokens: mockCountTokens,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const count = await provider.countTokens([{ role: "user" as const, content: "" }], {
        provider: "anthropic",
        name: "claude-3-5-sonnet-20241022",
      });

      expect(count).toBeGreaterThanOrEqual(0);
    });

    it("handles multiple messages correctly", async () => {
      const mockCountTokens = vi.fn().mockResolvedValue({
        input_tokens: 50,
      });

      const mockClient = {
        messages: {
          countTokens: mockCountTokens,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const count = await provider.countTokens(
        [
          { role: "user" as const, content: "First message" },
          { role: "assistant" as const, content: "Response" },
          { role: "user" as const, content: "Second message" },
        ],
        { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
      );

      expect(count).toBe(50);
      expect(mockCountTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: "user", content: [{ type: "text", text: "First message" }] },
            { role: "assistant", content: [{ type: "text", text: "Response" }] },
            { role: "user", content: [{ type: "text", text: "Second message" }] },
          ],
        }),
      );
    });
  });

  describe("generateImage (not supported)", () => {
    it("throws a not supported error", async () => {
      const mockClient = {} as Anthropic;
      const provider = new AnthropicMessagesProvider(mockClient);

      await expect(provider.generateImage()).rejects.toThrow(
        "Anthropic does not support image generation",
      );
    });

    it("error message mentions alternative providers", async () => {
      const mockClient = {} as Anthropic;
      const provider = new AnthropicMessagesProvider(mockClient);

      await expect(provider.generateImage()).rejects.toThrow("OpenAI");
    });
  });

  describe("generateSpeech (not supported)", () => {
    it("throws a not supported error", async () => {
      const mockClient = {} as Anthropic;
      const provider = new AnthropicMessagesProvider(mockClient);

      await expect(provider.generateSpeech()).rejects.toThrow(
        "Anthropic does not support speech generation",
      );
    });

    it("error message mentions alternative providers", async () => {
      const mockClient = {} as Anthropic;
      const provider = new AnthropicMessagesProvider(mockClient);

      await expect(provider.generateSpeech()).rejects.toThrow("OpenAI");
    });
  });

  describe("audio content rejection", () => {
    it("throws descriptive error when audio content is in a message", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const audioContent: AudioContentPart[] = [
        {
          type: "audio",
          source: { type: "base64", mediaType: "audio/mp3", data: "dGVzdA==" },
        },
      ];

      const streamCall = provider
        .stream(
          {
            model: "claude-3",
            messages: [{ role: "user" as const, content: audioContent }],
          },
          { provider: "anthropic", name: "claude-3" },
        )
        .next();

      await expect(streamCall).rejects.toThrow("Anthropic does not support audio input");
    });

    it("error message mentions Gemini as alternative", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const audioContent: AudioContentPart[] = [
        {
          type: "audio",
          source: { type: "base64", mediaType: "audio/wav", data: "dGVzdA==" },
        },
      ];

      const streamCall = provider
        .stream(
          {
            model: "claude-3",
            messages: [{ role: "user" as const, content: audioContent }],
          },
          { provider: "anthropic", name: "claude-3" },
        )
        .next();

      await expect(streamCall).rejects.toThrow("Gemini");
    });
  });

  describe("URL-based image content rejection", () => {
    it("throws error when image content uses URL source", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const imageContent: ImageContentPart[] = [
        {
          type: "image",
          source: { type: "url", url: "https://example.com/photo.jpg" },
        },
      ];

      const streamCall = provider
        .stream(
          {
            model: "claude-3",
            messages: [{ role: "user" as const, content: imageContent }],
          },
          { provider: "anthropic", name: "claude-3" },
        )
        .next();

      await expect(streamCall).rejects.toThrow("Anthropic does not support image URLs");
    });

    it("error message advises base64-encoded data", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const imageContent: ImageContentPart[] = [
        {
          type: "image",
          source: { type: "url", url: "https://example.com/photo.jpg" },
        },
      ];

      const streamCall = provider
        .stream(
          {
            model: "claude-3",
            messages: [{ role: "user" as const, content: imageContent }],
          },
          { provider: "anthropic", name: "claude-3" },
        )
        .next();

      await expect(streamCall).rejects.toThrow("base64");
    });
  });

  describe("thinking events (extended thinking / reasoning mode)", () => {
    it("yields thinking chunk from content_block_start with thinking type", async () => {
      const mockStream = (async function* () {
        yield {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "" },
        };
      })();

      const mockClient = {
        messages: {
          create: vi.fn().mockReturnValue(mockStream),
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const chunks = [];
      for await (const chunk of provider.stream(
        { model: "claude-3", messages: [{ role: "user" as const, content: "Think" }] },
        { provider: "anthropic", name: "claude-3" },
      )) {
        chunks.push(chunk);
      }

      expect(chunks).toContainEqual(
        expect.objectContaining({ thinking: { content: "", type: "thinking" } }),
      );
    });

    it("yields redacted thinking chunk from content_block_start with redacted_thinking type", async () => {
      const mockStream = (async function* () {
        yield {
          type: "content_block_start",
          index: 0,
          content_block: { type: "redacted_thinking", data: "encrypted" },
        };
      })();

      const mockClient = {
        messages: {
          create: vi.fn().mockReturnValue(mockStream),
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const chunks = [];
      for await (const chunk of provider.stream(
        { model: "claude-3", messages: [{ role: "user" as const, content: "Think" }] },
        { provider: "anthropic", name: "claude-3" },
      )) {
        chunks.push(chunk);
      }

      expect(chunks).toContainEqual(
        expect.objectContaining({ thinking: { content: "", type: "redacted" } }),
      );
    });

    it("yields thinking delta content from thinking_delta events", async () => {
      const mockStream = (async function* () {
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "I am reasoning about this..." },
        };
      })();

      const mockClient = {
        messages: {
          create: vi.fn().mockReturnValue(mockStream),
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const chunks = [];
      for await (const chunk of provider.stream(
        { model: "claude-3", messages: [{ role: "user" as const, content: "Think" }] },
        { provider: "anthropic", name: "claude-3" },
      )) {
        chunks.push(chunk);
      }

      expect(chunks).toContainEqual(
        expect.objectContaining({
          thinking: { content: "I am reasoning about this...", type: "thinking" },
        }),
      );
    });

    it("yields signature from signature_delta events", async () => {
      const mockStream = (async function* () {
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "abc123signature" },
        };
      })();

      const mockClient = {
        messages: {
          create: vi.fn().mockReturnValue(mockStream),
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const chunks = [];
      for await (const chunk of provider.stream(
        { model: "claude-3", messages: [{ role: "user" as const, content: "Think" }] },
        { provider: "anthropic", name: "claude-3" },
      )) {
        chunks.push(chunk);
      }

      expect(chunks).toContainEqual(
        expect.objectContaining({
          thinking: { content: "", type: "thinking", signature: "abc123signature" },
        }),
      );
    });

    it("yields text and thinking chunks in a combined thinking + answer stream", async () => {
      const mockStream = (async function* () {
        yield {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "" },
        };
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "Let me think..." },
        };
        yield {
          type: "content_block_start",
          index: 1,
          content_block: { type: "text", text: "" },
        };
        yield {
          type: "content_block_delta",
          index: 1,
          delta: { type: "text_delta", text: "The answer is 42." },
        };
      })();

      const mockClient = {
        messages: {
          create: vi.fn().mockReturnValue(mockStream),
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const chunks = [];
      for await (const chunk of provider.stream(
        {
          model: "claude-3",
          messages: [{ role: "user" as const, content: "What is the answer?" }],
        },
        { provider: "anthropic", name: "claude-3" },
      )) {
        chunks.push(chunk);
      }

      const thinkingChunks = chunks.filter((c) => c.thinking);
      const textChunks = chunks.filter((c) => c.text && !c.thinking);

      expect(thinkingChunks.length).toBeGreaterThan(0);
      expect(textChunks).toContainEqual(expect.objectContaining({ text: "The answer is 42." }));
    });
  });

  describe("prompt caching disabled path", () => {
    it("applies cache_control by default (caching config is undefined)", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const options = {
        model: "claude-3",
        messages: [
          { role: "system" as const, content: "Be helpful" },
          { role: "user" as const, content: "Hello" },
        ],
        // caching is explicitly undefined here — default enabled behavior
        caching: undefined,
      };

      await provider.stream(options, { provider: "anthropic", name: "claude-3" }).next();

      const payload = createSpy.mock.calls[0][0];
      // Default (undefined caching) should preserve cache_control on system block
      expect(payload.system[0]).toHaveProperty("cache_control");
    });

    it("does not apply cache_control when caching is explicitly disabled", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const options = {
        model: "claude-3",
        messages: [
          { role: "system" as const, content: "Be helpful" },
          { role: "user" as const, content: "Hello" },
        ],
        caching: { enabled: false },
      };

      await provider.stream(options, { provider: "anthropic", name: "claude-3" }).next();

      const payload = createSpy.mock.calls[0][0];
      // Explicitly disabled caching — no cache_control on any system block
      for (const block of payload.system) {
        expect(block).not.toHaveProperty("cache_control");
      }
    });

    it("does not apply cache_control to user messages when caching is disabled", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const options = {
        model: "claude-3",
        messages: [
          { role: "user" as const, content: "First question" },
          { role: "assistant" as const, content: "First answer" },
          { role: "user" as const, content: "Second question" },
        ],
        caching: { enabled: false },
      };

      await provider.stream(options, { provider: "anthropic", name: "claude-3" }).next();

      const payload = createSpy.mock.calls[0][0];
      // No message content block should have cache_control
      for (const msg of payload.messages) {
        for (const block of msg.content) {
          expect(block).not.toHaveProperty("cache_control");
        }
      }
    });
  });
});
