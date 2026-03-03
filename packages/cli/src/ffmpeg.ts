/**
 * FFmpeg utilities for audio format conversion.
 *
 * Provides functions to check ffmpeg availability and convert audio to MP3.
 * Used by the TextToSpeech gadget to normalize output to MP3 format when
 * the LLM provider doesn't support MP3 natively.
 */

import { spawn } from "node:child_process";

/** Timeout for audio conversion (30 seconds) */
const CONVERSION_TIMEOUT_MS = 30_000;

/**
 * Cached ffmpeg availability check Promise.
 * We cache the Promise (not the boolean result) to prevent race conditions
 * where multiple concurrent calls could each spawn their own ffmpeg check.
 */
let ffmpegCheckPromise: Promise<boolean> | null = null;

/**
 * Check if ffmpeg is available on the system.
 * Result is cached for the lifetime of the process.
 *
 * Thread-safe: concurrent calls share the same Promise.
 */
export async function isFFmpegAvailable(): Promise<boolean> {
  if (ffmpegCheckPromise !== null) return ffmpegCheckPromise;

  // Cache the Promise immediately to prevent race conditions
  ffmpegCheckPromise = new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });

  return ffmpegCheckPromise;
}

/**
 * Reset the cached ffmpeg availability check.
 * Primarily used for testing.
 */
export function resetFFmpegCache(): void {
  ffmpegCheckPromise = null;
}

/**
 * Convert audio buffer to MP3 using ffmpeg.
 *
 * @param input - Input audio buffer
 * @param inputFormat - Input format (wav, pcm16, opus, etc.)
 * @param timeout - Timeout in milliseconds (default: 30 seconds)
 * @returns MP3 buffer, or null if conversion fails or times out
 *
 * @remarks
 * PCM16 format assumes 24kHz mono signed 16-bit little-endian, which matches
 * OpenRouter's gpt-4o-audio-preview TTS output. Other providers may use
 * different sample rates.
 */
export async function convertToMp3(
  input: Buffer,
  inputFormat: string,
  timeout: number = CONVERSION_TIMEOUT_MS,
): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let timeoutId: NodeJS.Timeout | undefined;

    // Build ffmpeg args based on input format
    // PCM16: 24kHz mono signed 16-bit LE (matches OpenRouter gpt-4o-audio-preview)
    const inputArgs =
      inputFormat === "pcm16" ? ["-f", "s16le", "-ar", "24000", "-ac", "1"] : ["-f", inputFormat];

    const proc = spawn(
      "ffmpeg",
      [
        ...inputArgs,
        "-i",
        "pipe:0", // Read from stdin
        "-f",
        "mp3", // Output format
        "-ab",
        "128k", // Bitrate
        "pipe:1", // Write to stdout
      ],
      { stdio: ["pipe", "pipe", "ignore"] },
    );

    const chunks: Buffer[] = [];
    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));

    proc.on("error", () => {
      clearTimeout(timeoutId);
      resolve(null);
    });

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      resolve(code === 0 ? Buffer.concat(chunks) : null);
    });

    // Set timeout to prevent hanging on corrupted input or system issues
    timeoutId = setTimeout(() => {
      proc.kill();
      resolve(null);
    }, timeout);

    // Handle stdin errors (e.g., pipe breaks if process crashes before consuming input)
    proc.stdin.on("error", () => {
      // Silently handle - process error/close handler will resolve(null)
    });

    proc.stdin.write(input);
    proc.stdin.end();
  });
}
