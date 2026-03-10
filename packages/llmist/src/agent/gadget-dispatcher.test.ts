import type { ILogObj, Logger } from "tslog";
import { describe, expect, it, vi } from "vitest";
import type { AbstractGadget } from "../gadgets/gadget.js";
import { GadgetRegistry } from "../gadgets/registry.js";
import type { ParsedGadgetCall, StreamEvent } from "../gadgets/types.js";
import { GadgetConcurrencyManager } from "./gadget-concurrency-manager.js";
import { GadgetDependencyResolver } from "./gadget-dependency-resolver.js";
import { GadgetDispatcher } from "./gadget-dispatcher.js";
import type { GadgetHookLifecycle } from "./gadget-hook-lifecycle.js";
import { GadgetLimitGuard } from "./gadget-limit-guard.js";
import type { AgentHooks } from "./hooks.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLogger(): Logger<ILogObj> {
  return {
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    silly: vi.fn(),
  } as unknown as Logger<ILogObj>;
}

function makeCall(
  invocationId: string,
  gadgetName = "TestGadget",
  dependencies: string[] = [],
): ParsedGadgetCall {
  return {
    invocationId,
    gadgetName,
    parametersRaw: "{}",
    parameters: {},
    dependencies,
  };
}

/**
 * Create a minimal mock GadgetHookLifecycle that yields a single gadget_result event.
 */
function createMockLifecycle(
  resultOverride?: Partial<StreamEvent & { type: "gadget_result" }>,
): GadgetHookLifecycle & { executeCallCount: number } {
  let executeCallCount = 0;

  const lifecycle = {
    get executeCallCount() {
      return executeCallCount;
    },
    async *execute(call: ParsedGadgetCall): AsyncGenerator<StreamEvent> {
      executeCallCount++;
      yield {
        type: "gadget_result",
        result: {
          gadgetName: call.gadgetName,
          invocationId: call.invocationId,
          parameters: call.parameters ?? {},
          result: "lifecycle result",
          executionTimeMs: 1,
        },
        ...resultOverride,
      } as StreamEvent;
    },
  } as unknown as GadgetHookLifecycle & { executeCallCount: number };

  return lifecycle;
}

/**
 * Create a GadgetRegistry with pre-registered minimal gadgets.
 */
function createRegistry(
  gadgets: Array<{ name: string; maxConcurrent?: number; exclusive?: boolean }> = [],
): GadgetRegistry {
  const registry = new GadgetRegistry();
  for (const g of gadgets) {
    registry.register(g.name, {
      name: g.name,
      maxConcurrent: g.maxConcurrent,
      exclusive: g.exclusive,
    } as unknown as AbstractGadget);
  }
  return registry;
}

interface DispatcherConfig {
  hooks?: AgentHooks;
  gadgetExecutionMode?: "parallel" | "sequential";
  maxGadgetsPerResponse?: number;
  gadgets?: Array<{ name: string; maxConcurrent?: number; exclusive?: boolean }>;
}

function createDispatcher(opts: DispatcherConfig = {}): {
  dispatcher: GadgetDispatcher;
  lifecycle: GadgetHookLifecycle & { executeCallCount: number };
  resolver: GadgetDependencyResolver;
  queue: StreamEvent[];
} {
  const resolver = new GadgetDependencyResolver();
  const lifecycle = createMockLifecycle();
  const registry = createRegistry(opts.gadgets ?? [{ name: "TestGadget" }]);
  const concurrencyManager = new GadgetConcurrencyManager({ registry });
  const limitGuard = new GadgetLimitGuard({
    maxGadgetsPerResponse: opts.maxGadgetsPerResponse ?? 0,
  });
  const queue: StreamEvent[] = [];

  const dispatcher = new GadgetDispatcher({
    iteration: 1,
    hookLifecycle: lifecycle,
    dependencyResolver: resolver,
    concurrencyManager,
    limitGuard,
    gadgetExecutionMode: opts.gadgetExecutionMode ?? "sequential",
    hooks: opts.hooks ?? {},
    logger: createMockLogger(),
    pushToQueue: (evt) => queue.push(evt),
    drainQueue: () => {
      const evts = [...queue];
      queue.length = 0;
      return evts;
    },
  });

  return { dispatcher, lifecycle, resolver, queue };
}

