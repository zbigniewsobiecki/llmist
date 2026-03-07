import { describe, expect, it } from "vitest";

import type { ExecutionEvent } from "./execution-events.js";
import {
  filterByDepth,
  filterByParent,
  filterRootEvents,
  groupByParent,
  isGadgetEvent,
  isLLMEvent,
  isRootEvent,
  isSubagentEvent,
} from "./execution-events.js";

// =============================================================================
// Test Factory
// =============================================================================

let nextEventId = 1;

/**
 * Factory function for creating mock ExecutionEvent objects.
 * Provides sensible defaults while allowing overrides.
 */
function makeEvent(
  overrides: Partial<ExecutionEvent> & Pick<ExecutionEvent, "type">,
): ExecutionEvent {
  const base = {
    eventId: nextEventId++,
    timestamp: Date.now(),
    nodeId: "node-1",
    parentId: null,
    depth: 0,
    path: ["node-1"],
    ...overrides,
  };
  return base as ExecutionEvent;
}

// =============================================================================
// Type Guard: isLLMEvent
// =============================================================================

describe("isLLMEvent", () => {
  it("returns true for llm_call_start events", () => {
    const event = makeEvent({ type: "llm_call_start", iteration: 1, model: "gpt-4" });
    expect(isLLMEvent(event)).toBe(true);
  });

  it("returns true for llm_call_stream events", () => {
    const event = makeEvent({ type: "llm_call_stream", chunk: "hello" });
    expect(isLLMEvent(event)).toBe(true);
  });

  it("returns true for llm_call_complete events", () => {
    const event = makeEvent({ type: "llm_call_complete", response: "done" });
    expect(isLLMEvent(event)).toBe(true);
  });

  it("returns true for llm_call_error events", () => {
    const event = makeEvent({
      type: "llm_call_error",
      error: new Error("oops"),
      recovered: false,
    });
    expect(isLLMEvent(event)).toBe(true);
  });

  it("returns false for llm_response_end (does not start with llm_call_)", () => {
    const event = makeEvent({
      type: "llm_response_end",
      iteration: 1,
      model: "gpt-4",
      finishReason: "stop",
    });
    expect(isLLMEvent(event)).toBe(false);
  });

  it("returns false for gadget events", () => {
    const event = makeEvent({ type: "gadget_start", invocationId: "inv-1", name: "search" });
    expect(isLLMEvent(event)).toBe(false);
  });

  it("returns false for text events", () => {
    const event = makeEvent({ type: "text", content: "hello" });
    expect(isLLMEvent(event)).toBe(false);
  });

  it("returns false for stream_complete events", () => {
    const event = makeEvent({
      type: "stream_complete",
      didExecuteGadgets: false,
      shouldBreakLoop: true,
    });
    expect(isLLMEvent(event)).toBe(false);
  });
});

// =============================================================================
// Type Guard: isGadgetEvent
// =============================================================================

describe("isGadgetEvent", () => {
  it("returns true for gadget_call events", () => {
    const event = makeEvent({
      type: "gadget_call",
      invocationId: "inv-1",
      name: "search",
      parameters: {},
      dependencies: [],
    });
    expect(isGadgetEvent(event)).toBe(true);
  });

  it("returns true for gadget_start events", () => {
    const event = makeEvent({ type: "gadget_start", invocationId: "inv-1", name: "search" });
    expect(isGadgetEvent(event)).toBe(true);
  });

  it("returns true for gadget_complete events", () => {
    const event = makeEvent({
      type: "gadget_complete",
      invocationId: "inv-1",
      name: "search",
      result: "results",
      executionTimeMs: 100,
    });
    expect(isGadgetEvent(event)).toBe(true);
  });

  it("returns true for gadget_error events", () => {
    const event = makeEvent({
      type: "gadget_error",
      invocationId: "inv-1",
      name: "search",
      error: "failed",
      executionTimeMs: 50,
    });
    expect(isGadgetEvent(event)).toBe(true);
  });

  it("returns true for gadget_skipped events", () => {
    const event = makeEvent({
      type: "gadget_skipped",
      invocationId: "inv-1",
      name: "search",
      reason: "dependency_failed",
      error: "dependency failed",
    });
    expect(isGadgetEvent(event)).toBe(true);
  });

  it("returns false for llm_call_start events", () => {
    const event = makeEvent({ type: "llm_call_start", iteration: 1, model: "gpt-4" });
    expect(isGadgetEvent(event)).toBe(false);
  });

  it("returns false for text events", () => {
    const event = makeEvent({ type: "text", content: "hello" });
    expect(isGadgetEvent(event)).toBe(false);
  });

  it("returns false for thinking events", () => {
    const event = makeEvent({
      type: "thinking",
      content: "reasoning...",
      thinkingType: "thinking",
    });
    expect(isGadgetEvent(event)).toBe(false);
  });
});

