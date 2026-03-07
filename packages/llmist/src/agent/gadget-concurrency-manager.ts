/**
 * GadgetConcurrencyManager: Manages concurrency control for gadget execution.
 *
 * Extracted from StreamProcessor to provide a focused, testable module for
 * managing concurrency state and logic during stream processing.
 *
 * Manages:
 * - Active execution counts per gadget name
 * - Concurrency queues for gadgets waiting for a slot
 * - In-flight executions (fire-and-forget parallel gadgets)
 * - Exclusive gadget queue (runs alone after in-flight complete)
 */

import type { ILogObj, Logger } from "tslog";
import type { GadgetRegistry } from "../gadgets/registry.js";
import type { ParsedGadgetCall, SubagentConfigMap } from "../gadgets/types.js";
import { createLogger } from "../logging/logger.js";

/**
 * Options for constructing a GadgetConcurrencyManager.
 */
export interface GadgetConcurrencyManagerOptions {
  /** Gadget registry for reading maxConcurrent/exclusive gadget config */
  registry: GadgetRegistry;

  /** Subagent configuration map for external concurrency limits */
  subagentConfig?: SubagentConfigMap;

  /** Logger instance */
  logger?: Logger<ILogObj>;
}

/**
 * GadgetConcurrencyManager: Manages concurrency state and logic for gadget execution.
 *
 * Provides a clean API for:
 * - Checking whether a gadget can start immediately (canStart)
 * - Tracking active execution counts (trackExecution / onComplete)
 * - Queueing gadgets that exceed concurrency limits (queueForLater)
 * - Deferring exclusive gadgets until in-flight work finishes (exclusiveQueue)
 * - Waiting for all in-flight executions to finish (waitForAll)
 *
 * @example
 * ```typescript
 * const manager = new GadgetConcurrencyManager({ registry, subagentConfig });
 *
 * if (manager.canStart(call)) {
 *   manager.trackExecution(call.invocationId, executePromise);
 * } else {
 *   manager.queueForLater(call);
 * }
 *
 * // on completion:
 * manager.onComplete(call.gadgetName);
 * ```
 */
export class GadgetConcurrencyManager {
  private readonly registry: GadgetRegistry;
  private readonly subagentConfig?: SubagentConfigMap;
  private readonly logger: Logger<ILogObj>;

  /** Track active execution count per gadget name */
  private activeCountByGadget: Map<string, number> = new Map();

  /** Queue of gadgets waiting for a concurrency slot (per gadget name) */
  private concurrencyQueue: Map<string, ParsedGadgetCall[]> = new Map();

  /** All active gadget promises, keyed by invocationId */
  private inFlightExecutions: Map<string, Promise<void>> = new Map();

  /** Queue of exclusive gadgets deferred until in-flight gadgets complete */
  private exclusiveQueue: ParsedGadgetCall[] = [];

  constructor(options: GadgetConcurrencyManagerOptions) {
    this.registry = options.registry;
    this.subagentConfig = options.subagentConfig;
    this.logger = options.logger ?? createLogger({ name: "llmist:gadget-concurrency-manager" });
  }

