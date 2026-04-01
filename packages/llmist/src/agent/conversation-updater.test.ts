/**
 * Unit tests for ConversationUpdater.
 *
 * Tests cover:
 * - createSyntheticInvocation: unique ID generation
 * - handleTextOnly: all TextOnlyStrategy variants
 * - handleTextOnly: unknown strategy fallback
 * - updateWithResults with gadget results (no text wrapping)
 * - updateWithResults with gadget results and textWithGadgetsHandler
 * - updateWithResults text-only (terminate)
 * - updateWithResults text-only (acknowledge / continue)
 * - updateWithResults text-only: empty message skipped
 * - updateWithResults: returns false when gadgets executed
 */

import type { ILogObj, Logger } from "tslog";
import { describe, expect, it, vi } from "vitest";
import type { StreamEvent } from "../gadgets/types.js";
import type { ConversationManager } from "./conversation-manager.js";
import { ConversationUpdater } from "./conversation-updater.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLogger(): Logger<ILogObj> {
  return {
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    silly: vi.fn(),
  } as unknown as Logger<ILogObj>;
}

function createMockConversation(): ConversationManager {
  return {
    addAssistantMessage: vi.fn(),
    addGadgetCallResult: vi.fn(),
    addUserMessage: vi.fn(),
    getMessages: vi.fn().mockReturnValue([]),
    getHistoryMessages: vi.fn().mockReturnValue([]),
    getBaseMessages: vi.fn().mockReturnValue([]),
    replaceHistory: vi.fn(),
    getConversationHistory: vi.fn().mockReturnValue([]),
  } as unknown as ConversationManager;
}

function createGadgetResultEvent(overrides: Record<string, unknown> = {}): StreamEvent {
  return {
    type: "gadget_result",
    result: {
      gadgetName: "TestGadget",
      parameters: { input: "test" },
      result: "result-value",
      error: undefined,
      invocationId: "inv-001",
      media: undefined,
      mediaIds: undefined,
      storedMedia: undefined,
      ...overrides,
    },
  } as unknown as StreamEvent;
}

// ---------------------------------------------------------------------------
// createSyntheticInvocation
// ---------------------------------------------------------------------------

