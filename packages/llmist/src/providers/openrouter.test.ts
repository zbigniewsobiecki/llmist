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
import {
  calculateOpenRouterSpeechCost,
  getOpenRouterSpeechModelSpec,
  isOpenRouterSpeechModel,
  openrouterSpeechModels,
} from "./openrouter-speech-models.js";

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
      // Last user message gets cache_control by default
      expect(request.messages[0].content).toEqual([
        {
          type: "text",
          text: "Hello, how are you?",
          cache_control: { type: "ephemeral" },
        },
      ]);
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

  describe("caching", () => {
    it("should add cache_control to last system and last user message by default", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const messages: LLMMessage[] = [
        { role: "system", content: "You are an expert accountant." },
        { role: "user", content: "Process these invoices." },
        { role: "assistant", content: "Sure, I'll start processing." },
        { role: "user", content: "Here is the next batch." },
      ];

      const request = (provider as any).buildApiRequest(
        { messages },
        { provider: "openrouter", name: "google/gemini-3-flash-preview" },
        undefined,
        messages,
      );

      // Last system message should have cache_control
      const systemMsg = request.messages.find((m: any) => m.role === "system");
      expect(systemMsg.content).toEqual([
        {
          type: "text",
          text: "You are an expert accountant.",
          cache_control: { type: "ephemeral" },
        },
      ]);

      // Last user message (index 3) should have cache_control
      const userMessages = request.messages.filter((m: any) => m.role === "user");
      const lastUser = userMessages[userMessages.length - 1];
      expect(lastUser.content).toEqual([
        {
          type: "text",
          text: "Here is the next batch.",
          cache_control: { type: "ephemeral" },
        },
      ]);

      // First user message should NOT have cache_control
      const firstUser = userMessages[0];
      expect(firstUser.content).toBe("Process these invoices.");
    });

    it("should NOT add cache_control when caching is explicitly disabled", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const messages: LLMMessage[] = [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "First question" },
        { role: "assistant", content: "Response" },
        { role: "user", content: "Follow up" },
      ];

      const request = (provider as any).buildApiRequest(
        { messages, caching: { enabled: false } },
        { provider: "openrouter", name: "google/gemini-3-flash-preview" },
        undefined,
        messages,
      );

      // Verify no cache_control appears anywhere in the request
      for (const msg of request.messages) {
        const content = msg.content;
        if (typeof content === "string") {
          // String content cannot have cache_control — that's the point
          continue;
        }
        if (Array.isArray(content)) {
          for (const block of content) {
            expect(block).not.toHaveProperty("cache_control");
          }
        }
      }
    });

    it("should add cache_control when caching is explicitly enabled", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const messages: LLMMessage[] = [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
      ];

      const request = (provider as any).buildApiRequest(
        { messages, caching: { enabled: true } },
        { provider: "openrouter", name: "google/gemini-3-flash-preview" },
        undefined,
        messages,
      );

      // Same behavior as default — both system and user get cache_control
      const systemMsg = request.messages.find((m: any) => m.role === "system");
      expect(systemMsg.content).toEqual([
        { type: "text", text: "You are helpful.", cache_control: { type: "ephemeral" } },
      ]);

      const userMsg = request.messages.find((m: any) => m.role === "user");
      expect(userMsg.content).toEqual([
        { type: "text", text: "Hello", cache_control: { type: "ephemeral" } },
      ]);
    });

    it("should handle multiple system messages with cache_control on only the last", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const messages: LLMMessage[] = [
        { role: "system", content: "System instruction 1." },
        { role: "system", content: "System instruction 2." },
        { role: "user", content: "Go." },
      ];

      const request = (provider as any).buildApiRequest(
        { messages },
        { provider: "openrouter", name: "anthropic/claude-sonnet-4-5" },
        undefined,
        messages,
      );

      const systemMessages = request.messages.filter((m: any) => m.role === "system");

      // First system message: no cache_control
      expect(systemMessages[0].content).toBe("System instruction 1.");

      // Last system message: has cache_control
      expect(systemMessages[1].content).toEqual([
        {
          type: "text",
          text: "System instruction 2.",
          cache_control: { type: "ephemeral" },
        },
      ]);
    });

    it("should handle array content by adding cache_control to last block", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const messages: LLMMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Look at this:" },
            { type: "text", text: "Some data here." },
          ],
        },
      ];

      const request = (provider as any).buildApiRequest(
        { messages },
        { provider: "openrouter", name: "google/gemini-3-flash-preview" },
        undefined,
        messages,
      );

      const userMsg = request.messages.find((m: any) => m.role === "user");
      // Should be an array with cache_control on the last part only
      expect(userMsg.content).toEqual([
        { type: "text", text: "Look at this:" },
        { type: "text", text: "Some data here.", cache_control: { type: "ephemeral" } },
      ]);
    });

    it("should add cache_control to last block of image+text user message", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const messages: LLMMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this invoice:" },
            {
              type: "image",
              source: { type: "base64", mediaType: "image/png", data: "iVBOR..." },
            },
          ],
        },
      ];

      const request = (provider as any).buildApiRequest(
        { messages },
        { provider: "openrouter", name: "google/gemini-3-flash-preview" },
        undefined,
        messages,
      );

      const userMsg = request.messages.find((m: any) => m.role === "user");
      // cache_control should be on the last block (the image)
      expect(userMsg.content).toHaveLength(2);
      expect(userMsg.content[0]).not.toHaveProperty("cache_control");
      expect(userMsg.content[1]).toHaveProperty("cache_control", { type: "ephemeral" });
      // Image block should still have its original properties
      expect(userMsg.content[1].type).toBe("image_url");
    });

    it("should not mutate the original content array", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const contentArray = [
        { type: "text" as const, text: "Part 1" },
        { type: "text" as const, text: "Part 2" },
      ];
      const messages: LLMMessage[] = [{ role: "user", content: [...contentArray] }];

      (provider as any).buildApiRequest(
        { messages },
        { provider: "openrouter", name: "google/gemini-3-flash-preview" },
        undefined,
        messages,
      );

      // Original array elements should not have cache_control
      expect(contentArray[1]).not.toHaveProperty("cache_control");
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

    it("should extract cached_tokens from prompt_tokens_details", async () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const mockChunks: ChatCompletionChunk[] = [
        {
          id: "1",
          object: "chat.completion.chunk",
          created: Date.now(),
          model: "google/gemini-3-flash-preview",
          choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }],
        },
        {
          id: "2",
          object: "chat.completion.chunk",
          created: Date.now(),
          model: "google/gemini-3-flash-preview",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 200,
            completion_tokens: 30,
            total_tokens: 230,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            prompt_tokens_details: { cached_tokens: 150 } as any,
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

      expect(chunks[1].usage).toEqual({
        inputTokens: 200,
        outputTokens: 30,
        totalTokens: 230,
        cachedInputTokens: 150,
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

    it("should enhance 400 (bad request) errors and include provider guidance", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const error = new Error("400 invalid request payload");
      const enhanced = (provider as any).enhanceError(error);

      expect(enhanced.message).toContain("400");
      expect(enhanced.message).toContain("model's limits");
    });

    it("should preserve original status code on 400 errors", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const error = Object.assign(new Error("400 bad request"), { status: 400 });
      const enhanced = (provider as any).enhanceError(error);

      expect((enhanced as any).status).toBe(400);
    });

    it("should default to status 400 when original error has no status property", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      // Error without a status field — status should default to 400
      const error = new Error("bad request");
      const enhanced = (provider as any).enhanceError(error);

      expect((enhanced as any).status).toBe(400);
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

  describe("speech generation", () => {
    it("should return speech model specs", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const specs = provider.getSpeechModelSpecs();
      expect(specs).toBeDefined();
      expect(Array.isArray(specs)).toBe(true);
      expect(specs.length).toBeGreaterThan(0);
    });

    it("should include gpt-audio models", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      const specs = provider.getSpeechModelSpecs();
      const modelIds = specs.map((s) => s.modelId);

      expect(modelIds).toContain("openai/gpt-audio");
      expect(modelIds).toContain("openai/gpt-audio-mini");
    });

    it("should support speech generation for gpt-audio models", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      expect(provider.supportsSpeechGeneration("openai/gpt-audio")).toBe(true);
      expect(provider.supportsSpeechGeneration("openai/gpt-audio-mini")).toBe(true);
    });

    it("should not support speech generation for non-audio models", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      expect(provider.supportsSpeechGeneration("anthropic/claude-sonnet-4-5")).toBe(false);
      expect(provider.supportsSpeechGeneration("openai/gpt-4o")).toBe(false);
    });

    it("should support speech generation with provider-prefixed model IDs", () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      // These are the formats used in CLI config files
      expect(provider.supportsSpeechGeneration("openrouter:openai/gpt-audio")).toBe(true);
      expect(provider.supportsSpeechGeneration("openrouter:openai/gpt-audio-mini")).toBe(true);
    });

    it("should generate speech by streaming audio chunks", async () => {
      // Mock streaming response with audio chunks
      const mockAudioChunk1 = Buffer.from("audio-chunk-1").toString("base64");
      const mockAudioChunk2 = Buffer.from("audio-chunk-2").toString("base64");

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [
              {
                delta: {
                  audio: { data: mockAudioChunk1, transcript: "Hello" },
                },
              },
            ],
          };
          yield {
            choices: [
              {
                delta: {
                  audio: { data: mockAudioChunk2, transcript: " world" },
                },
              },
            ],
          };
          yield {
            choices: [
              {
                delta: {},
                finish_reason: "stop",
              },
            ],
          };
        },
      };

      const mockCreate = vi.fn().mockResolvedValue(mockStream);
      const mockClient = {
        chat: {
          completions: {
            create: mockCreate,
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenRouterProvider(mockClient, {});

      const result = await provider.generateSpeech({
        model: "openai/gpt-audio-mini",
        input: "Hello world",
        voice: "nova",
        responseFormat: "pcm16",
      });

      // Verify API was called with correct parameters
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "openai/gpt-audio-mini",
          modalities: ["text", "audio"],
          audio: { voice: "nova", format: "pcm16" },
          stream: true,
        }),
      );

      // Verify result
      expect(result.model).toBe("openai/gpt-audio-mini");
      expect(result.format).toBe("pcm16");
      expect(result.usage.characterCount).toBe(11); // "Hello world"

      // Verify audio was assembled from chunks
      const audioBuffer = Buffer.from(result.audio);
      const expectedAudio = Buffer.concat([
        Buffer.from("audio-chunk-1"),
        Buffer.from("audio-chunk-2"),
      ]);
      expect(audioBuffer).toEqual(expectedAudio);
    });

    it("should use default voice and format when not specified", async () => {
      const mockAudioChunk = Buffer.from("audio-data").toString("base64");
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { audio: { data: mockAudioChunk } } }] };
        },
      };

      const mockCreate = vi.fn().mockResolvedValue(mockStream);
      const mockClient = {
        chat: {
          completions: {
            create: mockCreate,
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenRouterProvider(mockClient, {});

      await provider.generateSpeech({
        model: "openai/gpt-audio-mini",
        input: "Test",
        voice: "alloy", // Required parameter
      });

      // Should use defaults from spec
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          audio: { voice: "alloy", format: "pcm16" }, // mp3 is default
        }),
      );
    });

    it("should throw error for unknown model", async () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      await expect(
        provider.generateSpeech({
          model: "unknown/model",
          input: "Test",
          voice: "alloy",
        }),
      ).rejects.toThrow("Unknown OpenRouter TTS model: unknown/model");
    });

    it("should throw error for invalid voice", async () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      await expect(
        provider.generateSpeech({
          model: "openai/gpt-audio-mini",
          input: "Test",
          voice: "invalid-voice",
        }),
      ).rejects.toThrow('Invalid voice "invalid-voice" for openai/gpt-audio-mini');
    });

    it("should throw error for invalid format", async () => {
      const mockClient = {} as OpenAI;
      const provider = new OpenRouterProvider(mockClient, {});

      await expect(
        provider.generateSpeech({
          model: "openai/gpt-audio-mini",
          input: "Test",
          voice: "alloy",
          responseFormat: "ogg" as any,
        }),
      ).rejects.toThrow('Invalid format "ogg" for openai/gpt-audio-mini');
    });

    it("should throw error when no audio chunks are returned", async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: {} }] };
          yield { choices: [{ delta: { content: "text only" } }] };
        },
      };

      const mockCreate = vi.fn().mockResolvedValue(mockStream);
      const mockClient = {
        chat: {
          completions: {
            create: mockCreate,
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenRouterProvider(mockClient, {});

      await expect(
        provider.generateSpeech({
          model: "openai/gpt-audio-mini",
          input: "Test",
          voice: "alloy",
        }),
      ).rejects.toThrow("OpenRouter TTS returned no audio data");
    });

    it("should handle empty base64 string gracefully", async () => {
      // Empty base64 string produces empty buffer - this chunk should be skipped
      // but since it's the only chunk, it should throw "no audio data"
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { audio: { data: "" } } }] };
        },
      };

      const mockCreate = vi.fn().mockResolvedValue(mockStream);
      const mockClient = {
        chat: {
          completions: {
            create: mockCreate,
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenRouterProvider(mockClient, {});

      // Empty string produces empty buffer which is valid but zero-length
      // Our validation should catch this as no audio data
      await expect(
        provider.generateSpeech({
          model: "openai/gpt-audio-mini",
          input: "Test",
          voice: "alloy",
        }),
      ).rejects.toThrow("OpenRouter TTS returned no audio data");
    });

    it("should NOT include speed parameter (OpenRouter chat completions TTS doesn't support it)", async () => {
      const mockAudioChunk = Buffer.from("audio-data").toString("base64");
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { audio: { data: mockAudioChunk } } }] };
        },
      };

      const mockCreate = vi.fn().mockResolvedValue(mockStream);
      const mockClient = {
        chat: {
          completions: {
            create: mockCreate,
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenRouterProvider(mockClient, {});

      // Speed is provided but should be ignored by OpenRouter provider
      await provider.generateSpeech({
        model: "openai/gpt-audio-mini",
        input: "Test",
        voice: "alloy",
        speed: 1.5, // Provided but ignored
      });

      // Verify speed is NOT in the audio parameters
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.audio).not.toHaveProperty("speed");
    });

    it("should skip malformed delta objects gracefully", async () => {
      const mockAudioChunk = Buffer.from("valid-audio").toString("base64");
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          // Various malformed chunks that should be skipped
          yield { choices: [{ delta: null }] };
          yield { choices: [{ delta: "not an object" }] };
          yield { choices: [{ delta: { audio: null } }] };
          yield { choices: [{ delta: { audio: "not an object" } }] };
          yield { choices: [{ delta: { audio: { data: 123 } } }] }; // data not string
          // Valid chunk
          yield { choices: [{ delta: { audio: { data: mockAudioChunk } } }] };
        },
      };

      const mockCreate = vi.fn().mockResolvedValue(mockStream);
      const mockClient = {
        chat: {
          completions: {
            create: mockCreate,
          },
        },
      } as unknown as OpenAI;

      const provider = new OpenRouterProvider(mockClient, {});

      const result = await provider.generateSpeech({
        model: "openai/gpt-audio-mini",
        input: "Test",
        voice: "alloy",
      });

      // Should still succeed with the valid chunk
      expect(Buffer.from(result.audio).toString()).toBe("valid-audio");
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

