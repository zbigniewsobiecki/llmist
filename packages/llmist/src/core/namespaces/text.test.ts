/**
 * Tests for TextNamespace
 *
 * Verifies text completion and streaming with various options and error handling.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockClient, getMockManager, mockLLM } from "../../../../testing/src/index.js";

describe("TextNamespace", () => {
  beforeEach(() => {
    getMockManager().clear();
  });

  afterEach(() => {
    getMockManager().clear();
  });

  describe("complete()", () => {
    it("returns basic completion response", async () => {
      mockLLM().whenMessageContains("hello").returns("Hello! How can I help you?").register();

      const client = createMockClient();

      const result = await client.text.complete("hello");

      expect(result).toBe("Hello! How can I help you?");
    });

    it("returns response for a factual question", async () => {
      mockLLM().whenMessageContains("2+2").returns("4").register();

      const client = createMockClient();

      const result = await client.text.complete("What is 2+2?");

      expect(result).toBe("4");
    });

    it("accepts model option", async () => {
      mockLLM().whenMessageContains("test").returns("response with model").register();

      const client = createMockClient();

      const result = await client.text.complete("test", { model: "openai:gpt-4o" });

      expect(result).toBe("response with model");
    });

    it("accepts systemPrompt option", async () => {
      mockLLM().whenMessageContains("what are you").returns("I am a concise assistant.").register();

      const client = createMockClient();

      const result = await client.text.complete("what are you", {
        systemPrompt: "Be concise.",
      });

      expect(result).toBe("I am a concise assistant.");
    });

    it("accepts temperature option", async () => {
      mockLLM().whenMessageContains("creative").returns("A vivid story begins here.").register();

      const client = createMockClient();

      const result = await client.text.complete("Tell me something creative", {
        temperature: 0.9,
      });

      expect(result).toBe("A vivid story begins here.");
    });

    it("accepts maxTokens option", async () => {
      mockLLM().whenMessageContains("brief").returns("Short answer.").register();

      const client = createMockClient();

      const result = await client.text.complete("Give a brief answer", {
        maxTokens: 50,
      });

      expect(result).toBe("Short answer.");
    });

    it("accepts all options together", async () => {
      mockLLM().whenMessageContains("tell me").returns("Sure, here is the answer!").register();

      const client = createMockClient();

      const result = await client.text.complete("tell me something", {
        model: "openai:gpt-4o",
        systemPrompt: "You are helpful.",
        temperature: 0.5,
        maxTokens: 200,
      });

      expect(result).toBe("Sure, here is the answer!");
    });

    it("handles empty prompt", async () => {
      mockLLM().whenMessageContains("").returns("I can help you.").register();

      const client = createMockClient();

      const result = await client.text.complete("");

      expect(typeof result).toBe("string");
    });

    it("trims the response", async () => {
      mockLLM().whenMessageContains("whitespace").returns("  trimmed response  ").register();

      const client = createMockClient();

      const result = await client.text.complete("whitespace test");

      expect(result).toBe("trimmed response");
    });

    it("propagates errors from the mock adapter", async () => {
      mockLLM()
        .whenMessageContains("error trigger")
        .withResponse(() => {
          throw new Error("LLM error occurred");
        })
        .register();

      const client = createMockClient();

      await expect(client.text.complete("error trigger")).rejects.toThrow("LLM error occurred");
    });
  });

  describe("stream()", () => {
    it("yields text chunks as async generator", async () => {
      mockLLM().whenMessageContains("story").returns("Once upon a time...").register();

      const client = createMockClient();

      const chunks: string[] = [];
      for await (const chunk of client.text.stream("Tell me a story")) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.join("")).toContain("Once upon a time");
    });

    it("accumulates chunks into full response", async () => {
      mockLLM().whenMessageContains("accumulate").returns("The quick brown fox").register();

      const client = createMockClient();

      let fullText = "";
      for await (const chunk of client.text.stream("accumulate chunks")) {
        fullText += chunk;
      }

      expect(fullText).toBe("The quick brown fox");
    });

    it("returns an async generator", () => {
      mockLLM().whenMessageContains("generator").returns("response text").register();

      const client = createMockClient();

      const gen = client.text.stream("generator test");

      // Should be an async generator (has Symbol.asyncIterator)
      expect(typeof gen[Symbol.asyncIterator]).toBe("function");
    });

    it("accepts model option", async () => {
      mockLLM().whenMessageContains("stream model").returns("streamed with model").register();

      const client = createMockClient();

      const chunks: string[] = [];
      for await (const chunk of client.text.stream("stream model test", {
        model: "openai:gpt-4o",
      })) {
        chunks.push(chunk);
      }

      expect(chunks.join("")).toContain("streamed with model");
    });

    it("accepts systemPrompt option", async () => {
      mockLLM()
        .whenMessageContains("stream system")
        .returns("System-guided stream response")
        .register();

      const client = createMockClient();

      const chunks: string[] = [];
      for await (const chunk of client.text.stream("stream system test", {
        systemPrompt: "You are a streaming assistant.",
      })) {
        chunks.push(chunk);
      }

      expect(chunks.join("")).toContain("System-guided stream response");
    });

    it("accepts temperature option", async () => {
      mockLLM().whenMessageContains("stream temp").returns("Creative streamed response").register();

      const client = createMockClient();

      const chunks: string[] = [];
      for await (const chunk of client.text.stream("stream temp test", {
        temperature: 0.8,
      })) {
        chunks.push(chunk);
      }

      expect(chunks.join("")).toContain("Creative streamed response");
    });

    it("accepts maxTokens option", async () => {
      mockLLM().whenMessageContains("stream tokens").returns("Brief streamed response").register();

      const client = createMockClient();

      const chunks: string[] = [];
      for await (const chunk of client.text.stream("stream tokens test", {
        maxTokens: 100,
      })) {
        chunks.push(chunk);
      }

      expect(chunks.join("")).toContain("Brief streamed response");
    });

    it("accepts all options together", async () => {
      mockLLM()
        .whenMessageContains("all stream options")
        .returns("Full options stream response")
        .register();

      const client = createMockClient();

      const chunks: string[] = [];
      for await (const chunk of client.text.stream("all stream options test", {
        model: "openai:gpt-4o",
        systemPrompt: "Be helpful.",
        temperature: 0.5,
        maxTokens: 300,
      })) {
        chunks.push(chunk);
      }

      expect(chunks.join("")).toContain("Full options stream response");
    });

    it("can be partially consumed (early break)", async () => {
      mockLLM()
        .whenMessageContains("partial stream")
        .returns("Chunk one chunk two chunk three")
        .register();

      const client = createMockClient();

      const chunks: string[] = [];
      for await (const chunk of client.text.stream("partial stream test")) {
        chunks.push(chunk);
        break; // stop after first chunk
      }

      expect(chunks.length).toBe(1);
    });

    it("yields no chunks for empty response", async () => {
      mockLLM().whenMessageContains("empty response").returns("").register();

      const client = createMockClient();

      const chunks: string[] = [];
      for await (const chunk of client.text.stream("empty response test")) {
        chunks.push(chunk);
      }

      // Empty string response should produce no or empty chunks
      const fullText = chunks.join("");
      expect(fullText).toBe("");
    });
  });
});
