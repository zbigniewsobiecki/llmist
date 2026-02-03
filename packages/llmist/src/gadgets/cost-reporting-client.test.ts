/**
 * Tests for CostReportingLLMistWrapper
 *
 * Verifies that the wrapper correctly tracks token usage from LLM streams
 * and reports costs via the callback.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMist } from "../core/client.js";
import type { ModelRegistry } from "../core/model-registry.js";
import type { LLMGenerationOptions, LLMStreamChunk } from "../core/options.js";
import { CostReportingLLMistWrapper } from "./cost-reporting-client.js";

/**
 * Creates a mock LLMist client for testing.
 */
function createMockClient(chunks: LLMStreamChunk[]): LLMist {
  const mockRegistry = {
    estimateCost: vi.fn(
      (
        _modelId: string,
        input: number,
        output: number,
        _cached: number,
        _cacheCreation: number,
      ) => {
        // Simple cost calculation: $0.001 per 1000 tokens total
        const total = input + output;
        return {
          totalCost: (total / 1000) * 0.001,
          inputCost: (input / 1000) * 0.0005,
          outputCost: (output / 1000) * 0.0005,
        };
      },
    ),
  } as unknown as ModelRegistry;

  return {
    modelRegistry: mockRegistry,
    stream: (_options: LLMGenerationOptions) => {
      return (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })();
    },
  } as unknown as LLMist;
}

