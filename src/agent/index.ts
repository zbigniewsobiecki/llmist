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
