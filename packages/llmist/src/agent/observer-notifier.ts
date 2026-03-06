/**
 * Observer notification helpers for consolidated gadget event dispatching.
 *
 * Encapsulates the repeated ~30-line pattern that appeared 6× in StreamProcessor:
 * 1. Resolve subagentContext from the execution tree
 * 2. Call hooks observers (awaited)
 * 3. Call parentObservers (awaited)
 *
 * Preserves sequential await behavior — critical for observer ordering guarantees.
 *
 * @module agent/observer-notifier
 */

import type { ILogObj, Logger } from "tslog";
import type { ExecutionTree } from "../core/execution-tree.js";
import type {
  ObserveGadgetCompleteContext,
  ObserveGadgetSkippedContext,
  ObserveGadgetStartContext,
  Observers,
} from "./hooks.js";
import { safeObserve } from "./safe-observe.js";
import { getSubagentContextForNode } from "./tree-hook-bridge.js";

// ============================================================================
// Context types for each notification kind
// ============================================================================

/**
 * Shared base data needed to resolve subagentContext and call observers.
 */
interface NotifyBaseContext {
  /** Execution tree used to look up node and derive subagentContext */
  tree: ExecutionTree | undefined;
  /** Current agent's observer hooks */
  hooks: Observers | undefined;
  /** Parent agent's observer hooks (for subagent visibility) */
  parentObservers: Observers | undefined;
  /** Logger for safeObserve error reporting */
  logger: Logger<ILogObj>;
  /** Iteration number for the observer context */
  iteration: number;
}

/** Data specific to the onGadgetSkipped notification */
export interface NotifyGadgetSkippedContext extends NotifyBaseContext {
  gadgetName: string;
  invocationId: string;
  parameters: Record<string, unknown>;
  failedDependency: string;
  failedDependencyError: string;
}

/** Data specific to the onGadgetExecutionStart notification */
export interface NotifyGadgetStartContext extends NotifyBaseContext {
  gadgetName: string;
  invocationId: string;
  parameters: Record<string, unknown>;
}

/** Data specific to the onGadgetExecutionComplete notification */
export interface NotifyGadgetCompleteContext extends NotifyBaseContext {
  gadgetName: string;
  invocationId: string;
  parameters: Record<string, unknown>;
  finalResult: string | undefined;
  error: string | undefined;
  executionTimeMs: number;
  cost: number | undefined;
}

// ============================================================================
// Notification helpers
// ============================================================================

/**
 * Notify all relevant observers when a gadget is skipped.
 *
 * Sequentially awaits:
 * 1. hooks.observers.onGadgetSkipped (current agent)
 * 2. parentObservers.onGadgetSkipped (parent agent, if present)
 */
export async function notifyGadgetSkipped(ctx: NotifyGadgetSkippedContext): Promise<void> {
  const gadgetNode = ctx.tree?.getNodeByInvocationId(ctx.invocationId);
  const subagentContext =
    ctx.tree && gadgetNode ? getSubagentContextForNode(ctx.tree, gadgetNode.id) : undefined;

  const context: ObserveGadgetSkippedContext = {
    iteration: ctx.iteration,
    gadgetName: ctx.gadgetName,
    invocationId: ctx.invocationId,
    parameters: ctx.parameters,
    failedDependency: ctx.failedDependency,
    failedDependencyError: ctx.failedDependencyError,
    logger: ctx.logger,
    subagentContext,
  };

  if (ctx.hooks?.onGadgetSkipped) {
    const hookFn = ctx.hooks.onGadgetSkipped;
    await safeObserve(() => hookFn(context), ctx.logger);
  }

  if (ctx.parentObservers?.onGadgetSkipped) {
    const hookFn = ctx.parentObservers.onGadgetSkipped;
    await safeObserve(() => hookFn(context), ctx.logger);
  }
}

/**
 * Notify all relevant observers when a gadget execution starts.
 *
 * Sequentially awaits:
 * 1. hooks.observers.onGadgetExecutionStart (current agent)
 * 2. parentObservers.onGadgetExecutionStart (parent agent, if present)
 */
export async function notifyGadgetStart(ctx: NotifyGadgetStartContext): Promise<void> {
  const gadgetNode = ctx.tree?.getNodeByInvocationId(ctx.invocationId);
  const subagentContext =
    ctx.tree && gadgetNode ? getSubagentContextForNode(ctx.tree, gadgetNode.id) : undefined;

  const context: ObserveGadgetStartContext = {
    iteration: ctx.iteration,
    gadgetName: ctx.gadgetName,
    invocationId: ctx.invocationId,
    parameters: ctx.parameters,
    logger: ctx.logger,
    subagentContext,
  };

  if (ctx.hooks?.onGadgetExecutionStart) {
    const hookFn = ctx.hooks.onGadgetExecutionStart;
    await safeObserve(() => hookFn(context), ctx.logger);
  }

  if (ctx.parentObservers?.onGadgetExecutionStart) {
    const hookFn = ctx.parentObservers.onGadgetExecutionStart;
    await safeObserve(() => hookFn(context), ctx.logger);
  }
}

/**
 * Notify all relevant observers when a gadget execution completes (success or error).
 *
 * Sequentially awaits:
 * 1. hooks.observers.onGadgetExecutionComplete (current agent)
 * 2. parentObservers.onGadgetExecutionComplete (parent agent, if present)
 */
export async function notifyGadgetComplete(ctx: NotifyGadgetCompleteContext): Promise<void> {
  const gadgetNode = ctx.tree?.getNodeByInvocationId(ctx.invocationId);
  const subagentContext =
    ctx.tree && gadgetNode ? getSubagentContextForNode(ctx.tree, gadgetNode.id) : undefined;

  const context: ObserveGadgetCompleteContext = {
    iteration: ctx.iteration,
    gadgetName: ctx.gadgetName,
    invocationId: ctx.invocationId,
    parameters: ctx.parameters,
    finalResult: ctx.finalResult,
    error: ctx.error,
    executionTimeMs: ctx.executionTimeMs,
    cost: ctx.cost,
    logger: ctx.logger,
    subagentContext,
  };

  if (ctx.hooks?.onGadgetExecutionComplete) {
    const hookFn = ctx.hooks.onGadgetExecutionComplete;
    await safeObserve(() => hookFn(context), ctx.logger);
  }

  if (ctx.parentObservers?.onGadgetExecutionComplete) {
    const hookFn = ctx.parentObservers.onGadgetExecutionComplete;
    await safeObserve(() => hookFn(context), ctx.logger);
  }
}
