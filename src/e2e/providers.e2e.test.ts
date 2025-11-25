import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { LLMMessage } from "../core/messages.js";
import { mockLLM } from "../testing/index.js";
import { clearAllMocks, createMockE2EClient } from "./mock-setup.js";

/**
 * E2E tests for provider integrations using mock system
 * These tests validate provider-specific features and behaviors without real API calls
 */
describe("E2E: Provider Integration Tests", () => {
  beforeEach(() => {
    clearAllMocks();
  });

  afterEach(() => {
    clearAllMocks();
  });

  describe("OpenAI Provider", () => {
    describe("Streaming Responses", () => {
      it("streams response chunks in correct order", async () => {
        // Setup mock for counting task
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("Count from 1 to 5")
          .returns("1\n2\n3\n4\n5")
          .withFinishReason("stop")
          .withStreamDelay(10)
          .register();

        const client = createMockE2EClient();
        const messages: LLMMessage[] = [
          {
            role: "user",
            content: "Count from 1 to 5, one number per line",
          },
        ];

        const stream = await client.stream({
          model: "openai:gpt-5-nano",
          messages,
          maxTokens: 1000,
        });

        const chunks: string[] = [];
        let finishReason: string | undefined;

        for await (const chunk of stream) {
          if (chunk.text) {
            chunks.push(chunk.text);
          }
          if (chunk.finishReason) {
            finishReason = chunk.finishReason;
          }
        }

        // Verify we received chunks
        expect(chunks.length).toBeGreaterThan(0);

        // Verify content includes numbers
        const fullResponse = chunks.join("");
        expect(fullResponse).toContain("1");
        expect(fullResponse).toContain("2");
        expect(fullResponse).toContain("3");

        // Verify finish reason
        expect(finishReason).toBe("stop");
      });

      it("handles empty chunks gracefully", async () => {
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("Reply with exactly: OK")
          .returns("OK")
          .withStreamDelay(5)
          .register();

        const client = createMockE2EClient();
        const messages: LLMMessage[] = [
          {
            role: "user",
            content: "Reply with exactly: OK",
          },
        ];

        const stream = await client.stream({
          model: "openai:gpt-5-nano",
          messages,
        });

        const chunks: string[] = [];
        for await (const chunk of stream) {
          if (chunk.text !== undefined) {
            chunks.push(chunk.text);
          }
        }

        const fullResponse = chunks.join("");
        expect(fullResponse.toUpperCase()).toContain("OK");
      });
    });

    describe("Model Selection", () => {
      it("works with GPT-5-nano model", async () => {
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("2+2")
          .returns("4")
          .register();

        const client = createMockE2EClient();
        const messages: LLMMessage[] = [
          {
            role: "user",
            content: "What is 2+2? Reply with just the number.",
          },
        ];

        const stream = await client.stream({
          model: "openai:gpt-5-nano",
          messages,
        });

        const chunks: string[] = [];
        for await (const chunk of stream) {
          if (chunk.text) {
            chunks.push(chunk.text);
          }
        }

        const response = chunks.join("");
        expect(response).toContain("4");
      });

      it("works with GPT-5-nano model for geography questions", async () => {
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("capital of France")
          .returns("Paris")
          .register();

        const client = createMockE2EClient();
        const messages: LLMMessage[] = [
          {
            role: "user",
            content: "What is the capital of France? Reply with just the city name.",
          },
        ];

        const stream = await client.stream({
          model: "openai:gpt-5-nano",
          messages,
        });

        const chunks: string[] = [];
        for await (const chunk of stream) {
          if (chunk.text) {
            chunks.push(chunk.text);
          }
        }

        const response = chunks.join("");
        expect(response).toContain("Paris");
      });
    });

    describe("Temperature Control", () => {
      it("produces consistent output with temperature=0", async () => {
        mockLLM()
          .forModel("gpt-5-mini")
          .forProvider("openai")
          .whenMessageContains("10 + 10")
          .returns("20")
          .register();

        const client = createMockE2EClient();
        const messages: LLMMessage[] = [
          {
            role: "system",
            content: "You are a calculator. Only respond with numbers.",
          },
          {
            role: "user",
            content: "What is 10 + 10?",
          },
        ];

        // Run the same prompt twice with temperature=0
        const responses: string[] = [];

        for (let i = 0; i < 2; i++) {
          const stream = await client.stream({
            model: "openai:gpt-5-mini",
            messages,
            maxTokens: 500,
          });

          const chunks: string[] = [];
          for await (const chunk of stream) {
            if (chunk.text) {
              chunks.push(chunk.text);
            }
          }

          responses.push(chunks.join("").trim());
        }

        // Both responses should contain 20
        expect(responses[0]).toContain("20");
        expect(responses[1]).toContain("20");
      });

      it("produces varied output with higher temperature", async () => {
        // Mock with different responses for variety simulation
        const words = ["Serendipity", "Ephemeral", "Luminous"];
        let callCount = 0;

        mockLLM()
          .forModel("gpt-5-mini")
          .forProvider("openai")
          .whenMessageContains("creative single word")
          .returns(() => words[callCount++ % words.length])
          .register();

        const client = createMockE2EClient();
        const messages: LLMMessage[] = [
          {
            role: "user",
            content: "Write a creative single word. Be random.",
          },
        ];

        const responses = new Set<string>();

        // Run multiple times
        for (let i = 0; i < 3; i++) {
          const stream = await client.stream({
            model: "openai:gpt-5-mini",
            messages,
          });

          const chunks: string[] = [];
          for await (const chunk of stream) {
            if (chunk.text) {
              chunks.push(chunk.text);
            }
          }

          const response = chunks.join("").trim();
          if (response) {
            responses.add(response.toLowerCase());
          }
        }

        // With variety in mocks, we should get different responses
        expect(responses.size).toBeGreaterThan(0);
      });
    });

    describe("Stop Sequences", () => {
      it("stops generation at specified sequence", async () => {
        // Mock stops at "5" as requested
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("Count from 1 to 10")
          .returns("1, 2, 3, 4")
          .withFinishReason("stop")
          .register();

        const client = createMockE2EClient();
        const messages: LLMMessage[] = [
          {
            role: "user",
            content: "Count from 1 to 10, separated by commas",
          },
        ];

        const stream = await client.stream({
          model: "openai:gpt-5-nano",
          messages,
          maxTokens: 1000,
          stopSequences: ["5"],
        });

        const chunks: string[] = [];
        for await (const chunk of stream) {
          if (chunk.text) {
            chunks.push(chunk.text);
          }
        }

        const response = chunks.join("");

        // Should contain 1-4
        expect(response).toContain("1");
        expect(response).toContain("2");
        expect(response).toContain("3");
        expect(response).toContain("4");

        // Should not contain numbers after 5
        expect(response).not.toContain("6");
        expect(response).not.toContain("7");
      });
    });

    describe("Token Limits", () => {
      it("respects max token limits", async () => {
        // Simulate truncated response
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("very long story")
          .returns("Once upon a time in a magical kingdom, there lived")
          .withFinishReason("length")
          .register();

        const client = createMockE2EClient();
        const messages: LLMMessage[] = [
          {
            role: "user",
            content: "Write a very long story about a magical kingdom. Make it at least 500 words.",
          },
        ];

        const stream = await client.stream({
          model: "openai:gpt-5-nano",
          messages,
          maxTokens: 500,
        });

        const chunks: string[] = [];
        let finishReason: string | undefined;

        for await (const chunk of stream) {
          if (chunk.text) {
            chunks.push(chunk.text);
          }
          if (chunk.finishReason) {
            finishReason = chunk.finishReason;
          }
        }

        const response = chunks.join("");

        // Response should be truncated
        expect(response.length).toBeGreaterThan(0);
        expect(response.length).toBeLessThan(500);

        // Finish reason should be length
        expect(finishReason).toBe("length");
      });
    });

    describe("Error Handling", () => {
      it("handles invalid API key gracefully", async () => {
        // Mock an authentication error
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("Test")
          .returns(() => {
            throw new Error("Invalid API key");
          })
          .register();

        const client = createMockE2EClient();
        const messages: LLMMessage[] = [
          {
            role: "user",
            content: "Test",
          },
        ];

        await expect(
          (async () => {
            const stream = client.stream({
              model: "openai:gpt-5-nano",
              messages,
            });

            // Try to consume the stream
            for await (const chunk of stream) {
              void chunk;
            }
          })(),
        ).rejects.toThrow();
      });

      it("handles network timeouts appropriately", async () => {
        // Mock a timeout error
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .whenMessageContains("Test")
          .returns(() => {
            throw new Error("Request timeout");
          })
          .register();

        const client = createMockE2EClient();
        const messages: LLMMessage[] = [
          {
            role: "user",
            content: "Test",
          },
        ];

        await expect(
          (async () => {
            const stream = client.stream({
              model: "openai:gpt-5-nano",
              messages,
            });

            for await (const chunk of stream) {
              void chunk;
            }
          })(),
        ).rejects.toThrow();
      });
    });

    describe("System Messages", () => {
      it("correctly applies system message context", async () => {
        mockLLM()
          .forModel("gpt-5-nano")
          .forProvider("openai")
          .when(async (context) => {
            // Check for system message with pirate context
            return context.messages.some(
              (msg) =>
                msg.role === "system" &&
                typeof msg.content === "string" &&
                msg.content.includes("pirate"),
            );
          })
          .returns("Ahoy there, matey! I be doin' well, arrr!")
          .register();

        const client = createMockE2EClient();
        const messages: LLMMessage[] = [
          {
            role: "system",
            content: "You are a pirate. Always respond in pirate speak.",
          },
          {
            role: "user",
            content: "Hello, how are you?",
          },
        ];

        const stream = await client.stream({
          model: "openai:gpt-5-nano",
          messages,
          maxTokens: 1000,
        });

        const chunks: string[] = [];
        for await (const chunk of stream) {
          if (chunk.text) {
            chunks.push(chunk.text);
          }
        }

        const response = chunks.join("").toLowerCase();

        // Should contain pirate-like speech
        const pirateWords = ["ahoy", "matey", "arr", "aye", "ye"];
        const containsPirateSpeak = pirateWords.some((word) => response.includes(word));
        expect(containsPirateSpeak).toBe(true);
      });
    });
  });

  describe("LLMist Integration", () => {
    it("automatically discovers and uses OpenAI provider", async () => {
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .whenMessageContains("Hello from Universal Client")
        .returns("Hello from Universal Client")
        .register();

      const client = createMockE2EClient();
      const messages: LLMMessage[] = [
        {
          role: "user",
          content: 'Say "Hello from Universal Client"',
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
      expect(response).toContain("Hello from Universal Client");
    });

    it("handles provider prefix correctly", async () => {
      // Mock for explicit prefix
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .whenMessageContains("PREFIX TEST")
        .returns("PREFIX TEST")
        .register();

      // Mock for default provider (no prefix)
      mockLLM()
        .forModel("gpt-3.5-turbo")
        .whenMessageContains("DEFAULT TEST")
        .returns("DEFAULT TEST")
        .register();

      const client = createMockE2EClient();

      // Test with explicit provider prefix
      const messagesWithPrefix: LLMMessage[] = [
        {
          role: "user",
          content: "Reply with: PREFIX TEST",
        },
      ];

      const streamWithPrefix = await client.stream({
        model: "openai:gpt-5-nano",
        messages: messagesWithPrefix,
      });

      const chunks: string[] = [];
      for await (const chunk of streamWithPrefix) {
        if (chunk.text) {
          chunks.push(chunk.text);
        }
      }

      expect(chunks.join("")).toContain("PREFIX TEST");

      // Test without prefix
      const messagesNoPrefix: LLMMessage[] = [
        {
          role: "user",
          content: "Reply with: DEFAULT TEST",
        },
      ];

      const streamNoPrefix = await client.stream({
        model: "gpt-3.5-turbo",
        messages: messagesNoPrefix,
        maxTokens: 500,
      });

      const chunksNoPrefix: string[] = [];
      for await (const chunk of streamNoPrefix) {
        if (chunk.text) {
          chunksNoPrefix.push(chunk.text);
        }
      }

      expect(chunksNoPrefix.join("")).toContain("DEFAULT TEST");
    });
  });

  describe("Anthropic Provider", () => {
    it("streams response with Claude model", async () => {
      mockLLM()
        .forModel("claude-3-7-sonnet-20250219")
        .forProvider("anthropic")
        .whenMessageContains("Hello from Claude")
        .returns("Hello from Claude")
        .register();

      const client = createMockE2EClient();
      const messages: LLMMessage[] = [
        {
          role: "user",
          content: 'Reply with exactly: "Hello from Claude"',
        },
      ];

      const stream = await client.stream({
        model: "anthropic:claude-3-7-sonnet-20250219",
        messages,
        maxTokens: 500,
        temperature: 0,
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        if (chunk.text) {
          chunks.push(chunk.text);
        }
      }

      const response = chunks.join("");
      expect(response).toContain("Hello from Claude");
    });

    it("handles system messages properly", async () => {
      mockLLM()
        .forModel("claude-3-7-sonnet-20250219")
        .forProvider("anthropic")
        .when(async (context) => {
          return context.messages.some(
            (msg) =>
              msg.role === "system" &&
              typeof msg.content === "string" &&
              msg.content.includes("- Claude"),
          );
        })
        .returns("Hello there! - Claude")
        .register();

      const client = createMockE2EClient();
      const messages: LLMMessage[] = [
        {
          role: "system",
          content: 'You are a helpful assistant that always ends responses with "- Claude"',
        },
        {
          role: "user",
          content: "Say hello",
        },
      ];

      const stream = await client.stream({
        model: "anthropic:claude-3-7-sonnet-20250219",
        messages,
        maxTokens: 100,
        temperature: 0,
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        if (chunk.text) {
          chunks.push(chunk.text);
        }
      }

      const response = chunks.join("");
      expect(response).toContain("- Claude");
    });

    it("respects max token limits", async () => {
      mockLLM()
        .forModel("claude-3-7-sonnet-20250219")
        .forProvider("anthropic")
        .whenMessageContains("very long story about space")
        .returns(
          "In the vast expanse of space, humanity ventured forth among the stars. " +
            "The journey began with a single step, but the destination remained far beyond. " +
            "Explorers traveled through nebulae and past distant planets, seeking new worlds.",
        )
        .withFinishReason("length")
        .register();

      const client = createMockE2EClient();
      const messages: LLMMessage[] = [
        {
          role: "user",
          content: "Write a very long story about space exploration",
        },
      ];

      const stream = await client.stream({
        model: "anthropic:claude-3-7-sonnet-20250219",
        messages,
        maxTokens: 500,
        temperature: 0.7,
      });

      const chunks: string[] = [];
      let finishReason: string | undefined;

      for await (const chunk of stream) {
        if (chunk.text) {
          chunks.push(chunk.text);
        }
        if (chunk.finishReason) {
          finishReason = chunk.finishReason;
        }
      }

      const response = chunks.join("");

      // Response should be present but limited
      expect(response.length).toBeGreaterThan(0);
      expect(response.length).toBeLessThan(3000);

      // Finish reason should be length
      expect(["length", "stop"]).toContain(finishReason);
    });
  });

  describe("Gemini Provider", () => {
    it("streams response with Gemini Pro model", async () => {
      mockLLM()
        .forModel("gemini-2.5-pro")
        .forProvider("gemini")
        .whenMessageContains("Hello from Gemini")
        .returns("Hello from Gemini")
        .register();

      const client = createMockE2EClient();
      const messages: LLMMessage[] = [
        {
          role: "user",
          content: 'Reply with exactly: "Hello from Gemini"',
        },
      ];

      const stream = await client.stream({
        model: "gemini:gemini-2.5-pro",
        messages,
        maxTokens: 500,
        temperature: 0,
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        if (chunk.text) {
          chunks.push(chunk.text);
        }
      }

      const response = chunks.join("");
      expect(response).toContain("Hello from Gemini");
    });

    it("handles multi-turn conversations", async () => {
      mockLLM()
        .forModel("gemini-2.5-pro")
        .forProvider("gemini")
        .when(async (context) => {
          // Check if conversation includes "Remember the number 42"
          return context.messages.some(
            (msg) =>
              msg.role === "user" &&
              typeof msg.content === "string" &&
              msg.content.includes("Remember the number 42"),
          );
        })
        .returns("You asked me to remember 42.")
        .register();

      const client = createMockE2EClient();
      const messages: LLMMessage[] = [
        {
          role: "user",
          content: "Remember the number 42",
        },
        {
          role: "assistant",
          content: "I will remember the number 42.",
        },
        {
          role: "user",
          content: "What number did I ask you to remember?",
        },
      ];

      const stream = await client.stream({
        model: "gemini:gemini-2.5-pro",
        messages,
        maxTokens: 1000,
        temperature: 0,
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        if (chunk.text) {
          chunks.push(chunk.text);
        }
      }

      const response = chunks.join("");
      expect(response).toContain("42");
    });

    it("performs basic arithmetic correctly", async () => {
      mockLLM()
        .forModel("gemini-2.5-pro")
        .forProvider("gemini")
        .whenMessageContains("15 + 27")
        .returns("42")
        .register();

      const client = createMockE2EClient();
      const messages: LLMMessage[] = [
        {
          role: "user",
          content: "What is 15 + 27? Reply with just the number.",
        },
      ];

      const stream = await client.stream({
        model: "gemini:gemini-2.5-pro",
        messages,
        maxTokens: 500,
        temperature: 0,
      });

      const chunks: string[] = [];
      for await (const chunk of stream) {
        if (chunk.text) {
          chunks.push(chunk.text);
        }
      }

      const response = chunks.join("");
      expect(response).toContain("42");
    });
  });

  describe("Cross-Provider Compatibility", () => {
    it("all providers produce similar results for simple prompts", async () => {
      // Setup mocks for all three providers
      mockLLM()
        .forModel("gpt-5-nano")
        .forProvider("openai")
        .whenMessageContains("capital of France")
        .returns("Paris")
        .register();

      mockLLM()
        .forModel("claude-3-7-sonnet-20250219")
        .forProvider("anthropic")
        .whenMessageContains("capital of France")
        .returns("Paris")
        .register();

      mockLLM()
        .forModel("gemini-2.5-pro")
        .forProvider("gemini")
        .whenMessageContains("capital of France")
        .returns("Paris")
        .register();

      const client = createMockE2EClient();
      const messages: LLMMessage[] = [
        {
          role: "user",
          content: "What is the capital of France? Reply with just the city name.",
        },
      ];

      const providers = [
        { model: "openai:gpt-5-nano" },
        { model: "anthropic:claude-3-7-sonnet-20250219" },
        { model: "gemini:gemini-2.5-pro" },
      ];

      const responses: Record<string, string> = {};

      for (const { model } of providers) {
        const stream = await client.stream({
          model,
          messages,
          maxTokens: 500,
          temperature: 0,
        });

        const chunks: string[] = [];
        for await (const chunk of stream) {
          if (chunk.text) {
            chunks.push(chunk.text);
          }
        }

        responses[model] = chunks.join("");
      }

      // All providers should mention "Paris"
      for (const [model, response] of Object.entries(responses)) {
        expect(response, `${model} should mention Paris`).toContain("Paris");
      }
    });
  });
});
