/**
 * RetryOrchestrator: Encapsulates retry logic for LLM stream execution.
 *
 * Extracted from the 155-line `executeWithRetry()` method in `agent.ts` to provide
 * a focused, testable module for managing retry attempts with exponential backoff,
 * Retry-After header support, jitter, and observer hook notification.
 *
 * Follows the `GadgetDependencyResolver` pattern: constructor receives all dependencies,
 * exposes a clean public API.
 */

import type { ILogObj, Logger } from "tslog";
import { EmptyCompletionError } from "../core/errors.js";
import type { ExecutionTree } from "../core/execution-tree.js";
import type { LLMGenerationOptions } from "../core/options.js";
import type { ResolvedRetryConfig } from "../core/retry.js";
import { extractRetryAfterMs, isRetryableError } from "../core/retry.js";
import type { StreamCompletionEvent, StreamEvent } from "../gadgets/types.js";
import type { AgentHooks, ObserveRetryAttemptContext } from "./hooks.js";
import { safeObserve } from "./safe-observe.js";
import type { StreamProcessor } from "./stream-processor.js";
import { getSubagentContextForNode } from "./tree-hook-bridge.js";

/**
 * Determines whether a stream completion carried no usable output at all —
 * no text, no executed gadgets, and no reasoning content.
 *
 * This is the signature of a provider glitch (e.g. a 200-OK response with an
 * empty body): the call "succeeded" but produced nothing. A turn with empty
 * text but an executed gadget is NOT empty — the tool call is the output — so
 * `didExecuteGadgets` short-circuits to `false`.
 */
export function isEmptyCompletion(meta: StreamCompletionEvent): boolean {
  if (meta.didExecuteGadgets) return false;
  if (meta.rawResponse?.trim() || meta.finalMessage?.trim()) return false;
  if (meta.thinkingContent?.trim()) return false;
  return true;
}

/**
 * The final result returned by a successful `orchestrate()` call.
 * Contains stream metadata and accumulated tracking state from the final
 * successful attempt only (state is reset between retry attempts).
 */
export interface RetryResult {
  /** Stream completion metadata from the final successful attempt */
  streamMetadata: StreamCompletionEvent;
  /** All text content yielded during the final successful attempt */
  textOutputs: string[];
  /** All gadget result events from the final successful attempt */
  gadgetResults: StreamEvent[];
  /** Total number of gadget calls during the final successful attempt */
  gadgetCallCount: number;
}

/**
 * Callback type for creating an LLM stream.
 * Receives the same arguments as the corresponding `Agent.createStream()` method.
 */
export type CreateStreamFn = (
  llmOptions: LLMGenerationOptions,
  iteration: number,
  llmNodeId: string,
) => Promise<ReturnType<import("../core/client.js").LLMist["stream"]>>;

/**
 * Callback type for creating a StreamProcessor for a given iteration.
 */
export type CreateStreamProcessorFn = (iteration: number, llmNodeId: string) => StreamProcessor;

/**
 * Options for constructing a RetryOrchestrator.
 */
export interface RetryOrchestratorOptions {
  /** Resolved retry configuration controlling backoff behaviour */
  retryConfig: ResolvedRetryConfig;
  /** Logger for emitting warnings and errors */
  logger: Logger<ILogObj>;
  /** Agent hooks (observers) for emitting `onRetryAttempt` events */
  hooks: AgentHooks;
  /** Execution tree used to signal LLM response end and derive subagent context */
  tree: ExecutionTree;
  /** Sleep function (injectable for testing) */
  sleep: (ms: number) => Promise<void>;
}