describe("ConversationUpdater", () => {
  describe("createSyntheticInvocation", () => {
    it("should generate unique IDs incrementing counter", () => {
      const updater = new ConversationUpdater(
        createMockConversation(),
        "terminate",
        undefined,
        createMockLogger(),
      );

      const id1 = updater.createSyntheticInvocation();
      const id2 = updater.createSyntheticInvocation();
      const id3 = updater.createSyntheticInvocation();

      expect(id1).toBe("gc_text_1");
      expect(id2).toBe("gc_text_2");
      expect(id3).toBe("gc_text_3");
    });

    it("should generate IDs with gc_text_ prefix", () => {
      const updater = new ConversationUpdater(
        createMockConversation(),
        "terminate",
        undefined,
        createMockLogger(),
      );

      const id = updater.createSyntheticInvocation();
      expect(id).toMatch(/^gc_text_\d+$/);
    });
  });

  // -------------------------------------------------------------------------
  // handleTextOnly
  // -------------------------------------------------------------------------

  describe("handleTextOnly", () => {
    it("should return 'terminate' for 'terminate' strategy", () => {
      const logger = createMockLogger();
      const updater = new ConversationUpdater(
        createMockConversation(),
        "terminate",
        undefined,
        logger,
      );

      const result = updater.handleTextOnly(["some text"]);

      expect(result).toBe("terminate");
      expect(logger.info).toHaveBeenCalledWith("No gadgets called, ending loop");
    });

    it("should return 'continue' for 'acknowledge' strategy", () => {
      const logger = createMockLogger();
      const updater = new ConversationUpdater(
        createMockConversation(),
        "acknowledge",
        undefined,
        logger,
      );

      const result = updater.handleTextOnly(["some text"]);

      expect(result).toBe("continue");
      expect(logger.info).toHaveBeenCalledWith("No gadgets called, continuing loop");
    });

    it("should return 'terminate' for 'wait_for_input' strategy", () => {
      const logger = createMockLogger();
      const updater = new ConversationUpdater(
        createMockConversation(),
        "wait_for_input",
        undefined,
        logger,
      );

      const result = updater.handleTextOnly(["some text"]);

      expect(result).toBe("terminate");
      expect(logger.info).toHaveBeenCalledWith("No gadgets called, waiting for input");
    });

    it("should return 'terminate' for unknown strategy with warning", () => {
      const logger = createMockLogger();
      const updater = new ConversationUpdater(
        createMockConversation(),
        // biome-ignore lint/suspicious/noExplicitAny: testing unknown strategy
        "unknown_strategy" as any,
        undefined,
        logger,
      );

      const result = updater.handleTextOnly(["some text"]);

      expect(result).toBe("terminate");
      expect(logger.warn).toHaveBeenCalledWith(
        "Unknown text-only strategy: unknown_strategy, defaulting to terminate",
      );
    });
  });

  // -------------------------------------------------------------------------
  // updateWithResults - gadgets executed
  // -------------------------------------------------------------------------

  describe("updateWithResults with gadget results", () => {
    it("should add gadget results to conversation and return false", () => {
      const conversation = createMockConversation();
      const updater = new ConversationUpdater(
        conversation,
        "terminate",
        undefined,
        createMockLogger(),
      );

      const gadgetEvent = createGadgetResultEvent();
      const result = updater.updateWithResults([], [gadgetEvent], "");

      expect(result).toBe(false);
      expect(conversation.addGadgetCallResult).toHaveBeenCalledWith(
        "TestGadget",
        { input: "test" },
        "result-value",
        "inv-001",
        undefined,
        undefined,
        undefined,
      );
      expect(conversation.addAssistantMessage).not.toHaveBeenCalled();
    });

    it("should use error field when result is undefined", () => {
      const conversation = createMockConversation();
      const updater = new ConversationUpdater(
        conversation,
        "terminate",
        undefined,
        createMockLogger(),
      );

      const gadgetEvent = createGadgetResultEvent({ result: undefined, error: "Something failed" });
      updater.updateWithResults([], [gadgetEvent], "");

      expect(conversation.addGadgetCallResult).toHaveBeenCalledWith(
        "TestGadget",
        { input: "test" },
        "Something failed",
        "inv-001",
        undefined,
        undefined,
        undefined,
      );
    });

    it("should handle multiple gadget results", () => {
      const conversation = createMockConversation();
      const updater = new ConversationUpdater(
        conversation,
        "terminate",
        undefined,
        createMockLogger(),
      );

      const event1 = createGadgetResultEvent({ gadgetName: "Gadget1", invocationId: "inv-001" });
      const event2 = createGadgetResultEvent({ gadgetName: "Gadget2", invocationId: "inv-002" });
      updater.updateWithResults([], [event1, event2], "");

      expect(conversation.addGadgetCallResult).toHaveBeenCalledTimes(2);
    });

    it("should wrap accompanying text when textWithGadgetsHandler is configured", () => {
      const conversation = createMockConversation();
      const textWithGadgetsHandler = {
        gadgetName: "TextWrapper",
        parameterMapping: (text: string) => ({ content: text }),
        resultMapping: (text: string) => `wrapped: ${text}`,
      };
      const updater = new ConversationUpdater(
        conversation,
        "terminate",
        textWithGadgetsHandler,
        createMockLogger(),
      );

      const gadgetEvent = createGadgetResultEvent();
      updater.updateWithResults(["Hello", " world"], [gadgetEvent], "");

      // First call: wrapped text as synthetic gadget
      expect(conversation.addGadgetCallResult).toHaveBeenNthCalledWith(
        1,
        "TextWrapper",
        { content: "Hello world" },
        "wrapped: Hello world",
        "gc_text_1",
      );
      // Second call: actual gadget result
      expect(conversation.addGadgetCallResult).toHaveBeenNthCalledWith(
        2,
        "TestGadget",
        { input: "test" },
        "result-value",
        "inv-001",
        undefined,
        undefined,
        undefined,
      );
    });

    it("should skip text wrapping when text is whitespace-only", () => {
      const conversation = createMockConversation();
      const textWithGadgetsHandler = {
        gadgetName: "TextWrapper",
        parameterMapping: (text: string) => ({ content: text }),
      };
      const updater = new ConversationUpdater(
        conversation,
        "terminate",
        textWithGadgetsHandler,
        createMockLogger(),
      );

      const gadgetEvent = createGadgetResultEvent();
      updater.updateWithResults(["   ", "\n"], [gadgetEvent], "");

      // Only one call: the actual gadget result (no synthetic text wrapper)
      expect(conversation.addGadgetCallResult).toHaveBeenCalledTimes(1);
      expect(conversation.addGadgetCallResult).toHaveBeenCalledWith(
        "TestGadget",
        expect.any(Object),
        "result-value",
        "inv-001",
        undefined,
        undefined,
        undefined,
      );
    });

    it("should use text as result when resultMapping is not provided", () => {
      const conversation = createMockConversation();
      const textWithGadgetsHandler = {
        gadgetName: "TextWrapper",
        parameterMapping: (text: string) => ({ content: text }),
        // No resultMapping
      };
      const updater = new ConversationUpdater(
        conversation,
        "terminate",
        textWithGadgetsHandler,
        createMockLogger(),
      );

      const gadgetEvent = createGadgetResultEvent();
      updater.updateWithResults(["Hello"], [gadgetEvent], "");

      expect(conversation.addGadgetCallResult).toHaveBeenNthCalledWith(
        1,
        "TextWrapper",
        { content: "Hello" },
        "Hello", // defaults to text
        "gc_text_1",
      );
    });
  });

  // -------------------------------------------------------------------------
  // updateWithResults - text-only (no gadgets)
  // -------------------------------------------------------------------------

  describe("updateWithResults text-only", () => {
    it("should add assistant message and return true when terminate", () => {
      const conversation = createMockConversation();
      const updater = new ConversationUpdater(
        conversation,
        "terminate",
        undefined,
        createMockLogger(),
      );

      const result = updater.updateWithResults(["Hello"], [], "Hello from LLM");

      expect(result).toBe(true);
      expect(conversation.addAssistantMessage).toHaveBeenCalledWith("Hello from LLM");
    });

    it("should add assistant message and return false when acknowledge", () => {
      const conversation = createMockConversation();
      const updater = new ConversationUpdater(
        conversation,
        "acknowledge",
        undefined,
        createMockLogger(),
      );

      const result = updater.updateWithResults(["Hello"], [], "Hello from LLM");

      expect(result).toBe(false);
      expect(conversation.addAssistantMessage).toHaveBeenCalledWith("Hello from LLM");
    });

    it("should skip addAssistantMessage when finalMessage is empty", () => {
      const conversation = createMockConversation();
      const updater = new ConversationUpdater(
        conversation,
        "terminate",
        undefined,
        createMockLogger(),
      );

      updater.updateWithResults([], [], "");

      expect(conversation.addAssistantMessage).not.toHaveBeenCalled();
    });

    it("should skip addAssistantMessage when finalMessage is whitespace", () => {
      const conversation = createMockConversation();
      const updater = new ConversationUpdater(
        conversation,
        "terminate",
        undefined,
        createMockLogger(),
      );

      updater.updateWithResults(["  "], [], "   ");

      expect(conversation.addAssistantMessage).not.toHaveBeenCalled();
    });

    it("should use finalMessage not textOutputs for the assistant message", () => {
      const conversation = createMockConversation();
      const updater = new ConversationUpdater(
        conversation,
        "terminate",
        undefined,
        createMockLogger(),
      );

      // finalMessage may be modified by afterLLMCall controller
      updater.updateWithResults(["original text"], [], "modified final message");

      expect(conversation.addAssistantMessage).toHaveBeenCalledWith("modified final message");
    });
  });
});
