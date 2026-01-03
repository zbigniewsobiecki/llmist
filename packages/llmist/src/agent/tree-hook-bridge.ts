/**
 * Bridge between ExecutionTree events and hook observers.
 *
 * This module handles:
 * - LLM call events for subagent visibility (fire-and-forget)
 * - Gadget events for subagent visibility (fire-and-forget)
 * - Exports `getSubagentContextForNode()` for deriving subagent context
 *
 * The ExecutionTree is the single source of truth for all execution events.
 * For subagent events (depth > 0), this bridge propagates events to parent hooks.
 *
 * NOTE: For the ROOT agent's own events (depth === 0), gadget observer hooks
 * are called DIRECTLY in stream-processor.ts with await to ensure proper ordering.
 * This bridge only handles SUBAGENT events to avoid double-calling.
 *
 * @module agent/tree-hook-bridge
 */

import type { ILogObj, Logger } from "tslog";
import type {
  ExecutionEvent,
  GadgetCompleteEvent,
  GadgetErrorEvent,
  GadgetSkippedEvent,
  GadgetStartEvent,
  LLMCallCompleteEvent,
  LLMCallErrorEvent,
  LLMCallStartEvent,
} from "../core/execution-events.js";
import type { ExecutionTree, GadgetNode, LLMCallNode, NodeId } from "../core/execution-tree.js";
import type {
  AgentHooks,
  ObserveGadgetCompleteContext,
  ObserveGadgetSkippedContext,
  ObserveGadgetStartContext,
  ObserveLLMCallContext,
  ObserveLLMCompleteContext,
  ObserveLLMErrorContext,
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
 * Build SubagentContext for events that are inside a subagent's execution.
 *
 * A SubagentContext exists only if the event has a parent gadget in its ancestry.
 * This distinguishes:
 * - Root agent gadgets (no parent gadget) → returns undefined
 * - Subagent gadgets (have parent gadget that spawned them) → returns SubagentContext
 */
function buildSubagentContext(
  tree: ExecutionTree,
  event: ExecutionEvent,
): SubagentContext | undefined {
  const parentGadgetInvocationId = findParentGadgetInvocationId(tree, event.nodeId);

  if (!parentGadgetInvocationId) {
    return undefined; // No parent gadget = not in subagent context
  }

  return {
    parentGadgetInvocationId,
    depth: event.depth,
  };
}

/**
 * Get SubagentContext for a specific node in the execution tree.
 *
 * This is exported for use by agent.ts when calling LLM hooks directly.
 * LLM hooks are awaited (unlike gadget hooks which are fire-and-forget via the bridge),
 * so they need to derive SubagentContext manually.
 *
 * @param tree - The ExecutionTree to query
 * @param nodeId - The node ID to get context for
 * @returns SubagentContext if the node is inside a subagent execution, undefined otherwise
 *
 * @example
 * ```typescript
 * const subagentContext = getSubagentContextForNode(this.tree, llmNodeId);
 * const context: ObserveLLMCallContext = {
 *   iteration,
 *   options: llmOptions,
 *   logger: this.logger,
 *   subagentContext,
 * };
 * ```
 */
export function getSubagentContextForNode(
  tree: ExecutionTree,
  nodeId: NodeId,
): SubagentContext | undefined {
  const node = tree.getNode(nodeId);
  if (!node) return undefined;

  const parentGadgetInvocationId = findParentGadgetInvocationId(tree, nodeId);

  if (!parentGadgetInvocationId) {
    return undefined; // No parent gadget = not in subagent context
  }

  return {
    parentGadgetInvocationId,
    depth: node.depth,
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
 * Chain an observer call to ensure proper ordering for the same entity.
 *
 * This ensures that for a given key (invocationId for gadgets, nodeId for LLM calls),
 * events are processed in order. For example, gadget_start must complete before
 * gadget_complete for the same invocation.
 *
 * @param chainMap - Map to store promise chains by key
 * @param key - Unique identifier for the entity (invocationId or nodeId)
 * @param fn - The observer function to call
 * @param logger - Logger for error reporting
 * @param eventType - Event type name for logging
 * @param cleanup - Whether to remove the map entry after completion
 */
function chainObserverCall(
  chainMap: Map<string, Promise<void>>,
  key: string,
  fn: () => void | Promise<void>,
  logger: Logger<ILogObj>,
  eventType: string,
  cleanup: boolean = false,
): void {
  const previousPromise = chainMap.get(key) ?? Promise.resolve();
  const newPromise = previousPromise.then(() => safeObserve(fn, logger, eventType));
  chainMap.set(key, newPromise);

  if (cleanup) {
    newPromise.finally(() => chainMap.delete(key));
  }
}

/**
 * Bridge ExecutionTree events to hook observers.
 *
 * This bridge handles both LLM and gadget events for subagent visibility.
 * Events from subagents (depth > 0) are fire-and-forget to the parent's hooks.
 *
 * Root agent events (depth === 0) are NOT handled here - they are called
 * directly in stream-processor.ts with await to ensure proper ordering.
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
  // Map invocationId -> Promise chain for ordered gadget execution
  const gadgetPromiseChains = new Map<string, Promise<void>>();

  // Map nodeId -> Promise chain for ordered LLM call execution
  const llmPromiseChains = new Map<string, Promise<void>>();

  return tree.onAll((event) => {
    const subagentContext = buildSubagentContext(tree, event);

    switch (event.type) {
      // =================================================================
      // GADGET EVENTS - Bridged for subagent visibility
      // =================================================================
      // When a subagent executes gadgets, these events propagate through
      // the shared tree to the parent's hooks.
      // Only bridged for subagent events (depth > 0) to avoid double-calling
      // root agent events which are handled directly in stream-processor.ts

      case "gadget_start": {
        if (subagentContext && hooks.observers?.onGadgetExecutionStart) {
          const gadgetEvent = event as GadgetStartEvent;
          const gadgetNode = tree.getNode(event.nodeId) as GadgetNode | undefined;

          const context: ObserveGadgetStartContext = {
            iteration: getIterationFromTree(tree, event.nodeId),
            gadgetName: gadgetEvent.name,
            invocationId: gadgetEvent.invocationId,
            parameters: gadgetNode?.parameters ?? {},
            logger,
            subagentContext,
          };

          // Chain by invocationId to ensure start completes before complete/error/skipped
          chainObserverCall(
            gadgetPromiseChains,
            gadgetEvent.invocationId,
            () => hooks.observers?.onGadgetExecutionStart?.(context),
            logger,
            "onGadgetExecutionStart",
            false, // Don't cleanup - wait for completion event
          );
        }
        break;
      }

      case "gadget_complete": {
        if (subagentContext && hooks.observers?.onGadgetExecutionComplete) {
          const gadgetEvent = event as GadgetCompleteEvent;
          const gadgetNode = tree.getNode(event.nodeId) as GadgetNode | undefined;

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

          // Chain by invocationId to ensure this runs after start, then cleanup
          chainObserverCall(
            gadgetPromiseChains,
            gadgetEvent.invocationId,
            () => hooks.observers?.onGadgetExecutionComplete?.(context),
            logger,
            "onGadgetExecutionComplete",
            true, // Cleanup after completion
          );
        }
        break;
      }

      case "gadget_error": {
        if (subagentContext && hooks.observers?.onGadgetExecutionComplete) {
          const gadgetEvent = event as GadgetErrorEvent;
          const gadgetNode = tree.getNode(event.nodeId) as GadgetNode | undefined;

          // For errors, we call onGadgetExecutionComplete with error field set
          const context: ObserveGadgetCompleteContext = {
            iteration: getIterationFromTree(tree, event.nodeId),
            gadgetName: gadgetEvent.name,
            invocationId: gadgetEvent.invocationId,
            parameters: gadgetNode?.parameters ?? {},
            error: gadgetEvent.error,
            executionTimeMs: gadgetEvent.executionTimeMs,
            logger,
            subagentContext,
          };

          // Chain by invocationId to ensure this runs after start, then cleanup
          chainObserverCall(
            gadgetPromiseChains,
            gadgetEvent.invocationId,
            () => hooks.observers?.onGadgetExecutionComplete?.(context),
            logger,
            "onGadgetExecutionComplete",
            true, // Cleanup after error
          );
        }
        break;
      }

      case "gadget_skipped": {
        if (subagentContext && hooks.observers?.onGadgetSkipped) {
          const gadgetEvent = event as GadgetSkippedEvent;
          const gadgetNode = tree.getNode(event.nodeId) as GadgetNode | undefined;

          const context: ObserveGadgetSkippedContext = {
            iteration: getIterationFromTree(tree, event.nodeId),
            gadgetName: gadgetEvent.name,
            invocationId: gadgetEvent.invocationId,
            parameters: gadgetNode?.parameters ?? {},
            failedDependency: gadgetEvent.failedDependency ?? "",
            failedDependencyError: gadgetEvent.failedDependencyError ?? gadgetEvent.error,
            logger,
            subagentContext,
          };

          // Chain by invocationId to ensure this runs after start, then cleanup
          chainObserverCall(
            gadgetPromiseChains,
            gadgetEvent.invocationId,
            () => hooks.observers?.onGadgetSkipped?.(context),
            logger,
            "onGadgetSkipped",
            true, // Cleanup after skipped
          );
        }
        break;
      }

      // =================================================================
      // LLM EVENTS - Bridged for subagent visibility
      // =================================================================
      // When a subagent makes LLM calls, these events propagate through
      // the shared tree to the parent's hooks.

      case "llm_call_start": {
        // Only call hooks for subagent events (depth > 0)
        // Root agent events are already handled directly in agent.ts
        if (subagentContext && hooks.observers?.onLLMCallStart) {
          const llmEvent = event as LLMCallStartEvent;

          const context: ObserveLLMCallContext = {
            iteration: llmEvent.iteration,
            options: {
              model: llmEvent.model,
              messages: llmEvent.request ?? [],
              // These fields are not available from tree events, use defaults
              temperature: undefined,
              maxTokens: undefined,
            },
            logger,
            subagentContext,
          };

          // Chain by nodeId to ensure start completes before complete/error
          chainObserverCall(
            llmPromiseChains,
            event.nodeId,
            () => hooks.observers?.onLLMCallStart?.(context),
            logger,
            "onLLMCallStart",
            false, // Don't cleanup - wait for completion event
          );
        }
        break;
      }

      case "llm_call_complete": {
        // Only call hooks for subagent events (depth > 0)
        if (subagentContext && hooks.observers?.onLLMCallComplete) {
          const llmEvent = event as LLMCallCompleteEvent;
          const llmNode = tree.getNode(event.nodeId) as LLMCallNode | undefined;

          const context: ObserveLLMCompleteContext = {
            iteration: llmNode?.iteration ?? 1,
            options: {
              model: llmNode?.model ?? "unknown",
              messages: llmNode?.request ?? [],
              temperature: undefined,
              maxTokens: undefined,
            },
            finishReason: llmEvent.finishReason ?? null,
            usage: llmEvent.usage,
            rawResponse: llmEvent.response,
            // Use rawResponse as finalMessage since interceptor modifications aren't available from tree events
            finalMessage: llmEvent.response,
            logger,
            subagentContext,
          };

          // Chain by nodeId to ensure this runs after start, then cleanup
          chainObserverCall(
            llmPromiseChains,
            event.nodeId,
            () => hooks.observers?.onLLMCallComplete?.(context),
            logger,
            "onLLMCallComplete",
            true, // Cleanup after completion
          );
        }
        break;
      }

      case "llm_call_error": {
        // Only call hooks for subagent events (depth > 0)
        if (subagentContext && hooks.observers?.onLLMCallError) {
          const llmEvent = event as LLMCallErrorEvent;
          const llmNode = tree.getNode(event.nodeId) as LLMCallNode | undefined;

          const context: ObserveLLMErrorContext = {
            iteration: llmNode?.iteration ?? 1,
            options: {
              model: llmNode?.model ?? "unknown",
              messages: llmNode?.request ?? [],
              temperature: undefined,
              maxTokens: undefined,
            },
            error: llmEvent.error,
            recovered: llmEvent.recovered,
            logger,
            subagentContext,
          };

          // Chain by nodeId to ensure this runs after start, then cleanup
          chainObserverCall(
            llmPromiseChains,
            event.nodeId,
            () => hooks.observers?.onLLMCallError?.(context),
            logger,
            "onLLMCallError",
            true, // Cleanup after error
          );
        }
        break;
      }

      // Other event types (text, compaction, etc.) are not bridged
      // as they don't have corresponding hook observer interfaces
    }
  });
}
