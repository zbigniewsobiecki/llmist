import { LLMist } from "../core/client.js";
import { MockProviderAdapter } from "./mock-adapter.js";
import type { MockOptions } from "./mock-types.js";

/**
 * Create a preconfigured LLMist client with mock adapter.
 * This is a convenience function for testing scenarios.
 *
 * @param options - Optional configuration for the mock system
 * @returns A LLMist instance configured to use mocks
 *
 * @example
 * ```typescript
 * import { createMockClient, getMockManager } from 'llmist';
 *
 * // Setup
 * const client = createMockClient({ strictMode: true });
 * const mockManager = getMockManager();
 *
 * // Register mocks
 * mockManager.register({
 *   matcher: (ctx) => ctx.modelName === 'gpt-4',
 *   response: { text: 'Mocked response' }
 * });
 *
 * // Use in tests
 * const stream = client.stream({
 *   model: 'mock:gpt-4',
 *   messages: [{ role: 'user', content: 'test' }]
 * });
 * ```
 */
export function createMockClient(options?: MockOptions): LLMist {
  return new LLMist({
    adapters: [new MockProviderAdapter(options)],
    autoDiscoverProviders: false,
    defaultProvider: "mock",
  });
}
