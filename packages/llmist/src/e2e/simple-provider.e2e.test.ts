import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LLMist } from "../core/client.js";
import type { LLMMessage } from "../core/messages.js";
import { createMockClient, getMockManager, mockLLM } from "../../../testing/src/index.js";

/**
 * Simple E2E tests for the specified models using mock responses
 * These tests validate model selection and basic response handling without real API calls
 */
describe("E2E: Simple Provider Tests", () => {
  beforeEach(() => {
    // Clear any previous mocks
    getMockManager().clear();
  });

  afterEach(() => {
    // Clean up mocks after each test
    getMockManager().clear();
  });

  describe("Model Availability Tests", () => {
    it("can call gpt-5-nano model", async () => {
      // Setup mock for gpt-5-nano
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .returns("Hello! I'm GPT-5-nano responding to your greeting.")
        .register();

      const client = createMockClient();

      const messages: LLMMessage[] = [
        {
          role: "user",
          content: "Say hello",
        },
      ];

      const stream = await client.stream({
        model: "openai:gpt-5-nano",
        messages,
        temperature: 0,
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        if (chunk.text) {
          chunks.push(chunk.text);
        }
      }

      const response = chunks.join("");
      console.log("GPT-5-nano response:", response);

      // Verify we got some response
      expect(response.length).toBeGreaterThan(0);
      expect(response).toContain("GPT-5-nano");
    }, 30000);

    it("can call claude-3-7-sonnet-20250219 model", async () => {
      // Setup mock for Claude
      mockLLM()
        .forModel("claude-3-7-sonnet-20250219")
        .forProvider("anthropic")
        .returns("Hello! I'm Claude, pleased to meet you.")
        .register();

      const client = createMockClient();

      const messages: LLMMessage[] = [
        {
          role: "user",
          content: "Say hello",
        },
      ];

      const stream = await client.stream({
        model: "anthropic:claude-3-7-sonnet-20250219",
        messages,
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        if (chunk.text) {
          chunks.push(chunk.text);
        }
      }

      const response = chunks.join("");
      console.log("Claude-3-7-sonnet response:", response);

      // Verify we got some response
      expect(response.length).toBeGreaterThan(0);
      expect(response).toContain("Claude");
    }, 30000);

    it("can call gemini-2.5-pro model", async () => {
      // Setup mock for Gemini
      mockLLM()
        .forModel("gemini-2.5-pro")
        .forProvider("gemini")
        .returns("Hello! This is Gemini 2.5 Pro.")
        .register();

      const client = createMockClient();

      const messages: LLMMessage[] = [
        {
          role: "user",
          content: "Say hello",
        },
      ];

      const stream = await client.stream({
        model: "gemini:gemini-2.5-pro",
        messages,
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        if (chunk.text) {
          chunks.push(chunk.text);
        }
      }

      const response = chunks.join("");
      console.log("Gemini-2.5-pro response:", response);

      // Verify we got some response
      expect(response.length).toBeGreaterThan(0);
      expect(response).toContain("Gemini");
    }, 30000);

    it("all three models respond to simple prompts", async () => {
      // Setup mocks for all three models
      mockLLM().forModel("gpt-5-nano").forProvider("openai").returns("Success").register();

      mockLLM()
        .forModel("claude-3-7-sonnet-20250219")
        .forProvider("anthropic")
        .returns("Acknowledged")
        .register();

      mockLLM().forModel("gemini-2.5-pro").forProvider("gemini").returns("Confirmed").register();

      const client = createMockClient();

      const messages: LLMMessage[] = [
        {
          role: "user",
          content: "Reply with one word only",
        },
      ];

      const models = [
        { model: "openai:gpt-5-nano", expectedWord: "Success" },
        { model: "anthropic:claude-3-7-sonnet-20250219", expectedWord: "Acknowledged" },
        { model: "gemini:gemini-2.5-pro", expectedWord: "Confirmed" },
      ];

      for (const { model, expectedWord } of models) {
        console.log(`Testing ${model}...`);

        const stream = await client.stream({
          model,
          messages,
          temperature: 0,
        });

        const chunks: string[] = [];
        for await (const chunk of stream) {
          if (chunk.text) {
            chunks.push(chunk.text);
          }
        }

        const response = chunks.join("").trim();
        console.log(`${model} response: "${response}"`);

        // Verify we got the expected response
        expect(response).toContain(expectedWord);
        expect(response.length).toBeGreaterThan(0);
        expect(response.length).toBeLessThanOrEqual(100); // Should be short
      }
    }, 60000);
  });
});
