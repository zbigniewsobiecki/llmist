/**
 * Tests for stream-helpers.ts
 *
 * Verifies the stream creation and consumption helpers used for testing
 * LLM streaming behavior.
 */

import type { LLMStreamChunk } from "llmist";
import { describe, expect, it, vi } from "vitest";
import {
  collectStream,
  collectStreamText,
  createEmptyStream,
  createErrorStream,
  createTestStream,
  createTextStream,
  getStreamFinalChunk,
} from "./stream-helpers.js";

describe("createTestStream", () => {
  it("yields chunks in order", async () => {
    const chunks: LLMStreamChunk[] = [
      { text: "Hello " },
      { text: "world" },
      { text: "!", finishReason: "stop" },
    ];

    const stream = createTestStream(chunks);
    const collected = await collectStream(stream);

    expect(collected).toHaveLength(3);
    expect(collected[0].text).toBe("Hello ");
    expect(collected[1].text).toBe("world");
    expect(collected[2].text).toBe("!");
    expect(collected[2].finishReason).toBe("stop");
  });

  it("creates an empty stream when given an empty array", async () => {
    const stream = createTestStream([]);
    const collected = await collectStream(stream);

    expect(collected).toHaveLength(0);
  });

  it("preserves all chunk properties", async () => {
    const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
    const chunks: LLMStreamChunk[] = [{ text: "Response", finishReason: "stop", usage }];

    const stream = createTestStream(chunks);
    const collected = await collectStream(stream);

    expect(collected[0].text).toBe("Response");
    expect(collected[0].finishReason).toBe("stop");
    expect(collected[0].usage).toEqual(usage);
  });

  it("can be iterated multiple times independently (each call creates new stream)", async () => {
    const chunks: LLMStreamChunk[] = [{ text: "Hello" }, { text: " world" }];

    const stream1 = createTestStream(chunks);
    const stream2 = createTestStream(chunks);

    const collected1 = await collectStream(stream1);
    const collected2 = await collectStream(stream2);

    expect(collected1).toHaveLength(2);
    expect(collected2).toHaveLength(2);
  });
});

describe("createTextStream", () => {
  it("creates a stream with the full text as one chunk by default", async () => {
    const stream = createTextStream("Hello, world!");
    const collected = await collectStream(stream);

    expect(collected).toHaveLength(1);
    expect(collected[0].text).toBe("Hello, world!");
  });

  it("splits text into specified chunk sizes", async () => {
    const stream = createTextStream("Hello, world!", { chunkSize: 5 });
    const collected = await collectStream(stream);

    // "Hello" ", wor" "ld!"
    expect(collected.length).toBeGreaterThan(1);
    const allText = collected.map((c) => c.text ?? "").join("");
    expect(allText).toBe("Hello, world!");
  });

  it("adds finishReason 'stop' to the last chunk by default", async () => {
    const stream = createTextStream("Hello");
    const collected = await collectStream(stream);

    expect(collected[collected.length - 1].finishReason).toBe("stop");
  });

  it("uses custom finish reason when provided", async () => {
    const stream = createTextStream("Hello", { finishReason: "length" });
    const collected = await collectStream(stream);

    expect(collected[collected.length - 1].finishReason).toBe("length");
  });

  it("adds usage to the last chunk", async () => {
    const stream = createTextStream("Hello");
    const collected = await collectStream(stream);

    const lastChunk = collected[collected.length - 1];
    expect(lastChunk.usage).toBeDefined();
    expect(lastChunk.usage?.inputTokens).toBeGreaterThan(0);
    expect(lastChunk.usage?.outputTokens).toBeGreaterThan(0);
    expect(lastChunk.usage?.totalTokens).toBeGreaterThan(0);
  });

  it("uses custom usage when provided", async () => {
    const customUsage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 };
    const stream = createTextStream("Hello", { usage: customUsage });
    const collected = await collectStream(stream);

    expect(collected[collected.length - 1].usage).toEqual(customUsage);
  });

  it("does not add finishReason or usage to intermediate chunks", async () => {
    const stream = createTextStream("Hello, world!", { chunkSize: 5 });
    const collected = await collectStream(stream);

    if (collected.length > 1) {
      for (let i = 0; i < collected.length - 1; i++) {
        expect(collected[i].finishReason).toBeUndefined();
        expect(collected[i].usage).toBeUndefined();
      }
    }
  });

  it("applies initial delay before streaming", async () => {
    vi.useFakeTimers();
    try {
      const stream = createTextStream("Hello", { delayMs: 100 });

      const gen = stream[Symbol.asyncIterator]();
      const promise = gen.next();
      // Advance time past the delay
      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;

      expect(result.done).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies chunk delay between chunks", async () => {
    vi.useFakeTimers();
    try {
      const stream = createTextStream("Hello, world!", { chunkSize: 5, chunkDelayMs: 50 });

      const chunks: LLMStreamChunk[] = [];
      const gen = stream[Symbol.asyncIterator]();
      let done = false;
      while (!done) {
        const promise = gen.next();
        await vi.runAllTimersAsync();
        const result = await promise;
        if (result.done) {
          done = true;
        } else {
          chunks.push(result.value);
        }
      }

      const allText = chunks.map((c) => c.text ?? "").join("");
      expect(allText).toBe("Hello, world!");
    } finally {
      vi.useRealTimers();
    }
  });

  it("handles empty string", async () => {
    const stream = createTextStream("");
    const collected = await collectStream(stream);

    // createTextStream with empty string yields no chunks (the for loop runs 0 times)
    expect(collected).toHaveLength(0);
  });

  it("totalTokens equals inputTokens + outputTokens in auto-computed usage", async () => {
    const stream = createTextStream("This is some test content to compute tokens for");
    const collected = await collectStream(stream);

    const lastChunk = collected[collected.length - 1];
    expect(lastChunk.usage?.totalTokens).toBe(
      (lastChunk.usage?.inputTokens ?? 0) + (lastChunk.usage?.outputTokens ?? 0),
    );
  });
});

