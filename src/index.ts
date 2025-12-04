// Re-export Zod's z for schema definitions
// Using llmist's z ensures .describe() metadata is preserved in JSON schemas
export { z } from "zod";
// Syntactic sugar: Agent builder and event handlers
export type { HistoryMessage, TrailingMessage, TrailingMessageContext } from "./agent/builder.js";
export { AgentBuilder } from "./agent/builder.js";
export type { EventHandlers } from "./agent/event-handlers.js";
export { collectEvents, collectText, runWithHandlers } from "./agent/event-handlers.js";
// Syntactic sugar: Hook presets
export type { LoggingOptions } from "./agent/hook-presets.js";
export { HookPresets } from "./agent/hook-presets.js";
// Agent infrastructure
// New clean hooks system
export type {
  AfterGadgetExecutionAction,
  AfterGadgetExecutionControllerContext,
  AfterLLMCallAction,
  AfterLLMCallControllerContext,
  AfterLLMErrorAction,
  AgentHooks,
  AgentOptions,
  BeforeGadgetExecutionAction,
  BeforeLLMCallAction,
  // Interceptor contexts
  ChunkInterceptorContext,
  Controllers,
  GadgetExecutionControllerContext,
  GadgetParameterInterceptorContext,
  GadgetResultInterceptorContext,
  // LLM Assistance Hints
  HintsConfig,
  IConversationManager,
  Interceptors,
  IterationHintOptions,
  // Controller contexts and actions
  LLMCallControllerContext,
  LLMErrorControllerContext,
  MessageInterceptorContext,
  ObserveChunkContext,
  ObserveGadgetCompleteContext,
  ObserveGadgetStartContext,
  // Observer contexts
  ObserveLLMCallContext,
  ObserveLLMCompleteContext,
  ObserveLLMErrorContext,
  Observers,
  ParallelGadgetHintOptions,
  StreamProcessingResult,
  StreamProcessorOptions,
  // Gadget output limiting
  StoredOutput,
  // Context compaction
  CompactionConfig,
  CompactionContext,
  CompactionEvent,
  CompactionResult,
  CompactionStats,
  CompactionStrategy,
  MessageTurn,
  ObserveCompactionContext,
  ResolvedCompactionConfig,
} from "./agent/index.js";
export {
  // Existing exports
  ConversationManager,
  GadgetOutputStore,
  StreamProcessor,
  // Compaction exports
  CompactionManager,
  DEFAULT_COMPACTION_CONFIG,
  DEFAULT_SUMMARIZATION_PROMPT,
  HybridStrategy,
  SlidingWindowStrategy,
  SummarizationStrategy,
  // LLM Assistance Hints
  createHints,
  iterationProgressHint,
  parallelGadgetHint,
} from "./agent/index.js";
export type { LLMistOptions } from "./core/client.js";
export { LLMist } from "./core/client.js";
export type { LLMMessage, LLMRole } from "./core/messages.js";
export { LLMMessageBuilder } from "./core/messages.js";
// Model catalog
export type {
  CostEstimate,
  ModelFeatures,
  ModelLimits,
  ModelPricing,
  ModelSpec,
} from "./core/model-catalog.js";
export { ModelRegistry } from "./core/model-registry.js";

// Syntactic sugar: Model shortcuts and quick methods
export {
  getModelId,
  getProvider,
  hasProviderPrefix,
  MODEL_ALIASES,
  resolveModel,
} from "./core/model-shortcuts.js";
export type {
  LLMGenerationOptions,
  LLMStream,
  LLMStreamChunk,
  ModelDescriptor,
  ProviderIdentifier,
  TokenUsage,
} from "./core/options.js";
export { ModelIdentifierParser } from "./core/options.js";
export type {
  HintContext,
  HintTemplate,
  PromptConfig,
  PromptContext,
  PromptTemplate,
} from "./core/prompt-config.js";
export {
  DEFAULT_HINTS,
  DEFAULT_PROMPTS,
  resolveHintTemplate,
  resolvePromptTemplate,
  resolveRulesTemplate,
} from "./core/prompt-config.js";
export type { QuickOptions } from "./core/quick-methods.js";
export { complete, stream } from "./core/quick-methods.js";
export type { CreateGadgetConfig } from "./gadgets/create-gadget.js";
export { createGadget } from "./gadgets/create-gadget.js";
// Gadget output viewer (for custom output store integration)
export { createGadgetOutputViewer } from "./gadgets/output-viewer.js";
// Gadget infrastructure
export { BreakLoopException, HumanInputException } from "./gadgets/exceptions.js";
export { GadgetExecutor } from "./gadgets/executor.js";
export { BaseGadget } from "./gadgets/gadget.js";
export { StreamParser } from "./gadgets/parser.js";
export type { GadgetClass, GadgetOrClass } from "./gadgets/registry.js";
export { GadgetRegistry } from "./gadgets/registry.js";

// Syntactic sugar: Typed gadgets and helpers
export type { GadgetConfig } from "./gadgets/typed-gadget.js";
export { Gadget } from "./gadgets/typed-gadget.js";
export type {
  GadgetExample,
  GadgetExecuteResult,
  GadgetExecuteReturn,
  GadgetExecutionResult,
  ParsedGadgetCall,
  StreamEvent,
  TextOnlyAction,
  TextOnlyContext,
  TextOnlyCustomHandler,
  TextOnlyGadgetConfig,
  TextOnlyHandler,
  TextOnlyStrategy,
} from "./gadgets/types.js";
export type { ValidationIssue, ValidationResult } from "./gadgets/validation.js";
export { validateAndApplyDefaults, validateGadgetParams } from "./gadgets/validation.js";
export type { LoggerOptions } from "./logging/logger.js";
export { createLogger, defaultLogger } from "./logging/logger.js";
export {
  AnthropicMessagesProvider,
  createAnthropicProviderFromEnv,
} from "./providers/anthropic.js";
export { discoverProviderAdapters } from "./providers/discovery.js";
export { createGeminiProviderFromEnv, GeminiGenerativeProvider } from "./providers/gemini.js";
export { createOpenAIProviderFromEnv, OpenAIChatProvider } from "./providers/openai.js";
export type { ProviderAdapter } from "./providers/provider.js";

// Testing/Mock infrastructure
export type {
  MockMatcher,
  MockMatcherContext,
  MockOptions,
  MockRegistration,
  MockResponse,
  MockStats,
} from "./testing/index.js";
export {
  createMockAdapter,
  createMockClient,
  createMockStream,
  createTextMockStream,
  getMockManager,
  MockBuilder,
  MockManager,
  MockProviderAdapter,
  mockLLM,
} from "./testing/index.js";
