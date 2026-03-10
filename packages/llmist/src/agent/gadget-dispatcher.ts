/**
 * GadgetDispatcher: Orchestrates the dispatch decision tree for gadget execution.
 *
 * Extracted from StreamProcessor to provide a focused module for:
 * - Routing gadget calls through the dependency/concurrency/limit decision tree
 * - Managing fire-and-forget parallel execution and queue draining
 * - Resolving pending gadgets whose dependencies were just satisfied
 * - Handling failed dependencies (skip, execute_anyway, use_fallback)
 * - Waiting for all in-flight parallel executions to finish
 *
 * Orchestrates:
 *   GadgetLimitGuard       — enforces maxGadgetsPerResponse
 *   GadgetDependencyResolver — DAG dependency tracking
 *   GadgetConcurrencyManager — per-gadget concurrency limits + exclusive queue
 *   GadgetHookLifecycle    — full hook lifecycle per gadget
 *
 * @module agent/gadget-dispatcher
 */

import type { ILogObj, Logger } from "tslog";
import type { ExecutionTree, NodeId } from "../core/execution-tree.js";
import type {
  GadgetExecutionMode,
  GadgetExecutionResult,
  GadgetSkippedEvent,
  ParsedGadgetCall,
  StreamEvent,
} from "../gadgets/types.js";
import { createLogger } from "../logging/logger.js";
import type { GadgetConcurrencyManager } from "./gadget-concurrency-manager.js";
import type { GadgetDependencyResolver } from "./gadget-dependency-resolver.js";
import type { GadgetHookLifecycle } from "./gadget-hook-lifecycle.js";
import type { GadgetLimitGuard } from "./gadget-limit-guard.js";
import type {
  AgentHooks,
  DependencySkipAction,
  DependencySkipControllerContext,
  Observers,
} from "./hooks.js";
import { notifyGadgetSkipped } from "./observer-notifier.js";

/**
 * Options for constructing a GadgetDispatcher.
 */
export interface GadgetDispatcherOptions {
  /** Current iteration number */
  iteration: number;

  /** Hook lifecycle orchestrator for single-gadget execution */
  hookLifecycle: GadgetHookLifecycle;

  /** Dependency resolver (manages the DAG) */
  dependencyResolver: GadgetDependencyResolver;

  /** Concurrency manager */
  concurrencyManager: GadgetConcurrencyManager;

  /** Gadget limit guard */
  limitGuard: GadgetLimitGuard;

  /** Gadget execution mode */
  gadgetExecutionMode: GadgetExecutionMode;

  /** Execution tree for tree-tracking operations */
  tree?: ExecutionTree;

  /** Parent node ID for gadget nodes added to the tree */
  parentNodeId?: NodeId | null;

  /** Current agent hooks */
  hooks: AgentHooks;

  /** Parent agent observer hooks for subagent visibility */
  parentObservers?: Observers;

  /** Logger instance */
  logger?: Logger<ILogObj>;

  /**
   * Callback to push completed events into the outer queue.
   * Used during fire-and-forget parallel execution so results can be
   * streamed to the caller while other chunks are being processed.
   */
  pushToQueue: (event: StreamEvent) => void;

  /**
   * Callback to drain and return all events currently in the outer queue.
   * Called during the poll loop in waitForInFlightExecutions to enable
   * real-time streaming of completed parallel gadget results.
   */
  drainQueue: () => StreamEvent[];
}

/**
 * GadgetDispatcher: Routes each gadget call through the full dispatch decision tree
 * and manages parallel execution life-cycles.
 */
export class GadgetDispatcher {
  private readonly iteration: number;
  private readonly hookLifecycle: GadgetHookLifecycle;
  private readonly dependencyResolver: GadgetDependencyResolver;
  private readonly concurrencyManager: GadgetConcurrencyManager;
  private readonly limitGuard: GadgetLimitGuard;
  private readonly gadgetExecutionMode: GadgetExecutionMode;
  private readonly tree?: ExecutionTree;
  private readonly parentNodeId: NodeId | null;
  private readonly hooks: AgentHooks;
  private readonly parentObservers?: Observers;
  private readonly logger: Logger<ILogObj>;
  private readonly pushToQueue: (event: StreamEvent) => void;
  private readonly drainQueue: () => StreamEvent[];

