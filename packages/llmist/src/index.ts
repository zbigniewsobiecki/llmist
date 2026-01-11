// Re-export Zod's z for schema definitions
// Using llmist's z ensures .describe() metadata is preserved in JSON schemas
export { z } from "zod";
// Agent class (for type references)
export { Agent } from "./agent/agent.js";
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
  // Context compaction
  CompactionConfig,
  CompactionContext,
  CompactionEvent,
  CompactionResult,
  CompactionStats,
  CompactionStrategy,
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
  MessageTurn,
  ObserveChunkContext,
  ObserveCompactionContext,
  ObserveGadgetCompleteContext,
  ObserveGadgetStartContext,
  // Observer contexts
  ObserveLLMCallContext,
  ObserveLLMCompleteContext,
  ObserveLLMErrorContext,
  ObserveRateLimitThrottleContext,
  ObserveRetryAttemptContext,
  Observers,
  ParallelGadgetHintOptions,
  ResolvedCompactionConfig,
  // Gadget output limiting
  StoredOutput,
  StreamProcessingResult,
  StreamProcessorOptions,
  // Subagent context for hook observers
  SubagentContext,
} from "./agent/index.js";
export {
  // Compaction exports
  CompactionManager,
  // Existing exports
  ConversationManager,
  // LLM Assistance Hints
  createHints,
  DEFAULT_COMPACTION_CONFIG,
  DEFAULT_SUMMARIZATION_PROMPT,
  GadgetOutputStore,
  HybridStrategy,
  iterationProgressHint,
  parallelGadgetHint,
  SlidingWindowStrategy,
  StreamProcessor,
  SummarizationStrategy,
} from "./agent/index.js";
export type { LLMistOptions } from "./core/client.js";
export { LLMist } from "./core/client.js";
// Constants for gadget block format parsing
export {
  GADGET_ARG_PREFIX,
  GADGET_END_PREFIX,
  GADGET_START_PREFIX,
} from "./core/constants.js";
// Error utilities
export { isAbortError } from "./core/errors.js";
// Unified execution events with tree context
export type {
  BaseExecutionEvent,
  CompactionEvent as TreeCompactionEvent,
  ExecutionEvent,
  ExecutionEventType,
  GadgetCallEvent,
  GadgetCompleteEvent,
  GadgetErrorEvent,
  GadgetEvent,
  GadgetSkippedEvent as TreeGadgetSkippedEvent,
  GadgetStartEvent,
  HumanInputRequiredEvent,
  LLMCallCompleteEvent,
  LLMCallErrorEvent,
  LLMCallStartEvent,
  LLMCallStreamEvent,
  LLMEvent,
  StreamCompleteEvent,
  TextEvent,
} from "./core/execution-events.js";
export {
  filterByDepth,
  filterByParent,
  filterRootEvents,
  groupByParent,
  isGadgetEvent,
  isLLMEvent,
  isRootEvent,
  isSubagentEvent,
} from "./core/execution-events.js";
// Execution Tree - first-class model for nested subagent support
export type {
  AddGadgetParams,
  AddLLMCallParams,
  CompleteGadgetParams,
  CompleteLLMCallParams,
  ExecutionNode,
  ExecutionNodeType,
  GadgetNode,
  GadgetState,
  LLMCallNode,
  NodeId,
} from "./core/execution-tree.js";
export { ExecutionTree } from "./core/execution-tree.js";
// Input content types for multimodal messages
export type {
  AudioContentPart,
  AudioMimeType,
  AudioSource,
  ContentPart,
  ImageBase64Source,
  ImageContentPart,
  ImageMimeType,
  ImageSource,
  ImageUrlSource,
  TextContentPart,
} from "./core/input-content.js";
export {
  audioFromBase64,
  audioFromBuffer,
  detectAudioMimeType,
  detectImageMimeType,
  imageFromBase64,
  imageFromBuffer,
  imageFromUrl,
  isAudioPart,
  isDataUrl,
  isImagePart,
  isTextPart,
  parseDataUrl,
  text,
  toBase64,
} from "./core/input-content.js";
// Media generation types (image, speech)
export type {
  ImageGenerationOptions,
  ImageGenerationResult,
  ImageModelSpec,
  SpeechGenerationOptions,
  SpeechGenerationResult,
  SpeechModelSpec,
} from "./core/media-types.js";
export type { LLMMessage, MessageContent, MessageRole } from "./core/messages.js";
export { extractMessageText, LLMMessageBuilder, normalizeMessageContent } from "./core/messages.js";
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
// Vision namespace for one-shot image analysis
export type { VisionAnalyzeOptions, VisionAnalyzeResult } from "./core/namespaces/vision.js";
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
  PromptContext,
  PromptTemplate,
  PromptTemplateConfig,
} from "./core/prompt-config.js";
export {
  DEFAULT_HINTS,
  DEFAULT_PROMPTS,
  resolveHintTemplate,
  resolvePromptTemplate,
  resolveRulesTemplate,
} from "./core/prompt-config.js";
export type { TextGenerationOptions } from "./core/quick-methods.js";
export { complete, stream } from "./core/quick-methods.js";
// Rate limit configuration for proactive throttling
export type {
  RateLimitConfig,
  RateLimitStats,
  ResolvedRateLimitConfig,
  TriggeredLimitInfo,
} from "./core/rate-limit.js";
export {
  DEFAULT_RATE_LIMIT_CONFIG,
  RateLimitTracker,
  resolveRateLimitConfig,
} from "./core/rate-limit.js";
// Retry configuration for LLM API calls
export type {
  FormatLLMErrorContext,
  ResolvedRetryConfig,
  RetryConfig,
} from "./core/retry.js";
export {
  DEFAULT_RETRY_CONFIG,
  extractRetryAfterMs,
  formatLLMError,
  isRetryableError,
  parseRetryAfterHeader,
  resolveRetryConfig,
} from "./core/retry.js";
export type { CreateGadgetConfig } from "./gadgets/create-gadget.js";
export { createGadget } from "./gadgets/create-gadget.js";
// Gadget infrastructure
export {
  AbortException,
  HumanInputRequiredException,
  TaskCompletionSignal,
  TimeoutException,
} from "./gadgets/exceptions.js";
export { GadgetExecutor } from "./gadgets/executor.js";
export { AbstractGadget } from "./gadgets/gadget.js";
// Response and media output helpers for gadgets
export {
  // Media output
  createMediaOutput,
  // Response formatting
  gadgetError,
  gadgetSuccess,
  getErrorMessage,
  resultWithAudio,
  resultWithFile,
  resultWithImage,
  resultWithImages,
  resultWithMedia,
  withErrorHandling,
} from "./gadgets/helpers.js";
// Gadget output viewer (for custom output store integration)
export { createGadgetOutputViewer } from "./gadgets/output-viewer.js";
export { GadgetCallParser } from "./gadgets/parser.js";
export type { GadgetClass, GadgetOrClass } from "./gadgets/registry.js";
export { GadgetRegistry } from "./gadgets/registry.js";

