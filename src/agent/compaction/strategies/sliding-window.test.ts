import { describe, expect, it } from "bun:test";
import type { LLMMessage } from "../../../core/messages.js";
import type { ResolvedCompactionConfig } from "../config.js";
import type { CompactionContext } from "../strategy.js";
import { SlidingWindowStrategy } from "./sliding-window.js";

describe("SlidingWindowStrategy", () => {
  const strategy = new SlidingWindowStrategy();

  const createConfig = (overrides?: Partial<ResolvedCompactionConfig>): ResolvedCompactionConfig => ({
    enabled: true,
    strategy: "sliding-window",
    triggerThresholdPercent: 80,
    targetPercent: 50,
    preserveRecentTurns: 3,
    summarizationPrompt: "Summarize",
    ...overrides,
  });

  const createContext = (overrides?: Partial<CompactionContext>): CompactionContext => ({
    currentTokens: 1000,
    targetTokens: 500,
    modelLimits: { contextWindow: 2000, maxOutputTokens: 1000 },
    client: {} as CompactionContext["client"],
    model: "test-model",
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

  describe("name", () => {
    it("should have correct strategy name", () => {
      expect(strategy.name).toBe("sliding-window");
    });
  });

  describe("compact", () => {
    it("should return unchanged messages when below preserve count", async () => {
      const messages = createConversation(2); // 2 turns
      const config = createConfig({ preserveRecentTurns: 5 }); // preserve 5
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      expect(result.messages).toHaveLength(messages.length);
      expect(result.strategyName).toBe("sliding-window");
      expect(result.metadata.originalCount).toBe(messages.length);
      expect(result.metadata.compactedCount).toBe(messages.length);
    });

    it("should return unchanged messages when exactly at preserve count", async () => {
      const messages = createConversation(3); // 3 turns
      const config = createConfig({ preserveRecentTurns: 3 });
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      expect(result.messages).toHaveLength(messages.length);
      expect(result.metadata.originalCount).toBe(messages.length);
    });

    it("should keep only preserveRecentTurns most recent turns", async () => {
      const messages = createConversation(5); // 5 turns = 10 messages
      const config = createConfig({ preserveRecentTurns: 2 });
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      // Should have truncation marker + 2 turns (4 messages) = 5 messages
      expect(result.messages).toHaveLength(5);
      // Last messages should be from the most recent turns
      expect(result.messages[result.messages.length - 1].content).toBe("Assistant response 5");
      expect(result.messages[result.messages.length - 2].content).toBe("User message 5");
    });

    it("should insert truncation marker at start", async () => {
      const messages = createConversation(5);
      const config = createConfig({ preserveRecentTurns: 2 });
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      expect(result.messages[0].role).toBe("user");
      expect(result.messages[0].content).toContain("truncated");
    });

    it("should correctly count removed turns in marker", async () => {
      const messages = createConversation(7); // 7 turns
      const config = createConfig({ preserveRecentTurns: 3 }); // keep 3, remove 4
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      expect(result.messages[0].content).toContain("4"); // Removed 4 turns
    });

    it("should calculate token estimates for compacted messages", async () => {
      const messages = createConversation(5);
      const config = createConfig({ preserveRecentTurns: 2 });
      const context = createContext({ currentTokens: 500 });

      const result = await strategy.compact(messages, config, context);

      expect(result.metadata.tokensBefore).toBe(500);
      expect(result.metadata.tokensAfter).toBeGreaterThan(0);
      expect(result.metadata.tokensAfter).toBeLessThan(result.metadata.tokensBefore);
    });

    it("should return metadata with original and compacted counts", async () => {
      const messages = createConversation(6);
      const config = createConfig({ preserveRecentTurns: 2 });
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      expect(result.metadata.originalCount).toBe(12); // 6 turns * 2 messages
      expect(result.metadata.compactedCount).toBe(5); // marker + 2 turns * 2 messages
    });

    it("should handle empty messages", async () => {
      const messages: LLMMessage[] = [];
      const config = createConfig({ preserveRecentTurns: 3 });
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      expect(result.messages).toHaveLength(0);
    });

    it("should handle single turn", async () => {
      const messages = createConversation(1);
      const config = createConfig({ preserveRecentTurns: 3 });
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      expect(result.messages).toHaveLength(2);
    });

    it("should preserve message content integrity", async () => {
      const messages: LLMMessage[] = [
        { role: "user", content: "First question with special chars: <>&\"'" },
        { role: "assistant", content: "First answer" },
        { role: "user", content: "Second question" },
        { role: "assistant", content: "Second answer with\nmultiline\ncontent" },
      ];
      const config = createConfig({ preserveRecentTurns: 1 });
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      // Should keep the second turn
      const keptMessages = result.messages.slice(1);
      expect(keptMessages[0].content).toBe("Second question");
      expect(keptMessages[1].content).toBe("Second answer with\nmultiline\ncontent");
    });
  });
});
