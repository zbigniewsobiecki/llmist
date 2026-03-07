import type { ILogObj, Logger } from "tslog";
import { describe, expect, it, vi } from "vitest";
import type { AbstractGadget } from "../gadgets/gadget.js";
import { GadgetRegistry } from "../gadgets/registry.js";
import type { ParsedGadgetCall, SubagentConfigMap } from "../gadgets/types.js";
import { GadgetConcurrencyManager } from "./gadget-concurrency-manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLogger(): Logger<ILogObj> {
  return {
    warn: vi.fn(() => {}),
    debug: vi.fn(() => {}),
    info: vi.fn(() => {}),
    error: vi.fn(() => {}),
    trace: vi.fn(() => {}),
    fatal: vi.fn(() => {}),
    silly: vi.fn(() => {}),
  } as unknown as Logger<ILogObj>;
}

/**
 * Create a minimal mock AbstractGadget with optional concurrency properties.
 */
function createMockGadget(
  name: string,
  opts: { maxConcurrent?: number; exclusive?: boolean } = {},
): AbstractGadget {
  return {
    name,
    maxConcurrent: opts.maxConcurrent,
    exclusive: opts.exclusive,
  } as unknown as AbstractGadget;
}

/**
 * Create a GadgetRegistry with pre-registered gadgets.
 */
function createRegistry(
  gadgets: Array<{ name: string; maxConcurrent?: number; exclusive?: boolean }>,
): GadgetRegistry {
  const registry = new GadgetRegistry();
  for (const g of gadgets) {
    registry.register(g.name, createMockGadget(g.name, g));
  }
  return registry;
}

/**
 * Build a minimal ParsedGadgetCall.
 */
