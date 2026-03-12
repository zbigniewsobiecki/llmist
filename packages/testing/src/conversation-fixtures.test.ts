import { describe, expect, it } from "vitest";
import {
  createAssistantMessage,
  createConversation,
  createConversationWithGadgets,
  createLargeConversation,
  createMinimalConversation,
  createSystemMessage,
  createUserMessage,
  estimateTokens,
} from "./conversation-fixtures.js";

describe("conversation-fixtures", () => {
  describe("createConversation()", () => {
    it("creates specified number of turns", () => {
      const turns = 3;
      const messages = createConversation(turns);
      // Each turn has a user message and an assistant message
      expect(messages).toHaveLength(turns * 2);

      expect(messages[0].role).toBe("user");
      expect(messages[1].role).toBe("assistant");
      expect(messages[2].role).toBe("user");
      expect(messages[3].role).toBe("assistant");
      expect(messages[4].role).toBe("user");
      expect(messages[5].role).toBe("assistant");
    });

    it("respects custom prefixes", () => {
      const messages = createConversation(1, {
        userPrefix: "Hello",
        assistantPrefix: "Hi",
      });
      expect(messages[0].content).toContain("Hello");
      expect(messages[1].content).toContain("Hi");
    });

    it("respects contentLength", () => {
      const length = 500;
      const messages = createConversation(1, { contentLength: length });
      expect(messages[0].content?.length).toBeGreaterThanOrEqual(length);
      expect(messages[1].content?.length).toBeGreaterThanOrEqual(length);
    });

    it("increments turn numbers in content", () => {
      const messages = createConversation(2);
      expect(messages[0].content).toContain("1");
      expect(messages[2].content).toContain("2");
    });
  });

  describe("createConversationWithGadgets()", () => {
    it("creates turns with gadgets", () => {
      const turns = 2;
      const gadgetsPerTurn = 1;
      const messages = createConversationWithGadgets(turns, gadgetsPerTurn);

      // Turn 1: user, assistant(gadget), user(result), assistant(final) = 4
      // Turn 2: same = 4
      // Total: 8
      expect(messages).toHaveLength(turns * (gadgetsPerTurn * 2 + 2));

      expect(messages[0].role).toBe("user");
      expect(messages[1].role).toBe("assistant");
      expect(messages[1].content).toContain("!!!GADGET_START");
      expect(messages[2].role).toBe("user");
      expect(messages[2].content).toContain("Result: Gadget");
      expect(messages[3].role).toBe("assistant");
      expect(messages[3].content).toContain("Final response");
    });

    it("cycles through gadget names", () => {
      const gadgetNames = ["g1", "g2"];
      const messages = createConversationWithGadgets(2, 1, { gadgetNames });

      expect(messages[1].content).toContain("g1");
      expect(messages[5].content).toContain("g2");
    });

    it("respects gadgetsPerTurn", () => {
      const turns = 1;
      const gadgetsPerTurn = 3;
      const messages = createConversationWithGadgets(turns, gadgetsPerTurn);

      // Turn: user (1) + 3 * (assistant call + user result) (6) + final assistant (1) = 8
      expect(messages).toHaveLength(8);

      // Checking gadget starts
      const gadgetCalls = messages.filter(
        (m) => m.role === "assistant" && m.content?.includes("!!!GADGET_START"),
      );
      expect(gadgetCalls).toHaveLength(3);
    });
  });

  describe("estimateTokens()", () => {
    it("uses 4-chars-per-token heuristic", () => {
      const messages = [{ role: "user", content: "abcd" }] as const;
      expect(estimateTokens([...messages])).toBe(1);

      const multiMessages = [
        { role: "user", content: "abcd" },
        { role: "assistant", content: "12345678" },
      ] as const;
      expect(estimateTokens([...multiMessages])).toBe(3);
    });

    it("handles empty/null content", () => {
      const messages = [{ role: "user" } as unknown as LLMMessage];
      expect(estimateTokens(messages)).toBe(0);
    });

    it("rounds up", () => {
      const messages = [{ role: "user", content: "abc" }] as const;
      expect(estimateTokens([...messages])).toBe(1);
    });
  });

  describe("createUserMessage()", () => {
    it("creates a user message", () => {
      const m = createUserMessage("test");
      expect(m).toEqual({ role: "user", content: "test" });
    });
  });

  describe("createAssistantMessage()", () => {
    it("creates an assistant message", () => {
      const m = createAssistantMessage("test");
      expect(m).toEqual({ role: "assistant", content: "test" });
    });
  });

  describe("createSystemMessage()", () => {
    it("creates a system message", () => {
      const m = createSystemMessage("test");
      expect(m).toEqual({ role: "system", content: "test" });
    });
  });

  describe("createMinimalConversation()", () => {
    it("creates a simple two-message conversation", () => {
      const messages = createMinimalConversation();
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("user");
      expect(messages[1].role).toBe("assistant");
    });
  });

  describe("createLargeConversation()", () => {
    it("exceeds target token count", () => {
      const targetTokens = 1000;
      const messages = createLargeConversation(targetTokens);
      const tokens = estimateTokens(messages);
      expect(tokens).toBeGreaterThanOrEqual(targetTokens);
    });

    it("respects tokensPerTurn", () => {
      const targetTokens = 400;
      const tokensPerTurn = 100;
      const messages = createLargeConversation(targetTokens, { tokensPerTurn });

      // Each turn should have ~100 tokens, so we need 4 turns
      // 4 turns * 2 messages per turn = 8 messages
      expect(messages).toHaveLength(8);
    });
  });
});
