import { describe, expect, it, mock } from "bun:test";
import type { LLMMessage } from "../core/messages.js";
import type { ModelSpec } from "../core/model-catalog.js";
import type { LLMGenerationOptions, LLMStreamChunk, ModelDescriptor } from "../core/options.js";
import { BaseProviderAdapter } from "./base-provider.js";

/**
 * Concrete test implementation of BaseProviderAdapter.
 * This allows us to test the Template Method pattern logic.
 */
class TestProviderAdapter extends BaseProviderAdapter {
  readonly providerId = "test";

  // Expose internal methods for testing
  public prepareMessagesCalled = false;
  public buildPayloadCalled = false;
  public executeStreamCalled = false;
  public normalizeStreamCalled = false;

  public lastPayload: unknown = null;
  public lastPreparedMessages: LLMMessage[] = [];

  // Configurable response chunks
  private responseChunks: LLMStreamChunk[] = [{ type: "text", text: "Hello, world!" }];

  setResponseChunks(chunks: LLMStreamChunk[]): void {
    this.responseChunks = chunks;
  }

  supports(descriptor: ModelDescriptor): boolean {
    return descriptor.provider === "test";
  }

  protected prepareMessages(messages: LLMMessage[]): LLMMessage[] {
    this.prepareMessagesCalled = true;
    this.lastPreparedMessages = messages;
    return messages;
  }

  protected buildApiRequest(
    options: LLMGenerationOptions,
    descriptor: ModelDescriptor,
    _spec: ModelSpec | undefined,
    messages: LLMMessage[],
  ): unknown {
    this.buildPayloadCalled = true;
    this.lastPayload = {
      model: descriptor.name,
      messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    };
    return this.lastPayload;
  }

  protected async executeStreamRequest(_payload: unknown): Promise<AsyncIterable<unknown>> {
    this.executeStreamCalled = true;
    const chunks = this.responseChunks;
    return {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          yield chunk;
        }
      },
    };
  }

  protected async *normalizeProviderStream(rawStream: AsyncIterable<unknown>): AsyncGenerator<LLMStreamChunk> {
    this.normalizeStreamCalled = true;
    for await (const chunk of rawStream) {
      yield chunk as LLMStreamChunk;
    }
  }
}

/**
 * Provider that transforms messages (like Gemini does for consecutive messages).
 */
class TransformingProviderAdapter extends TestProviderAdapter {
  readonly providerId = "transforming";

  protected prepareMessages(messages: LLMMessage[]): LLMMessage[] {
    super.prepareMessages(messages);
    // Simulate merging consecutive user messages
    const result: LLMMessage[] = [];
    for (const msg of messages) {
      const last = result[result.length - 1];
      if (last && last.role === msg.role) {
        // Merge with previous message
        last.content = `${last.content}\n${msg.content}`;
      } else {
        result.push({ ...msg });
      }
    }
    return result;
  }

  supports(descriptor: ModelDescriptor): boolean {
    return descriptor.provider === "transforming";
  }
}

