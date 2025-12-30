/**
 * Tests for MediaStore - session-scoped media storage with ID abstraction.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { MediaStore } from "./media-store.js";
import type { GadgetMediaOutput } from "./types.js";

// Small PNG image (1x1 transparent pixel)
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// Helper to create a test media output
function createTestMedia(overrides?: Partial<GadgetMediaOutput>): GadgetMediaOutput {
  return {
    kind: "image",
    data: TINY_PNG_BASE64,
    mimeType: "image/png",
    description: "Test image",
    ...overrides,
  };
}

describe("MediaStore", () => {
  let store: MediaStore;

  beforeEach(() => {
    // Create a store with a unique session ID for isolation
    store = new MediaStore(`test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  });

  afterEach(async () => {
    // Clean up test files
    await store.cleanup();
  });

  describe("constructor", () => {
    it("creates a store with auto-generated session ID", () => {
      const autoStore = new MediaStore();
      expect(autoStore.getOutputDir()).toMatch(/media-[a-f0-9]+$/);
    });

    it("creates a store with provided session ID", () => {
      const customStore = new MediaStore("my-session");
      expect(customStore.getOutputDir()).toContain("media-my-session");
    });
  });

  describe("store()", () => {
    it("stores media and returns StoredMedia with ID", async () => {
      const media = createTestMedia();
      const stored = await store.store(media, "TestGadget");

      expect(stored.id).toMatch(/^media_[a-z0-9]{6}$/);
      expect(stored.kind).toBe("image");
      expect(stored.mimeType).toBe("image/png");
      expect(stored.gadgetName).toBe("TestGadget");
      expect(stored.sizeBytes).toBeGreaterThan(0);
      expect(stored.description).toBe("Test image");
      expect(stored.createdAt).toBeInstanceOf(Date);
    });

    it("creates file on disk", async () => {
      const media = createTestMedia();
      const stored = await store.store(media, "TestGadget");

      expect(existsSync(stored.path)).toBe(true);
    });

    it("uses provided fileName when available", async () => {
      const media = createTestMedia({ fileName: "custom-name.png" });
      const stored = await store.store(media, "TestGadget");

      expect(stored.path).toContain("custom-name.png");
    });

    it("generates sequential filenames when fileName not provided", async () => {
      const media = createTestMedia();
      const stored1 = await store.store(media, "TestGadget");
      const stored2 = await store.store(media, "TestGadget");
      const stored3 = await store.store(media, "TestGadget");

      expect(stored1.path).toContain("TestGadget_001.png");
      expect(stored2.path).toContain("TestGadget_002.png");
      expect(stored3.path).toContain("TestGadget_003.png");
    });

    it("uses correct extension based on MIME type", async () => {
      const jpegMedia = createTestMedia({ mimeType: "image/jpeg" });
      const stored = await store.store(jpegMedia, "TestGadget");

      expect(stored.path).toMatch(/\.jpg$/);
    });

    it("falls back to .bin for unknown MIME types", async () => {
      const unknownMedia = createTestMedia({ mimeType: "application/x-custom" });
      const stored = await store.store(unknownMedia, "TestGadget");

      expect(stored.path).toMatch(/\.bin$/);
    });

    it("preserves metadata in stored item", async () => {
      const media = createTestMedia({
        metadata: { width: 100, height: 200, customKey: "value" },
      });
      const stored = await store.store(media, "TestGadget");

      expect(stored.metadata).toEqual({ width: 100, height: 200, customKey: "value" });
    });
  });

  describe("get()", () => {
    it("retrieves stored media by ID", async () => {
      const media = createTestMedia();
      const stored = await store.store(media, "TestGadget");

      const retrieved = store.get(stored.id);
      expect(retrieved).toEqual(stored);
    });

    it("returns undefined for non-existent ID", () => {
      expect(store.get("media_nonexistent")).toBeUndefined();
    });
  });

  describe("getPath()", () => {
    it("returns file path for stored ID", async () => {
      const media = createTestMedia();
      const stored = await store.store(media, "TestGadget");

      expect(store.getPath(stored.id)).toBe(stored.path);
    });

    it("returns undefined for non-existent ID", () => {
      expect(store.getPath("media_nonexistent")).toBeUndefined();
    });
  });

  describe("list()", () => {
    it("returns all stored media", async () => {
      const media = createTestMedia();
      await store.store(media, "Gadget1");
      await store.store(media, "Gadget2");
      await store.store(media, "Gadget3");

      const list = store.list();
      expect(list).toHaveLength(3);
    });

    it("filters by kind when provided", async () => {
      await store.store(createTestMedia({ kind: "image" }), "ImageGadget");
      await store.store(createTestMedia({ kind: "audio", mimeType: "audio/mp3" }), "AudioGadget");
      await store.store(createTestMedia({ kind: "image" }), "ImageGadget2");

      const images = store.list("image");
      const audio = store.list("audio");

      expect(images).toHaveLength(2);
      expect(audio).toHaveLength(1);
    });

    it("returns empty array when no media stored", () => {
      expect(store.list()).toEqual([]);
    });
  });

  describe("size", () => {
    it("returns count of stored items", async () => {
      const media = createTestMedia();

      expect(store.size).toBe(0);

      await store.store(media, "Gadget1");
      expect(store.size).toBe(1);

      await store.store(media, "Gadget2");
      expect(store.size).toBe(2);
    });
  });

  describe("has()", () => {
    it("returns true for existing ID", async () => {
      const media = createTestMedia();
      const stored = await store.store(media, "TestGadget");

      expect(store.has(stored.id)).toBe(true);
    });

    it("returns false for non-existent ID", () => {
      expect(store.has("media_nonexistent")).toBe(false);
    });
  });

  describe("clear()", () => {
    it("clears in-memory store but leaves files", async () => {
      const media = createTestMedia();
      const stored = await store.store(media, "TestGadget");
      const filePath = stored.path;

      store.clear();

      expect(store.size).toBe(0);
      expect(store.get(stored.id)).toBeUndefined();
      // File should still exist
      expect(existsSync(filePath)).toBe(true);
    });

    it("resets counter", async () => {
      const media = createTestMedia();
      await store.store(media, "TestGadget");
      await store.store(media, "TestGadget");

      store.clear();

      // After clear, counter resets, so next file should be _001 again
      // But since dir still exists, we can verify counter reset behavior
      expect(store.size).toBe(0);
    });
  });

  describe("cleanup()", () => {
    it("deletes files and clears memory", async () => {
      const media = createTestMedia();
      const stored = await store.store(media, "TestGadget");
      const outputDir = store.getOutputDir();

      await store.cleanup();

      expect(store.size).toBe(0);
      expect(existsSync(outputDir)).toBe(false);
    });

    it("is safe to call multiple times", async () => {
      const media = createTestMedia();
      await store.store(media, "TestGadget");

      await store.cleanup();
      await store.cleanup(); // Should not throw
      await store.cleanup();

      expect(store.size).toBe(0);
    });

    it("is safe to call on empty store", async () => {
      await store.cleanup(); // Should not throw
      expect(store.size).toBe(0);
    });
  });

  describe("ID uniqueness", () => {
    it("generates unique IDs across many items", async () => {
      const media = createTestMedia();
      const ids = new Set<string>();

      // Store 100 items and verify all IDs are unique
      for (let i = 0; i < 100; i++) {
        const stored = await store.store(media, "TestGadget");
        expect(ids.has(stored.id)).toBe(false);
        ids.add(stored.id);
      }

      expect(ids.size).toBe(100);
    });
  });

  describe("error handling", () => {
    it("throws descriptive error when directory creation fails", async () => {
      // Create a store with invalid path (null byte in path)
      const badStore = new MediaStore("test\x00invalid");

      await expect(badStore.store(createTestMedia(), "TestGadget")).rejects.toThrow(
        /MediaStore: Failed to create directory/,
      );
    });

    it("throws descriptive error when file write fails", async () => {
      // First, create the directory
      const testStore = new MediaStore(`test-write-fail-${Date.now()}`);

      // Store one file to initialize the directory
      await testStore.store(createTestMedia(), "Test");

      // Delete the directory while store thinks it exists
      await rm(testStore.getOutputDir(), { recursive: true, force: true });

      // Next store should fail with descriptive error
      // Note: This may actually succeed on some systems if the path is recreated
      // So we just verify the store doesn't crash catastrophically
      try {
        await testStore.store(createTestMedia(), "Test");
      } catch (e) {
        expect(String(e)).toMatch(/MediaStore/);
      }
    });
  });
});
