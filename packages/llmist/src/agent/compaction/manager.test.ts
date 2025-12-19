import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { LLMist } from "../../core/client.js";
import type { LLMMessage } from "../../core/messages.js";
import { createMockClient, MockManager, mockLLM } from "../../testing/index.js";
import type { IConversationManager } from "../interfaces.js";
import { CompactionManager } from "./manager.js";

describe("CompactionManager", () => {
  // Helper to create a mock client with model limits configured
  const createClientWithLimits = (
    options: { countTokens?: (model: string, messages: LLMMessage[]) => Promise<number> } = {},
  ): LLMist => {
    const client = createMockClient();
    // Mock the model registry to return proper limits
    client.modelRegistry.getModelLimits = () => ({
      contextWindow: 2000,
      maxOutputTokens: 1000,
    });
    // Override countTokens if provided
    if (options.countTokens) {
      client.countTokens = options.countTokens;
    }
    return client;
  };

  // Create a simple mock conversation manager
  const createMockConversation = (
    baseMessages: LLMMessage[] = [],
    historyMessages: LLMMessage[] = [],
  ): IConversationManager & { replaceHistoryCalls: LLMMessage[][] } => {
    const replaceHistoryCalls: LLMMessage[][] = [];
    return {
      replaceHistoryCalls,
      getMessages: () => [...baseMessages, ...historyMessages],
      getHistoryMessages: () => historyMessages,
      getBaseMessages: () => baseMessages,
      replaceHistory: (newHistory: LLMMessage[]) => {
        replaceHistoryCalls.push([...newHistory]);
      },
      addUserMessage: () => {},
      addAssistantMessage: () => {},
      addGadgetCallResult: () => {},
    };
  };

  // Create conversation with multiple turns
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

  describe("constructor", () => {
    it("should create with default config", () => {
      const client = createMockClient();
      const manager = new CompactionManager(client, "mock:test");

      expect(manager.isEnabled()).toBe(true);
    });

    it("should create with disabled config", () => {
      const client = createMockClient();
      const manager = new CompactionManager(client, "mock:test", {
        enabled: false,
      });

      expect(manager.isEnabled()).toBe(false);
    });

    it("should accept custom strategy instance", () => {
      const client = createMockClient();
      const customStrategy = {
        name: "custom",
        compact: mock(async () => ({
          messages: [],
          strategyName: "custom",
          metadata: { originalCount: 0, compactedCount: 0, tokensBefore: 0, tokensAfter: 0 },
        })),
      };

      const manager = new CompactionManager(client, "mock:test", {
        strategy: customStrategy,
      });

      expect(manager.isEnabled()).toBe(true);
    });
  });

  describe("checkAndCompact", () => {
    it("should return null when disabled", async () => {
      const client = createMockClient();
      const manager = new CompactionManager(client, "mock:test", { enabled: false });
      const conversation = createMockConversation();

      const result = await manager.checkAndCompact(conversation, 1);

      expect(result).toBeNull();
    });

    it("should return null when below threshold", async () => {
      // Mock returns small token count (10% of 2000 = 200 tokens)
      const client = createClientWithLimits({
        countTokens: async () => 200,
      });
      const manager = new CompactionManager(client, "mock:test", {
        triggerThresholdPercent: 80, // Trigger at 80%
      });
      const conversation = createMockConversation([], createConversation(2));

      const result = await manager.checkAndCompact(conversation, 1);

      expect(result).toBeNull();
    });

    it("should compact when above threshold", async () => {
      mockLLM().forAnyModel().returns("Summary").register();

      // Mock returns high token count (90% of 2000 = 1800 tokens)
      const client = createClientWithLimits({
        countTokens: async () => 1800,
      });
      const manager = new CompactionManager(client, "mock:test", {
        triggerThresholdPercent: 80,
        strategy: "sliding-window",
        preserveRecentTurns: 1,
      });
      const conversation = createMockConversation([], createConversation(5));

      const result = await manager.checkAndCompact(conversation, 1);

      expect(result).not.toBeNull();
      expect(result?.strategy).toBe("sliding-window");
      expect(result?.iteration).toBe(1);
    });

    it("should return null if model limits not found", async () => {
      // Create client with model that's not in registry
      const client = createMockClient();
      // Override the model registry to return null for limits
      client.modelRegistry.getModelLimits = () => undefined;

      const manager = new CompactionManager(client, "mock:unknown-model");
      const conversation = createMockConversation();

      const result = await manager.checkAndCompact(conversation, 1);

      expect(result).toBeNull();
    });

    it("should return null if countTokens not supported", async () => {
      const client = createMockClient();
      // Remove countTokens method
      (client as Record<string, unknown>).countTokens = undefined;

      const manager = new CompactionManager(client, "mock:test");
      const conversation = createMockConversation();

      const result = await manager.checkAndCompact(conversation, 1);

      expect(result).toBeNull();
    });
  });

  describe("compact", () => {
    it("should perform compaction and update conversation", async () => {
      mockLLM().forAnyModel().returns("Summary").register();

      const client = createClientWithLimits({
        countTokens: async () => 500,
      });
      const manager = new CompactionManager(client, "mock:test", {
        strategy: "sliding-window",
        preserveRecentTurns: 1,
      });
      const conversation = createMockConversation([], createConversation(5));

      const result = await manager.compact(conversation, 2);

      expect(result).not.toBeNull();
      expect(conversation.replaceHistoryCalls.length).toBe(1);
    });

    it("should use summarization strategy when configured", async () => {
      mockLLM().forAnyModel().returns("This is a summary").register();

      const client = createClientWithLimits({
        countTokens: async () => 500,
      });
      const manager = new CompactionManager(client, "mock:test", {
        strategy: "summarization",
        preserveRecentTurns: 1,
      });
      const conversation = createMockConversation([], createConversation(5));

      const result = await manager.compact(conversation, 2);

      expect(result).not.toBeNull();
      expect(result?.strategy).toBe("summarization");
      expect(result?.summary).toBe("This is a summary");
    });

    it("should update statistics after compaction", async () => {
      mockLLM().forAnyModel().returns("Summary").register();

      const client = createClientWithLimits({
        countTokens: async () => 500,
      });
      const manager = new CompactionManager(client, "mock:test", {
        strategy: "sliding-window",
        preserveRecentTurns: 1,
      });
      const conversation = createMockConversation([], createConversation(5));

      await manager.compact(conversation, 1);
      const stats = manager.getStats();

      expect(stats.totalCompactions).toBe(1);
    });

    it("should call onCompaction callback", async () => {
      mockLLM().forAnyModel().returns("Summary").register();

      const onCompaction = mock(() => {});
      const client = createClientWithLimits({
        countTokens: async () => 500,
      });
      const manager = new CompactionManager(client, "mock:test", {
        strategy: "sliding-window",
        preserveRecentTurns: 1,
        onCompaction,
      });
      const conversation = createMockConversation([], createConversation(5));

      await manager.compact(conversation, 1);

      expect(onCompaction).toHaveBeenCalled();
    });

    it("should handle onCompaction callback errors gracefully", async () => {
      mockLLM().forAnyModel().returns("Summary").register();

      const onCompaction = mock(() => {
        throw new Error("Callback error");
      });
      const client = createClientWithLimits({
        countTokens: async () => 500,
      });
      const manager = new CompactionManager(client, "mock:test", {
        strategy: "sliding-window",
        preserveRecentTurns: 1,
        onCompaction,
      });
      const conversation = createMockConversation([], createConversation(5));

      // Should not throw
      const result = await manager.compact(conversation, 1);
      expect(result).not.toBeNull();
    });
  });

  describe("getStats", () => {
    it("should return initial stats", () => {
      const client = createMockClient();
      const manager = new CompactionManager(client, "mock:test");
      const stats = manager.getStats();

      expect(stats.totalCompactions).toBe(0);
      expect(stats.totalTokensSaved).toBe(0);
      expect(stats.currentUsage.tokens).toBe(0);
    });

    it("should track compaction count", async () => {
      mockLLM().forAnyModel().returns("Summary").register();

      const client = createClientWithLimits({
        countTokens: async () => 500,
      });
      const manager = new CompactionManager(client, "mock:test", {
        strategy: "sliding-window",
        preserveRecentTurns: 1,
      });
      const conversation = createMockConversation([], createConversation(5));

      await manager.compact(conversation, 1);
      await manager.compact(conversation, 2);

      const stats = manager.getStats();
      expect(stats.totalCompactions).toBe(2);
    });
  });

  describe("isEnabled", () => {
    it("should return true when enabled", () => {
      const client = createMockClient();
      const manager = new CompactionManager(client, "mock:test", { enabled: true });

      expect(manager.isEnabled()).toBe(true);
    });

    it("should return false when disabled", () => {
      const client = createMockClient();
      const manager = new CompactionManager(client, "mock:test", { enabled: false });

      expect(manager.isEnabled()).toBe(false);
    });
  });

  describe("createStrategy", () => {
    it("should create sliding-window strategy", async () => {
      const client = createClientWithLimits({
        countTokens: async () => 500,
      });
      const manager = new CompactionManager(client, "mock:test", {
        strategy: "sliding-window",
        preserveRecentTurns: 1,
      });
      const conversation = createMockConversation([], createConversation(5));

      const result = await manager.compact(conversation, 1);

      expect(result?.strategy).toBe("sliding-window");
    });

    it("should create hybrid strategy", async () => {
      // Hybrid with few turns falls back to sliding-window
      const client = createClientWithLimits({
        countTokens: async () => 500,
      });
      const manager = new CompactionManager(client, "mock:test", {
        strategy: "hybrid",
        preserveRecentTurns: 3,
      });
      const conversation = createMockConversation([], createConversation(4));

      const result = await manager.compact(conversation, 1);

      // Hybrid should delegate based on turn count
      expect(result?.strategy).toBeDefined();
    });
  });
});
