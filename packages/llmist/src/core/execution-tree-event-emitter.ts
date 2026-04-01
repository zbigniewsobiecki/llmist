/**
 * ExecutionTreeEventEmitter — responsible for event notification within ExecutionTree.
 *
 * Handles:
 * - Synchronous event dispatch to named and wildcard listeners (`on`, `onAll`)
 * - Async back-pressure queue consumed by the `events()` async generator
 * - Tree-completion signalling via `complete()`
 *
 * @module core/execution-tree-event-emitter
 */

import type { ExecutionEvent, ExecutionEventType } from "./execution-events.js";

/** Event listener function type */
type EventListener = (event: ExecutionEvent) => void;

/** Minimal node shape needed to build base event properties. */
interface NodeEventProps {
  id: string;
  parentId: string | null;
  depth: number;
  path: string[];
}

/**
 * Manages synchronous event dispatch and the async event queue for ExecutionTree.
 *
 * `ExecutionTree` holds one instance and delegates all event-related public
 * methods to it, keeping event infrastructure separate from node storage and
 * aggregation logic.
 */
export class ExecutionTreeEventEmitter {
  private eventListeners = new Map<ExecutionEventType, Set<EventListener>>();
  private eventQueue: ExecutionEvent[] = [];
  private eventWaiters: Array<(event: ExecutionEvent | null) => void> = [];
  private isCompleted = false;
  private eventIdCounter = 0;

  // ===========================================================================
  // Base event props factory
  // ===========================================================================

  /**
   * Build the common event properties derived from a node.
   */
  createBaseEventProps(node: NodeEventProps): {
    eventId: number;
    timestamp: number;
    nodeId: string;
    parentId: string | null;
    depth: number;
    path: string[];
  } {
    return {
      eventId: ++this.eventIdCounter,
      timestamp: Date.now(),
      nodeId: node.id,
      parentId: node.parentId,
      depth: node.depth,
      path: node.path,
    };
  }

  // ===========================================================================
  // Synchronous dispatch
  // ===========================================================================

  /**
   * Dispatch an event to all registered listeners and push it to the async queue.
   */
  emit(event: ExecutionEvent): void {
    // Notify typed listeners
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error(`Error in event listener for ${event.type}:`, error);
        }
      }
    }

    // Notify wildcard listeners
    const allListeners = this.eventListeners.get("*");
    if (allListeners) {
      for (const listener of allListeners) {
        try {
          listener(event);
        } catch (error) {
          console.error("Error in wildcard event listener:", error);
        }
      }
    }

    // Push to async queue or wake waiting consumer
    if (this.eventWaiters.length > 0) {
      const waiter = this.eventWaiters.shift()!;
      waiter(event);
    } else {
      this.eventQueue.push(event);
    }
  }

  // ===========================================================================
  // Subscription
  // ===========================================================================

  /**
   * Subscribe to events of a specific type.
   *
   * @param type - Event type, or `"*"` for all events
   * @param listener - Callback invoked for each matching event
   * @returns Unsubscribe function
   */
  on(type: ExecutionEventType, listener: EventListener): () => void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    const listeners = this.eventListeners.get(type)!;
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }

  /**
   * Subscribe to all events (alias for `on("*", listener)`).
   */
  onAll(listener: EventListener): () => void {
    return this.on("*", listener);
  }

  // ===========================================================================
  // Async event stream
  // ===========================================================================

  /**
   * Async generator that yields all events in order.
   * Terminates when `complete()` is called.
   */
  async *events(): AsyncGenerator<ExecutionEvent> {
    while (!this.isCompleted) {
      // Drain queue first
      while (this.eventQueue.length > 0) {
        yield this.eventQueue.shift()!;
      }

      if (this.isCompleted) break;

      // Wait for next event (null signals tree completion)
      const event = await new Promise<ExecutionEvent | null>((resolve) => {
        // Check queue again in case events arrived while setting up
        if (this.eventQueue.length > 0) {
          resolve(this.eventQueue.shift()!);
        } else {
          this.eventWaiters.push(resolve);
        }
      });

      if (event === null) break;
      yield event;
    }

    // Drain any remaining buffered events
    while (this.eventQueue.length > 0) {
      yield this.eventQueue.shift()!;
    }
  }

  // ===========================================================================
  // Completion
  // ===========================================================================

  /**
   * Mark the emitter as complete. Wakes all consumers waiting in `events()`.
   */
  complete(): void {
    this.isCompleted = true;
    for (const waiter of this.eventWaiters) {
      waiter(null);
    }
    this.eventWaiters = [];
  }

  /**
   * Whether `complete()` has been called.
   */
  isComplete(): boolean {
    return this.isCompleted;
  }
}