/**
 * Collect all events from dispatcher.dispatch() into an array.
 */
async function collectDispatch(
  dispatcher: GadgetDispatcher,
  call: ParsedGadgetCall,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const evt of dispatcher.dispatch(call)) {
    events.push(evt);
  }
  return events;
}

/**
 * Collect all events from dispatcher.processPendingGadgets() into an array.
 */
async function collectPending(dispatcher: GadgetDispatcher): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const evt of dispatcher.processPendingGadgets()) {
    events.push(evt);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GadgetDispatcher", () => {
  // =========================================================================
  // dispatch: real-time gadget_call event
  // =========================================================================

  describe("dispatch: gadget_call event", () => {
    it("yields gadget_call immediately when dispatched", async () => {
      const { dispatcher } = createDispatcher();

      const events = await collectDispatch(dispatcher, makeCall("g1"));

      expect(events[0]).toMatchObject({
        type: "gadget_call",
        call: expect.objectContaining({ invocationId: "g1" }),
      });
    });

    it("does NOT yield gadget_call when limit is already exceeded", async () => {
      const { dispatcher } = createDispatcher({ maxGadgetsPerResponse: 1 });

      await collectDispatch(dispatcher, makeCall("g1")); // admitted
      await collectDispatch(dispatcher, makeCall("g2")); // limit exceeded

      // Now limitGuard.isLimitExceeded is true; subsequent dispatches return no events
      const events = await collectDispatch(dispatcher, makeCall("g3"));

      expect(events).toHaveLength(0);
    });
  });

  // =========================================================================
  // dispatch: no dependencies
  // =========================================================================

  describe("dispatch: no dependencies (sequential mode)", () => {
    it("executes gadget via lifecycle in sequential mode", async () => {
      const { dispatcher, lifecycle } = createDispatcher({ gadgetExecutionMode: "sequential" });

      await collectDispatch(dispatcher, makeCall("g1"));

      expect(lifecycle.executeCallCount).toBe(1);
    });

    it("yields gadget_call then gadget_result in sequential mode", async () => {
      const { dispatcher } = createDispatcher({ gadgetExecutionMode: "sequential" });

      const events = await collectDispatch(dispatcher, makeCall("g1"));

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("gadget_call");
      expect(events[1].type).toBe("gadget_result");
    });

    it("skips gadget and yields skip event when limit is exceeded", async () => {
      const { dispatcher } = createDispatcher({
        maxGadgetsPerResponse: 1,
        gadgetExecutionMode: "sequential",
      });

      await collectDispatch(dispatcher, makeCall("g1")); // admitted

      const events = await collectDispatch(dispatcher, makeCall("g2")); // limit exceeded

      expect(events.some((e) => e.type === "gadget_call")).toBe(true);
      expect(events.some((e) => e.type === "gadget_skipped")).toBe(true);
      expect(events.some((e) => e.type === "gadget_result")).toBe(false);
    });
  });

  // =========================================================================
  // dispatch: dependencies — pending queue
  // =========================================================================

  describe("dispatch: with unmet dependencies", () => {
    it("queues gadget when dependency is not yet satisfied", async () => {
      const { dispatcher, resolver } = createDispatcher({ gadgetExecutionMode: "sequential" });

      const events = await collectDispatch(dispatcher, makeCall("g2", "TestGadget", ["g1"]));

      // Should only emit gadget_call (dispatch is deferred)
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("gadget_call");
      // Gadget should be in pending state
      expect(resolver.pendingCount).toBe(1);
    });

    it("executes pending gadget via processPendingGadgets after dependency completes", async () => {
      const { dispatcher, resolver, lifecycle } = createDispatcher({
        gadgetExecutionMode: "sequential",
      });

      // Queue g2 which depends on g1
      await collectDispatch(dispatcher, makeCall("g2", "TestGadget", ["g1"]));

      // Mark g1 as complete
      resolver.markComplete({
        gadgetName: "TestGadget",
        invocationId: "g1",
        parameters: {},
        result: "g1 result",
        executionTimeMs: 1,
      });

      // Process pending gadgets
      const pendingEvents = await collectPending(dispatcher);

      expect(lifecycle.executeCallCount).toBe(1);
      expect(pendingEvents.some((e) => e.type === "gadget_result")).toBe(true);
    });

    it("skips pending gadget when dependency has failed", async () => {
      const { dispatcher, resolver } = createDispatcher({ gadgetExecutionMode: "sequential" });

      // Queue g2 which depends on g1
      await collectDispatch(dispatcher, makeCall("g2", "TestGadget", ["g1"]));

      // Mark g1 as failed
      resolver.markFailed("g1");

      // Process pending gadgets
      const pendingEvents = await collectPending(dispatcher);

      expect(pendingEvents.some((e) => e.type === "gadget_skipped")).toBe(true);
    });

    it("immediately skips gadget when dependency is already failed at dispatch time", async () => {
      const { dispatcher, resolver } = createDispatcher({ gadgetExecutionMode: "sequential" });

      // Pre-mark g1 as failed before dispatching g2
      resolver.markFailed("g1");

      const events = await collectDispatch(dispatcher, makeCall("g2", "TestGadget", ["g1"]));

      // Should include gadget_call (already yielded) and gadget_skipped
      expect(events.some((e) => e.type === "gadget_call")).toBe(true);
      expect(events.some((e) => e.type === "gadget_skipped")).toBe(true);
      expect(events.some((e) => e.type === "gadget_result")).toBe(false);
    });
  });

  // =========================================================================
  // dispatch: self-referential dependency
  // =========================================================================

  describe("dispatch: self-referential dependency", () => {
    it("skips gadget that depends on itself", async () => {
      const { dispatcher } = createDispatcher({ gadgetExecutionMode: "sequential" });

      const events = await collectDispatch(
        dispatcher,
        makeCall("g1", "TestGadget", ["g1"]), // depends on itself
      );

      expect(events.some((e) => e.type === "gadget_skipped")).toBe(true);
      expect(events.some((e) => e.type === "gadget_result")).toBe(false);
    });

    it("self-referential skip event has invocationId in failedDependency field", async () => {
      const { dispatcher } = createDispatcher({ gadgetExecutionMode: "sequential" });

      const events = await collectDispatch(
        dispatcher,
        makeCall("self-ref", "TestGadget", ["self-ref"]),
      );

      const skipEvent = events.find((e) => e.type === "gadget_skipped");
      expect(skipEvent).toMatchObject({
        type: "gadget_skipped",
        invocationId: "self-ref",
        failedDependency: "self-ref",
      });
    });
  });

  // =========================================================================
  // emitGadgetSkipEvents
  // =========================================================================

  describe("emitGadgetSkipEvents", () => {
    it("marks gadget as failed in resolver", async () => {
      const { dispatcher, resolver } = createDispatcher();
      const call = makeCall("g1");

      const events: StreamEvent[] = [];
      for await (const evt of dispatcher.emitGadgetSkipEvents(call, "dep-id", "dep failed")) {
        events.push(evt);
      }

      expect(resolver.isFailed("g1")).toBe(true);
    });

    it("yields a gadget_skipped event with the correct fields", async () => {
      const { dispatcher } = createDispatcher();
      const call = makeCall("g1");

      const events: StreamEvent[] = [];
      for await (const evt of dispatcher.emitGadgetSkipEvents(
        call,
        "dep-id",
        "dep error message",
      )) {
        events.push(evt);
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_skipped",
        gadgetName: "TestGadget",
        invocationId: "g1",
        failedDependency: "dep-id",
        failedDependencyError: "dep error message",
      });
    });

    it("calls onGadgetSkipped observer", async () => {
      const onGadgetSkipped = vi.fn().mockResolvedValue(undefined);
      const { dispatcher } = createDispatcher({ hooks: { observers: { onGadgetSkipped } } });
      const call = makeCall("g1");

      const events: StreamEvent[] = [];
      for await (const evt of dispatcher.emitGadgetSkipEvents(call, "dep-id", "error")) {
        events.push(evt);
      }

      expect(onGadgetSkipped).toHaveBeenCalledOnce();
      expect(onGadgetSkipped).toHaveBeenCalledWith(
        expect.objectContaining({ gadgetName: "TestGadget", invocationId: "g1" }),
      );
    });
  });

  // =========================================================================
  // handleFailedDependency
  // =========================================================================

  describe("handleFailedDependency", () => {
    it("skips gadget by default (no controller)", async () => {
      const { dispatcher, resolver } = createDispatcher();
      const call = makeCall("g2", "TestGadget", ["g1"]);

      // Mark g1 as failed with a recorded result
      resolver.markComplete({
        gadgetName: "TestGadget",
        invocationId: "g1",
        parameters: {},
        result: undefined,
        error: "g1 error",
        executionTimeMs: 1,
      });

      const events = await dispatcher.handleFailedDependency(call, "g1");

      expect(events.some((e) => e.type === "gadget_skipped")).toBe(true);
    });

    it("executes gadget when controller returns execute_anyway", async () => {
      const hooks: AgentHooks = {
        controllers: {
          onDependencySkipped: vi.fn().mockResolvedValue({ action: "execute_anyway" }),
        },
      };
      const { dispatcher, lifecycle } = createDispatcher({ hooks });
      const call = makeCall("g2");

      await dispatcher.handleFailedDependency(call, "g1");

      expect(lifecycle.executeCallCount).toBe(1);
    });

    it("uses fallback result when controller returns use_fallback", async () => {
      const hooks: AgentHooks = {
        controllers: {
          onDependencySkipped: vi.fn().mockResolvedValue({
            action: "use_fallback",
            fallbackResult: "fallback data",
          }),
        },
      };
      const { dispatcher, resolver } = createDispatcher({ hooks });
      const call = makeCall("g2");

      const events = await dispatcher.handleFailedDependency(call, "g1");

      const resultEvent = events.find((e) => e.type === "gadget_result");
      expect(resultEvent).toMatchObject({
        type: "gadget_result",
        result: expect.objectContaining({ result: "fallback data" }),
      });
      // Marks as complete in resolver so other gadgets can depend on it
      expect(resolver.isCompleted("g2")).toBe(true);
    });
  });

  // =========================================================================
  // processPendingGadgets: circular dependency detection
  // =========================================================================

  describe("processPendingGadgets: circular dependencies", () => {
    it("emits skip events for circular dependencies and clears pending", async () => {
      const { dispatcher, resolver } = createDispatcher({ gadgetExecutionMode: "sequential" });

      // Create circular dependency: g1 → g2, g2 → g1
      await collectDispatch(dispatcher, makeCall("g1", "TestGadget", ["g2"]));
      await collectDispatch(dispatcher, makeCall("g2", "TestGadget", ["g1"]));

      const pendingEvents = await collectPending(dispatcher);

      // Both should be skipped
      const skipEvents = pendingEvents.filter((e) => e.type === "gadget_skipped");
      expect(skipEvents).toHaveLength(2);
      // Pending should be cleared
      expect(resolver.pendingCount).toBe(0);
    });
  });

  // =========================================================================
  // maxGadgetsPerResponse limit: marks skipped as failed in resolver
  // =========================================================================

  describe("maxGadgetsPerResponse: dependency resolver integration", () => {
    it("marks limit-exceeded gadget as failed so dependent gadgets are skipped", async () => {
      const { dispatcher, resolver } = createDispatcher({
        maxGadgetsPerResponse: 1,
        gadgetExecutionMode: "sequential",
      });

      await collectDispatch(dispatcher, makeCall("g1")); // admitted

      // Queue g3 which depends on g2
      await collectDispatch(dispatcher, makeCall("g3", "TestGadget", ["g2"]));

      // g2 is limit-exceeded
      await collectDispatch(dispatcher, makeCall("g2")); // skipped due to limit

      // g2 should be marked as failed so g3 is skipped
      expect(resolver.isFailed("g2")).toBe(true);
    });
  });
});
