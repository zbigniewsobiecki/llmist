import type { ILogObj, Logger } from "tslog";
import type { LLMist } from "../core/client.js";
import type { ExecutionTree, NodeId } from "../core/execution-tree.js";
import type { ContentPart } from "../core/input-content.js";
import type { MessageContent } from "../core/messages.js";
import type { CachingConfig, ReasoningConfig } from "../core/options.js";
import type { PromptTemplateConfig } from "../core/prompt-config.js";
import type { RateLimitConfig, RateLimitTracker } from "../core/rate-limit.js";
import type { ResolvedRetryConfig, RetryConfig } from "../core/retry.js";
import type { GadgetOrClass } from "../gadgets/registry.js";
import type { GadgetExecutionMode, SubagentConfigMap, TextOnlyHandler } from "../gadgets/types.js";
import type { CompactionConfig } from "./compaction/config.js";
import type { TrailingMessage } from "./hook-composer.js";
import type { AgentHooks, Observers } from "./hooks.js";

/**
 * Message for conversation history.
 * User messages can be text (string) or multimodal (ContentPart[]).
 */
export type HistoryMessage =
  | { user: string | ContentPart[] }
  | { assistant: string }
  | { system: string };

export interface CoreState {
  client?: LLMist;
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxIterations?: number;
  budget?: number;
  logger?: Logger<ILogObj>;
  hooks?: AgentHooks;
  promptConfig?: PromptTemplateConfig;
  initialMessages: Array<{
    role: "system" | "user" | "assistant";
    content: MessageContent;
  }>;
  requestHumanInput?: (question: string) => Promise<string>;
  signal?: AbortSignal;
  trailingMessage?: TrailingMessage;
  reasoningConfig?: ReasoningConfig;
  cachingConfig?: CachingConfig;
}

export interface GadgetState {
  gadgets: GadgetOrClass[];
  gadgetStartPrefix?: string;
  gadgetEndPrefix?: string;
  gadgetArgPrefix?: string;
  textOnlyHandler?: TextOnlyHandler;
  textWithGadgetsHandler?: {
    gadgetName: string;
    parameterMapping: (text: string) => Record<string, unknown>;
    resultMapping?: (text: string) => string;
  };
  defaultGadgetTimeoutMs?: number;
  gadgetExecutionMode?: GadgetExecutionMode;
  maxGadgetsPerResponse?: number;
  gadgetOutputLimit?: boolean;
  gadgetOutputLimitPercent?: number;
}

export interface RetryState {
  retryConfig?: RetryConfig;
  // Shared retry config from parent for consistent backoff behavior
  // When a gadget calls withParentContext(ctx), this config is shared
  sharedRetryConfig?: ResolvedRetryConfig;
}

export interface SubagentState {
  subagentConfig?: SubagentConfigMap;
  // Tree context for subagent support - enables shared tree model
  // When a gadget calls withParentContext(ctx), it shares the parent's tree
  parentContext?: {
    depth: number;
    tree?: ExecutionTree;
    nodeId?: NodeId;
  };
  // Parent observer hooks for subagent visibility
  // When a gadget calls withParentContext(ctx), these observers are
  // also called for gadget events in the subagent
  parentObservers?: Observers;
  // Shared rate limit tracker from parent for coordinated throttling
  // When a gadget calls withParentContext(ctx), this tracker is shared
  // so all agents in the tree respect aggregate RPM/TPM limits
  sharedRateLimitTracker?: RateLimitTracker;
  rateLimitConfig?: RateLimitConfig;
}

export interface PolicyState {
  compactionConfig?: CompactionConfig;
}
