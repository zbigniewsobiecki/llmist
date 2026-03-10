import type { ILogObj, Logger } from "tslog";
import { describe, expect, it, vi } from "vitest";
import type { ExecutionTree } from "../core/execution-tree.js";
import type { ParsedGadgetCall, StreamEvent } from "../gadgets/types.js";
import { GadgetLimitGuard } from "./gadget-limit-guard.js";
import type { Observers } from "./hooks.js";

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

function makeCall(invocationId: string, gadgetName = "TestGadget"): ParsedGadgetCall {
  return {
    invocationId,
    gadgetName,
    parametersRaw: "{}",
    parameters: { key: "value" },
    dependencies: [],
  };
}

/**
 * Collect all yielded events from checkAndIncrement into an array.
 */
async function collectLimitCheckEvents(
  guard: GadgetLimitGuard,
  call: ParsedGadgetCall,
  ctx: Parameters<GadgetLimitGuard["checkAndIncrement"]>[1],
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const evt of guard.checkAndIncrement(call, ctx)) {
    events.push(evt);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GadgetLimitGuard", () => {
  // =========================================================================
  // Construction
  // =========================================================================

  describe("constructor", () => {
    it("initializes with limit 0 (unlimited)", () => {
      const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 0 });
      expect(guard.isLimitExceeded).toBe(false);
    });

    it("initializes with positive limit", () => {
      const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 3 });
      expect(guard.isLimitExceeded).toBe(false);
    });

    it("accepts optional logger", () => {
      const logger = createMockLogger();
      const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 2, logger });
      expect(guard.isLimitExceeded).toBe(false);
    });
  });

  // =========================================================================
  // isLimitExceeded
  // =========================================================================

  describe("isLimitExceeded", () => {
    it("returns false initially", () => {
      const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 1 });
      expect(guard.isLimitExceeded).toBe(false);
    });

    it("remains false after admitting gadgets within limit", async () => {
      const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 2 });
      const logger = createMockLogger();
      const ctx = { iteration: 1, logger };

      await collectLimitCheckEvents(guard, makeCall("g1"), ctx);
      expect(guard.isLimitExceeded).toBe(false);

      await collectLimitCheckEvents(guard, makeCall("g2"), ctx);
      expect(guard.isLimitExceeded).toBe(false);
    });

    it("returns true after limit is exceeded", async () => {
      const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 1 });
      const logger = createMockLogger();
      const ctx = { iteration: 1, logger };

      await collectLimitCheckEvents(guard, makeCall("g1"), ctx); // admitted
      await collectLimitCheckEvents(guard, makeCall("g2"), ctx); // exceeded

      expect(guard.isLimitExceeded).toBe(true);
    });
  });

  // =========================================================================
  // checkAndIncrement — unlimited mode
  // =========================================================================

  describe("checkAndIncrement (unlimited: maxGadgetsPerResponse = 0)", () => {
    it("yields no events when unlimited", async () => {
      const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 0 });
      const logger = createMockLogger();

      const events = await collectLimitCheckEvents(guard, makeCall("g1"), {
        iteration: 1,
        logger,
      });

      expect(events).toHaveLength(0);
      expect(guard.isLimitExceeded).toBe(false);
    });

    it("admits many gadgets without limit", async () => {
      const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 0 });
      const logger = createMockLogger();
      const ctx = { iteration: 1, logger };

      for (let i = 0; i < 10; i++) {
        const events = await collectLimitCheckEvents(guard, makeCall(`g${i}`), ctx);
        expect(events).toHaveLength(0);
      }

      expect(guard.isLimitExceeded).toBe(false);
    });
  });

  // =========================================================================
  // checkAndIncrement — limited mode
  // =========================================================================

  describe("checkAndIncrement (limited)", () => {
    it("admits gadgets within limit without emitting events", async () => {
      const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 3 });
      const logger = createMockLogger();
      const ctx = { iteration: 1, logger };

      for (let i = 0; i < 3; i++) {
        const events = await collectLimitCheckEvents(guard, makeCall(`g${i}`), ctx);
        expect(events).toHaveLength(0);
        expect(guard.isLimitExceeded).toBe(false);
      }
    });

    it("emits a gadget_skipped event when limit is exceeded", async () => {
      const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 1 });
      const logger = createMockLogger();
      const ctx = { iteration: 1, logger };

      await collectLimitCheckEvents(guard, makeCall("g1"), ctx); // admitted

      const events = await collectLimitCheckEvents(guard, makeCall("g2"), ctx); // exceeded

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "gadget_skipped",
        gadgetName: "TestGadget",
        invocationId: "g2",
        failedDependency: "maxGadgetsPerResponse",
      });
    });

    it("gadget_skipped event includes correct failedDependencyError message", async () => {
      const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 2 });
      const logger = createMockLogger();
      const ctx = { iteration: 1, logger };

      await collectLimitCheckEvents(guard, makeCall("g1"), ctx);
      await collectLimitCheckEvents(guard, makeCall("g2"), ctx);

      const events = await collectLimitCheckEvents(guard, makeCall("g3"), ctx);

      expect(events[0]).toMatchObject({
        type: "gadget_skipped",
        failedDependencyError: expect.stringContaining("2"),
      });
    });

    it("sets isLimitExceeded = true exactly when limit is reached", async () => {
      const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 2 });
      const logger = createMockLogger();
      const ctx = { iteration: 1, logger };

      await collectLimitCheckEvents(guard, makeCall("g1"), ctx);
      expect(guard.isLimitExceeded).toBe(false);

      await collectLimitCheckEvents(guard, makeCall("g2"), ctx);
      expect(guard.isLimitExceeded).toBe(false);

      await collectLimitCheckEvents(guard, makeCall("g3"), ctx); // this exceeds
      expect(guard.isLimitExceeded).toBe(true);
    });

    it("all subsequent gadgets also emit skip events after limit exceeded", async () => {
      const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 1 });
      const logger = createMockLogger();
      const ctx = { iteration: 1, logger };

      await collectLimitCheckEvents(guard, makeCall("g1"), ctx); // admitted
      const events2 = await collectLimitCheckEvents(guard, makeCall("g2"), ctx); // exceeded
      const events3 = await collectLimitCheckEvents(guard, makeCall("g3"), ctx); // still exceeded

      expect(events2).toHaveLength(1);
      expect(events3).toHaveLength(1);
      expect(events3[0]).toMatchObject({ type: "gadget_skipped", invocationId: "g3" });
    });
  });

  // =========================================================================
  // markFailed callback
  // =========================================================================

  describe("markFailed callback", () => {
    it("calls markFailed when gadget is skipped due to limit", async () => {
      const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 1 });
      const logger = createMockLogger();
      const markFailed = vi.fn();

      await collectLimitCheckEvents(guard, makeCall("g1"), { iteration: 1, logger }); // admitted - no markFailed call
      await collectLimitCheckEvents(guard, makeCall("g2"), {
        iteration: 1,
        logger,
        markFailed,
      }); // exceeded - markFailed called

      expect(markFailed).toHaveBeenCalledOnce();
      expect(markFailed).toHaveBeenCalledWith("g2");
    });

    it("does not call markFailed when gadget is admitted", async () => {
      const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 3 });
      const logger = createMockLogger();
      const markFailed = vi.fn();

      await collectLimitCheckEvents(guard, makeCall("g1"), {
        iteration: 1,
        logger,
        markFailed,
      });

      expect(markFailed).not.toHaveBeenCalled();
    });

    it("calls markFailed with the correct invocationId", async () => {
      const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 1 });
      const logger = createMockLogger();
      const markFailed = vi.fn();
      const ctx = { iteration: 1, logger, markFailed };

      await collectLimitCheckEvents(guard, makeCall("first-gadget"), ctx); // admitted
      await collectLimitCheckEvents(guard, makeCall("skipped-gadget"), ctx); // exceeded

      expect(markFailed).toHaveBeenCalledWith("skipped-gadget");
    });
  });

  // =========================================================================
  // Tree integration
  // =========================================================================

  describe("execution tree integration", () => {
    it("calls tree.skipGadget when limit is exceeded and node exists", async () => {
      const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 1 });
      const logger = createMockLogger();

      const mockNode = { id: "node-1" };
      const tree = {
        getNodeByInvocationId: vi.fn().mockReturnValue(mockNode),
        getNode: vi.fn().mockReturnValue(null), // used by getSubagentContextForNode
        skipGadget: vi.fn(),
      } as unknown as ExecutionTree;

      await collectLimitCheckEvents(guard, makeCall("g1"), { iteration: 1, logger, tree }); // admitted
      await collectLimitCheckEvents(guard, makeCall("g2"), { iteration: 1, logger, tree }); // exceeded

      expect(tree.skipGadget).toHaveBeenCalledOnce();
      expect(tree.skipGadget).toHaveBeenCalledWith(
        "node-1",
        "maxGadgetsPerResponse",
        expect.stringContaining("exceeded"),
        "limit_exceeded",
      );
    });

    it("does not call tree.skipGadget when no tree provided", async () => {
      const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 1 });
      const logger = createMockLogger();
      const ctx = { iteration: 1, logger }; // no tree

      await collectLimitCheckEvents(guard, makeCall("g1"), ctx);
      // Should not throw
      await collectLimitCheckEvents(guard, makeCall("g2"), ctx);
    });

    it("skips tree.skipGadget if node not found in tree", async () => {
      const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 1 });
      const logger = createMockLogger();

      const tree = {
        getNodeByInvocationId: vi.fn().mockReturnValue(null), // node not found
        getNode: vi.fn().mockReturnValue(null),
        skipGadget: vi.fn(),
      } as unknown as ExecutionTree;

      await collectLimitCheckEvents(guard, makeCall("g1"), { iteration: 1, logger, tree });
      await collectLimitCheckEvents(guard, makeCall("g2"), { iteration: 1, logger, tree });

      expect(tree.skipGadget).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Observer notifications
  // =========================================================================

  describe("observer notifications", () => {
    it("calls onGadgetSkipped observer when limit is exceeded", async () => {
      const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 1 });
      const logger = createMockLogger();
      const onGadgetSkipped = vi.fn().mockResolvedValue(undefined);
      const hooks: Observers = { onGadgetSkipped };

      await collectLimitCheckEvents(guard, makeCall("g1"), {
        iteration: 1,
        logger,
        hooks,
      });
      await collectLimitCheckEvents(guard, makeCall("g2"), {
        iteration: 1,
        logger,
        hooks,
      });

      expect(onGadgetSkipped).toHaveBeenCalledOnce();
      expect(onGadgetSkipped).toHaveBeenCalledWith(
        expect.objectContaining({
          gadgetName: "TestGadget",
          invocationId: "g2",
          failedDependency: "maxGadgetsPerResponse",
        }),
      );
    });

    it("does not call onGadgetSkipped when gadget is admitted", async () => {
      const guard = new GadgetLimitGuard({ maxGadgetsPerResponse: 3 });
      const logger = createMockLogger();
      const onGadgetSkipped = vi.fn();
      const hooks: Observers = { onGadgetSkipped };

      await collectLimitCheckEvents(guard, makeCall("g1"), { iteration: 1, logger, hooks });

      expect(onGadgetSkipped).not.toHaveBeenCalled();
    });
  });
});
