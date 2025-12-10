/**
 * Agent module - Composable, single-responsibility architecture for LLM agents.
 * This module provides a cleaner alternative to the monolithic AgentLoop.
 */

export type { AgentOptions } from "./agent.js";
export { ConversationManager } from "./conversation-manager.js";
// New clean hooks system
export type {
  AfterGadgetExecutionAction,
  AfterGadgetExecutionControllerContext,
  AfterLLMCallAction,
  AfterLLMCallControllerContext,
  AfterLLMErrorAction,
  AgentHooks,
  BeforeGadgetExecutionAction,
  BeforeLLMCallAction,
  // Interceptor contexts
  ChunkInterceptorContext,
  Controllers,
  // Dependency skip controller
  DependencySkipAction,
  DependencySkipControllerContext,
  GadgetExecutionControllerContext,
  GadgetParameterInterceptorContext,
  GadgetResultInterceptorContext,
  Interceptors,
  // Controller contexts and actions
  LLMCallControllerContext,
  LLMErrorControllerContext,
  MessageInterceptorContext,
  ObserveChunkContext,
  ObserveGadgetCompleteContext,
  // Gadget skip observer
  ObserveGadgetSkippedContext,
  ObserveGadgetStartContext,
  // Observer contexts
  ObserveLLMCallContext,
  ObserveLLMCompleteContext,
  ObserveLLMErrorContext,
  Observers,
} from "./hooks.js";
export type { IConversationManager } from "./interfaces.js";

// StreamProcessor for advanced use cases
export {
  type StreamProcessingResult,
  StreamProcessor,
  type StreamProcessorOptions,
} from "./stream-processor.js";

// Gadget output limiting
export type { StoredOutput } from "./gadget-output-store.js";
export { GadgetOutputStore } from "./gadget-output-store.js";

// Context compaction
export {
  type CompactionConfig,
  type CompactionEvent,
  type CompactionStats,
  type ResolvedCompactionConfig,
  DEFAULT_COMPACTION_CONFIG,
  DEFAULT_SUMMARIZATION_PROMPT,
} from "./compaction/index.js";

export {
  type CompactionContext,
  type CompactionResult,
  type CompactionStrategy,
  type MessageTurn,
  CompactionManager,
  HybridStrategy,
  SlidingWindowStrategy,
  SummarizationStrategy,
} from "./compaction/index.js";

export type { ObserveCompactionContext } from "./hooks.js";

// LLM Assistance Hints
export {
  createHints,
  iterationProgressHint,
  parallelGadgetHint,
  type HintsConfig,
  type IterationHintOptions,
  type ParallelGadgetHintOptions,
} from "./hints.js";
