import type OpenAI from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentPart, ImageContentPart } from "../core/input-content.js";
import type { LLMMessage } from "../core/messages.js";
import type { ModelSpec } from "../core/model-catalog.js";
import type { ModelDescriptor } from "../core/options.js";
import { FALLBACK_CHARS_PER_TOKEN } from "./constants.js";
import {
  createOpenAICompatibleProviderFromEnv,
  type OpenAICompatibleConfig,
  OpenAICompatibleProvider,
} from "./openai-compatible-provider.js";

// ============================================================================
// Concrete test subclass (follows base-provider.test.ts pattern)
// ============================================================================

class TestOpenAICompatibleProvider extends OpenAICompatibleProvider<OpenAICompatibleConfig> {
  readonly providerId = "testprovider" as const;
  protected readonly providerAlias = "tp";

  getModelSpecs(): ModelSpec[] {
    return [
      {
        modelId: "test-model",
        displayName: "Test Model",
        provider: "testprovider",
        features: [],
        contextWindow: 8192,
        maxOutputTokens: 2048,
        defaultTokenCounterModel: "test-model",
      },
    ];
  }
}

/**
 * A provider without an alias — used to test alias-less behaviour.
 */
class NoAliasProvider extends OpenAICompatibleProvider<OpenAICompatibleConfig> {
  readonly providerId = "noalias" as const;

  getModelSpecs(): ModelSpec[] {
    return [];
  }
}

/**
 * A provider that overrides getCustomHeaders() with provider-specific headers.
 */
class HeaderProvider extends OpenAICompatibleProvider<
  OpenAICompatibleConfig & { appKey?: string }
> {
  readonly providerId = "headerprovider" as const;

  getModelSpecs(): ModelSpec[] {
    return [];
  }

  protected getCustomHeaders(): Record<string, string> {
    const headers: Record<string, string> = { ...this.config.customHeaders };
    if (this.config.appKey) {
      headers["X-App-Key"] = this.config.appKey;
    }
    return headers;
  }
}

/**
 * A provider that overrides enhanceError() for provider-specific messages.
 */
class EnhancingProvider extends OpenAICompatibleProvider<OpenAICompatibleConfig> {
  readonly providerId = "enhancingprovider" as const;

  getModelSpecs(): ModelSpec[] {
    return [];
  }

  protected enhanceError(error: unknown): Error {
    if (error instanceof Error && error.message.includes("401")) {
      return new Error("Custom auth error: check your ENHANCING_API_KEY");
    }
    return super.enhanceError(error);
  }
}

// ============================================================================
// Helper: create a minimal mock client
// ============================================================================

const mockClient = {} as OpenAI;

// ============================================================================
// Tests
// ============================================================================

