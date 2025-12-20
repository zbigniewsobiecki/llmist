import { describe, expect, it, vi } from "vitest";

import type { LLMist } from "./client.js";
import { complete, type QuickOptions, stream } from "./quick-methods.js";

/**
 * Create a mock LLMist client with stream method.
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

describe("Quick Methods", () => {
  describe("complete", () => {
    it("returns complete text response", async () => {
      const client = createMockClient([{ text: "The answer is " }, { text: "42" }]);

      const result = await complete(client, "What is the answer?");

      expect(result).toBe("The answer is 42");
    });

    it("trims whitespace from response", async () => {
      const client = createMockClient([{ text: "  " }, { text: "Hello" }, { text: "  " }]);

      const result = await complete(client, "Say hello");

      expect(result).toBe("Hello");
    });

    it("uses default model when not specified", async () => {
      const client = createMockClient([{ text: "response" }]);

      await complete(client, "test");

      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "openai:gpt-5-nano",
        }),
      );
    });

    it("uses specified model", async () => {
      const client = createMockClient([{ text: "response" }]);

      await complete(client, "test", { model: "sonnet" });

      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "anthropic:claude-sonnet-4-5",
        }),
      );
    });

    it("resolves model aliases", async () => {
      const client = createMockClient([{ text: "response" }]);

      await complete(client, "test", { model: "gpt4" });

      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "openai:gpt-4o",
        }),
      );
    });

    it("includes system prompt when provided", async () => {
      const client = createMockClient([{ text: "response" }]);

      await complete(client, "test", {
        systemPrompt: "You are a helpful assistant",
      });

      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "system",
              content: "You are a helpful assistant",
            }),
          ]),
        }),
      );
    });

    it("includes user prompt in messages", async () => {
      const client = createMockClient([{ text: "response" }]);

      await complete(client, "What is 2+2?");

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

    it("passes temperature option", async () => {
      const client = createMockClient([{ text: "response" }]);

      await complete(client, "test", { temperature: 0.7 });

      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
        }),
      );
    });

    it("passes maxTokens option", async () => {
      const client = createMockClient([{ text: "response" }]);

      await complete(client, "test", { maxTokens: 500 });

      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          maxTokens: 500,
        }),
      );
    });

    it("handles empty response", async () => {
      const client = createMockClient([]);

      const result = await complete(client, "test");

      expect(result).toBe("");
    });

    it("handles single chunk response", async () => {
      const client = createMockClient([{ text: "Hello" }]);

      const result = await complete(client, "test");

      expect(result).toBe("Hello");
    });

    it("handles many chunks", async () => {
      const chunks = Array(100)
        .fill(null)
        .map((_, i) => ({ text: `${i}` }));
      const client = createMockClient(chunks);

      const result = await complete(client, "test");

      expect(result).toBe(
        Array(100)
          .fill(null)
          .map((_, i) => `${i}`)
          .join(""),
      );
    });

    it("preserves special characters", async () => {
      const client = createMockClient([
        { text: "Special: " },
        { text: "!@#$%^&*()" },
        { text: " \\n \\t" },
      ]);

      const result = await complete(client, "test");

      expect(result).toBe("Special: !@#$%^&*() \\n \\t");
    });

    it("handles multiline responses", async () => {
      const client = createMockClient([
        { text: "Line 1\n" },
        { text: "Line 2\n" },
        { text: "Line 3" },
      ]);

      const result = await complete(client, "test");

      expect(result).toBe("Line 1\nLine 2\nLine 3");
    });

    it("combines all options", async () => {
      const client = createMockClient([{ text: "response" }]);

      const options: QuickOptions = {
        model: "sonnet",
        temperature: 0.5,
        systemPrompt: "Be helpful",
        maxTokens: 1000,
      };

      await complete(client, "test", options);

      expect(client.stream).toHaveBeenCalledWith({
        model: "anthropic:claude-sonnet-4-5",
        messages: [
          { role: "system", content: "Be helpful" },
          { role: "user", content: "test" },
        ],
        temperature: 0.5,
        maxTokens: 1000,
      });
    });
  });

  describe("stream", () => {
    it("yields text chunks", async () => {
      const client = createMockClient([{ text: "Hello" }, { text: " " }, { text: "World" }]);

      const chunks: string[] = [];
      for await (const chunk of stream(client, "test")) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(["Hello", " ", "World"]);
    });

    it("uses default model when not specified", async () => {
      const client = createMockClient([{ text: "test" }]);

      const generator = stream(client, "test");
      // Consume the generator
      for await (const _ of generator) {
        // do nothing
      }

      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "openai:gpt-5-nano",
        }),
      );
    });

    it("uses specified model", async () => {
      const client = createMockClient([{ text: "test" }]);

      const generator = stream(client, "test", { model: "flash" });
      for await (const _ of generator) {
        // consume
      }

      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gemini:gemini-2.5-flash",
        }),
      );
    });

    it("resolves model aliases", async () => {
      const client = createMockClient([{ text: "test" }]);

      const generator = stream(client, "test", { model: "haiku" });
      for await (const _ of generator) {
        // consume
      }

      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "anthropic:claude-haiku-4-5",
        }),
      );
    });

    it("includes system prompt when provided", async () => {
      const client = createMockClient([{ text: "test" }]);

      const generator = stream(client, "test", {
        systemPrompt: "You are creative",
      });
      for await (const _ of generator) {
        // consume
      }

      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "system",
              content: "You are creative",
            }),
          ]),
        }),
      );
    });

    it("includes user prompt in messages", async () => {
      const client = createMockClient([{ text: "test" }]);

      const generator = stream(client, "Tell me a story");
      for await (const _ of generator) {
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

    it("passes temperature option", async () => {
      const client = createMockClient([{ text: "test" }]);

      const generator = stream(client, "test", { temperature: 0.9 });
      for await (const _ of generator) {
        // consume
      }

      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.9,
        }),
      );
    });

    it("passes maxTokens option", async () => {
      const client = createMockClient([{ text: "test" }]);

      const generator = stream(client, "test", { maxTokens: 2000 });
      for await (const _ of generator) {
        // consume
      }

      expect(client.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          maxTokens: 2000,
        }),
      );
    });

    it("handles empty stream", async () => {
      const client = createMockClient([]);

      const chunks: string[] = [];
      for await (const chunk of stream(client, "test")) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([]);
    });

    it("handles single chunk", async () => {
      const client = createMockClient([{ text: "Single" }]);

      const chunks: string[] = [];
      for await (const chunk of stream(client, "test")) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(["Single"]);
    });

    it("handles many chunks", async () => {
      const manyChunks = Array(100)
        .fill(null)
        .map((_, i) => ({ text: `Chunk${i}` }));
      const client = createMockClient(manyChunks);

      const chunks: string[] = [];
      for await (const chunk of stream(client, "test")) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(100);
      expect(chunks[0]).toBe("Chunk0");
      expect(chunks[99]).toBe("Chunk99");
    });

    it("preserves empty strings in chunks", async () => {
      const client = createMockClient([{ text: "Hello" }, { text: "" }, { text: "World" }]);

      const chunks: string[] = [];
      for await (const chunk of stream(client, "test")) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(["Hello", "", "World"]);
    });

    it("does not trim individual chunks", async () => {
      const client = createMockClient([{ text: "  " }, { text: "Hello" }, { text: "  " }]);

      const chunks: string[] = [];
      for await (const chunk of stream(client, "test")) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(["  ", "Hello", "  "]);
    });

    it("preserves special characters in chunks", async () => {
      const client = createMockClient([{ text: "\\n" }, { text: "\\t" }, { text: "!@#" }]);

      const chunks: string[] = [];
      for await (const chunk of stream(client, "test")) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(["\\n", "\\t", "!@#"]);
    });

    it("can be partially consumed", async () => {
      const client = createMockClient([
        { text: "1" },
        { text: "2" },
        { text: "3" },
        { text: "4" },
        { text: "5" },
      ]);

      const chunks: string[] = [];
      let count = 0;
      for await (const chunk of stream(client, "test")) {
        chunks.push(chunk);
        count++;
        if (count === 3) break;
      }

      expect(chunks).toEqual(["1", "2", "3"]);
    });

    it("combines all options", async () => {
      const client = createMockClient([{ text: "test" }]);

      const options: QuickOptions = {
        model: "gpt4",
        temperature: 0.8,
        systemPrompt: "Be creative",
        maxTokens: 500,
      };

      const generator = stream(client, "prompt", options);
      for await (const _ of generator) {
        // consume
      }

      expect(client.stream).toHaveBeenCalledWith({
        model: "openai:gpt-4o",
        messages: [
          { role: "system", content: "Be creative" },
          { role: "user", content: "prompt" },
        ],
        temperature: 0.8,
        maxTokens: 500,
      });
    });
  });

  describe("integration", () => {
    it("complete and stream produce same text", async () => {
      const chunks = [{ text: "The " }, { text: "quick " }, { text: "brown " }, { text: "fox" }];

      const client1 = createMockClient(chunks);
      const completeResult = await complete(client1, "test");

      const client2 = createMockClient(chunks);
      let streamResult = "";
      for await (const chunk of stream(client2, "test")) {
        streamResult += chunk;
      }

      expect(completeResult).toBe(streamResult.trim());
    });

    it("both methods respect model aliases", async () => {
      const client1 = createMockClient([{ text: "test" }]);
      await complete(client1, "test", { model: "sonnet" });

      const client2 = createMockClient([{ text: "test" }]);
      const generator = stream(client2, "test", { model: "sonnet" });
      for await (const _ of generator) {
        // consume
      }

      expect(client1.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "anthropic:claude-sonnet-4-5",
        }),
      );
      expect(client2.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "anthropic:claude-sonnet-4-5",
        }),
      );
    });
  });
});