/**
 * RetryOrchestrator: Manages all retry state and orchestration for a single
 * LLM stream execution attempt (across one or more stream attempts).
 *
 * Encapsulates:
 * - Attempt counter and max-attempts calculation
 * - Accumulated outputs (`textOutputs`, `gadgetResults`, `gadgetCallCount`)
 * - Backoff calculation: exponential factor, capping, Retry-After extraction, jitter
 * - Observer hook emission (`onRetryAttempt`) with correct context
 * - Cross-iteration invocation ID tracking (`completedInvocationIds`, `failedInvocationIds`)
 *
 * @example
 * ```typescript
 * const orchestrator = new RetryOrchestrator({
 *   retryConfig,
 *   logger,
 *   hooks,
 *   tree,
 *   sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
 * });
 *
 * const gen = orchestrator.orchestrate(llmOptions, iteration, llmNodeId, createStream, createStreamProcessor);
 * let next = await gen.next();
 * while (!next.done) {
 *   yield next.value;
 *   next = await gen.next();
 * }
 * const result = next.value; // RetryResult | null
 * ```
 */
export class RetryOrchestrator {
  private readonly retryConfig: ResolvedRetryConfig;
  private readonly logger: Logger<ILogObj>;
  private readonly hooks: AgentHooks;
  private readonly tree: ExecutionTree;
  private readonly sleep: (ms: number) => Promise<void>;

  /** Invocation IDs that completed in the last orchestrate() call */
  private completedInvocationIds: Set<string> = new Set();
  /** Invocation IDs that failed in the last orchestrate() call */
  private failedInvocationIds: Set<string> = new Set();

  constructor(options: RetryOrchestratorOptions) {
    this.retryConfig = options.retryConfig;
    this.logger = options.logger;
    this.hooks = options.hooks;
    this.tree = options.tree;
    this.sleep = options.sleep;
  }

  // ==========================================================================
  // Cross-iteration accessors (for Agent to accumulate IDs across iterations)
  // ==========================================================================

  /**
   * Returns the set of invocation IDs that completed successfully in the most
   * recent `orchestrate()` call. The Agent uses this to accumulate cross-iteration
   * dependency state.
   */
  getCompletedInvocationIds(): Set<string> {
    return this.completedInvocationIds;
  }

  /**
   * Returns the set of invocation IDs that failed in the most recent
   * `orchestrate()` call.
   */
  getFailedInvocationIds(): Set<string> {
    return this.failedInvocationIds;
  }

  // ==========================================================================
  // Core orchestration
  // ==========================================================================

