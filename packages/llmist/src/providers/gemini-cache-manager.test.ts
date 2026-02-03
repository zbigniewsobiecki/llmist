import type { GoogleGenAI } from "@google/genai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type GeminiCacheContent, GeminiCacheManager } from "./gemini-cache-manager.js";

/** Helper to create a mock GoogleGenAI client with caches API */
function createMockCacheClient() {
  const createFn = vi.fn();
  const deleteFn = vi.fn();

  const client = {
    caches: {
      create: createFn,
      delete: deleteFn,
    },
  } as unknown as GoogleGenAI;

  return { client, createFn, deleteFn };
}

/** Helper to create sample Gemini content.
 * Default 70000 chars per content ensures 2 items × 70k chars / 4 ≈ 35k tokens > 32768 threshold */
function makeContents(count: number, charsPerContent = 70000): GeminiCacheContent[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "model",
    parts: [{ text: "x".repeat(charsPerContent) }],
  }));
}

/** System-style content (user instruction + model "Understood.") */
function makeSystemContents(count: number): GeminiCacheContent[] {
  const contents: GeminiCacheContent[] = [];
  for (let i = 0; i < count; i++) {
    contents.push(
      { role: "user", parts: [{ text: `System instruction ${i}` }] },
      { role: "model", parts: [{ text: "Understood." }] },
    );
  }
  return contents;
}

