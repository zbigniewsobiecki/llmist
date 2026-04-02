/**
 * StreamProcessor: The heart of the new hooks architecture.
 *
 * Replaces the complex wiring between Agent, ResponseProcessor, and GadgetRuntime.
 * Owns ALL stream processing and hook coordination with a clean, predictable flow.
 *
 * After refactoring, StreamProcessor is a thin orchestrator (~300 lines) that:
 * - Iterates over raw LLM stream chunks
 * - Applies raw-chunk and text-chunk interceptors
 * - Delegates gadget dispatch to GadgetDispatcher
 * - Yields events in real-time
 * - Applies the final assistant-message interceptor
 *
 * Extracted classes:
 * - GadgetLimitGuard     — maxGadgetsPerResponse enforcement
 * - GadgetHookLifecycle  — full hook sequence for a single gadget
 * - GadgetDispatcher     — dispatch decision tree + concurrency + dependency
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
  StreamCompletionEvent,
  StreamEvent,
  SubagentConfigMap,
} from "../gadgets/types.js";
import { createLogger } from "../logging/logger.js";
import { GadgetConcurrencyManager } from "./gadget-concurrency-manager.js";
import { GadgetDependencyResolver } from "./gadget-dependency-resolver.js";
import { GadgetDispatcher } from "./gadget-dispatcher.js";
import { GadgetHookLifecycle } from "./gadget-hook-lifecycle.js";
import { GadgetLimitGuard } from "./gadget-limit-guard.js";
import type {
  AgentHooks,
  ChunkInterceptorContext,
  MessageInterceptorContext,
  ObserveChunkContext,
  Observers,
} from "./hooks.js";
import { safeObserve } from "./safe-observe.js";
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

  /** Maximum time (ms) to wait for in-flight gadgets to complete. Default: 300s. */
  inFlightTimeoutMs?: number;

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
 *
 * @deprecated StreamProcessor.process() is now an async generator that yields
 * StreamEvent items directly. Use StreamCompletionEvent (the final yielded event)
 * to obtain the metadata formerly returned in this type. This interface is retained
 * for backward compatibility but is not used internally.
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
 * StreamProcessor: Thin orchestrator for stream processing and hook coordination.
 *
 * Execution order:
 * 1. Raw chunk arrives from LLM
 * 2. Interceptor: interceptRawChunk (transform raw text)
 * 3. Observer: onStreamChunk (logging)
 * 4. Parse for gadgets
 * 5. If gadget found → delegate to GadgetDispatcher
 * 6. If text chunk:
 *    a. Interceptor: interceptTextChunk (transform display text)
 *    b. Yield to user
 * 7. Stream complete
 * 8. Interceptor: interceptAssistantMessage (transform final message)
 */
export class StreamProcessor {
  private readonly iteration: number;
  private readonly hooks: AgentHooks;
  private readonly logger: Logger<ILogObj>;
  private readonly parser: GadgetCallParser;

  // Execution Tree context
  private readonly tree?: ExecutionTree;

  private responseText = "";

  // Dependency resolution is delegated to GadgetDependencyResolver
  private readonly dependencyResolver: GadgetDependencyResolver;

  /** Queue of completed gadget results ready to be yielded (for real-time streaming) */
  private completedResultsQueue: StreamEvent[] = [];

  // Extracted orchestrators
  private readonly dispatcher: GadgetDispatcher;
  private readonly limitGuard: GadgetLimitGuard;

