/**
 * StreamProcessor: The heart of the new hooks architecture.
 *
 * Replaces the complex wiring between Agent, ResponseProcessor, and GadgetRuntime.
 * Owns ALL stream processing and hook coordination with a clean, predictable flow.
 */

import type { ILogObj, Logger } from "tslog";
import type { LLMist } from "../core/client.js";
import type { ExecutionTree, NodeId } from "../core/execution-tree.js";
import type { LLMStreamChunk, TokenUsage } from "../core/options.js";
import type { RateLimitTracker } from "../core/rate-limit.js";
import type { ResolvedRetryConfig } from "../core/retry.js";
import { GadgetExecutor } from "../gadgets/executor.js";
import type { MediaStore } from "../gadgets/media-store.js";
import { GadgetCallParser } from "../gadgets/parser.js";
import type { GadgetRegistry } from "../gadgets/registry.js";
import type {
  AgentContextConfig,
  GadgetExecutionMode,
  GadgetExecutionResult,
  GadgetSkippedEvent,
  ParsedGadgetCall,
  StreamCompletionEvent,
  StreamEvent,
  SubagentConfigMap,
} from "../gadgets/types.js";
import { createLogger } from "../logging/logger.js";
import {
  validateAfterGadgetExecutionAction,
  validateBeforeGadgetExecutionAction,
} from "./hook-validators.js";
import type {
  AfterGadgetExecutionAction,
  AfterGadgetExecutionControllerContext,
  AgentHooks,
  BeforeGadgetExecutionAction,
  ChunkInterceptorContext,
  DependencySkipAction,
  DependencySkipControllerContext,
  GadgetExecutionControllerContext,
  GadgetParameterInterceptorContext,
  GadgetResultInterceptorContext,
  MessageInterceptorContext,
  ObserveChunkContext,
  ObserveGadgetCompleteContext,
  ObserveGadgetSkippedContext,
  ObserveGadgetStartContext,
  Observers,
} from "./hooks.js";
import { getSubagentContextForNode } from "./tree-hook-bridge.js";
// NOTE: Gadget observer hooks (onGadgetExecutionStart, onGadgetExecutionComplete,
// onGadgetSkipped) are called DIRECTLY here (awaited) to ensure proper ordering.
// This guarantees that observer commands complete before gadget execution continues.

/**
 * Configuration for the StreamProcessor.
 */
export interface StreamProcessorOptions {
  /** Current iteration number */
  iteration: number;

  /** Gadget registry for execution */
  registry: GadgetRegistry;

  /** Custom gadget start prefix */
  gadgetStartPrefix?: string;

  /** Custom gadget end prefix */
  gadgetEndPrefix?: string;

  /** Custom argument prefix for block format */
  gadgetArgPrefix?: string;

  /** Hooks for lifecycle events */
  hooks?: AgentHooks;

  /** Logger instance */
  logger?: Logger<ILogObj>;

  /** Callback for requesting human input during execution */
  requestHumanInput?: (question: string) => Promise<string>;

  /** Default gadget timeout */
  defaultGadgetTimeoutMs?: number;

  /** Gadget execution mode ('parallel' | 'sequential') */
  gadgetExecutionMode?: GadgetExecutionMode;

  /** LLMist client for ExecutionContext.llmist */
  client?: LLMist;

  /** MediaStore for storing gadget media outputs */
  mediaStore?: MediaStore;

  /** Parent agent configuration for subagents to inherit */
  agentConfig?: AgentContextConfig;

  /** Subagent-specific configuration overrides */
  subagentConfig?: SubagentConfigMap;

  // ==========================================================================
  // Execution Tree Context (for tree-based tracking)
  // ==========================================================================

  /** Execution tree for tracking LLM calls and gadget executions */
  tree?: ExecutionTree;

  /** Parent node ID (for gadget nodes created by this processor) */
  parentNodeId?: NodeId | null;

  /** Base depth for nodes created by this processor */
  baseDepth?: number;

  // ==========================================================================
  // Cross-Iteration Dependency Resolution
  // ==========================================================================

  /**
   * Set of invocation IDs that completed in previous iterations.
   * Used to resolve dependencies on gadgets from prior LLM responses.
   */
  priorCompletedInvocations?: Set<string>;

  /**
   * Set of invocation IDs that failed in previous iterations.
   * Used to skip gadgets that depend on previously-failed gadgets.
   */
  priorFailedInvocations?: Set<string>;

  // ==========================================================================
  // Parent Observer Hooks (for subagent visibility)
  // ==========================================================================

  /**
   * Parent agent's observer hooks for subagent visibility.
   *
   * When a subagent is created with withParentContext(ctx), these observers
   * are also called for gadget events (in addition to the subagent's own hooks),
   * enabling the parent to observe subagent gadget activity.
   */
  parentObservers?: Observers;

  // ==========================================================================
  // Rate Limiting & Retry (shared across subagents)
  // ==========================================================================

  /** Shared rate limit tracker for coordinated throttling across subagents */
  rateLimitTracker?: RateLimitTracker;

  /** Shared retry config for consistent backoff behavior across subagents */
  retryConfig?: ResolvedRetryConfig;

  /** Maximum gadgets to execute per response (0 = unlimited) */
  maxGadgetsPerResponse?: number;
}

/**
 * Result of stream processing.
 */
export interface StreamProcessingResult {
  /** All emitted events */
  outputs: StreamEvent[];

  /** Whether the loop should break */
  shouldBreakLoop: boolean;

  /** Whether any gadgets were executed */
  didExecuteGadgets: boolean;

  /** LLM finish reason */
  finishReason: string | null;

  /** Token usage (including cached token counts when available) */
  usage?: TokenUsage;

  /** The raw accumulated response text */
  rawResponse: string;

  /** The final message (after interceptors) */
  finalMessage: string;
}

/**
 * StreamProcessor: Coordinates all stream processing and hook execution.
 *
 * Execution order:
 * 1. Raw chunk arrives from LLM
 * 2. Interceptor: interceptRawChunk (transform raw text)
 * 3. Observer: onStreamChunk (logging)
 * 4. Parse for gadgets
 * 5. If gadget found:
 *    a. Interceptor: interceptGadgetParameters (transform params)
 *    b. Controller: beforeGadgetExecution (can skip)
 *    c. Observer: onGadgetExecutionStart
 *    d. Execute gadget
 *    e. Interceptor: interceptGadgetResult (transform result)
 *    f. Controller: afterGadgetExecution (can provide fallback)
 *    g. Observer: onGadgetExecutionComplete
 * 6. If text chunk:
 *    a. Interceptor: interceptTextChunk (transform display text)
 *    b. Yield to user
 * 7. Stream complete
 * 8. Interceptor: interceptAssistantMessage (transform final message)
 */
