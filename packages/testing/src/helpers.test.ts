import type { LLMStreamChunk } from "llmist";
import { describe, expect, test } from "vitest";
import { createGadgetStream, createMockStream, MathGadget } from "./helpers.js";

describe("helpers", () => {
  describe("createMockStream", () => {
    test("yields text chunks and a final stop chunk", async () => {
      const chunks = ["Hello, ", "world", "!"];
      const stream = createMockStream(chunks);

      const results: LLMStreamChunk[] = [];
      for await (const chunk of stream) {
        results.push(chunk);
      }

      // Should yield one chunk per text item plus a final stop chunk
      expect(results).toHaveLength(chunks.length + 1);

      // First N chunks are the text chunks
      expect(results[0]).toEqual({ text: "Hello, " });
      expect(results[1]).toEqual({ text: "world" });
      expect(results[2]).toEqual({ text: "!" });

      // Final chunk is the stop chunk
      const lastChunk = results[results.length - 1];
      expect(lastChunk.text).toBe("");
      expect(lastChunk.finishReason).toBe("stop");
    });

    test("yields only the stop chunk for empty chunks array", async () => {
      const stream = createMockStream([]);

      const results: LLMStreamChunk[] = [];
      for await (const chunk of stream) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ text: "", finishReason: "stop" });
    });

    test("yields a single text chunk followed by stop chunk for one-element array", async () => {
      const stream = createMockStream(["single"]);

      const results: LLMStreamChunk[] = [];
      for await (const chunk of stream) {
        results.push(chunk);
      }

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ text: "single" });
      expect(results[1]).toEqual({ text: "", finishReason: "stop" });
    });
  });

  describe("createGadgetStream", () => {
    test("passes through raw LLMStreamChunks unchanged", async () => {
      const inputChunks: LLMStreamChunk[] = [
        { text: "before gadget" },
        { text: "!!!GADGET_START:TestGadget:123\n" },
        { text: "!!!GADGET_END:TestGadget:123" },
        { text: "after gadget", finishReason: "stop" },
      ];

      const stream = createGadgetStream(inputChunks);

      const results: LLMStreamChunk[] = [];
      for await (const chunk of stream) {
        results.push(chunk);
      }

      expect(results).toHaveLength(inputChunks.length);
      expect(results[0]).toEqual({ text: "before gadget" });
      expect(results[1]).toEqual({ text: "!!!GADGET_START:TestGadget:123\n" });
      expect(results[2]).toEqual({ text: "!!!GADGET_END:TestGadget:123" });
      expect(results[3]).toEqual({ text: "after gadget", finishReason: "stop" });
    });

    test("handles chunks with usage metadata passthrough", async () => {
      const inputChunks: LLMStreamChunk[] = [
        { text: "response", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      ];

      const stream = createGadgetStream(inputChunks);

      const results: LLMStreamChunk[] = [];
      for await (const chunk of stream) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        text: "response",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      });
    });

    test("yields nothing for empty chunks array", async () => {
      const stream = createGadgetStream([]);

      const results: LLMStreamChunk[] = [];
      for await (const chunk of stream) {
        results.push(chunk);
      }

      expect(results).toHaveLength(0);
    });
  });

  describe("MathGadget", () => {
    test("performs addition correctly", () => {
      const gadget = new MathGadget();
      const result = gadget.execute({ operation: "add", a: 3, b: 4 });
      expect(result).toBe("7");
    });

    test("performs multiplication correctly", () => {
      const gadget = new MathGadget();
      const result = gadget.execute({ operation: "multiply", a: 6, b: 7 });
      expect(result).toBe("42");
    });

    test("throws an error for unknown operation", () => {
      const gadget = new MathGadget();
      // Cast to bypass TypeScript type check so we can test runtime behavior
      expect(() => gadget.execute({ operation: "divide" as "add", a: 10, b: 2 })).toThrow(
        "Unknown operation: divide",
      );
    });
  });
});
