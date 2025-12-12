/**
 * Helper functions for gadget authors to easily return media outputs.
 *
 * These functions provide type-specific conveniences while using the
 * generic GadgetMediaOutput system underneath.
 *
 * @example
 * ```typescript
 * import { resultWithImage } from "llmist/gadgets";
 *
 * const screenshotGadget = createGadget({
 *   name: "Screenshot",
 *   schema: z.object({ url: z.string() }),
 *   execute: async ({ url }) => {
 *     const screenshot = await takeScreenshot(url);
 *     return resultWithImage(
 *       `Screenshot of ${url}`,
 *       screenshot,
 *       { description: "Webpage screenshot" }
 *     );
 *   },
 * });
 * ```
 */

import { detectAudioMimeType, detectImageMimeType } from "../core/input-content.js";
import type {
  GadgetExecuteResultWithMedia,
  GadgetMediaOutput,
  MediaKind,
  MediaMetadata,
} from "./types.js";

/**
 * Create a GadgetMediaOutput from raw data.
 *
 * @param kind - Type of media
 * @param data - Raw binary data (Buffer or Uint8Array)
 * @param mimeType - MIME type string
 * @param options - Optional description, metadata, and fileName
 * @returns A GadgetMediaOutput ready to include in results
 */
export function createMedia(
  kind: MediaKind,
  data: Buffer | Uint8Array,
  mimeType: string,
  options?: { description?: string; metadata?: MediaMetadata; fileName?: string },
): GadgetMediaOutput {
  const buffer = data instanceof Buffer ? data : Buffer.from(data);
  return {
    kind,
    data: buffer.toString("base64"),
    mimeType,
    description: options?.description,
    metadata: options?.metadata,
    fileName: options?.fileName,
  };
}

/**
 * Create a result with multiple media outputs.
 *
 * @param result - Text result string
 * @param media - Array of GadgetMediaOutput items (must not be empty)
 * @param cost - Optional cost in USD
 * @returns A GadgetExecuteResultWithMedia
 * @throws Error if media array is empty
 *
 * @example
 * ```typescript
 * return resultWithMedia(
 *   "Generated 2 charts",
 *   [
 *     createMedia("image", barChartPng, "image/png", { description: "Bar chart" }),
 *     createMedia("image", pieChartPng, "image/png", { description: "Pie chart" }),
 *   ],
 *   0.002
 * );
 * ```
 */
export function resultWithMedia(
  result: string,
  media: GadgetMediaOutput[],
  cost?: number,
): GadgetExecuteResultWithMedia {
  if (media.length === 0) {
    throw new Error("resultWithMedia: media array cannot be empty");
  }
  return {
    result,
    media,
    cost,
  };
}

/**
 * Options for resultWithImage helper.
 */
export interface ImageOptions {
  /** MIME type (auto-detected if not provided) */
  mimeType?: string;
  /** Human-readable description */
  description?: string;
  /** Image dimensions and other metadata */
  metadata?: MediaMetadata;
  /** Cost in USD */
  cost?: number;
  /** Filename to use when saving (if not provided, auto-generated) */
  fileName?: string;
}

/**
 * Create a result with a single image output.
 *
 * @param result - Text result string
 * @param imageData - Raw image data (PNG, JPEG, GIF, WebP)
 * @param options - Optional MIME type, description, metadata, cost
 * @returns A GadgetExecuteResultWithMedia
 *
 * @example
 * ```typescript
 * const screenshot = await page.screenshot({ type: "png" });
 * return resultWithImage(
 *   "Screenshot captured",
 *   screenshot,
 *   { description: "Homepage screenshot", metadata: { width: 1920, height: 1080 } }
 * );
 * ```
 */
export function resultWithImage(
  result: string,
  imageData: Buffer | Uint8Array,
  options?: ImageOptions,
): GadgetExecuteResultWithMedia {
  const buffer = imageData instanceof Buffer ? imageData : Buffer.from(imageData);
  const mimeType = options?.mimeType ?? detectImageMimeType(buffer);

  if (!mimeType) {
    throw new Error(
      "Could not detect image MIME type. Please provide mimeType explicitly in options.",
    );
  }

  return {
    result,
    media: [
      {
        kind: "image",
        data: buffer.toString("base64"),
        mimeType,
        description: options?.description,
        metadata: options?.metadata,
        fileName: options?.fileName,
      },
    ],
    cost: options?.cost,
  };
}

/**
 * Image item for resultWithImages helper.
 */
export interface ImageItem {
  /** Raw image data */
  data: Buffer | Uint8Array;
  /** MIME type (auto-detected if not provided) */
  mimeType?: string;
  /** Human-readable description */
  description?: string;
  /** Image dimensions and other metadata */
  metadata?: MediaMetadata;
  /** Filename to use when saving (if not provided, auto-generated) */
  fileName?: string;
}