export class StreamProcessor {
  private readonly iteration: number;
  private readonly registry: GadgetRegistry;
  private readonly hooks: AgentHooks;
  private readonly logger: Logger<ILogObj>;
  private readonly parser: GadgetCallParser;
  private readonly executor: GadgetExecutor;

  // Execution Tree context
  private readonly tree?: ExecutionTree;
  private readonly parentNodeId: NodeId | null;
  private readonly baseDepth: number;

  // Gadget execution mode
  private readonly gadgetExecutionMode: GadgetExecutionMode;

  private responseText = "";
  private observerFailureCount = 0;

  // Dependency tracking for gadget execution DAG
  /** Gadgets waiting for their dependencies to complete */
  private gadgetsAwaitingDependencies: Map<string, ParsedGadgetCall> = new Map();
  /** Completed gadget results, keyed by invocation ID */
  private completedResults: Map<string, GadgetExecutionResult> = new Map();
  /** Invocation IDs of gadgets that have failed (error or skipped due to dependency) */
  private failedInvocations: Set<string> = new Set();
  /** Promises for independent gadgets currently executing (fire-and-forget) */
  private inFlightExecutions: Map<string, Promise<void>> = new Map();
  /** Queue of completed gadget results ready to be yielded (for real-time streaming) */
  private completedResultsQueue: StreamEvent[] = [];

  // Concurrency limiting
  /** Subagent configuration map for checking maxConcurrent limits */
  private readonly subagentConfig?: SubagentConfigMap;
  /** Track active execution count per gadget name */
  private activeCountByGadget: Map<string, number> = new Map();
  /** Queue of gadgets waiting for a concurrency slot (per gadget name) */
  private concurrencyQueue: Map<string, ParsedGadgetCall[]> = new Map();

  // Cross-iteration dependency tracking
  /** Invocation IDs completed in previous iterations (read-only reference from Agent) */
  private readonly priorCompletedInvocations: Set<string>;
  /** Invocation IDs that failed in previous iterations (read-only reference from Agent) */
  private readonly priorFailedInvocations: Set<string>;

  // Parent observer hooks for subagent visibility
  private readonly parentObservers?: Observers;

  // Gadget limiting per response
  private readonly maxGadgetsPerResponse: number;
  private gadgetStartedCount: number = 0;
  private limitExceeded: boolean = false;

  constructor(options: StreamProcessorOptions) {
    this.iteration = options.iteration;
    this.registry = options.registry;
    this.hooks = options.hooks ?? {};
    this.logger = options.logger ?? createLogger({ name: "llmist:stream-processor" });

    // Initialize tree context
    this.tree = options.tree;
    this.parentNodeId = options.parentNodeId ?? null;
    this.baseDepth = options.baseDepth ?? 0;

    // Initialize gadget execution mode
    this.gadgetExecutionMode = options.gadgetExecutionMode ?? "parallel";

    // Initialize cross-iteration dependency tracking (use empty sets if not provided)
    this.priorCompletedInvocations = options.priorCompletedInvocations ?? new Set();
    this.priorFailedInvocations = options.priorFailedInvocations ?? new Set();

    // Store subagent config for concurrency limiting
    this.subagentConfig = options.subagentConfig;

    // Store parent observers for subagent visibility
    this.parentObservers = options.parentObservers;

    // Initialize gadget limiting (0 = unlimited)
    this.maxGadgetsPerResponse = options.maxGadgetsPerResponse ?? 0;

    this.parser = new GadgetCallParser({
      startPrefix: options.gadgetStartPrefix,
      endPrefix: options.gadgetEndPrefix,
      argPrefix: options.gadgetArgPrefix,
    });

    this.executor = new GadgetExecutor(
      options.registry,
      options.requestHumanInput,
      this.logger.getSubLogger({ name: "executor" }),
      options.defaultGadgetTimeoutMs,
      { argPrefix: options.gadgetArgPrefix },
      options.client,
      options.mediaStore,
      options.agentConfig,
      options.subagentConfig,
      // Tree context for gadget execution
      options.tree,
      options.parentNodeId,
      options.baseDepth,
      // Parent observer hooks for subagent visibility
      options.parentObservers,
      // Current agent's observers for subagent inheritance
      options.hooks?.observers,
      // Shared rate limit tracker for coordinated throttling across subagents
      options.rateLimitTracker,
      // Shared retry config for consistent backoff behavior across subagents
      options.retryConfig,
    );
  }

