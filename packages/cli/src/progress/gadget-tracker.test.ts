import { describe, expect, test } from "vitest";
import { GadgetTracker } from "./gadget-tracker.js";

describe("GadgetTracker", () => {
  describe("addGadget", () => {
    test("adds a gadget with name and params", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb", { url: "https://example.com" });

      const map = tracker.getMap();
      expect(map.size).toBe(1);

      const gadget = map.get("inv-1");
      expect(gadget).toBeDefined();
      expect(gadget?.name).toBe("BrowseWeb");
      expect(gadget?.params).toEqual({ url: "https://example.com" });
      expect(gadget?.startTime).toBeLessThanOrEqual(Date.now());
      expect(gadget?.completed).toBeUndefined();
    });

    test("adds a gadget without params", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-2", "ReadFile");

      const gadget = tracker.getMap().get("inv-2");
      expect(gadget?.name).toBe("ReadFile");
      expect(gadget?.params).toBeUndefined();
    });

    test("records startTime close to now", () => {
      const before = Date.now();
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "Test");
      const after = Date.now();

      const gadget = tracker.getMap().get("inv-1");
      expect(gadget?.startTime).toBeGreaterThanOrEqual(before);
      expect(gadget?.startTime).toBeLessThanOrEqual(after);
    });

    test("adds multiple gadgets with different invocation IDs", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb");
      tracker.addGadget("inv-2", "ReadFile");
      tracker.addGadget("inv-3", "WriteFile");

      expect(tracker.getMap().size).toBe(3);
    });

    test("overwrites existing gadget with same invocation ID", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "OldName");
      tracker.addGadget("inv-1", "NewName");

      const gadget = tracker.getMap().get("inv-1");
      expect(gadget?.name).toBe("NewName");
      expect(tracker.getMap().size).toBe(1);
    });
  });

  describe("removeGadget", () => {
    test("removes an existing gadget", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb");
      tracker.removeGadget("inv-1");

      expect(tracker.getMap().size).toBe(0);
    });

    test("does nothing when gadget does not exist", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb");

      // Should not throw
      expect(() => tracker.removeGadget("non-existent")).not.toThrow();
      expect(tracker.getMap().size).toBe(1);
    });

    test("removes only the specified gadget", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb");
      tracker.addGadget("inv-2", "ReadFile");
      tracker.removeGadget("inv-1");

      expect(tracker.getMap().size).toBe(1);
      expect(tracker.getMap().has("inv-2")).toBe(true);
    });
  });

  describe("hasInFlightGadgets", () => {
    test("returns false when no gadgets exist", () => {
      const tracker = new GadgetTracker();
      expect(tracker.hasInFlightGadgets()).toBe(false);
    });

    test("returns true when gadgets are in flight", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb");
      expect(tracker.hasInFlightGadgets()).toBe(true);
    });

    test("returns false after all gadgets are removed", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb");
      tracker.removeGadget("inv-1");
      expect(tracker.hasInFlightGadgets()).toBe(false);
    });

    test("returns true even after some gadgets are removed", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb");
      tracker.addGadget("inv-2", "ReadFile");
      tracker.removeGadget("inv-1");
      expect(tracker.hasInFlightGadgets()).toBe(true);
    });
  });

  describe("getGadget", () => {
    test("returns the gadget for a known ID", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb", { url: "https://test.com" });

      const gadget = tracker.getGadget("inv-1");
      expect(gadget).toBeDefined();
      expect(gadget?.name).toBe("BrowseWeb");
    });

    test("returns undefined for unknown ID", () => {
      const tracker = new GadgetTracker();
      expect(tracker.getGadget("non-existent")).toBeUndefined();
    });

    test("returns undefined after gadget is removed", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb");
      tracker.removeGadget("inv-1");
      expect(tracker.getGadget("inv-1")).toBeUndefined();
    });
  });

  describe("completeGadget", () => {
    test("marks gadget as completed and records completedTime", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb");

      const before = Date.now();
      const result = tracker.completeGadget("inv-1");
      const after = Date.now();

      expect(result).toBe(true);

      const gadget = tracker.getMap().get("inv-1");
      expect(gadget?.completed).toBe(true);
      expect(gadget?.completedTime).toBeGreaterThanOrEqual(before);
      expect(gadget?.completedTime).toBeLessThanOrEqual(after);
    });

    test("keeps the gadget in the map after completion", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb");
      tracker.completeGadget("inv-1");

      expect(tracker.getMap().size).toBe(1);
      expect(tracker.getMap().has("inv-1")).toBe(true);
    });

    test("returns false for non-existent gadget", () => {
      const tracker = new GadgetTracker();
      const result = tracker.completeGadget("non-existent");
      expect(result).toBe(false);
    });

    test("does not throw when completing non-existent gadget", () => {
      const tracker = new GadgetTracker();
      expect(() => tracker.completeGadget("non-existent")).not.toThrow();
    });

    test("freezes elapsed time - completedTime >= startTime", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb");

      const gadgetBefore = tracker.getMap().get("inv-1");
      const startTime = gadgetBefore?.startTime ?? 0;

      tracker.completeGadget("inv-1");

      const gadgetAfter = tracker.getMap().get("inv-1");
      expect(gadgetAfter?.completedTime).toBeGreaterThanOrEqual(startTime);
    });
  });

  describe("clearCompletedGadgets", () => {
    test("removes completed gadgets from the map", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb");
      tracker.completeGadget("inv-1");
      tracker.clearCompletedGadgets();

      expect(tracker.getMap().size).toBe(0);
    });

    test("returns IDs of cleared gadgets", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb");
      tracker.addGadget("inv-2", "ReadFile");
      tracker.completeGadget("inv-1");
      tracker.completeGadget("inv-2");

      const cleared = tracker.clearCompletedGadgets();
      expect(cleared).toHaveLength(2);
      expect(cleared).toContain("inv-1");
      expect(cleared).toContain("inv-2");
    });

    test("keeps incomplete gadgets in the map", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb");
      tracker.addGadget("inv-2", "ReadFile");
      tracker.completeGadget("inv-1");
      tracker.clearCompletedGadgets();

      expect(tracker.getMap().size).toBe(1);
      expect(tracker.getMap().has("inv-2")).toBe(true);
    });

    test("returns empty array when no completed gadgets", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb");

      const cleared = tracker.clearCompletedGadgets();
      expect(cleared).toHaveLength(0);
    });

    test("returns empty array when tracker is empty", () => {
      const tracker = new GadgetTracker();
      const cleared = tracker.clearCompletedGadgets();
      expect(cleared).toHaveLength(0);
    });

    test("clears multiple completed gadgets, preserving incomplete ones", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb");
      tracker.addGadget("inv-2", "ReadFile");
      tracker.addGadget("inv-3", "WriteFile");

      tracker.completeGadget("inv-1");
      tracker.completeGadget("inv-3");

      const cleared = tracker.clearCompletedGadgets();
      expect(cleared).toHaveLength(2);
      expect(cleared).toContain("inv-1");
      expect(cleared).toContain("inv-3");

      expect(tracker.getMap().size).toBe(1);
      expect(tracker.getMap().has("inv-2")).toBe(true);
    });
  });

  describe("entries", () => {
    test("iterates over all gadgets", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb");
      tracker.addGadget("inv-2", "ReadFile");

      const ids: string[] = [];
      for (const [id] of tracker.entries()) {
        ids.push(id);
      }

      expect(ids).toHaveLength(2);
      expect(ids).toContain("inv-1");
      expect(ids).toContain("inv-2");
    });

    test("returns empty iterator when tracker is empty", () => {
      const tracker = new GadgetTracker();

      const entries: unknown[] = [];
      for (const entry of tracker.entries()) {
        entries.push(entry);
      }

      expect(entries).toHaveLength(0);
    });
  });

  describe("getMap", () => {
    test("returns the underlying Map", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb");

      const map = tracker.getMap();
      expect(map).toBeInstanceOf(Map);
      expect(map.size).toBe(1);
    });

    test("returns a reference to the live Map (mutations affect tracker state)", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb");

      const map = tracker.getMap();
      map.delete("inv-1");

      // The tracker now also reflects the deletion
      expect(tracker.hasInFlightGadgets()).toBe(false);
    });
  });

  describe("empty state", () => {
    test("starts with no gadgets", () => {
      const tracker = new GadgetTracker();
      expect(tracker.getMap().size).toBe(0);
      expect(tracker.hasInFlightGadgets()).toBe(false);
    });

    test("can be used after clearing all gadgets", () => {
      const tracker = new GadgetTracker();
      tracker.addGadget("inv-1", "BrowseWeb");
      tracker.completeGadget("inv-1");
      tracker.clearCompletedGadgets();

      // Should still work after clearing
      tracker.addGadget("inv-2", "NewGadget");
      expect(tracker.hasInFlightGadgets()).toBe(true);
      expect(tracker.getGadget("inv-2")?.name).toBe("NewGadget");
    });
  });
});