  constructor(options: StreamProcessorOptions) {
    this.iteration = options.iteration;
    this.hooks = options.hooks ?? {};
    this.logger = options.logger ?? createLogger({ name: "llmist:stream-processor" });

    // Initialize tree context
    this.tree = options.tree;

    // Initialize dependency resolver with cross-iteration state
    this.dependencyResolver = new GadgetDependencyResolver({
      priorCompletedInvocations: options.priorCompletedInvocations,
      priorFailedInvocations: options.priorFailedInvocations,
    });

    // Initialize concurrency manager (delegates all concurrency state/logic)
    const concurrencyManager = new GadgetConcurrencyManager({
      registry: options.registry,
      subagentConfig: options.subagentConfig,
      logger: this.logger.getSubLogger({ name: "concurrency" }),
    });

    // Initialize gadget limiting (0 = unlimited)
    this.limitGuard = new GadgetLimitGuard({
      maxGadgetsPerResponse: options.maxGadgetsPerResponse ?? 0,
      logger: this.logger.getSubLogger({ name: "limit-guard" }),
    });

    this.parser = new GadgetCallParser({
      startPrefix: options.gadgetStartPrefix,
      endPrefix: options.gadgetEndPrefix,
      argPrefix: options.gadgetArgPrefix,
    });

    const executor = new GadgetExecutor({
      registry: options.registry,
      requestHumanInput: options.requestHumanInput,
      logger: this.logger.getSubLogger({ name: "executor" }),
      defaultGadgetTimeoutMs: options.defaultGadgetTimeoutMs,
      errorFormatterOptions: { argPrefix: options.gadgetArgPrefix },
      client: options.client,
      mediaStore: options.mediaStore,
      agentConfig: options.agentConfig,
      subagentConfig: options.subagentConfig,
      // Tree context for gadget execution
      tree: options.tree,
      parentNodeId: options.parentNodeId,
      baseDepth: options.baseDepth,
      // Parent observer hooks for subagent visibility
      parentObservers: options.parentObservers,
      // Current agent's observers for subagent inheritance
      currentObservers: options.hooks?.observers,
      // Shared rate limit tracker for coordinated throttling across subagents
      rateLimitTracker: options.rateLimitTracker,
      // Shared retry config for consistent backoff behavior across subagents
      retryConfig: options.retryConfig,
    });

    const hookLifecycle = new GadgetHookLifecycle({
      iteration: options.iteration,
      hooks: this.hooks,
      logger: this.logger,
      executor,
      tree: options.tree,
      parentObservers: options.parentObservers,
      dependencyResolver: this.dependencyResolver,
    });

    this.dispatcher = new GadgetDispatcher({
      iteration: options.iteration,
      hookLifecycle,
      dependencyResolver: this.dependencyResolver,
      concurrencyManager,
      limitGuard: this.limitGuard,
      gadgetExecutionMode: options.gadgetExecutionMode ?? "parallel",
      tree: options.tree,
      parentNodeId: options.parentNodeId,
      hooks: this.hooks,
      parentObservers: options.parentObservers,
      logger: this.logger.getSubLogger({ name: "dispatcher" }),
      pushToQueue: (evt) => this.completedResultsQueue.push(evt),
      drainQueue: () => {
        const evts = [...this.completedResultsQueue];
        this.completedResultsQueue = [];
        return evts;
      },
      inFlightTimeoutMs: options.inFlightTimeoutMs,
    });
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
    let thinkingContent = "";

    // Mutable state for gadget result tracking (passed to trackGadgetResult helper)
    const state = { didExecuteGadgets: false, shouldBreakLoop: false };

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
          this.trackGadgetResult(processedEvent, state);
        }
      }

      // Step 4: Drain completed parallel gadget results (real-time streaming)
      // This yields results from gadgets that completed during this chunk processing
      for (const evt of this.drainCompletedResults()) {
        yield evt;

        this.trackGadgetResult(evt, state);
      }

      // Step 5: Break stream loop if gadget limit exceeded
      // This stops reading further chunks, letting in-flight gadgets complete
      // and allowing the agent to continue to the next iteration
      if (this.limitGuard.isLimitExceeded) {
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

        this.trackGadgetResult(processedEvent, state);
      }
    }

    // Wait for all in-flight parallel gadgets to complete, yielding events in real-time
    // This enables subagent events to be displayed during long-running gadget execution
    for await (const evt of this.dispatcher.waitForInFlightExecutions()) {
      yield evt;

      this.trackGadgetResult(evt, state);
    }

    // Drain any remaining completed results (stragglers that finished after final poll)
    for (const evt of this.drainCompletedResults()) {
      yield evt;

      this.trackGadgetResult(evt, state);
    }

    // Final pass to process any remaining pending gadgets
    // This handles cases where the last gadgets in the stream have dependencies
    // (now that in-flight gadgets have completed, their dependents can execute)
    for await (const evt of this.dispatcher.processPendingGadgets()) {
      yield evt;

      this.trackGadgetResult(evt, state);
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
      shouldBreakLoop: state.shouldBreakLoop,
      didExecuteGadgets: state.didExecuteGadgets,
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
      for await (const e of this.dispatcher.dispatch(event.call)) {
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
   * Update gadget result tracking flags based on a stream event.
   * Checks if the event is a gadget_result and, if so, marks gadgets as executed
   * and sets the break-loop flag when the result requests it.
   *
   * @param evt - The stream event to inspect
   * @param state - Mutable state object holding the tracking flags
   */
  private trackGadgetResult(
    evt: StreamEvent,
    state: { didExecuteGadgets: boolean; shouldBreakLoop: boolean },
  ): void {
    if (evt.type === "gadget_result") {
      state.didExecuteGadgets = true;
      if (evt.result.breaksLoop) {
        state.shouldBreakLoop = true;
      }
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
    await Promise.allSettled(observers.map((observer) => safeObserve(observer, this.logger)));
  }

  // ==========================================================================
  // Public accessors for cross-iteration dependency tracking
  // ==========================================================================

  /**
   * Get all invocation IDs that completed successfully in this iteration.
   * Used by Agent to accumulate completed IDs across iterations.
   */
  getCompletedInvocationIds(): Set<string> {
    return this.dependencyResolver.getCompletedInvocationIds();
  }

  /**
   * Get all invocation IDs that failed in this iteration.
   * Used by Agent to accumulate failed IDs across iterations.
   */
  getFailedInvocationIds(): Set<string> {
    return this.dependencyResolver.getFailedInvocationIds();
  }
}