  /**
   * Process an LLM stream and yield events in real-time.
   *
   * This is an async generator that yields events immediately as they occur:
   * - Text events are yielded as text is streamed from the LLM
   * - gadget_call events are yielded immediately when a gadget call is parsed
   * - gadget_result events are yielded when gadget execution completes
   *
   * The final event is always a StreamCompletionEvent containing metadata.
   */
  async *process(stream: AsyncIterable<LLMStreamChunk>): AsyncGenerator<StreamEvent> {
    let finishReason: string | null = null;
    let usage: TokenUsage | undefined;
    let didExecuteGadgets = false;
    let shouldBreakLoop = false;
    let thinkingContent = "";

    // Process stream chunks
    for await (const chunk of stream) {
      // Capture metadata
      if (chunk.finishReason) finishReason = chunk.finishReason;
      if (chunk.usage) usage = chunk.usage;

      // Emit thinking content as a thinking event
      if (chunk.thinking?.content) {
        thinkingContent += chunk.thinking.content;
        yield {
          type: "thinking",
          content: chunk.thinking.content,
          thinkingType: chunk.thinking.type,
        };
      }

      // Process text content if present
      let processedChunk = "";
      if (chunk.text) {
        // Step 1: Interceptor - Transform raw chunk
        processedChunk = chunk.text;
        if (this.hooks.interceptors?.interceptRawChunk) {
          const context: ChunkInterceptorContext = {
            iteration: this.iteration,
            accumulatedText: this.responseText,
            logger: this.logger,
          };
          const intercepted = this.hooks.interceptors.interceptRawChunk(processedChunk, context);
          if (intercepted === null) {
            // Chunk suppressed
            processedChunk = "";
          } else {
            processedChunk = intercepted;
          }
        }

        // Accumulate text
        if (processedChunk) {
          this.responseText += processedChunk;
        }
      }

      // Step 2: Observer - Observe chunk (called for text OR usage updates)
      if (this.hooks.observers?.onStreamChunk && (processedChunk || chunk.usage)) {
        const chunkObservers: Array<() => void | Promise<void>> = [];
        chunkObservers.push(async () => {
          const context: ObserveChunkContext = {
            iteration: this.iteration,
            rawChunk: processedChunk,
            accumulatedText: this.responseText,
            usage,
            logger: this.logger,
          };
          await this.hooks.observers?.onStreamChunk?.(context);
        });
        await this.runObserversInParallel(chunkObservers);
      }

      // Skip further processing if no text
      if (!processedChunk) {
        continue;
      }

      // Step 3: Parse and process events - yield immediately
      for (const event of this.parser.feed(processedChunk)) {
        for await (const processedEvent of this.processEventGenerator(event)) {
          yield processedEvent;

          // Track gadget execution
          if (processedEvent.type === "gadget_result") {
            didExecuteGadgets = true;
            if (processedEvent.result.breaksLoop) {
              shouldBreakLoop = true;
            }
          }
        }
      }

      // Step 4: Drain completed parallel gadget results (real-time streaming)
      // This yields results from gadgets that completed during this chunk processing
      for (const evt of this.drainCompletedResults()) {
        yield evt;

        if (evt.type === "gadget_result") {
          didExecuteGadgets = true;
          if (evt.result.breaksLoop) {
            shouldBreakLoop = true;
          }
        }
      }

      // Step 5: Break stream loop if gadget limit exceeded
      // This stops reading further chunks, letting in-flight gadgets complete
      // and allowing the agent to continue to the next iteration
      if (this.limitExceeded) {
        this.logger.info("Breaking stream loop due to gadget limit");
        break;
      }
    }

    // Signal that LLM response is complete (tokens stopped flowing)
    // This fires BEFORE gadget execution finishes, allowing consumers to track
    // "LLM thinking time" separately from gadget execution time
    yield { type: "llm_response_end", finishReason, usage } as StreamEvent;

    // Finalize parsing
    for (const event of this.parser.finalize()) {
      for await (const processedEvent of this.processEventGenerator(event)) {
        yield processedEvent;

        if (processedEvent.type === "gadget_result") {
          didExecuteGadgets = true;
          if (processedEvent.result.breaksLoop) {
            shouldBreakLoop = true;
          }
        }
      }
    }

    // Wait for all in-flight parallel gadgets to complete, yielding events in real-time
    // This enables subagent events to be displayed during long-running gadget execution
    for await (const evt of this.waitForInFlightExecutions()) {
      yield evt;

      if (evt.type === "gadget_result") {
        didExecuteGadgets = true;
        if (evt.result.breaksLoop) {
          shouldBreakLoop = true;
        }
      }
    }

    // Drain any remaining completed results (stragglers that finished after final poll)
    for (const evt of this.drainCompletedResults()) {
      yield evt;

      if (evt.type === "gadget_result") {
        didExecuteGadgets = true;
        if (evt.result.breaksLoop) {
          shouldBreakLoop = true;
        }
      }
    }

    // Final pass to process any remaining pending gadgets
    // This handles cases where the last gadgets in the stream have dependencies
    // (now that in-flight gadgets have completed, their dependents can execute)
    for await (const evt of this.processPendingGadgetsGenerator()) {
      yield evt;

      if (evt.type === "gadget_result") {
        didExecuteGadgets = true;
        if (evt.result.breaksLoop) {
          shouldBreakLoop = true;
        }
      }
    }

    // Step 4: Interceptor - Transform final message
    let finalMessage = this.responseText;
    if (this.hooks.interceptors?.interceptAssistantMessage) {
      const context: MessageInterceptorContext = {
        iteration: this.iteration,
        rawResponse: this.responseText,
        logger: this.logger,
      };
      finalMessage = this.hooks.interceptors.interceptAssistantMessage(finalMessage, context);
    }

    // Yield completion event with all metadata
    const completionEvent: StreamCompletionEvent = {
      type: "stream_complete",
      shouldBreakLoop,
      didExecuteGadgets,
      finishReason,
      usage,
      rawResponse: this.responseText,
      finalMessage,
      thinkingContent: thinkingContent || undefined,
    };
    yield completionEvent;
  }

  /**
   * Process a single parsed event, yielding events in real-time.
   */
  private async *processEventGenerator(event: StreamEvent): AsyncGenerator<StreamEvent> {
    if (event.type === "text") {
      // processTextEvent is async - need to await the result before iterating
      for (const e of await this.processTextEvent(event)) {
        yield e;
      }
    } else if (event.type === "gadget_call") {
      for await (const e of this.processGadgetCallGenerator(event.call)) {
        yield e;
      }
    } else {
      yield event;
    }
  }

  /**
   * Process a text event through interceptors.
   */
  private async processTextEvent(event: { type: "text"; content: string }): Promise<StreamEvent[]> {
    let content = event.content;

    // Interceptor: Transform text chunk
    if (this.hooks.interceptors?.interceptTextChunk) {
      const context: ChunkInterceptorContext = {
        iteration: this.iteration,
        accumulatedText: this.responseText,
        logger: this.logger,
      };
      const intercepted = this.hooks.interceptors.interceptTextChunk(content, context);
      if (intercepted === null) {
        // Chunk suppressed
        return [];
      }
      content = intercepted;
    }

    return [{ type: "text", content }];
  }

