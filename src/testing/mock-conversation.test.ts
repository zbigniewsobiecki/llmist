/**
 * Tests for MockConversationManager
 *
 * Verifies the mock conversation manager used for testing compaction
 * and agent components.
 */

import { describe, expect, it } from "bun:test";
import type { LLMMessage } from "../core/messages.js";
import { createMockConversationManager, MockConversationManager } from "./mock-conversation.js";

describe("MockConversationManager", () => {
  describe("constructor", () => {
    it("creates empty manager by default", () => {
      const manager = new MockConversationManager();

      expect(manager.getHistoryMessages()).toEqual([]);
      expect(manager.getBaseMessages()).toEqual([]);
      expect(manager.getMessages()).toEqual([]);
    });

    it("initializes with provided history", () => {
      const history: LLMMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ];

      const manager = new MockConversationManager(history);

      expect(manager.getHistoryMessages()).toEqual(history);
      expect(manager.getHistoryLength()).toBe(2);
    });

    it("initializes with provided base messages", () => {
      const baseMessages: LLMMessage[] = [
        { role: "system", content: "You are a helpful assistant" },
      ];

      const manager = new MockConversationManager([], baseMessages);

      expect(manager.getBaseMessages()).toEqual(baseMessages);
      expect(manager.getHistoryMessages()).toEqual([]);
    });

    it("combines base messages and history in getMessages()", () => {
      const baseMessages: LLMMessage[] = [{ role: "system", content: "System prompt" }];
      const history: LLMMessage[] = [{ role: "user", content: "Hello" }];

      const manager = new MockConversationManager(history, baseMessages);

      const allMessages = manager.getMessages();
      expect(allMessages).toHaveLength(2);
      expect(allMessages[0]).toEqual({ role: "system", content: "System prompt" });
      expect(allMessages[1]).toEqual({ role: "user", content: "Hello" });
    });

    it("creates defensive copies of arrays", () => {
      const history: LLMMessage[] = [{ role: "user", content: "Original" }];
      const manager = new MockConversationManager(history);

      // Mutating original array should not affect manager
      history.push({ role: "assistant", content: "Added externally" });

      expect(manager.getHistoryLength()).toBe(1);
    });
  });

  describe("addUserMessage()", () => {
    it("adds user message to history", () => {
      const manager = new MockConversationManager();

      manager.addUserMessage("Hello");

      expect(manager.getHistoryMessages()).toEqual([{ role: "user", content: "Hello" }]);
    });

    it("tracks added message", () => {
      const manager = new MockConversationManager();

      manager.addUserMessage("Hello");

      expect(manager.getAddedMessages()).toEqual([{ role: "user", content: "Hello" }]);
    });
  });

  describe("addAssistantMessage()", () => {
    it("adds assistant message to history", () => {
      const manager = new MockConversationManager();

      manager.addAssistantMessage("Hi there!");

      expect(manager.getHistoryMessages()).toEqual([{ role: "assistant", content: "Hi there!" }]);
    });

    it("tracks added message", () => {
      const manager = new MockConversationManager();

      manager.addAssistantMessage("Response");

      expect(manager.getAddedMessages()).toEqual([{ role: "assistant", content: "Response" }]);
    });
  });

  describe("addGadgetCallResult()", () => {
    it("adds gadget call and result as two messages", () => {
      const manager = new MockConversationManager();

      manager.addGadgetCallResult("Calculator", { a: 1, b: 2 }, "3", "gc_calc_1");

      const messages = manager.getHistoryMessages();
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("assistant");
      expect(messages[0].content).toContain("Calculator");
      expect(messages[1].role).toBe("user");
      expect(messages[1].content).toContain("3");
    });

    it("tracks both messages as added", () => {
      const manager = new MockConversationManager();

      manager.addGadgetCallResult("Weather", { city: "NYC" }, "Sunny, 72°F", "gc_weather_1");

      expect(manager.getAddedMessages()).toHaveLength(2);
    });
  });

  describe("replaceHistory()", () => {
    it("replaces entire history", () => {
      const manager = new MockConversationManager([{ role: "user", content: "Old message" }]);

      const newHistory: LLMMessage[] = [
        { role: "user", content: "New message" },
        { role: "assistant", content: "New response" },
      ];
      manager.replaceHistory(newHistory);

      expect(manager.getHistoryMessages()).toEqual(newHistory);
    });

    it("increments replace history call count", () => {
      const manager = new MockConversationManager();

      expect(manager.getReplaceHistoryCallCount()).toBe(0);

      manager.replaceHistory([]);
      expect(manager.getReplaceHistoryCallCount()).toBe(1);

      manager.replaceHistory([]);
      expect(manager.getReplaceHistoryCallCount()).toBe(2);
    });

    it("stores replacement history for inspection", () => {
      const manager = new MockConversationManager();
      const newHistory: LLMMessage[] = [{ role: "user", content: "Compacted" }];

      manager.replaceHistory(newHistory);

      expect(manager.getReplacementHistory()).toEqual(newHistory);
    });
  });

  describe("wasReplaceHistoryCalled()", () => {
    it("returns false initially", () => {
      const manager = new MockConversationManager();

      expect(manager.wasReplaceHistoryCalled()).toBe(false);
    });

    it("returns true after replaceHistory is called", () => {
      const manager = new MockConversationManager();

      manager.replaceHistory([]);

      expect(manager.wasReplaceHistoryCalled()).toBe(true);
    });
  });

  describe("getReplacementHistory()", () => {
    it("returns undefined if replaceHistory was never called", () => {
      const manager = new MockConversationManager();

      expect(manager.getReplacementHistory()).toBeUndefined();
    });
  });

  describe("resetTracking()", () => {
    it("resets all tracking state", () => {
      const manager = new MockConversationManager();
      manager.addUserMessage("Hello");
      manager.replaceHistory([{ role: "user", content: "New" }]);

      manager.resetTracking();

      expect(manager.wasReplaceHistoryCalled()).toBe(false);
      expect(manager.getReplaceHistoryCallCount()).toBe(0);
      expect(manager.getReplacementHistory()).toBeUndefined();
      expect(manager.getAddedMessages()).toEqual([]);
    });

    it("preserves the current history", () => {
      const manager = new MockConversationManager([{ role: "user", content: "Keep me" }]);
      manager.replaceHistory([{ role: "user", content: "New history" }]);

      manager.resetTracking();

      // History should still be the replaced one
      expect(manager.getHistoryMessages()).toEqual([{ role: "user", content: "New history" }]);
    });
  });

  describe("reset()", () => {
    it("resets to provided history", () => {
      const manager = new MockConversationManager([{ role: "user", content: "Old" }]);
      manager.addUserMessage("Added");

      manager.reset([{ role: "user", content: "Fresh start" }]);

      expect(manager.getHistoryMessages()).toEqual([{ role: "user", content: "Fresh start" }]);
    });

    it("resets to empty history by default", () => {
      const manager = new MockConversationManager([{ role: "user", content: "Old" }]);

      manager.reset();

      expect(manager.getHistoryMessages()).toEqual([]);
    });

    it("also resets tracking state", () => {
      const manager = new MockConversationManager();
      manager.addUserMessage("Hello");
      manager.replaceHistory([]);

      manager.reset();

      expect(manager.wasReplaceHistoryCalled()).toBe(false);
      expect(manager.getAddedMessages()).toEqual([]);
    });
  });

  describe("setHistory()", () => {
    it("directly sets history", () => {
      const manager = new MockConversationManager();

      manager.setHistory([{ role: "user", content: "Set directly" }]);

      expect(manager.getHistoryMessages()).toEqual([{ role: "user", content: "Set directly" }]);
    });
  });

  describe("getHistoryLength()", () => {
    it("returns 0 for empty history", () => {
      const manager = new MockConversationManager();

      expect(manager.getHistoryLength()).toBe(0);
    });

    it("returns correct count", () => {
      const manager = new MockConversationManager([
        { role: "user", content: "1" },
        { role: "assistant", content: "2" },
        { role: "user", content: "3" },
      ]);

      expect(manager.getHistoryLength()).toBe(3);
    });
  });

  describe("getTotalMessageCount()", () => {
    it("returns 0 for empty manager", () => {
      const manager = new MockConversationManager();

      expect(manager.getTotalMessageCount()).toBe(0);
    });

    it("returns sum of base and history", () => {
      const manager = new MockConversationManager(
        [
          { role: "user", content: "1" },
          { role: "assistant", content: "2" },
        ],
        [{ role: "system", content: "System" }],
      );

      expect(manager.getTotalMessageCount()).toBe(3);
    });
  });
});

describe("createMockConversationManager()", () => {
  it("creates manager with specified turn count", () => {
    const manager = createMockConversationManager(3);

    // Each turn = user + assistant = 2 messages
    expect(manager.getHistoryLength()).toBe(6);
  });

  it("creates valid user/assistant pairs", () => {
    const manager = createMockConversationManager(2);

    const messages = manager.getHistoryMessages();
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[2].role).toBe("user");
    expect(messages[3].role).toBe("assistant");
  });

  it("includes turn numbers in content", () => {
    const manager = createMockConversationManager(2);

    const messages = manager.getHistoryMessages();
    expect(messages[0].content).toContain("1");
    expect(messages[2].content).toContain("2");
  });

  it("includes base messages", () => {
    const baseMessages: LLMMessage[] = [{ role: "system", content: "System prompt" }];

    const manager = createMockConversationManager(1, baseMessages);

    expect(manager.getBaseMessages()).toEqual(baseMessages);
    expect(manager.getTotalMessageCount()).toBe(3); // 1 system + 2 from turn
  });

  it("creates empty history for 0 turns", () => {
    const manager = createMockConversationManager(0);

    expect(manager.getHistoryLength()).toBe(0);
  });
});
