import { describe, expect, it, vi } from "vitest";

import type { StreamEvent } from "../gadgets/types.js";
import {
  collectEvents,
  collectText,
  type EventHandlers,
  runWithHandlers,
} from "./event-handlers.js";

/**
 * Helper to create a mock async generator from events.
 */
async function* createMockGenerator(events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  for (const event of events) {
    yield event;
  }
}

describe("Event Handlers", () => {
  describe("runWithHandlers", () => {
    it("calls onText handler for text events", async () => {
      const events: StreamEvent[] = [
        { type: "text", content: "Hello" },
        { type: "text", content: " World" },
      ];

      const onText = vi.fn();
      const handlers: EventHandlers = { onText };

      await runWithHandlers(createMockGenerator(events), handlers);

      expect(onText).toHaveBeenCalledTimes(2);
      expect(onText).toHaveBeenNthCalledWith(1, "Hello");
      expect(onText).toHaveBeenNthCalledWith(2, " World");
    });

    it("calls onGadgetCall handler for gadget_call events", async () => {
      const events: StreamEvent[] = [
        {
          type: "gadget_call",
          call: {
            gadgetName: "Calculator",
            parameters: { a: 5, b: 3 },
            parametersRaw: "a: 5\nb: 3",
          },
        },
      ];

      const onGadgetCall = vi.fn();
      const handlers: EventHandlers = { onGadgetCall };

      await runWithHandlers(createMockGenerator(events), handlers);

      expect(onGadgetCall).toHaveBeenCalledTimes(1);
      expect(onGadgetCall).toHaveBeenCalledWith({
        gadgetName: "Calculator",
        parameters: { a: 5, b: 3 },
        parametersRaw: "a: 5\nb: 3",
      });
    });

    it("calls onGadgetResult handler for gadget_result events", async () => {
      const events: StreamEvent[] = [
        {
          type: "gadget_result",
          result: {
            gadgetName: "Calculator",
            result: "8",
            parameters: { a: 5, b: 3 },
          },
        },
      ];

      const onGadgetResult = vi.fn();
      const handlers: EventHandlers = { onGadgetResult };

      await runWithHandlers(createMockGenerator(events), handlers);

      expect(onGadgetResult).toHaveBeenCalledTimes(1);
      expect(onGadgetResult).toHaveBeenCalledWith({
        gadgetName: "Calculator",
        result: "8",
        parameters: { a: 5, b: 3 },
      });
    });

    it("calls onGadgetResult handler for gadget errors", async () => {
      const events: StreamEvent[] = [
        {
          type: "gadget_result",
          result: {
            gadgetName: "Calculator",
            error: "Division by zero",
            parameters: { a: 5, b: 0 },
          },
        },
      ];

      const onGadgetResult = vi.fn();
      const handlers: EventHandlers = { onGadgetResult };

      await runWithHandlers(createMockGenerator(events), handlers);

      expect(onGadgetResult).toHaveBeenCalledTimes(1);
      expect(onGadgetResult).toHaveBeenCalledWith({
        gadgetName: "Calculator",
        error: "Division by zero",
        parameters: { a: 5, b: 0 },
      });
    });

    it("calls onHumanInputRequired handler for human_input_required events", async () => {
      const events: StreamEvent[] = [
        {
          type: "human_input_required",
          question: "What is your API key?",
          gadgetName: "APIKeyInput",
        },
      ];

      const onHumanInputRequired = vi.fn();
      const handlers: EventHandlers = { onHumanInputRequired };

      await runWithHandlers(createMockGenerator(events), handlers);

      expect(onHumanInputRequired).toHaveBeenCalledTimes(1);
      expect(onHumanInputRequired).toHaveBeenCalledWith({
        question: "What is your API key?",
        gadgetName: "APIKeyInput",
      });
    });

    it("calls onOther handler for unknown event types", async () => {
      const events: StreamEvent[] = [
        {
          type: "iteration_start",
          iteration: 1,
        } as StreamEvent,
      ];

      const onOther = vi.fn();
      const handlers: EventHandlers = { onOther };

      await runWithHandlers(createMockGenerator(events), handlers);

      expect(onOther).toHaveBeenCalledTimes(1);
      expect(onOther).toHaveBeenCalledWith({
        type: "iteration_start",
        iteration: 1,
      });
    });

    it("handles mixed event types with multiple handlers", async () => {
      const events: StreamEvent[] = [
        { type: "text", content: "Processing..." },
        {
          type: "gadget_call",
          call: {
            gadgetName: "Math",
            parameters: { x: 10 },
            parametersRaw: "x: 10",
          },
        },
        {
          type: "gadget_result",
          result: {
            gadgetName: "Math",
            result: "100",
            parameters: { x: 10 },
          },
        },
        { type: "text", content: " Done!" },
      ];

      const onText = vi.fn();
      const onGadgetCall = vi.fn();
      const onGadgetResult = vi.fn();

      const handlers: EventHandlers = {
        onText,
        onGadgetCall,
        onGadgetResult,
      };

      await runWithHandlers(createMockGenerator(events), handlers);

      expect(onText).toHaveBeenCalledTimes(2);
      expect(onGadgetCall).toHaveBeenCalledTimes(1);
      expect(onGadgetResult).toHaveBeenCalledTimes(1);
    });

    it("handles async handlers", async () => {
      const events: StreamEvent[] = [{ type: "text", content: "Hello" }];

      const onText = vi.fn(async (content: string) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return content.toUpperCase();
      });

      const handlers: EventHandlers = { onText };

      await runWithHandlers(createMockGenerator(events), handlers);

      expect(onText).toHaveBeenCalledWith("Hello");
    });

    it("does nothing when no handlers match", async () => {
      const events: StreamEvent[] = [
        { type: "text", content: "Hello" },
        {
          type: "gadget_call",
          call: {
            gadgetName: "Test",
            parameters: {},
            parametersRaw: "",
          },
        },
      ];

      const handlers: EventHandlers = {
        onGadgetResult: vi.fn(),
      };

      await runWithHandlers(createMockGenerator(events), handlers);

      expect(handlers.onGadgetResult).not.toHaveBeenCalled();
    });

    it("handles empty event stream", async () => {
      const events: StreamEvent[] = [];

      const onText = vi.fn();
      const handlers: EventHandlers = { onText };

      await runWithHandlers(createMockGenerator(events), handlers);

      expect(onText).not.toHaveBeenCalled();
    });
  });

  describe("collectEvents", () => {
    it("collects text events when requested", async () => {
      const events: StreamEvent[] = [
        { type: "text", content: "Hello" },
        { type: "text", content: " World" },
        { type: "text", content: "!" },
      ];

      const result = await collectEvents(createMockGenerator(events), { text: true });

      expect(result.text).toEqual(["Hello", " World", "!"]);
      expect(result.gadgetCalls).toEqual([]);
      expect(result.gadgetResults).toEqual([]);
    });

    it("collects gadget calls when requested", async () => {
      const events: StreamEvent[] = [
        {
          type: "gadget_call",
          call: {
            gadgetName: "Math",
            parameters: { a: 1, b: 2 },
            parametersRaw: "a: 1\nb: 2",
          },
        },
        {
          type: "gadget_call",
          call: {
            gadgetName: "String",
            parameters: { text: "hello" },
            parametersRaw: "text: hello",
          },
        },
      ];

      const result = await collectEvents(createMockGenerator(events), { gadgetCalls: true });

      expect(result.gadgetCalls).toEqual([
        { gadgetName: "Math", parameters: { a: 1, b: 2 } },
        { gadgetName: "String", parameters: { text: "hello" } },
      ]);
      expect(result.text).toEqual([]);
      expect(result.gadgetResults).toEqual([]);
    });

    it("collects gadget results when requested", async () => {
      const events: StreamEvent[] = [
        {
          type: "gadget_result",
          result: {
            gadgetName: "Math",
            result: "3",
            parameters: { a: 1, b: 2 },
          },
        },
        {
          type: "gadget_result",
          result: {
            gadgetName: "Error",
            error: "Failed",
            parameters: {},
          },
        },
      ];

      const result = await collectEvents(createMockGenerator(events), { gadgetResults: true });

      expect(result.gadgetResults).toEqual([
        {
          gadgetName: "Math",
          result: "3",
          parameters: { a: 1, b: 2 },
        },
        {
          gadgetName: "Error",
          error: "Failed",
          parameters: {},
        },
      ]);
      expect(result.text).toEqual([]);
      expect(result.gadgetCalls).toEqual([]);
    });

    it("collects multiple event types simultaneously", async () => {
      const events: StreamEvent[] = [
        { type: "text", content: "Start" },
        {
          type: "gadget_call",
          call: {
            gadgetName: "Test",
            parameters: { x: 1 },
            parametersRaw: "x: 1",
          },
        },
        {
          type: "gadget_result",
          result: {
            gadgetName: "Test",
            result: "OK",
            parameters: { x: 1 },
          },
        },
        { type: "text", content: "End" },
      ];

      const result = await collectEvents(createMockGenerator(events), {
        text: true,
        gadgetCalls: true,
        gadgetResults: true,
      });

      expect(result.text).toEqual(["Start", "End"]);
      expect(result.gadgetCalls).toEqual([{ gadgetName: "Test", parameters: { x: 1 } }]);
      expect(result.gadgetResults).toHaveLength(1);
    });

    it("ignores events not requested", async () => {
      const events: StreamEvent[] = [
        { type: "text", content: "Hello" },
        {
          type: "gadget_call",
          call: {
            gadgetName: "Test",
            parameters: {},
            parametersRaw: "",
          },
        },
        {
          type: "gadget_result",
          result: {
            gadgetName: "Test",
            result: "OK",
            parameters: {},
          },
        },
      ];

      const result = await collectEvents(createMockGenerator(events), { text: true });

      expect(result.text).toEqual(["Hello"]);
      expect(result.gadgetCalls).toEqual([]);
      expect(result.gadgetResults).toEqual([]);
    });

    it("handles empty collection request", async () => {
      const events: StreamEvent[] = [{ type: "text", content: "Hello" }];

      const result = await collectEvents(createMockGenerator(events), {});

      expect(result.text).toEqual([]);
      expect(result.gadgetCalls).toEqual([]);
      expect(result.gadgetResults).toEqual([]);
    });

    it("handles empty event stream", async () => {
      const events: StreamEvent[] = [];

      const result = await collectEvents(createMockGenerator(events), {
        text: true,
        gadgetCalls: true,
        gadgetResults: true,
      });

      expect(result.text).toEqual([]);
      expect(result.gadgetCalls).toEqual([]);
      expect(result.gadgetResults).toEqual([]);
    });

    it("skips gadget calls without parameters", async () => {
      const events: StreamEvent[] = [
        {
          type: "gadget_call",
          call: {
            gadgetName: "NoParams",
            parametersRaw: "",
          },
        },
      ];

      const result = await collectEvents(createMockGenerator(events), { gadgetCalls: true });

      expect(result.gadgetCalls).toEqual([]);
    });
  });

  describe("collectText", () => {
    it("collects all text chunks into a single string", async () => {
      const events: StreamEvent[] = [
        { type: "text", content: "Hello" },
        { type: "text", content: " " },
        { type: "text", content: "World" },
        { type: "text", content: "!" },
      ];

      const result = await collectText(createMockGenerator(events));

      expect(result).toBe("Hello World!");
    });

    it("ignores non-text events", async () => {
      const events: StreamEvent[] = [
        { type: "text", content: "Start" },
        {
          type: "gadget_call",
          call: {
            gadgetName: "Test",
            parameters: {},
            parametersRaw: "",
          },
        },
        {
          type: "gadget_result",
          result: {
            gadgetName: "Test",
            result: "ignored",
            parameters: {},
          },
        },
        { type: "text", content: "End" },
      ];

      const result = await collectText(createMockGenerator(events));

      expect(result).toBe("StartEnd");
    });

    it("returns empty string for no text events", async () => {
      const events: StreamEvent[] = [
        {
          type: "gadget_call",
          call: {
            gadgetName: "Test",
            parameters: {},
            parametersRaw: "",
          },
        },
      ];

      const result = await collectText(createMockGenerator(events));

      expect(result).toBe("");
    });

    it("returns empty string for empty stream", async () => {
      const events: StreamEvent[] = [];

      const result = await collectText(createMockGenerator(events));

      expect(result).toBe("");
    });

    it("handles multiline text", async () => {
      const events: StreamEvent[] = [
        { type: "text", content: "Line 1\n" },
        { type: "text", content: "Line 2\n" },
        { type: "text", content: "Line 3" },
      ];

      const result = await collectText(createMockGenerator(events));

      expect(result).toBe("Line 1\nLine 2\nLine 3");
    });

    it("preserves whitespace and special characters", async () => {
      const events: StreamEvent[] = [
        { type: "text", content: "  \t\n" },
        { type: "text", content: "Special: !@#$%^&*()" },
        { type: "text", content: "\n\n" },
      ];

      const result = await collectText(createMockGenerator(events));

      expect(result).toBe("  \t\nSpecial: !@#$%^&*()\n\n");
    });
  });
});