// =============================================================================
// Type Guard: isSubagentEvent
// =============================================================================

describe("isSubagentEvent", () => {
  it("returns true when depth > 0", () => {
    const event = makeEvent({ type: "text", content: "nested", depth: 1 });
    expect(isSubagentEvent(event)).toBe(true);
  });

  it("returns true for deeper nesting (depth 2)", () => {
    const event = makeEvent({ type: "text", content: "deeply nested", depth: 2 });
    expect(isSubagentEvent(event)).toBe(true);
  });

  it("returns true for deeply nested events (depth 10)", () => {
    const event = makeEvent({ type: "text", content: "very deep", depth: 10 });
    expect(isSubagentEvent(event)).toBe(true);
  });

  it("returns false when depth === 0", () => {
    const event = makeEvent({ type: "text", content: "root level", depth: 0 });
    expect(isSubagentEvent(event)).toBe(false);
  });
});

// =============================================================================
// Type Guard: isRootEvent
// =============================================================================

describe("isRootEvent", () => {
  it("returns true when depth === 0", () => {
    const event = makeEvent({ type: "text", content: "root level", depth: 0 });
    expect(isRootEvent(event)).toBe(true);
  });

  it("returns false when depth === 1", () => {
    const event = makeEvent({ type: "text", content: "nested", depth: 1 });
    expect(isRootEvent(event)).toBe(false);
  });

  it("returns false when depth > 1", () => {
    const event = makeEvent({ type: "text", content: "deeply nested", depth: 5 });
    expect(isRootEvent(event)).toBe(false);
  });

  it("isRootEvent and isSubagentEvent are mutually exclusive", () => {
    const rootEvent = makeEvent({ type: "text", content: "root", depth: 0 });
    const subEvent = makeEvent({ type: "text", content: "sub", depth: 1 });

    expect(isRootEvent(rootEvent)).toBe(true);
    expect(isSubagentEvent(rootEvent)).toBe(false);

    expect(isRootEvent(subEvent)).toBe(false);
    expect(isSubagentEvent(subEvent)).toBe(true);
  });
});

// =============================================================================
// Filter: filterByDepth
// =============================================================================

describe("filterByDepth", () => {
  it("returns events matching the specified depth", () => {
    const events: ExecutionEvent[] = [
      makeEvent({ type: "text", content: "a", depth: 0 }),
      makeEvent({ type: "text", content: "b", depth: 1 }),
      makeEvent({ type: "text", content: "c", depth: 0 }),
      makeEvent({ type: "text", content: "d", depth: 2 }),
    ];

    const result = filterByDepth(events, 0);
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.depth === 0)).toBe(true);
  });

  it("returns empty array when no events match the depth", () => {
    const events: ExecutionEvent[] = [
      makeEvent({ type: "text", content: "a", depth: 0 }),
      makeEvent({ type: "text", content: "b", depth: 1 }),
    ];

    const result = filterByDepth(events, 5);
    expect(result).toHaveLength(0);
  });

  it("returns all events when all have the same depth", () => {
    const events: ExecutionEvent[] = [
      makeEvent({ type: "text", content: "a", depth: 2 }),
      makeEvent({ type: "text", content: "b", depth: 2 }),
      makeEvent({ type: "text", content: "c", depth: 2 }),
    ];

    const result = filterByDepth(events, 2);
    expect(result).toHaveLength(3);
  });

  it("returns empty array for empty input", () => {
    expect(filterByDepth([], 0)).toHaveLength(0);
  });

  it("does not mutate the original array", () => {
    const events: ExecutionEvent[] = [
      makeEvent({ type: "text", content: "a", depth: 0 }),
      makeEvent({ type: "text", content: "b", depth: 1 }),
    ];
    const original = [...events];
    filterByDepth(events, 0);
    expect(events).toEqual(original);
  });
});

// =============================================================================
// Filter: filterByParent
// =============================================================================

describe("filterByParent", () => {
  it("returns events with matching parentId", () => {
    const events: ExecutionEvent[] = [
      makeEvent({ type: "text", content: "a", parentId: "parent-1" }),
      makeEvent({ type: "text", content: "b", parentId: "parent-2" }),
      makeEvent({ type: "text", content: "c", parentId: "parent-1" }),
    ];

    const result = filterByParent(events, "parent-1");
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.parentId === "parent-1")).toBe(true);
  });

  it("returns empty array when no events match the parentId", () => {
    const events: ExecutionEvent[] = [
      makeEvent({ type: "text", content: "a", parentId: "parent-1" }),
    ];

    const result = filterByParent(events, "nonexistent");
    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(filterByParent([], "parent-1")).toHaveLength(0);
  });

  it("does not include events with null parentId when filtering by a string", () => {
    const events: ExecutionEvent[] = [
      makeEvent({ type: "text", content: "root", parentId: null }),
      makeEvent({ type: "text", content: "child", parentId: "parent-1" }),
    ];

    const result = filterByParent(events, "parent-1");
    expect(result).toHaveLength(1);
    expect(result[0]?.parentId).toBe("parent-1");
  });
});

