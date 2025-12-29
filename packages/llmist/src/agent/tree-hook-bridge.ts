/**
 * Bridge between ExecutionTree events and hook observers.
 *
 * This module ensures hooks receive the same rich context (depth, parentId, subagentContext)
 * as the TUI/CLI. By deriving hook calls from tree events, we achieve:
 *
 * 1. Single source of truth - ExecutionTree is the canonical event source
 * 2. Consistent subagent support - events automatically include depth/context
 * 3. Simpler codebase - no duplicate event emission logic
 *
 * @module agent/tree-hook-bridge
 */

import type { ILogObj, Logger } from "tslog";
import type { ExecutionTree, GadgetNode, LLMCallNode, NodeId } from "../core/execution-tree.js";
import type { ExecutionEvent, GadgetCompleteEvent, GadgetStartEvent } from "../core/execution-events.js";
import type {
  AgentHooks,
  ObserveGadgetCompleteContext,
  ObserveGadgetSkippedContext,
  ObserveGadgetStartContext,
  SubagentContext,
} from "./hooks.js";

/**
 * Find the parent gadget's invocation ID by walking up the tree.
 * For subagent events, this returns the gadget that spawned the subagent.
 */
function findParentGadgetInvocationId(tree: ExecutionTree, nodeId: NodeId): string | undefined {
  let currentId: NodeId | null = nodeId;

  while (currentId) {
    const node = tree.getNode(currentId);
    if (!node) break;

    // Walk up to parent
    currentId = node.parentId;
    if (!currentId) break;

    const parentNode = tree.getNode(currentId);
    if (parentNode?.type === "gadget") {
      return (parentNode as GadgetNode).invocationId;
    }
  }

  return undefined;
}

/**
 * Get the iteration number from the nearest LLM call ancestor.
 */
function getIterationFromTree(tree: ExecutionTree, nodeId: NodeId): number {
  let currentId: NodeId | null = nodeId;

  while (currentId) {
    const node = tree.getNode(currentId);
    if (!node) break;

    if (node.type === "llm_call") {
      return (node as LLMCallNode).iteration;
    }

    currentId = node.parentId;
  }

  return 0;
}

/**
 * Build SubagentContext for events with depth > 0.
 */
function buildSubagentContext(
  tree: ExecutionTree,
  event: ExecutionEvent,
): SubagentContext | undefined {
  if (event.depth === 0) {
    return undefined;
  }

  const parentGadgetInvocationId = findParentGadgetInvocationId(tree, event.nodeId);

  return {
    parentGadgetInvocationId: parentGadgetInvocationId ?? "unknown",
    depth: event.depth,
  };
}

/**
 * Safely call an async observer function.
 * Errors are logged but don't crash the system.
 */
async function safeObserve(
  fn: () => void | Promise<void>,
  logger: Logger<ILogObj>,
  eventType: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    logger.warn(`Observer error in ${eventType}:`, error);
  }
}

/**
 * Bridge ExecutionTree events to hook observers.
 *
 * This is the ONLY way hook observers should receive gadget events.
 * The bridge ensures consistent context (including subagentContext) across all consumers.
 *
 * @param tree - The ExecutionTree to subscribe to
 * @param hooks - Hook observers to call
 * @param logger - Logger for error reporting
 * @returns Unsubscribe function
 *
 * @example
 * ```typescript
 * const unsubscribe = bridgeTreeToHooks(agent.getTree(), hooks, logger);
 *
 * // Later, when done:
 * unsubscribe();
 * ```
 */
export function bridgeTreeToHooks(
  tree: ExecutionTree,
  hooks: AgentHooks,
  logger: Logger<ILogObj>,
): () => void {
  return tree.onAll((event) => {
    const subagentContext = buildSubagentContext(tree, event);

    switch (event.type) {
      case "gadget_start": {
        if (hooks.observers?.onGadgetExecutionStart) {
          const gadgetEvent = event as GadgetStartEvent;
          const gadgetNode = tree.getNodeByInvocationId(gadgetEvent.invocationId);

          const context: ObserveGadgetStartContext = {
            iteration: getIterationFromTree(tree, event.nodeId),
            gadgetName: gadgetEvent.name,
            invocationId: gadgetEvent.invocationId,
            parameters: gadgetNode?.parameters ?? {},
            logger,
            subagentContext,
          };

          safeObserve(
            () => hooks.observers!.onGadgetExecutionStart!(context),
            logger,
            "onGadgetExecutionStart",
          );
        }
        break;
      }

      case "gadget_complete": {
        if (hooks.observers?.onGadgetExecutionComplete) {
          const gadgetEvent = event as GadgetCompleteEvent;
          const gadgetNode = tree.getNodeByInvocationId(gadgetEvent.invocationId);

          const context: ObserveGadgetCompleteContext = {
            iteration: getIterationFromTree(tree, event.nodeId),
            gadgetName: gadgetEvent.name,
            invocationId: gadgetEvent.invocationId,
            parameters: gadgetNode?.parameters ?? {},
            finalResult: gadgetEvent.result,
            executionTimeMs: gadgetEvent.executionTimeMs,
            cost: gadgetEvent.cost,
            logger,
            subagentContext,
          };

          safeObserve(
            () => hooks.observers!.onGadgetExecutionComplete!(context),
            logger,
            "onGadgetExecutionComplete",
          );
        }
        break;
      }

      case "gadget_error": {
        if (hooks.observers?.onGadgetExecutionComplete) {
          const gadgetNode = tree.getNodeByInvocationId(event.invocationId);

          const context: ObserveGadgetCompleteContext = {
            iteration: getIterationFromTree(tree, event.nodeId),
            gadgetName: event.name,
            invocationId: event.invocationId,
            parameters: gadgetNode?.parameters ?? {},
            error: event.error,
            executionTimeMs: event.executionTimeMs,
            logger,
            subagentContext,
          };

          safeObserve(
            () => hooks.observers!.onGadgetExecutionComplete!(context),
            logger,
            "onGadgetExecutionComplete",
          );
        }
        break;
      }

      case "gadget_skipped": {
        if (hooks.observers?.onGadgetSkipped) {
          const gadgetNode = tree.getNodeByInvocationId(event.invocationId);

          const context: ObserveGadgetSkippedContext = {
            iteration: getIterationFromTree(tree, event.nodeId),
            gadgetName: event.name,
            invocationId: event.invocationId,
            parameters: gadgetNode?.parameters ?? {},
            failedDependency: event.failedDependency ?? "unknown",
            failedDependencyError: event.failedDependencyError ?? event.error,
            logger,
            subagentContext,
          };

          safeObserve(
            () => hooks.observers!.onGadgetSkipped!(context),
            logger,
            "onGadgetSkipped",
          );
        }
        break;
      }

      // Other event types (llm_call_*, text, compaction, etc.) are not bridged
      // because they are already handled directly in agent.ts with proper context
    }
  });
}