  /**
   * Process a gadget call, yielding events in real-time.
   *
   * Yields gadget_call event IMMEDIATELY when parsed (before execution),
   * enabling real-time UI feedback.
   */
  private async *processGadgetCallGenerator(call: ParsedGadgetCall): AsyncGenerator<StreamEvent> {
    // Early exit if limit already exceeded - don't emit events for buffered gadgets
    if (this.limitExceeded) {
      return;
    }

    // Yield gadget_call IMMEDIATELY (real-time feedback before execution)
    yield { type: "gadget_call", call };

    // Add gadget to execution tree
    if (this.tree) {
      this.tree.addGadget({
        invocationId: call.invocationId,
        name: call.gadgetName,
        parameters: call.parameters ?? {},
        dependencies: call.dependencies,
        parentId: this.parentNodeId,
      });
    }

    // Check for dependencies
    if (call.dependencies.length > 0) {
      // Check for self-referential dependency (circular to self)
      if (call.dependencies.includes(call.invocationId)) {
        this.logger.warn("Gadget has self-referential dependency (depends on itself)", {
          gadgetName: call.gadgetName,
          invocationId: call.invocationId,
        });
        this.failedInvocations.add(call.invocationId);
        const errorMessage = `Gadget "${call.invocationId}" cannot depend on itself (self-referential dependency)`;
        const skipEvent: GadgetSkippedEvent = {
          type: "gadget_skipped",
          gadgetName: call.gadgetName,
          invocationId: call.invocationId,
          parameters: call.parameters ?? {},
          failedDependency: call.invocationId,
          failedDependencyError: errorMessage,
        };
        yield skipEvent;

        // Call onGadgetSkipped observer (AWAITED for proper ordering)
        const skippedGadgetNode = this.tree?.getNodeByInvocationId(call.invocationId);
        const skippedSubagentContext =
          this.tree && skippedGadgetNode
            ? getSubagentContextForNode(this.tree, skippedGadgetNode.id)
            : undefined;

        if (this.hooks.observers?.onGadgetSkipped) {
          const context: ObserveGadgetSkippedContext = {
            iteration: this.iteration,
            gadgetName: call.gadgetName,
            invocationId: call.invocationId,
            parameters: call.parameters ?? {},
            failedDependency: call.invocationId,
            failedDependencyError: errorMessage,
            logger: this.logger,
            subagentContext: skippedSubagentContext,
          };
          await this.safeObserve(() => this.hooks.observers!.onGadgetSkipped!(context));
        }

        // Call parent observers for subagent visibility (AWAITED)
        if (this.parentObservers?.onGadgetSkipped) {
          const context: ObserveGadgetSkippedContext = {
            iteration: this.iteration,
            gadgetName: call.gadgetName,
            invocationId: call.invocationId,
            parameters: call.parameters ?? {},
            failedDependency: call.invocationId,
            failedDependencyError: errorMessage,
            logger: this.logger,
            subagentContext: skippedSubagentContext,
          };
          await this.safeObserve(() => this.parentObservers!.onGadgetSkipped!(context));
        }
        return;
      }

      // Check if any dependency has failed (including from prior iterations)
      const failedDep = call.dependencies.find(
        (dep) => this.failedInvocations.has(dep) || this.priorFailedInvocations.has(dep),
      );
      if (failedDep) {
        // Dependency failed - handle skip
        const skipEvents = await this.handleFailedDependency(call, failedDep);
        for (const evt of skipEvents) {
          yield evt;
        }
        return;
      }

      // Check if all dependencies are satisfied (including from prior iterations)
      const unsatisfied = call.dependencies.filter(
        (dep) => !this.completedResults.has(dep) && !this.priorCompletedInvocations.has(dep),
      );
      if (unsatisfied.length > 0) {
        // Queue for later execution - gadget_call already yielded above
        this.logger.debug("Queueing gadget for later - waiting on dependencies", {
          gadgetName: call.gadgetName,
          invocationId: call.invocationId,
          waitingOn: unsatisfied,
        });
        this.gadgetsAwaitingDependencies.set(call.invocationId, call);
        return; // Execution deferred, gadget_call already yielded
      }

      // All dependencies satisfied - check limit then execute
      const limitCheckGen = this.checkGadgetLimitExceeded(call);
      let limitResult = await limitCheckGen.next();
      while (!limitResult.done) {
        yield limitResult.value;
        limitResult = await limitCheckGen.next();
      }
      if (limitResult.value === true) {
        return; // Limit exceeded, gadget was skipped
      }

      for await (const evt of this.executeGadgetGenerator(call)) {
        yield evt;
      }

      // Check if any pending gadgets can now execute
      for await (const evt of this.processPendingGadgetsGenerator()) {
        yield evt;
      }
      return;
    }

    // NO dependencies - check gadget limit FIRST, then concurrency
    // Check maxGadgetsPerResponse limit before any execution path
    const limitCheckGen = this.checkGadgetLimitExceeded(call);
    let limitResult = await limitCheckGen.next();
    while (!limitResult.done) {
      yield limitResult.value;
      limitResult = await limitCheckGen.next();
    }
    if (limitResult.value === true) {
      return; // Limit exceeded, gadget was skipped
    }

    // Check concurrency limit
    const limit = this.getConcurrencyLimit(call.gadgetName);
    const activeCount = this.activeCountByGadget.get(call.gadgetName) ?? 0;

    if (limit > 0 && activeCount >= limit) {
      // Queue for later execution when a slot becomes available
      // Note: gadget already passed maxGadgetsPerResponse check and was counted
      this.logger.debug("Gadget queued due to concurrency limit", {
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        activeCount,
        limit,
      });
      const queue = this.concurrencyQueue.get(call.gadgetName) ?? [];
      queue.push(call);
      this.concurrencyQueue.set(call.gadgetName, queue);
      return; // Don't start yet, will be processed when a slot opens
    }

    // Execute based on execution mode
    if (this.gadgetExecutionMode === "sequential") {
      // Sequential: wait for completion before continuing
      for await (const evt of this.executeGadgetGenerator(call)) {
        yield evt;
      }
    } else {
      // Parallel: fire-and-forget with concurrency tracking
      this.startGadgetWithConcurrencyTracking(call);
    }
  }

  /**
   * Get the effective concurrency limit for a gadget.
   * Uses "most restrictive wins" strategy: the lowest non-zero value from
   * external config (SubagentConfig) and gadget's intrinsic maxConcurrent.
   *
   * This ensures gadget authors can set safety floors (e.g., maxConcurrent: 1
   * for file writers) that cannot be weakened by external configuration.
   *
   * @returns 0 if unlimited, otherwise the effective limit
   */
  private getConcurrencyLimit(gadgetName: string): number {
    // External config limit (SubagentConfig)
    const configLimit = this.subagentConfig?.[gadgetName]?.maxConcurrent;

    // Gadget's intrinsic limit
    const gadget = this.registry.get(gadgetName);
    const gadgetLimit = gadget?.maxConcurrent;

    // Most restrictive wins: lowest non-zero value
    // Treat 0 and undefined as "unlimited" (Infinity for comparison)
    const config = configLimit || Number.POSITIVE_INFINITY;
    const intrinsic = gadgetLimit || Number.POSITIVE_INFINITY;
    const effective = Math.min(config, intrinsic);

    return effective === Number.POSITIVE_INFINITY ? 0 : effective;
  }

  /**
   * Start a gadget execution with concurrency tracking.
   * Increments active count, starts execution, and schedules queue processing on completion.
   */
  private startGadgetWithConcurrencyTracking(call: ParsedGadgetCall): void {
    const gadgetName = call.gadgetName;
    const currentCount = this.activeCountByGadget.get(gadgetName) ?? 0;
    this.activeCountByGadget.set(gadgetName, currentCount + 1);

    const executionPromise = this.executeGadgetAndCollect(call).finally(() => {
      // Decrement active count and process any queued gadgets
      const newCount = (this.activeCountByGadget.get(gadgetName) ?? 1) - 1;
      this.activeCountByGadget.set(gadgetName, newCount);
      this.processQueuedGadget(gadgetName);
    });

    this.inFlightExecutions.set(call.invocationId, executionPromise);
  }

  /**
   * Process the next queued gadget for a given gadget name if a slot is available.
   */
  private processQueuedGadget(gadgetName: string): void {
    const queue = this.concurrencyQueue.get(gadgetName);
    if (!queue || queue.length === 0) return;

    const limit = this.getConcurrencyLimit(gadgetName);
    const activeCount = this.activeCountByGadget.get(gadgetName) ?? 0;

    if (limit === 0 || activeCount < limit) {
      const nextCall = queue.shift()!;
      this.logger.debug("Processing queued gadget", {
        gadgetName,
        invocationId: nextCall.invocationId,
        remainingInQueue: queue.length,
      });
      this.startGadgetWithConcurrencyTracking(nextCall);
    }
  }