describe("collectStream", () => {
  it("collects all chunks from a stream into an array", async () => {
    const chunks: LLMStreamChunk[] = [
      { text: "Hello " },
      { text: "world" },
      { text: "!", finishReason: "stop" },
    ];
    const stream = createTestStream(chunks);

    const result = await collectStream(stream);

    expect(result).toHaveLength(3);
    expect(result).toEqual(chunks);
  });

  it("returns empty array for empty stream", async () => {
    const stream = createEmptyStream();

    const result = await collectStream(stream);

    expect(result).toEqual([]);
  });

  it("propagates errors from stream", async () => {
    const error = new Error("Stream error");
    const stream = createErrorStream([], error);

    await expect(collectStream(stream)).rejects.toThrow("Stream error");
  });

  it("collects chunks before error when error stream has prior chunks", async () => {
    const error = new Error("Mid-stream error");
    const priorChunks: LLMStreamChunk[] = [{ text: "Before error" }];
    const stream = createErrorStream(priorChunks, error);

    await expect(collectStream(stream)).rejects.toThrow("Mid-stream error");
  });
});

describe("collectStreamText", () => {
  it("collects and concatenates all text from a stream", async () => {
    const stream = createTestStream([{ text: "Hello " }, { text: "world" }, { text: "!" }]);

    const text = await collectStreamText(stream);

    expect(text).toBe("Hello world!");
  });

  it("returns empty string for empty stream", async () => {
    const stream = createEmptyStream();

    const text = await collectStreamText(stream);

    expect(text).toBe("");
  });

  it("handles chunks with undefined text", async () => {
    const chunks: LLMStreamChunk[] = [
      { text: "Hello" },
      { finishReason: "stop", usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } },
    ];
    const stream = createTestStream(chunks);

    const text = await collectStreamText(stream);

    expect(text).toBe("Hello");
  });

  it("propagates errors from stream", async () => {
    const error = new Error("Text collection error");
    const stream = createErrorStream([{ text: "Partial " }], error);

    await expect(collectStreamText(stream)).rejects.toThrow("Text collection error");
  });

  it("returns full text for createTextStream", async () => {
    const stream = createTextStream("The quick brown fox");

    const text = await collectStreamText(stream);

    expect(text).toBe("The quick brown fox");
  });
});

describe("getStreamFinalChunk", () => {
  it("returns the last chunk from a stream", async () => {
    const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
    const chunks: LLMStreamChunk[] = [
      { text: "Hello " },
      { text: "world", finishReason: "stop", usage },
    ];
    const stream = createTestStream(chunks);

    const finalChunk = await getStreamFinalChunk(stream);

    expect(finalChunk?.text).toBe("world");
    expect(finalChunk?.finishReason).toBe("stop");
    expect(finalChunk?.usage).toEqual(usage);
  });

  it("returns undefined for empty stream", async () => {
    const stream = createEmptyStream();

    const finalChunk = await getStreamFinalChunk(stream);

    expect(finalChunk).toBeUndefined();
  });

  it("returns the single chunk for single-chunk stream", async () => {
    const stream = createTestStream([{ text: "Only chunk", finishReason: "stop" }]);

    const finalChunk = await getStreamFinalChunk(stream);

    expect(finalChunk?.text).toBe("Only chunk");
    expect(finalChunk?.finishReason).toBe("stop");
  });
});

