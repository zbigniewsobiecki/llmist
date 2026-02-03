import { FunctionCallingConfigMode, type GoogleGenAI } from "@google/genai";
import { describe, expect, it, vi } from "vitest";

import { GeminiGenerativeProvider } from "./gemini.js";

describe("GeminiGenerativeProvider reasoning support", () => {
  const createClient = () => {
    const stream = (async function* () {})();
    const generateContentStream = vi.fn().mockResolvedValue(stream);
    const models = { generateContentStream };
    const client = { models } as unknown as GoogleGenAI;

    return { client, generateContentStream };
  };

  describe("buildApiRequest - thinkingConfig mapping", () => {
    it("adds thinkingLevel for Gemini 3 models", async () => {
      const { client, generateContentStream } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const options = {
        model: "gemini-3-pro",
        messages: [{ role: "user" as const, content: "Test" }],
        reasoning: { enabled: true, effort: "high" as const },
      };

      await provider.stream(options, { provider: "gemini", name: "gemini-3-pro" }).next();

      expect(generateContentStream).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            thinkingConfig: {
              thinkingLevel: "high",
            },
          }),
        }),
      );
    });

    it("maps Gemini 3 effort levels correctly", async () => {
      const effortMappings: Array<{ effort: string; expected: string }> = [
        { effort: "none", expected: "minimal" },
        { effort: "low", expected: "low" },
        { effort: "medium", expected: "medium" },
        { effort: "high", expected: "high" },
        { effort: "maximum", expected: "high" },
      ];

      for (const { effort, expected } of effortMappings) {
        const { client, generateContentStream } = createClient();
        const provider = new GeminiGenerativeProvider(client);

        const options = {
          model: "gemini-3-pro",
          messages: [{ role: "user" as const, content: "Test" }],
          reasoning: {
            enabled: true,
            effort: effort as "none" | "low" | "medium" | "high" | "maximum",
          },
        };

        await provider.stream(options, { provider: "gemini", name: "gemini-3-pro" }).next();

        const callArgs = generateContentStream.mock.calls[0]?.[0] as {
          config: { thinkingConfig: { thinkingLevel: string } };
        };
        expect(callArgs.config.thinkingConfig.thinkingLevel).toBe(expected);
      }
    });

    it("adds thinkingBudget for Gemini 2.5 models", async () => {
      const { client, generateContentStream } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const options = {
        model: "gemini-2.5-flash",
        messages: [{ role: "user" as const, content: "Test" }],
        reasoning: { enabled: true, effort: "medium" as const },
      };

      await provider.stream(options, { provider: "gemini", name: "gemini-2.5-flash" }).next();

      expect(generateContentStream).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            thinkingConfig: {
              thinkingBudget: 8192,
            },
          }),
        }),
      );
    });

    it("maps Gemini 2.5 effort levels to correct budgets", async () => {
      const effortBudgets: Array<{ effort: string; budget: number }> = [
        { effort: "none", budget: 0 },
        { effort: "low", budget: 2048 },
        { effort: "medium", budget: 8192 },
        { effort: "high", budget: 16384 },
        { effort: "maximum", budget: 24576 },
      ];

      for (const { effort, budget } of effortBudgets) {
        const { client, generateContentStream } = createClient();
        const provider = new GeminiGenerativeProvider(client);

        const options = {
          model: "gemini-2.5-pro-preview",
          messages: [{ role: "user" as const, content: "Test" }],
          reasoning: {
            enabled: true,
            effort: effort as "none" | "low" | "medium" | "high" | "maximum",
          },
        };

        await provider
          .stream(options, { provider: "gemini", name: "gemini-2.5-pro-preview" })
          .next();

        const callArgs = generateContentStream.mock.calls[0]?.[0] as {
          config: { thinkingConfig: { thinkingBudget: number } };
        };
        expect(callArgs.config.thinkingConfig.thinkingBudget).toBe(budget);
      }
    });

    it("uses explicit budgetTokens for Gemini 2.5 when provided", async () => {
      const { client, generateContentStream } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const options = {
        model: "gemini-2.5-pro-preview",
        messages: [{ role: "user" as const, content: "Test" }],
        reasoning: { enabled: true, budgetTokens: 12000 },
      };

      await provider.stream(options, { provider: "gemini", name: "gemini-2.5-pro-preview" }).next();

      expect(generateContentStream).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            thinkingConfig: {
              thinkingBudget: 12000,
            },
          }),
        }),
      );
    });

    it("does not include thinkingConfig when reasoning is not configured", async () => {
      const { client, generateContentStream } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const options = {
        model: "gemini-1.5-flash",
        messages: [{ role: "user" as const, content: "Test" }],
      };

      await provider.stream(options, { provider: "gemini", name: "gemini-1.5-flash" }).next();

      const callArgs = generateContentStream.mock.calls[0]?.[0] as {
        config: { thinkingConfig?: unknown };
      };
      expect(callArgs.config.thinkingConfig).toBeUndefined();
    });

    it("does not include thinkingConfig when reasoning is disabled", async () => {
      const { client, generateContentStream } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const options = {
        model: "gemini-2.5-pro-preview",
        messages: [{ role: "user" as const, content: "Test" }],
        reasoning: { enabled: false },
      };

      await provider.stream(options, { provider: "gemini", name: "gemini-2.5-pro-preview" }).next();

      const callArgs = generateContentStream.mock.calls[0]?.[0] as {
        config: { thinkingConfig?: unknown };
      };
      expect(callArgs.config.thinkingConfig).toBeUndefined();
    });
  });

  describe("normalizeProviderStream - thinking content extraction", () => {
    it("separates thinking parts from regular text", async () => {
      const { client } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const mockChunks = [
        {
          candidates: [
            {
              content: {
                parts: [
                  { text: "Let me think about this...", thought: true },
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

      // Should have a thinking chunk and a text chunk
      const thinkingChunks = chunks.filter((c: any) => c.thinking);
      const textChunks = chunks.filter((c: any) => c.text !== "");

      expect(thinkingChunks).toHaveLength(1);
      expect(thinkingChunks[0].thinking.content).toBe("Let me think about this...");
      expect(thinkingChunks[0].thinking.type).toBe("thinking");

      expect(textChunks).toHaveLength(1);
      expect(textChunks[0].text).toBe("The answer is 42.");
    });

    it("extracts thought signatures from Gemini 3 parts", async () => {
      const { client } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const mockChunks = [
        {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "Thinking step...",
                    thought: true,
                    thoughtSignature: "gemini3_sig_xyz",
                  },
                  { text: "The result." },
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

      const thinkingChunk = chunks.find((c: any) => c.thinking);
      expect(thinkingChunk).toBeDefined();
      expect(thinkingChunk.thinking.signature).toBe("gemini3_sig_xyz");
    });

    it("extracts thoughtsTokenCount into reasoningTokens", async () => {
      const { client } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const mockChunks = [
        {
          candidates: [{ finishReason: "STOP" }],
          usageMetadata: {
            promptTokenCount: 50,
            candidatesTokenCount: 200,
            totalTokenCount: 250,
            thoughtsTokenCount: 120,
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

      const usageChunk = chunks.find((c: any) => c.usage);
      expect(usageChunk).toBeDefined();
      expect(usageChunk.usage.reasoningTokens).toBe(120);
      expect(usageChunk.usage.outputTokens).toBe(200);
    });

    it("handles chunks without thinking parts gracefully", async () => {
      const { client } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const mockChunks = [
        {
          candidates: [
            {
              content: {
                parts: [{ text: "Plain response without thinking" }],
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
      expect(chunks[0].text).toBe("Plain response without thinking");
      expect(chunks[0].thinking).toBeUndefined();
    });

    it("handles usage without thoughtsTokenCount", async () => {
      const { client } = createClient();
      const provider = new GeminiGenerativeProvider(client);

      const mockChunks = [
        {
          candidates: [{ finishReason: "STOP" }],
          usageMetadata: {
            promptTokenCount: 50,
            candidatesTokenCount: 100,
            totalTokenCount: 150,
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

      const usageChunk = chunks.find((c: any) => c.usage);
      expect(usageChunk?.usage?.reasoningTokens).toBeUndefined();
    });
  });
});