  /**
   * Execute a gadget through the full hook lifecycle and yield events.
   * Handles parameter interception, before/after controllers, observers,
   * execution, result interception, and tree tracking.
   */
  private async *executeGadgetGenerator(call: ParsedGadgetCall): AsyncGenerator<StreamEvent> {
    // Log parse errors if present (execution continues - errors are part of the result)
    if (call.parseError) {
      this.logger.warn("Gadget has parse error", {
        gadgetName: call.gadgetName,
        error: call.parseError,
        rawParameters: call.parametersRaw,
      });
    }

    // Step 1: Interceptor - Transform parameters
    let parameters = call.parameters ?? {};
    if (this.hooks.interceptors?.interceptGadgetParameters) {
      const context: GadgetParameterInterceptorContext = {
        iteration: this.iteration,
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        logger: this.logger,
      };
      parameters = this.hooks.interceptors.interceptGadgetParameters(parameters, context);
    }

    // Update call with intercepted parameters
    call.parameters = parameters;

    // Update tree node with intercepted parameters (so observers see the modified values)
    if (this.tree) {
      this.tree.updateGadgetParameters(call.invocationId, parameters);
    }

    // Step 2: Controller - Before execution
    let shouldSkip = false;
    let syntheticResult: string | undefined;

    if (this.hooks.controllers?.beforeGadgetExecution) {
      const context: GadgetExecutionControllerContext = {
        iteration: this.iteration,
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        parameters,
        logger: this.logger,
      };
      const action: BeforeGadgetExecutionAction =
        await this.hooks.controllers.beforeGadgetExecution(context);

      // Validate the action
      validateBeforeGadgetExecutionAction(action);

      if (action.action === "skip") {
        shouldSkip = true;
        syntheticResult = action.syntheticResult;
        this.logger.info("Controller skipped gadget execution", {
          gadgetName: call.gadgetName,
        });
      }
    }

    // Step 3: Mark gadget as running in tree
    if (this.tree) {
      const gadgetNode = this.tree.getNodeByInvocationId(call.invocationId);
      if (gadgetNode) {
        this.tree.startGadget(gadgetNode.id);
      }
    }

    // Step 3b: Call onGadgetExecutionStart observer (AWAITED for proper ordering)
    const gadgetStartNode = this.tree?.getNodeByInvocationId(call.invocationId);
    const gadgetStartSubagentContext =
      this.tree && gadgetStartNode
        ? getSubagentContextForNode(this.tree, gadgetStartNode.id)
        : undefined;

    if (this.hooks.observers?.onGadgetExecutionStart) {
      const context: ObserveGadgetStartContext = {
        iteration: this.iteration,
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        parameters,
        logger: this.logger,
        subagentContext: gadgetStartSubagentContext,
      };
      await this.safeObserve(() => this.hooks.observers!.onGadgetExecutionStart!(context));
    }

    // Step 3c: Call parent observers for subagent visibility (AWAITED)
    if (this.parentObservers?.onGadgetExecutionStart) {
      const context: ObserveGadgetStartContext = {
        iteration: this.iteration,
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        parameters,
        logger: this.logger,
        subagentContext: gadgetStartSubagentContext,
      };
      await this.safeObserve(() => this.parentObservers!.onGadgetExecutionStart!(context));
    }

    // Step 4: Execute or use synthetic result
    let result: GadgetExecutionResult;
    if (shouldSkip) {
      result = {
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        parameters,
        result: syntheticResult ?? "Execution skipped",
        executionTimeMs: 0,
      };
    } else {
      result = await this.executor.execute(call);
    }

    // Step 5: Interceptor - Transform result (modifies result.result)
    if (result.result && this.hooks.interceptors?.interceptGadgetResult) {
      const context: GadgetResultInterceptorContext = {
        iteration: this.iteration,
        gadgetName: result.gadgetName,
        invocationId: result.invocationId,
        parameters,
        executionTimeMs: result.executionTimeMs,
        logger: this.logger,
      };
      result.result = this.hooks.interceptors.interceptGadgetResult(result.result, context);
    }

    // Step 6: Controller - After execution (can further modify result)
    if (this.hooks.controllers?.afterGadgetExecution) {
      const context: AfterGadgetExecutionControllerContext = {
        iteration: this.iteration,
        gadgetName: result.gadgetName,
        invocationId: result.invocationId,
        parameters,
        result: result.result,
        error: result.error,
        executionTimeMs: result.executionTimeMs,
        logger: this.logger,
      };
      const action: AfterGadgetExecutionAction =
        await this.hooks.controllers.afterGadgetExecution(context);

      // Validate the action
      validateAfterGadgetExecutionAction(action);

      if (action.action === "recover" && result.error) {
        this.logger.info("Controller recovered from gadget error", {
          gadgetName: result.gadgetName,
          originalError: result.error,
        });
        result = {
          ...result,
          error: undefined,
          result: action.fallbackResult,
        };
      }
    }

    // Step 7: Complete gadget in tree
    if (this.tree) {
      const gadgetNode = this.tree.getNodeByInvocationId(result.invocationId);
      if (gadgetNode) {
        if (result.error) {
          this.tree.completeGadget(gadgetNode.id, {
            error: result.error,
            executionTimeMs: result.executionTimeMs,
            cost: result.cost,
          });
        } else {
          this.tree.completeGadget(gadgetNode.id, {
            result: result.result,
            executionTimeMs: result.executionTimeMs,
            cost: result.cost,
            media: result.media,
          });
        }
      }
    }

    // Step 7b: Call onGadgetExecutionComplete observer (AWAITED for proper ordering)
    const gadgetCompleteNode = this.tree?.getNodeByInvocationId(result.invocationId);
    const gadgetCompleteSubagentContext =
      this.tree && gadgetCompleteNode
        ? getSubagentContextForNode(this.tree, gadgetCompleteNode.id)
        : undefined;

    if (this.hooks.observers?.onGadgetExecutionComplete) {
      const context: ObserveGadgetCompleteContext = {
        iteration: this.iteration,
        gadgetName: result.gadgetName,
        invocationId: result.invocationId,
        parameters,
        finalResult: result.result,
        error: result.error,
        executionTimeMs: result.executionTimeMs,
        cost: result.cost,
        logger: this.logger,
        subagentContext: gadgetCompleteSubagentContext,
      };
      await this.safeObserve(() => this.hooks.observers!.onGadgetExecutionComplete!(context));
    }

    // Step 7c: Call parent observers for subagent visibility (AWAITED)
    if (this.parentObservers?.onGadgetExecutionComplete) {
      const context: ObserveGadgetCompleteContext = {
        iteration: this.iteration,
        gadgetName: result.gadgetName,
        invocationId: result.invocationId,
        parameters,
        finalResult: result.result,
        error: result.error,
        executionTimeMs: result.executionTimeMs,
        cost: result.cost,
        logger: this.logger,
        subagentContext: gadgetCompleteSubagentContext,
      };
      await this.safeObserve(() => this.parentObservers!.onGadgetExecutionComplete!(context));
    }

    // Track completion for dependency resolution
    this.completedResults.set(result.invocationId, result);
    if (result.error) {
      this.failedInvocations.add(result.invocationId);
    }

    // Yield result event immediately
    yield { type: "gadget_result", result };
  }