  constructor(options: GadgetDispatcherOptions) {
    this.iteration = options.iteration;
    this.hookLifecycle = options.hookLifecycle;
    this.dependencyResolver = options.dependencyResolver;
    this.concurrencyManager = options.concurrencyManager;
    this.limitGuard = options.limitGuard;
    this.gadgetExecutionMode = options.gadgetExecutionMode;
    this.tree = options.tree;
    this.parentNodeId = options.parentNodeId ?? null;
    this.hooks = options.hooks;
    this.parentObservers = options.parentObservers;
    this.logger = options.logger ?? createLogger({ name: "llmist:gadget-dispatcher" });
    this.pushToQueue = options.pushToQueue;
    this.drainQueue = options.drainQueue;
  }

  // ==========================================================================
  // Primary dispatch entry point
  // ==========================================================================

  /**
   * Dispatch a single gadget call through the full decision tree.
   *
   * Decision order:
   * 1. If limit exceeded → return (no events)
   * 2. Yield gadget_call event (real-time feedback)
   * 3. Add to execution tree
   * 4. Handle self-referential dependency → skip
   * 5. Handle already-failed dependency → skip or override
   * 6. If unsatisfied deps → add to pending queue
   * 7. If deps all satisfied → check limit, then execute
   * 8. If no deps → check limit, concurrency, then execute (or queue)
   */
  async *dispatch(call: ParsedGadgetCall): AsyncGenerator<StreamEvent> {
    // Early exit if limit already exceeded - don't emit events for buffered gadgets
    if (this.limitGuard.isLimitExceeded) {
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
        const errorMessage = `Gadget "${call.invocationId}" cannot depend on itself (self-referential dependency)`;
        for await (const evt of this.emitGadgetSkipEvents(call, call.invocationId, errorMessage)) {
          yield evt;
        }
        return;
      }

      // Check if any dependency has failed (including from prior iterations)
      const failedDep = this.dependencyResolver.getFailedDependency(call);
      if (failedDep) {
        // Dependency failed - handle skip
        const skipEvents = await this.handleFailedDependency(call, failedDep);
        for (const evt of skipEvents) {
          yield evt;
        }
        return;
      }

      // Check if all dependencies are satisfied (including from prior iterations)
      if (!this.dependencyResolver.isAllSatisfied(call)) {
        const unsatisfied = call.dependencies.filter(
          (dep) => !this.dependencyResolver.isCompleted(dep),
        );
        // Queue for later execution - gadget_call already yielded above
        this.logger.debug("Queueing gadget for later - waiting on dependencies", {
          gadgetName: call.gadgetName,
          invocationId: call.invocationId,
          waitingOn: unsatisfied,
        });
        this.dependencyResolver.addPending(call);
        return; // Execution deferred, gadget_call already yielded
      }

      // All dependencies satisfied - check limit then execute
      for await (const evt of this._checkLimitThenExecute(call)) {
        yield evt;
      }

      // Check if any pending gadgets can now execute
      for await (const evt of this.processPendingGadgets()) {
        yield evt;
      }
      return;
    }

