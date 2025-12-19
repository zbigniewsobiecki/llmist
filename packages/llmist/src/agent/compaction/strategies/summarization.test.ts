import { beforeEach, describe, expect, it } from "bun:test";
import type { LLMMessage } from "../../../core/messages.js";
import { createMockClient, MockManager, mockLLM } from "../../../../../testing/src/index.js";
import type { ResolvedCompactionConfig } from "../config.js";
import type { CompactionContext } from "../strategy.js";
import { SummarizationStrategy } from "./summarization.js";

describe("SummarizationStrategy", () => {
  const strategy = new SummarizationStrategy();

  const createConfig = (
    overrides?: Partial<ResolvedCompactionConfig>,
  ): ResolvedCompactionConfig => ({
    enabled: true,
    strategy: "summarization",
    triggerThresholdPercent: 80,
    targetPercent: 50,
    preserveRecentTurns: 2,
    summarizationPrompt: "Please summarize:",
    ...overrides,
  });

  const createConversation = (turnCount: number): LLMMessage[] => {
    const messages: LLMMessage[] = [];
    for (let i = 0; i < turnCount; i++) {
      messages.push({ role: "user", content: `User message ${i + 1}` });
      messages.push({ role: "assistant", content: `Assistant response ${i + 1}` });
    }
    return messages;
  };

  beforeEach(() => {
    MockManager.reset();
  });

  describe("name", () => {
    it("should have correct strategy name", () => {
      expect(strategy.name).toBe("summarization");
    });
  });

  describe("compact", () => {
    it("should return unchanged messages when below preserve count", async () => {
      const messages = createConversation(2); // 2 turns
      const config = createConfig({ preserveRecentTurns: 5 }); // preserve 5
      const client = createMockClient();
      const context: CompactionContext = {
        currentTokens: 1000,
        targetTokens: 500,
        modelLimits: { contextWindow: 2000, maxOutputTokens: 1000 },
        client,
        model: "mock:test",
      };

      const result = await strategy.compact(messages, config, context);

      expect(result.messages).toHaveLength(messages.length);
      expect(result.strategyName).toBe("summarization");
      expect(result.summary).toBeUndefined();
    });

    it("should call LLM to summarize older turns", async () => {
      mockLLM().forAnyModel().returns("This is a summary of the conversation.").register();

      const messages = createConversation(5); // 5 turns
      const config = createConfig({ preserveRecentTurns: 2 }); // keep 2, summarize 3
      const client = createMockClient();
      const context: CompactionContext = {
        currentTokens: 1000,
        targetTokens: 500,
        modelLimits: { contextWindow: 2000, maxOutputTokens: 1000 },
        client,
        model: "mock:test",
      };

      const result = await strategy.compact(messages, config, context);

      // Should have summary message + 2 turns (4 messages) = 5 messages
      expect(result.messages).toHaveLength(5);
      expect(result.summary).toBe("This is a summary of the conversation.");
    });

    it("should preserve recent turns verbatim", async () => {
      mockLLM().forAnyModel().returns("Summary here").register();

      const messages = createConversation(4);
      const config = createConfig({ preserveRecentTurns: 2 });
      const client = createMockClient();
      const context: CompactionContext = {
        currentTokens: 1000,
        targetTokens: 500,
        modelLimits: { contextWindow: 2000, maxOutputTokens: 1000 },
        client,
        model: "mock:test",
      };

      const result = await strategy.compact(messages, config, context);

      // Last 4 messages should be preserved (2 turns)
      const preservedMessages = result.messages.slice(1);
      expect(preservedMessages[0].content).toBe("User message 3");
      expect(preservedMessages[1].content).toBe("Assistant response 3");
      expect(preservedMessages[2].content).toBe("User message 4");
      expect(preservedMessages[3].content).toBe("Assistant response 4");
    });

    it("should format summary message correctly", async () => {
      mockLLM().forAnyModel().returns("Important summary content").register();

      const messages = createConversation(4);
      const config = createConfig({ preserveRecentTurns: 2 });
      const client = createMockClient();
      const context: CompactionContext = {
        currentTokens: 1000,
        targetTokens: 500,
        modelLimits: { contextWindow: 2000, maxOutputTokens: 1000 },
        client,
        model: "mock:test",
      };

      const result = await strategy.compact(messages, config, context);

      expect(result.messages[0].role).toBe("user");
      expect(result.messages[0].content).toContain("Previous conversation summary");
      expect(result.messages[0].content).toContain("Important summary content");
      expect(result.messages[0].content).toContain("End of summary");
    });

    it("should use custom summarization model when specified", async () => {
      let usedModel: string | undefined;
      mockLLM()
        .forModel("custom-summarizer")
        .withResponse((ctx) => {
          usedModel = ctx.modelName;
          return { text: "Summary" };
        })
        .register();

      const messages = createConversation(5);
      const config = createConfig({
        preserveRecentTurns: 2,
        summarizationModel: "mock:custom-summarizer",
      });
      const client = createMockClient();
      const context: CompactionContext = {
        currentTokens: 1000,
        targetTokens: 500,
        modelLimits: { contextWindow: 2000, maxOutputTokens: 1000 },
        client,
        model: "mock:default",
      };

      await strategy.compact(messages, config, context);

      expect(usedModel).toBe("custom-summarizer");
    });

    it("should use agent model when summarizationModel not specified", async () => {
      let usedModel: string | undefined;
      mockLLM()
        .forAnyModel()
        .withResponse((ctx) => {
          usedModel = ctx.modelName;
          return { text: "Summary" };
        })
        .register();

      const messages = createConversation(5);
      const config = createConfig({
        preserveRecentTurns: 2,
        summarizationModel: undefined,
      });
      const client = createMockClient();
      const context: CompactionContext = {
        currentTokens: 1000,
        targetTokens: 500,
        modelLimits: { contextWindow: 2000, maxOutputTokens: 1000 },
        client,
        model: "mock:agent-model",
      };

      await strategy.compact(messages, config, context);

      expect(usedModel).toBe("agent-model");
    });

    it("should include summary in result", async () => {
      mockLLM().forAnyModel().returns("Detailed conversation summary").register();

      const messages = createConversation(4);
      const config = createConfig({ preserveRecentTurns: 2 });
      const client = createMockClient();
      const context: CompactionContext = {
        currentTokens: 1000,
        targetTokens: 500,
        modelLimits: { contextWindow: 2000, maxOutputTokens: 1000 },
        client,
        model: "mock:test",
      };

      const result = await strategy.compact(messages, config, context);

      expect(result.summary).toBe("Detailed conversation summary");
    });

    it("should calculate metadata correctly", async () => {
      mockLLM().forAnyModel().returns("Summary").register();

      const messages = createConversation(6); // 12 messages
      const config = createConfig({ preserveRecentTurns: 2 });
      const client = createMockClient();
      const context: CompactionContext = {
        currentTokens: 1000,
        targetTokens: 500,
        modelLimits: { contextWindow: 2000, maxOutputTokens: 1000 },
        client,
        model: "mock:test",
      };

      const result = await strategy.compact(messages, config, context);

      expect(result.metadata.originalCount).toBe(12);
      // summary (1) + 2 turns (4 messages) = 5
      expect(result.metadata.compactedCount).toBe(5);
      expect(result.metadata.tokensBefore).toBe(1000);
      expect(result.metadata.tokensAfter).toBeGreaterThan(0);
    });

    it("should include summarization prompt in LLM call", async () => {
      let capturedPrompt = "";
      mockLLM()
        .forAnyModel()
        .withResponse((ctx) => {
          // The prompt is in the messages
          capturedPrompt = ctx.messages.map((m) => m.content).join("");
          return { text: "Summary" };
        })
        .register();

      const messages = createConversation(4);
      const config = createConfig({
        preserveRecentTurns: 2,
        summarizationPrompt: "Custom summarization prompt:",
      });
      const client = createMockClient();
      const context: CompactionContext = {
        currentTokens: 1000,
        targetTokens: 500,
        modelLimits: { contextWindow: 2000, maxOutputTokens: 1000 },
        client,
        model: "mock:test",
      };

      await strategy.compact(messages, config, context);

      expect(capturedPrompt).toContain("Custom summarization prompt:");
    });
  });
});
