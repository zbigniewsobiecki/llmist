import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";

import { OpenAIChatProvider } from "./openai.js";

describe("OpenAIChatProvider reasoning support", () => {
  describe("buildApiRequest - reasoning parameter mapping", () => {
    it("includes reasoning parameter with medium effort by default", async () => {
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
        model: "o3",
        messages: [{ role: "user" as const, content: "Test" }],
        reasoning: { enabled: true },
      };

      await provider.stream(options, { provider: "openai", name: "o3" }).next();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoning: { effort: "medium" },
        }),
        undefined,
      );
    });

    it("maps effort levels correctly", async () => {
      const effortMappings: Array<{ input: string; expected: string }> = [
        { input: "none", expected: "none" },
        { input: "low", expected: "low" },
        { input: "medium", expected: "medium" },
        { input: "high", expected: "high" },
        { input: "maximum", expected: "xhigh" },
      ];

      for (const { input, expected } of effortMappings) {
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
          model: "o3",
          messages: [{ role: "user" as const, content: "Test" }],
          reasoning: {
            enabled: true,
            effort: input as "none" | "low" | "medium" | "high" | "maximum",
          },
        };

        await provider.stream(options, { provider: "openai", name: "o3" }).next();

        const payload = createSpy.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(payload.reasoning).toEqual({ effort: expected });
      }
    });

    it("includes reasoning when explicitly disabled (effort: none)", async () => {
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
        model: "o3",
        messages: [{ role: "user" as const, content: "Test" }],
        reasoning: { enabled: false },
      };

      await provider.stream(options, { provider: "openai", name: "o3" }).next();

      // When enabled is explicitly set (even to false), the reasoning param should be included
      const payload = createSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload.reasoning).toBeDefined();
    });

    it("omits reasoning parameter when not configured", async () => {
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

      const payload = createSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload.reasoning).toBeUndefined();
    });
  });

  describe("normalizeProviderStream - reasoning token extraction", () => {
    it("extracts reasoning_tokens from completion_tokens_details", async () => {
      const mockStream = (async function* () {
        yield {
          choices: [{ delta: { content: "Answer" }, finish_reason: null }],
        };
        yield {
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 50,
            completion_tokens: 200,
            total_tokens: 250,
            completion_tokens_details: { reasoning_tokens: 150 },
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
          model: "o3",
          messages: [{ role: "user" as const, content: "Test" }],
        },
        { provider: "openai", name: "o3" },
      );

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const finalChunk = chunks.find((c) => c.usage);
      expect(finalChunk).toBeDefined();
      expect(finalChunk?.usage?.reasoningTokens).toBe(150);
      expect(finalChunk?.usage?.outputTokens).toBe(200);
    });

    it("handles missing completion_tokens_details gracefully", async () => {
      const mockStream = (async function* () {
        yield {
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 50,
            completion_tokens: 100,
            total_tokens: 150,
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
      expect(finalChunk?.usage?.reasoningTokens).toBeUndefined();
    });

    it("extracts both cached and reasoning tokens together", async () => {
      const mockStream = (async function* () {
        yield {
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 300,
            total_tokens: 400,
            prompt_tokens_details: { cached_tokens: 50 },
            completion_tokens_details: { reasoning_tokens: 200 },
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
          model: "o3",
          messages: [{ role: "user" as const, content: "Test" }],
        },
        { provider: "openai", name: "o3" },
      );

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const finalChunk = chunks.find((c) => c.usage);
      expect(finalChunk?.usage).toEqual({
        inputTokens: 100,
        outputTokens: 300,
        totalTokens: 400,
        cachedInputTokens: 50,
        reasoningTokens: 200,
      });
    });
  });
});
