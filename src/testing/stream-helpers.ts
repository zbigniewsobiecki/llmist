/**
 * Stream testing utilities for llmist.
 * Provides helpers for creating and consuming test streams.
 */

import type { LLMStream, LLMStreamChunk } from "../core/options.js";

/**
 * Create an async iterable stream from an array of chunks.
 * Useful for creating deterministic test streams.
 *
 * @param chunks - Array of chunks to yield
 * @returns An async iterable that yields the chunks in order
 *
 * @example
 * ```typescript
 * const stream = createTestStream([
 *   { text: "Hello " },
 *   { text: "world", finishReason: "stop", usage: { inputTokens: 10, outputTokens: 5 } }
 * ]);
 * ```
 */
export function createTestStream(chunks: LLMStreamChunk[]): LLMStream {
  return (async function* () {
    for (const chunk of chunks) {
      yield chunk;
    }
  })();
}

/**
 * Create a stream that yields text in specified chunks.
 * Automatically adds finishReason and usage to the final chunk.
 *
 * @param text - The full text to stream
 * @param options - Configuration options
 * @returns An async iterable stream
 *
 * @example
 * ```typescript
 * const stream = createTextStream("Hello, world!", { chunkSize: 5 });
 * // Yields: "Hello", ", wor", "ld!"
 * ```
 */
export function createTextStream(
  text: string,
  options?: {
    /** Size of each chunk (default: entire text as one chunk) */
    chunkSize?: number;
    /** Delay before starting the stream in ms */
    delayMs?: number;
    /** Delay between chunks in ms */
    chunkDelayMs?: number;
    /** Custom usage stats */
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
    /** Custom finish reason (default: "stop") */
    finishReason?: string;
  },
): LLMStream {
  return (async function* () {
    if (options?.delayMs) {
      await sleep(options.delayMs);
    }

    const chunkSize = options?.chunkSize ?? text.length;
    const chunks: string[] = [];

    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize));
    }

    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;

      const chunk: LLMStreamChunk = { text: chunks[i] };

      if (isLast) {
        chunk.finishReason = options?.finishReason ?? "stop";
        const inputTokens = Math.ceil(text.length / 4);
        const outputTokens = Math.ceil(text.length / 4);
        chunk.usage = options?.usage ?? {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        };
      }

      yield chunk;

      if (options?.chunkDelayMs && !isLast) {
        await sleep(options.chunkDelayMs);
      }
    }
  })();
}

/**
 * Collect all chunks from a stream into an array.
 * Useful for asserting on stream output in tests.
 *
 * @param stream - The stream to collect from
 * @returns Array of all chunks from the stream
 *
 * @example
 * ```typescript
 * const chunks = await collectStream(myStream);
 * expect(chunks).toHaveLength(3);
 * expect(chunks[2].finishReason).toBe("stop");
 * ```
 */
export async function collectStream(stream: LLMStream): Promise<LLMStreamChunk[]> {
  const chunks: LLMStreamChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

/**
 * Collect all text from a stream into a single string.
 *
 * @param stream - The stream to collect from
 * @returns Concatenated text from all chunks
 *
 * @example
 * ```typescript
 * const text = await collectStreamText(myStream);
 * expect(text).toBe("Hello, world!");
 * ```
 */
export async function collectStreamText(stream: LLMStream): Promise<string> {
  let text = "";
  for await (const chunk of stream) {
    text += chunk.text ?? "";
  }
  return text;
}

/**
 * Get the final chunk from a stream (containing finishReason and usage).
 *
 * @param stream - The stream to consume
 * @returns The final chunk from the stream
 */
export async function getStreamFinalChunk(stream: LLMStream): Promise<LLMStreamChunk | undefined> {
  let lastChunk: LLMStreamChunk | undefined;
  for await (const chunk of stream) {
    lastChunk = chunk;
  }
  return lastChunk;
}

/**
 * Create an empty stream that yields nothing.
 * Useful for testing edge cases.
 */
export function createEmptyStream(): LLMStream {
  return (async function* () {
    // Empty stream
  })();
}

/**
 * Create a stream that throws an error after yielding some chunks.
 * Useful for testing error handling.
 *
 * @param chunksBeforeError - Chunks to yield before throwing
 * @param error - The error to throw
 */
export function createErrorStream(
  chunksBeforeError: LLMStreamChunk[],
  error: Error,
): LLMStream {
  return (async function* () {
    for (const chunk of chunksBeforeError) {
      yield chunk;
    }
    throw error;
  })();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
