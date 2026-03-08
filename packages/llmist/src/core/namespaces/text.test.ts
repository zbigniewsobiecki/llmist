/**
 * Tests for TextNamespace
 *
 * Verifies text generation delegation to quick-methods (complete/stream).
 */

import { describe, expect, it, vi } from "vitest";
import type { LLMist } from "../client.js";
import { TextNamespace } from "./text.js";

/**
 * Creates a mock LLMist client for testing.
 * The stream method is spied on so we can verify delegation calls.
 */
function createMockClient(chunks: Array<{ text: string }>): LLMist {
  async function* mockStream() {
    for (const chunk of chunks) {
      yield chunk;
    }
  }

  return {
    stream: vi.fn(mockStream),
  } as unknown as LLMist;
}

describe("TextNamespace", () => {
  describe("complete()", () => {
    it("delegates to client's stream method for completion", async () => {
      const client = createMockClient([{ text: "The answer is 42" }]);
      const namespace = new TextNamespace(client);

      const result = await namespace.complete("What is the answer?");

      expect(client.stream).toHaveBeenCalledTimes(1);
      expect(result).toBe("The answer is 42");
    });

    it("passes prompt through to the underlying complete call", async () => {
      const client = createMockClient([{ text: "response" }]);
      const namespace = new TextNamespace(client);

      await namespace.complete("What is 2+2?");

      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "user",
              content: "What is 2+2?",
            }),
          ]),
        }),
      );
    });

    it("passes options to the underlying complete call", async () => {
      const client = createMockClient([{ text: "response" }]);
      const namespace = new TextNamespace(client);

      await namespace.complete("test", {
        model: "gpt4",
        temperature: 0.7,
        maxTokens: 500,
        systemPrompt: "Be concise",
      });

      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "openai:gpt-4o",
          temperature: 0.7,
          maxTokens: 500,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system", content: "Be concise" }),
            expect.objectContaining({ role: "user", content: "test" }),
          ]),
        }),
      );
    });

    it("uses default model when no options provided", async () => {
      const client = createMockClient([{ text: "response" }]);
      const namespace = new TextNamespace(client);

      await namespace.complete("test");

      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "openai:gpt-5-nano",
        }),
      );
    });

    it("accepts short model string descriptor", async () => {
      const client = createMockClient([{ text: "response" }]);
      const namespace = new TextNamespace(client);

      await namespace.complete("test", { model: "sonnet" });

      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "anthropic:claude-sonnet-4-5",
        }),
      );
    });

    it("trims whitespace from response", async () => {
      const client = createMockClient([{ text: "  Hello  " }]);
      const namespace = new TextNamespace(client);

      const result = await namespace.complete("say hello");

      expect(result).toBe("Hello");
    });

    it("returns empty string when stream yields no chunks", async () => {
      const client = createMockClient([]);
      const namespace = new TextNamespace(client);

      const result = await namespace.complete("test");

      expect(result).toBe("");
    });

    it("concatenates multiple chunks into a single response", async () => {
      const client = createMockClient([
        { text: "The " },
        { text: "quick " },
        { text: "brown " },
        { text: "fox" },
      ]);
      const namespace = new TextNamespace(client);

      const result = await namespace.complete("tell me about a fox");

      expect(result).toBe("The quick brown fox");
    });
  });

  describe("stream()", () => {
    it("delegates to client's stream method for streaming", async () => {
      const client = createMockClient([{ text: "Hello" }, { text: " World" }]);
      const namespace = new TextNamespace(client);

      const chunks: string[] = [];
      for await (const chunk of namespace.stream("test")) {
        chunks.push(chunk);
      }

      expect(client.stream).toHaveBeenCalledTimes(1);
      expect(chunks).toEqual(["Hello", " World"]);
    });

    it("passes prompt through to the underlying stream call", async () => {
      const client = createMockClient([{ text: "chunk" }]);
      const namespace = new TextNamespace(client);

      for await (const _ of namespace.stream("Tell me a story")) {
        // consume
      }

      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "user",
              content: "Tell me a story",
            }),
          ]),
        }),
      );
    });

    it("passes options to the underlying stream call", async () => {
      const client = createMockClient([{ text: "chunk" }]);
      const namespace = new TextNamespace(client);

      for await (const _ of namespace.stream("test", {
        model: "flash",
        temperature: 0.9,
        maxTokens: 1000,
        systemPrompt: "Be creative",
      })) {
        // consume
      }

      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gemini:gemini-2.5-flash",
          temperature: 0.9,
          maxTokens: 1000,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system", content: "Be creative" }),
            expect.objectContaining({ role: "user", content: "test" }),
          ]),
        }),
      );
    });

    it("uses default model when no options provided", async () => {
      const client = createMockClient([{ text: "chunk" }]);
      const namespace = new TextNamespace(client);

      for await (const _ of namespace.stream("test")) {
        // consume
      }

      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "openai:gpt-5-nano",
        }),
      );
    });

    it("accepts short model string descriptor", async () => {
      const client = createMockClient([{ text: "chunk" }]);
      const namespace = new TextNamespace(client);

      for await (const _ of namespace.stream("test", { model: "haiku" })) {
        // consume
      }

      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "anthropic:claude-haiku-4-5",
        }),
      );
    });

    it("yields each chunk individually", async () => {
      const client = createMockClient([{ text: "chunk1" }, { text: "chunk2" }, { text: "chunk3" }]);
      const namespace = new TextNamespace(client);

      const chunks: string[] = [];
      for await (const chunk of namespace.stream("test")) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(["chunk1", "chunk2", "chunk3"]);
    });

    it("returns empty generator when stream yields no chunks", async () => {
      const client = createMockClient([]);
      const namespace = new TextNamespace(client);

      const chunks: string[] = [];
      for await (const chunk of namespace.stream("test")) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([]);
    });
  });
});