// Syntactic sugar: Typed gadgets and helpers
export type { GadgetConfig } from "./gadgets/typed-gadget.js";
export { Gadget } from "./gadgets/typed-gadget.js";
export type {
  CostReportingLLMist,
  ExecutionContext,
  GadgetExample,
  GadgetExecuteResult,
  GadgetExecuteResultWithMedia,
  GadgetExecuteReturn,
  GadgetExecutionResult,
  GadgetMediaOutput,
  GadgetSkippedEvent,
  // Host exports for external gadgets
  HostExports,
  MediaKind,
  MediaMetadata,
  ParsedGadgetCall,
  StoredMedia,
  StreamEvent,
  // Subagent config types
  SubagentConfig,
  SubagentConfigMap,
  TextOnlyAction,
  TextOnlyContext,
  TextOnlyCustomHandler,
  TextOnlyGadgetConfig,
  TextOnlyHandler,
  TextOnlyStrategy,
} from "./gadgets/types.js";
// Provider constants (for token estimation)
export { FALLBACK_CHARS_PER_TOKEN } from "./providers/constants.js";

// Host exports helper for external gadgets
import type { ExecutionContext, HostExports } from "./gadgets/types.js";

/**
 * Get host llmist exports from execution context.
 *
 * External gadgets MUST use this instead of importing classes directly from 'llmist'
 * to ensure they use the same version as the host CLI, enabling proper tree sharing
 * and avoiding the "dual-package problem".
 *
 * @param ctx - The execution context passed to gadget.execute()
 * @returns The host's llmist exports (AgentBuilder, Gadget, etc.)
 * @throws Error if ctx or ctx.hostExports is undefined
 *
 * @example
 * ```typescript
 * import { getHostExports, Gadget, z } from 'llmist';
 * import type { ExecutionContext } from 'llmist';
 *
 * class BrowseWeb extends Gadget({
 *   name: 'BrowseWeb',
 *   description: 'Browse a website autonomously',
 *   schema: z.object({ task: z.string(), url: z.string() }),
 * }) {
 *   async execute(params: this['params'], ctx?: ExecutionContext) {
 *     // Get host's AgentBuilder to ensure tree sharing works correctly
 *     const { AgentBuilder } = getHostExports(ctx!);
 *
 *     const agent = new AgentBuilder()
 *       .withParentContext(ctx!)
 *       .withGadgets(Navigate, Click, Screenshot)
 *       .ask(params.task);
 *
 *     for await (const event of agent.run()) {
 *       // Events flow through host's shared tree
 *     }
 *   }
 * }
 * ```
 */