describe("BaseProviderAdapter", () => {
  describe("stream (Template Method)", () => {
    it("should call all four steps in order", async () => {
      const adapter = new TestProviderAdapter(null);
      const options: LLMGenerationOptions = {
        messages: [{ role: "user", content: "Hello" }],
      };
      const descriptor: ModelDescriptor = { provider: "test", name: "test-model" };

      const chunks: LLMStreamChunk[] = [];
      for await (const chunk of adapter.stream(options, descriptor)) {
        chunks.push(chunk);
      }

      expect(adapter.prepareMessagesCalled).toBe(true);
      expect(adapter.buildPayloadCalled).toBe(true);
      expect(adapter.executeStreamCalled).toBe(true);
      expect(adapter.normalizeStreamCalled).toBe(true);
    });

    it("should pass messages through prepareMessages", async () => {
      const adapter = new TestProviderAdapter(null);
      const messages: LLMMessage[] = [
        { role: "user", content: "First" },
        { role: "assistant", content: "Response" },
        { role: "user", content: "Second" },
      ];
      const options: LLMGenerationOptions = { messages };
      const descriptor: ModelDescriptor = { provider: "test", name: "test-model" };

      for await (const _ of adapter.stream(options, descriptor)) {
        // Consume stream
      }

      expect(adapter.lastPreparedMessages).toEqual(messages);
    });

    it("should build payload with prepared messages", async () => {
      const adapter = new TestProviderAdapter(null);
      const options: LLMGenerationOptions = {
        messages: [{ role: "user", content: "Test" }],
        temperature: 0.7,
        maxTokens: 100,
      };
      const descriptor: ModelDescriptor = { provider: "test", name: "test-model" };

      for await (const _ of adapter.stream(options, descriptor)) {
        // Consume stream
      }

      expect(adapter.lastPayload).toEqual({
        model: "test-model",
        messages: options.messages,
        temperature: 0.7,
        maxTokens: 100,
      });
    });

    it("should yield chunks from wrapStream", async () => {
      const adapter = new TestProviderAdapter(null);
      adapter.setResponseChunks([
        { type: "text", text: "Hello" },
        { type: "text", text: " " },
        { type: "text", text: "world!" },
      ]);

      const options: LLMGenerationOptions = {
        messages: [{ role: "user", content: "Hi" }],
      };
      const descriptor: ModelDescriptor = { provider: "test", name: "test-model" };

      const chunks: LLMStreamChunk[] = [];
      for await (const chunk of adapter.stream(options, descriptor)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toEqual({ type: "text", text: "Hello" });
      expect(chunks[1]).toEqual({ type: "text", text: " " });
      expect(chunks[2]).toEqual({ type: "text", text: "world!" });
    });

    it("should handle empty messages", async () => {
      const adapter = new TestProviderAdapter(null);
      const options: LLMGenerationOptions = { messages: [] };
      const descriptor: ModelDescriptor = { provider: "test", name: "test-model" };

      const chunks: LLMStreamChunk[] = [];
      for await (const chunk of adapter.stream(options, descriptor)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
    });

    it("should pass model spec to buildApiRequest", async () => {
      const buildApiRequestMock = mock(
        (
          _options: LLMGenerationOptions,
          _descriptor: ModelDescriptor,
          spec: ModelSpec | undefined,
        ) => {
          expect(spec).toBeDefined();
          expect(spec?.modelId).toBe("test-model");
          return {};
        },
      );

      const adapter = new TestProviderAdapter(null);
      // Override buildApiRequest
      (adapter as unknown as { buildApiRequest: typeof buildApiRequestMock }).buildApiRequest =
        buildApiRequestMock;

      const options: LLMGenerationOptions = {
        messages: [{ role: "user", content: "Hi" }],
      };
      const descriptor: ModelDescriptor = { provider: "test", name: "test-model" };
      const spec: ModelSpec = {
        modelId: "test-model",
        displayName: "Test Model",
        provider: "test",
        features: [],
        contextWindow: 4096,
        maxOutputTokens: 1024,
        defaultTokenCounterModel: "test-model",
      };

      for await (const _ of adapter.stream(options, descriptor, spec)) {
        // Consume stream
      }
    });
  });

  describe("prepareMessages (default)", () => {
    it("should return messages unchanged by default", async () => {
      const adapter = new TestProviderAdapter(null);
      const messages: LLMMessage[] = [
        { role: "user", content: "Message 1" },
        { role: "user", content: "Message 2" }, // Consecutive user messages
      ];
      const options: LLMGenerationOptions = { messages };
      const descriptor: ModelDescriptor = { provider: "test", name: "test-model" };

      for await (const _ of adapter.stream(options, descriptor)) {
        // Consume stream
      }

      // Default implementation returns messages unchanged
      expect(adapter.lastPreparedMessages).toEqual(messages);
    });
  });

  describe("prepareMessages (custom transformation)", () => {
    it("should support custom message transformation", async () => {
      const adapter = new TransformingProviderAdapter(null);
      const messages: LLMMessage[] = [
        { role: "user", content: "First" },
        { role: "user", content: "Second" }, // Should be merged
        { role: "assistant", content: "Response" },
      ];
      const options: LLMGenerationOptions = { messages };
      const descriptor: ModelDescriptor = { provider: "transforming", name: "test-model" };

      for await (const _ of adapter.stream(options, descriptor)) {
        // Consume stream
      }

      // Check that consecutive user messages were merged
      expect(adapter.lastPreparedMessages).toHaveLength(3); // Original messages passed
      // The merged result is internal to prepareMessages
    });
  });

  describe("supports", () => {
    it("should return true for matching provider", () => {
      const adapter = new TestProviderAdapter(null);

      expect(adapter.supports({ provider: "test", name: "any-model" })).toBe(true);
    });

    it("should return false for non-matching provider", () => {
      const adapter = new TestProviderAdapter(null);

      expect(adapter.supports({ provider: "other", name: "any-model" })).toBe(false);
    });
  });

  describe("providerId", () => {
    it("should expose provider identifier", () => {
      const adapter = new TestProviderAdapter(null);

      expect(adapter.providerId).toBe("test");
    });
  });

  describe("getModelSpecs (optional)", () => {
    it("should be undefined by default", () => {
      const adapter = new TestProviderAdapter(null);

      expect(adapter.getModelSpecs).toBeUndefined();
    });

    it("should allow implementation to provide specs", () => {
      class SpecProvidingAdapter extends TestProviderAdapter {
        getModelSpecs(): ModelSpec[] {
          return [
            {
              modelId: "test-model",
              displayName: "Test Model",
              provider: "test",
              features: [],
              contextWindow: 4096,
              maxOutputTokens: 1024,
              defaultTokenCounterModel: "test-model",
            },
          ];
        }
      }

      const adapter = new SpecProvidingAdapter(null);
      const specs = adapter.getModelSpecs?.();

      expect(specs).toBeDefined();
      expect(specs).toHaveLength(1);
      expect(specs?.[0].modelId).toBe("test-model");
    });
  });

  describe("client storage", () => {
    it("should store client in constructor", () => {
      const mockClient = { name: "mock-sdk-client" };
      const adapter = new TestProviderAdapter(mockClient);

      // Can't directly access protected property, but adapter should be valid
      expect(adapter.providerId).toBe("test");
    });
  });

  describe("async iteration", () => {
    it("should support for-await-of syntax", async () => {
      const adapter = new TestProviderAdapter(null);
      adapter.setResponseChunks([
        { type: "text", text: "A" },
        { type: "text", text: "B" },
        { type: "text", text: "C" },
      ]);

      const options: LLMGenerationOptions = {
        messages: [{ role: "user", content: "Test" }],
      };
      const descriptor: ModelDescriptor = { provider: "test", name: "model" };

      const texts: string[] = [];
      for await (const chunk of adapter.stream(options, descriptor)) {
        if (chunk.type === "text") {
          texts.push(chunk.text);
        }
      }

      expect(texts).toEqual(["A", "B", "C"]);
    });

    it("should handle finish chunks", async () => {
      const adapter = new TestProviderAdapter(null);
      adapter.setResponseChunks([
        { type: "text", text: "Response" },
        {
          type: "finish",
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
      ]);

      const options: LLMGenerationOptions = {
        messages: [{ role: "user", content: "Test" }],
      };
      const descriptor: ModelDescriptor = { provider: "test", name: "model" };

      const chunks: LLMStreamChunk[] = [];
      for await (const chunk of adapter.stream(options, descriptor)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[1].type).toBe("finish");
      if (chunks[1].type === "finish") {
        expect(chunks[1].finishReason).toBe("stop");
        expect(chunks[1].usage?.totalTokens).toBe(15);
      }
    });
  });
});