/**
 * Create a result with multiple image outputs.
 *
 * @param result - Text result string
 * @param images - Array of image items (must not be empty)
 * @param cost - Optional cost in USD
 * @returns A GadgetExecuteResultWithMedia
 * @throws Error if images array is empty
 *
 * @example
 * ```typescript
 * return resultWithImages(
 *   "Generated comparison images",
 *   [
 *     { data: beforeImg, description: "Before" },
 *     { data: afterImg, description: "After" },
 *   ],
 *   0.01
 * );
 * ```
 */
export function resultWithImages(
  result: string,
  images: ImageItem[],
  cost?: number,
): GadgetExecuteResultWithMedia {
  if (images.length === 0) {
    throw new Error("resultWithImages: images array cannot be empty");
  }

  const media: GadgetMediaOutput[] = images.map((img, index) => {
    const buffer = img.data instanceof Buffer ? img.data : Buffer.from(img.data);
    const mimeType = img.mimeType ?? detectImageMimeType(buffer);

    if (!mimeType) {
      throw new Error(
        `Could not detect MIME type for image at index ${index}. Please provide mimeType explicitly.`,
      );
    }

    return {
      kind: "image" as const,
      data: buffer.toString("base64"),
      mimeType,
      description: img.description,
      metadata: img.metadata,
      fileName: img.fileName,
    };
  });

  return { result, media, cost };
}

/**
 * Options for resultWithAudio helper.
 */
export interface AudioOptions {
  /** MIME type (auto-detected if not provided) */
  mimeType?: string;
  /** Human-readable description */
  description?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Cost in USD */
  cost?: number;
  /** Filename to use when saving (if not provided, auto-generated) */
  fileName?: string;
}

/**
 * Create a result with a single audio output.
 *
 * @param result - Text result string
 * @param audioData - Raw audio data (MP3, WAV, OGG, etc.)
 * @param options - Optional MIME type, description, duration, cost
 * @returns A GadgetExecuteResultWithMedia
 *
 * @example
 * ```typescript
 * const speech = await generateSpeech(text);
 * return resultWithAudio(
 *   `Generated speech for: "${text.slice(0, 50)}..."`,
 *   speech,
 *   { mimeType: "audio/mp3", durationMs: 5000 }
 * );
 * ```
 */
export function resultWithAudio(
  result: string,
  audioData: Buffer | Uint8Array,
  options?: AudioOptions,
): GadgetExecuteResultWithMedia {
  const buffer = audioData instanceof Buffer ? audioData : Buffer.from(audioData);
  const mimeType = options?.mimeType ?? detectAudioMimeType(buffer);

  if (!mimeType) {
    throw new Error(
      "Could not detect audio MIME type. Please provide mimeType explicitly in options.",
    );
  }

  const metadata: MediaMetadata | undefined = options?.durationMs
    ? { durationMs: options.durationMs }
    : undefined;

  return {
    result,
    media: [
      {
        kind: "audio",
        data: buffer.toString("base64"),
        mimeType,
        description: options?.description,
        metadata,
        fileName: options?.fileName,
      },
    ],
    cost: options?.cost,
  };
}

/**
 * Options for resultWithFile helper.
 */
export interface FileOptions {
  /** Human-readable description */
  description?: string;
  /** Cost in USD */
  cost?: number;
  /** Filename to use when saving (if not provided, auto-generated) */
  fileName?: string;
}

/**
 * Create a result with a generic file output.
 *
 * Use this for arbitrary file types that don't fit image/audio categories.
 *
 * @param result - Text result string
 * @param fileData - Raw file data
 * @param mimeType - MIME type (required, not auto-detected)
 * @param options - Optional description and cost
 * @returns A GadgetExecuteResultWithMedia
 *
 * @example
 * ```typescript
 * const pdf = await generatePdf(content);
 * return resultWithFile(
 *   "Generated PDF report",
 *   pdf,
 *   "application/pdf",
 *   { description: "Monthly report" }
 * );
 * ```
 */
export function resultWithFile(
  result: string,
  fileData: Buffer | Uint8Array,
  mimeType: string,
  options?: FileOptions,
): GadgetExecuteResultWithMedia {
  const buffer = fileData instanceof Buffer ? fileData : Buffer.from(fileData);

  return {
    result,
    media: [
      {
        kind: "file",
        data: buffer.toString("base64"),
        mimeType,
        description: options?.description,
        fileName: options?.fileName,
      },
    ],
    cost: options?.cost,
  };
}