export function getHostExports(ctx: ExecutionContext): HostExports {
  if (!ctx?.hostExports) {
    throw new Error(
      "hostExports not available. Gadgets that create subagents must be run " +
        "via llmist agent, not standalone. Ensure you are using llmist >= 6.2.0.",
    );
  }
  return ctx.hostExports;
}
// Re-export Logger type for external gadgets that need to type ctx.logger
export type { ILogObj, Logger } from "tslog";
// ============================================================================
// Subagent Helpers
// ============================================================================
export type { SubagentOptions } from "./agent/subagent.js";
export { createSubagent, hasHostExports } from "./agent/subagent.js";
// Media storage for gadget outputs
export { MediaStore } from "./gadgets/media-store.js";
// Schema utilities
export { schemaToJSONSchema } from "./gadgets/schema-to-json.js";
export { validateGadgetSchema } from "./gadgets/schema-validator.js";
export type { ValidationIssue, ValidationResult } from "./gadgets/validation.js";
export { validateAndApplyDefaults, validateGadgetParams } from "./gadgets/validation.js";
export type { LoggerOptions } from "./logging/logger.js";
export { createLogger, defaultLogger } from "./logging/logger.js";
// ============================================================================
// Package Manifest Types
// ============================================================================
export type {
  GadgetFactoryExports,
  LLMistPackageManifest,
  PresetDefinition,
  SessionManifestEntry,
  SubagentManifestEntry,
} from "./package/index.js";
export {
  getPresetGadgets,
  getSubagent,
  hasPreset,
  hasSubagents,
  listPresets,
  listSubagents,
  parseManifest,
} from "./package/index.js";
export {
  AnthropicMessagesProvider,
  createAnthropicProviderFromEnv,
} from "./providers/anthropic.js";
export { discoverProviderAdapters } from "./providers/discovery.js";
export { createGeminiProviderFromEnv, GeminiGenerativeProvider } from "./providers/gemini.js";
export {
  createHuggingFaceProviderFromEnv,
  HuggingFaceProvider,
} from "./providers/huggingface.js";
export { createOpenAIProviderFromEnv, OpenAIChatProvider } from "./providers/openai.js";
// OpenAI-compatible base class for meta-providers (HuggingFace, OpenRouter, etc.)
export type { OpenAICompatibleConfig } from "./providers/openai-compatible-provider.js";
export { OpenAICompatibleProvider } from "./providers/openai-compatible-provider.js";
// OpenRouter meta-provider (400+ models via unified gateway)
export type { OpenRouterConfig, OpenRouterRouting } from "./providers/openrouter.js";
export {
  createOpenRouterProviderFromEnv,
  OpenRouterProvider,
} from "./providers/openrouter.js";
export type { ProviderAdapter } from "./providers/provider.js";
// ============================================================================
// Session Management
// ============================================================================
export type { ISessionManager } from "./session/index.js";
export { BaseSessionManager, SimpleSessionManager } from "./session/index.js";
// Utility functions for subagent gadgets
export type { ResolveValueOptions } from "./utils/config-resolver.js";
export {
  resolveConfig,
  resolveSubagentModel,
  resolveSubagentTimeout,
  resolveValue,
} from "./utils/config-resolver.js";
// ============================================================================
// Formatting Utilities
// ============================================================================
export {
  format,
  formatBytes,
  formatDate,
  formatDuration,
  truncate,
} from "./utils/format.js";
// ============================================================================
// Timing Utilities
// ============================================================================
export type { RetryOptions } from "./utils/timing.js";
export {
  humanDelay,
  randomDelay,
  timing,
  withRetry,
  withTimeout,
} from "./utils/timing.js";