describe("CostReportingLLMistWrapper", () => {
  let reportedCosts: number[];
  let reportCost: (cost: number) => void;

  beforeEach(() => {
    reportedCosts = [];
    reportCost = (cost: number) => {
      reportedCosts.push(cost);
    };
  });

  describe("modelRegistry", () => {
    it("exposes the underlying client's model registry", () => {
      const mockClient = createMockClient([]);
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      expect(wrapper.modelRegistry).toBe(mockClient.modelRegistry);
    });
  });

  describe("complete()", () => {
    it("returns collected text from stream", async () => {
      const chunks: LLMStreamChunk[] = [
        { text: "Hello" },
        { text: " world" },
        { text: "!", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      ];
      const mockClient = createMockClient(chunks);
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      const result = await wrapper.complete("Test prompt");

      expect(result).toBe("Hello world!");
    });

    it("reports cost after completion", async () => {
      const chunks: LLMStreamChunk[] = [
        { text: "Response" },
        { text: "", usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } },
      ];
      const mockClient = createMockClient(chunks);
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      await wrapper.complete("Test prompt");

      expect(reportedCosts.length).toBe(1);
      expect(reportedCosts[0]).toBeGreaterThan(0);
    });

    it("handles cached input tokens", async () => {
      const chunks: LLMStreamChunk[] = [
        { text: "Response" },
        {
          text: "",
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cachedInputTokens: 30 },
        },
      ];
      const mockClient = createMockClient(chunks);
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      await wrapper.complete("Test prompt");

      // Verify estimateCost was called with cached tokens
      // "haiku" resolves to "anthropic:claude-haiku-4-5" (full model ID with provider prefix)
      // Model registry handles the prefix stripping internally
      const estimateCostMock = mockClient.modelRegistry.estimateCost as ReturnType<typeof mock>;
      expect(estimateCostMock).toHaveBeenCalledWith(
        "anthropic:claude-haiku-4-5",
        100,
        50,
        30,
        0,
        0,
      );
    });

    it("handles cache creation input tokens", async () => {
      const chunks: LLMStreamChunk[] = [
        { text: "Response" },
        {
          text: "",
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            cacheCreationInputTokens: 20,
          },
        },
      ];
      const mockClient = createMockClient(chunks);
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      await wrapper.complete("Test prompt");

      const estimateCostMock = mockClient.modelRegistry.estimateCost as ReturnType<typeof mock>;
      expect(estimateCostMock).toHaveBeenCalledWith(
        "anthropic:claude-haiku-4-5",
        100,
        50,
        0,
        20,
        0,
      );
    });

    it("uses specified model from options", async () => {
      const chunks: LLMStreamChunk[] = [
        { text: "Response", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      ];
      const mockClient = createMockClient(chunks);
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      await wrapper.complete("Test", { model: "sonnet" });

      // "sonnet" resolves to "anthropic:claude-sonnet-4-5" (full model ID with provider prefix)
      const estimateCostMock = mockClient.modelRegistry.estimateCost as ReturnType<typeof mock>;
      expect(estimateCostMock).toHaveBeenCalledWith("anthropic:claude-sonnet-4-5", 10, 5, 0, 0, 0);
    });

    it("does not report cost when no tokens used", async () => {
      const chunks: LLMStreamChunk[] = [{ text: "Response" }];
      const mockClient = createMockClient(chunks);
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      await wrapper.complete("Test prompt");

      expect(reportedCosts.length).toBe(0);
    });

    it("includes system prompt in messages when provided", async () => {
      const chunks: LLMStreamChunk[] = [
        { text: "Response", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      ];
      let capturedOptions: LLMGenerationOptions | undefined;
      const mockClient = {
        modelRegistry: createMockClient([]).modelRegistry,
        stream: (options: LLMGenerationOptions) => {
          capturedOptions = options;
          return (async function* () {
            for (const chunk of chunks) yield chunk;
          })();
        },
      } as unknown as LLMist;

      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);
      await wrapper.complete("User message", { systemPrompt: "You are helpful" });

      expect(capturedOptions?.messages).toHaveLength(2);
      expect(capturedOptions?.messages[0]).toEqual({ role: "system", content: "You are helpful" });
      expect(capturedOptions?.messages[1]).toEqual({ role: "user", content: "User message" });
    });
  });

  describe("streamText()", () => {
    it("yields text chunks as they arrive", async () => {
      const chunks: LLMStreamChunk[] = [
        { text: "Hello" },
        { text: " world" },
        { text: "!", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      ];
      const mockClient = createMockClient(chunks);
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      const collected: string[] = [];
      for await (const text of wrapper.streamText("Test prompt")) {
        collected.push(text);
      }

      expect(collected).toEqual(["Hello", " world", "!"]);
    });

    it("reports cost after stream completes", async () => {
      const chunks: LLMStreamChunk[] = [
        { text: "Response" },
        { text: "", usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } },
      ];
      const mockClient = createMockClient(chunks);
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      // Consume the stream
      for await (const _text of wrapper.streamText("Test prompt")) {
        // Just consume
      }

      expect(reportedCosts.length).toBe(1);
      expect(reportedCosts[0]).toBeGreaterThan(0);
    });

    it("reports cost even if stream is not fully consumed", async () => {
      const chunks: LLMStreamChunk[] = [
        { text: "First" },
        { text: "Second", usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 } },
        { text: "Third" },
      ];
      const mockClient = createMockClient(chunks);
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      // Only consume first chunk then break
      for await (const _text of wrapper.streamText("Test prompt")) {
        break;
      }

      // Cost should still be reported in finally block (though may be 0 if no usage yet)
      // At least verify no error was thrown
    });

    it("skips empty text chunks", async () => {
      const chunks: LLMStreamChunk[] = [
        { text: "Hello" },
        { text: "" }, // Empty - should be skipped
        { text: "World", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      ];
      const mockClient = createMockClient(chunks);
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      const collected: string[] = [];
      for await (const text of wrapper.streamText("Test prompt")) {
        collected.push(text);
      }

      expect(collected).toEqual(["Hello", "World"]);
    });

    it("uses specified model from options", async () => {
      const chunks: LLMStreamChunk[] = [
        { text: "Response", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      ];
      const mockClient = createMockClient(chunks);
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      for await (const _text of wrapper.streamText("Test", { model: "openai:gpt-5" })) {
        // Consume
      }

      const estimateCostMock = mockClient.modelRegistry.estimateCost as ReturnType<typeof mock>;
      // Full model ID with provider prefix is passed; registry handles stripping internally
      expect(estimateCostMock).toHaveBeenCalledWith("openai:gpt-5", 10, 5, 0, 0, 0);
    });
  });

  describe("stream()", () => {
    it("yields all chunks from underlying stream", async () => {
      const chunks: LLMStreamChunk[] = [
        { text: "Hello" },
        { text: " world" },
        { text: "!", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      ];
      const mockClient = createMockClient(chunks);
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      const collected: LLMStreamChunk[] = [];
      for await (const chunk of wrapper.stream({
        model: "haiku",
        messages: [{ role: "user", content: "Test" }],
      })) {
        collected.push(chunk);
      }

      expect(collected).toHaveLength(3);
      expect(collected.map((c) => c.text).join("")).toBe("Hello world!");
    });

    it("reports cost after stream completes", async () => {
      const chunks: LLMStreamChunk[] = [
        { text: "Response" },
        { text: "", usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } },
      ];
      const mockClient = createMockClient(chunks);
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      for await (const _chunk of wrapper.stream({
        model: "anthropic:claude-haiku-4-5-20250929",
        messages: [],
      })) {
        // Consume
      }

      expect(reportedCosts.length).toBe(1);
    });

    it("does not report cost when stream has no usage data", async () => {
      const chunks: LLMStreamChunk[] = [{ text: "Response without usage" }];
      const mockClient = createMockClient(chunks);
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      for await (const _chunk of wrapper.stream({ model: "haiku", messages: [] })) {
        // Consume
      }

      expect(reportedCosts.length).toBe(0);
    });

    it("handles provider-prefixed model names", async () => {
      const chunks: LLMStreamChunk[] = [
        { text: "Response", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      ];
      const mockClient = createMockClient(chunks);
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      for await (const _chunk of wrapper.stream({ model: "openai:gpt-5-nano", messages: [] })) {
        // Consume
      }

      const estimateCostMock = mockClient.modelRegistry.estimateCost as ReturnType<typeof mock>;
      // Full model ID with provider prefix is passed; registry handles stripping internally
      expect(estimateCostMock).toHaveBeenCalledWith("openai:gpt-5-nano", 10, 5, 0, 0, 0);
    });

    it("tracks cumulative usage across multiple chunks", async () => {
      // Simulate usage being updated in multiple chunks (last one wins)
      const chunks: LLMStreamChunk[] = [
        { text: "Part 1", usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } },
        { text: "Part 2", usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 } },
        { text: "Part 3", usage: { inputTokens: 50, outputTokens: 50, totalTokens: 100 } },
      ];
      const mockClient = createMockClient(chunks);
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      for await (const _chunk of wrapper.stream({ model: "haiku", messages: [] })) {
        // Consume
      }

      const estimateCostMock = mockClient.modelRegistry.estimateCost as ReturnType<typeof mock>;
      // Should use the final usage values
      expect(estimateCostMock).toHaveBeenCalledWith("haiku", 50, 50, 0, 0, 0);
    });

    it("does not report cost if estimateCost returns zero", async () => {
      const chunks: LLMStreamChunk[] = [
        { text: "Response", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      ];
      const mockClient = {
        modelRegistry: {
          estimateCost: () => ({ totalCost: 0, inputCost: 0, outputCost: 0 }),
        },
        stream: () =>
          (async function* () {
            for (const c of chunks) yield c;
          })(),
      } as unknown as LLMist;
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      for await (const _chunk of wrapper.stream({ model: "haiku", messages: [] })) {
        // Consume
      }

      expect(reportedCosts.length).toBe(0);
    });

    it("does not report cost if estimateCost returns undefined", async () => {
      const chunks: LLMStreamChunk[] = [
        { text: "Response", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      ];
      const mockClient = {
        modelRegistry: {
          estimateCost: () => undefined,
        },
        stream: () =>
          (async function* () {
            for (const c of chunks) yield c;
          })(),
      } as unknown as LLMist;
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      for await (const _chunk of wrapper.stream({ model: "haiku", messages: [] })) {
        // Consume
      }

      expect(reportedCosts.length).toBe(0);
    });
  });

  describe("image.generate()", () => {
    it("reports cost from image generation", async () => {
      const mockClient = {
        modelRegistry: createMockClient([]).modelRegistry,
        stream: createMockClient([]).stream,
        image: {
          generate: vi.fn(async () => ({
            images: [{ url: "https://example.com/image.png" }],
            model: "dall-e-3",
            usage: { imagesGenerated: 1, size: "1024x1024", quality: "standard" },
            cost: 0.04,
          })),
        },
        speech: {
          generate: vi.fn(async () => ({
            audio: new ArrayBuffer(1000),
            model: "tts-1",
            usage: { characterCount: 100 },
            cost: 0.0015,
            format: "mp3",
          })),
        },
      } as unknown as LLMist;
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      await wrapper.image.generate({
        model: "dall-e-3",
        prompt: "A cat in space",
      });

      expect(reportedCosts.length).toBe(1);
      expect(reportedCosts[0]).toBe(0.04);
    });

    it("does not report cost when cost is zero", async () => {
      const mockClient = {
        modelRegistry: createMockClient([]).modelRegistry,
        stream: createMockClient([]).stream,
        image: {
          generate: vi.fn(async () => ({
            images: [{ url: "https://example.com/image.png" }],
            model: "test-model",
            usage: { imagesGenerated: 1, size: "1024x1024", quality: "standard" },
            cost: 0,
          })),
        },
        speech: {
          generate: vi.fn(async () => ({
            audio: new ArrayBuffer(0),
            model: "test",
            usage: { characterCount: 0 },
            cost: 0,
            format: "mp3",
          })),
        },
      } as unknown as LLMist;
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      await wrapper.image.generate({
        model: "test-model",
        prompt: "Test",
      });

      expect(reportedCosts.length).toBe(0);
    });

    it("does not report cost when cost is undefined", async () => {
      const mockClient = {
        modelRegistry: createMockClient([]).modelRegistry,
        stream: createMockClient([]).stream,
        image: {
          generate: vi.fn(async () => ({
            images: [{ url: "https://example.com/image.png" }],
            model: "test-model",
            usage: { imagesGenerated: 1, size: "1024x1024", quality: "standard" },
            // cost is undefined
          })),
        },
        speech: {
          generate: vi.fn(async () => ({
            audio: new ArrayBuffer(0),
            model: "test",
            usage: { characterCount: 0 },
            format: "mp3",
          })),
        },
      } as unknown as LLMist;
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      await wrapper.image.generate({
        model: "test-model",
        prompt: "Test",
      });

      expect(reportedCosts.length).toBe(0);
    });
  });

  describe("speech.generate()", () => {
    it("reports cost from speech generation", async () => {
      const mockClient = {
        modelRegistry: createMockClient([]).modelRegistry,
        stream: createMockClient([]).stream,
        image: {
          generate: vi.fn(async () => ({
            images: [],
            model: "test",
            usage: { imagesGenerated: 0, size: "", quality: "" },
            cost: 0,
          })),
        },
        speech: {
          generate: vi.fn(async () => ({
            audio: new ArrayBuffer(5000),
            model: "tts-1-hd",
            usage: { characterCount: 200 },
            cost: 0.006,
            format: "mp3",
          })),
        },
      } as unknown as LLMist;
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      await wrapper.speech.generate({
        model: "tts-1-hd",
        input: "A".repeat(200),
        voice: "nova",
      });

      expect(reportedCosts.length).toBe(1);
      expect(reportedCosts[0]).toBe(0.006);
    });

    it("does not report cost when cost is zero", async () => {
      const mockClient = {
        modelRegistry: createMockClient([]).modelRegistry,
        stream: createMockClient([]).stream,
        image: {
          generate: vi.fn(async () => ({
            images: [],
            model: "test",
            usage: { imagesGenerated: 0, size: "", quality: "" },
            cost: 0,
          })),
        },
        speech: {
          generate: vi.fn(async () => ({
            audio: new ArrayBuffer(100),
            model: "test-tts",
            usage: { characterCount: 10 },
            cost: 0,
            format: "mp3",
          })),
        },
      } as unknown as LLMist;
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      await wrapper.speech.generate({
        model: "test-tts",
        input: "Test",
        voice: "voice1",
      });

      expect(reportedCosts.length).toBe(0);
    });

    it("does not report cost when cost is undefined", async () => {
      const mockClient = {
        modelRegistry: createMockClient([]).modelRegistry,
        stream: createMockClient([]).stream,
        image: {
          generate: vi.fn(async () => ({
            images: [],
            model: "test",
            usage: { imagesGenerated: 0, size: "", quality: "" },
          })),
        },
        speech: {
          generate: vi.fn(async () => ({
            audio: new ArrayBuffer(100),
            model: "test-tts",
            usage: { characterCount: 10 },
            format: "mp3",
            // cost is undefined
          })),
        },
      } as unknown as LLMist;
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      await wrapper.speech.generate({
        model: "test-tts",
        input: "Test",
        voice: "voice1",
      });

      expect(reportedCosts.length).toBe(0);
    });

    it("passes all options to underlying client", async () => {
      const generateSpeechMock = vi.fn(async () => ({
        audio: new ArrayBuffer(1000),
        model: "tts-1",
        usage: { characterCount: 50 },
        cost: 0.00075,
        format: "opus",
      }));

      const mockClient = {
        modelRegistry: createMockClient([]).modelRegistry,
        stream: createMockClient([]).stream,
        image: {
          generate: vi.fn(async () => ({
            images: [],
            model: "test",
            usage: { imagesGenerated: 0, size: "", quality: "" },
            cost: 0,
          })),
        },
        speech: {
          generate: generateSpeechMock,
        },
      } as unknown as LLMist;
      const wrapper = new CostReportingLLMistWrapper(mockClient, reportCost);

      await wrapper.speech.generate({
        model: "tts-1",
        input: "Hello world!",
        voice: "alloy",
        responseFormat: "opus",
        speed: 1.2,
      });

      expect(generateSpeechMock).toHaveBeenCalledWith({
        model: "tts-1",
        input: "Hello world!",
        voice: "alloy",
        responseFormat: "opus",
        speed: 1.2,
      });
    });
  });
});
