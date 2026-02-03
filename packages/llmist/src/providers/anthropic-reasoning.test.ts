import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import { AnthropicMessagesProvider } from "./anthropic.js";

describe("AnthropicMessagesProvider reasoning support", () => {
  describe("buildApiRequest - thinking parameter mapping", () => {
    it("includes thinking config when reasoning is enabled", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const options = {
        model: "claude-4-opus",
        messages: [{ role: "user" as const, content: "Test" }],
        reasoning: { enabled: true, effort: "medium" as const },
      };

      await provider.stream(options, { provider: "anthropic", name: "claude-4-opus" }).next();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: { type: "enabled", budget_tokens: 8192 },
        }),
        undefined,
      );
    });

    it("maps effort levels to correct budget_tokens", async () => {
      const effortBudgets: Array<{ effort: string; budget: number }> = [
        { effort: "none", budget: 1024 },
        { effort: "low", budget: 2048 },
        { effort: "medium", budget: 8192 },
        { effort: "high", budget: 16384 },
        { effort: "maximum", budget: 32768 },
      ];

      for (const { effort, budget } of effortBudgets) {
        const createSpy = vi.fn().mockReturnValue((async function* () {})());

        const mockClient = {
          messages: {
            create: createSpy,
          },
        } as unknown as Anthropic;

        const provider = new AnthropicMessagesProvider(mockClient);

        const options = {
          model: "claude-4-opus",
          messages: [{ role: "user" as const, content: "Test" }],
          reasoning: {
            enabled: true,
            effort: effort as "none" | "low" | "medium" | "high" | "maximum",
          },
        };

        await provider.stream(options, { provider: "anthropic", name: "claude-4-opus" }).next();

        expect(createSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            thinking: { type: "enabled", budget_tokens: budget },
          }),
          undefined,
        );
      }
    });

    it("uses explicit budgetTokens when provided", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const options = {
        model: "claude-4-opus",
        messages: [{ role: "user" as const, content: "Test" }],
        reasoning: { enabled: true, budgetTokens: 10000 },
      };

      await provider.stream(options, { provider: "anthropic", name: "claude-4-opus" }).next();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: { type: "enabled", budget_tokens: 10000 },
        }),
        undefined,
      );
    });

    it("clamps budgetTokens to minimum of 1024", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const options = {
        model: "claude-4-opus",
        messages: [{ role: "user" as const, content: "Test" }],
        reasoning: { enabled: true, budgetTokens: 500 },
      };

      await provider.stream(options, { provider: "anthropic", name: "claude-4-opus" }).next();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: { type: "enabled", budget_tokens: 1024 },
        }),
        undefined,
      );
    });

    it("strips temperature when thinking is enabled", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const options = {
        model: "claude-4-opus",
        messages: [{ role: "user" as const, content: "Test" }],
        temperature: 0.7,
        reasoning: { enabled: true },
      };

      await provider.stream(options, { provider: "anthropic", name: "claude-4-opus" }).next();

      // Temperature should be undefined when thinking is enabled
      const payload = createSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload.temperature).toBeUndefined();
      expect(payload.thinking).toBeDefined();
    });

    it("preserves temperature when reasoning is not enabled", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const options = {
        model: "claude-3-5-sonnet",
        messages: [{ role: "user" as const, content: "Test" }],
        temperature: 0.7,
      };

      await provider.stream(options, { provider: "anthropic", name: "claude-3-5-sonnet" }).next();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
        }),
        undefined,
      );
    });

    it("does not include thinking when reasoning is disabled", async () => {
      const createSpy = vi.fn().mockReturnValue((async function* () {})());

      const mockClient = {
        messages: {
          create: createSpy,
        },
      } as unknown as Anthropic;

      const provider = new AnthropicMessagesProvider(mockClient);

      const options = {
        model: "claude-4-opus",
        messages: [{ role: "user" as const, content: "Test" }],
        reasoning: { enabled: false },
      };

      await provider.stream(options, { provider: "anthropic", name: "claude-4-opus" }).next();

      const payload = createSpy.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload.thinking).toBeUndefined();
    });
  });

  describe("normalizeProviderStream - thinking event handling", () => {
    it("yields thinking chunks from thinking_delta events", async () => {
      const mockStream = (async function* () {
        yield {
          type: "content_block_start",
          content_block: { type: "thinking" },
        };
        yield {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "Let me think about this..." },
        };
        yield {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: " The answer is 42." },
        };
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "The answer is 42." },
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
          model: "claude-4-opus",
          messages: [{ role: "user" as const, content: "Test" }],
        },
        { provider: "anthropic", name: "claude-4-opus" },
      );

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      // Should have thinking block start + 2 thinking deltas + 1 text delta
      const thinkingChunks = chunks.filter((c) => c.thinking);
      expect(thinkingChunks.length).toBeGreaterThanOrEqual(2);

      // Check the thinking_delta chunks
      expect(thinkingChunks[1].thinking?.content).toBe("Let me think about this...");
      expect(thinkingChunks[1].thinking?.type).toBe("thinking");
      expect(thinkingChunks[2].thinking?.content).toBe(" The answer is 42.");

      // Check the text delta
      const textChunks = chunks.filter((c) => c.text !== "");
      expect(textChunks).toHaveLength(1);
      expect(textChunks[0].text).toBe("The answer is 42.");
    });

    it("handles redacted_thinking blocks", async () => {
      const mockStream = (async function* () {
        yield {
          type: "content_block_start",
          content_block: { type: "redacted_thinking" },
        };
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "The answer is 42." },
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
          model: "claude-4-opus",
          messages: [{ role: "user" as const, content: "Test" }],
        },
        { provider: "anthropic", name: "claude-4-opus" },
      );

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      // Should have a redacted thinking chunk
      const thinkingChunks = chunks.filter((c) => c.thinking);
      expect(thinkingChunks).toHaveLength(1);
      expect(thinkingChunks[0].thinking?.type).toBe("redacted");
    });

    it("handles signature_delta events", async () => {
      const mockStream = (async function* () {
        yield {
          type: "content_block_start",
          content_block: { type: "thinking" },
        };
        yield {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "Thinking..." },
        };
        yield {
          type: "content_block_delta",
          delta: { type: "signature_delta", signature: "sig_abc123" },
        };
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Result" },
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
          model: "claude-4-opus",
          messages: [{ role: "user" as const, content: "Test" }],
        },
        { provider: "anthropic", name: "claude-4-opus" },
      );

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      // Find the signature chunk
      const signatureChunk = chunks.find((c) => c.thinking?.signature);
      expect(signatureChunk).toBeDefined();
      expect(signatureChunk?.thinking?.signature).toBe("sig_abc123");
    });
  });
});