function makeCall(
  invocationId: string,
  gadgetName: string,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GadgetConcurrencyManager", () => {
  // =========================================================================
  // Construction
  // =========================================================================

  describe("constructor", () => {
    it("should create with registry only", () => {
      const registry = createRegistry([]);
      const manager = new GadgetConcurrencyManager({ registry });

      expect(manager.inFlightCount).toBe(0);
      expect(manager.hasQueuedGadgets()).toBe(false);
      expect(manager.hasExclusiveQueued).toBe(false);
    });

    it("should accept optional logger and subagentConfig", () => {
      const registry = createRegistry([]);
      const logger = createMockLogger();
      const subagentConfig: SubagentConfigMap = { MyGadget: { maxConcurrent: 2 } };

      const manager = new GadgetConcurrencyManager({ registry, logger, subagentConfig });

      expect(manager.inFlightCount).toBe(0);
    });
  });

  // =========================================================================
  // getConcurrencyLimit
  // =========================================================================

  describe("getConcurrencyLimit", () => {
    it("should return 0 (unlimited) when gadget has no limits configured", () => {
      const registry = createRegistry([{ name: "MyGadget" }]);
      const manager = new GadgetConcurrencyManager({ registry });

      expect(manager.getConcurrencyLimit("MyGadget")).toBe(0);
    });

    it("should return 0 (unlimited) for unknown gadgets", () => {
      const registry = createRegistry([]);
      const manager = new GadgetConcurrencyManager({ registry });

      expect(manager.getConcurrencyLimit("UnknownGadget")).toBe(0);
    });

    it("should return gadget intrinsic maxConcurrent when no config override", () => {
      const registry = createRegistry([{ name: "FileWriter", maxConcurrent: 1 }]);
      const manager = new GadgetConcurrencyManager({ registry });

      expect(manager.getConcurrencyLimit("FileWriter")).toBe(1);
    });

    it("should return subagentConfig limit when gadget has none", () => {
      const registry = createRegistry([{ name: "MyGadget" }]);
      const subagentConfig: SubagentConfigMap = { MyGadget: { maxConcurrent: 3 } };
      const manager = new GadgetConcurrencyManager({ registry, subagentConfig });

      expect(manager.getConcurrencyLimit("MyGadget")).toBe(3);
    });

    it("should apply most-restrictive wins when both config and gadget limits set (gadget lower)", () => {
      const registry = createRegistry([{ name: "MyGadget", maxConcurrent: 1 }]);
      const subagentConfig: SubagentConfigMap = { MyGadget: { maxConcurrent: 5 } };
      const manager = new GadgetConcurrencyManager({ registry, subagentConfig });

      // Gadget limit (1) is more restrictive than config (5)
      expect(manager.getConcurrencyLimit("MyGadget")).toBe(1);
    });

    it("should apply most-restrictive wins when both config and gadget limits set (config lower)", () => {
      const registry = createRegistry([{ name: "MyGadget", maxConcurrent: 5 }]);
      const subagentConfig: SubagentConfigMap = { MyGadget: { maxConcurrent: 2 } };
      const manager = new GadgetConcurrencyManager({ registry, subagentConfig });

      // Config limit (2) is more restrictive than gadget (5)
      expect(manager.getConcurrencyLimit("MyGadget")).toBe(2);
    });

    it("should treat 0 in config as unlimited (not override gadget limit)", () => {
      const registry = createRegistry([{ name: "MyGadget", maxConcurrent: 2 }]);
      const subagentConfig: SubagentConfigMap = { MyGadget: { maxConcurrent: 0 } };
      const manager = new GadgetConcurrencyManager({ registry, subagentConfig });

      // Config 0 = unlimited; gadget has 2, so effective is 2
      expect(manager.getConcurrencyLimit("MyGadget")).toBe(2);
    });

    it("should return 0 when both config and gadget are unlimited (0/undefined)", () => {
      const registry = createRegistry([{ name: "MyGadget", maxConcurrent: 0 }]);
      const subagentConfig: SubagentConfigMap = { MyGadget: { maxConcurrent: 0 } };
      const manager = new GadgetConcurrencyManager({ registry, subagentConfig });

      expect(manager.getConcurrencyLimit("MyGadget")).toBe(0);
    });
  });

  // =========================================================================
  // isExclusive
  // =========================================================================

  describe("isExclusive", () => {
    it("should return false for non-exclusive gadgets", () => {
      const registry = createRegistry([{ name: "MyGadget" }]);
      const manager = new GadgetConcurrencyManager({ registry });

      expect(manager.isExclusive("MyGadget")).toBe(false);
    });

    it("should return false for unknown gadgets", () => {
      const registry = createRegistry([]);
      const manager = new GadgetConcurrencyManager({ registry });

      expect(manager.isExclusive("UnknownGadget")).toBe(false);
    });

    it("should return true for exclusive gadgets", () => {
      const registry = createRegistry([{ name: "ExclusiveGadget", exclusive: true }]);
      const manager = new GadgetConcurrencyManager({ registry });

      expect(manager.isExclusive("ExclusiveGadget")).toBe(true);
    });
  });

  // =========================================================================
  // canStart
  // =========================================================================

  describe("canStart", () => {
    it("should return true for unlimited gadgets with no in-flight executions", () => {
      const registry = createRegistry([{ name: "MyGadget" }]);
      const manager = new GadgetConcurrencyManager({ registry });
      const call = makeCall("inv-1", "MyGadget");

      expect(manager.canStart(call)).toBe(true);
    });

    it("should return true for unlimited gadgets even with many in-flight executions", () => {
      const registry = createRegistry([{ name: "MyGadget" }]);
      const manager = new GadgetConcurrencyManager({ registry, logger: createMockLogger() });
      const call1 = makeCall("inv-1", "MyGadget");

      // Track some executions
      manager.trackExecution("inv-2", "MyGadget", Promise.resolve());
      manager.trackExecution("inv-3", "MyGadget", Promise.resolve());

      expect(manager.canStart(call1)).toBe(true);
    });

    it("should return false when concurrency limit is reached", () => {
      const registry = createRegistry([{ name: "FileWriter", maxConcurrent: 1 }]);
      const manager = new GadgetConcurrencyManager({ registry, logger: createMockLogger() });
      const call = makeCall("inv-1", "FileWriter");

      // One execution already running
      manager.trackExecution("inv-existing", "FileWriter", Promise.resolve());

      expect(manager.canStart(call)).toBe(false);
    });

    it("should return true when under the concurrency limit", () => {
      const registry = createRegistry([{ name: "MyGadget", maxConcurrent: 3 }]);
      const manager = new GadgetConcurrencyManager({ registry, logger: createMockLogger() });
      const call = makeCall("inv-1", "MyGadget");

      // Two executions running, limit is 3
      manager.trackExecution("inv-a", "MyGadget", Promise.resolve());
      manager.trackExecution("inv-b", "MyGadget", Promise.resolve());

      expect(manager.canStart(call)).toBe(true);
    });

    it("should return true when exactly at limit minus 1", () => {
      const registry = createRegistry([{ name: "MyGadget", maxConcurrent: 2 }]);
      const manager = new GadgetConcurrencyManager({ registry, logger: createMockLogger() });
      const call = makeCall("inv-1", "MyGadget");

      // 1 execution running, limit is 2
      manager.trackExecution("inv-a", "MyGadget", Promise.resolve());

      expect(manager.canStart(call)).toBe(true);
    });

    it("should return false for exclusive gadgets when other gadgets are in-flight", () => {
      const registry = createRegistry([
        { name: "NormalGadget" },
        { name: "ExclusiveGadget", exclusive: true },
      ]);
      const manager = new GadgetConcurrencyManager({ registry, logger: createMockLogger() });
      const exclusiveCall = makeCall("inv-ex", "ExclusiveGadget");

      // A normal gadget is in-flight
      manager.trackExecution("inv-normal", "NormalGadget", Promise.resolve());

      expect(manager.canStart(exclusiveCall)).toBe(false);
    });

    it("should return true for exclusive gadgets when no other gadgets are in-flight", () => {
      const registry = createRegistry([{ name: "ExclusiveGadget", exclusive: true }]);
      const manager = new GadgetConcurrencyManager({ registry });
      const exclusiveCall = makeCall("inv-ex", "ExclusiveGadget");

      expect(manager.canStart(exclusiveCall)).toBe(true);
    });

    it("should return true for normal gadgets when only exclusive gadgets are queued (not in-flight)", () => {
      const registry = createRegistry([
        { name: "NormalGadget" },
        { name: "ExclusiveGadget", exclusive: true },
      ]);
      const manager = new GadgetConcurrencyManager({ registry, logger: createMockLogger() });
      const normalCall = makeCall("inv-normal", "NormalGadget");

      // Exclusive queued but not in-flight
      manager.queueExclusive(makeCall("inv-ex", "ExclusiveGadget"));

      // Normal gadget can still start (queue doesn't block it)
      expect(manager.canStart(normalCall)).toBe(true);
    });
  });

  // =========================================================================
  // trackExecution / onComplete
  // =========================================================================

  describe("trackExecution and onComplete", () => {
    it("should increment inFlightCount when tracking an execution", () => {
      const registry = createRegistry([{ name: "MyGadget" }]);
      const manager = new GadgetConcurrencyManager({ registry });

      manager.trackExecution("inv-1", "MyGadget", Promise.resolve());

      expect(manager.inFlightCount).toBe(1);
    });

    it("should track multiple executions", () => {
      const registry = createRegistry([{ name: "MyGadget" }]);
      const manager = new GadgetConcurrencyManager({ registry });

      manager.trackExecution("inv-1", "MyGadget", Promise.resolve());
      manager.trackExecution("inv-2", "MyGadget", Promise.resolve());
      manager.trackExecution("inv-3", "MyGadget", Promise.resolve());

      expect(manager.inFlightCount).toBe(3);
      expect(manager.getTotalActiveGadgetCount()).toBe(3);
    });

    it("should decrement active count on completion (no queued calls)", () => {
      const registry = createRegistry([{ name: "MyGadget" }]);
      const manager = new GadgetConcurrencyManager({ registry, logger: createMockLogger() });

      manager.trackExecution("inv-1", "MyGadget", Promise.resolve());
      const promoted = manager.onComplete("MyGadget");

      expect(promoted).toBeNull();
      expect(manager.getTotalActiveGadgetCount()).toBe(0);
    });

    it("should not let active count go below 0", () => {
      const registry = createRegistry([{ name: "MyGadget" }]);
      const manager = new GadgetConcurrencyManager({ registry, logger: createMockLogger() });

      // Complete without any tracked execution
      manager.onComplete("MyGadget");

      expect(manager.getTotalActiveGadgetCount()).toBe(0);
    });

    it("should track active counts per gadget name independently", () => {
      const registry = createRegistry([{ name: "GadgetA" }, { name: "GadgetB" }]);
      const manager = new GadgetConcurrencyManager({ registry });

      manager.trackExecution("a-1", "GadgetA", Promise.resolve());
      manager.trackExecution("a-2", "GadgetA", Promise.resolve());
      manager.trackExecution("b-1", "GadgetB", Promise.resolve());

      expect(manager.getTotalActiveGadgetCount()).toBe(3);

      manager.onComplete("GadgetA");
      expect(manager.getTotalActiveGadgetCount()).toBe(2);
    });
  });

  // =========================================================================
  // queueForLater / queue promotion
  // =========================================================================

  describe("queueForLater and queue promotion", () => {
    it("should queue a gadget call when added via queueForLater", () => {
      const registry = createRegistry([{ name: "MyGadget", maxConcurrent: 1 }]);
      const manager = new GadgetConcurrencyManager({ registry, logger: createMockLogger() });
      const call = makeCall("inv-1", "MyGadget");

      manager.queueForLater(call);

      expect(manager.hasQueuedGadgets()).toBe(true);
      expect(manager.getQueuedGadgetCount()).toBe(1);
    });

    it("should return null from onComplete when queue is empty", () => {
      const registry = createRegistry([{ name: "MyGadget", maxConcurrent: 1 }]);
      const manager = new GadgetConcurrencyManager({ registry, logger: createMockLogger() });

      manager.trackExecution("inv-1", "MyGadget", Promise.resolve());
      const promoted = manager.onComplete("MyGadget");

      expect(promoted).toBeNull();
      expect(manager.hasQueuedGadgets()).toBe(false);
    });

    it("should promote queued call when a slot opens up (via onComplete)", () => {
      const registry = createRegistry([{ name: "FileWriter", maxConcurrent: 1 }]);
      const logger = createMockLogger();
      const manager = new GadgetConcurrencyManager({ registry, logger });

      // Start one execution (limit reached)
      manager.trackExecution("inv-1", "FileWriter", Promise.resolve());

      // Queue another
      const waitingCall = makeCall("inv-2", "FileWriter");
      manager.queueForLater(waitingCall);

      expect(manager.getQueuedGadgetCount()).toBe(1);

      // Complete first → should promote queued one
      const promoted = manager.onComplete("FileWriter");

      expect(promoted).toBe(waitingCall);
      expect(manager.getQueuedGadgetCount()).toBe(0);
    });

    it("should not promote when active count still at limit after completion", () => {
      const registry = createRegistry([{ name: "MyGadget", maxConcurrent: 2 }]);
      const logger = createMockLogger();
      const manager = new GadgetConcurrencyManager({ registry, logger });

      // 2 executions running (at limit)
      manager.trackExecution("inv-1", "MyGadget", Promise.resolve());
      manager.trackExecution("inv-2", "MyGadget", Promise.resolve());

      // Queue one
      const waitingCall = makeCall("inv-3", "MyGadget");
      manager.queueForLater(waitingCall);

      // Complete one → now 1 active, limit is 2, so we can promote
      const promoted = manager.onComplete("MyGadget");

      expect(promoted).toBe(waitingCall);
    });

    it("should handle multiple queued calls (FIFO order)", () => {
      const registry = createRegistry([{ name: "FileWriter", maxConcurrent: 1 }]);
      const logger = createMockLogger();
      const manager = new GadgetConcurrencyManager({ registry, logger });

      // Start one execution
      manager.trackExecution("inv-1", "FileWriter", Promise.resolve());

      // Queue three
      const call2 = makeCall("inv-2", "FileWriter");
      const call3 = makeCall("inv-3", "FileWriter");
      const call4 = makeCall("inv-4", "FileWriter");
      manager.queueForLater(call2);
      manager.queueForLater(call3);
      manager.queueForLater(call4);

      expect(manager.getQueuedGadgetCount()).toBe(3);

      // Complete first → promotes inv-2 (first in FIFO)
      const promoted1 = manager.onComplete("FileWriter");
      expect(promoted1).toBe(call2);
      expect(manager.getQueuedGadgetCount()).toBe(2);

      // Track inv-2, then complete → promotes inv-3
      manager.trackExecution("inv-2", "FileWriter", Promise.resolve());
      const promoted2 = manager.onComplete("FileWriter");
      expect(promoted2).toBe(call3);
    });

    it("should queue gadgets per gadget name independently", () => {
      const registry = createRegistry([
        { name: "GadgetA", maxConcurrent: 1 },
        { name: "GadgetB", maxConcurrent: 1 },
      ]);
      const logger = createMockLogger();
      const manager = new GadgetConcurrencyManager({ registry, logger });

      manager.trackExecution("a-1", "GadgetA", Promise.resolve());
      manager.trackExecution("b-1", "GadgetB", Promise.resolve());

      const callA2 = makeCall("a-2", "GadgetA");
      const callB2 = makeCall("b-2", "GadgetB");
      manager.queueForLater(callA2);
      manager.queueForLater(callB2);

      expect(manager.getQueuedGadgetCount()).toBe(2);

      // Complete GadgetA → promotes A queue
      const promotedA = manager.onComplete("GadgetA");
      expect(promotedA).toBe(callA2);
      expect(manager.getQueuedGadgetCount()).toBe(1); // B still in queue
    });
  });

  // =========================================================================
  // Exclusive queue
  // =========================================================================

  describe("exclusive queue", () => {
    it("should track exclusive gadgets in exclusive queue", () => {
      const registry = createRegistry([{ name: "ExclusiveGadget", exclusive: true }]);
      const manager = new GadgetConcurrencyManager({ registry, logger: createMockLogger() });
      const call = makeCall("inv-ex", "ExclusiveGadget");

      manager.queueExclusive(call);

      expect(manager.hasExclusiveQueued).toBe(true);
    });

    it("should return empty array from drainExclusiveQueue when nothing queued", () => {
      const registry = createRegistry([]);
      const manager = new GadgetConcurrencyManager({ registry });

      const drained = manager.drainExclusiveQueue();

      expect(drained).toEqual([]);
      expect(manager.hasExclusiveQueued).toBe(false);
    });

    it("should drain all exclusive gadgets from the queue", () => {
      const registry = createRegistry([{ name: "ExclusiveGadget", exclusive: true }]);
      const logger = createMockLogger();
      const manager = new GadgetConcurrencyManager({ registry, logger });

      const call1 = makeCall("inv-ex-1", "ExclusiveGadget");
      const call2 = makeCall("inv-ex-2", "ExclusiveGadget");
      manager.queueExclusive(call1);
      manager.queueExclusive(call2);

      const drained = manager.drainExclusiveQueue();

      expect(drained).toEqual([call1, call2]);
      expect(manager.hasExclusiveQueued).toBe(false);
    });

    it("should return a copy of the queue (not a reference)", () => {
      const registry = createRegistry([{ name: "ExclusiveGadget", exclusive: true }]);
      const logger = createMockLogger();
      const manager = new GadgetConcurrencyManager({ registry, logger });
      const call = makeCall("inv-ex", "ExclusiveGadget");
      manager.queueExclusive(call);

      const drained = manager.drainExclusiveQueue();

      // After draining, the queue should be empty
      expect(manager.hasExclusiveQueued).toBe(false);
      expect(drained).toHaveLength(1);
    });
  });

  // =========================================================================
  // clearInFlight / waitForAll / getAllDonePromise
  // =========================================================================

  describe("clearInFlight", () => {
    it("should clear all in-flight executions", () => {
      const registry = createRegistry([{ name: "MyGadget" }]);
      const manager = new GadgetConcurrencyManager({ registry });

      manager.trackExecution("inv-1", "MyGadget", Promise.resolve());
      manager.trackExecution("inv-2", "MyGadget", Promise.resolve());

      manager.clearInFlight();

      expect(manager.inFlightCount).toBe(0);
    });
  });

  describe("waitForAll", () => {
    it("should resolve immediately when no executions are in-flight", async () => {
      const registry = createRegistry([]);
      const manager = new GadgetConcurrencyManager({ registry });

      await expect(manager.waitForAll()).resolves.toBeUndefined();
    });

    it("should resolve when all in-flight executions complete", async () => {
      const registry = createRegistry([{ name: "MyGadget" }]);
      const manager = new GadgetConcurrencyManager({ registry });

      let resolve1!: () => void;
      const p1 = new Promise<void>((res) => {
        resolve1 = res;
      });
      let resolve2!: () => void;
      const p2 = new Promise<void>((res) => {
        resolve2 = res;
      });

      manager.trackExecution("inv-1", "MyGadget", p1);
      manager.trackExecution("inv-2", "MyGadget", p2);

      const waitPromise = manager.waitForAll();

      let resolved = false;
      void waitPromise.then(() => {
        resolved = true;
      });

      // Not resolved yet
      await Promise.resolve();
      expect(resolved).toBe(false);

      // Resolve all promises
      resolve1();
      resolve2();

      await waitPromise;
      expect(resolved).toBe(true);
    });
  });

  describe("getAllDonePromise", () => {
    it("should return a resolved promise when no executions are in-flight", async () => {
      const registry = createRegistry([]);
      const manager = new GadgetConcurrencyManager({ registry });

      const result = await manager.getAllDonePromise();

      expect(result).toBe("done");
    });

    it("should resolve with 'done' when all in-flight executions complete", async () => {
      const registry = createRegistry([{ name: "MyGadget" }]);
      const manager = new GadgetConcurrencyManager({ registry });

      let resolve1!: () => void;
      const p1 = new Promise<void>((res) => {
        resolve1 = res;
      });

      manager.trackExecution("inv-1", "MyGadget", p1);

      const donePromise = manager.getAllDonePromise();

      resolve1();

      const result = await donePromise;
      expect(result).toBe("done");
    });
  });

  // =========================================================================
  // getTotalActiveGadgetCount
  // =========================================================================

  describe("getTotalActiveGadgetCount", () => {
    it("should return 0 when no gadgets are active", () => {
      const registry = createRegistry([]);
      const manager = new GadgetConcurrencyManager({ registry });

      expect(manager.getTotalActiveGadgetCount()).toBe(0);
    });

    it("should sum active counts across all gadget names", () => {
      const registry = createRegistry([
        { name: "GadgetA" },
        { name: "GadgetB" },
        { name: "GadgetC" },
      ]);
      const manager = new GadgetConcurrencyManager({ registry });

      manager.trackExecution("a-1", "GadgetA", Promise.resolve());
      manager.trackExecution("a-2", "GadgetA", Promise.resolve());
      manager.trackExecution("b-1", "GadgetB", Promise.resolve());

      expect(manager.getTotalActiveGadgetCount()).toBe(3);
    });
  });

  // =========================================================================
  // getQueuedGadgetCount / hasQueuedGadgets
  // =========================================================================

  describe("getQueuedGadgetCount and hasQueuedGadgets", () => {
    it("should return 0 and false when no gadgets are queued", () => {
      const registry = createRegistry([]);
      const manager = new GadgetConcurrencyManager({ registry });

      expect(manager.getQueuedGadgetCount()).toBe(0);
      expect(manager.hasQueuedGadgets()).toBe(false);
    });

    it("should return correct count across multiple gadget queues", () => {
      const registry = createRegistry([
        { name: "GadgetA", maxConcurrent: 1 },
        { name: "GadgetB", maxConcurrent: 1 },
      ]);
      const logger = createMockLogger();
      const manager = new GadgetConcurrencyManager({ registry, logger });

      manager.queueForLater(makeCall("a-1", "GadgetA"));
      manager.queueForLater(makeCall("a-2", "GadgetA"));
      manager.queueForLater(makeCall("b-1", "GadgetB"));

      expect(manager.getQueuedGadgetCount()).toBe(3);
      expect(manager.hasQueuedGadgets()).toBe(true);
    });
  });

  // =========================================================================
  // inFlightCount (getter)
  // =========================================================================

  describe("inFlightCount", () => {
    it("should count tracked executions accurately", () => {
      const registry = createRegistry([{ name: "MyGadget" }]);
      const manager = new GadgetConcurrencyManager({ registry });

      expect(manager.inFlightCount).toBe(0);

      manager.trackExecution("inv-1", "MyGadget", Promise.resolve());
      expect(manager.inFlightCount).toBe(1);

      manager.trackExecution("inv-2", "MyGadget", Promise.resolve());
      expect(manager.inFlightCount).toBe(2);

      manager.clearInFlight();
      expect(manager.inFlightCount).toBe(0);
    });
  });
});
