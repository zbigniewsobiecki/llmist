import type { LLMMessage } from "../core/messages.js";
import type { LLMGenerationOptions, LLMStream, ModelDescriptor } from "../core/options.js";
import { ModelIdentifierParser } from "../core/options.js";
import type { ProviderAdapter } from "../providers/provider.js";
import { getMockManager, type MockManager } from "./mock-manager.js";
import { createMockStream } from "./mock-stream.js";
import type { MockMatcherContext, MockOptions } from "./mock-types.js";

/**
 * Provider adapter that serves mock responses instead of making real LLM API calls.
 * This is useful for testing applications that use llmist without incurring API costs.
 *
 * The MockProviderAdapter has high priority (100) and is always checked before
 * real providers when both are registered. This enables selective mocking where
 * some models use mocks while others use real providers. If no matching mock is
 * found and strictMode is disabled, requests return an empty response.
 *
 * @example
 * ```typescript
 * import { LLMist, createMockAdapter, mockLLM } from 'llmist/testing';
 *
 * // Use with real providers for selective mocking
 * const client = new LLMist({
 *   adapters: [createMockAdapter()],
 *   autoDiscoverProviders: true // Also loads real OpenAI, Anthropic, etc.
 * });
 *
 * // Register mocks for specific models
 * mockLLM()
 *   .forModel('gpt-5-nano')
 *   .returns('Test response')
 *   .register();
 *
 * // gpt-5-nano uses mock, other models use real providers
 * const stream = client.stream({
 *   model: 'openai:gpt-5-nano',
 *   messages: [{ role: 'user', content: 'test' }]
 * });
 * ```
 */
export class MockProviderAdapter implements ProviderAdapter {
  readonly providerId = "mock";
  readonly priority = 100; // High priority: check mocks before real providers
  private readonly mockManager: MockManager;

  constructor(options?: MockOptions) {
    this.mockManager = getMockManager(options);
  }

  supports(descriptor: ModelDescriptor): boolean {
    // Support any provider when using mock adapter
    // This allows tests to use "openai:gpt-4", "anthropic:claude", etc.
    return true;
  }

  stream(
    options: LLMGenerationOptions,
    descriptor: ModelDescriptor,
    // spec is unused for mocks
    // biome-ignore lint/correctness/noUnusedVariables: spec parameter required by interface
    spec?: unknown,
  ): LLMStream {
    // Create matcher context
    const context: MockMatcherContext = {
      model: options.model,
      provider: descriptor.provider,
      modelName: descriptor.name,
      options,
      messages: options.messages,
    };

    // Find matching mock (async operation)
    // We need to handle this in the stream generator
    return this.createMockStreamFromContext(context);
  }

  private async *createMockStreamFromContext(context: MockMatcherContext): LLMStream {
    try {
      // Find matching mock
      const mockResponse = await this.mockManager.findMatch(context);

      if (!mockResponse) {
        // This should not happen if MockManager is configured correctly
        // but handle it gracefully
        yield {
          text: "",
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
        return;
      }

      // Stream the mock response
      yield* createMockStream(mockResponse);
    } catch (error) {
      // If an error occurs (e.g., strictMode with no match), we need to handle it
      throw error;
    }
  }
}

/**
 * Create a mock provider adapter instance.
 * This is a convenience factory function.
 *
 * @param options - Optional configuration for the mock system
 * @returns A configured MockProviderAdapter
 *
 * @example
 * ```typescript
 * const adapter = createMockAdapter({ strictMode: true, debug: true });
 * const client = new LLMist([adapter]);
 * ```
 */
export function createMockAdapter(options?: MockOptions): MockProviderAdapter {
  return new MockProviderAdapter(options);
}
