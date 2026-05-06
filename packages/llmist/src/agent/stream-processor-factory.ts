/**
 * StreamProcessorFactory: Encapsulates all configuration needed to construct StreamProcessor
 * instances, eliminating ~15 pass-through fields from the Agent class.
 *
 * ## Motivation
 *
 * Agent previously stored many fields that existed only to be forwarded to StreamProcessor
 * on each iteration. By extracting this construction logic into a dedicated factory, the
 * Agent's constructor and field count are significantly reduced.
 *
 * ## Design
 *
 * - Holds all static (per-agent) StreamProcessor configuration
 * - `create(iteration, llmNodeId, crossIterationState)` creates a StreamProcessor for one iteration
 * - Cross-iteration mutable state (completedInvocationIds, failedInvocationIds) is passed
 *   per-call rather than stored, keeping factory instances immutable
 * - Follows the LLMCallLifecycle extraction pattern
 *
 * @module agent/stream-processor-factory
 */

import type { ILogObj, Logger } from "tslog";
import type { LLMist } from "../core/client.js";
import type { ExecutionTree, NodeId } from "../core/execution-tree.js";
import type { RateLimitTracker } from "../core/rate-limit.js";
import type { ResolvedRetryConfig } from "../core/retry.js";
import type { MediaStore } from "../gadgets/media-store.js";
import type { GadgetRegistry } from "../gadgets/registry.js";
import type {
  AgentContextConfig,
  GadgetExecutionMode,
  SubagentConfigMap,
} from "../gadgets/types.js";
import type { PrefixConfig } from "./agent.js";
import type { AgentHooks, Observers } from "./hooks.js";
import { StreamProcessor } from "./stream-processor.js";

// ============================================================================
// Constructor options
// ============================================================================

/**
 * Options for constructing a StreamProcessorFactory.
 *
 * These are all static (per-agent-lifetime) configuration values that do not
 * change between iterations. Cross-iteration mutable state is passed to `create()`.
 */
export interface StreamProcessorFactoryOptions {
  /** Gadget registry for execution */
  registry: GadgetRegistry;

  /** Custom gadget block format prefixes */
  prefixConfig?: PrefixConfig;

  /** Agent hooks (observers, interceptors, controllers) */
  hooks: AgentHooks;

  /** Logger instance (factory creates a sub-logger for each processor) */
  logger: Logger<ILogObj>;

  /** Callback for requesting human input during execution */
  requestHumanInput?: (question: string) => Promise<string>;

  /** Default gadget timeout in milliseconds */
  defaultGadgetTimeoutMs?: number;

  /** Maximum time (ms) to wait for in-flight gadgets to complete. Default: 300s. */
  inFlightTimeoutMs?: number;

  /** Gadget execution mode: 'parallel' (default) or 'sequential' */
  gadgetExecutionMode: GadgetExecutionMode;

  /** LLMist client for gadget execution contexts */
  client: LLMist;

  /** MediaStore for storing gadget media outputs */
  mediaStore: MediaStore;

  /** Parent agent configuration for subagents to inherit */
  agentContextConfig: AgentContextConfig;

  /** Subagent-specific configuration overrides */
  subagentConfig?: SubagentConfigMap;

  /** Execution tree for tracking LLM calls and gadget executions */
  tree: ExecutionTree;

  /** Base depth for nodes created by this agent's processors */
  baseDepth: number;

  /** Parent agent's observer hooks for subagent visibility */
  parentObservers?: Observers;

  /** Shared rate limit tracker for coordinated throttling across subagents */
  rateLimitTracker?: RateLimitTracker;

  /** Shared retry config for consistent backoff behavior across subagents */
  retryConfig: ResolvedRetryConfig;

  /** Maximum gadgets to execute per LLM response (0 = unlimited) */
  maxGadgetsPerResponse: number;
}

/**
 * Cross-iteration mutable state passed to `create()` on each invocation.
 * These values change between iterations and cannot be stored on the factory.
 */
export interface StreamProcessorCrossIterationState {
  /** Invocation IDs that completed successfully in prior iterations */
  priorCompletedInvocations: Set<string>;

  /** Invocation IDs that failed in prior iterations */
  priorFailedInvocations: Set<string>;
}

// ============================================================================
// StreamProcessorFactory
// ============================================================================

