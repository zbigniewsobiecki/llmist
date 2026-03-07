/**
 * GadgetDependencyResolver: Tracks and resolves gadget execution dependencies.
 *
 * Extracted from StreamProcessor to provide a focused, testable module for
 * managing the DAG of gadget dependencies across a single stream iteration.
 *
 * Manages:
 * - Gadgets awaiting their dependencies
 * - Completed gadget results (for dependency satisfaction checks)
 * - Failed invocations (for dependency skip propagation)
 * - Cross-iteration dependency state (prior completed/failed invocations)
 */

import type { GadgetExecutionResult, ParsedGadgetCall } from "../gadgets/types.js";

/**
 * Options for constructing a GadgetDependencyResolver.
 */
export interface GadgetDependencyResolverOptions {
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
}

/**
 * GadgetDependencyResolver: Manages dependency state and resolution logic
 * for the gadget execution DAG within a single stream processing iteration.
 *
 * Provides a clean API for:
 * - Queuing gadgets that are waiting on dependencies
 * - Recording completed and failed gadget results
 * - Querying which gadgets are ready to execute
 * - Checking whether all dependencies have been satisfied or failed
 *
 * @example
 * ```typescript
 * const resolver = new GadgetDependencyResolver({
 *   priorCompletedInvocations: new Set(["prev_gadget"]),
 * });
 *
 * resolver.addPending(gadgetCall);
 * // ...after dependency executes:
 * resolver.markComplete(result);
 *
 * const ready = resolver.getReadyCalls();
 * ```
 */
export class GadgetDependencyResolver {
  /** Gadgets waiting for their dependencies to complete */
  private gadgetsAwaitingDependencies: Map<string, ParsedGadgetCall> = new Map();
  /** Completed gadget results, keyed by invocation ID */
  private completedResults: Map<string, GadgetExecutionResult> = new Map();
  /** Invocation IDs of gadgets that have failed (error or skipped due to dependency) */
  private failedInvocations: Set<string> = new Set();

  /** Invocation IDs completed in previous iterations (read-only) */
  private readonly priorCompletedInvocations: Set<string>;
  /** Invocation IDs that failed in previous iterations (read-only) */
  private readonly priorFailedInvocations: Set<string>;

  constructor(options: GadgetDependencyResolverOptions = {}) {
    this.priorCompletedInvocations = options.priorCompletedInvocations ?? new Set();
    this.priorFailedInvocations = options.priorFailedInvocations ?? new Set();
  }

  // ==========================================================================
  // State mutation
  // ==========================================================================

  /**
   * Queue a gadget call that is waiting for one or more dependencies to complete.
   * Call this when a gadget's dependencies are not yet all satisfied.
   *
   * @param call - The parsed gadget call to defer
   */
  addPending(call: ParsedGadgetCall): void {
    this.gadgetsAwaitingDependencies.set(call.invocationId, call);
  }

  /**
   * Record that a gadget completed successfully.
   * This may unblock other gadgets that depend on this invocation.
   *
   * Also marks as failed if the result contains an error.
   *
   * @param result - The completed gadget execution result
   */
  markComplete(result: GadgetExecutionResult): void {
    this.completedResults.set(result.invocationId, result);
    if (result.error) {
      this.failedInvocations.add(result.invocationId);
    }
  }

  /**
   * Mark an invocation ID as failed without recording a full result.
   * Use this for gadgets that are skipped before execution (e.g., limit exceeded,
   * self-referential dependency, dependency skip).
   *
   * @param invocationId - The invocation ID to mark as failed
   */
  markFailed(invocationId: string): void {
    this.failedInvocations.add(invocationId);
  }

  /**
   * Remove a gadget from the pending queue (called just before execution).
   *
   * @param invocationId - The invocation ID to remove from pending
   */
  removePending(invocationId: string): void {
    this.gadgetsAwaitingDependencies.delete(invocationId);
  }

  /**
   * Clear all remaining pending gadgets (e.g., after handling unresolvable deps).
   */
  clearPending(): void {
    this.gadgetsAwaitingDependencies.clear();
  }

  // ==========================================================================
  // Queries
  // ==========================================================================

  /**
   * Get all gadget calls currently waiting for dependencies.
   * Returns entries as [invocationId, call] pairs.
   */
  getPendingEntries(): Array<[string, ParsedGadgetCall]> {
    return Array.from(this.gadgetsAwaitingDependencies.entries());
  }

  /**
   * Get the number of gadgets currently waiting for dependencies.
   */
  get pendingCount(): number {
    return this.gadgetsAwaitingDependencies.size;
  }

  /**
   * Check whether a given invocation ID has been completed successfully
   * (either in this iteration or a prior one).
   */
  isCompleted(invocationId: string): boolean {
    return (
      this.completedResults.has(invocationId) || this.priorCompletedInvocations.has(invocationId)
    );
  }

  /**
   * Check whether a given invocation ID has failed
   * (either in this iteration or a prior one).
   */
  isFailed(invocationId: string): boolean {
    return (
      this.failedInvocations.has(invocationId) || this.priorFailedInvocations.has(invocationId)
    );
  }

  /**
   * Get the execution result for a completed invocation, if available.
   * Only returns results from the current iteration; prior iterations
   * are tracked by ID only.
   */
  getCompletedResult(invocationId: string): GadgetExecutionResult | undefined {
    return this.completedResults.get(invocationId);
  }

  /**
   * Check if all dependencies for a gadget call are satisfied.
   * A dependency is satisfied if it completed in this or a prior iteration.
   *
   * @param call - The gadget call whose dependencies to check
   * @returns true if all deps are satisfied, false if any are still pending
   */
  isAllSatisfied(call: ParsedGadgetCall): boolean {
    return call.dependencies.every((dep) => this.isCompleted(dep));
  }

  /**
   * Find the first failed dependency for a gadget call, if any.
   * A dependency is considered failed if it failed in this or a prior iteration.
   *
   * @param call - The gadget call to check
   * @returns The invocation ID of the failed dependency, or undefined if none
   */
  getFailedDependency(call: ParsedGadgetCall): string | undefined {
    return call.dependencies.find((dep) => this.isFailed(dep));
  }

  /**
   * Separate the pending gadgets into two groups:
   * - Those ready to execute (all deps satisfied)
   * - Those ready to skip (at least one dep has failed)
   *
   * Gadgets that are neither ready nor skippable remain pending.
   *
   * @returns Object with `readyToExecute` and `readyToSkip` arrays
   */
  getReadyCalls(): {
    readyToExecute: ParsedGadgetCall[];
    readyToSkip: Array<{ call: ParsedGadgetCall; failedDep: string }>;
  } {
    const readyToExecute: ParsedGadgetCall[] = [];
    const readyToSkip: Array<{ call: ParsedGadgetCall; failedDep: string }> = [];

    for (const [_invocationId, call] of this.gadgetsAwaitingDependencies) {
      const failedDep = this.getFailedDependency(call);
      if (failedDep) {
        readyToSkip.push({ call, failedDep });
        continue;
      }

      if (this.isAllSatisfied(call)) {
        readyToExecute.push(call);
      }
    }

    return { readyToExecute, readyToSkip };
  }

  // ==========================================================================
  // Cross-iteration accessors (for Agent to accumulate state)
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
