import type OpenAI from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMMessage } from "../core/messages.js";
import type { ModelDescriptor } from "../core/options.js";
import { createHuggingFaceProviderFromEnv, HuggingFaceProvider } from "./huggingface.js";

describe("HuggingFaceProvider", () => {
  describe("supports", () => {
    it("should support 'huggingface' provider", () => {
      const mockClient = {} as OpenAI;
      const provider = new HuggingFaceProvider(mockClient);

      expect(
        provider.supports({ provider: "huggingface", name: "meta-llama/Llama-3.1-8B-Instruct" }),
      ).toBe(true);
    });

    it("should support 'hf' provider alias", () => {
      const mockClient = {} as OpenAI;
      const provider = new HuggingFaceProvider(mockClient);

      expect(provider.supports({ provider: "hf", name: "Qwen/Qwen2.5-7B-Instruct" })).toBe(true);
    });

    it("should not support other providers", () => {
      const mockClient = {} as OpenAI;
      const provider = new HuggingFaceProvider(mockClient);

      expect(provider.supports({ provider: "openai", name: "gpt-4" })).toBe(false);
      expect(provider.supports({ provider: "anthropic", name: "claude-3" })).toBe(false);
    });
  });

  describe("getModelSpecs", () => {
    it("should return HUGGINGFACE_MODELS array", () => {
      const mockClient = {} as OpenAI;
      const provider = new HuggingFaceProvider(mockClient);

      const specs = provider.getModelSpecs();
      expect(specs).toBeDefined();
      expect(Array.isArray(specs)).toBe(true);
      expect(specs.length).toBeGreaterThan(0);
    });

    it("should include popular models like Llama and Qwen", () => {
      const mockClient = {} as OpenAI;
      const provider = new HuggingFaceProvider(mockClient);

      const specs = provider.getModelSpecs();
      const modelIds = specs.map((spec) => spec.modelId);

      expect(modelIds).toContain("meta-llama/Llama-3.1-8B-Instruct");
      expect(modelIds).toContain("Qwen/Qwen2.5-7B-Instruct");
      expect(modelIds).toContain("deepseek-ai/DeepSeek-V3.2");
    });
  });

  describe("buildApiRequest", () => {
    it("should create OpenAI-compatible request format", () => {
      const mockClient = {} as OpenAI;
      const provider = new HuggingFaceProvider(mockClient);

      const messages: LLMMessage[] = [{ role: "user", content: "Hello, how are you?" }];

      const request = (provider as any).buildApiRequest(
        { messages, maxTokens: 100, temperature: 0.7 },
        { provider: "huggingface", name: "meta-llama/Llama-3.1-8B-Instruct" },
        undefined,
        messages,
      );

      expect(request).toMatchObject({
        model: "meta-llama/Llama-3.1-8B-Instruct",
        max_tokens: 100,
        temperature: 0.7,
        stream: true,
        stream_options: { include_usage: true },
      });
      expect(request.messages).toHaveLength(1);
      expect(request.messages[0].role).toBe("user");
      expect(request.messages[0].content).toBe("Hello, how are you?");
    });

    it("should pass provider selection syntax in model name", () => {
      const mockClient = {} as OpenAI;
      const provider = new HuggingFaceProvider(mockClient);

      const messages: LLMMessage[] = [{ role: "user", content: "Test" }];

      // Test :fastest suffix
      const request1 = (provider as any).buildApiRequest(
        { messages },
        { provider: "huggingface", name: "meta-llama/Llama-3.1-8B-Instruct:fastest" },
        undefined,
        messages,
      );
      expect(request1.model).toBe("meta-llama/Llama-3.1-8B-Instruct:fastest");

      // Test :cheapest suffix
      const request2 = (provider as any).buildApiRequest(
        { messages },
        { provider: "huggingface", name: "Qwen/Qwen2.5-7B-Instruct:cheapest" },
        undefined,
        messages,
      );
      expect(request2.model).toBe("Qwen/Qwen2.5-7B-Instruct:cheapest");

      // Test :sambanova suffix
      const request3 = (provider as any).buildApiRequest(
        { messages },
        { provider: "hf", name: "deepseek-ai/DeepSeek-V3:sambanova" },
        undefined,
        messages,
      );
      expect(request3.model).toBe("deepseek-ai/DeepSeek-V3:sambanova");
    });

    it("should handle optional parameters", () => {
      const mockClient = {} as OpenAI;
      const provider = new HuggingFaceProvider(mockClient);

      const messages: LLMMessage[] = [{ role: "user", content: "Test" }];

      const request = (provider as any).buildApiRequest(
        {
          messages,
          topP: 0.9,
          stopSequences: ["STOP", "END"],
          extra: { frequency_penalty: 0.5 },
        },
        { provider: "huggingface", name: "test-model" },
        undefined,
        messages,
      );

      expect(request.top_p).toBe(0.9);
      expect(request.stop).toEqual(["STOP", "END"]);
      expect(request.frequency_penalty).toBe(0.5);
    });

    it("should omit max_tokens if not provided", () => {
      const mockClient = {} as OpenAI;
      const provider = new HuggingFaceProvider(mockClient);

      const messages: LLMMessage[] = [{ role: "user", content: "Test" }];

      const request = (provider as any).buildApiRequest(
        { messages },
        { provider: "huggingface", name: "test-model" },
        undefined,
        messages,
      );

      expect(request.max_tokens).toBeUndefined();
    });
  });

  describe("normalizeProviderStream", () => {
    it("should normalize OpenAI-format chunks to LLMStreamChunk", async () => {
      const mockClient = {} as OpenAI;
      const provider = new HuggingFaceProvider(mockClient);

      const mockChunks: ChatCompletionChunk[] = [
        {
          id: "1",
          object: "chat.completion.chunk",
          created: Date.now(),
          model: "test",
          choices: [
            {
              index: 0,
              delta: { content: "Hello" },
              finish_reason: null,
            },
          ],
        },
        {
          id: "2",
          object: "chat.completion.chunk",
          created: Date.now(),
          model: "test",
          choices: [
            {
              index: 0,
              delta: { content: " world" },
              finish_reason: null,
            },
          ],
        },
        {
          id: "3",
          object: "chat.completion.chunk",
          created: Date.now(),
          model: "test",
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
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

      expect(chunks).toHaveLength(3);
      expect(chunks[0].text).toBe("Hello");
      expect(chunks[1].text).toBe(" world");
      expect(chunks[2].finishReason).toBe("stop");
      expect(chunks[2].usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        cachedInputTokens: 0,
      });
    });
  });

  describe("countTokens", () => {
    it("should estimate tokens using character count", async () => {
      const mockClient = {} as OpenAI;
      const provider = new HuggingFaceProvider(mockClient);

      const messages: LLMMessage[] = [
        { role: "user", content: "Hello" }, // 5 chars → 2 tokens
        { role: "assistant", content: "Hi there!" }, // 9 chars → 3 tokens
      ];

      const count = await provider.countTokens(messages, {
        provider: "huggingface",
        name: "test-model",
      });

      // (5 + 9) / 4 = 3.5 → 4 tokens (rounded up)
      expect(count).toBe(4);
    });

    it("should handle multipart messages", async () => {
      const mockClient = {} as OpenAI;
      const provider = new HuggingFaceProvider(mockClient);

      const messages: LLMMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" }, // 13 chars
            { type: "text", text: "More text" }, // 9 chars
          ],
        },
      ];

      const count = await provider.countTokens(messages, {
        provider: "huggingface",
        name: "test-model",
      });

      // (13 + 9) / 4 = 5.5 → 6 tokens
      expect(count).toBe(6);
    });

    it("should handle errors gracefully", async () => {
      const mockClient = {} as OpenAI;
      const provider = new HuggingFaceProvider(mockClient);

      // Mock console.warn to suppress output
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Pass invalid data that would cause an error
      const count = await provider.countTokens(null as any, {
        provider: "huggingface",
        name: "test-model",
      });

      expect(count).toBe(0);
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe("endpoint types", () => {
    it("should default to serverless endpoint", () => {
      const mockClient = {} as OpenAI;
      const provider = new HuggingFaceProvider(mockClient, { endpointType: "serverless" });

      expect((provider as any).config.endpointType).toBe("serverless");
    });

    it("should support dedicated endpoint type", () => {
      const mockClient = {} as OpenAI;
      const provider = new HuggingFaceProvider(mockClient, { endpointType: "dedicated" });

      expect((provider as any).config.endpointType).toBe("dedicated");
    });
  });

  describe("enhanceError", () => {
    it("should enhance 429 (rate limit) errors", () => {
      const mockClient = {} as OpenAI;
      const provider = new HuggingFaceProvider(mockClient);

      const error = new Error("Request failed with status code 429");
      const enhanced = (provider as any).enhanceError(error);

      expect(enhanced.message).toContain("rate limit exceeded");
      expect(enhanced.message).toContain("dedicated endpoint");
    });

    it("should enhance 404 (model not found) errors", () => {
      const mockClient = {} as OpenAI;
      const provider = new HuggingFaceProvider(mockClient);

      const error = new Error("Model not found: test-model");
      const enhanced = (provider as any).enhanceError(error);

      expect(enhanced.message).toContain("not available");
      expect(enhanced.message).toContain("endpoint type");
    });

    it("should enhance 401 (auth) errors", () => {
      const mockClient = {} as OpenAI;
      const provider = new HuggingFaceProvider(mockClient);

      const error = new Error("401 Unauthorized");
      const enhanced = (provider as any).enhanceError(error);

      expect(enhanced.message).toContain("authentication failed");
      expect(enhanced.message).toContain("HF_TOKEN");
    });

    it("should enhance 400 (bad request) errors for serverless transient issues", () => {
      const mockClient = {} as OpenAI;
      const provider = new HuggingFaceProvider(mockClient);

      const error = new Error("Request failed with status code 400");
      const enhanced = (provider as any).enhanceError(error);

      expect(enhanced.message).toContain("bad request");
      expect(enhanced.message).toContain("transient");
    });

    it("should pass through other errors unchanged", () => {
      const mockClient = {} as OpenAI;
      const provider = new HuggingFaceProvider(mockClient);

      const error = new Error("Some other error");
      const enhanced = (provider as any).enhanceError(error);

      expect(enhanced).toBe(error);
    });
  });
});

describe("createHuggingFaceProviderFromEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original process.env
    process.env = originalEnv;
  });

  it("should create provider with HF_TOKEN", () => {
    process.env.HF_TOKEN = "hf_test_token_123";

    const provider = createHuggingFaceProviderFromEnv();

    expect(provider).toBeInstanceOf(HuggingFaceProvider);
    expect(provider?.providerId).toBe("huggingface");
  });

  it("should fallback to HUGGING_FACE_API_KEY if HF_TOKEN not set", () => {
    delete process.env.HF_TOKEN;
    process.env.HUGGING_FACE_API_KEY = "hf_fallback_token_456";

    const provider = createHuggingFaceProviderFromEnv();

    expect(provider).toBeInstanceOf(HuggingFaceProvider);
  });

  it("should return null if no token is set", () => {
    delete process.env.HF_TOKEN;
    delete process.env.HUGGING_FACE_API_KEY;

    const provider = createHuggingFaceProviderFromEnv();

    expect(provider).toBeNull();
  });

  it("should return null if token is empty string", () => {
    process.env.HF_TOKEN = "";

    const provider = createHuggingFaceProviderFromEnv();

    expect(provider).toBeNull();
  });

  it("should return null if token is only whitespace", () => {
    process.env.HF_TOKEN = "   ";

    const provider = createHuggingFaceProviderFromEnv();

    expect(provider).toBeNull();
  });

  it("should use HF_ENDPOINT_URL for dedicated endpoints", () => {
    process.env.HF_TOKEN = "hf_test_token";
    process.env.HF_ENDPOINT_URL = "https://custom.endpoints.huggingface.cloud";

    const provider = createHuggingFaceProviderFromEnv();

    expect(provider).toBeInstanceOf(HuggingFaceProvider);
    expect((provider as any).config.endpointType).toBe("dedicated");
  });

  it("should default to serverless if HF_ENDPOINT_URL not set", () => {
    process.env.HF_TOKEN = "hf_test_token";
    delete process.env.HF_ENDPOINT_URL;

    const provider = createHuggingFaceProviderFromEnv();

    expect(provider).toBeInstanceOf(HuggingFaceProvider);
    expect((provider as any).config.endpointType).toBe("serverless");
  });

  it("should warn if token doesn't start with hf_", () => {
    process.env.HF_TOKEN = "invalid_token_format";

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const provider = createHuggingFaceProviderFromEnv();

    expect(provider).toBeInstanceOf(HuggingFaceProvider);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("HF token should start with 'hf_'"),
    );

    warnSpy.mockRestore();
  });

  it("should not warn if token starts with hf_", () => {
    process.env.HF_TOKEN = "hf_valid_token_123";

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const provider = createHuggingFaceProviderFromEnv();

    expect(provider).toBeInstanceOf(HuggingFaceProvider);
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("should trim whitespace from token", () => {
    process.env.HF_TOKEN = "  hf_token_with_spaces  ";

    const provider = createHuggingFaceProviderFromEnv();

    expect(provider).toBeInstanceOf(HuggingFaceProvider);
  });
});