describe("GeminiCacheManager", () => {
  let mockClient: ReturnType<typeof createMockCacheClient>;
  let manager: GeminiCacheManager;

  beforeEach(() => {
    mockClient = createMockCacheClient();
    manager = new GeminiCacheManager(mockClient.client);
  });

  describe("getOrCreateCache", () => {
    it("creates a cache when content exceeds threshold", async () => {
      mockClient.createFn.mockResolvedValue({
        name: "cachedContents/abc123",
        expireTime: new Date(Date.now() + 3600_000).toISOString(),
        usageMetadata: { totalTokenCount: 40000 },
      });

      // 4 contents × 50k chars each = ~50k tokens > 32768 threshold
      const contents = makeContents(4);
      // Last content is the latest user message (index 3 is model, index 2 is user)
      const result = await manager.getOrCreateCache(
        "gemini-2.5-flash",
        contents,
        { enabled: true },
        2, // lastUserMessageIndex
      );

      expect(result).not.toBeNull();
      expect(result!.cacheName).toBe("cachedContents/abc123");
      expect(result!.cachedContentCount).toBe(2);
      expect(mockClient.createFn).toHaveBeenCalledOnce();
    });

    it("reuses cache when content hash matches", async () => {
      mockClient.createFn.mockResolvedValue({
        name: "cachedContents/abc123",
        expireTime: new Date(Date.now() + 3600_000).toISOString(),
      });

      const contents = makeContents(4);

      // First call creates cache
      const result1 = await manager.getOrCreateCache(
        "gemini-2.5-flash",
        contents,
        { enabled: true },
        2,
      );
      expect(result1).not.toBeNull();
      expect(mockClient.createFn).toHaveBeenCalledTimes(1);

      // Second call with same content should reuse
      const result2 = await manager.getOrCreateCache(
        "gemini-2.5-flash",
        contents,
        { enabled: true },
        2,
      );
      expect(result2).not.toBeNull();
      expect(result2!.cacheName).toBe("cachedContents/abc123");
      // Should NOT call create again
      expect(mockClient.createFn).toHaveBeenCalledTimes(1);
    });

    it("skips caching when content is below threshold", async () => {
      // Small content: 2 contents × 100 chars = ~50 tokens < 32768
      const contents: GeminiCacheContent[] = [
        { role: "user", parts: [{ text: "Hello" }] },
        { role: "model", parts: [{ text: "Hi" }] },
        { role: "user", parts: [{ text: "Question" }] },
      ];

      const result = await manager.getOrCreateCache(
        "gemini-2.5-flash",
        contents,
        { enabled: true },
        2,
      );

      expect(result).toBeNull();
      expect(mockClient.createFn).not.toHaveBeenCalled();
    });

    it("skips caching when disabled", async () => {
      const contents = makeContents(4);

      const result = await manager.getOrCreateCache(
        "gemini-2.5-flash",
        contents,
        { enabled: false },
        2,
      );

      expect(result).toBeNull();
      expect(mockClient.createFn).not.toHaveBeenCalled();
    });

    it("recreates cache when content changes", async () => {
      mockClient.createFn
        .mockResolvedValueOnce({
          name: "cachedContents/first",
          expireTime: new Date(Date.now() + 3600_000).toISOString(),
        })
        .mockResolvedValueOnce({
          name: "cachedContents/second",
          expireTime: new Date(Date.now() + 3600_000).toISOString(),
        });
      mockClient.deleteFn.mockResolvedValue({});

      const contents1 = makeContents(4);

      // First call
      const result1 = await manager.getOrCreateCache(
        "gemini-2.5-flash",
        contents1,
        { enabled: true },
        2,
      );
      expect(result1!.cacheName).toBe("cachedContents/first");

      // Different content (conversation grew)
      const contents2 = [...contents1, ...makeContents(2)];

      const result2 = await manager.getOrCreateCache(
        "gemini-2.5-flash",
        contents2,
        { enabled: true },
        4,
      );
      expect(result2!.cacheName).toBe("cachedContents/second");

      // Old cache should have been cleaned up
      expect(mockClient.deleteFn).toHaveBeenCalledWith({
        name: "cachedContents/first",
      });
    });

    it("recreates cache when near expiry", async () => {
      // Create cache that expires in 30 seconds (below 60s safety margin)
      mockClient.createFn
        .mockResolvedValueOnce({
          name: "cachedContents/expiring",
          expireTime: new Date(Date.now() + 30_000).toISOString(),
        })
        .mockResolvedValueOnce({
          name: "cachedContents/fresh",
          expireTime: new Date(Date.now() + 3600_000).toISOString(),
        });
      mockClient.deleteFn.mockResolvedValue({});

      const contents = makeContents(4);

      // First call
      await manager.getOrCreateCache("gemini-2.5-flash", contents, { enabled: true }, 2);

      // Second call - should recreate because cache is near expiry
      const result2 = await manager.getOrCreateCache(
        "gemini-2.5-flash",
        contents,
        { enabled: true },
        2,
      );
      expect(result2!.cacheName).toBe("cachedContents/fresh");
      expect(mockClient.createFn).toHaveBeenCalledTimes(2);
    });

    it("returns null gracefully on API error", async () => {
      mockClient.createFn.mockRejectedValue(new Error("API quota exceeded"));

      const contents = makeContents(4);

      // Suppress console.warn for this test
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await manager.getOrCreateCache(
        "gemini-2.5-flash",
        contents,
        { enabled: true },
        2,
      );

      expect(result).toBeNull();

      warnSpy.mockRestore();
    });

    it("respects custom ttl", async () => {
      mockClient.createFn.mockResolvedValue({
        name: "cachedContents/custom-ttl",
        expireTime: new Date(Date.now() + 7200_000).toISOString(),
      });

      const contents = makeContents(4);

      await manager.getOrCreateCache(
        "gemini-2.5-flash",
        contents,
        { enabled: true, ttl: "7200s" },
        2,
      );

      expect(mockClient.createFn).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            ttl: "7200s",
          }),
        }),
      );
    });

    it("respects custom minTokenThreshold", async () => {
      // Content has ~50 tokens (small) but threshold is lowered to 10
      const contents: GeminiCacheContent[] = [
        { role: "user", parts: [{ text: "x".repeat(200) }] },
        { role: "model", parts: [{ text: "y".repeat(200) }] },
        { role: "user", parts: [{ text: "Latest question" }] },
      ];

      mockClient.createFn.mockResolvedValue({
        name: "cachedContents/low-threshold",
        expireTime: new Date(Date.now() + 3600_000).toISOString(),
      });

      const result = await manager.getOrCreateCache(
        "gemini-2.5-flash",
        contents,
        { enabled: true, minTokenThreshold: 10 },
        2,
      );

      expect(result).not.toBeNull();
    });
  });

  describe("scope: system vs conversation", () => {
    it("caches only system-derived content when scope is 'system'", async () => {
      mockClient.createFn.mockResolvedValue({
        name: "cachedContents/system-only",
        expireTime: new Date(Date.now() + 3600_000).toISOString(),
      });

      // System messages (user+model pairs) followed by actual conversation
      const systemParts = makeSystemContents(3); // 3 system instructions = 6 content entries
      // Pad system instructions with enough text to meet threshold
      for (const content of systemParts) {
        if (content.role === "user") {
          content.parts = [{ text: "x".repeat(50000) }];
        }
      }
      const conversationParts: GeminiCacheContent[] = [
        { role: "user", parts: [{ text: "User question" }] },
        { role: "model", parts: [{ text: "Model answer" }] },
        { role: "user", parts: [{ text: "Follow-up" }] },
      ];
      const allContents = [...systemParts, ...conversationParts];

      const result = await manager.getOrCreateCache(
        "gemini-2.5-flash",
        allContents,
        { enabled: true, scope: "system" },
        7, // last user message at index 8
      );

      expect(result).not.toBeNull();
      expect(result!.cachedContentCount).toBe(6); // Only the 6 system-derived entries

      // Verify that create was called with only the system content
      const createCall = mockClient.createFn.mock.calls[0][0];
      expect(createCall.config.contents).toHaveLength(6);
    });

    it("caches everything except last user message when scope is 'conversation'", async () => {
      mockClient.createFn.mockResolvedValue({
        name: "cachedContents/conversation",
        expireTime: new Date(Date.now() + 3600_000).toISOString(),
      });

      const contents = makeContents(6); // 6 items, index 4 is last "user"

      const result = await manager.getOrCreateCache(
        "gemini-2.5-flash",
        contents,
        { enabled: true, scope: "conversation" },
        4, // last user message index
      );

      expect(result).not.toBeNull();
      expect(result!.cachedContentCount).toBe(4); // Contents 0-3
    });

    it("defaults to 'conversation' scope when not specified", async () => {
      mockClient.createFn.mockResolvedValue({
        name: "cachedContents/default-scope",
        expireTime: new Date(Date.now() + 3600_000).toISOString(),
      });

      const contents = makeContents(6);

      const result = await manager.getOrCreateCache(
        "gemini-2.5-flash",
        contents,
        { enabled: true }, // No scope specified
        4,
      );

      expect(result).not.toBeNull();
      expect(result!.cachedContentCount).toBe(4); // Same as conversation scope
    });
  });

  describe("dispose", () => {
    it("deletes active cache on dispose", async () => {
      mockClient.createFn.mockResolvedValue({
        name: "cachedContents/to-delete",
        expireTime: new Date(Date.now() + 3600_000).toISOString(),
      });
      mockClient.deleteFn.mockResolvedValue({});

      const contents = makeContents(4);

      await manager.getOrCreateCache("gemini-2.5-flash", contents, { enabled: true }, 2);

      await manager.dispose();

      expect(mockClient.deleteFn).toHaveBeenCalledWith({
        name: "cachedContents/to-delete",
      });
    });

    it("handles delete failure gracefully", async () => {
      mockClient.createFn.mockResolvedValue({
        name: "cachedContents/delete-fail",
        expireTime: new Date(Date.now() + 3600_000).toISOString(),
      });
      mockClient.deleteFn.mockRejectedValue(new Error("Not found"));

      const contents = makeContents(4);

      await manager.getOrCreateCache("gemini-2.5-flash", contents, { enabled: true }, 2);

      // Should not throw
      await expect(manager.dispose()).resolves.not.toThrow();
    });

    it("is a no-op when no active cache exists", async () => {
      await manager.dispose();
      expect(mockClient.deleteFn).not.toHaveBeenCalled();
    });
  });
});
