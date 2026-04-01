/**
 * Isolated unit tests for ExecutionTreeEventEmitter.
 */

import { describe, expect, test } from "vitest";
import type { ExecutionEvent } from "./execution-events.js";
import { ExecutionTreeEventEmitter } from "./execution-tree-event-emitter.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeEvent(type: ExecutionEvent["type"] = "llm_call_start"): ExecutionEvent {
  return {
    type,
    eventId: 1,
    timestamp: Date.now(),
    nodeId: "node_1",
    parentId: null,
    depth: 0,
    path: ["node_1"],
    iteration: 1,
    model: "test-model",
  } as ExecutionEvent;
}

function makeNode() {
  return {
    id: "node_1",
    parentId: null as string | null,
    depth: 0,
    path: ["node_1"],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExecutionTreeEventEmitter", () => {
  describe("createBaseEventProps", () => {
    test("creates base event properties from a node", () => {
      const emitter = new ExecutionTreeEventEmitter();
      const node = { id: "llm_1", parentId: null, depth: 0, path: ["llm_1"] };

      const props = emitter.createBaseEventProps(node);

      expect(props.nodeId).toBe("llm_1");
      expect(props.parentId).toBeNull();
      expect(props.depth).toBe(0);
      expect(props.path).toEqual(["llm_1"]);
      expect(typeof props.eventId).toBe("number");
      expect(typeof props.timestamp).toBe("number");
    });

    test("eventId increments monotonically", () => {
      const emitter = new ExecutionTreeEventEmitter();
      const node = makeNode();

      const props1 = emitter.createBaseEventProps(node);
      const props2 = emitter.createBaseEventProps(node);
      const props3 = emitter.createBaseEventProps(node);

      expect(props2.eventId).toBeGreaterThan(props1.eventId);
      expect(props3.eventId).toBeGreaterThan(props2.eventId);
    });

    test("carries parentId and depth from node", () => {
      const emitter = new ExecutionTreeEventEmitter();
      const node = { id: "gadget_1", parentId: "llm_1", depth: 2, path: ["llm_1", "gadget_1"] };

      const props = emitter.createBaseEventProps(node);

      expect(props.parentId).toBe("llm_1");
      expect(props.depth).toBe(2);
      expect(props.path).toEqual(["llm_1", "gadget_1"]);
    });
  });

  describe("on / emit — synchronous dispatch", () => {
    test("on() delivers matching events to the listener", () => {
      const emitter = new ExecutionTreeEventEmitter();
      const received: ExecutionEvent[] = [];

      emitter.on("llm_call_start", (e) => received.push(e));

      const event = makeEvent("llm_call_start");
      emitter.emit(event);

      expect(received).toHaveLength(1);
      expect(received[0]).toBe(event);
    });

    test("on() does NOT deliver non-matching events", () => {
      const emitter = new ExecutionTreeEventEmitter();
      const received: ExecutionEvent[] = [];

      emitter.on("llm_call_start", (e) => received.push(e));
      emitter.emit(makeEvent("gadget_call"));

      expect(received).toHaveLength(0);
    });

    test("on() returns unsubscribe function that stops delivery", () => {
      const emitter = new ExecutionTreeEventEmitter();
      const received: ExecutionEvent[] = [];

      const unsubscribe = emitter.on("llm_call_start", (e) => received.push(e));

      emitter.emit(makeEvent("llm_call_start"));
      expect(received).toHaveLength(1);

      unsubscribe();
      emitter.emit(makeEvent("llm_call_start"));
      expect(received).toHaveLength(1); // no new event
    });

    test("multiple listeners for the same type all receive the event", () => {
      const emitter = new ExecutionTreeEventEmitter();
      const calls: number[] = [];

      emitter.on("llm_call_start", () => calls.push(1));
      emitter.on("llm_call_start", () => calls.push(2));

      emitter.emit(makeEvent("llm_call_start"));

      expect(calls).toEqual([1, 2]);
    });
  });

  describe("onAll — wildcard dispatch", () => {
    test("onAll() receives events of every type", () => {
      const emitter = new ExecutionTreeEventEmitter();
      const types: string[] = [];

      emitter.onAll((e) => types.push(e.type));

      emitter.emit(makeEvent("llm_call_start"));
      emitter.emit(makeEvent("gadget_call"));

      expect(types).toEqual(["llm_call_start", "gadget_call"]);
    });

    test("onAll() returns unsubscribe function", () => {
      const emitter = new ExecutionTreeEventEmitter();
      const received: ExecutionEvent[] = [];

      const unsubscribe = emitter.onAll((e) => received.push(e));
      emitter.emit(makeEvent("llm_call_start"));
      expect(received).toHaveLength(1);

      unsubscribe();
      emitter.emit(makeEvent("llm_call_start"));
      expect(received).toHaveLength(1);
    });
  });

  describe("events() — async generator", () => {
    test("yields events in emission order", async () => {
      const emitter = new ExecutionTreeEventEmitter();
      const received: ExecutionEvent[] = [];

      const consumer = (async () => {
        for await (const event of emitter.events()) {
          received.push(event);
          if (received.length >= 2) break;
        }
      })();

      emitter.emit(makeEvent("llm_call_start"));
      emitter.emit(makeEvent("gadget_call"));

      await consumer;

      expect(received).toHaveLength(2);
      expect(received[0].type).toBe("llm_call_start");
      expect(received[1].type).toBe("gadget_call");
    });

    test("terminates cleanly when complete() is called while waiting", async () => {
      const emitter = new ExecutionTreeEventEmitter();
      const received: ExecutionEvent[] = [];

      const consumer = (async () => {
        for await (const event of emitter.events()) {
          received.push(event);
        }
      })();

      emitter.emit(makeEvent("llm_call_start"));
      emitter.complete();

      await consumer;

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe("llm_call_start");
    });

    test("terminates immediately when complete() called with no events", async () => {
      const emitter = new ExecutionTreeEventEmitter();
      let finished = false;

      const consumer = (async () => {
        // biome-ignore lint/correctness/noUnusedVariables: consuming events
        for await (const _event of emitter.events()) {
          // consume
        }
        finished = true;
      })();

      emitter.complete();
      await consumer;

      expect(finished).toBe(true);
    });

    test("drains pre-buffered events before waiting", async () => {
      const emitter = new ExecutionTreeEventEmitter();

      // Emit before any consumer is listening
      emitter.emit(makeEvent("llm_call_start"));
      emitter.emit(makeEvent("gadget_call"));
      emitter.complete();

      const received: ExecutionEvent[] = [];
      for await (const event of emitter.events()) {
        received.push(event);
      }

      expect(received).toHaveLength(2);
    });
  });

  describe("complete / isComplete", () => {
    test("isComplete() returns false initially", () => {
      const emitter = new ExecutionTreeEventEmitter();
      expect(emitter.isComplete()).toBe(false);
    });

    test("isComplete() returns true after complete()", () => {
      const emitter = new ExecutionTreeEventEmitter();
      emitter.complete();
      expect(emitter.isComplete()).toBe(true);
    });

    test("complete() wakes multiple pending waiters", async () => {
      const emitter = new ExecutionTreeEventEmitter();
      const results: boolean[] = [];

      const consumer1 = (async () => {
        // biome-ignore lint/correctness/noUnusedVariables: consuming events
        for await (const _e of emitter.events()) {
          /* empty */
        }
        results.push(true);
      })();

      const consumer2 = (async () => {
        // biome-ignore lint/correctness/noUnusedVariables: consuming events
        for await (const _e of emitter.events()) {
          /* empty */
        }
        results.push(true);
      })();

      emitter.complete();
      await Promise.all([consumer1, consumer2]);

      expect(results).toHaveLength(2);
    });
  });
});
