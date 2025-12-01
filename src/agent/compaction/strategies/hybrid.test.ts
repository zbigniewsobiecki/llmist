import { beforeEach, describe, expect, it } from "bun:test";
import type { LLMMessage } from "../../../core/messages.js";
import { createMockClient, MockManager, mockLLM } from "../../../testing/index.js";
import type { ResolvedCompactionConfig } from "../config.js";
import type { CompactionContext } from "../strategy.js";
import { HybridStrategy } from "./hybrid.js";

describe("HybridStrategy", () => {
  const strategy = new HybridStrategy();

  const createConfig = (overrides?: Partial<ResolvedCompactionConfig>): ResolvedCompactionConfig => ({
    enabled: true,
    strategy: "hybrid",
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

  const createContext = (client = createMockClient()): CompactionContext => ({
    currentTokens: 1000,
    targetTokens: 500,
    modelLimits: { contextWindow: 2000, maxOutputTokens: 1000 },
    client,
    model: "mock:test",
  });

  beforeEach(() => {
    MockManager.reset();
  });

  describe("name", () => {
    it("should have correct strategy name", () => {
      expect(strategy.name).toBe("hybrid");
    });
  });

  describe("compact", () => {
    it("should return unchanged messages when below preserve count", async () => {
      const messages = createConversation(2); // 2 turns
      const config = createConfig({ preserveRecentTurns: 5 }); // preserve 5
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      expect(result.messages).toHaveLength(messages.length);
      expect(result.strategyName).toBe("hybrid");
    });

    it("should fall back to sliding-window when < 3 turns to summarize", async () => {
      // With 4 turns and preserving 2, we'd summarize 2 turns - below MIN_TURNS_FOR_SUMMARIZATION (3)
      const messages = createConversation(4); // 4 turns total
      const config = createConfig({ preserveRecentTurns: 2 }); // keep 2, would summarize 2
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      // Should use sliding-window strategy
      expect(result.strategyName).toBe("sliding-window");
      // Should contain truncation marker
      expect(result.messages[0].content).toContain("truncated");
    });

    it("should fall back to sliding-window with exactly 2 turns to summarize", async () => {
      const messages = createConversation(5); // 5 turns
      const config = createConfig({ preserveRecentTurns: 3 }); // keep 3, would summarize 2
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      expect(result.strategyName).toBe("sliding-window");
    });

    it("should use summarization when >= 3 turns to summarize", async () => {
      mockLLM().forAnyModel().returns("Summary of conversation").register();

      const messages = createConversation(5); // 5 turns
      const config = createConfig({ preserveRecentTurns: 2 }); // keep 2, summarize 3
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      expect(result.strategyName).toBe("summarization");
      expect(result.summary).toBeDefined();
    });

    it("should use summarization with exactly 3 turns to summarize", async () => {
      mockLLM().forAnyModel().returns("Summary").register();

      const messages = createConversation(6); // 6 turns
      const config = createConfig({ preserveRecentTurns: 3 }); // keep 3, summarize 3
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      expect(result.strategyName).toBe("summarization");
    });

    it("should propagate correct strategyName when using sliding-window", async () => {
      const messages = createConversation(4);
      const config = createConfig({ preserveRecentTurns: 2 });
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      // The strategyName should indicate which strategy was actually used
      expect(result.strategyName).toBe("sliding-window");
      expect(result.strategyName).not.toBe("hybrid");
    });

    it("should propagate correct strategyName when using summarization", async () => {
      mockLLM().forAnyModel().returns("Summary").register();

      const messages = createConversation(6);
      const config = createConfig({ preserveRecentTurns: 2 });
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      expect(result.strategyName).toBe("summarization");
      expect(result.strategyName).not.toBe("hybrid");
    });

    it("should handle edge case with many turns", async () => {
      mockLLM().forAnyModel().returns("Comprehensive summary").register();

      const messages = createConversation(20); // 20 turns
      const config = createConfig({ preserveRecentTurns: 5 }); // keep 5, summarize 15
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      expect(result.strategyName).toBe("summarization");
      // Should have summary + 5 turns (10 messages) = 11 messages
      expect(result.messages).toHaveLength(11);
    });

    it("should preserve recent turns regardless of which strategy is used", async () => {
      mockLLM().forAnyModel().returns("Summary").register();

      const messages = createConversation(6);
      const config = createConfig({ preserveRecentTurns: 2 });
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      // Last 4 messages should be the recent turns
      const lastFour = result.messages.slice(-4);
      expect(lastFour[0].content).toBe("User message 5");
      expect(lastFour[1].content).toBe("Assistant response 5");
      expect(lastFour[2].content).toBe("User message 6");
      expect(lastFour[3].content).toBe("Assistant response 6");
    });

    it("should handle single turn with preserve count of 1", async () => {
      const messages = createConversation(1);
      const config = createConfig({ preserveRecentTurns: 1 });
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      // Nothing to compact
      expect(result.messages).toHaveLength(2);
      expect(result.strategyName).toBe("hybrid");
    });
  });
});
