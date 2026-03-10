/**
 * GadgetHookLifecycle: Orchestrates the full hook lifecycle for a single gadget execution.
 *
 * Extracted from StreamProcessor.executeGadgetGenerator() (~170 lines) to provide a
 * focused, independently-testable class for the ordered sequence:
 *
 *   1. interceptGadgetParameters
 *   2. beforeGadgetExecution controller (can skip)
 *   3. Mark gadget as running in tree
 *   4. onGadgetExecutionStart observers
 *   5. Execute gadget (or use synthetic result if skipped)
 *   6. interceptGadgetResult
 *   7. afterGadgetExecution controller (can recover from error)
 *   8. Complete gadget in tree
 *   9. onGadgetExecutionComplete observers
 *  10. Mark complete in dependency resolver
 *  11. Yield gadget_result event
 *
 * @module agent/gadget-hook-lifecycle
 */

import type { ILogObj, Logger } from "tslog";
import type { ExecutionTree } from "../core/execution-tree.js";
import type { GadgetExecutor } from "../gadgets/executor.js";
import type { GadgetExecutionResult, ParsedGadgetCall, StreamEvent } from "../gadgets/types.js";
import type { GadgetDependencyResolver } from "./gadget-dependency-resolver.js";
import {
  validateAfterGadgetExecutionAction,
  validateBeforeGadgetExecutionAction,
} from "./hook-validators.js";
import type {
  AfterGadgetExecutionAction,
  AfterGadgetExecutionControllerContext,
  AgentHooks,
  BeforeGadgetExecutionAction,
  GadgetExecutionControllerContext,
  GadgetParameterInterceptorContext,
  GadgetResultInterceptorContext,
  Observers,
} from "./hooks.js";
import { notifyGadgetComplete, notifyGadgetStart } from "./observer-notifier.js";

/**
 * Options for constructing a GadgetHookLifecycle.
 */
export interface GadgetHookLifecycleOptions {
  /** Current iteration number */
  iteration: number;

  /** Hooks (controllers, interceptors, observers) */
  hooks: AgentHooks;

  /** Logger instance */
  logger: Logger<ILogObj>;

  /** Executor that actually runs the gadget */
  executor: GadgetExecutor;

  /** Execution tree for tracking gadget state */
  tree?: ExecutionTree;

  /** Parent agent observers for subagent visibility */
  parentObservers?: Observers;

  /** Dependency resolver to mark completion after execution */
  dependencyResolver: GadgetDependencyResolver;
}

/**
 * GadgetHookLifecycle: Runs the full ordered hook sequence for a single gadget.
 *
 * @example
 * ```typescript
 * const lifecycle = new GadgetHookLifecycle({ iteration, hooks, logger, executor, tree, ... });
 *
 * for await (const evt of lifecycle.execute(call)) {
 *   yield evt; // gadget_result (and no other events)
 * }
 * ```
 */
export class GadgetHookLifecycle {
  private readonly iteration: number;
  private readonly hooks: AgentHooks;
  private readonly logger: Logger<ILogObj>;
  private readonly executor: GadgetExecutor;
  private readonly tree?: ExecutionTree;
  private readonly parentObservers?: Observers;
  private readonly dependencyResolver: GadgetDependencyResolver;

  constructor(options: GadgetHookLifecycleOptions) {
    this.iteration = options.iteration;
    this.hooks = options.hooks;
    this.logger = options.logger;
    this.executor = options.executor;
    this.tree = options.tree;
    this.parentObservers = options.parentObservers;
    this.dependencyResolver = options.dependencyResolver;
  }

  /**
   * Execute a single gadget call through the full hook lifecycle.
   *
   * Yields a single gadget_result event (after all hooks complete).
   * Modifies dependency resolver state as a side effect.
   */
  async *execute(call: ParsedGadgetCall): AsyncGenerator<StreamEvent> {
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

    // Step 3b: Notify onGadgetExecutionStart observers (AWAITED for proper ordering)
    await notifyGadgetStart({
      tree: this.tree,
      hooks: this.hooks.observers,
      parentObservers: this.parentObservers,
      logger: this.logger,
      iteration: this.iteration,
      gadgetName: call.gadgetName,
      invocationId: call.invocationId,
      parameters,
    });

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

    // Step 5: Interceptor - Transform result and/or error text
    if ((result.result || result.error) && this.hooks.interceptors?.interceptGadgetResult) {
      const context: GadgetResultInterceptorContext = {
        iteration: this.iteration,
        gadgetName: result.gadgetName,
        invocationId: result.invocationId,
        parameters,
        executionTimeMs: result.executionTimeMs,
        logger: this.logger,
      };
      if (result.result) {
        result.result = this.hooks.interceptors.interceptGadgetResult(result.result, context);
      }
      if (result.error) {
        result.error = this.hooks.interceptors.interceptGadgetResult(result.error, context);
      }
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
            storedMedia: result.storedMedia,
          });
        }
      }
    }

    // Step 7b: Notify onGadgetExecutionComplete observers (AWAITED for proper ordering)
    await notifyGadgetComplete({
      tree: this.tree,
      hooks: this.hooks.observers,
      parentObservers: this.parentObservers,
      logger: this.logger,
      iteration: this.iteration,
      gadgetName: result.gadgetName,
      invocationId: result.invocationId,
      parameters,
      finalResult: result.result,
      error: result.error,
      executionTimeMs: result.executionTimeMs,
      cost: result.cost,
    });

    // Track completion for dependency resolution
    this.dependencyResolver.markComplete(result);

    // Yield result event immediately
    yield { type: "gadget_result", result };
  }
}
