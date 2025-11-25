import { GADGET_END_PREFIX, GADGET_START_PREFIX } from "../core/constants.js";
import type { LLMStream, LLMStreamChunk } from "../core/options.js";
import type { MockResponse } from "./mock-types.js";

/**
 * Utility to sleep for a given duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a unique invocation ID for gadget calls.
 */
function generateInvocationId(): string {
  return `inv-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Split text into chunks for streaming simulation.
 * Tries to split on word boundaries for more realistic streaming.
 */
function splitIntoChunks(text: string, minChunkSize = 5, maxChunkSize = 30): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Determine chunk size
    const chunkSize = Math.min(
      Math.floor(Math.random() * (maxChunkSize - minChunkSize + 1)) + minChunkSize,
      remaining.length,
    );

    // Try to split on word boundary
    let chunk: string;
    if (chunkSize < remaining.length) {
      const substr = remaining.substring(0, chunkSize);
      const lastSpace = substr.lastIndexOf(" ");
      if (lastSpace > minChunkSize / 2) {
        chunk = substr.substring(0, lastSpace + 1);
      } else {
        chunk = substr;
      }
    } else {
      chunk = remaining;
    }

    chunks.push(chunk);
    remaining = remaining.substring(chunk.length);
  }

  return chunks;
}

/**
 * Convert gadget calls in MockResponse to their text representation.
 * Formats them as the stream parser expects: !!!GADGET_START:name\n{params}\n!!!GADGET_END
 */
function formatGadgetCalls(gadgetCalls: NonNullable<MockResponse["gadgetCalls"]>): {
  text: string;
  calls: Array<{ name: string; invocationId: string }>;
} {
  let text = "";
  const calls: Array<{ name: string; invocationId: string }> = [];

  for (const call of gadgetCalls) {
    const invocationId = call.invocationId ?? generateInvocationId();
    calls.push({ name: call.gadgetName, invocationId });

    // Format parameters as JSON (default format)
    const paramsJson = JSON.stringify(call.parameters);

    // Format using the new gadget marker format
    text += `\n${GADGET_START_PREFIX}${call.gadgetName}\n${paramsJson}\n${GADGET_END_PREFIX}`;
  }

  return { text, calls };
}

/**
 * Create a mock LLM stream from a mock response.
 * This simulates the streaming behavior of real LLM providers.
 *
 * @param response - The mock response configuration
 * @returns An async iterable that yields LLMStreamChunks
 */
export async function* createMockStream(response: MockResponse): LLMStream {
  // Initial delay (simulate network latency)
  if (response.delayMs) {
    await sleep(response.delayMs);
  }

  const streamDelay = response.streamDelayMs ?? 0;
  let fullText = response.text ?? "";

  // Add gadget calls to the text if provided
  if (response.gadgetCalls && response.gadgetCalls.length > 0) {
    const { text: gadgetText } = formatGadgetCalls(response.gadgetCalls);
    fullText += gadgetText;
  }

  // Stream the text in chunks
  if (fullText.length > 0) {
    const chunks = streamDelay > 0 ? splitIntoChunks(fullText) : [fullText];

    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;

      const chunk: LLMStreamChunk = {
        text: chunks[i],
      };

      // Add finish reason and usage on the last chunk
      if (isLast) {
        if (response.finishReason !== undefined) {
          chunk.finishReason = response.finishReason;
        }
        if (response.usage) {
          chunk.usage = response.usage;
        }
      }

      yield chunk;

      // Delay between chunks
      if (streamDelay > 0 && !isLast) {
        await sleep(streamDelay);
      }
    }
  } else {
    // Empty response - still yield a final chunk with metadata
    yield {
      text: "",
      finishReason: response.finishReason ?? "stop",
      usage: response.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }
}

/**
 * Create a simple text-only mock stream.
 * Convenience helper for quickly creating mock responses.
 *
 * @param text - The text to stream
 * @param options - Optional streaming configuration
 *
 * @example
 * const stream = createTextMockStream('Hello, world!');
 * for await (const chunk of stream) {
 *   console.log(chunk.text);
 * }
 */
export function createTextMockStream(
  text: string,
  options?: {
    delayMs?: number;
    streamDelayMs?: number;
    usage?: MockResponse["usage"];
  },
): LLMStream {
  return createMockStream({
    text,
    delayMs: options?.delayMs,
    streamDelayMs: options?.streamDelayMs,
    usage: options?.usage,
    finishReason: "stop",
  });
}
