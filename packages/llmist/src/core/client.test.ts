import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { ProviderAdapter } from "../providers/provider.js";
import { LLMist } from "./client.js";
import type { LLMMessage } from "./messages.js";
import type { ModelSpec } from "./model-catalog.js";
import type { LLMGenerationOptions, LLMStream, ModelDescriptor } from "./options.js";

describe("LLMist Client", () => {
  // Mock provider adapters
  const createMockAdapter = (
    providerId: string,
    hasTokenCounting = false,
    modelSpecs: ModelSpec[] = [],
  ): ProviderAdapter => ({
    providerId,
    supports: (descriptor: ModelDescriptor) => descriptor.provider === providerId,
    stream: mock((_options: LLMGenerationOptions) => {
      return (async function* () {
        yield { type: "content_delta", text: "Hello" };
      })() as LLMStream;
    }),
    getModelSpecs: modelSpecs.length > 0 ? () => modelSpecs : undefined,
    countTokens: hasTokenCounting
      ? mock(async (messages: LLMMessage[]) => {
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

    it("should fallback to character estimation when provider lacks token counting", async () => {
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

      // Fallback: chars / 4, rounded up
      const totalChars = "Hello".length + "World".length; // 10 chars
      expect(count).toBe(Math.ceil(totalChars / 4)); // 3 tokens
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

      // Only counts "Hello" = 5 chars
      expect(count).toBe(Math.ceil(5 / 4)); // 2 tokens
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
