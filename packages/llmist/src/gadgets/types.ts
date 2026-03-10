/**
 * Gadget types barrel re-export.
 *
 * All gadget-related types are split into focused single-responsibility modules.
 * This file re-exports everything for backward compatibility — existing imports
 * from `"./gadgets/types.js"` continue to work unchanged.
 *
 * Type modules:
 * - `./media-types`           — MediaKind, MediaMetadata, GadgetMediaOutput, StoredMedia, GadgetExample
 * - `./execution-result-types` — GadgetExecutionResult, GadgetExecuteResult, GadgetExecuteReturn, ParsedGadgetCall
 * - `./stream-event-types`    — StreamEvent, StreamCompletionEvent, GadgetSkippedEvent
 * - `./text-only-types`       — TextOnlyHandler, TextOnlyStrategy, TextOnlyGadgetConfig, TextOnlyContext, TextOnlyAction
 * - `./execution-context-types` — ExecutionContext, CostReportingLLMist, HostExports
 * - `./subagent-config-types` — AgentContextConfig, SubagentConfig, SubagentConfigMap, GadgetExecutionMode
 *
 * @module
 */

export type {
  CostReportingImageNamespace,
  CostReportingLLMist,
  CostReportingSpeechNamespace,
  ExecutionContext,
  HostExports,
} from "./execution-context-types.js";

export type {
  GadgetExecuteResult,
  GadgetExecuteResultWithMedia,
  GadgetExecuteReturn,
  GadgetExecutionResult,
  ParsedGadgetCall,
} from "./execution-result-types.js";
export type {
  GadgetExample,
  GadgetMediaOutput,
  MediaKind,
  MediaMetadata,
  StoredMedia,
} from "./media-types.js";
export type {
  GadgetSkippedEvent,
  StreamCompletionEvent,
  StreamEvent,
} from "./stream-event-types.js";
export type {
  AgentContextConfig,
  GadgetExecutionMode,
  SubagentConfig,
  SubagentConfigMap,
} from "./subagent-config-types.js";
export type {
  TextOnlyAction,
  TextOnlyContext,
  TextOnlyCustomHandler,
  TextOnlyGadgetConfig,
  TextOnlyHandler,
  TextOnlyStrategy,
} from "./text-only-types.js";
