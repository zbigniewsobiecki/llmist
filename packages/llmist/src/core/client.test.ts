import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as discoveryModule from "../providers/discovery.js";
import type { ProviderAdapter } from "../providers/provider.js";
import { LLMist } from "./client.js";
import type { LLMMessage } from "./messages.js";
import type { ModelSpec } from "./model-catalog.js";
import type { LLMGenerationOptions, LLMStream, ModelDescriptor } from "./options.js";

// Hoisted mock functions for tiktoken — must be declared before vi.mock("tiktoken")
const { mockGetEncoding } = vi.hoisted(() => {
  const mockEncode = vi.fn((text: string) => {
    if (!text?.trim()) return [];
    // One token per whitespace-separated word — matches real tiktoken results for
    // the simple single-word strings used in the existing test assertions.
    const words = text
      .trim()
      .split(/\s+/)
      .filter((w: string) => w.length > 0);
    return new Array(words.length).fill(0);
  });

  const mockGetEncoding = vi.fn(() => ({
    encode: mockEncode,
    free: vi.fn(),
  }));

  return { mockGetEncoding };
});

// Replace the real tiktoken module so every test runs without a native binary
vi.mock("tiktoken", () => ({ get_encoding: mockGetEncoding }));

describe("LLMist Client", () => {
  // Mock provider adapters
  const createMockAdapter = (
    providerId: string,
    hasTokenCounting = false,
    modelSpecs: ModelSpec[] = [],
  ): ProviderAdapter => ({
    providerId,
    supports: (descriptor: ModelDescriptor) => descriptor.provider === providerId,
    stream: vi.fn((_options: LLMGenerationOptions) => {
      return (async function* () {
        yield { type: "content_delta", text: "Hello" };
      })() as LLMStream;
    }),
    getModelSpecs: modelSpecs.length > 0 ? () => modelSpecs : undefined,
    countTokens: hasTokenCounting
      ? vi.fn(async (messages: LLMMessage[]) => {
          return messages.reduce((sum, msg) => sum + (msg.content?.length ?? 0), 0) * 2;
        })
      : undefined,
  });

  const mockModelSpec: ModelSpec = {
    modelId: "test-model",
    provider: "test",
    contextWindow: 8192,
    maxOutputTokens: 4096,
    pricing: {
      input: 5.0,
      output: 15.0,
    },
    features: {
      streaming: true,
      functionCalling: false,
      vision: false,
      json: false,
    },
  };

  describe("Constructor", () => {
    it("should create client with no arguments (auto-discovery)", () => {
      // Mock environment to ensure at least one provider is discovered
      const originalEnv = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = "sk-test-fake-key-for-testing";

      try {
        expect(() => new LLMist()).not.toThrow();
      } finally {
        // Restore original environment
        if (originalEnv === undefined) {
          delete process.env.OPENAI_API_KEY;
        } else {
          process.env.OPENAI_API_KEY = originalEnv;
        }
      }
    });

    it("should create client with explicit adapters array", () => {
      const adapter = createMockAdapter("test");
      const client = new LLMist([adapter]);

      expect(client).toBeDefined();
      expect(client.modelRegistry).toBeDefined();
    });

    it("should create client with adapters and default provider", () => {
      const adapter1 = createMockAdapter("test1");
      const adapter2 = createMockAdapter("test2");
      const client = new LLMist([adapter1, adapter2], "test2");

      expect(client).toBeDefined();
    });

    it("should create client with options object", () => {
      const adapter = createMockAdapter("test");
      const client = new LLMist({
        adapters: [adapter],
        defaultProvider: "test",
        autoDiscoverProviders: false,
      });

      expect(client).toBeDefined();
    });

    it("should merge explicit and discovered adapters", () => {
      const adapter = createMockAdapter("custom");
      const client = new LLMist({
        adapters: [adapter],
        autoDiscoverProviders: true,
      });

      expect(client).toBeDefined();
    });

    it("should not duplicate discovered adapters with same provider ID as explicit adapters", () => {
      const explicitAdapter = createMockAdapter("openai", false, [
        { ...mockModelSpec, modelId: "explicit-model" },
      ]);

      // When autoDiscoverProviders is true, it might discover an openai adapter
      // The explicit one should take precedence
      const client = new LLMist({
        adapters: [explicitAdapter],
        autoDiscoverProviders: true, // This might discover openai adapter too
      });

      // Should not have duplicate provider registrations
      // The explicit adapter should take precedence over discovered ones
      const openaiModels = client.modelRegistry.listModels("openai");
      expect(openaiModels).toHaveLength(1);
      expect(openaiModels[0].modelId).toBe("explicit-model");
    });

    it("should throw error when no providers available", () => {
      expect(() => {
        new LLMist({
          adapters: [],
          autoDiscoverProviders: false,
        });
      }).toThrow("No LLM providers available");
    });

    it("should register all adapters with model registry", () => {
      const spec1: ModelSpec = { ...mockModelSpec, modelId: "model-1" };
      const spec2: ModelSpec = { ...mockModelSpec, modelId: "model-2" };

      const adapter1 = createMockAdapter("test1", false, [spec1]);
      const adapter2 = createMockAdapter("test2", false, [spec2]);

      const client = new LLMist({
        adapters: [adapter1, adapter2],
        autoDiscoverProviders: false,
      });

      const models = client.modelRegistry.listModels();
      expect(models).toHaveLength(2);
      expect(models.map((m) => m.modelId)).toEqual(["model-1", "model-2"]);
    });
  });

  describe("stream()", () => {
    let client: LLMist;
    let mockAdapter: ProviderAdapter;

    beforeEach(() => {
      mockAdapter = createMockAdapter("test", false, [mockModelSpec]);
      client = new LLMist({
        adapters: [mockAdapter],
        defaultProvider: "test",
        autoDiscoverProviders: false,
      });
    });

    it("should call adapter stream() with correct parameters", async () => {
      const options: LLMGenerationOptions = {
        model: "test:test-model",
        messages: [{ role: "user", content: "Hello" }],
      };

      const stream = client.stream(options);

      // Verify stream is async generator
      expect(typeof stream[Symbol.asyncIterator]).toBe("function");

      // Collect results
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({ type: "content_delta", text: "Hello" });
      expect(mockAdapter.stream).toHaveBeenCalledTimes(1);
    });

    it("should use default provider when not specified", async () => {
      const options: LLMGenerationOptions = {
        model: "test-model",
        messages: [{ role: "user", content: "Hello" }],
      };

      const stream = client.stream(options);
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
    });

    it("should throw error when no adapter found for provider", () => {
      const options: LLMGenerationOptions = {
        model: "unknown:test-model",
        messages: [{ role: "user", content: "Hello" }],
      };

      expect(() => client.stream(options)).toThrow("No adapter registered for provider unknown");
    });

    it("should apply default temperature of 0 when not specified", async () => {
      const options: LLMGenerationOptions = {
        model: "test:test-model",
        messages: [{ role: "user", content: "Hello" }],
        // Note: no temperature specified
      };

      const stream = client.stream(options);
      for await (const _chunk of stream) {
        // consume stream
      }

      // Verify adapter received temperature: 0
      expect(mockAdapter.stream).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0 }),
        expect.anything(),
        expect.anything(),
      );
    });

    it("should preserve explicit temperature when specified", async () => {
      const options: LLMGenerationOptions = {
        model: "test:test-model",
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.7,
      };

      const stream = client.stream(options);
      for await (const _chunk of stream) {
        // consume stream
      }

      // Verify adapter received the explicit temperature
      expect(mockAdapter.stream).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.7 }),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe("countTokens()", () => {
    it("should use provider token counting when available", async () => {
      const adapter = createMockAdapter("test", true, [mockModelSpec]);
      const client = new LLMist({
        adapters: [adapter],
        defaultProvider: "test",
        autoDiscoverProviders: false,
      });

      const messages: LLMMessage[] = [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hello" },
      ];

      const count = await client.countTokens("test:test-model", messages);

      // Mock adapter multiplies character count by 2
      const expectedChars = "You are helpful".length + "Hello".length;
      expect(count).toBe(expectedChars * 2);
      expect(adapter.countTokens).toHaveBeenCalledTimes(1);
    });

    it("should fallback to tiktoken when provider lacks token counting", async () => {
      const adapter = createMockAdapter("test", false, [mockModelSpec]);
      const client = new LLMist({
        adapters: [adapter],
        defaultProvider: "test",
        autoDiscoverProviders: false,
      });

      const messages: LLMMessage[] = [
        { role: "system", content: "Hello" },
        { role: "user", content: "World" },
      ];

      const count = await client.countTokens("test:test-model", messages);

      // Fallback uses tiktoken o200k_base: "Hello" = 1 token, "World" = 1 token
      expect(count).toBe(2);
    });

    it("should handle messages with no content", async () => {
      const adapter = createMockAdapter("test", false, [mockModelSpec]);
      const client = new LLMist({
        adapters: [adapter],
        defaultProvider: "test",
        autoDiscoverProviders: false,
      });

      const messages: LLMMessage[] = [
        { role: "system", content: undefined },
        { role: "user", content: "Hello" },
      ];

      const count = await client.countTokens("test:test-model", messages);

      // tiktoken o200k_base: "Hello" = 1 token, undefined content = 0 tokens
      expect(count).toBe(1);
    });

    it("should handle empty messages array", async () => {
      const adapter = createMockAdapter("test", false, [mockModelSpec]);
      const client = new LLMist({
        adapters: [adapter],
        defaultProvider: "test",
        autoDiscoverProviders: false,
      });

      const count = await client.countTokens("test:test-model", []);

      expect(count).toBe(0);
    });

    it("should use default provider when not specified in model", async () => {
      const adapter = createMockAdapter("test", true, [mockModelSpec]);
      const client = new LLMist({
        adapters: [adapter],
        defaultProvider: "test",
        autoDiscoverProviders: false,
      });

      const messages: LLMMessage[] = [{ role: "user", content: "Hello" }];

      const count = await client.countTokens("test-model", messages);

      expect(count).toBe("Hello".length * 2); // 10 tokens
    });

    it("should count tokens for array content (text parts) via tiktoken fallback", async () => {
      const adapter = createMockAdapter("test", false, [mockModelSpec]);
      const client = new LLMist({
        adapters: [adapter],
        defaultProvider: "test",
        autoDiscoverProviders: false,
      });

      // Message with array content including a text part and a non-text part
      const messages: LLMMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Hello" },
            // image_url parts should be skipped — no text to count
            { type: "image_url", url: "https://example.com/img.png" } as never,
          ],
        },
      ];

      const count = await client.countTokens("test:test-model", messages);

      // Only the text part "Hello" contributes: 1 token via mock
      expect(count).toBe(1);
      expect(mockGetEncoding).toHaveBeenCalled();
    });

    it("should fall back to character-based estimation when tiktoken is unavailable", async () => {
      // Force tiktoken to throw so the char-based branch is exercised
      mockGetEncoding.mockImplementationOnce(() => {
        throw new Error("tiktoken not available");
      });

      const adapter = createMockAdapter("test", false, [mockModelSpec]);
      const client = new LLMist({
        adapters: [adapter],
        defaultProvider: "test",
        autoDiscoverProviders: false,
      });

      // CHARS_PER_TOKEN = 2, so 10 chars → Math.ceil(10 / 2) = 5
      const messages: LLMMessage[] = [{ role: "user", content: "HelloWorld" }];

      const count = await client.countTokens("test:test-model", messages);

      expect(count).toBe(5);
    });

    it("should fall back to char-based estimation for array content when tiktoken is unavailable", async () => {
      mockGetEncoding.mockImplementationOnce(() => {
        throw new Error("tiktoken not available");
      });

      const adapter = createMockAdapter("test", false, [mockModelSpec]);
      const client = new LLMist({
        adapters: [adapter],
        defaultProvider: "test",
        autoDiscoverProviders: false,
      });

      // "Hi" (2 chars) + "ok" (2 chars) = 4 chars → Math.ceil(4 / 2) = 2
      const messages: LLMMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Hi" },
            { type: "text", text: "ok" },
          ],
        },
      ];

      const count = await client.countTokens("test:test-model", messages);

      expect(count).toBe(2);
    });
  });

  describe("Error Handling", () => {
    it("should throw error when resolving non-existent provider", () => {
      const adapter = createMockAdapter("test");
      const client = new LLMist({
        adapters: [adapter],
        autoDiscoverProviders: false,
      });

      const options: LLMGenerationOptions = {
        model: "nonexistent:model",
        messages: [{ role: "user", content: "Hello" }],
      };

      expect(() => client.stream(options)).toThrow(
        "No adapter registered for provider nonexistent",
      );
    });
  });

  describe("streamText()", () => {
    let client: LLMist;
    let mockAdapter: ProviderAdapter;

    beforeEach(() => {
      mockAdapter = createMockAdapter("test", false, [mockModelSpec]);
      client = new LLMist({
        adapters: [mockAdapter],
        defaultProvider: "test",
        autoDiscoverProviders: false,
      });
    });

    it("should return an async iterable of text chunks", async () => {
      const chunks: string[] = [];
      for await (const chunk of client.streamText("Hello", { model: "test:test-model" })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe("Hello");
    });

    it("should use the provided model option", async () => {
      const chunks: string[] = [];
      for await (const chunk of client.streamText("Hello", { model: "test:test-model" })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(mockAdapter.stream).toHaveBeenCalled();
    });

    it("should use system prompt when provided", async () => {
      const chunks: string[] = [];
      for await (const chunk of client.streamText("Hello", {
        model: "test:test-model",
        systemPrompt: "You are helpful",
      })) {
        chunks.push(chunk);
      }

      // Verify adapter was called with messages that include a system message
      expect(mockAdapter.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system", content: "You are helpful" }),
          ]),
        }),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe("createAgent()", () => {
    it("client.createAgent() instance method returns an AgentBuilder", () => {
      const adapter = createMockAdapter("test", false, [mockModelSpec]);
      const client = new LLMist({
        adapters: [adapter],
        defaultProvider: "test",
        autoDiscoverProviders: false,
      });

      const builder = client.createAgent();

      expect(builder).toBeDefined();
      // AgentBuilder has a withModel method confirming it's a builder
      expect(typeof builder.withModel).toBe("function");
    });

    it("client.createAgent() returns a builder pre-configured with this client", () => {
      const adapter = createMockAdapter("test", false, [mockModelSpec]);
      const client = new LLMist({
        adapters: [adapter],
        defaultProvider: "test",
        autoDiscoverProviders: false,
      });

      const builder = client.createAgent();

      // Builder should be chainable
      expect(builder).toBeDefined();
      expect(typeof builder.withSystem).toBe("function");
      expect(typeof builder.ask).toBe("function");
    });

    it("LLMist.createAgent() static method returns an AgentBuilder without a client instance", () => {
      const builder = LLMist.createAgent();

      expect(builder).toBeDefined();
      expect(typeof builder.withModel).toBe("function");
    });

    it("LLMist.createAgent() static method returns a builder with chainable API", () => {
      const builder = LLMist.createAgent();

      // The static builder should support the full chainable API
      expect(typeof builder.withSystem).toBe("function");
      expect(typeof builder.ask).toBe("function");
    });

    it("static createAgent() and instance createAgent() both return AgentBuilder instances", () => {
      const adapter = createMockAdapter("test", false, [mockModelSpec]);
      const client = new LLMist({
        adapters: [adapter],
        defaultProvider: "test",
        autoDiscoverProviders: false,
      });

      const staticBuilder = LLMist.createAgent();
      const instanceBuilder = client.createAgent();

      // Both should be AgentBuilder instances with the same API surface
      expect(typeof staticBuilder.withModel).toBe("function");
      expect(typeof instanceBuilder.withModel).toBe("function");
      expect(typeof staticBuilder.withSystem).toBe("function");
      expect(typeof instanceBuilder.withSystem).toBe("function");
    });
  });

  describe("Static Methods", () => {
    let mockAdapter: ProviderAdapter;

    beforeEach(() => {
      mockAdapter = createMockAdapter("test", false, [mockModelSpec]);
      // Route auto-discovery to our controllable mock adapter
      vi.spyOn(discoveryModule, "discoverProviderAdapters").mockReturnValue([mockAdapter]);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("LLMist.complete() should create a client via auto-discovery and return text", async () => {
      const result = await LLMist.complete("Hello", { model: "test:test-model" });

      // The mock adapter yields { type: "content_delta", text: "Hello" }
      // completeHelper trims the accumulated string
      expect(result).toBe("Hello");
      expect(mockAdapter.stream).toHaveBeenCalledTimes(1);
    });

    it("LLMist.complete() should pass system prompt through to the adapter", async () => {
      await LLMist.complete("Hello", {
        model: "test:test-model",
        systemPrompt: "You are helpful",
      });

      expect(mockAdapter.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system", content: "You are helpful" }),
          ]),
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    it("LLMist.stream() should create a client via auto-discovery and yield text chunks", async () => {
      const chunks: string[] = [];
      for await (const chunk of LLMist.stream("Hello", { model: "test:test-model" })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe("Hello");
      expect(mockAdapter.stream).toHaveBeenCalledTimes(1);
    });

    it("LLMist.stream() should delegate temperature option to the adapter", async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of LLMist.stream("Hello", {
        model: "test:test-model",
        temperature: 0.8,
      })) {
        // consume stream
      }

      expect(mockAdapter.stream).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.8 }),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe("Integration", () => {
    it("should work with multiple providers", async () => {
      const spec1: ModelSpec = { ...mockModelSpec, modelId: "model-1", provider: "provider1" };
      const spec2: ModelSpec = { ...mockModelSpec, modelId: "model-2", provider: "provider2" };

      const adapter1 = createMockAdapter("provider1", true, [spec1]);
      const adapter2 = createMockAdapter("provider2", false, [spec2]);

      const client = new LLMist({
        adapters: [adapter1, adapter2],
        defaultProvider: "provider1",
        autoDiscoverProviders: false,
      });

      // Test with provider1 (has token counting)
      const count1 = await client.countTokens("provider1:model-1", [
        { role: "user", content: "Hi" },
      ]);
      expect(count1).toBe(4); // "Hi" = 2 chars * 2

      // Test with provider2 (no token counting, uses fallback)
      const count2 = await client.countTokens("provider2:model-2", [
        { role: "user", content: "Hi" },
      ]);
      expect(count2).toBe(1); // "Hi" = 2 chars / 4 = 0.5, rounded up to 1

      // Verify models are registered
      const models = client.modelRegistry.listModels();
      expect(models).toHaveLength(2);
    });
  });
});