/**
 * StreamProcessorFactory: Stateless factory for constructing StreamProcessor instances.
 *
 * Holds all static per-agent StreamProcessor configuration and constructs a new
 * StreamProcessor for each agent iteration via `create()`.
 *
 * @example
 * ```typescript
 * const factory = new StreamProcessorFactory({
 *   registry, hooks, logger, client, mediaStore, ...
 * });
 *
 * // In agent loop:
 * const processor = factory.create(iteration, llmNodeId, {
 *   priorCompletedInvocations: this.completedInvocationIds,
 *   priorFailedInvocations: this.failedInvocationIds,
 * });
 * ```
 */
export class StreamProcessorFactory {
  private readonly registry: GadgetRegistry;
  private readonly prefixConfig?: PrefixConfig;
  private readonly hooks: AgentHooks;
  private readonly logger: Logger<ILogObj>;
  private readonly requestHumanInput?: (question: string) => Promise<string>;
  private readonly defaultGadgetTimeoutMs?: number;
  private readonly inFlightTimeoutMs?: number;
  private readonly gadgetExecutionMode: GadgetExecutionMode;
  private readonly client: LLMist;
  private readonly mediaStore: MediaStore;
  private readonly agentContextConfig: AgentContextConfig;
  private readonly subagentConfig?: SubagentConfigMap;
  private readonly tree: ExecutionTree;
  private readonly baseDepth: number;
  private readonly parentObservers?: Observers;
  private readonly rateLimitTracker?: RateLimitTracker;
  private readonly retryConfig: ResolvedRetryConfig;
  private readonly maxGadgetsPerResponse: number;

  constructor(options: StreamProcessorFactoryOptions) {
    this.registry = options.registry;
    this.prefixConfig = options.prefixConfig;
    this.hooks = options.hooks;
    this.logger = options.logger;
    this.requestHumanInput = options.requestHumanInput;
    this.defaultGadgetTimeoutMs = options.defaultGadgetTimeoutMs;
    this.inFlightTimeoutMs = options.inFlightTimeoutMs;
    this.gadgetExecutionMode = options.gadgetExecutionMode;
    this.client = options.client;
    this.mediaStore = options.mediaStore;
    this.agentContextConfig = options.agentContextConfig;
    this.subagentConfig = options.subagentConfig;
    this.tree = options.tree;
    this.baseDepth = options.baseDepth;
    this.parentObservers = options.parentObservers;
    this.rateLimitTracker = options.rateLimitTracker;
    this.retryConfig = options.retryConfig;
    this.maxGadgetsPerResponse = options.maxGadgetsPerResponse;
  }

  /**
   * Construct a StreamProcessor configured for a single agent iteration.
   *
   * @param iteration - Current iteration number
   * @param llmNodeId - The LLM call node ID (gadgets are children of this node)
   * @param crossIterationState - Mutable dependency-tracking sets from the agent loop
   * @returns A fully configured StreamProcessor ready to process an LLM stream
   */
  create(
    iteration: number,
    llmNodeId: NodeId,
    crossIterationState: StreamProcessorCrossIterationState,
  ): StreamProcessor {
    return new StreamProcessor({
      iteration,
      registry: this.registry,
      gadgetStartPrefix: this.prefixConfig?.gadgetStartPrefix,
      gadgetEndPrefix: this.prefixConfig?.gadgetEndPrefix,
      gadgetArgPrefix: this.prefixConfig?.gadgetArgPrefix,
      hooks: this.hooks,
      logger: this.logger.getSubLogger({ name: "stream-processor" }),
      requestHumanInput: this.requestHumanInput,
      defaultGadgetTimeoutMs: this.defaultGadgetTimeoutMs,
      inFlightTimeoutMs: this.inFlightTimeoutMs,
      gadgetExecutionMode: this.gadgetExecutionMode,
      client: this.client,
      mediaStore: this.mediaStore,
      agentConfig: this.agentContextConfig,
      subagentConfig: this.subagentConfig,
      // Tree context for execution tracking
      tree: this.tree,
      parentNodeId: llmNodeId, // Gadgets are children of this LLM call
      baseDepth: this.baseDepth,
      // Cross-iteration dependency tracking
      priorCompletedInvocations: crossIterationState.priorCompletedInvocations,
      priorFailedInvocations: crossIterationState.priorFailedInvocations,
      // Parent observer hooks for subagent visibility
      parentObservers: this.parentObservers,
      // Shared rate limit tracker and retry config for subagents
      rateLimitTracker: this.rateLimitTracker,
      retryConfig: this.retryConfig,
      // Gadget limiting
      maxGadgetsPerResponse: this.maxGadgetsPerResponse,
    });
  }
}
