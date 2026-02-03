/**
 * Gemini Context Cache Manager
 *
 * Manages the lifecycle of Gemini's explicit context caches. Unlike Anthropic's
 * ephemeral caching (automatic via markers), Gemini requires creating cache
 * resources via the API and referencing them by name in generation requests.
 *
 * Cache lifecycle:
 * 1. Content is hashed to detect changes
 * 2. If existing cache matches hash and hasn't expired, it's reused
 * 3. Otherwise, a new cache is created (old one is cleaned up best-effort)
 * 4. The cache name is returned for use in `generateContentStream({ cachedContent: name })`
 *
 * Caches auto-expire via TTL, so cleanup failures are non-critical.
 */

import { createHash } from "node:crypto";
import { FunctionCallingConfigMode, type GoogleGenAI } from "@google/genai";
import type { CachingConfig, CachingScope } from "../core/options.js";

/**
 * A Gemini content object (role + parts).
 * Matches the format used by GeminiGenerativeProvider.
 */
export type GeminiCacheContent = {
  role: string;
  parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>;
};

/**
 * Tracks the active cache entry for reuse detection.
 */
interface ActiveCacheEntry {
  /** Server-assigned cache resource name (for referencing in generation calls) */
  name: string;
  /** Model the cache was created for */
  model: string;
  /** Hash of the cached content (for change detection) */
  contentHash: string;
  /** When the cache expires (ISO 8601) */
  expireTime: string;
}

export class GeminiCacheManager {
  private activeCache: ActiveCacheEntry | null = null;

  constructor(private readonly client: GoogleGenAI) {}

  /**
   * Get or create a cache for the given content.
   *
   * Returns the cache name if a cache was created/reused, or `null` if caching
   * was skipped (disabled, below threshold, or API error).
   *
   * @param model - Gemini model name (e.g., "gemini-2.5-flash")
   * @param allContents - All Gemini-formatted contents (system + conversation)
   * @param config - Caching configuration from the user
   * @param lastUserMessageIndex - Index of the last user message (content after this is not cached)
   * @returns Cache name string or null
   */
  async getOrCreateCache(
    model: string,
    allContents: GeminiCacheContent[],
    config: CachingConfig,
    lastUserMessageIndex: number,
  ): Promise<{ cacheName: string; cachedContentCount: number } | null> {
    // Guard: caching must be enabled
    if (!config.enabled) return null;

    const scope: CachingScope = config.scope ?? "conversation";
    const ttl = config.ttl ?? "3600s";
    const minTokenThreshold = config.minTokenThreshold ?? 32768;

    // Determine what content to cache based on scope
    const cacheableContents = this.selectCacheableContents(
      allContents,
      scope,
      lastUserMessageIndex,
    );

    if (cacheableContents.length === 0) return null;

    // Estimate token count using character-based heuristic (avoid extra API call)
    // Gemini's countTokens would be more accurate but adds latency
    const estimatedTokens = this.estimateTokenCount(cacheableContents);
    if (estimatedTokens < minTokenThreshold) return null;

    // Compute content hash for change detection
    const contentHash = this.computeContentHash(cacheableContents, model);

    // Check if existing cache can be reused
    if (this.activeCache && this.canReuseCache(this.activeCache, model, contentHash)) {
      return {
        cacheName: this.activeCache.name,
        cachedContentCount: cacheableContents.length,
      };
    }

    // Create new cache (clean up old one best-effort)
    try {
      await this.cleanupActiveCache();

      const response = await this.client.caches.create({
        model,
        config: {
          contents: cacheableContents,
          ttl,
          displayName: `llmist-${scope}-${Date.now()}`,
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.NONE,
            },
          },
        },
      });

      if (!response.name) {
        return null;
      }

      this.activeCache = {
        name: response.name,
        model,
        contentHash,
        expireTime: response.expireTime ?? "",
      };

