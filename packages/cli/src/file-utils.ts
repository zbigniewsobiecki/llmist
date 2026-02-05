/**
 * File utilities for CLI multimodal input support.
 *
 * Provides functions to read and validate image and audio files
 * for use with multimodal LLM requests.
 */

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  type AudioContentPart,
  type AudioMimeType,
  audioFromBuffer,
  detectAudioMimeType,
  detectImageMimeType,
  type ImageContentPart,
  type ImageMimeType,
  imageFromBuffer,
} from "llmist";

/**
 * Default maximum file size: 50MB
 * This prevents accidentally loading very large files into memory.
 */
export const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Options for file reading operations.
 */
export interface FileReadOptions {
  /**
   * Maximum allowed file size in bytes.
   * Files larger than this will throw an error.
   * Default: 50MB (DEFAULT_MAX_FILE_SIZE)
   */
  maxFileSize?: number;
}

/**
 * Format file size as human-readable string.
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Check file size before reading to prevent memory issues.
 */
async function checkFileSize(
  absolutePath: string,
  filePath: string,
  maxSize: number,
): Promise<void> {
  const stats = await stat(absolutePath);
  if (stats.size > maxSize) {
    throw new Error(
      `File "${filePath}" is too large (${formatFileSize(stats.size)}). ` +
        `Maximum allowed size is ${formatFileSize(maxSize)}. ` +
        `Consider compressing the file or using a smaller version.`,
    );
  }
}

/**
 * Read a system prompt from a file.
 *
 * @param filePath - Path to system prompt file (absolute or relative to cwd)
 * @param options - Optional configuration for file reading
 * @returns System prompt content as string
 * @throws Error if file doesn't exist, is too large, or can't be read
 *
 * @example
 * ```typescript
 * const systemPrompt = await readSystemPromptFile("./system.txt");
 * builder.addSystem(systemPrompt);
 * ```
 */
export async function readSystemPromptFile(
  filePath: string,
  options: FileReadOptions = {},
): Promise<string> {
  const absolutePath = resolve(filePath);
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

  try {
    await checkFileSize(absolutePath, filePath, maxFileSize);
    return await readFile(absolutePath, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read system prompt file "${filePath}": ${message}`);
  }
}

/**
 * Read and validate an image file.
 *
 * @param filePath - Path to image file (absolute or relative to cwd)
 * @param options - Optional configuration for file reading
 * @returns Image content part ready for LLM message
 * @throws Error if file doesn't exist, is too large, or isn't a valid image format
 *
 * @example
 * ```typescript
 * const imagePart = await readImageFile("./photo.jpg");
 * const messages = [{ role: "user", content: [text("Describe this:"), imagePart] }];
 * ```
 */
export async function readImageFile(
  filePath: string,
  options: FileReadOptions = {},
): Promise<ImageContentPart> {
  const absolutePath = resolve(filePath);
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

  let buffer: Buffer;
  try {
    await checkFileSize(absolutePath, filePath, maxFileSize);
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
 * @param options - Optional configuration for file reading
 * @returns Audio content part ready for LLM message
 * @throws Error if file doesn't exist, is too large, or isn't a valid audio format
 *
 * @example
 * ```typescript
 * const audioPart = await readAudioFile("./recording.mp3");
 * const messages = [{ role: "user", content: [text("Transcribe:"), audioPart] }];
 * ```
 */
export async function readAudioFile(
  filePath: string,
  options: FileReadOptions = {},
): Promise<AudioContentPart> {
  const absolutePath = resolve(filePath);
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

  let buffer: Buffer;
  try {
    await checkFileSize(absolutePath, filePath, maxFileSize);
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
 * @param options - Optional configuration for file reading
 * @returns File contents as Buffer
 * @throws Error if file doesn't exist, is too large, or can't be read
 */
export async function readFileBuffer(
  filePath: string,
  options: FileReadOptions = {},
): Promise<Buffer> {
  const absolutePath = resolve(filePath);
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

  try {
    await checkFileSize(absolutePath, filePath, maxFileSize);
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