    // NO dependencies - check gadget limit FIRST, then concurrency
    for await (const evt of this._checkLimitThenExecuteWithConcurrency(call)) {
      yield evt;
    }
  }

  // ==========================================================================
  // Pending gadget resolution
  // ==========================================================================

  /**
   * Process pending gadgets whose dependencies are now satisfied.
   * Yields events in real-time as gadgets complete.
   *
   * Gadgets are executed in parallel for efficiency,
   * but results are yielded as they become available.
   */
  async *processPendingGadgets(): AsyncGenerator<StreamEvent> {
    // Skip processing pending gadgets if limit already exceeded
    if (this.limitGuard.isLimitExceeded) {
      return;
    }

    let progress = true;

    while (progress && this.dependencyResolver.pendingCount > 0) {
      progress = false;

      // Ask the resolver which gadgets are ready to execute or skip
      const { readyToExecute, readyToSkip } = this.dependencyResolver.getReadyCalls();

      // Handle skipped gadgets
      for (const { call, failedDep } of readyToSkip) {
        this.dependencyResolver.removePending(call.invocationId);
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
          this.dependencyResolver.removePending(call.invocationId);
        }

        if (this.gadgetExecutionMode === "sequential") {
          // Sequential: execute one at a time, checking limit for each
          this.logger.debug("Executing ready gadgets sequentially", {
            count: readyToExecute.length,
            invocationIds: readyToExecute.map((c) => c.invocationId),
          });

          for (const call of readyToExecute) {
            // Check limit before execution
            const limitExceeded = yield* this._yieldLimitCheck(call);
            if (limitExceeded) {
              continue; // Limit exceeded, skip this gadget but continue with others
            }

            for await (const evt of this.hookLifecycle.execute(call)) {
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
              const limitGen = this.limitGuard.checkAndIncrement(call, {
                tree: this.tree,
                hooks: this.hooks.observers,
                parentObservers: this.parentObservers,
                iteration: this.iteration,
                logger: this.logger,
                markFailed: (invocationId) => this.dependencyResolver.markFailed(invocationId),
              });
              for await (const evt of limitGen) {
                events.push(evt);
              }
              if (this.limitGuard.isLimitExceeded) {
                return events; // Return skip events only
              }

              for await (const evt of this.hookLifecycle.execute(call)) {
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
    if (this.dependencyResolver.pendingCount > 0) {
      // Collect all pending invocation IDs to detect circular dependencies
      const pendingEntries = this.dependencyResolver.getPendingEntries();
      const pendingIds = new Set(pendingEntries.map(([id]) => id));

      for (const [invocationId, call] of pendingEntries) {
        // Filter to deps that are not completed (in current or prior iterations)
        const missingDeps = call.dependencies.filter(
          (dep) => !this.dependencyResolver.isCompleted(dep),
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
        yield* this.emitGadgetSkipEvents(call, missingDeps[0], errorMessage);
      }
      this.dependencyResolver.clearPending();
    }
  }

  // ==========================================================================
  // In-flight execution management
  // ==========================================================================

  /**
   * Wait for all in-flight gadget executions to complete, yielding events in real-time.
   * Called at stream end to ensure all parallel executions finish.
   */
  async *waitForInFlightExecutions(): AsyncGenerator<StreamEvent> {
    if (
      this.concurrencyManager.inFlightCount === 0 &&
      !this.concurrencyManager.hasQueuedGadgets() &&
      !this.concurrencyManager.hasExclusiveQueued
    ) {
      return;
    }

    this.logger.debug("Waiting for in-flight gadget executions", {
      count: this.concurrencyManager.inFlightCount,
      queuedCount: this.concurrencyManager.getQueuedGadgetCount(),
    });

    // Poll interval for draining queue (100ms provides responsive updates)
    const POLL_INTERVAL_MS = 100;

    // Poll loop: yield queued events while waiting for gadgets to complete
    // Continue while there are in-flight executions OR queued gadgets waiting
    while (
      this.concurrencyManager.inFlightCount > 0 ||
      this.concurrencyManager.hasQueuedGadgets()
    ) {
      // Create a combined promise that resolves when current gadgets complete
      const allDone = this.concurrencyManager.getAllDonePromise();

      // Race between: all current gadgets completing OR poll timeout
      const result = await Promise.race([
        allDone,
        new Promise<"poll">((resolve) => setTimeout(() => resolve("poll"), POLL_INTERVAL_MS)),
      ]);

      // Yield any events that accumulated in the outer queue (real-time streaming)
      for (const evt of this.drainQueue()) {
        yield evt;
      }

      if (
        result === "done" &&
        this.concurrencyManager.getTotalActiveGadgetCount() === 0 &&
        !this.concurrencyManager.hasQueuedGadgets()
      ) {
        // All gadgets complete (none active), no more queued - exit loop
        break;
      }
      // Continue polling
    }

    // Clear the map after all promises have completed
    this.concurrencyManager.clearInFlight();

    // Process exclusive gadgets now that all in-flight gadgets have completed
    if (this.concurrencyManager.hasExclusiveQueued) {
      const exclusiveQueue = this.concurrencyManager.drainExclusiveQueue();
      this.logger.debug("Processing deferred exclusive gadgets", {
        count: exclusiveQueue.length,
      });
      for (const call of exclusiveQueue) {
        for await (const evt of this.hookLifecycle.execute(call)) {
          yield evt;
        }
      }
    }
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Check the limit, then execute with full concurrency routing (for no-dep gadgets).
   */
  private async *_checkLimitThenExecuteWithConcurrency(
    call: ParsedGadgetCall,
  ): AsyncGenerator<StreamEvent> {
    // Check maxGadgetsPerResponse limit before any execution path
    const limitExceeded = yield* this._yieldLimitCheck(call);
    if (limitExceeded) {
      return; // Limit exceeded, gadget was skipped
    }

    // Check exclusive constraint: exclusive gadgets must run alone
    if (
      this.concurrencyManager.isExclusive(call.gadgetName) &&
      this.concurrencyManager.inFlightCount > 0
    ) {
      this.concurrencyManager.queueExclusive(call);
      return;
    }

    // Check concurrency limit - queue for later if limit reached
    if (!this.concurrencyManager.canStart(call)) {
      this.concurrencyManager.queueForLater(call);
      return;
    }

    // Execute based on execution mode
    if (this.gadgetExecutionMode === "sequential") {
      for await (const evt of this.hookLifecycle.execute(call)) {
        yield evt;
      }
    } else {
      // Parallel: fire-and-forget with concurrency tracking
      this._startGadgetWithConcurrencyTracking(call);
    }
  }

  /**
   * Check the limit, then execute directly (for gadgets with satisfied deps).
   */
  private async *_checkLimitThenExecute(call: ParsedGadgetCall): AsyncGenerator<StreamEvent> {
    const limitExceeded = yield* this._yieldLimitCheck(call);
    if (limitExceeded) {
      return;
    }
    for await (const evt of this.hookLifecycle.execute(call)) {
      yield evt;
    }
  }

  /**
   * Run the limit check generator and yield any produced events.
   * Returns true if the limit was exceeded (caller should return/continue).
   *
   * Passes a markFailed callback to the guard so that when a gadget is skipped
   * due to the limit, it is also recorded as failed in the dependency resolver.
   * This ensures that any gadgets depending on the skipped gadget are also skipped.
   */
  private async *_yieldLimitCheck(call: ParsedGadgetCall): AsyncGenerator<StreamEvent, boolean> {
    for await (const evt of this.limitGuard.checkAndIncrement(call, {
      tree: this.tree,
      hooks: this.hooks.observers,
      parentObservers: this.parentObservers,
      iteration: this.iteration,
      logger: this.logger,
      markFailed: (invocationId) => this.dependencyResolver.markFailed(invocationId),
    })) {
      yield evt;
    }
    return this.limitGuard.isLimitExceeded;
  }

  /**
   * Start a gadget execution with concurrency tracking (fire-and-forget).
   * Events are pushed to completedResultsQueue for real-time streaming to the caller.
   */
  private _startGadgetWithConcurrencyTracking(call: ParsedGadgetCall): void {
    const gadgetName = call.gadgetName;

    const executionPromise = this._executeAndCollect(call).finally(() => {
      // Notify manager that this gadget completed - it returns the next queued call if any
      const nextCall = this.concurrencyManager.onComplete(gadgetName);
      if (nextCall) {
        this._startGadgetWithConcurrencyTracking(nextCall);
      }
    });

    this.concurrencyManager.trackExecution(call.invocationId, gadgetName, executionPromise);
  }

  /**
   * Execute a gadget and push each produced event into the shared queue.
   * Used for fire-and-forget parallel execution.
   */
  private async _executeAndCollect(call: ParsedGadgetCall): Promise<void> {
    for await (const evt of this.hookLifecycle.execute(call)) {
      this.pushToQueue(evt);
    }
  }

  /**
   * Handle a gadget that cannot execute because a dependency failed.
   * Calls the onDependencySkipped controller to allow customization.
   */
  async handleFailedDependency(call: ParsedGadgetCall, failedDep: string): Promise<StreamEvent[]> {
    const events: StreamEvent[] = [];
    const depResult = this.dependencyResolver.getCompletedResult(failedDep);
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
      // Skip gadget in execution tree
      if (this.tree) {
        const gadgetNode = this.tree.getNodeByInvocationId(call.invocationId);
        if (gadgetNode) {
          this.tree.skipGadget(gadgetNode.id, failedDep, depError, "dependency_failed");
        }
      }

      // Emit skip event and notify observers (also marks as failed)
      for await (const evt of this.emitGadgetSkipEvents(call, failedDep, depError)) {
        events.push(evt);
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
      for await (const evt of this.hookLifecycle.execute(call)) {
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
      this.dependencyResolver.markComplete(fallbackResult);
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
   * Emit gadget skip events: marks the gadget as failed, yields a GadgetSkippedEvent,
   * and notifies onGadgetSkipped observers.
   */
  async *emitGadgetSkipEvents(
    call: ParsedGadgetCall,
    failedDep: string,
    errorMessage: string,
  ): AsyncGenerator<StreamEvent> {
    this.dependencyResolver.markFailed(call.invocationId);

    const skipEvent: GadgetSkippedEvent = {
      type: "gadget_skipped",
      gadgetName: call.gadgetName,
      invocationId: call.invocationId,
      parameters: call.parameters ?? {},
      failedDependency: failedDep,
      failedDependencyError: errorMessage,
    };
    yield skipEvent;

    // Notify onGadgetSkipped observers (AWAITED for proper ordering)
    await notifyGadgetSkipped({
      tree: this.tree,
      hooks: this.hooks.observers,
      parentObservers: this.parentObservers,
      logger: this.logger,
      iteration: this.iteration,
      gadgetName: call.gadgetName,
      invocationId: call.invocationId,
      parameters: call.parameters ?? {},
      failedDependency: failedDep,
      failedDependencyError: errorMessage,
    });
  }
}