// =============================================================================
// Filter: filterRootEvents
// =============================================================================

describe("filterRootEvents", () => {
  it("returns only events with depth 0", () => {
    const events: ExecutionEvent[] = [
      makeEvent({ type: "text", content: "root-1", depth: 0 }),
      makeEvent({ type: "text", content: "child", depth: 1 }),
      makeEvent({ type: "text", content: "root-2", depth: 0 }),
      makeEvent({ type: "text", content: "grandchild", depth: 2 }),
    ];

    const result = filterRootEvents(events);
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.depth === 0)).toBe(true);
  });

  it("returns empty array when no root events exist", () => {
    const events: ExecutionEvent[] = [
      makeEvent({ type: "text", content: "child", depth: 1 }),
      makeEvent({ type: "text", content: "grandchild", depth: 2 }),
    ];

    const result = filterRootEvents(events);
    expect(result).toHaveLength(0);
  });

  it("returns all events when all are at depth 0", () => {
    const events: ExecutionEvent[] = [
      makeEvent({ type: "text", content: "a", depth: 0 }),
      makeEvent({ type: "text", content: "b", depth: 0 }),
    ];

    const result = filterRootEvents(events);
    expect(result).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(filterRootEvents([])).toHaveLength(0);
  });

  it("is equivalent to filterByDepth(events, 0)", () => {
    const events: ExecutionEvent[] = [
      makeEvent({ type: "text", content: "a", depth: 0 }),
      makeEvent({ type: "text", content: "b", depth: 1 }),
      makeEvent({ type: "text", content: "c", depth: 0 }),
    ];

    expect(filterRootEvents(events)).toEqual(filterByDepth(events, 0));
  });
});

// =============================================================================
// Filter: groupByParent
// =============================================================================

describe("groupByParent", () => {
  it("groups events by their parentId", () => {
    const events: ExecutionEvent[] = [
      makeEvent({ type: "text", content: "a", parentId: null }),
      makeEvent({ type: "text", content: "b", parentId: "node-1" }),
      makeEvent({ type: "text", content: "c", parentId: "node-1" }),
      makeEvent({ type: "text", content: "d", parentId: "node-2" }),
    ];

    const groups = groupByParent(events);

    expect(groups.size).toBe(3);
    expect(groups.get(null)).toHaveLength(1);
    expect(groups.get("node-1")).toHaveLength(2);
    expect(groups.get("node-2")).toHaveLength(1);
  });

  it("returns a Map", () => {
    const events: ExecutionEvent[] = [makeEvent({ type: "text", content: "a", parentId: null })];
    const result = groupByParent(events);
    expect(result).toBeInstanceOf(Map);
  });

  it("returns empty Map for empty input", () => {
    const result = groupByParent([]);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it("groups root events (null parentId) under null key", () => {
    const events: ExecutionEvent[] = [
      makeEvent({ type: "text", content: "root-1", parentId: null }),
      makeEvent({ type: "text", content: "root-2", parentId: null }),
    ];

    const groups = groupByParent(events);
    expect(groups.has(null)).toBe(true);
    expect(groups.get(null)).toHaveLength(2);
  });

  it("preserves event order within each group", () => {
    const event1 = makeEvent({ type: "text", content: "first", parentId: "parent-x" });
    const event2 = makeEvent({ type: "text", content: "second", parentId: "parent-x" });
    const event3 = makeEvent({ type: "text", content: "third", parentId: "parent-x" });

    const groups = groupByParent([event1, event2, event3]);
    const group = groups.get("parent-x");

    expect(group).toEqual([event1, event2, event3]);
  });

  it("handles a single event", () => {
    const event = makeEvent({ type: "text", content: "alone", parentId: "parent-solo" });
    const groups = groupByParent([event]);

    expect(groups.size).toBe(1);
    expect(groups.get("parent-solo")).toEqual([event]);
  });

  it("handles multiple distinct parents", () => {
    const events: ExecutionEvent[] = [
      makeEvent({ type: "text", content: "a", parentId: "p1" }),
      makeEvent({ type: "text", content: "b", parentId: "p2" }),
      makeEvent({ type: "text", content: "c", parentId: "p3" }),
    ];

    const groups = groupByParent(events);
    expect(groups.size).toBe(3);
    expect(groups.get("p1")).toHaveLength(1);
    expect(groups.get("p2")).toHaveLength(1);
    expect(groups.get("p3")).toHaveLength(1);
  });
});
