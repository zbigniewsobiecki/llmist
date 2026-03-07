import { describe, expect, it } from "vitest";
import type { GadgetExecutionResult, ParsedGadgetCall } from "../gadgets/types.js";
import { GadgetDependencyResolver } from "./gadget-dependency-resolver.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCall(
  invocationId: string,
  dependencies: string[] = [],
  gadgetName = "TestGadget",
): ParsedGadgetCall {
  return {
    gadgetName,
    invocationId,
    parametersRaw: "{}",
    parameters: {},
    dependencies,
  };
}

function makeResult(
  invocationId: string,
  opts: { error?: string; gadgetName?: string } = {},
): GadgetExecutionResult {
  return {
    gadgetName: opts.gadgetName ?? "TestGadget",
    invocationId,
    parameters: {},
    result: opts.error ? undefined : "ok",
    error: opts.error,
    executionTimeMs: 1,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GadgetDependencyResolver", () => {
  // =========================================================================
  // Construction
  // =========================================================================

  describe("constructor", () => {
    it("should create with default empty options", () => {
      const resolver = new GadgetDependencyResolver();

      expect(resolver.pendingCount).toBe(0);
      expect(resolver.getCompletedInvocationIds().size).toBe(0);
      expect(resolver.getFailedInvocationIds().size).toBe(0);
    });

    it("should accept prior completed invocations", () => {
      const resolver = new GadgetDependencyResolver({
        priorCompletedInvocations: new Set(["prev_1", "prev_2"]),
      });

      expect(resolver.isCompleted("prev_1")).toBe(true);
      expect(resolver.isCompleted("prev_2")).toBe(true);
      expect(resolver.isCompleted("unknown")).toBe(false);
    });

    it("should accept prior failed invocations", () => {
      const resolver = new GadgetDependencyResolver({
        priorFailedInvocations: new Set(["fail_1"]),
      });

      expect(resolver.isFailed("fail_1")).toBe(true);
      expect(resolver.isFailed("unknown")).toBe(false);
    });
  });

  // =========================================================================
  // State mutation: addPending / removePending / clearPending
  // =========================================================================

  describe("addPending", () => {
    it("should add a call to the pending queue", () => {
      const resolver = new GadgetDependencyResolver();
      const call = makeCall("g1", ["dep1"]);

      resolver.addPending(call);

      expect(resolver.pendingCount).toBe(1);
      expect(resolver.getPendingEntries()).toEqual([["g1", call]]);
    });

    it("should overwrite if the same invocation ID is added again", () => {
      const resolver = new GadgetDependencyResolver();
      const call1 = makeCall("g1", ["dep1"]);
      const call2 = makeCall("g1", ["dep2"]);

      resolver.addPending(call1);
      resolver.addPending(call2);

      expect(resolver.pendingCount).toBe(1);
      const [[, stored]] = resolver.getPendingEntries();
      expect(stored.dependencies).toEqual(["dep2"]);
    });
  });

  describe("removePending", () => {
    it("should remove a specific invocation from pending", () => {
      const resolver = new GadgetDependencyResolver();
      resolver.addPending(makeCall("g1", ["dep1"]));
      resolver.addPending(makeCall("g2", ["dep1"]));

      resolver.removePending("g1");

      expect(resolver.pendingCount).toBe(1);
      expect(resolver.getPendingEntries()[0][0]).toBe("g2");
    });

    it("should be a no-op for non-existent invocation", () => {
      const resolver = new GadgetDependencyResolver();
      resolver.addPending(makeCall("g1", ["dep1"]));

      resolver.removePending("nonexistent");

      expect(resolver.pendingCount).toBe(1);
    });
  });

  describe("clearPending", () => {
    it("should remove all pending gadgets", () => {
      const resolver = new GadgetDependencyResolver();
      resolver.addPending(makeCall("g1", ["dep1"]));
      resolver.addPending(makeCall("g2", ["dep1"]));
      resolver.addPending(makeCall("g3", ["dep1"]));

      resolver.clearPending();

      expect(resolver.pendingCount).toBe(0);
      expect(resolver.getPendingEntries()).toEqual([]);
    });
  });

  // =========================================================================
  // State mutation: markComplete / markFailed
  // =========================================================================

  describe("markComplete", () => {
    it("should track a successful result", () => {
      const resolver = new GadgetDependencyResolver();
      const result = makeResult("g1");

      resolver.markComplete(result);

      expect(resolver.isCompleted("g1")).toBe(true);
      expect(resolver.isFailed("g1")).toBe(false);
      expect(resolver.getCompletedResult("g1")).toBe(result);
    });

    it("should also mark as failed when result contains an error", () => {
      const resolver = new GadgetDependencyResolver();
      const result = makeResult("g1", { error: "something went wrong" });

      resolver.markComplete(result);

      expect(resolver.isCompleted("g1")).toBe(true);
      expect(resolver.isFailed("g1")).toBe(true);
      expect(resolver.getCompletedResult("g1")).toBe(result);
    });
  });

  describe("markFailed", () => {
    it("should mark an invocation as failed without a result", () => {
      const resolver = new GadgetDependencyResolver();

      resolver.markFailed("g1");

      expect(resolver.isFailed("g1")).toBe(true);
      expect(resolver.isCompleted("g1")).toBe(false);
      expect(resolver.getCompletedResult("g1")).toBeUndefined();
    });
  });

  // =========================================================================
  // Queries: isCompleted / isFailed (mixed prior + current state)
  // =========================================================================

  describe("isCompleted (mixed prior/current state)", () => {
    it("should return true for current-iteration completion", () => {
      const resolver = new GadgetDependencyResolver();
      resolver.markComplete(makeResult("g1"));

      expect(resolver.isCompleted("g1")).toBe(true);
    });

    it("should return true for prior-iteration completion", () => {
      const resolver = new GadgetDependencyResolver({
        priorCompletedInvocations: new Set(["prior_g"]),
      });

      expect(resolver.isCompleted("prior_g")).toBe(true);
    });

    it("should return true when completed in both prior and current", () => {
      const resolver = new GadgetDependencyResolver({
        priorCompletedInvocations: new Set(["g1"]),
      });
      resolver.markComplete(makeResult("g1"));

      expect(resolver.isCompleted("g1")).toBe(true);
    });

    it("should return false for unknown invocations", () => {
      const resolver = new GadgetDependencyResolver({
        priorCompletedInvocations: new Set(["other"]),
      });

      expect(resolver.isCompleted("unknown")).toBe(false);
    });
  });

  describe("isFailed (mixed prior/current state)", () => {
    it("should return true for current-iteration failure", () => {
      const resolver = new GadgetDependencyResolver();
      resolver.markFailed("g1");

      expect(resolver.isFailed("g1")).toBe(true);
    });

    it("should return true for prior-iteration failure", () => {
      const resolver = new GadgetDependencyResolver({
        priorFailedInvocations: new Set(["prior_fail"]),
      });

      expect(resolver.isFailed("prior_fail")).toBe(true);
    });

    it("should return false for unknown invocations", () => {
      const resolver = new GadgetDependencyResolver({
        priorFailedInvocations: new Set(["other"]),
      });

      expect(resolver.isFailed("unknown")).toBe(false);
    });
  });

  // =========================================================================
  // Queries: isAllSatisfied / getFailedDependency
  // =========================================================================

  describe("isAllSatisfied", () => {
    it("should return true for a call with no dependencies", () => {
      const resolver = new GadgetDependencyResolver();
      const call = makeCall("g1", []);

      expect(resolver.isAllSatisfied(call)).toBe(true);
    });

    it("should return true when all dependencies completed in current iteration", () => {
      const resolver = new GadgetDependencyResolver();
      resolver.markComplete(makeResult("dep1"));
      resolver.markComplete(makeResult("dep2"));

      const call = makeCall("g1", ["dep1", "dep2"]);
      expect(resolver.isAllSatisfied(call)).toBe(true);
    });

    it("should return true when all dependencies completed in prior iterations", () => {
      const resolver = new GadgetDependencyResolver({
        priorCompletedInvocations: new Set(["dep1", "dep2"]),
      });

      const call = makeCall("g1", ["dep1", "dep2"]);
      expect(resolver.isAllSatisfied(call)).toBe(true);
    });

    it("should return true with a mix of current and prior completions", () => {
      const resolver = new GadgetDependencyResolver({
        priorCompletedInvocations: new Set(["dep1"]),
      });
      resolver.markComplete(makeResult("dep2"));

      const call = makeCall("g1", ["dep1", "dep2"]);
      expect(resolver.isAllSatisfied(call)).toBe(true);
    });

    it("should return false when some dependencies are not yet completed", () => {
      const resolver = new GadgetDependencyResolver();
      resolver.markComplete(makeResult("dep1"));

      const call = makeCall("g1", ["dep1", "dep2"]);
      expect(resolver.isAllSatisfied(call)).toBe(false);
    });
  });

  describe("getFailedDependency", () => {
    it("should return undefined when no dependencies have failed", () => {
      const resolver = new GadgetDependencyResolver();
      const call = makeCall("g1", ["dep1", "dep2"]);

      expect(resolver.getFailedDependency(call)).toBeUndefined();
    });

    it("should return undefined for a call with no dependencies", () => {
      const resolver = new GadgetDependencyResolver();
      const call = makeCall("g1", []);

      expect(resolver.getFailedDependency(call)).toBeUndefined();
    });

    it("should return the first failed dependency from current iteration", () => {
      const resolver = new GadgetDependencyResolver();
      resolver.markFailed("dep2");

      const call = makeCall("g1", ["dep1", "dep2", "dep3"]);
      expect(resolver.getFailedDependency(call)).toBe("dep2");
    });

    it("should detect failed dependency from prior iterations", () => {
      const resolver = new GadgetDependencyResolver({
        priorFailedInvocations: new Set(["dep1"]),
      });

      const call = makeCall("g1", ["dep1", "dep2"]);
      expect(resolver.getFailedDependency(call)).toBe("dep1");
    });

    it("should return the first failed dep when multiple have failed", () => {
      const resolver = new GadgetDependencyResolver();
      resolver.markFailed("dep1");
      resolver.markFailed("dep3");

      const call = makeCall("g1", ["dep1", "dep2", "dep3"]);
      expect(resolver.getFailedDependency(call)).toBe("dep1");
    });
  });

  // =========================================================================
  // getReadyCalls partitioning
  // =========================================================================

  describe("getReadyCalls", () => {
    it("should return empty arrays when nothing is pending", () => {
      const resolver = new GadgetDependencyResolver();

      const { readyToExecute, readyToSkip } = resolver.getReadyCalls();

      expect(readyToExecute).toEqual([]);
      expect(readyToSkip).toEqual([]);
    });

    it("should partition ready-to-execute when all deps are satisfied", () => {
      const resolver = new GadgetDependencyResolver();
      resolver.markComplete(makeResult("dep1"));
      const call = makeCall("g1", ["dep1"]);
      resolver.addPending(call);

      const { readyToExecute, readyToSkip } = resolver.getReadyCalls();

      expect(readyToExecute).toEqual([call]);
      expect(readyToSkip).toEqual([]);
    });

    it("should partition ready-to-skip when a dep has failed", () => {
      const resolver = new GadgetDependencyResolver();
      resolver.markFailed("dep1");
      const call = makeCall("g1", ["dep1"]);
      resolver.addPending(call);

      const { readyToExecute, readyToSkip } = resolver.getReadyCalls();

      expect(readyToExecute).toEqual([]);
      expect(readyToSkip).toEqual([{ call, failedDep: "dep1" }]);
    });

    it("should leave gadgets with unsatisfied (non-failed) deps in pending", () => {
      const resolver = new GadgetDependencyResolver();
      const call = makeCall("g1", ["dep1"]);
      resolver.addPending(call);

      const { readyToExecute, readyToSkip } = resolver.getReadyCalls();

      expect(readyToExecute).toEqual([]);
      expect(readyToSkip).toEqual([]);
      // Still pending
      expect(resolver.pendingCount).toBe(1);
    });

    it("should correctly partition a mix of ready, skippable, and waiting", () => {
      const resolver = new GadgetDependencyResolver();

      // dep1 completed, dep2 failed, dep3 still in-flight
      resolver.markComplete(makeResult("dep1"));
      resolver.markFailed("dep2");

      const readyCall = makeCall("g_ready", ["dep1"]);
      const skipCall = makeCall("g_skip", ["dep2"]);
      const waitCall = makeCall("g_wait", ["dep3"]);

      resolver.addPending(readyCall);
      resolver.addPending(skipCall);
      resolver.addPending(waitCall);

      const { readyToExecute, readyToSkip } = resolver.getReadyCalls();

      expect(readyToExecute).toEqual([readyCall]);
      expect(readyToSkip).toEqual([{ call: skipCall, failedDep: "dep2" }]);
      // g_wait should still be pending (not returned in either array)
      expect(resolver.pendingCount).toBe(3); // getReadyCalls does NOT remove from pending
    });

    it("should not remove gadgets from pending (caller is responsible)", () => {
      const resolver = new GadgetDependencyResolver();
      resolver.markComplete(makeResult("dep1"));
      resolver.addPending(makeCall("g1", ["dep1"]));

      resolver.getReadyCalls();

      // getReadyCalls is a pure query — pending count unchanged
      expect(resolver.pendingCount).toBe(1);
    });

    it("should use prior state to determine readiness", () => {
      const resolver = new GadgetDependencyResolver({
        priorCompletedInvocations: new Set(["prior_dep"]),
        priorFailedInvocations: new Set(["prior_fail"]),
      });

      const readyCall = makeCall("g1", ["prior_dep"]);
      const skipCall = makeCall("g2", ["prior_fail"]);
      resolver.addPending(readyCall);
      resolver.addPending(skipCall);

      const { readyToExecute, readyToSkip } = resolver.getReadyCalls();

      expect(readyToExecute).toEqual([readyCall]);
      expect(readyToSkip).toEqual([{ call: skipCall, failedDep: "prior_fail" }]);
    });

    it("should prioritize skip over execute when a dep is both completed and failed", () => {
      // A result with an error is both completed AND failed
      const resolver = new GadgetDependencyResolver();
      resolver.markComplete(makeResult("dep1", { error: "boom" }));

      const call = makeCall("g1", ["dep1"]);
      resolver.addPending(call);

      const { readyToExecute, readyToSkip } = resolver.getReadyCalls();

      // Since getReadyCalls checks failed deps FIRST, this should be in readyToSkip
      expect(readyToSkip).toEqual([{ call, failedDep: "dep1" }]);
      expect(readyToExecute).toEqual([]);
    });
  });

  // =========================================================================
  // Circular dependency scenarios
  // =========================================================================

  describe("circular dependencies", () => {
    it("should leave mutually-dependent gadgets as permanently pending", () => {
      const resolver = new GadgetDependencyResolver();

      // g1 depends on g2, g2 depends on g1 — circular
      const g1 = makeCall("g1", ["g2"]);
      const g2 = makeCall("g2", ["g1"]);
      resolver.addPending(g1);
      resolver.addPending(g2);

      const { readyToExecute, readyToSkip } = resolver.getReadyCalls();

      // Neither can resolve — both remain pending
      expect(readyToExecute).toEqual([]);
      expect(readyToSkip).toEqual([]);
      expect(resolver.pendingCount).toBe(2);
    });

    it("should leave a 3-node cycle as permanently pending", () => {
      const resolver = new GadgetDependencyResolver();

      // g1 -> g2 -> g3 -> g1 (cycle)
      const g1 = makeCall("g1", ["g3"]);
      const g2 = makeCall("g2", ["g1"]);
      const g3 = makeCall("g3", ["g2"]);
      resolver.addPending(g1);
      resolver.addPending(g2);
      resolver.addPending(g3);

      const { readyToExecute, readyToSkip } = resolver.getReadyCalls();

      expect(readyToExecute).toEqual([]);
      expect(readyToSkip).toEqual([]);
      expect(resolver.pendingCount).toBe(3);
    });

    it("should resolve non-circular nodes even when a cycle exists", () => {
      const resolver = new GadgetDependencyResolver();

      // g1 -> g2 -> g1 (cycle), but g3 depends on dep1 which completed
      const g1 = makeCall("g1", ["g2"]);
      const g2 = makeCall("g2", ["g1"]);
      const g3 = makeCall("g3", ["dep1"]);
      resolver.addPending(g1);
      resolver.addPending(g2);
      resolver.addPending(g3);
      resolver.markComplete(makeResult("dep1"));

      const { readyToExecute, readyToSkip } = resolver.getReadyCalls();

      expect(readyToExecute).toEqual([g3]);
      expect(readyToSkip).toEqual([]);
      expect(resolver.pendingCount).toBe(3); // all still in pending (query only)
    });
  });

  // =========================================================================
  // Cross-iteration accessors
  // =========================================================================

  describe("getCompletedInvocationIds", () => {
    it("should return empty set when nothing completed", () => {
      const resolver = new GadgetDependencyResolver();

      expect(resolver.getCompletedInvocationIds().size).toBe(0);
    });

    it("should return only current-iteration completed IDs (not prior)", () => {
      const resolver = new GadgetDependencyResolver({
        priorCompletedInvocations: new Set(["prior_g"]),
      });
      resolver.markComplete(makeResult("current_g"));

      const ids = resolver.getCompletedInvocationIds();

      expect(ids).toEqual(new Set(["current_g"]));
      expect(ids.has("prior_g")).toBe(false);
    });

    it("should return a defensive copy", () => {
      const resolver = new GadgetDependencyResolver();
      resolver.markComplete(makeResult("g1"));

      const ids1 = resolver.getCompletedInvocationIds();
      const ids2 = resolver.getCompletedInvocationIds();

      expect(ids1).toEqual(ids2);
      expect(ids1).not.toBe(ids2); // Different Set instances
    });
  });

  describe("getFailedInvocationIds", () => {
    it("should return empty set when nothing failed", () => {
      const resolver = new GadgetDependencyResolver();

      expect(resolver.getFailedInvocationIds().size).toBe(0);
    });

    it("should return only current-iteration failed IDs (not prior)", () => {
      const resolver = new GadgetDependencyResolver({
        priorFailedInvocations: new Set(["prior_fail"]),
      });
      resolver.markFailed("current_fail");

      const ids = resolver.getFailedInvocationIds();

      expect(ids).toEqual(new Set(["current_fail"]));
      expect(ids.has("prior_fail")).toBe(false);
    });

    it("should include IDs failed via markComplete with error", () => {
      const resolver = new GadgetDependencyResolver();
      resolver.markComplete(makeResult("g1", { error: "boom" }));

      const ids = resolver.getFailedInvocationIds();

      expect(ids.has("g1")).toBe(true);
    });

    it("should return a defensive copy", () => {
      const resolver = new GadgetDependencyResolver();
      resolver.markFailed("g1");

      const ids1 = resolver.getFailedInvocationIds();
      const ids2 = resolver.getFailedInvocationIds();

      expect(ids1).toEqual(ids2);
      expect(ids1).not.toBe(ids2);
    });
  });

  // =========================================================================
  // getCompletedResult
  // =========================================================================

  describe("getCompletedResult", () => {
    it("should return the result for a completed invocation", () => {
      const resolver = new GadgetDependencyResolver();
      const result = makeResult("g1");
      resolver.markComplete(result);

      expect(resolver.getCompletedResult("g1")).toBe(result);
    });

    it("should return undefined for a prior-iteration completion", () => {
      const resolver = new GadgetDependencyResolver({
        priorCompletedInvocations: new Set(["prior_g"]),
      });

      // Prior completions are tracked by ID only, no result object
      expect(resolver.getCompletedResult("prior_g")).toBeUndefined();
    });

    it("should return undefined for unknown invocations", () => {
      const resolver = new GadgetDependencyResolver();

      expect(resolver.getCompletedResult("unknown")).toBeUndefined();
    });
  });

  // =========================================================================
  // Multi-dependency chains (DAG progression)
  // =========================================================================

  describe("DAG progression", () => {
    it("should progressively unlock a dependency chain as deps complete", () => {
      const resolver = new GadgetDependencyResolver();

      // Chain: g1 (no deps) -> g2 (depends on g1) -> g3 (depends on g2)
      const g2 = makeCall("g2", ["g1"]);
      const g3 = makeCall("g3", ["g2"]);
      resolver.addPending(g2);
      resolver.addPending(g3);

      // Initially neither is ready
      let ready = resolver.getReadyCalls();
      expect(ready.readyToExecute).toEqual([]);

      // g1 completes → g2 becomes ready
      resolver.markComplete(makeResult("g1"));
      ready = resolver.getReadyCalls();
      expect(ready.readyToExecute).toEqual([g2]);

      // Execute g2: remove from pending, mark complete
      resolver.removePending("g2");
      resolver.markComplete(makeResult("g2"));

      // g2 complete → g3 becomes ready
      ready = resolver.getReadyCalls();
      expect(ready.readyToExecute).toEqual([g3]);
    });

    it("should propagate failure down a dependency chain", () => {
      const resolver = new GadgetDependencyResolver();

      // g2 depends on g1, g3 depends on g2
      const g2 = makeCall("g2", ["g1"]);
      const g3 = makeCall("g3", ["g2"]);
      resolver.addPending(g2);
      resolver.addPending(g3);

      // g1 fails
      resolver.markFailed("g1");

      let ready = resolver.getReadyCalls();
      expect(ready.readyToSkip).toEqual([{ call: g2, failedDep: "g1" }]);
      // g3 is not skippable yet (g2 hasn't been marked failed yet)
      expect(ready.readyToSkip.find((s) => s.call.invocationId === "g3")).toBeUndefined();

      // Now mark g2 as failed (as StreamProcessor would after handling the skip)
      resolver.removePending("g2");
      resolver.markFailed("g2");

      ready = resolver.getReadyCalls();
      expect(ready.readyToSkip).toEqual([{ call: g3, failedDep: "g2" }]);
    });

    it("should handle fan-out (multiple gadgets depending on the same dep)", () => {
      const resolver = new GadgetDependencyResolver();

      const g2a = makeCall("g2a", ["g1"]);
      const g2b = makeCall("g2b", ["g1"]);
      const g2c = makeCall("g2c", ["g1"]);
      resolver.addPending(g2a);
      resolver.addPending(g2b);
      resolver.addPending(g2c);

      // g1 completes → all three become ready
      resolver.markComplete(makeResult("g1"));
      const { readyToExecute } = resolver.getReadyCalls();

      expect(readyToExecute).toHaveLength(3);
      expect(readyToExecute).toContain(g2a);
      expect(readyToExecute).toContain(g2b);
      expect(readyToExecute).toContain(g2c);
    });

    it("should handle fan-in (gadget depending on multiple deps)", () => {
      const resolver = new GadgetDependencyResolver();

      const g3 = makeCall("g3", ["g1", "g2"]);
      resolver.addPending(g3);

      // Only g1 complete → not ready yet
      resolver.markComplete(makeResult("g1"));
      let { readyToExecute } = resolver.getReadyCalls();
      expect(readyToExecute).toEqual([]);

      // Now g2 also completes → g3 ready
      resolver.markComplete(makeResult("g2"));
      ({ readyToExecute } = resolver.getReadyCalls());
      expect(readyToExecute).toEqual([g3]);
    });
  });
});
