/**
 * Media output types for gadgets returning images, audio, video, or files.
 *
 * This module contains pure data shapes with zero cross-module dependencies.
 * Imported by execution result types, stream event types, and execution context types.
 *
 * @module
 */

// =============================================================================
// Media Output Types (for gadgets returning images, audio, video, files)
// =============================================================================

/**
 * Supported media types for gadget output.
 * Extensible via union - add new types as needed.
 */
export type MediaKind = "image" | "audio" | "video" | "file";

/**
 * Type-specific metadata for media outputs.
 * Extensible via index signature for future media types.
 */
export interface MediaMetadata {
  /** Width in pixels (images, video) */
  width?: number;
  /** Height in pixels (images, video) */
  height?: number;
  /** Duration in milliseconds (audio, video) */
  durationMs?: number;
  /** Allow additional metadata for future extensions */
  [key: string]: unknown;
}

/**
 * Media output from a gadget execution.
 * Supports images, audio, video, and arbitrary files.
 *
 * @example
 * ```typescript
 * // Image output
 * const imageOutput: GadgetMediaOutput = {
 *   kind: "image",
 *   data: base64EncodedPng,
 *   mimeType: "image/png",
 *   description: "Screenshot of webpage",
 *   metadata: { width: 1920, height: 1080 }
 * };
 * ```
 */
export interface GadgetMediaOutput {
  /** Type of media (discriminator for type-specific handling) */
  kind: MediaKind;
  /** Base64-encoded media data */
  data: string;
  /** Full MIME type (e.g., "image/png", "audio/mp3", "video/mp4") */
  mimeType: string;
  /** Human-readable description of the media */
  description?: string;
  /** Type-specific metadata */
  metadata?: MediaMetadata;
  /** Optional filename to use when saving (if not provided, auto-generated) */
  fileName?: string;
}

/**
 * Stored media item with metadata and file path.
 *
 * Created by MediaStore when a gadget returns media outputs.
 * Contains the abstract ID, file path, and metadata for display.
 */
export interface StoredMedia {
  /** Unique ID for this media item (e.g., "media_a1b2c3") */
  id: string;
  /** Type of media */
  kind: MediaKind;
  /** Actual file path on disk (internal use) */
  path: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Human-readable description */
  description?: string;
  /** Type-specific metadata */
  metadata?: MediaMetadata;
  /** Name of the gadget that created this media */
  gadgetName: string;
  /** When the media was stored */
  createdAt: Date;
}

/**
 * Example of gadget usage to help LLMs understand proper invocation.
 *
 * Examples are rendered alongside the schema in `getInstruction()` to provide
 * concrete usage patterns for the LLM.
 *
 * @template TParams - Inferred parameter type from Zod schema (defaults to Record<string, unknown>)
 *
 * @example
 * ```typescript
 * const calculator = createGadget({
 *   schema: z.object({ a: z.number(), b: z.number() }),
 *   examples: [
 *     { params: { a: 5, b: 3 }, output: "8", comment: "Addition example" }
 *   ],
 *   // ...
 * });
 * ```
 */
export interface GadgetExample<TParams = Record<string, unknown>> {
  /** Example parameter values (typed to match schema) */
  params: TParams;

  /** Optional expected output/result string */
  output?: string;

  /** Optional description explaining what this example demonstrates */
  comment?: string;
}
