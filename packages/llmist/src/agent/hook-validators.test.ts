import { describe, expect, it } from "vitest";
import {
  HookValidationError,
  validateAfterGadgetExecutionAction,
  validateAfterLLMCallAction,
  validateAfterLLMErrorAction,
  validateBeforeGadgetExecutionAction,
  validateBeforeLLMCallAction,
} from "./hook-validators.js";

describe("Hook validators", () => {
  describe("HookValidationError", () => {
    it("should include hook name in error message", () => {
      const error = new HookValidationError("testHook", "test message");
      expect(error.message).toContain("testHook");
      expect(error.message).toContain("test message");
    });

    it("should have correct error name", () => {
      const error = new HookValidationError("hook", "msg");
      expect(error.name).toBe("HookValidationError");
    });
  });

  describe("validateBeforeLLMCallAction", () => {
    it("should pass for valid proceed action", () => {
      expect(() => validateBeforeLLMCallAction({ action: "proceed" })).not.toThrow();
    });

    it("should pass for valid skip action with syntheticResponse", () => {
      expect(() =>
        validateBeforeLLMCallAction({
          action: "skip",
          syntheticResponse: "Skipped response",
        }),
      ).not.toThrow();
    });

    it("should throw for missing action field", () => {
      expect(() =>
        validateBeforeLLMCallAction({} as Parameters<typeof validateBeforeLLMCallAction>[0]),
      ).toThrow(HookValidationError);
    });

    it("should throw for null input", () => {
      expect(() =>
        validateBeforeLLMCallAction(
          null as unknown as Parameters<typeof validateBeforeLLMCallAction>[0],
        ),
      ).toThrow(HookValidationError);
    });

    it("should throw for invalid action type", () => {
      expect(() =>
        validateBeforeLLMCallAction({ action: "invalid" } as Parameters<
          typeof validateBeforeLLMCallAction
        >[0]),
      ).toThrow("Must be 'proceed' or 'skip'");
    });

    it("should throw for skip without syntheticResponse", () => {
      expect(() =>
        validateBeforeLLMCallAction({ action: "skip" } as Parameters<
          typeof validateBeforeLLMCallAction
        >[0]),
      ).toThrow("syntheticResponse is required");
    });
  });

  describe("validateAfterLLMCallAction", () => {
    it("should pass for continue action", () => {
      expect(() => validateAfterLLMCallAction({ action: "continue" })).not.toThrow();
    });

    it("should pass for append_messages with valid messages", () => {
      expect(() =>
        validateAfterLLMCallAction({
          action: "append_messages",
          messages: [{ role: "user", content: "Follow-up" }],
        }),
      ).not.toThrow();
    });

    it("should pass for modify_and_continue with modifiedMessage", () => {
      expect(() =>
        validateAfterLLMCallAction({
          action: "modify_and_continue",
          modifiedMessage: "Modified content",
        }),
      ).not.toThrow();
    });

    it("should pass for append_and_modify with both", () => {
      expect(() =>
        validateAfterLLMCallAction({
          action: "append_and_modify",
          messages: [{ role: "assistant", content: "More context" }],
          modifiedMessage: "Modified",
        }),
      ).not.toThrow();
    });

    it("should throw for missing action field", () => {
      expect(() =>
        validateAfterLLMCallAction({} as Parameters<typeof validateAfterLLMCallAction>[0]),
      ).toThrow(HookValidationError);
    });

    it("should throw for invalid action type", () => {
      expect(() =>
        validateAfterLLMCallAction({ action: "stop" } as Parameters<
          typeof validateAfterLLMCallAction
        >[0]),
      ).toThrow("Invalid action type");
    });

    it("should throw for append_messages with empty array", () => {
      expect(() =>
        validateAfterLLMCallAction({
          action: "append_messages",
          messages: [],
        }),
      ).toThrow("must not be empty");
    });

    it("should throw for append_messages without messages", () => {
      expect(() =>
        validateAfterLLMCallAction({
          action: "append_messages",
        } as Parameters<typeof validateAfterLLMCallAction>[0]),
      ).toThrow("messages array is required");
    });

    it("should throw for messages with invalid role", () => {
      expect(() =>
        validateAfterLLMCallAction({
          action: "append_messages",
          messages: [{ role: "invalid" as "user", content: "test" }],
        }),
      ).toThrow("invalid role");
    });

    it("should throw for messages missing content", () => {
      expect(() =>
        validateAfterLLMCallAction({
          action: "append_messages",
          messages: [{ role: "user" } as { role: "user"; content: string }],
        }),
      ).toThrow("'role' and 'content' fields");
    });

    it("should throw for modify_and_continue without modifiedMessage", () => {
      expect(() =>
        validateAfterLLMCallAction({
          action: "modify_and_continue",
        } as Parameters<typeof validateAfterLLMCallAction>[0]),
      ).toThrow("modifiedMessage is required");
    });

    it("should validate each message in array", () => {
      expect(() =>
        validateAfterLLMCallAction({
          action: "append_messages",
          messages: [
            { role: "user", content: "valid" },
            null as unknown as { role: "user"; content: string },
          ],
        }),
      ).toThrow("index 1");
    });
  });

  describe("validateAfterLLMErrorAction", () => {
    it("should pass for rethrow action", () => {
      expect(() => validateAfterLLMErrorAction({ action: "rethrow" })).not.toThrow();
    });

    it("should pass for recover with fallbackResponse", () => {
      expect(() =>
        validateAfterLLMErrorAction({
          action: "recover",
          fallbackResponse: "Fallback content",
        }),
      ).not.toThrow();
    });

    it("should throw for missing action field", () => {
      expect(() =>
        validateAfterLLMErrorAction({} as Parameters<typeof validateAfterLLMErrorAction>[0]),
      ).toThrow(HookValidationError);
    });

    it("should throw for invalid action type", () => {
      expect(() =>
        validateAfterLLMErrorAction({ action: "retry" } as Parameters<
          typeof validateAfterLLMErrorAction
        >[0]),
      ).toThrow("Must be 'rethrow' or 'recover'");
    });

    it("should throw for recover without fallbackResponse", () => {
      expect(() =>
        validateAfterLLMErrorAction({ action: "recover" } as Parameters<
          typeof validateAfterLLMErrorAction
        >[0]),
      ).toThrow("fallbackResponse is required");
    });
  });

  describe("validateBeforeGadgetExecutionAction", () => {
    it("should pass for proceed action", () => {
      expect(() => validateBeforeGadgetExecutionAction({ action: "proceed" })).not.toThrow();
    });

    it("should pass for skip with syntheticResult", () => {
      expect(() =>
        validateBeforeGadgetExecutionAction({
          action: "skip",
          syntheticResult: "Skipped result",
        }),
      ).not.toThrow();
    });

    it("should throw for missing action field", () => {
      expect(() =>
        validateBeforeGadgetExecutionAction(
          {} as Parameters<typeof validateBeforeGadgetExecutionAction>[0],
        ),
      ).toThrow(HookValidationError);
    });

    it("should throw for invalid action type", () => {
      expect(() =>
        validateBeforeGadgetExecutionAction({ action: "cancel" } as Parameters<
          typeof validateBeforeGadgetExecutionAction
        >[0]),
      ).toThrow("Must be 'proceed' or 'skip'");
    });

    it("should throw for skip without syntheticResult", () => {
      expect(() =>
        validateBeforeGadgetExecutionAction({ action: "skip" } as Parameters<
          typeof validateBeforeGadgetExecutionAction
        >[0]),
      ).toThrow("syntheticResult is required");
    });
  });

  describe("validateAfterGadgetExecutionAction", () => {
    it("should pass for continue action", () => {
      expect(() => validateAfterGadgetExecutionAction({ action: "continue" })).not.toThrow();
    });

    it("should pass for recover with fallbackResult", () => {
      expect(() =>
        validateAfterGadgetExecutionAction({
          action: "recover",
          fallbackResult: "Recovered result",
        }),
      ).not.toThrow();
    });

    it("should throw for missing action field", () => {
      expect(() =>
        validateAfterGadgetExecutionAction(
          {} as Parameters<typeof validateAfterGadgetExecutionAction>[0],
        ),
      ).toThrow(HookValidationError);
    });

    it("should throw for invalid action type", () => {
      expect(() =>
        validateAfterGadgetExecutionAction({ action: "retry" } as Parameters<
          typeof validateAfterGadgetExecutionAction
        >[0]),
      ).toThrow("Must be 'continue' or 'recover'");
    });

    it("should throw for recover without fallbackResult", () => {
      expect(() =>
        validateAfterGadgetExecutionAction({ action: "recover" } as Parameters<
          typeof validateAfterGadgetExecutionAction
        >[0]),
      ).toThrow("fallbackResult is required");
    });
  });
});
