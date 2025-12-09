/**
 * File utilities for CLI multimodal input support.
 *
 * Provides functions to read and validate image and audio files
 * for use with multimodal LLM requests.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  audioFromBuffer,
  detectAudioMimeType,
  detectImageMimeType,
  imageFromBuffer,
  type AudioContentPart,
  type AudioMimeType,
  type ImageContentPart,
  type ImageMimeType,
} from "../core/input-content.js";

/**
 * Read and validate an image file.
 *
 * @param filePath - Path to image file (absolute or relative to cwd)
 * @returns Image content part ready for LLM message
 * @throws Error if file doesn't exist or isn't a valid image format
 *
 * @example
 * ```typescript
 * const imagePart = await readImageFile("./photo.jpg");
 * const messages = [{ role: "user", content: [text("Describe this:"), imagePart] }];
 * ```
 */
export async function readImageFile(filePath: string): Promise<ImageContentPart> {
  const absolutePath = resolve(filePath);

  let buffer: Buffer;
  try {
    buffer = await readFile(absolutePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read image file "${filePath}": ${message}`);
  }

  // Validate it's an image
  const mimeType = detectImageMimeType(buffer);
  if (!mimeType) {
    throw new Error(
      `File "${filePath}" is not a supported image format. ` +
        `Supported formats: JPEG, PNG, GIF, WebP`,
    );
  }

  return imageFromBuffer(buffer, mimeType);
}

/**
 * Read and validate an audio file.
 *
 * @param filePath - Path to audio file (absolute or relative to cwd)
 * @returns Audio content part ready for LLM message
 * @throws Error if file doesn't exist or isn't a valid audio format
 *
 * @example
 * ```typescript
 * const audioPart = await readAudioFile("./recording.mp3");
 * const messages = [{ role: "user", content: [text("Transcribe:"), audioPart] }];
 * ```
 */
export async function readAudioFile(filePath: string): Promise<AudioContentPart> {
  const absolutePath = resolve(filePath);

  let buffer: Buffer;
  try {
    buffer = await readFile(absolutePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read audio file "${filePath}": ${message}`);
  }

  // Validate it's audio
  const mimeType = detectAudioMimeType(buffer);
  if (!mimeType) {
    throw new Error(
      `File "${filePath}" is not a supported audio format. ` +
        `Supported formats: MP3, WAV, OGG, WebM`,
    );
  }

  return audioFromBuffer(buffer, mimeType);
}

/**
 * Read a file as raw buffer for multimodal input.
 * Use this when you need the raw data without converting to content parts.
 *
 * @param filePath - Path to file (absolute or relative to cwd)
 * @returns File contents as Buffer
 * @throws Error if file doesn't exist or can't be read
 */
export async function readFileBuffer(filePath: string): Promise<Buffer> {
  const absolutePath = resolve(filePath);

  try {
    return await readFile(absolutePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read file "${filePath}": ${message}`);
  }
}

/**
 * Validate that a file exists and has a supported image format.
 *
 * @param filePath - Path to file to validate
 * @returns Object with validation result and detected MIME type
 */
export async function validateImageFile(
  filePath: string,
): Promise<{ valid: boolean; mimeType?: ImageMimeType; error?: string }> {
  try {
    const absolutePath = resolve(filePath);
    const buffer = await readFile(absolutePath);
    const mimeType = detectImageMimeType(buffer);

    if (!mimeType) {
      return {
        valid: false,
        error: "Not a supported image format (JPEG, PNG, GIF, WebP)",
      };
    }

    return { valid: true, mimeType };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, error: message };
  }
}

/**
 * Validate that a file exists and has a supported audio format.
 *
 * @param filePath - Path to file to validate
 * @returns Object with validation result and detected MIME type
 */
export async function validateAudioFile(
  filePath: string,
): Promise<{ valid: boolean; mimeType?: AudioMimeType; error?: string }> {
  try {
    const absolutePath = resolve(filePath);
    const buffer = await readFile(absolutePath);
    const mimeType = detectAudioMimeType(buffer);

    if (!mimeType) {
      return {
        valid: false,
        error: "Not a supported audio format (MP3, WAV, OGG, WebM)",
      };
    }

    return { valid: true, mimeType };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, error: message };
  }
}