  /**
   * Execute a gadget and push events to the completed results queue (non-blocking).
   * Used for fire-and-forget parallel execution of independent gadgets.
   * Results are pushed to completedResultsQueue for real-time streaming to the caller.
   */
  private async executeGadgetAndCollect(call: ParsedGadgetCall): Promise<void> {
    for await (const evt of this.executeGadgetGenerator(call)) {
      // Push each event to the queue as it's produced for real-time streaming
      this.completedResultsQueue.push(evt);
    }
    // NOTE: Don't delete from inFlightExecutions here - it creates a race condition
    // where fast-completing gadgets are removed before waitForInFlightExecutions runs.
    // The map is cleared in waitForInFlightExecutions after all promises are awaited.
  }

  /**
   * Drain all completed results from the queue.
   * Used to yield results as they complete during stream processing.
   * @returns Generator that yields all events currently in the queue
   */
  private *drainCompletedResults(): Generator<StreamEvent> {
    while (this.completedResultsQueue.length > 0) {
      yield this.completedResultsQueue.shift()!;
    }
  }

  /**
   * Wait for all in-flight gadget executions to complete, yielding events in real-time.
   * Called at stream end to ensure all parallel executions finish.
   * Results and subagent events are pushed to completedResultsQueue during execution.
   * This generator yields queued events while polling, enabling real-time display
   * of subagent activity (LLM calls, nested gadgets) during long-running gadgets.
   * Clears the inFlightExecutions map after all gadgets complete.
   */
  private async *waitForInFlightExecutions(): AsyncGenerator<StreamEvent> {
    if (this.inFlightExecutions.size === 0 && !this.hasQueuedGadgets()) {
      return;
    }

    this.logger.debug("Waiting for in-flight gadget executions", {
      count: this.inFlightExecutions.size,
      invocationIds: Array.from(this.inFlightExecutions.keys()),
      queuedCount: this.getQueuedGadgetCount(),
    });

    // Poll interval for draining queue (100ms provides responsive updates)
    const POLL_INTERVAL_MS = 100;

    // Poll loop: yield queued events while waiting for gadgets to complete
    // Continue while there are in-flight executions OR queued gadgets waiting
    while (this.inFlightExecutions.size > 0 || this.hasQueuedGadgets()) {
      // Create a combined promise that resolves when current gadgets complete
      const allDone =
        this.inFlightExecutions.size > 0
          ? Promise.all(this.inFlightExecutions.values()).then(() => "done" as const)
          : Promise.resolve("done" as const);

      // Race between: all current gadgets completing OR poll timeout
      const result = await Promise.race([
        allDone,
        new Promise<"poll">((resolve) => setTimeout(() => resolve("poll"), POLL_INTERVAL_MS)),
      ]);

      // Yield any events that accumulated in the queue
      yield* this.drainCompletedResults();

      if (result === "done" && this.getTotalActiveGadgetCount() === 0 && !this.hasQueuedGadgets()) {
        // All gadgets complete (none active), no more queued - exit loop
        break;
      }
      // Continue polling - either more gadgets will be started from queue,
      // or we're still waiting for in-flight gadgets
    }

    // Clear the map after all promises have completed
    this.inFlightExecutions.clear();
  }

  /**
   * Check if there are any gadgets waiting in concurrency queues.
   */
  private hasQueuedGadgets(): boolean {
    for (const queue of this.concurrencyQueue.values()) {
      if (queue.length > 0) return true;
    }
    return false;
  }

  /**
   * Get total count of queued gadgets across all queues.
   */
  private getQueuedGadgetCount(): number {
    let count = 0;
    for (const queue of this.concurrencyQueue.values()) {
      count += queue.length;
    }
    return count;
  }

  /**
   * Get total count of actively executing gadgets across all types.
   * Used to know when all work is truly complete (not just when allDone resolves).
   */
  private getTotalActiveGadgetCount(): number {
    let total = 0;
    for (const count of this.activeCountByGadget.values()) {
      total += count;
    }
    return total;
  }

  /**
   * Handle a gadget that cannot execute because a dependency failed.
   * Calls the onDependencySkipped controller to allow customization.
   */
  private async handleFailedDependency(
    call: ParsedGadgetCall,
    failedDep: string,
  ): Promise<StreamEvent[]> {
    const events: StreamEvent[] = [];
    const depResult = this.completedResults.get(failedDep);
    const depError = depResult?.error ?? "Dependency failed";

    // Call controller to allow customization of skip behavior
    let action: DependencySkipAction = { action: "skip" };
    if (this.hooks.controllers?.onDependencySkipped) {
      const context: DependencySkipControllerContext = {
        iteration: this.iteration,
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        parameters: call.parameters ?? {},
        failedDependency: failedDep,
        failedDependencyError: depError,
        logger: this.logger,
      };
      action = await this.hooks.controllers.onDependencySkipped(context);
    }

    if (action.action === "skip") {
      // Mark as failed so downstream dependents also skip
      this.failedInvocations.add(call.invocationId);

      // Skip gadget in execution tree
      if (this.tree) {
        const gadgetNode = this.tree.getNodeByInvocationId(call.invocationId);
        if (gadgetNode) {
          this.tree.skipGadget(gadgetNode.id, failedDep, depError, "dependency_failed");
        }
      }

      // Emit skip event (for stream consumers)
      const skipEvent: GadgetSkippedEvent = {
        type: "gadget_skipped",
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        parameters: call.parameters ?? {},
        failedDependency: failedDep,
        failedDependencyError: depError,
      };
      events.push(skipEvent);

      // Call onGadgetSkipped observer (AWAITED for proper ordering)
      const gadgetNodeForSkip = this.tree?.getNodeByInvocationId(call.invocationId);
      const skipSubagentContext =
        this.tree && gadgetNodeForSkip
          ? getSubagentContextForNode(this.tree, gadgetNodeForSkip.id)
          : undefined;

      if (this.hooks.observers?.onGadgetSkipped) {
        const context: ObserveGadgetSkippedContext = {
          iteration: this.iteration,
          gadgetName: call.gadgetName,
          invocationId: call.invocationId,
          parameters: call.parameters ?? {},
          failedDependency: failedDep,
          failedDependencyError: depError,
          logger: this.logger,
          subagentContext: skipSubagentContext,
        };
        await this.safeObserve(() => this.hooks.observers!.onGadgetSkipped!(context));
      }

      // Call parent observers for subagent visibility (AWAITED)
      if (this.parentObservers?.onGadgetSkipped) {
        const context: ObserveGadgetSkippedContext = {
          iteration: this.iteration,
          gadgetName: call.gadgetName,
          invocationId: call.invocationId,
          parameters: call.parameters ?? {},
          failedDependency: failedDep,
          failedDependencyError: depError,
          logger: this.logger,
          subagentContext: skipSubagentContext,
        };
        await this.safeObserve(() => this.parentObservers!.onGadgetSkipped!(context));
      }

      this.logger.info("Gadget skipped due to failed dependency", {
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        failedDependency: failedDep,
      });
    } else if (action.action === "execute_anyway") {
      // Execute despite failed dependency
      this.logger.info("Executing gadget despite failed dependency (controller override)", {
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        failedDependency: failedDep,
      });
      for await (const evt of this.executeGadgetGenerator(call)) {
        events.push(evt);
      }
    } else if (action.action === "use_fallback") {
      // Use fallback result without executing
      const fallbackResult: GadgetExecutionResult = {
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        parameters: call.parameters ?? {},
        result: action.fallbackResult,
        executionTimeMs: 0,
      };
      this.completedResults.set(call.invocationId, fallbackResult);
      events.push({ type: "gadget_result", result: fallbackResult });

      this.logger.info("Using fallback result for gadget with failed dependency", {
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        failedDependency: failedDep,
      });
    }

    return events;
  }

