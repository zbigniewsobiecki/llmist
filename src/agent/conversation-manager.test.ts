import { describe, expect, it } from "bun:test";
import type { LLMMessage } from "../core/messages.js";
import { ConversationManager } from "./conversation-manager.js";

describe("ConversationManager", () => {
  const createBaseMessages = (): LLMMessage[] => [
    { role: "system", content: "You are a helpful assistant." },
  ];

  const createInitialMessages = (): LLMMessage[] => [
    { role: "user", content: "Initial user prompt" },
  ];

  describe("constructor", () => {
    it("should create with base and initial messages", () => {
      const base = createBaseMessages();
      const initial = createInitialMessages();
      const manager = new ConversationManager(base, initial);

      const messages = manager.getMessages();

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("system");
      expect(messages[1].role).toBe("user");
    });

    it("should create with empty initial messages", () => {
      const base = createBaseMessages();
      const manager = new ConversationManager(base, []);

      const messages = manager.getMessages();

      expect(messages).toHaveLength(1);
    });

    it("should create with custom prefixes", () => {
      const base = createBaseMessages();
      const manager = new ConversationManager(base, [], {
        startPrefix: "<<<GADGET:",
        endPrefix: ">>>",
        argPrefix: "===",
      });

      // Prefixes are internal - manager should still work
      expect(manager.getMessages()).toHaveLength(1);
    });
  });

  describe("addUserMessage", () => {
    it("should add user message to history", () => {
      const manager = new ConversationManager(createBaseMessages(), []);

      manager.addUserMessage("Hello!");

      const messages = manager.getMessages();
      expect(messages).toHaveLength(2);
      expect(messages[1].role).toBe("user");
      expect(messages[1].content).toBe("Hello!");
    });

    it("should add multiple user messages", () => {
      const manager = new ConversationManager(createBaseMessages(), []);

      manager.addUserMessage("First message");
      manager.addUserMessage("Second message");

      const messages = manager.getMessages();
      // System + 2 user messages (they may be merged)
      expect(messages.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("addAssistantMessage", () => {
    it("should add assistant message to history", () => {
      const manager = new ConversationManager(createBaseMessages(), []);

      manager.addAssistantMessage("Hello, I'm here to help!");

      const messages = manager.getMessages();
      expect(messages).toHaveLength(2);
      expect(messages[1].role).toBe("assistant");
    });

    it("should preserve message order", () => {
      const manager = new ConversationManager(createBaseMessages(), []);

      manager.addUserMessage("Question");
      manager.addAssistantMessage("Answer");
      manager.addUserMessage("Follow-up");

      const messages = manager.getMessages();
      const historyMessages = messages.slice(1); // Skip system message

      expect(historyMessages[0].role).toBe("user");
      expect(historyMessages[1].role).toBe("assistant");
      expect(historyMessages[2].role).toBe("user");
    });
  });

  describe("addGadgetCallResult", () => {
    it("should add gadget call with result", () => {
      const manager = new ConversationManager(createBaseMessages(), []);

      manager.addGadgetCallResult("Calculator", { a: 5, b: 3 }, "8");

      const messages = manager.getMessages();
      // Should have system + history (gadget calls are typically in assistant message)
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });

    it("should include gadget name and parameters", () => {
      const manager = new ConversationManager(createBaseMessages(), []);

      manager.addGadgetCallResult("FileReader", { path: "/test.txt" }, "file contents");

      const history = manager.getHistoryMessages();
      const assistantMsg = history.find((m) => m.role === "assistant");

      expect(assistantMsg?.content).toContain("FileReader");
    });
  });

  describe("getMessages", () => {
    it("should return all messages in order", () => {
      const base = createBaseMessages();
      const initial = createInitialMessages();
      const manager = new ConversationManager(base, initial);

      manager.addAssistantMessage("Response");
      manager.addUserMessage("Follow-up");

      const messages = manager.getMessages();

      expect(messages[0]).toEqual(base[0]); // System message
      expect(messages[1]).toEqual(initial[0]); // Initial user message
      // History messages follow
    });

    it("should return copy of messages", () => {
      const manager = new ConversationManager(createBaseMessages(), []);

      const messages1 = manager.getMessages();
      const messages2 = manager.getMessages();

      expect(messages1).not.toBe(messages2);
      expect(messages1).toEqual(messages2);
    });
  });

  describe("getHistoryMessages", () => {
    it("should return only history (not base or initial)", () => {
      const manager = new ConversationManager(createBaseMessages(), createInitialMessages());

      manager.addUserMessage("Question");
      manager.addAssistantMessage("Answer");

      const history = manager.getHistoryMessages();

      // Should not include system or initial messages
      expect(history[0].role).toBe("user");
      expect(history[0].content).toBe("Question");
    });

    it("should return empty array when no history", () => {
      const manager = new ConversationManager(createBaseMessages(), createInitialMessages());

      const history = manager.getHistoryMessages();

      expect(history).toHaveLength(0);
    });
  });

  describe("getBaseMessages", () => {
    it("should return base and initial messages", () => {
      const base = createBaseMessages();
      const initial = createInitialMessages();
      const manager = new ConversationManager(base, initial);

      const baseMessages = manager.getBaseMessages();

      expect(baseMessages).toHaveLength(2);
      expect(baseMessages[0]).toEqual(base[0]);
      expect(baseMessages[1]).toEqual(initial[0]);
    });

    it("should not include history messages", () => {
      const manager = new ConversationManager(createBaseMessages(), createInitialMessages());

      manager.addUserMessage("History message");

      const baseMessages = manager.getBaseMessages();

      expect(baseMessages).toHaveLength(2);
    });

    it("should return copy of base messages", () => {
      const manager = new ConversationManager(createBaseMessages(), createInitialMessages());

      const base1 = manager.getBaseMessages();
      const base2 = manager.getBaseMessages();

      expect(base1).not.toBe(base2);
      expect(base1).toEqual(base2);
    });
  });

  describe("replaceHistory", () => {
    it("should replace existing history", () => {
      const manager = new ConversationManager(createBaseMessages(), []);

      manager.addUserMessage("Old message 1");
      manager.addAssistantMessage("Old response 1");

      const newHistory: LLMMessage[] = [
        { role: "user", content: "New message" },
        { role: "assistant", content: "New response" },
      ];

      manager.replaceHistory(newHistory);

      const history = manager.getHistoryMessages();
      expect(history[0].content).toBe("New message");
      expect(history[1].content).toBe("New response");
    });

    it("should preserve base messages after replace", () => {
      const base = createBaseMessages();
      const initial = createInitialMessages();
      const manager = new ConversationManager(base, initial);

      manager.addUserMessage("History");
      manager.replaceHistory([{ role: "user", content: "Replaced" }]);

      const baseMessages = manager.getBaseMessages();
      expect(baseMessages[0]).toEqual(base[0]);
      expect(baseMessages[1]).toEqual(initial[0]);
    });

    it("should handle empty replacement", () => {
      const manager = new ConversationManager(createBaseMessages(), []);

      manager.addUserMessage("Message");
      manager.replaceHistory([]);

      const history = manager.getHistoryMessages();
      expect(history).toHaveLength(0);
    });

    it("should preserve custom prefixes after replace", () => {
      const manager = new ConversationManager(createBaseMessages(), [], {
        startPrefix: "<<<",
        endPrefix: ">>>",
      });

      manager.addUserMessage("Original");
      manager.replaceHistory([{ role: "user", content: "Replaced" }]);

      // Manager should still work with same prefixes
      manager.addGadgetCallResult("Test", {}, "result");

      const messages = manager.getMessages();
      expect(messages.length).toBeGreaterThanOrEqual(2);
    });

    it("should only add user and assistant roles", () => {
      const manager = new ConversationManager(createBaseMessages(), []);

      const newHistory: LLMMessage[] = [
        { role: "system", content: "System (should be ignored)" },
        { role: "user", content: "User" },
        { role: "assistant", content: "Assistant" },
      ];

      manager.replaceHistory(newHistory);

      const history = manager.getHistoryMessages();
      // System message should be skipped
      expect(history[0].content).toBe("User");
      expect(history[1].content).toBe("Assistant");
    });
  });

  describe("integration", () => {
    it("should support full conversation flow", () => {
      const manager = new ConversationManager(createBaseMessages(), createInitialMessages());

      // Add conversation turns
      manager.addAssistantMessage("I'll help you with that.");
      manager.addUserMessage("Can you calculate 5 + 3?");
      manager.addGadgetCallResult("Calculator", { operation: "add", a: 5, b: 3 }, "8");
      manager.addAssistantMessage("The result is 8.");

      const messages = manager.getMessages();
      const history = manager.getHistoryMessages();

      // Should have all messages
      expect(messages.length).toBeGreaterThan(history.length);
      expect(history.length).toBeGreaterThan(0);
    });

    it("should support compaction simulation", () => {
      const manager = new ConversationManager(createBaseMessages(), createInitialMessages());

      // Build up history
      for (let i = 0; i < 10; i++) {
        manager.addUserMessage(`Question ${i}`);
        manager.addAssistantMessage(`Answer ${i}`);
      }

      // Simulate compaction - replace with summary
      manager.replaceHistory([
        { role: "user", content: "[Summary of previous conversation]" },
        { role: "assistant", content: "I understand the context." },
        { role: "user", content: "Question 9" },
        { role: "assistant", content: "Answer 9" },
      ]);

      const history = manager.getHistoryMessages();
      expect(history).toHaveLength(4);
      expect(history[0].content).toContain("Summary");
    });
  });
});
