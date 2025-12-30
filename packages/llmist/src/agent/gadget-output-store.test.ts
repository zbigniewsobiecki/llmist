import { describe, expect, it } from "vitest";
import { GadgetOutputStore } from "./gadget-output-store.js";

describe("GadgetOutputStore", () => {
  describe("store()", () => {
    it("should store output and return an ID", () => {
      const store = new GadgetOutputStore();
      const content = "line 1\nline 2\nline 3";

      const id = store.store("Search", content);

      expect(id).toMatch(/^Search_[0-9a-f]{8}$/);
      expect(store.has(id)).toBe(true);
    });

    it("should calculate correct byte size and line count", () => {
      const store = new GadgetOutputStore();
      const content = "Hello\nWorld\n日本語"; // Contains multi-byte characters

      const id = store.store("Test", content);
      const stored = store.get(id);

      expect(stored).toBeDefined();
      expect(stored!.lineCount).toBe(3);
      // "Hello\nWorld\n日本語" = 5 + 1 + 5 + 1 + 9 (3 chars × 3 bytes) = 21 bytes
      expect(stored!.byteSize).toBe(21);
    });

    it("should store content correctly", () => {
      const store = new GadgetOutputStore();
      const content = "test content\nwith multiple\nlines";

      const id = store.store("MyGadget", content);
      const stored = store.get(id);

      expect(stored!.content).toBe(content);
      expect(stored!.gadgetName).toBe("MyGadget");
    });

    it("should generate unique IDs for multiple stores", () => {
      const store = new GadgetOutputStore();

      const id1 = store.store("Search", "content 1");
      const id2 = store.store("Search", "content 2");
      const id3 = store.store("Search", "content 3");

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });
  });

  describe("get()", () => {
    it("should return undefined for non-existent ID", () => {
      const store = new GadgetOutputStore();

      expect(store.get("nonexistent_12345678")).toBeUndefined();
    });

    it("should return stored output by ID", () => {
      const store = new GadgetOutputStore();
      const content = "test content";
      const id = store.store("Test", content);

      const stored = store.get(id);

      expect(stored).toBeDefined();
      expect(stored!.id).toBe(id);
      expect(stored!.content).toBe(content);
    });
  });

  describe("has()", () => {
    it("should return false for non-existent ID", () => {
      const store = new GadgetOutputStore();

      expect(store.has("nonexistent_12345678")).toBe(false);
    });

    it("should return true for existing ID", () => {
      const store = new GadgetOutputStore();
      const id = store.store("Test", "content");

      expect(store.has(id)).toBe(true);
    });
  });

  describe("getIds()", () => {
    it("should return empty array when store is empty", () => {
      const store = new GadgetOutputStore();

      expect(store.getIds()).toEqual([]);
    });

    it("should return all stored IDs", () => {
      const store = new GadgetOutputStore();
      const id1 = store.store("A", "content 1");
      const id2 = store.store("B", "content 2");

      const ids = store.getIds();

      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
      expect(ids.length).toBe(2);
    });
  });

  describe("size", () => {
    it("should return 0 for empty store", () => {
      const store = new GadgetOutputStore();

      expect(store.size).toBe(0);
    });

    it("should return correct count", () => {
      const store = new GadgetOutputStore();
      store.store("A", "1");
      store.store("B", "2");
      store.store("C", "3");

      expect(store.size).toBe(3);
    });
  });

  describe("clear()", () => {
    it("should remove all stored outputs", () => {
      const store = new GadgetOutputStore();
      const id1 = store.store("A", "content 1");
      const id2 = store.store("B", "content 2");

      store.clear();

      expect(store.size).toBe(0);
      expect(store.has(id1)).toBe(false);
      expect(store.has(id2)).toBe(false);
      expect(store.getIds()).toEqual([]);
    });
  });

  describe("timestamp", () => {
    it("should record timestamp when storing", () => {
      const store = new GadgetOutputStore();
      const before = new Date();

      const id = store.store("Test", "content");

      const after = new Date();
      const stored = store.get(id);

      expect(stored!.timestamp).toBeInstanceOf(Date);
      expect(stored!.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(stored!.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });
});