describe("openrouter-speech-models", () => {
  describe("openrouterSpeechModels", () => {
    it("should have provider set to 'openrouter' for all models", () => {
      for (const model of openrouterSpeechModels) {
        expect(model.provider).toBe("openrouter");
      }
    });

    it("should have required fields for all models", () => {
      for (const model of openrouterSpeechModels) {
        expect(model.modelId).toBeDefined();
        expect(model.displayName).toBeDefined();
        expect(model.pricing).toBeDefined();
        expect(model.voices).toBeDefined();
        expect(model.voices.length).toBeGreaterThan(0);
        expect(model.formats).toBeDefined();
        expect(model.formats.length).toBeGreaterThan(0);
      }
    });

    it("should include standard OpenAI TTS voices", () => {
      const firstModel = openrouterSpeechModels[0];
      expect(firstModel.voices).toContain("alloy");
      expect(firstModel.voices).toContain("nova");
      expect(firstModel.voices).toContain("shimmer");
    });
  });

  describe("getOpenRouterSpeechModelSpec", () => {
    it("should return spec for valid model", () => {
      const spec = getOpenRouterSpeechModelSpec("openai/gpt-audio-mini");
      expect(spec).toBeDefined();
      expect(spec?.modelId).toBe("openai/gpt-audio-mini");
    });

    it("should return undefined for invalid model", () => {
      const spec = getOpenRouterSpeechModelSpec("invalid-model");
      expect(spec).toBeUndefined();
    });
  });

  describe("isOpenRouterSpeechModel", () => {
    it("should return true for valid speech models", () => {
      expect(isOpenRouterSpeechModel("openai/gpt-audio")).toBe(true);
      expect(isOpenRouterSpeechModel("openai/gpt-audio-mini")).toBe(true);
    });

    it("should return false for non-speech models", () => {
      expect(isOpenRouterSpeechModel("openai/gpt-4o")).toBe(false);
      expect(isOpenRouterSpeechModel("anthropic/claude-sonnet-4-5")).toBe(false);
    });
  });

  describe("calculateOpenRouterSpeechCost", () => {
    it("should calculate cost based on per-minute rate", () => {
      // gpt-audio-mini has perMinute: 0.015
      // 750 chars ≈ 1 minute
      const cost = calculateOpenRouterSpeechCost("openai/gpt-audio-mini", 750);
      expect(cost).toBeCloseTo(0.015, 3);
    });

    it("should return undefined for unknown model", () => {
      const cost = calculateOpenRouterSpeechCost("unknown-model", 1000);
      expect(cost).toBeUndefined();
    });

    it("should use estimated minutes if provided", () => {
      // gpt-audio has perMinute: 0.08
      const cost = calculateOpenRouterSpeechCost("openai/gpt-audio", 100, 2);
      expect(cost).toBeCloseTo(0.16, 3); // 2 minutes * $0.08/min
    });

    it("should scale cost with character count", () => {
      // 1500 chars ≈ 2 minutes
      const cost1500 = calculateOpenRouterSpeechCost("openai/gpt-audio-mini", 1500);
      const cost750 = calculateOpenRouterSpeechCost("openai/gpt-audio-mini", 750);
      expect(cost1500).toBeCloseTo(cost750! * 2, 5);
    });
  });
});