  /**
   * Check if gadget execution should be skipped due to maxGadgetsPerResponse limit.
   * If limit is exceeded, yields skip events and returns true.
   * If execution can proceed, increments counter and returns false.
   *
   * @returns true if gadget should be skipped, false if execution can proceed
   */
  private async *checkGadgetLimitExceeded(
    call: ParsedGadgetCall,
  ): AsyncGenerator<StreamEvent, boolean> {
    // Skip check if no limit set (0 = unlimited)
    if (this.maxGadgetsPerResponse <= 0) {
      this.gadgetStartedCount++;
      return false;
    }

    // Check if limit exceeded
    if (this.gadgetStartedCount >= this.maxGadgetsPerResponse) {
      const errorMessage = `Gadget limit (${this.maxGadgetsPerResponse}) exceeded. Consider calling fewer gadgets per response.`;

      // Set flag to break stream loop - stops reading further chunks
      this.limitExceeded = true;

      this.logger.info("Gadget limit exceeded, stopping stream processing", {
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        limit: this.maxGadgetsPerResponse,
        currentCount: this.gadgetStartedCount,
      });

      this.failedInvocations.add(call.invocationId);

      // Mark skipped in execution tree
      if (this.tree) {
        const gadgetNode = this.tree.getNodeByInvocationId(call.invocationId);
        if (gadgetNode) {
          this.tree.skipGadget(
            gadgetNode.id,
            "maxGadgetsPerResponse",
            errorMessage,
            "limit_exceeded",
          );
        }
      }

      const skipEvent: GadgetSkippedEvent = {
        type: "gadget_skipped",
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        parameters: call.parameters ?? {},
        failedDependency: "maxGadgetsPerResponse",
        failedDependencyError: errorMessage,
      };
      yield skipEvent;

      // Call onGadgetSkipped observer
      const limitSkipNode = this.tree?.getNodeByInvocationId(call.invocationId);
      const limitSkipSubagentContext =
        this.tree && limitSkipNode
          ? getSubagentContextForNode(this.tree, limitSkipNode.id)
          : undefined;

      if (this.hooks.observers?.onGadgetSkipped) {
        const context: ObserveGadgetSkippedContext = {
          iteration: this.iteration,
          gadgetName: call.gadgetName,
          invocationId: call.invocationId,
          parameters: call.parameters ?? {},
          failedDependency: "maxGadgetsPerResponse",
          failedDependencyError: errorMessage,
          logger: this.logger,
          subagentContext: limitSkipSubagentContext,
        };
        await this.safeObserve(() => this.hooks.observers!.onGadgetSkipped!(context));
      }

      // Call parent observers for subagent visibility
      if (this.parentObservers?.onGadgetSkipped) {
        const context: ObserveGadgetSkippedContext = {
          iteration: this.iteration,
          gadgetName: call.gadgetName,
          invocationId: call.invocationId,
          parameters: call.parameters ?? {},
          failedDependency: "maxGadgetsPerResponse",
          failedDependencyError: errorMessage,
          logger: this.logger,
          subagentContext: limitSkipSubagentContext,
        };
        await this.safeObserve(() => this.parentObservers!.onGadgetSkipped!(context));
      }

      return true; // Limit exceeded, skip this gadget
    }

    // Limit not exceeded, increment counter and allow execution
    this.gadgetStartedCount++;
    return false;
  }

