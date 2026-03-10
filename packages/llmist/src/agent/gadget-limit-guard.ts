/**
 * GadgetLimitGuard: Enforces the maxGadgetsPerResponse limit.
 *
 * Extracted from StreamProcessor to provide a focused, testable module for
 * tracking how many gadgets have been started in a single LLM response and
 * emitting skip events when the limit is exceeded.
 *
 * Manages:
 * - `maxGadgetsPerResponse` threshold (0 = unlimited)
 * - `gadgetStartedCount` counter of gadgets admitted for execution
 * - `limitExceeded` flag used by StreamProcessor to break the chunk loop
 */

import type { ILogObj, Logger } from "tslog";
import type { ExecutionTree } from "../core/execution-tree.js";
import type { GadgetSkippedEvent, ParsedGadgetCall, StreamEvent } from "../gadgets/types.js";
import { createLogger } from "../logging/logger.js";
import type { Observers } from "./hooks.js";
import { notifyGadgetSkipped } from "./observer-notifier.js";

/**
 * Options for constructing a GadgetLimitGuard.
 */
export interface GadgetLimitGuardOptions {
  /** Maximum number of gadgets to admit per response. 0 = unlimited. */
  maxGadgetsPerResponse: number;

  /** Logger instance */
  logger?: Logger<ILogObj>;
}

/**
 * GadgetLimitGuard: Tracks how many gadgets have been admitted for execution
 * within a single LLM response and enforces the configured limit.
 *
 * @example
 * ```typescript
 * const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 5 });
 *
 * // Before executing a gadget:
 * for await (const evt of guard.checkAndIncrement(call, { tree, hooks, ... })) {
 *   yield evt; // skip events if limit exceeded
 * }
 * if (guard.isLimitExceeded) {
 *   return; // skip execution
 * }
 * ```
 */
export class GadgetLimitGuard {
  private readonly maxGadgetsPerResponse: number;
  private readonly logger: Logger<ILogObj>;
  private gadgetStartedCount = 0;
  private _limitExceeded = false;

  constructor(options: GadgetLimitGuardOptions) {
    this.maxGadgetsPerResponse = options.maxGadgetsPerResponse;
    this.logger = options.logger ?? createLogger({ name: "llmist:gadget-limit-guard" });
  }

  /**
   * Whether the gadget limit has been exceeded in this response.
   * When true, the stream loop should stop reading further chunks.
   */
  get isLimitExceeded(): boolean {
    return this._limitExceeded;
  }

  /**
   * Check whether this gadget call is within the response limit.
   *
   * - If no limit is configured (maxGadgetsPerResponse <= 0), always admits.
   * - If the limit has already been reached, emits skip events and sets the
   *   `isLimitExceeded` flag.
   * - Otherwise, increments the counter and allows execution.
   *
   * The async generator yields zero or more StreamEvents (skip events when
   * the limit is exceeded). When the generator returns, callers should check
   * `guard.isLimitExceeded` to decide whether to proceed with execution.
   *
   * @param call - The parsed gadget call being evaluated
   * @param ctx  - Observer/tree context needed to emit skip events
   */
  async *checkAndIncrement(
    call: ParsedGadgetCall,
    ctx: {
      tree?: ExecutionTree;
      hooks?: Observers;
      parentObservers?: Observers;
      iteration: number;
      logger: Logger<ILogObj>;
      /** Called when this specific call is skipped due to limit, before yielding the skip event */
      markFailed?: (invocationId: string) => void;
    },
  ): AsyncGenerator<StreamEvent> {
    // No limit configured — always admit
    if (this.maxGadgetsPerResponse <= 0) {
      this.gadgetStartedCount++;
      return;
    }

    // Limit already reached — skip this gadget
    if (this.gadgetStartedCount >= this.maxGadgetsPerResponse) {
      const errorMessage = `Gadget limit (${this.maxGadgetsPerResponse}) exceeded. Consider calling fewer gadgets per response.`;

      // Set flag to break stream loop - stops reading further chunks
      this._limitExceeded = true;

      this.logger.info("Gadget limit exceeded, stopping stream processing", {
        gadgetName: call.gadgetName,
        invocationId: call.invocationId,
        limit: this.maxGadgetsPerResponse,
        currentCount: this.gadgetStartedCount,
      });

      // Mark skipped in execution tree
      if (ctx.tree) {
        const gadgetNode = ctx.tree.getNodeByInvocationId(call.invocationId);
        if (gadgetNode) {
          ctx.tree.skipGadget(
            gadgetNode.id,
            "maxGadgetsPerResponse",
            errorMessage,
            "limit_exceeded",
          );
        }
      }

      // Mark as failed in the dependency resolver (so dependents can be skipped)
      ctx.markFailed?.(call.invocationId);

      // Emit skip events
      yield* this._emitSkipEvents(call, "maxGadgetsPerResponse", errorMessage, ctx);
      return;
    }

    // Limit not exceeded — admit this gadget
    this.gadgetStartedCount++;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async *_emitSkipEvents(
    call: ParsedGadgetCall,
    failedDep: string,
    errorMessage: string,
    ctx: {
      tree?: ExecutionTree;
      hooks?: Observers;
      parentObservers?: Observers;
      iteration: number;
      logger: Logger<ILogObj>;
    },
  ): AsyncGenerator<StreamEvent> {
    const skipEvent: GadgetSkippedEvent = {
      type: "gadget_skipped",
      gadgetName: call.gadgetName,
      invocationId: call.invocationId,
      parameters: call.parameters ?? {},
      failedDependency: failedDep,
      failedDependencyError: errorMessage,
    };
    yield skipEvent;

    await notifyGadgetSkipped({
      tree: ctx.tree,
      hooks: ctx.hooks,
      parentObservers: ctx.parentObservers,
      logger: ctx.logger,
      iteration: ctx.iteration,
      gadgetName: call.gadgetName,
      invocationId: call.invocationId,
      parameters: call.parameters ?? {},
      failedDependency: failedDep,
      failedDependencyError: errorMessage,
    });
  }
}
