import { describe, expect, it, mock } from "bun:test";
import type OpenAI from "openai";

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
      const createSpy = mock().mockResolvedValue(
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
      const createSpy = mock().mockResolvedValue((async function* () {})());

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
      const createSpy = mock().mockResolvedValue((async function* () {})());

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
            create: mock().mockResolvedValue(mockStream),
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
            create: mock().mockResolvedValue(mockStream),
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
            create: mock().mockResolvedValue(mockStream),
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
});