  /**
   * Process pending gadgets whose dependencies are now satisfied.
   * Yields events in real-time as gadgets complete.
   *
   * Gadgets are executed in parallel for efficiency,
   * but results are yielded as they become available.
   */
  private async *processPendingGadgetsGenerator(): AsyncGenerator<StreamEvent> {
    // Skip processing pending gadgets if limit already exceeded
    if (this.limitExceeded) {
      return;
    }

    let progress = true;

    while (progress && this.gadgetsAwaitingDependencies.size > 0) {
      progress = false;

      // Find all gadgets that are ready to execute
      const readyToExecute: ParsedGadgetCall[] = [];
      const readyToSkip: Array<{ call: ParsedGadgetCall; failedDep: string }> = [];

      for (const [_invocationId, call] of this.gadgetsAwaitingDependencies) {
        // Check for failed dependency (including from prior iterations)
        const failedDep = call.dependencies.find(
          (dep) => this.failedInvocations.has(dep) || this.priorFailedInvocations.has(dep),
        );
        if (failedDep) {
          readyToSkip.push({ call, failedDep });
          continue;
        }

        // Check if all dependencies are satisfied (including from prior iterations)
        const allSatisfied = call.dependencies.every(
          (dep) => this.completedResults.has(dep) || this.priorCompletedInvocations.has(dep),
        );
        if (allSatisfied) {
          readyToExecute.push(call);
        }
      }

      // Handle skipped gadgets
      for (const { call, failedDep } of readyToSkip) {
        this.gadgetsAwaitingDependencies.delete(call.invocationId);
        const skipEvents = await this.handleFailedDependency(call, failedDep);
        for (const evt of skipEvents) {
          yield evt;
        }
        progress = true;
      }

      // Execute ready gadgets
      if (readyToExecute.length > 0) {
        // Remove from pending before executing
        for (const call of readyToExecute) {
          this.gadgetsAwaitingDependencies.delete(call.invocationId);
        }

        if (this.gadgetExecutionMode === "sequential") {
          // Sequential: execute one at a time, checking limit for each
          this.logger.debug("Executing ready gadgets sequentially", {
            count: readyToExecute.length,
            invocationIds: readyToExecute.map((c) => c.invocationId),
          });

          for (const call of readyToExecute) {
            // Check limit before execution
            const limitCheckGen = this.checkGadgetLimitExceeded(call);
            let limitResult = await limitCheckGen.next();
            while (!limitResult.done) {
              yield limitResult.value;
              limitResult = await limitCheckGen.next();
            }
            if (limitResult.value === true) {
              continue; // Limit exceeded, skip this gadget but continue with others
            }

            for await (const evt of this.executeGadgetGenerator(call)) {
              yield evt;
            }
          }
        } else {
          // Parallel: check limit for each and execute allowed gadgets concurrently
          this.logger.debug("Executing ready gadgets in parallel", {
            count: readyToExecute.length,
            invocationIds: readyToExecute.map((c) => c.invocationId),
          });

          const eventSets = await Promise.all(
            readyToExecute.map(async (call) => {
              const events: StreamEvent[] = [];

              // Check limit before execution
              const limitCheckGen = this.checkGadgetLimitExceeded(call);
              let limitResult = await limitCheckGen.next();
              while (!limitResult.done) {
                events.push(limitResult.value);
                limitResult = await limitCheckGen.next();
              }
              if (limitResult.value === true) {
                return events; // Return skip events only
              }

              for await (const evt of this.executeGadgetGenerator(call)) {
                events.push(evt);
              }
              return events;
            }),
          );

          // Yield all events from parallel execution
          for (const events of eventSets) {
            for (const evt of events) {
              yield evt;
            }
          }
        }

        progress = true;
      }
    }

    // Warn about any remaining unresolved gadgets (circular or missing dependencies)
    if (this.gadgetsAwaitingDependencies.size > 0) {
      // Collect all pending invocation IDs to detect circular dependencies
      const pendingIds = new Set(this.gadgetsAwaitingDependencies.keys());

      for (const [invocationId, call] of this.gadgetsAwaitingDependencies) {
        // Filter to deps that are not in current or prior completed sets
        const missingDeps = call.dependencies.filter(
          (dep) => !this.completedResults.has(dep) && !this.priorCompletedInvocations.has(dep),
        );

        // Categorize the dependency issue
        const circularDeps = missingDeps.filter((dep) => pendingIds.has(dep));
        const trulyMissingDeps = missingDeps.filter((dep) => !pendingIds.has(dep));

        let errorMessage: string;
        let logLevel: "warn" | "error" = "warn";

        if (circularDeps.length > 0 && trulyMissingDeps.length > 0) {
          errorMessage = `Dependencies unresolvable: circular=[${circularDeps.join(", ")}], missing=[${trulyMissingDeps.join(", ")}]`;
          logLevel = "error";
        } else if (circularDeps.length > 0) {
          errorMessage = `Circular dependency detected: "${invocationId}" depends on "${circularDeps[0]}" which also depends on "${invocationId}" (directly or indirectly)`;
        } else {
          errorMessage = `Dependency "${missingDeps[0]}" was never executed - check that the invocation ID exists and is spelled correctly`;
        }

        this.logger[logLevel]("Gadget has unresolvable dependencies", {
          gadgetName: call.gadgetName,
          invocationId,
          circularDependencies: circularDeps,
          missingDependencies: trulyMissingDeps,
        });

        // Mark as failed and emit skip event
        this.failedInvocations.add(invocationId);
        const skipEvent: GadgetSkippedEvent = {
          type: "gadget_skipped",
          gadgetName: call.gadgetName,
          invocationId,
          parameters: call.parameters ?? {},
          failedDependency: missingDeps[0],
          failedDependencyError: errorMessage,
        };
        yield skipEvent;

        // Call onGadgetSkipped observer (AWAITED for proper ordering)
        const gadgetNodeForTimeout = this.tree?.getNodeByInvocationId(invocationId);
        const timeoutSubagentContext =
          this.tree && gadgetNodeForTimeout
            ? getSubagentContextForNode(this.tree, gadgetNodeForTimeout.id)
            : undefined;

        if (this.hooks.observers?.onGadgetSkipped) {
          const context: ObserveGadgetSkippedContext = {
            iteration: this.iteration,
            gadgetName: call.gadgetName,
            invocationId,
            parameters: call.parameters ?? {},
            failedDependency: missingDeps[0],
            failedDependencyError: errorMessage,
            logger: this.logger,
            subagentContext: timeoutSubagentContext,
          };
          await this.safeObserve(() => this.hooks.observers!.onGadgetSkipped!(context));
        }

        // Call parent observers for subagent visibility (AWAITED)
        if (this.parentObservers?.onGadgetSkipped) {
          const context: ObserveGadgetSkippedContext = {
            iteration: this.iteration,
            gadgetName: call.gadgetName,
            invocationId,
            parameters: call.parameters ?? {},
            failedDependency: missingDeps[0],
            failedDependencyError: errorMessage,
            logger: this.logger,
            subagentContext: timeoutSubagentContext,
          };
          await this.safeObserve(() => this.parentObservers!.onGadgetSkipped!(context));
        }
      }
      this.gadgetsAwaitingDependencies.clear();
    }
  }

  /**
   * Safely execute an observer, catching and logging any errors.
   * Observers are non-critical, so errors are logged but don't crash the system.
   */
  private async safeObserve(fn: () => void | Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.observerFailureCount++;
      this.logger.error("Observer threw error (ignoring)", {
        error: error instanceof Error ? error.message : String(error),
        failureCount: this.observerFailureCount,
      });
    }
  }

  /**
   * Execute multiple observers in parallel.
   * All observers run concurrently and failures are tracked but don't crash.
   */
  private async runObserversInParallel(
    observers: Array<() => void | Promise<void>>,
  ): Promise<void> {
    if (observers.length === 0) return;

    // Run all observers in parallel, waiting for completion
    // Errors are logged in safeObserve, no need to handle rejected promises
    await Promise.allSettled(observers.map((observer) => this.safeObserve(observer)));
  }

  // ==========================================================================
  // Public accessors for cross-iteration dependency tracking
  // ==========================================================================

  /**
   * Get all invocation IDs that completed successfully in this iteration.
   * Used by Agent to accumulate completed IDs across iterations.
   */
  getCompletedInvocationIds(): Set<string> {
    return new Set(this.completedResults.keys());
  }

  /**
   * Get all invocation IDs that failed in this iteration.
   * Used by Agent to accumulate failed IDs across iterations.
   */
  getFailedInvocationIds(): Set<string> {
    return new Set(this.failedInvocations);
  }
}
