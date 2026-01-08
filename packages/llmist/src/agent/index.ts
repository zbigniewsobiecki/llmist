/**
 * Agent module - Composable, single-responsibility architecture for LLM agents.
 * This module provides a cleaner alternative to the monolithic AgentLoop.
 */

export type { AgentOptions } from "./agent.js";
// Context compaction
export {
  type CompactionConfig,
  type CompactionContext,
  type CompactionEvent,
  CompactionManager,
  type CompactionResult,
  type CompactionStats,
  type CompactionStrategy,
  DEFAULT_COMPACTION_CONFIG,
  DEFAULT_SUMMARIZATION_PROMPT,
  HybridStrategy,
  type MessageTurn,
  type ResolvedCompactionConfig,
  SlidingWindowStrategy,
  SummarizationStrategy,
} from "./compaction/index.js";
export { ConversationManager } from "./conversation-manager.js";
// Gadget output limiting
export type { StoredOutput } from "./gadget-output-store.js";
export { GadgetOutputStore } from "./gadget-output-store.js";
// LLM Assistance Hints
export {
  createHints,
  type HintsConfig,
  type IterationHintOptions,
  iterationProgressHint,
  type ParallelGadgetHintOptions,
  parallelGadgetHint,
} from "./hints.js";
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
  ObserveCompactionContext,
  ObserveGadgetCompleteContext,
  // Gadget skip observer
  ObserveGadgetSkippedContext,
  ObserveGadgetStartContext,
  // Observer contexts
  ObserveLLMCallContext,
  ObserveLLMCompleteContext,
  ObserveLLMErrorContext,
  ObserveRateLimitThrottleContext,
  ObserveRetryAttemptContext,
  Observers,
  // Subagent context for distinguishing subagent events in hooks
  SubagentContext,
} from "./hooks.js";
export type { IConversationManager } from "./interfaces.js";
// StreamProcessor for advanced use cases
export {
  type StreamProcessingResult,
  StreamProcessor,
  type StreamProcessorOptions,
} from "./stream-processor.js";