  /**
   * Execute a single LLM call attempt with full retry orchestration.
   *
   * Handles stream creation, retry attempts with exponential backoff, error handling,
   * and state reset between attempts. Yields stream events in real-time and returns
   * the final stream completion metadata along with accumulated tracking state
   * (textOutputs, gadgetResults, gadgetCallCount) from the final successful attempt only.
   * State is reset between retry attempts to prevent accumulation of partial data.
   *
   * @param llmOptions - LLM generation options to pass to the stream
   * @param iteration - Current agent iteration number
   * @param llmNodeId - Node ID in the execution tree for this LLM call
   * @param createStream - Callback that creates the LLM stream
   * @param createStreamProcessor - Callback that creates the StreamProcessor
   */
  async *orchestrate(
    llmOptions: LLMGenerationOptions,
    iteration: number,
    llmNodeId: string,
    createStream: CreateStreamFn,
    createStreamProcessor: CreateStreamProcessorFn,
  ): AsyncGenerator<StreamEvent, RetryResult | null> {
    // Reset cross-iteration tracking for this orchestrate() call
    this.completedInvocationIds = new Set();
    this.failedInvocationIds = new Set();

    const maxStreamAttempts = this.retryConfig.enabled ? this.retryConfig.retries + 1 : 1;
    let streamAttempt = 0;
    let streamMetadata: StreamCompletionEvent | null = null;
    let gadgetCallCount = 0;
    const textOutputs: string[] = [];
    const gadgetResults: StreamEvent[] = [];
    // Set when every attempt returned an empty completion; thrown after the
    // loop so it never falls into the generic error-retry catch below.
    let emptyFailure: EmptyCompletionError | null = null;

    while (streamAttempt < maxStreamAttempts) {
      streamAttempt++;

      try {
        // Create LLM stream with rate limiting (retry is handled by this outer loop)
        const stream = await createStream(llmOptions, iteration, llmNodeId);

        // Process stream — ALL complexity delegated to StreamProcessor
        const processor = createStreamProcessor(iteration, llmNodeId);

        // Consume the stream processor generator, yielding events in real-time.
        // The final event is a StreamCompletionEvent containing metadata.
        for await (const event of processor.process(stream)) {
          if (event.type === "stream_complete") {
            // Capture the completion metadata but DEFER yielding it until
            // after the empty-completion check below. `stream_complete` is
            // always the final event from the processor, so deferring its
            // yield preserves event order for the success path while
            // ensuring a retried (discarded) empty attempt's terminal event
            // never reaches the consumer.
            //
            // Yielding `stream_complete` is load-bearing for any consumer
            // that needs the post-`waitForInFlightExecutions` boundary
            // (after every in-flight gadget body has completed). The
            // earlier `llm_response_end` event fires before gadgets
            // complete, so it can't be used as a "this iteration is fully
            // done" signal — that's exactly what `stream_complete` is for.
            streamMetadata = event;
            continue;
          }

          if (event.type === "llm_response_end") {
            // Signal that LLM finished generating (before gadgets complete).
            // This allows consumers to track "LLM thinking time" separately.
            this.tree.endLLMResponse(llmNodeId, {
              finishReason: event.finishReason,
              usage: event.usage,
            });
          }

          // Track outputs from this attempt for conversation history updates
          if (event.type === "text") {
            textOutputs.push(event.content);
          } else if (event.type === "gadget_result") {
            gadgetCallCount++;
            gadgetResults.push(event);
          }

          // Yield event to consumer in real-time
          // (includes subagent events from completedResultsQueue for real-time streaming)
          yield event;
        }

        // Collect completed/failed invocation IDs for cross-iteration dependency tracking
        for (const id of processor.getCompletedInvocationIds()) {
          this.completedInvocationIds.add(id);
        }
        for (const id of processor.getFailedInvocationIds()) {
          this.failedInvocationIds.add(id);
        }

        // Dropped-completion guard: a 200-OK response with no text, no tool
        // calls, and no reasoning AND no finish reason is a provider glitch
        // (the response was dropped), not a real turn. A deliberately empty
        // turn carries an explicit finish reason (e.g. "stop") — the model
        // chose to say nothing, often after a prior tool call — and must NOT
        // be retried. Route only genuine drops through the same backoff
        // machinery as thrown errors so a blank reply is retried instead of
        // silently committed.
        if (
          this.retryConfig.enabled &&
          this.retryConfig.retryOnEmpty &&
          streamMetadata !== null &&
          !streamMetadata.finishReason &&
          isEmptyCompletion(streamMetadata)
        ) {
          const emptyError = new EmptyCompletionError({
            iteration,
            finishReason: streamMetadata.finishReason,
          });

          if (streamAttempt < maxStreamAttempts) {
            await this.backoffBeforeRetry(
              emptyError,
              streamAttempt,
              maxStreamAttempts,
              iteration,
              llmNodeId,
            );

            // Reset state for retry attempt (discard the empty attempt)
            streamMetadata = null;
            gadgetCallCount = 0;
            textOutputs.length = 0;
            gadgetResults.length = 0;

            continue;
          }

          // Every attempt came back empty. Record the failure and break; it
          // is thrown after the loop so it cannot re-enter the catch below.
          emptyFailure = emptyError;
          break;
        }

        // Stream completed successfully — emit the deferred terminal event
        // and break the retry loop.
        if (streamMetadata !== null) {
          yield streamMetadata;
        }
        break;
      } catch (streamError) {
        // Check if this is a retryable error and we have attempts remaining
        const error = streamError as Error;
        const canRetry = this.retryConfig.enabled && streamAttempt < maxStreamAttempts;
        const shouldRetryError = this.retryConfig.shouldRetry
          ? this.retryConfig.shouldRetry(error)
          : isRetryableError(error);

        if (canRetry && shouldRetryError) {
          await this.backoffBeforeRetry(
            error,
            streamAttempt,
            maxStreamAttempts,
            iteration,
            llmNodeId,
          );

          // Reset state for retry attempt (clear any partial results from failed attempt)
          streamMetadata = null;
          gadgetCallCount = 0;
          textOutputs.length = 0;
          gadgetResults.length = 0;

          continue;
        }

        // Not retryable or retries exhausted
        if (streamAttempt > 1) {
          // We had at least one retry — call exhausted callback
          this.logger.error(`Stream iteration failed after ${streamAttempt} attempts`, {
            error: error.message,
            iteration,
          });
          this.retryConfig.onRetriesExhausted?.(error, streamAttempt);
        }
        throw error;
      }
    }

    // Surface an all-empty run as a hard failure rather than a silent blank.
    if (emptyFailure !== null) {
      this.logger.error(`LLM returned empty completions on all ${streamAttempt} attempts`, {
        iteration,
      });
      this.retryConfig.onRetriesExhausted?.(emptyFailure, streamAttempt);
      throw emptyFailure;
    }

    return streamMetadata !== null
      ? { streamMetadata, textOutputs, gadgetResults, gadgetCallCount }
      : null;
  }

