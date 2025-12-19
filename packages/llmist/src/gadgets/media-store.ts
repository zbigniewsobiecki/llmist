/**
 * MediaStore: Session-scoped storage for gadget media outputs.
 *
 * This module provides an abstraction layer between gadgets and the filesystem.
 * Instead of exposing raw file paths, it assigns unique IDs to stored media
 * that can be shared with the LLM and user.
 *
 * @example
 * ```typescript
 * const store = new MediaStore();
 *
 * // Store an image, get back ID
 * const stored = await store.store({
 *   kind: "image",
 *   data: base64EncodedPng,
 *   mimeType: "image/png",
 *   description: "Screenshot"
 * }, "Screenshot");
 *
 * console.log(stored.id); // "media_a1b2c3"
 * console.log(stored.path); // "/tmp/llmist-media-xxx/Screenshot_001.png"
 *
 * // Later: retrieve by ID
 * const retrieved = store.get("media_a1b2c3");
 * ```
 */

import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GadgetMediaOutput, MediaKind, StoredMedia } from "./types.js";

// Re-export StoredMedia for convenience
export type { StoredMedia };

/**
 * Get the llmist temp directory path.
 * Uses ~/.llmist/tmp for user-scoped storage.
 */
function getLlmistTmpDir(): string {
  return join(homedir(), ".llmist", "tmp");
}

/**
 * Common MIME type to file extension mapping.
 */
const MIME_TO_EXTENSION: Record<string, string> = {
  // Images
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  // Audio
  "audio/mp3": ".mp3",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
  "audio/flac": ".flac",
  "audio/aac": ".aac",
  // Video
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/ogg": ".ogv",
  "video/quicktime": ".mov",
  "video/x-msvideo": ".avi",
  // Documents
  "application/pdf": ".pdf",
  "application/json": ".json",
  "text/plain": ".txt",
  "text/html": ".html",
  "text/css": ".css",
  "text/javascript": ".js",
};

/**
 * Session-scoped media storage with ID abstraction.
 *
 * Each MediaStore instance manages media for a single agent session.
 * Media files are stored in a temporary directory and referenced by
 * short, unique IDs rather than file paths.
 */
export class MediaStore {
  private readonly items = new Map<string, StoredMedia>();
  private readonly outputDir: string;
  private counter = 0;
  private initialized = false;

  /**
   * Create a new MediaStore.
   *
   * @param sessionId - Optional session ID for the output directory.
   *                    If not provided, a random ID is generated.
   */
  constructor(sessionId?: string) {
    const id = sessionId ?? randomBytes(8).toString("hex");
    this.outputDir = join(getLlmistTmpDir(), `media-${id}`);
  }

  /**
   * Get the output directory path.
   */
  getOutputDir(): string {
    return this.outputDir;
  }

  /**
   * Ensure the output directory exists.
   * @throws Error if directory creation fails
   */
  private async ensureDir(): Promise<void> {
    if (this.initialized) return;

    try {
      await mkdir(this.outputDir, { recursive: true });
      this.initialized = true;
    } catch (error) {
      throw new Error(
        `MediaStore: Failed to create directory ${this.outputDir}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Generate a unique media ID.
   * Format: "media_" + 6 random alphanumeric characters
   */
  private generateId(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let id = "media_";
    const bytes = randomBytes(6);
    for (let i = 0; i < 6; i++) {
      id += chars[bytes[i] % chars.length];
    }
    return id;
  }

  /**
   * Get file extension from MIME type.
   */
  private getExtension(mimeType: string): string {
    return MIME_TO_EXTENSION[mimeType] ?? ".bin";
  }

  /**
   * Store media and return stored metadata with ID.
   *
   * @param media - The media output from a gadget
   * @param gadgetName - Name of the gadget that created this media
   * @returns Stored media information including generated ID
   * @throws Error if file write fails
   */
  async store(media: GadgetMediaOutput, gadgetName: string): Promise<StoredMedia> {
    await this.ensureDir();

    const id = this.generateId();
    const ext = this.getExtension(media.mimeType);
    // Use provided fileName or generate one
    const filename =
      media.fileName ?? `${gadgetName}_${String(++this.counter).padStart(3, "0")}${ext}`;
    const filePath = join(this.outputDir, filename);

    // Decode base64 and write to file
    const buffer = Buffer.from(media.data, "base64");

    try {
      await writeFile(filePath, buffer);
    } catch (error) {
      throw new Error(
        `MediaStore: Failed to write media file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const stored: StoredMedia = {
      id,
      kind: media.kind,
      path: filePath,
      mimeType: media.mimeType,
      sizeBytes: buffer.length,
      description: media.description,
      metadata: media.metadata,
      gadgetName,
      createdAt: new Date(),
    };

    this.items.set(id, stored);
    return stored;
  }

  /**
   * Get stored media by ID.
   *
   * @param id - The media ID (e.g., "media_a1b2c3")
   * @returns The stored media or undefined if not found
   */
  get(id: string): StoredMedia | undefined {
    return this.items.get(id);
  }

  /**
   * Get the actual file path for a media ID.
   * Convenience method for gadgets that need the raw path.
   *
   * @param id - The media ID
   * @returns The file path or undefined if not found
   */
  getPath(id: string): string | undefined {
    return this.items.get(id)?.path;
  }

  /**
   * List all stored media, optionally filtered by kind.
   *
   * @param kind - Optional media kind to filter by
   * @returns Array of stored media items
   */
  list(kind?: MediaKind): StoredMedia[] {
    const all = Array.from(this.items.values());
    if (kind) {
      return all.filter((item) => item.kind === kind);
    }
    return all;
  }

  /**
   * Get the count of stored media items.
   */
  get size(): number {
    return this.items.size;
  }

  /**
   * Check if a media ID exists.
   */
  has(id: string): boolean {
    return this.items.has(id);
  }

  /**
   * Clear in-memory store without deleting files.
   * Resets the counter but leaves files on disk.
   */
  clear(): void {
    this.items.clear();
    this.counter = 0;
  }

  /**
   * Delete all stored files and clear memory.
   * Removes the entire session directory.
   */
  async cleanup(): Promise<void> {
    if (this.initialized) {
      try {
        await rm(this.outputDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors (directory may already be deleted)
      }
      this.initialized = false;
    }
    this.clear();
  }
}
