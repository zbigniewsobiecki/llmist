import { describe, expect, it, mock } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";

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
      const createSpy = mock().mockReturnValue((async function* () {})());

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
      const createSpy = mock().mockReturnValue((async function* () {})());

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
      const createSpy = mock().mockReturnValue((async function* () {})());

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
              content: [
                { type: "text", text: "User 2", cache_control: { type: "ephemeral" } },
              ],
            },
          ],
        }),
        undefined, // signal options
      );
    });

    it("includes generation parameters", async () => {
      const createSpy = mock().mockReturnValue((async function* () {})());

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
      const createSpy = mock().mockReturnValue((async function* () {})());

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
          create: mock().mockReturnValue(mockStream),
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
          create: mock().mockReturnValue(mockStream),
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
          create: mock().mockReturnValue(mockStream),
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
          create: mock().mockReturnValue(mockStream),
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
      const createSpy = mock().mockReturnValue((async function* () {})());

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
      const createSpy = mock().mockReturnValue((async function* () {})());

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

  describe("countTokens", () => {
    it("counts tokens for simple messages", async () => {
      const mockCountTokens = mock().mockResolvedValue({
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
      const mockCountTokens = mock().mockResolvedValue({
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
      const mockCountTokens = mock().mockResolvedValue({
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
      const mockCountTokens = mock().mockRejectedValue(new Error("API error"));

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
      const mockCountTokens = mock().mockResolvedValue({
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
      const mockCountTokens = mock().mockResolvedValue({
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
});