describe("OpenAICompatibleProvider", () => {
  // --------------------------------------------------------------------------
  // supports()
  // --------------------------------------------------------------------------

  describe("supports()", () => {
    it("should return true for the full providerId", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      expect(provider.supports({ provider: "testprovider", name: "some-model" })).toBe(true);
    });

    it("should return true for the short providerAlias", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      expect(provider.supports({ provider: "tp", name: "some-model" })).toBe(true);
    });

    it("should return false for an unrelated provider id", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      expect(provider.supports({ provider: "openai", name: "gpt-4" })).toBe(false);
      expect(provider.supports({ provider: "anthropic", name: "claude-3" })).toBe(false);
    });

    it("should return false when alias is undefined and only providerId matches", () => {
      const provider = new NoAliasProvider(mockClient, {});
      // providerId match works
      expect(provider.supports({ provider: "noalias", name: "m" })).toBe(true);
      // alias should NOT match because providerAlias is undefined
      expect(provider.supports({ provider: "tp", name: "m" })).toBe(false);
    });

    it("should return false when neither id nor alias matches", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      expect(provider.supports({ provider: "gemini", name: "gemini-pro" })).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // convertMessage()
  // --------------------------------------------------------------------------

  describe("convertMessage()", () => {
    it("should convert a system message with string content", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const message: LLMMessage = { role: "system", content: "You are helpful." };
      const result = (provider as any).convertMessage(message);

      expect(result.role).toBe("system");
      expect(result.content).toBe("You are helpful.");
    });

    it("should convert a user message with string content", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const message: LLMMessage = { role: "user", content: "Hello!" };
      const result = (provider as any).convertMessage(message);

      expect(result.role).toBe("user");
      expect(result.content).toBe("Hello!");
    });

    it("should convert an assistant message with string content", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const message: LLMMessage = { role: "assistant", content: "Hi there!" };
      const result = (provider as any).convertMessage(message);

      expect(result.role).toBe("assistant");
      expect(result.content).toBe("Hi there!");
    });

    it("should include the name field when provided", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const message: LLMMessage = { role: "user", content: "Hello!", name: "Alice" };
      const result = (provider as any).convertMessage(message);

      expect(result.name).toBe("Alice");
    });

    it("should not include the name field when not provided", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const message: LLMMessage = { role: "user", content: "Hello!" };
      const result = (provider as any).convertMessage(message);

      expect(result).not.toHaveProperty("name");
    });

    it("should convert a user message with array content (text parts)", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const content: ContentPart[] = [
        { type: "text", text: "What is this?" },
        { type: "text", text: " Please describe." },
      ];
      const message: LLMMessage = { role: "user", content };
      const result = (provider as any).convertMessage(message);

      expect(result.role).toBe("user");
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toEqual({ type: "text", text: "What is this?" });
      expect(result.content[1]).toEqual({ type: "text", text: " Please describe." });
    });

    it("should convert a user message with image content (URL)", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const imagePart: ImageContentPart = {
        type: "image",
        source: { type: "url", url: "https://example.com/img.jpg" },
      };
      const message: LLMMessage = { role: "user", content: [imagePart] };
      const result = (provider as any).convertMessage(message);

      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toEqual({
        type: "image_url",
        image_url: { url: "https://example.com/img.jpg" },
      });
    });

    it("should convert a user message with image content (base64)", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const imagePart: ImageContentPart = {
        type: "image",
        source: { type: "base64", mediaType: "image/jpeg", data: "abc123" },
      };
      const message: LLMMessage = { role: "user", content: [imagePart] };
      const result = (provider as any).convertMessage(message);

      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toEqual({
        type: "image_url",
        image_url: { url: "data:image/jpeg;base64,abc123" },
      });
    });

    it("should extract text from array content for system messages", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const content: ContentPart[] = [
        { type: "text", text: "First part. " },
        { type: "text", text: "Second part." },
      ];
      const message: LLMMessage = { role: "system", content };
      const result = (provider as any).convertMessage(message);

      expect(result.role).toBe("system");
      expect(typeof result.content).toBe("string");
      expect(result.content).toBe("First part. Second part.");
    });

    it("should extract text from array content for assistant messages", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const content: ContentPart[] = [{ type: "text", text: "Response." }];
      const message: LLMMessage = { role: "assistant", content };
      const result = (provider as any).convertMessage(message);

      expect(result.role).toBe("assistant");
      expect(result.content).toBe("Response.");
    });
  });

  // --------------------------------------------------------------------------
  // convertContent()
  // --------------------------------------------------------------------------

  describe("convertContent()", () => {
    it("should return string content unchanged", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const result = (provider as any).convertContent("Hello, world!");
      expect(result).toBe("Hello, world!");
    });

    it("should convert text parts in an array", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const content: ContentPart[] = [{ type: "text", text: "Hello" }];
      const result = (provider as any).convertContent(content);
      expect(result).toEqual([{ type: "text", text: "Hello" }]);
    });

    it("should convert image parts with URL source", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const content: ContentPart[] = [
        {
          type: "image",
          source: { type: "url", url: "https://example.com/photo.png" },
        } as ImageContentPart,
      ];
      const result = (provider as any).convertContent(content);
      expect(result).toEqual([
        { type: "image_url", image_url: { url: "https://example.com/photo.png" } },
      ]);
    });

    it("should convert image parts with base64 source", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const content: ContentPart[] = [
        {
          type: "image",
          source: { type: "base64", mediaType: "image/png", data: "iVBOR" },
        } as ImageContentPart,
      ];
      const result = (provider as any).convertContent(content);
      expect(result).toEqual([
        { type: "image_url", image_url: { url: "data:image/png;base64,iVBOR" } },
      ]);
    });

    it("should convert mixed text and image parts", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const content: ContentPart[] = [
        { type: "text", text: "What is in this image?" },
        {
          type: "image",
          source: { type: "url", url: "https://example.com/img.jpg" },
        } as ImageContentPart,
      ];
      const result = (provider as any).convertContent(content);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ type: "text", text: "What is in this image?" });
      expect(result[1]).toEqual({
        type: "image_url",
        image_url: { url: "https://example.com/img.jpg" },
      });
    });

    it("should throw for audio content parts", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const content: ContentPart[] = [
        {
          type: "audio",
          source: { type: "base64", mediaType: "audio/mp3", data: "audiob64" },
        },
      ];
      expect(() => (provider as any).convertContent(content)).toThrow(
        "testprovider does not support audio input through llmist",
      );
    });

    it("should throw for unsupported content part types", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const content = [{ type: "video", data: "..." }] as unknown as ContentPart[];
      expect(() => (provider as any).convertContent(content)).toThrow(
        "Unsupported content type: video",
      );
    });
  });

  // --------------------------------------------------------------------------
  // buildApiRequest()
  // --------------------------------------------------------------------------

  describe("buildApiRequest()", () => {
    it("should include model name from descriptor", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const messages: LLMMessage[] = [{ role: "user", content: "Hello" }];
      const descriptor: ModelDescriptor = { provider: "testprovider", name: "my-model" };

      const request = (provider as any).buildApiRequest({}, descriptor, undefined, messages);
      expect(request.model).toBe("my-model");
    });

    it("should enable streaming by default", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const messages: LLMMessage[] = [{ role: "user", content: "Hello" }];
      const descriptor: ModelDescriptor = { provider: "testprovider", name: "my-model" };

      const request = (provider as any).buildApiRequest({}, descriptor, undefined, messages);
      expect(request.stream).toBe(true);
      expect(request.stream_options).toEqual({ include_usage: true });
    });

    it("should convert messages using convertMessage()", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const messages: LLMMessage[] = [
        { role: "system", content: "Be helpful." },
        { role: "user", content: "Hello" },
      ];
      const descriptor: ModelDescriptor = { provider: "testprovider", name: "my-model" };

      const request = (provider as any).buildApiRequest({}, descriptor, undefined, messages);
      expect(request.messages).toHaveLength(2);
      expect(request.messages[0].role).toBe("system");
      expect(request.messages[1].role).toBe("user");
    });

    it("should include maxTokens when provided", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const messages: LLMMessage[] = [{ role: "user", content: "Hi" }];
      const descriptor: ModelDescriptor = { provider: "testprovider", name: "my-model" };

      const request = (provider as any).buildApiRequest(
        { maxTokens: 500 },
        descriptor,
        undefined,
        messages,
      );
      expect(request.max_tokens).toBe(500);
    });

    it("should not include max_tokens when not provided", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const messages: LLMMessage[] = [{ role: "user", content: "Hi" }];
      const descriptor: ModelDescriptor = { provider: "testprovider", name: "my-model" };

      const request = (provider as any).buildApiRequest({}, descriptor, undefined, messages);
      expect(request.max_tokens).toBeUndefined();
    });

    it("should include temperature when provided", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const messages: LLMMessage[] = [{ role: "user", content: "Hi" }];
      const descriptor: ModelDescriptor = { provider: "testprovider", name: "my-model" };

      const request = (provider as any).buildApiRequest(
        { temperature: 0.9 },
        descriptor,
        undefined,
        messages,
      );
      expect(request.temperature).toBe(0.9);
    });

    it("should include topP when provided", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const messages: LLMMessage[] = [{ role: "user", content: "Hi" }];
      const descriptor: ModelDescriptor = { provider: "testprovider", name: "my-model" };

      const request = (provider as any).buildApiRequest(
        { topP: 0.95 },
        descriptor,
        undefined,
        messages,
      );
      expect(request.top_p).toBe(0.95);
    });

    it("should include stopSequences when provided", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const messages: LLMMessage[] = [{ role: "user", content: "Hi" }];
      const descriptor: ModelDescriptor = { provider: "testprovider", name: "my-model" };

      const request = (provider as any).buildApiRequest(
        { stopSequences: ["STOP", "END"] },
        descriptor,
        undefined,
        messages,
      );
      expect(request.stop).toEqual(["STOP", "END"]);
    });

    it("should pass extra options through to the request", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const messages: LLMMessage[] = [{ role: "user", content: "Hi" }];
      const descriptor: ModelDescriptor = { provider: "testprovider", name: "my-model" };

      const request = (provider as any).buildApiRequest(
        { extra: { custom_field: "custom_value", another: 42 } },
        descriptor,
        undefined,
        messages,
      );
      expect(request.custom_field).toBe("custom_value");
      expect(request.another).toBe(42);
    });

    it("should combine all options correctly", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const messages: LLMMessage[] = [{ role: "user", content: "Hi" }];
      const descriptor: ModelDescriptor = { provider: "testprovider", name: "my-model" };

      const request = (provider as any).buildApiRequest(
        { maxTokens: 100, temperature: 0.7, topP: 0.9 },
        descriptor,
        undefined,
        messages,
      );
      expect(request.model).toBe("my-model");
      expect(request.max_tokens).toBe(100);
      expect(request.temperature).toBe(0.7);
      expect(request.top_p).toBe(0.9);
      expect(request.stream).toBe(true);
    });

    it("should pass customHeaders config into getCustomHeaders", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {
        customHeaders: { "X-Custom": "value" },
      });

      const headers = (provider as any).getCustomHeaders();
      expect(headers).toEqual({ "X-Custom": "value" });
    });
  });

  // --------------------------------------------------------------------------
  // getCustomHeaders()
  // --------------------------------------------------------------------------

  describe("getCustomHeaders()", () => {
    it("should return empty object when no customHeaders in config", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const headers = (provider as any).getCustomHeaders();
      expect(headers).toEqual({});
    });

    it("should return customHeaders from config", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {
        customHeaders: { "X-My-Header": "hello" },
      });
      const headers = (provider as any).getCustomHeaders();
      expect(headers).toEqual({ "X-My-Header": "hello" });
    });

    it("should support subclass override of getCustomHeaders()", () => {
      const provider = new HeaderProvider(mockClient, { appKey: "secret-key" });
      const headers = (provider as any).getCustomHeaders();
      expect(headers["X-App-Key"]).toBe("secret-key");
    });

    it("should merge customHeaders with subclass-specific headers", () => {
      const provider = new HeaderProvider(mockClient, {
        customHeaders: { "X-Extra": "extra" },
        appKey: "my-key",
      });
      const headers = (provider as any).getCustomHeaders();
      expect(headers["X-Extra"]).toBe("extra");
      expect(headers["X-App-Key"]).toBe("my-key");
    });
  });

  // --------------------------------------------------------------------------
  // normalizeProviderStream()
  // --------------------------------------------------------------------------

  describe("normalizeProviderStream()", () => {
    async function collectChunks(
      provider: TestOpenAICompatibleProvider,
      mockChunks: ChatCompletionChunk[],
    ) {
      async function* makeStream() {
        for (const chunk of mockChunks) {
          yield chunk;
        }
      }
      const chunks = [];
      for await (const chunk of (provider as any).normalizeProviderStream(makeStream())) {
        chunks.push(chunk);
      }
      return chunks;
    }

    it("should yield text chunks for delta content", async () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const mockChunks: ChatCompletionChunk[] = [
        {
          id: "c1",
          object: "chat.completion.chunk",
          created: 1,
          model: "test-model",
          choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
        },
        {
          id: "c2",
          object: "chat.completion.chunk",
          created: 2,
          model: "test-model",
          choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }],
        },
      ];

      const chunks = await collectChunks(provider, mockChunks);
      expect(chunks).toHaveLength(2);
      expect(chunks[0].text).toBe("Hello");
      expect(chunks[1].text).toBe(" world");
    });

    it("should yield a finish chunk when finish_reason is present", async () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const mockChunks: ChatCompletionChunk[] = [
        {
          id: "c1",
          object: "chat.completion.chunk",
          created: 1,
          model: "test-model",
          choices: [{ index: 0, delta: { content: "Done" }, finish_reason: null }],
        },
        {
          id: "c2",
          object: "chat.completion.chunk",
          created: 2,
          model: "test-model",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        },
      ];

      const chunks = await collectChunks(provider, mockChunks);
      const finishChunk = chunks.find((c) => c.finishReason !== undefined);
      expect(finishChunk).toBeDefined();
      expect(finishChunk?.finishReason).toBe("stop");
    });

    it("should yield usage data in the final chunk", async () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const mockChunks: ChatCompletionChunk[] = [
        {
          id: "c1",
          object: "chat.completion.chunk",
          created: 1,
          model: "test-model",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        },
      ];

      const chunks = await collectChunks(provider, mockChunks);
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.usage).toEqual({
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30,
        cachedInputTokens: 0,
      });
    });

    it("should extract cached_tokens from prompt_tokens_details", async () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const mockChunks: ChatCompletionChunk[] = [
        {
          id: "c1",
          object: "chat.completion.chunk",
          created: 1,
          model: "test-model",
          choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
        },
        {
          id: "c2",
          object: "chat.completion.chunk",
          created: 1,
          model: "test-model",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            prompt_tokens_details: { cached_tokens: 25 } as any,
          },
        },
      ];

      const chunks = await collectChunks(provider, mockChunks);
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cachedInputTokens: 25,
      });
    });

    it("should include reasoningTokens when completion_tokens_details is present", async () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const mockChunks: ChatCompletionChunk[] = [
        {
          id: "c1",
          object: "chat.completion.chunk",
          created: 1,
          model: "test-model",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            completion_tokens_details: { reasoning_tokens: 3 } as any,
          },
        },
      ];

      const chunks = await collectChunks(provider, mockChunks);
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.usage?.reasoningTokens).toBe(3);
    });

    it("should not emit a chunk for empty delta content", async () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const mockChunks: ChatCompletionChunk[] = [
        {
          id: "c1",
          object: "chat.completion.chunk",
          created: 1,
          model: "test-model",
          choices: [{ index: 0, delta: { content: "" }, finish_reason: null }],
        },
      ];

      const chunks = await collectChunks(provider, mockChunks);
      // An empty delta should not produce a text chunk (no text and no finish/usage)
      const textChunks = chunks.filter((c) => c.text !== "" && c.text !== undefined);
      expect(textChunks).toHaveLength(0);
    });

    it("should handle chunks with no choices", async () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const mockChunks: ChatCompletionChunk[] = [
        {
          id: "c1",
          object: "chat.completion.chunk",
          created: 1,
          model: "test-model",
          choices: [],
        },
      ];

      // Should not throw
      const chunks = await collectChunks(provider, mockChunks);
      expect(chunks).toHaveLength(0);
    });

    it("should correctly process a full conversation stream", async () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const mockChunks: ChatCompletionChunk[] = [
        {
          id: "1",
          object: "chat.completion.chunk",
          created: 1,
          model: "test-model",
          choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
        },
        {
          id: "2",
          object: "chat.completion.chunk",
          created: 2,
          model: "test-model",
          choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }],
        },
        {
          id: "3",
          object: "chat.completion.chunk",
          created: 3,
          model: "test-model",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
      ];

      const chunks = await collectChunks(provider, mockChunks);
      // Expect text chunks + final chunk (finish + usage combined)
      const textChunks = chunks.filter((c) => c.text !== "");
      const finishChunk = chunks.find((c) => c.finishReason !== undefined);

      expect(textChunks).toHaveLength(2);
      expect(textChunks[0].text).toBe("Hello");
      expect(textChunks[1].text).toBe(" world");
      expect(finishChunk?.finishReason).toBe("stop");
      expect(finishChunk?.usage?.totalTokens).toBe(15);
    });
  });

  // --------------------------------------------------------------------------
  // countTokens()
  // --------------------------------------------------------------------------

  describe("countTokens()", () => {
    const descriptor: ModelDescriptor = { provider: "testprovider", name: "test-model" };

    it("should use tiktoken o200k_base encoding for text", async () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const messages: LLMMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "World" },
      ];

      const count = await provider.countTokens(messages, descriptor);
      // tiktoken o200k_base: "Hello" = 1 token, "World" = 1 token
      // This should NOT be chars/4 (which would be ceil(10/4) = 3)
      expect(count).toBeGreaterThan(0);
      // Verify it's using tiktoken (not char-based): tiktoken counts differ from chars/4
      // For simple words, tiktoken gives ~1 token each, so 2 total
      expect(count).toBe(2);
    });

    it("should count tokens from multiple messages", async () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const messages: LLMMessage[] = [
        { role: "system", content: "You are helpful." }, // 4 tokens
        { role: "user", content: "Hello world" }, // 2 tokens
        { role: "assistant", content: "Hi there!" }, // 3 tokens
      ];

      const count = await provider.countTokens(messages, descriptor);
      // tiktoken o200k_base: 4 + 2 + 3 = 9
      expect(count).toBe(9);
    });

    it("should handle array content with text parts", async () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const content: ContentPart[] = [
        { type: "text", text: "Hello" }, // 1 token
        { type: "text", text: " world" }, // 1 token
      ];
      const messages: LLMMessage[] = [{ role: "user", content }];

      const count = await provider.countTokens(messages, descriptor);
      // tiktoken o200k_base: 1 + 1 = 2
      expect(count).toBe(2);
    });

    it("should return 0 for empty messages array", async () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const count = await provider.countTokens([], descriptor);
      expect(count).toBe(0);
    });

    it("should ignore image parts in token count", async () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const textOnly: LLMMessage[] = [{ role: "user", content: "Describe: " }];
      const withImage: LLMMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe: " },
            {
              type: "image",
              source: { type: "url", url: "https://example.com/img.jpg" },
            } as ImageContentPart,
          ],
        },
      ];

      const textCount = await provider.countTokens(textOnly, descriptor);
      const imageCount = await provider.countTokens(withImage, descriptor);
      // Image parts should not add to the text token count
      expect(imageCount).toBe(textCount);
    });

    it("should produce more accurate counts than old chars/4 estimate for JSON-heavy content", async () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      // JSON content has many short tokens (brackets, colons, etc.)
      const jsonContent = JSON.stringify({
        id: "msg-123",
        headers: [
          { name: "Subject", value: "Invoice #456" },
          { name: "Date", value: "2026-03-20" },
        ],
        body: { data: "base64encodedcontent" },
      });
      const messages: LLMMessage[] = [{ role: "user", content: jsonContent }];

      const tiktokenCount = await provider.countTokens(messages, descriptor);
      // The old chars/4 estimate dangerously underestimated token count for JSON.
      // This was the root cause of the warm-hill session failure.
      const oldChars4Estimate = Math.ceil(jsonContent.length / 4);
      expect(tiktokenCount).toBeGreaterThan(oldChars4Estimate);
    });
  });

  // --------------------------------------------------------------------------
  // enhanceError()
  // --------------------------------------------------------------------------

  describe("enhanceError()", () => {
    it("should return the same Error instance for regular errors", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const error = new Error("Something went wrong");
      const result = (provider as any).enhanceError(error);
      expect(result).toBe(error);
    });

    it("should wrap non-Error values in an Error", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const result = (provider as any).enhanceError("string error");
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe("string error");
    });

    it("should wrap null in an Error", () => {
      const provider = new TestOpenAICompatibleProvider(mockClient, {});
      const result = (provider as any).enhanceError(null);
      expect(result).toBeInstanceOf(Error);
    });

    it("should support subclass override of enhanceError()", () => {
      const provider = new EnhancingProvider(mockClient, {});
      const error = new Error("401 Unauthorized");
      const result = (provider as any).enhanceError(error);
      expect(result.message).toBe("Custom auth error: check your ENHANCING_API_KEY");
    });

    it("should fall back to base enhanceError for unrecognised errors in subclass", () => {
      const provider = new EnhancingProvider(mockClient, {});
      const error = new Error("Network error");
      const result = (provider as any).enhanceError(error);
      expect(result).toBe(error); // Same instance, unmodified
    });
  });
});