  /**
   * Apply the configured backoff before a retry attempt: compute the delay
   * (Retry-After hint or exponential backoff, with optional jitter), emit the
   * retry log, fire the `onRetry` callback and `onRetryAttempt` observer, then
   * sleep. Shared by the error-retry and empty-completion-retry paths so both
   * honour identical backoff and observer semantics.
   */
  private async backoffBeforeRetry(
    error: Error,
    streamAttempt: number,
    maxStreamAttempts: number,
    iteration: number,
    llmNodeId: string,
  ): Promise<void> {
    // Extract Retry-After hint if present
    const retryAfterMs = this.retryConfig.respectRetryAfter ? extractRetryAfterMs(error) : null;

    // Calculate delay: use Retry-After if available, otherwise exponential backoff
    const baseDelay = this.retryConfig.minTimeout * this.retryConfig.factor ** (streamAttempt - 1);
    const cappedBaseDelay = Math.min(baseDelay, this.retryConfig.maxTimeout);
    const delay =
      retryAfterMs !== null
        ? Math.min(retryAfterMs, this.retryConfig.maxRetryAfterMs)
        : cappedBaseDelay;

    // Add jitter if randomize is enabled
    const finalDelay = this.retryConfig.randomize ? delay * (0.5 + Math.random()) : delay;

    this.logger.warn(
      `Stream iteration failed (attempt ${streamAttempt}/${maxStreamAttempts}), retrying...`,
      {
        error: error.message,
        retriesLeft: maxStreamAttempts - streamAttempt,
        delayMs: Math.round(finalDelay),
        retryAfterMs,
      },
    );

    // Call retry callback
    this.retryConfig.onRetry?.(error, streamAttempt);

    // Emit observer hook for retry attempt
    await safeObserve(async () => {
      if (this.hooks.observers?.onRetryAttempt) {
        const subagentContext = getSubagentContextForNode(this.tree, llmNodeId);
        const hookContext: ObserveRetryAttemptContext = {
          iteration,
          attemptNumber: streamAttempt,
          retriesLeft: maxStreamAttempts - streamAttempt,
          error,
          retryAfterMs: retryAfterMs ?? undefined,
          logger: this.logger,
          subagentContext,
        };
        await this.hooks.observers.onRetryAttempt(hookContext);
      }
    }, this.logger);

    // Wait before retrying
    await this.sleep(finalDelay);
  }
}
