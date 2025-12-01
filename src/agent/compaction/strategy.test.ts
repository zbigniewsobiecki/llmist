import { describe, expect, it } from "bun:test";
import { flattenTurns, groupIntoTurns, type MessageTurn } from "./strategy.js";
import type { LLMMessage } from "../../core/messages.js";

describe("Strategy utilities", () => {
  describe("groupIntoTurns", () => {
    it("should handle empty message arrays", () => {
      const turns = groupIntoTurns([]);
      expect(turns).toHaveLength(0);
    });

    it("should handle single message", () => {
      const messages: LLMMessage[] = [{ role: "user", content: "Hello" }];
      const turns = groupIntoTurns(messages);

      expect(turns).toHaveLength(1);
      expect(turns[0].messages).toHaveLength(1);
      expect(turns[0].messages[0].content).toBe("Hello");
    });

    it("should group user+assistant pairs into turns", () => {
      const messages: LLMMessage[] = [
        { role: "user", content: "Question 1" },
        { role: "assistant", content: "Answer 1" },
        { role: "user", content: "Question 2" },
        { role: "assistant", content: "Answer 2" },
      ];

      const turns = groupIntoTurns(messages);

      expect(turns).toHaveLength(2);
      expect(turns[0].messages).toHaveLength(2);
      expect(turns[0].messages[0].content).toBe("Question 1");
      expect(turns[0].messages[1].content).toBe("Answer 1");
      expect(turns[1].messages).toHaveLength(2);
      expect(turns[1].messages[0].content).toBe("Question 2");
      expect(turns[1].messages[1].content).toBe("Answer 2");
    });

    it("should handle orphan assistant messages at start (preamble)", () => {
      const messages: LLMMessage[] = [
        { role: "assistant", content: "I'm ready to help" },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ];

      const turns = groupIntoTurns(messages);

      // First turn contains the preamble assistant message
      expect(turns).toHaveLength(2);
      expect(turns[0].messages).toHaveLength(1);
      expect(turns[0].messages[0].role).toBe("assistant");
      // Second turn is the user+assistant pair
      expect(turns[1].messages).toHaveLength(2);
      expect(turns[1].messages[0].role).toBe("user");
    });

    it("should handle multiple assistant messages in one turn", () => {
      const messages: LLMMessage[] = [
        { role: "user", content: "Search for X" },
        { role: "assistant", content: "Searching..." },
        { role: "assistant", content: "Found results!" },
      ];

      const turns = groupIntoTurns(messages);

      expect(turns).toHaveLength(1);
      expect(turns[0].messages).toHaveLength(3);
    });

    it("should estimate token counts correctly", () => {
      // 4 chars per token estimate
      const messages: LLMMessage[] = [
        { role: "user", content: "12345678" }, // 8 chars = 2 tokens
        { role: "assistant", content: "1234567812345678" }, // 16 chars = 4 tokens
      ];

      const turns = groupIntoTurns(messages);

      expect(turns).toHaveLength(1);
      // Total: 24 chars / 4 = 6 tokens
      expect(turns[0].tokenEstimate).toBe(6);
    });

    it("should handle messages with empty content", () => {
      const messages: LLMMessage[] = [
        { role: "user", content: "" },
        { role: "assistant", content: "Response" },
      ];

      const turns = groupIntoTurns(messages);

      expect(turns).toHaveLength(1);
      expect(turns[0].tokenEstimate).toBe(2); // 8 chars / 4 = 2
    });

    it("should handle system messages within conversation", () => {
      const messages: LLMMessage[] = [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!" },
      ];

      const turns = groupIntoTurns(messages);

      // System message groups with subsequent user message
      expect(turns).toHaveLength(2);
      expect(turns[0].messages[0].role).toBe("system");
      expect(turns[1].messages[0].role).toBe("user");
    });

    it("should handle only assistant messages", () => {
      const messages: LLMMessage[] = [
        { role: "assistant", content: "First" },
        { role: "assistant", content: "Second" },
      ];

      const turns = groupIntoTurns(messages);

      expect(turns).toHaveLength(1);
      expect(turns[0].messages).toHaveLength(2);
    });
  });

  describe("flattenTurns", () => {
    it("should flatten turns back to message array", () => {
      const turns: MessageTurn[] = [
        {
          messages: [
            { role: "user", content: "Q1" },
            { role: "assistant", content: "A1" },
          ],
          tokenEstimate: 10,
        },
        {
          messages: [
            { role: "user", content: "Q2" },
            { role: "assistant", content: "A2" },
          ],
          tokenEstimate: 10,
        },
      ];

      const messages = flattenTurns(turns);

      expect(messages).toHaveLength(4);
      expect(messages[0].content).toBe("Q1");
      expect(messages[1].content).toBe("A1");
      expect(messages[2].content).toBe("Q2");
      expect(messages[3].content).toBe("A2");
    });

    it("should preserve message order", () => {
      const turns: MessageTurn[] = [
        {
          messages: [
            { role: "assistant", content: "Preamble" },
          ],
          tokenEstimate: 5,
        },
        {
          messages: [
            { role: "user", content: "User 1" },
            { role: "assistant", content: "Assistant 1" },
            { role: "assistant", content: "Assistant 2" },
          ],
          tokenEstimate: 15,
        },
      ];

      const messages = flattenTurns(turns);

      expect(messages).toHaveLength(4);
      expect(messages[0].content).toBe("Preamble");
      expect(messages[1].content).toBe("User 1");
      expect(messages[2].content).toBe("Assistant 1");
      expect(messages[3].content).toBe("Assistant 2");
    });

    it("should handle empty turns array", () => {
      const messages = flattenTurns([]);
      expect(messages).toHaveLength(0);
    });

    it("should handle turns with empty messages", () => {
      const turns: MessageTurn[] = [
        { messages: [], tokenEstimate: 0 },
        { messages: [{ role: "user", content: "Hello" }], tokenEstimate: 2 },
      ];

      const messages = flattenTurns(turns);

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("Hello");
    });
  });

  describe("roundtrip", () => {
    it("should preserve messages through group and flatten", () => {
      const original: LLMMessage[] = [
        { role: "user", content: "Q1" },
        { role: "assistant", content: "A1" },
        { role: "user", content: "Q2" },
        { role: "assistant", content: "A2" },
        { role: "assistant", content: "A2 continued" },
      ];

      const turns = groupIntoTurns(original);
      const flattened = flattenTurns(turns);

      expect(flattened).toHaveLength(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(flattened[i].role).toBe(original[i].role);
        expect(flattened[i].content).toBe(original[i].content);
      }
    });
  });
});