  // ==========================================================================
  // Concurrency limit resolution
  // ==========================================================================

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
  getConcurrencyLimit(gadgetName: string): number {
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

  // ==========================================================================
  // Concurrency checks
  // ==========================================================================

  /**
   * Check whether a gadget call can start immediately given current concurrency state.
   * Returns false if:
   * - The gadget is exclusive and other gadgets are in-flight
   * - The gadget has a concurrency limit and it is already reached
   *
   * Does NOT modify any state.
   */
  canStart(call: ParsedGadgetCall): boolean {
    const gadget = this.registry.get(call.gadgetName);

    // Exclusive gadgets must wait for all in-flight gadgets to complete
    if (gadget?.exclusive && this.inFlightExecutions.size > 0) {
      return false;
    }

    // Check per-gadget concurrency limit
    const limit = this.getConcurrencyLimit(call.gadgetName);
    if (limit > 0) {
      const activeCount = this.activeCountByGadget.get(call.gadgetName) ?? 0;
      if (activeCount >= limit) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check whether a gadget is marked as exclusive.
   */
  isExclusive(gadgetName: string): boolean {
    const gadget = this.registry.get(gadgetName);
    return gadget?.exclusive === true;
  }

  /**
   * Get the current count of in-flight (actively executing) gadgets.
   */
  get inFlightCount(): number {
    return this.inFlightExecutions.size;
  }

  /**
   * Get the total count of actively executing gadgets across all gadget types.
   * Used to know when all work is truly complete.
   */
  getTotalActiveGadgetCount(): number {
    let total = 0;
    for (const count of this.activeCountByGadget.values()) {
      total += count;
    }
    return total;
  }

  /**
   * Check if there are any gadgets waiting in concurrency queues.
   */
  hasQueuedGadgets(): boolean {
    for (const queue of this.concurrencyQueue.values()) {
      if (queue.length > 0) return true;
    }
    return false;
  }

  /**
   * Get total count of queued gadgets across all queues.
   */
  getQueuedGadgetCount(): number {
    let count = 0;
    for (const queue of this.concurrencyQueue.values()) {
      count += queue.length;
    }
    return count;
  }

  /**
   * Check if there are exclusive gadgets waiting.
   */
  get hasExclusiveQueued(): boolean {
    return this.exclusiveQueue.length > 0;
  }

  /**
   * Drain and return all exclusive gadgets from the queue.
   * The caller is responsible for executing them.
   */
  drainExclusiveQueue(): ParsedGadgetCall[] {
    const queue = this.exclusiveQueue;
    this.exclusiveQueue = [];
    return queue;
  }

  // ==========================================================================
  // State mutation
  // ==========================================================================

  /**
   * Track an in-flight gadget execution.
   * Increments the active count for the gadget name and registers the promise.
   *
   * @param invocationId - Unique ID for this execution
   * @param gadgetName - Name of the gadget being executed
   * @param promise - The execution promise to track
   */
  trackExecution(invocationId: string, gadgetName: string, promise: Promise<void>): void {
    const currentCount = this.activeCountByGadget.get(gadgetName) ?? 0;
    this.activeCountByGadget.set(gadgetName, currentCount + 1);
    this.inFlightExecutions.set(invocationId, promise);
  }

  /**
   * Called when a gadget execution completes.
   * Decrements active count and triggers queue processing if a slot opened up.
   *
   * @param gadgetName - Name of the gadget that completed
   * @returns The next queued gadget call for this gadget, if one was promoted, otherwise null
   */
  onComplete(gadgetName: string): ParsedGadgetCall | null {
    const newCount = (this.activeCountByGadget.get(gadgetName) ?? 1) - 1;
    this.activeCountByGadget.set(gadgetName, newCount);
    return this.promoteFromQueue(gadgetName);
  }

  /**
   * Queue a gadget for later execution due to a concurrency limit being reached.
   *
   * @param call - The gadget call to defer
   */
  queueForLater(call: ParsedGadgetCall): void {
    this.logger.debug("Gadget queued due to concurrency limit", {
      gadgetName: call.gadgetName,
      invocationId: call.invocationId,
      activeCount: this.activeCountByGadget.get(call.gadgetName) ?? 0,
      limit: this.getConcurrencyLimit(call.gadgetName),
    });
    const queue = this.concurrencyQueue.get(call.gadgetName) ?? [];
    queue.push(call);
    this.concurrencyQueue.set(call.gadgetName, queue);
  }

  /**
   * Queue a gadget for exclusive execution (after all in-flight complete).
   *
   * @param call - The exclusive gadget call to defer
   */
  queueExclusive(call: ParsedGadgetCall): void {
    this.logger.debug("Deferring exclusive gadget until in-flight gadgets complete", {
      gadgetName: call.gadgetName,
      invocationId: call.invocationId,
      inFlightCount: this.inFlightExecutions.size,
    });
    this.exclusiveQueue.push(call);
  }

  /**
   * Clear the inFlightExecutions map after all promises have completed.
   * Called after waitForAll resolves.
   */
  clearInFlight(): void {
    this.inFlightExecutions.clear();
  }

  // ==========================================================================
  // Waiting
  // ==========================================================================

  /**
   * Wait for all currently in-flight gadget executions to complete.
   * Resolves when the Promise.all of all tracked promises resolves.
   *
   * Note: new executions may be started during waiting (from the queue).
   * Callers should loop until inFlightCount === 0 AND hasQueuedGadgets() === false.
   */
  async waitForAll(): Promise<void> {
    if (this.inFlightExecutions.size === 0) return;
    await Promise.all(this.inFlightExecutions.values());
  }

  /**
   * Get a promise that resolves when all current in-flight executions complete.
   * Returns a resolved promise if no executions are in-flight.
   */
  getAllDonePromise(): Promise<"done"> {
    if (this.inFlightExecutions.size === 0) {
      return Promise.resolve("done" as const);
    }
    return Promise.all(this.inFlightExecutions.values()).then(() => "done" as const);
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Check the concurrency queue for a gadget name and promote the next queued
   * call if a slot is available.
   *
   * @param gadgetName - The gadget name to check
   * @returns The promoted call, or null if queue is empty or limit still reached
   */
  private promoteFromQueue(gadgetName: string): ParsedGadgetCall | null {
    const queue = this.concurrencyQueue.get(gadgetName);
    if (!queue || queue.length === 0) return null;

    const limit = this.getConcurrencyLimit(gadgetName);
    const activeCount = this.activeCountByGadget.get(gadgetName) ?? 0;

    if (limit === 0 || activeCount < limit) {
      const nextCall = queue.shift()!;
      this.logger.debug("Processing queued gadget", {
        gadgetName,
        invocationId: nextCall.invocationId,
        remainingInQueue: queue.length,
      });
      return nextCall;
    }

    return null;
  }
}