describe("createEmptyStream", () => {
  it("yields no chunks", async () => {
    const stream = createEmptyStream();
    const collected = await collectStream(stream);

    expect(collected).toHaveLength(0);
  });

  it("completes immediately without error", async () => {
    const stream = createEmptyStream();

    await expect(collectStream(stream)).resolves.toEqual([]);
  });
});

describe("createErrorStream", () => {
  it("throws the provided error", async () => {
    const error = new Error("Test error");
    const stream = createErrorStream([], error);

    await expect(collectStream(stream)).rejects.toThrow("Test error");
  });

  it("yields provided chunks before throwing", async () => {
    const error = new Error("After chunks");
    const priorChunks: LLMStreamChunk[] = [{ text: "Chunk 1" }, { text: "Chunk 2" }];
    const stream = createErrorStream(priorChunks, error);

    const collected: LLMStreamChunk[] = [];
    let caughtError: Error | undefined;

    try {
      for await (const chunk of stream) {
        collected.push(chunk);
      }
    } catch (e) {
      caughtError = e as Error;
    }

    expect(collected).toHaveLength(2);
    expect(collected[0].text).toBe("Chunk 1");
    expect(collected[1].text).toBe("Chunk 2");
    expect(caughtError?.message).toBe("After chunks");
  });

  it("can propagate custom error types", async () => {
    class CustomError extends Error {
      constructor(
        message: string,
        public readonly code: number,
      ) {
        super(message);
        this.name = "CustomError";
      }
    }

    const error = new CustomError("Custom failure", 500);
    const stream = createErrorStream([], error);

    let caughtError: unknown;
    try {
      await collectStream(stream);
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(CustomError);
    expect((caughtError as CustomError).code).toBe(500);
  });

  it("yields no chunks before error when passed empty array", async () => {
    const error = new Error("Immediate error");
    const stream = createErrorStream([], error);

    const collected: LLMStreamChunk[] = [];
    let threwError = false;

    try {
      for await (const chunk of stream) {
        collected.push(chunk);
      }
    } catch {
      threwError = true;
    }

    expect(collected).toHaveLength(0);
    expect(threwError).toBe(true);
  });
});

describe("timeout handling", () => {
  it("createTextStream with chunkDelayMs accumulates delays between chunks", async () => {
    vi.useFakeTimers();
    try {
      // chunkSize=5 for "Hello, world!" = multiple chunks
      const stream = createTextStream("Hello, world!", { chunkSize: 5, chunkDelayMs: 100 });

      const chunks: LLMStreamChunk[] = [];
      const gen = stream[Symbol.asyncIterator]();
      let done = false;

      while (!done) {
        const promise = gen.next();
        // Advance timers to get past chunk delay
        await vi.advanceTimersByTimeAsync(200);
        const result = await promise;
        if (result.done) {
          done = true;
        } else {
          chunks.push(result.value);
        }
      }

      expect(chunks.length).toBeGreaterThan(0);
      const allText = chunks.map((c) => c.text ?? "").join("");
      expect(allText).toBe("Hello, world!");
    } finally {
      vi.useRealTimers();
    }
  });

  it("generator can be aborted mid-stream by breaking out of the loop", async () => {
    const chunks: LLMStreamChunk[] = [
      { text: "Chunk 1" },
      { text: "Chunk 2" },
      { text: "Chunk 3" },
      { text: "Chunk 4" },
      { text: "Chunk 5", finishReason: "stop" },
    ];
    const stream = createTestStream(chunks);

    const collected: LLMStreamChunk[] = [];
    for await (const chunk of stream) {
      collected.push(chunk);
      if (collected.length === 2) {
        break;
      }
    }

    expect(collected).toHaveLength(2);
    expect(collected[0].text).toBe("Chunk 1");
    expect(collected[1].text).toBe("Chunk 2");
  });
});

describe("error propagation", () => {
  it("errors from createErrorStream bubble up through collectStreamText", async () => {
    const error = new Error("Bubble up error");
    const stream = createErrorStream([{ text: "partial" }], error);

    await expect(collectStreamText(stream)).rejects.toThrow("Bubble up error");
  });

  it("errors from createErrorStream bubble up through getStreamFinalChunk", async () => {
    const error = new Error("Final chunk error");
    const stream = createErrorStream([], error);

    await expect(getStreamFinalChunk(stream)).rejects.toThrow("Final chunk error");
  });

  it("errors from createErrorStream bubble up through collectStream", async () => {
    const error = new TypeError("Type error in stream");
    const stream = createErrorStream([{ text: "before" }], error);

    await expect(collectStream(stream)).rejects.toThrow("Type error in stream");
  });
});