      return {
        cacheName: response.name,
        cachedContentCount: cacheableContents.length,
      };
    } catch (error) {
      // Graceful degradation: log and continue without caching
      console.warn("Gemini cache creation failed, continuing without cache:", error);
      return null;
    }
  }

  /**
   * Clean up the active cache (best-effort).
   * Caches auto-expire via TTL, so failure is non-critical.
   */
  async dispose(): Promise<void> {
    await this.cleanupActiveCache();
  }

  /**
   * Select which contents to cache based on scope.
   *
   * - "system": Only system-derived messages (the initial user+model exchanges
   *   generated from system messages)
   * - "conversation": Everything except the last user message
   */
  private selectCacheableContents(
    allContents: GeminiCacheContent[],
    scope: CachingScope,
    lastUserMessageIndex: number,
  ): GeminiCacheContent[] {
    if (scope === "system") {
      // System messages are converted to user+model pairs at the start.
      // Find where the initial system-derived exchanges end:
      // They follow the pattern: user (instruction) → model ("Understood.")
      let systemEndIndex = 0;
      for (let i = 0; i < allContents.length; i++) {
        const content = allContents[i];
        if (
          content.role === "model" &&
          content.parts.length === 1 &&
          "text" in content.parts[0] &&
          content.parts[0].text === "Understood."
        ) {
          // This model response confirms the preceding user message was a system instruction
          systemEndIndex = i + 1;
        } else if (content.role === "user") {
          // Check if the next entry is a model "Understood." (i.e., still a system pair)
          const next = allContents[i + 1];
          if (
            next &&
            next.role === "model" &&
            next.parts.length === 1 &&
            "text" in next.parts[0] &&
            next.parts[0].text === "Understood."
          ) {
            // Still in system section, continue scanning
            continue;
          }
          // Not a system message, stop here
          break;
        } else {
          break;
        }
      }
      return allContents.slice(0, systemEndIndex);
    }

    // "conversation" scope: everything up to (but not including) the last user message
    if (lastUserMessageIndex <= 0) return [];
    return allContents.slice(0, lastUserMessageIndex);
  }

  /**
   * Estimate token count from contents using character-based heuristic.
   * Uses ~4 characters per token (conservative estimate for English text).
   */
  private estimateTokenCount(contents: GeminiCacheContent[]): number {
    let totalChars = 0;
    for (const content of contents) {
      for (const part of content.parts) {
        if ("text" in part) {
          totalChars += part.text.length;
        } else if ("inlineData" in part) {
          // Images/audio: rough estimate of 258 tokens each
          totalChars += 258 * 4;
        }
      }
    }
    return Math.ceil(totalChars / 4);
  }

  /**
   * Compute a stable hash of the cacheable contents for change detection.
   */
  private computeContentHash(contents: GeminiCacheContent[], model: string): string {
    const hash = createHash("sha256");
    hash.update(model);
    for (const content of contents) {
      hash.update(content.role);
      for (const part of content.parts) {
        if ("text" in part) {
          hash.update(part.text);
        } else if ("inlineData" in part) {
          hash.update(part.inlineData.mimeType);
          hash.update(part.inlineData.data);
        }
      }
    }
    return hash.digest("hex");
  }

  /**
   * Check if an existing cache can be reused.
   */
  private canReuseCache(cache: ActiveCacheEntry, model: string, contentHash: string): boolean {
    if (cache.model !== model) return false;
    if (cache.contentHash !== contentHash) return false;

    // Check expiry (with 60-second safety margin)
    if (cache.expireTime) {
      const expiresAt = new Date(cache.expireTime).getTime();
      const now = Date.now();
      if (expiresAt - now < 60_000) return false;
    }

    return true;
  }

  /**
   * Delete the active cache (best-effort).
   */
  private async cleanupActiveCache(): Promise<void> {
    if (!this.activeCache) return;

    try {
      await this.client.caches.delete({ name: this.activeCache.name });
    } catch {
      // Best-effort: caches auto-expire via TTL anyway
    }

    this.activeCache = null;
  }
}