// ============================================================================
// createOpenAICompatibleProviderFromEnv()
// ============================================================================

describe("createOpenAICompatibleProviderFromEnv()", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should create a provider when API key is set", () => {
    process.env.TEST_COMPAT_API_KEY = "sk-test-key-123";

    const provider = createOpenAICompatibleProviderFromEnv(
      "TEST_COMPAT_API_KEY",
      "https://api.test.example.com/v1",
      TestOpenAICompatibleProvider,
      () => ({}),
    );

    expect(provider).toBeInstanceOf(TestOpenAICompatibleProvider);
    expect(provider?.providerId).toBe("testprovider");
  });

  it("should return null when API key is missing", () => {
    delete process.env.TEST_COMPAT_API_KEY;

    const provider = createOpenAICompatibleProviderFromEnv(
      "TEST_COMPAT_API_KEY",
      "https://api.test.example.com/v1",
      TestOpenAICompatibleProvider,
      () => ({}),
    );

    expect(provider).toBeNull();
  });

  it("should return null when API key is empty string", () => {
    process.env.TEST_COMPAT_API_KEY = "";

    const provider = createOpenAICompatibleProviderFromEnv(
      "TEST_COMPAT_API_KEY",
      "https://api.test.example.com/v1",
      TestOpenAICompatibleProvider,
      () => ({}),
    );

    expect(provider).toBeNull();
  });

  it("should return null when API key is only whitespace", () => {
    process.env.TEST_COMPAT_API_KEY = "   ";

    const provider = createOpenAICompatibleProviderFromEnv(
      "TEST_COMPAT_API_KEY",
      "https://api.test.example.com/v1",
      TestOpenAICompatibleProvider,
      () => ({}),
    );

    expect(provider).toBeNull();
  });

  it("should trim whitespace from the API key", () => {
    process.env.TEST_COMPAT_API_KEY = "  sk-trimmed-key  ";

    const provider = createOpenAICompatibleProviderFromEnv(
      "TEST_COMPAT_API_KEY",
      "https://api.test.example.com/v1",
      TestOpenAICompatibleProvider,
      () => ({}),
    );

    expect(provider).toBeInstanceOf(TestOpenAICompatibleProvider);
  });

  it("should pass config from configFactory to the provider", () => {
    process.env.TEST_COMPAT_API_KEY = "sk-test-key";

    const provider = createOpenAICompatibleProviderFromEnv(
      "TEST_COMPAT_API_KEY",
      "https://api.test.example.com/v1",
      TestOpenAICompatibleProvider,
      () => ({ customHeaders: { "X-Factory": "from-factory" } }),
    );

    expect(provider).toBeInstanceOf(TestOpenAICompatibleProvider);
    expect((provider as any).config.customHeaders).toEqual({ "X-Factory": "from-factory" });
  });

  it("should call configFactory to build the config", () => {
    process.env.TEST_COMPAT_API_KEY = "sk-test-key";
    const configFactory = vi.fn(() => ({}));

    createOpenAICompatibleProviderFromEnv(
      "TEST_COMPAT_API_KEY",
      "https://api.test.example.com/v1",
      TestOpenAICompatibleProvider,
      configFactory,
    );

    expect(configFactory).toHaveBeenCalledOnce();
  });

  it("should not call configFactory when API key is missing", () => {
    delete process.env.TEST_COMPAT_API_KEY;
    const configFactory = vi.fn(() => ({}));

    createOpenAICompatibleProviderFromEnv(
      "TEST_COMPAT_API_KEY",
      "https://api.test.example.com/v1",
      TestOpenAICompatibleProvider,
      configFactory,
    );

    expect(configFactory).not.toHaveBeenCalled();
  });
});
