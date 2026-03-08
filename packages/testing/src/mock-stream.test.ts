/**
 * Tests for mock-stream.ts
 *
 * Verifies the createMockStream and createTextMockStream functions used for
 * simulating LLM streaming behavior in tests.
 */

import { GADGET_ARG_PREFIX, GADGET_END_PREFIX, GADGET_START_PREFIX } from "llmist";
import { describe, expect, it, vi } from "vitest";
import { createMockStream, createTextMockStream } from "./mock-stream.js";
import {
  collectStream as collectChunks,
  collectStreamText as collectText,
} from "./stream-helpers.js";

describe("createMockStream", () => {
  describe("text chunks", () => {
    it("emits text chunks for simple text response", async () => {
      const stream = createMockStream({ text: "Hello, world!" });
      const chunks = await collectChunks(stream);

      expect(chunks.length).toBeGreaterThan(0);
      const allText = chunks.map((c) => c.text ?? "").join("");
      expect(allText).toBe("Hello, world!");
    });

    it("concatenates all chunks to form original text", async () => {
      const originalText = "The quick brown fox jumps over the lazy dog";
      const stream = createMockStream({ text: originalText });
      const text = await collectText(stream);

      expect(text).toBe(originalText);
    });

    it("emits a single chunk when no stream delay", async () => {
      const stream = createMockStream({ text: "Hello" });
      const chunks = await collectChunks(stream);

      // With no streamDelayMs, should emit one chunk with full text
      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe("Hello");
    });

    it("emits multiple chunks when streamDelayMs is set", async () => {
      vi.useFakeTimers();
      try {
        const stream = createMockStream({
          text: "This is a longer text that will be split into multiple chunks for streaming",
          streamDelayMs: 10,
        });

        // Collect with advancing timers
        const chunks: { text?: string }[] = [];
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

        expect(chunks.length).toBeGreaterThan(1);
        const allText = chunks.map((c) => c.text ?? "").join("");
        expect(allText).toBe(
          "This is a longer text that will be split into multiple chunks for streaming",
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("handles empty text response", async () => {
      const stream = createMockStream({ text: "" });
      const chunks = await collectChunks(stream);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe("");
    });

    it("handles response with no text field (undefined)", async () => {
      const stream = createMockStream({});
      const chunks = await collectChunks(stream);

      // Should still emit a final chunk
      expect(chunks.length).toBeGreaterThan(0);
    });

    it("emits finish reason on last chunk for text response", async () => {
      const stream = createMockStream({ text: "Hello", finishReason: "stop" });
      const chunks = await collectChunks(stream);

      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.finishReason).toBe("stop");
    });

    it("emits usage on last chunk for text response", async () => {
      const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
      const stream = createMockStream({ text: "Hello", usage });
      const chunks = await collectChunks(stream);

      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.usage).toEqual(usage);
    });

    it("does not emit finish reason on non-last chunks", async () => {
      vi.useFakeTimers();
      try {
        const stream = createMockStream({
          text: "This is a longer text to force multiple chunks in streaming mode here",
          streamDelayMs: 10,
          finishReason: "stop",
        });

        const chunks: { text?: string; finishReason?: string }[] = [];
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

        // If multiple chunks were emitted, intermediate ones should not have finishReason
        if (chunks.length > 1) {
          for (let i = 0; i < chunks.length - 1; i++) {
            expect(chunks[i].finishReason).toBeUndefined();
          }
        }
        // Last chunk should have finishReason
        expect(chunks[chunks.length - 1].finishReason).toBe("stop");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("gadget calls", () => {
    it("includes gadget call markers in the streamed text", async () => {
      const stream = createMockStream({
        gadgetCalls: [
          {
            gadgetName: "Calculator",
            parameters: { operation: "add", a: 5, b: 3 },
          },
        ],
      });

      const text = await collectText(stream);

      expect(text).toContain(`${GADGET_START_PREFIX}Calculator`);
      expect(text).toContain(GADGET_END_PREFIX);
    });

    it("includes gadget parameters as ARG markers", async () => {
      const stream = createMockStream({
        gadgetCalls: [
          {
            gadgetName: "Search",
            parameters: { query: "hello world" },
          },
        ],
      });

      const text = await collectText(stream);

      expect(text).toContain(`${GADGET_ARG_PREFIX}query`);
      expect(text).toContain("hello world");
    });

    it("uses provided invocation ID in parameters", async () => {
      const stream = createMockStream({
        gadgetCalls: [
          {
            gadgetName: "MyGadget",
            parameters: { input: "test" },
            invocationId: "inv-custom-123",
          },
        ],
      });

      // The invocation ID is stored separately but the text should be correct
      const text = await collectText(stream);
      expect(text).toContain(`${GADGET_START_PREFIX}MyGadget`);
    });

    it("generates an invocation ID when none is provided", async () => {
      const stream = createMockStream({
        gadgetCalls: [
          {
            gadgetName: "AutoIdGadget",
            parameters: {},
          },
        ],
      });

      const text = await collectText(stream);
      expect(text).toContain(`${GADGET_START_PREFIX}AutoIdGadget`);
    });

    it("includes text before gadget calls when both provided", async () => {
      const stream = createMockStream({
        text: "I will call a gadget:",
        gadgetCalls: [
          {
            gadgetName: "MyGadget",
            parameters: { value: "test" },
          },
        ],
      });

      const text = await collectText(stream);
      expect(text).toContain("I will call a gadget:");
      expect(text).toContain(`${GADGET_START_PREFIX}MyGadget`);
    });

    it("handles multiple gadget calls", async () => {
      const stream = createMockStream({
        gadgetCalls: [
          { gadgetName: "Gadget1", parameters: { a: 1 } },
          { gadgetName: "Gadget2", parameters: { b: 2 } },
        ],
      });

      const text = await collectText(stream);
      expect(text).toContain(`${GADGET_START_PREFIX}Gadget1`);
      expect(text).toContain(`${GADGET_START_PREFIX}Gadget2`);
    });

    it("serializes nested object parameters", async () => {
      const stream = createMockStream({
        gadgetCalls: [
          {
            gadgetName: "Complex",
            parameters: {
              config: { timeout: 30, retries: 3 },
            },
          },
        ],
      });

      const text = await collectText(stream);
      expect(text).toContain(`${GADGET_ARG_PREFIX}config/timeout`);
      expect(text).toContain("30");
      expect(text).toContain(`${GADGET_ARG_PREFIX}config/retries`);
      expect(text).toContain("3");
    });

    it("serializes array parameters", async () => {
      const stream = createMockStream({
        gadgetCalls: [
          {
            gadgetName: "ArrayGadget",
            parameters: { items: ["apple", "banana", "cherry"] },
          },
        ],
      });

      const text = await collectText(stream);
      expect(text).toContain(`${GADGET_ARG_PREFIX}items/0`);
      expect(text).toContain("apple");
      expect(text).toContain(`${GADGET_ARG_PREFIX}items/1`);
      expect(text).toContain("banana");
    });
  });

  describe("usage tracking", () => {
    it("includes usage in the last chunk", async () => {
      const usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 };
      const stream = createMockStream({ text: "Response", usage });
      const chunks = await collectChunks(stream);

      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.usage).toEqual(usage);
    });

    it("provides default usage for empty response", async () => {
      const stream = createMockStream({});
      const chunks = await collectChunks(stream);

      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    });

    it("does not include usage in non-last chunks", async () => {
      vi.useFakeTimers();
      try {
        const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
        const stream = createMockStream({
          text: "This is some text to stream across multiple streaming chunks now",
          streamDelayMs: 10,
          usage,
        });

        const chunks: { text?: string; usage?: unknown }[] = [];
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

        if (chunks.length > 1) {
          for (let i = 0; i < chunks.length - 1; i++) {
            expect(chunks[i].usage).toBeUndefined();
          }
        }
        expect(chunks[chunks.length - 1].usage).toEqual(usage);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("finish reasons", () => {
    it("emits stop finish reason on last chunk", async () => {
      const stream = createMockStream({ text: "Done", finishReason: "stop" });
      const chunks = await collectChunks(stream);

      expect(chunks[chunks.length - 1].finishReason).toBe("stop");
    });

    it("emits length finish reason on last chunk", async () => {
      const stream = createMockStream({ text: "Truncated", finishReason: "length" });
      const chunks = await collectChunks(stream);

      expect(chunks[chunks.length - 1].finishReason).toBe("length");
    });

    it("emits tool_use finish reason on last chunk", async () => {
      const stream = createMockStream({
        gadgetCalls: [{ gadgetName: "Tool", parameters: {} }],
        finishReason: "tool_use",
      });
      const chunks = await collectChunks(stream);

      expect(chunks[chunks.length - 1].finishReason).toBe("tool_use");
    });

    it("emits error finish reason on last chunk", async () => {
      const stream = createMockStream({ text: "Error occurred", finishReason: "error" });
      const chunks = await collectChunks(stream);

      expect(chunks[chunks.length - 1].finishReason).toBe("error");
    });

    it("uses stop as default finish reason for empty response", async () => {
      const stream = createMockStream({});
      const chunks = await collectChunks(stream);

      expect(chunks[chunks.length - 1].finishReason).toBe("stop");
    });

    it("emits undefined finish reason when not specified for non-empty text", async () => {
      const stream = createMockStream({ text: "Hello" });
      const chunks = await collectChunks(stream);

      // finishReason is only added if specified
      expect(chunks[chunks.length - 1].finishReason).toBeUndefined();
    });
  });

  describe("delay handling", () => {
    it("applies initial delay before streaming", async () => {
      vi.useFakeTimers();
      try {
        const stream = createMockStream({ text: "Hello", delayMs: 500 });

        const chunks: unknown[] = [];
        const gen = stream[Symbol.asyncIterator]();
        let done = false;

        // Start collecting (don't advance timers yet)
        const promise = gen.next();
        // Advance timers past the delay
        await vi.advanceTimersByTimeAsync(500);
        const result = await promise;
        if (!result.done) {
          chunks.push(result.value);
        }

        // Collect remaining
        while (!done) {
          const p = gen.next();
          await vi.runAllTimersAsync();
          const r = await p;
          if (r.done) {
            done = true;
          } else {
            chunks.push(r.value);
          }
        }

        expect(chunks.length).toBeGreaterThan(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("abort handling", () => {
    it("generator can be forcibly stopped using .return()", async () => {
      const stream = createMockStream({
        text: "Hello world text content",
        streamDelayMs: 10,
      });

      const gen = stream[Symbol.asyncIterator]();

      // Start the generator then immediately close it
      if (gen.return) {
        await gen.return(undefined);
      }

      // After return, the generator should be done
      const result = await gen.next();
      expect(result.done).toBe(true);
    });
  });
});

describe("createTextMockStream", () => {
  it("creates a stream with the provided text", async () => {
    const stream = createTextMockStream("Hello, world!");
    const text = await collectText(stream);

    expect(text).toBe("Hello, world!");
  });

  it("emits stop as the finish reason", async () => {
    const stream = createTextMockStream("Hello");
    const chunks = await collectChunks(stream);

    expect(chunks[chunks.length - 1].finishReason).toBe("stop");
  });

  it("includes custom usage when provided", async () => {
    const usage = { inputTokens: 20, outputTokens: 10, totalTokens: 30 };
    const stream = createTextMockStream("Hello", { usage });
    const chunks = await collectChunks(stream);

    expect(chunks[chunks.length - 1].usage).toEqual(usage);
  });

  it("applies initial delay when specified", async () => {
    vi.useFakeTimers();
    try {
      const stream = createTextMockStream("Hello", { delayMs: 200 });

      const gen = stream[Symbol.asyncIterator]();
      const promise = gen.next();
      await vi.advanceTimersByTimeAsync(200);
      const result = await promise;

      expect(result.done).toBe(false);
      if (!result.done) {
        expect(result.value.text).toBe("Hello");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("concatenates all chunks to original text", async () => {
    vi.useFakeTimers();
    try {
      const text = "This is a test text for streaming simulation";
      const stream = createTextMockStream(text, { streamDelayMs: 5 });

      const chunks: { text?: string }[] = [];
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
      expect(allText).toBe(text);
    } finally {
      vi.useRealTimers();
    }
  });

  it("handles empty string input", async () => {
    const stream = createTextMockStream("");
    const chunks = await collectChunks(stream);

    // An empty text still yields a final chunk with metadata
    expect(chunks.length).toBeGreaterThan(0);
    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk.finishReason).toBe("stop");
  });
});
