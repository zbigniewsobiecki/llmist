import { describe, expect, it } from "vitest";
import type { LLMMessage } from "../../../core/messages.js";
import type { ResolvedCompactionConfig } from "../config.js";
import type { CompactionContext } from "../strategy.js";
import { SlidingWindowStrategy } from "./sliding-window.js";

describe("SlidingWindowStrategy", () => {
  const strategy = new SlidingWindowStrategy();

  const createConfig = (
    overrides?: Partial<ResolvedCompactionConfig>,
  ): ResolvedCompactionConfig => ({
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

  // Sticky-preservation contract: messages carrying `metadata.sticky === true`
  // survive compaction regardless of how old they are. The use case is
  // multi-KB tool outputs that the agent needs to remember for the rest of
  // the conversation (e.g. LoadSkill bodies — host apps mark them sticky on
  // the way out). Without this, those outputs get dropped on the next
  // compaction pass and the agent either re-loads (wasted tokens / round
  // trips) or falls back to stale training knowledge.
  describe("compact (sticky preservation)", () => {
    it("preserves a sticky message that would otherwise have been dropped", async () => {
      // 5 turns total, preserve 2. The sticky user message lives in turn 1
      // (the oldest), which would normally be cut.
      const messages: LLMMessage[] = [
        { role: "user", content: "Sticky payload", metadata: { sticky: true } },
        { role: "assistant", content: "Acknowledged sticky" },
        { role: "user", content: "Turn 2 user" },
        { role: "assistant", content: "Turn 2 assistant" },
        { role: "user", content: "Turn 3 user" },
        { role: "assistant", content: "Turn 3 assistant" },
        { role: "user", content: "Turn 4 user" },
        { role: "assistant", content: "Turn 4 assistant" },
        { role: "user", content: "Turn 5 user" },
        { role: "assistant", content: "Turn 5 assistant" },
      ];
      const config = createConfig({ preserveRecentTurns: 2 });
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      // Expected shape: marker + sticky message + last 2 turns (4 msgs).
      expect(result.messages).toHaveLength(6);
      expect(result.messages[0].content).toContain("truncated");
      expect(result.messages[1].content).toBe("Sticky payload");
      expect(result.messages[1].metadata?.sticky).toBe(true);
      expect(result.messages[2].content).toBe("Turn 4 user");
      expect(result.messages[result.messages.length - 1].content).toBe("Turn 5 assistant");
    });

    it("preserves multiple sticky messages in original input order", async () => {
      const messages: LLMMessage[] = [
        { role: "user", content: "Sticky A", metadata: { sticky: true } },
        { role: "assistant", content: "Turn 1 assistant" },
        { role: "user", content: "Turn 2 user" },
        { role: "assistant", content: "Sticky B", metadata: { sticky: true } },
        { role: "user", content: "Turn 3 user" },
        { role: "assistant", content: "Turn 3 assistant" },
        { role: "user", content: "Turn 4 user" },
        { role: "assistant", content: "Turn 4 assistant" },
      ];
      const config = createConfig({ preserveRecentTurns: 1 });
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      // marker + 2 sticky messages + last 1 turn (2 msgs) = 5
      expect(result.messages).toHaveLength(5);
      expect(result.messages[0].content).toContain("truncated");
      // Sticky messages appear after marker, BEFORE the recent turns,
      // in their original input order.
      expect(result.messages[1].content).toBe("Sticky A");
      expect(result.messages[2].content).toBe("Sticky B");
      expect(result.messages[3].content).toBe("Turn 4 user");
      expect(result.messages[4].content).toBe("Turn 4 assistant");
    });

    it("does not duplicate a sticky message that already lives in the recent-turns window", async () => {
      // The sticky message is in the LAST turn (Turn 3). It must appear
      // exactly once in the result — at its natural position inside the
      // preserved recent turns — and NOT be re-inserted between the marker
      // and the recent turns.
      const messages: LLMMessage[] = [
        { role: "user", content: "Turn 1 user" },
        { role: "assistant", content: "Turn 1 assistant" },
        { role: "user", content: "Turn 2 user" },
        { role: "assistant", content: "Turn 2 assistant" },
        { role: "user", content: "Turn 3 user (sticky)", metadata: { sticky: true } },
        { role: "assistant", content: "Turn 3 assistant" },
      ];
      const config = createConfig({ preserveRecentTurns: 1 });
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      // marker + 1 turn (2 msgs) = 3, NOT 4 (no duplicate of the sticky)
      expect(result.messages).toHaveLength(3);
      const stickyHits = result.messages.filter(
        (m) => m.metadata?.sticky === true && m.content === "Turn 3 user (sticky)",
      );
      expect(stickyHits).toHaveLength(1);
      // And the surviving sticky sits at its natural position (right after marker).
      expect(result.messages[1].content).toBe("Turn 3 user (sticky)");
    });

    it("treats only `metadata.sticky === true` as sticky, not truthy values like 'true' or 1", async () => {
      // Strict equality matters — if we accidentally use loose truthiness,
      // unrelated metadata fields could promote messages and bloat history.
      const messages: LLMMessage[] = [
        // These should NOT be preserved (sticky is not exactly === true)
        { role: "user", content: "Falsy 1", metadata: { sticky: "true" } },
        { role: "assistant", content: "Falsy 2", metadata: { sticky: 1 } },
        { role: "user", content: "Turn 2 user" },
        { role: "assistant", content: "Turn 2 assistant" },
        { role: "user", content: "Turn 3 user" },
        { role: "assistant", content: "Turn 3 assistant" },
        { role: "user", content: "Turn 4 user" },
        { role: "assistant", content: "Turn 4 assistant" },
      ];
      const config = createConfig({ preserveRecentTurns: 1 });
      const context = createContext();

      const result = await strategy.compact(messages, config, context);

      // marker + 1 turn = 3; the falsy-sticky messages must be dropped.
      expect(result.messages).toHaveLength(3);
      expect(result.messages.find((m) => m.content === "Falsy 1")).toBeUndefined();
      expect(result.messages.find((m) => m.content === "Falsy 2")).toBeUndefined();
    });
  });
});
