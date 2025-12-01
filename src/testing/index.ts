/**
 * Mock testing utilities for llmist.
 * Provides a comprehensive system for testing applications without making real LLM API calls.
 *
 * @module testing
 *
 * @example
 * ```typescript
 * import { mockLLM, createMockClient, getMockManager } from 'llmist/testing';
 *
 * // Quick setup with fluent API
 * mockLLM()
 *   .forModel('gpt-5')
 *   .whenMessageContains('hello')
 *   .returns('Hello! How can I help?')
 *   .register();
 *
 * // Create a test client
 * const client = createMockClient();
 *
 * // Use normally in tests
 * const stream = client.stream({
 *   model: 'mock:gpt-5',
 *   messages: [{ role: 'user', content: 'hello' }]
 * });
 * ```
 */

// Gadget testing utilities
export {
  type TestGadgetOptions,
  type TestGadgetResult,
  testGadget,
  testGadgetBatch,
} from "./gadget-testing.js";
// Provider adapter
export { createMockAdapter, MockProviderAdapter } from "./mock-adapter.js";
// Fluent builder API
export { MockBuilder, mockLLM } from "./mock-builder.js";
// Mock client factory (separate file to avoid circular dependencies)
export { createMockClient } from "./mock-client.js";
// Mock gadget utilities
export {
  createMockGadget,
  type MockGadget,
  MockGadgetBuilder,
  type MockGadgetConfig,
  mockGadget,
  type RecordedCall,
} from "./mock-gadget.js";
// Core mock management
export { getMockManager, MockManager } from "./mock-manager.js";
// Stream utilities
export { createMockStream, createTextMockStream } from "./mock-stream.js";
// Types
export type {
  MockMatcher,
  MockMatcherContext,
  MockOptions,
  MockRegistration,
  MockResponse,
  MockStats,
} from "./mock-types.js";

// Stream helpers
export {
  collectStream,
  collectStreamText,
  createEmptyStream,
  createErrorStream,
  createTestStream,
  createTextStream,
  getStreamFinalChunk,
} from "./stream-helpers.js";

// Conversation fixtures
export {
  createAssistantMessage,
  createConversation,
  createConversationWithGadgets,
  createLargeConversation,
  createMinimalConversation,
  createSystemMessage,
  createUserMessage,
  estimateTokens,
} from "./conversation-fixtures.js";

// Mock conversation manager
export {
  createMockConversationManager,
  MockConversationManager,
} from "./mock-conversation.js";

// CLI helpers
export {
  collectOutput,
  createMockPrompt,
  createMockReadable,
  createMockWritable,
  createTestEnvironment,
  getBufferedOutput,
  MockPromptRecorder,
  type TestEnvironment,
  type TestEnvironmentOptions,
  waitFor,
} from "./cli-helpers.js";
