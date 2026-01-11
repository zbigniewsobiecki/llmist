import type OpenAI from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMMessage } from "../core/messages.js";
import {
  createOpenRouterProviderFromEnv,
  type OpenRouterConfig,
  OpenRouterProvider,
  type OpenRouterRouting,
} from "./openrouter.js";

describe("OpenRouterProvider", () => {
  describe("supports", () => {
    it("should support 'openrouter' provider", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      expect(
        provider.supports({ provider: "openrouter", name: "anthropic/claude-sonnet-4-5" }),
      ).toBe(true);
    });

    it("should support 'or' provider alias", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      expect(provider.supports({ provider: "or", name: "openai/gpt-4o" })).toBe(true);
    });

    it("should not support other providers", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      expect(provider.supports({ provider: "openai", name: "gpt-4" })).toBe(false);
      expect(provider.supports({ provider: "anthropic", name: "claude-3" })).toBe(false);
      expect(provider.supports({ provider: "huggingface", name: "llama" })).toBe(false);
    });
  });

  describe("getModelSpecs", () => {
    it("should return OPENROUTER_MODELS array", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const specs = provider.getModelSpecs();
      expect(specs).toBeDefined();
      expect(Array.isArray(specs)).toBe(true);
      expect(specs.length).toBeGreaterThan(0);
    });

    it("should include popular models from various providers", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const specs = provider.getModelSpecs();
      const modelIds = specs.map((spec) => spec.modelId);

      // Anthropic models
      expect(modelIds).toContain("anthropic/claude-sonnet-4-5");
      // OpenAI models
      expect(modelIds).toContain("openai/gpt-4o");
      // Meta Llama models
      expect(modelIds).toContain("meta-llama/llama-3.3-70b-instruct");
      // DeepSeek models
      expect(modelIds).toContain("deepseek/deepseek-r1");
    });

    it("should have all models with provider set to 'openrouter'", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const specs = provider.getModelSpecs();
      for (const spec of specs) {
        expect(spec.provider).toBe("openrouter");
      }
    });
  });

  describe("buildApiRequest (via buildProviderSpecificParams)", () => {
    it("should create OpenAI-compatible request format", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const messages: LLMMessage[] = [{ role: "user", content: "Hello, how are you?" }];

      const request = (provider as any).buildApiRequest(
        { messages, maxTokens: 100, temperature: 0.7 },
        { provider: "openrouter", name: "anthropic/claude-sonnet-4-5" },
        undefined,
        messages,
      );

      expect(request).toMatchObject({
        model: "anthropic/claude-sonnet-4-5",
        max_tokens: 100,
        temperature: 0.7,
        stream: true,
        stream_options: { include_usage: true },
      });
      expect(request.messages).toHaveLength(1);
      expect(request.messages[0].role).toBe("user");
      expect(request.messages[0].content).toBe("Hello, how are you?");
    });

    it("should pass model name in provider/model format", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const messages: LLMMessage[] = [{ role: "user", content: "Test" }];

      const request = (provider as any).buildApiRequest(
        { messages },
        { provider: "openrouter", name: "meta-llama/llama-3.3-70b-instruct" },
        undefined,
        messages,
      );

      expect(request.model).toBe("meta-llama/llama-3.3-70b-instruct");
    });

    it("should handle routing.models for fallback chain", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const messages: LLMMessage[] = [{ role: "user", content: "Test" }];
      const routing: OpenRouterRouting = {
        models: [
          "anthropic/claude-sonnet-4-5",
          "openai/gpt-4o",
          "meta-llama/llama-3.3-70b-instruct",
        ],
      };

      const request = (provider as any).buildApiRequest(
        { messages, extra: { routing } },
        { provider: "openrouter", name: "anthropic/claude-sonnet-4-5" },
        undefined,
        messages,
      );

      expect(request.models).toEqual([
        "anthropic/claude-sonnet-4-5",
        "openai/gpt-4o",
        "meta-llama/llama-3.3-70b-instruct",
      ]);
    });

    it("should handle routing.provider for explicit provider selection", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const messages: LLMMessage[] = [{ role: "user", content: "Test" }];
      const routing: OpenRouterRouting = {
        provider: "anthropic",
      };

      const request = (provider as any).buildApiRequest(
        { messages, extra: { routing } },
        { provider: "openrouter", name: "anthropic/claude-sonnet-4-5" },
        undefined,
        messages,
      );

      expect(request.provider).toEqual({ order: ["anthropic"] });
    });

    it("should handle routing.order for provider preference", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const messages: LLMMessage[] = [{ role: "user", content: "Test" }];
      const routing: OpenRouterRouting = {
        order: ["anthropic", "aws-bedrock"],
      };

      const request = (provider as any).buildApiRequest(
        { messages, extra: { routing } },
        { provider: "openrouter", name: "anthropic/claude-sonnet-4-5" },
        undefined,
        messages,
      );

      expect(request.provider).toEqual({ order: ["anthropic", "aws-bedrock"] });
    });

    it("should handle routing.route preference", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const messages: LLMMessage[] = [{ role: "user", content: "Test" }];

      // Test 'cheapest' route
      const request1 = (provider as any).buildApiRequest(
        { messages, extra: { routing: { route: "cheapest" } } },
        { provider: "openrouter", name: "anthropic/claude-sonnet-4-5" },
        undefined,
        messages,
      );
      expect(request1.route).toBe("cheapest");

      // Test 'fastest' route
      const request2 = (provider as any).buildApiRequest(
        { messages, extra: { routing: { route: "fastest" } } },
        { provider: "openrouter", name: "anthropic/claude-sonnet-4-5" },
        undefined,
        messages,
      );
      expect(request2.route).toBe("fastest");
    });

    it("should not include routing in passthrough", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const messages: LLMMessage[] = [{ role: "user", content: "Test" }];

      const request = (provider as any).buildApiRequest(
        {
          messages,
          extra: {
            routing: { route: "cheapest" },
            custom_field: "value",
          },
        },
        { provider: "openrouter", name: "test-model" },
        undefined,
        messages,
      );

      // routing should be processed and not passed through
      expect(request.routing).toBeUndefined();
      // custom_field should pass through
      expect(request.custom_field).toBe("value");
    });
  });

  describe("getCustomHeaders", () => {
    it("should return empty object when no config", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const headers = (provider as any).getCustomHeaders();
      expect(headers).toEqual({});
    });

    it("should return HTTP-Referer when siteUrl is set", () => {
      const mockClient = {} as OpenAI;
      const config: OpenRouterConfig = { siteUrl: "https://myapp.com" };
      const provider = new OpenRouterProvider(mockClient, config);

      const headers = (provider as any).getCustomHeaders();
      expect(headers).toEqual({ "HTTP-Referer": "https://myapp.com" });
    });

    it("should return X-Title when appName is set", () => {
      const mockClient = {} as OpenAI;
      const config: OpenRouterConfig = { appName: "MyApp" };
      const provider = new OpenRouterProvider(mockClient, config);

      const headers = (provider as any).getCustomHeaders();
      expect(headers).toEqual({ "X-Title": "MyApp" });
    });

    it("should return both headers when both are set", () => {
      const mockClient = {} as OpenAI;
      const config: OpenRouterConfig = {
        siteUrl: "https://myapp.com",
        appName: "MyApp",
      };
      const provider = new OpenRouterProvider(mockClient, config);

      const headers = (provider as any).getCustomHeaders();
      expect(headers).toEqual({
        "HTTP-Referer": "https://myapp.com",
        "X-Title": "MyApp",
      });
    });
  });

  describe("normalizeProviderStream (inherited)", () => {
    it("should normalize OpenAI-format chunks to LLMStreamChunk", async () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const mockChunks: ChatCompletionChunk[] = [
        {
          id: "1",
          object: "chat.completion.chunk",
          created: Date.now(),
          model: "anthropic/claude-sonnet-4-5",
          choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
        },
        {
          id: "2",
          object: "chat.completion.chunk",
          created: Date.now(),
          model: "anthropic/claude-sonnet-4-5",
          choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }],
        },
        {
          id: "3",
          object: "chat.completion.chunk",
          created: Date.now(),
          model: "anthropic/claude-sonnet-4-5",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
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

  describe("enhanceError", () => {
    it("should enhance 402 (insufficient credits) errors", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const error = new Error("Request failed with status code 402");
      const enhanced = (provider as any).enhanceError(error);

      expect(enhanced.message).toContain("Insufficient credits");
      expect(enhanced.message).toContain("https://openrouter.ai/credits");
    });

    it("should enhance 429 (rate limit) errors", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const error = new Error("Rate limit exceeded");
      const enhanced = (provider as any).enhanceError(error);

      expect(enhanced.message).toContain("Rate limit exceeded");
      expect(enhanced.message).toContain("Consider upgrading");
    });

    it("should enhance 503 (unavailable) errors", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const error = new Error("Service unavailable - 503");
      const enhanced = (provider as any).enhanceError(error);

      expect(enhanced.message).toContain("temporarily unavailable");
      expect(enhanced.message).toContain("fallback");
    });

    it("should enhance 401 (auth) errors", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const error = new Error("401 Unauthorized");
      const enhanced = (provider as any).enhanceError(error);

      expect(enhanced.message).toContain("Authentication failed");
      expect(enhanced.message).toContain("OPENROUTER_API_KEY");
    });

    it("should pass through other errors unchanged", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const error = new Error("Some other error");
      const enhanced = (provider as any).enhanceError(error);

      expect(enhanced).toBe(error);
    });
  });

  describe("countTokens (inherited)", () => {
    it("should estimate tokens using character count", async () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const messages: LLMMessage[] = [
        { role: "user", content: "Hello" }, // 5 chars
        { role: "assistant", content: "Hi there!" }, // 9 chars
      ];

      const count = await provider.countTokens(messages, {
        provider: "openrouter",
        name: "anthropic/claude-sonnet-4-5",
      });

      // (5 + 9) / 4 = 3.5 → 4 tokens (rounded up)
      expect(count).toBe(4);
    });
  });
});

describe("createOpenRouterProviderFromEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should create provider with OPENROUTER_API_KEY", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key-123";

    const provider = createOpenRouterProviderFromEnv();

    expect(provider).toBeInstanceOf(OpenRouterProvider);
    expect(provider?.providerId).toBe("openrouter");
  });

  it("should return null if no API key is set", () => {
    delete process.env.OPENROUTER_API_KEY;

    const provider = createOpenRouterProviderFromEnv();

    expect(provider).toBeNull();
  });

  it("should return null if API key is empty string", () => {
    process.env.OPENROUTER_API_KEY = "";

    const provider = createOpenRouterProviderFromEnv();

    expect(provider).toBeNull();
  });

  it("should return null if API key is only whitespace", () => {
    process.env.OPENROUTER_API_KEY = "   ";

    const provider = createOpenRouterProviderFromEnv();

    expect(provider).toBeNull();
  });

  it("should read OPENROUTER_SITE_URL config", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    process.env.OPENROUTER_SITE_URL = "https://myapp.com";

    const provider = createOpenRouterProviderFromEnv();

    expect(provider).toBeInstanceOf(OpenRouterProvider);
    expect((provider as any).config.siteUrl).toBe("https://myapp.com");
  });

  it("should read OPENROUTER_APP_NAME config", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    process.env.OPENROUTER_APP_NAME = "MyTestApp";

    const provider = createOpenRouterProviderFromEnv();

    expect(provider).toBeInstanceOf(OpenRouterProvider);
    expect((provider as any).config.appName).toBe("MyTestApp");
  });

  it("should default appName to 'llmist' if not set", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key";
    delete process.env.OPENROUTER_APP_NAME;

    const provider = createOpenRouterProviderFromEnv();

    expect(provider).toBeInstanceOf(OpenRouterProvider);
    expect((provider as any).config.appName).toBe("llmist");
  });

  it("should trim whitespace from API key", () => {
    process.env.OPENROUTER_API_KEY = "  sk-or-test-key  ";

    const provider = createOpenRouterProviderFromEnv();

    expect(provider).toBeInstanceOf(OpenRouterProvider);
  });
});
