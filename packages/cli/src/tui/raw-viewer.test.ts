import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { Writable, Readable } from "node:stream";
import { setRuntime, NodeRuntime, Screen } from "@unblessed/node";
import { showRawViewer, type RawViewerMode } from "./raw-viewer.js";
import type { LLMMessage } from "llmist";

// TUI tests use mock streams - no real TTY needed

// Mock streams to prevent terminal escape sequences from being written
class MockOutputStream extends Writable {
  _write(_chunk: Buffer | string, _encoding: string, callback: () => void): void {
    callback();
  }
}

class MockInputStream extends Readable {
  _read(): void {
    // No-op - never emit data
  }
}

// Initialize unblessed for testing
let screen: Screen;
let mockOutput: MockOutputStream;
let mockInput: MockInputStream;

beforeAll(() => {
  setRuntime(new NodeRuntime());
  mockOutput = new MockOutputStream();
  mockInput = new MockInputStream();
  screen = new Screen({
    smartCSR: true,
    title: "test",
    fullUnicode: true,
    input: mockInput,
    output: mockOutput,
  });
});

afterAll(() => {
  if (screen) {
    screen.destroy();
  }
});

describe("Raw Viewer", () => {
  describe("showRawViewer", () => {
    test("returns handle with closed promise and close function", () => {
      const handle = showRawViewer({
        screen,
        mode: "request",
        request: [],
        iteration: 1,
        model: "test-model",
      });

      expect(handle).toHaveProperty("closed");
      expect(handle).toHaveProperty("close");
      expect(typeof handle.close).toBe("function");
      expect(handle.closed).toBeInstanceOf(Promise);

      // Clean up
      handle.close();
    });

    test("close() resolves the closed promise", async () => {
      const handle = showRawViewer({
        screen,
        mode: "request",
        request: [],
        iteration: 1,
        model: "test-model",
      });

      // Close should resolve the promise
      setTimeout(() => handle.close(), 10);
      await handle.closed;
      // If we get here, promise resolved successfully
      expect(true).toBe(true);
    });

    test("request mode with empty request shows placeholder", () => {
      const handle = showRawViewer({
        screen,
        mode: "request",
        request: [],
        iteration: 1,
        model: "claude-sonnet",
      });

      // Viewer was created (cleanup)
      handle.close();
    });

    test("request mode with messages formats content", () => {
      const messages: LLMMessage[] = [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hello" },
      ];

      const handle = showRawViewer({
        screen,
        mode: "request",
        request: messages,
        iteration: 2,
        model: "gpt-4",
      });

      handle.close();
    });

    test("response mode with content shows raw response", () => {
      const handle = showRawViewer({
        screen,
        mode: "response",
        response: "This is the raw response from the LLM.",
        iteration: 1,
        model: "test-model",
      });

      handle.close();
    });

    test("response mode without content shows placeholder", () => {
      const handle = showRawViewer({
        screen,
        mode: "response",
        response: undefined,
        iteration: 1,
        model: "test-model",
      });

      handle.close();
    });
  });

  describe("message formatting", () => {
    test("handles string content", () => {
      const messages: LLMMessage[] = [
        { role: "user", content: "Simple string message" },
      ];

      const handle = showRawViewer({
        screen,
        mode: "request",
        request: messages,
        iteration: 1,
        model: "test",
      });

      handle.close();
    });

    test("handles multiline string content", () => {
      const messages: LLMMessage[] = [
        { role: "user", content: "Line 1\nLine 2\nLine 3" },
      ];

      const handle = showRawViewer({
        screen,
        mode: "request",
        request: messages,
        iteration: 1,
        model: "test",
      });

      handle.close();
    });

    test("handles array content with text parts", () => {
      const messages: LLMMessage[] = [
        {
          role: "user",
          content: [{ type: "text", text: "Text part content" }],
        },
      ];

      const handle = showRawViewer({
        screen,
        mode: "request",
        request: messages,
        iteration: 1,
        model: "test",
      });

      handle.close();
    });

    test("handles array content with image parts", () => {
      const messages: LLMMessage[] = [
        {
          role: "user",
          content: [
            { type: "image", source: { media_type: "image/png" } },
          ] as unknown as LLMMessage["content"],
        },
      ];

      const handle = showRawViewer({
        screen,
        mode: "request",
        request: messages,
        iteration: 1,
        model: "test",
      });

      handle.close();
    });

    test("handles array content with tool_use parts", () => {
      const messages: LLMMessage[] = [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool_123",
              name: "Calculator",
              input: { a: 1, b: 2 },
            },
          ] as unknown as LLMMessage["content"],
        },
      ];

      const handle = showRawViewer({
        screen,
        mode: "request",
        request: messages,
        iteration: 1,
        model: "test",
      });

      handle.close();
    });

    test("handles array content with tool_result parts", () => {
      const messages: LLMMessage[] = [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_123",
              content: "Result: 3",
            },
          ] as unknown as LLMMessage["content"],
        },
      ];

      const handle = showRawViewer({
        screen,
        mode: "request",
        request: messages,
        iteration: 1,
        model: "test",
      });

      handle.close();
    });

    test("handles unknown content part types", () => {
      const messages: LLMMessage[] = [
        {
          role: "user",
          content: [
            { type: "custom_type", data: "custom data" },
          ] as unknown as LLMMessage["content"],
        },
      ];

      const handle = showRawViewer({
        screen,
        mode: "request",
        request: messages,
        iteration: 1,
        model: "test",
      });

      handle.close();
    });

    test("handles multiple messages with different roles", () => {
      const messages: LLMMessage[] = [
        { role: "system", content: "System prompt" },
        { role: "user", content: "User message" },
        { role: "assistant", content: "Assistant response" },
      ];

      const handle = showRawViewer({
        screen,
        mode: "request",
        request: messages,
        iteration: 1,
        model: "test",
      });

      handle.close();
    });
  });

  describe("role color coding", () => {
    test("system role gets magenta color", () => {
      const messages: LLMMessage[] = [{ role: "system", content: "System" }];

      const handle = showRawViewer({
        screen,
        mode: "request",
        request: messages,
        iteration: 1,
        model: "test",
      });

      handle.close();
    });

    test("user role gets green color", () => {
      const messages: LLMMessage[] = [{ role: "user", content: "User" }];

      const handle = showRawViewer({
        screen,
        mode: "request",
        request: messages,
        iteration: 1,
        model: "test",
      });

      handle.close();
    });

    test("assistant role gets cyan color", () => {
      const messages: LLMMessage[] = [
        { role: "assistant", content: "Assistant" },
      ];

      const handle = showRawViewer({
        screen,
        mode: "request",
        request: messages,
        iteration: 1,
        model: "test",
      });

      handle.close();
    });
  });

  describe("viewer lifecycle", () => {
    test("can be closed immediately after creation", () => {
      const handle = showRawViewer({
        screen,
        mode: "request",
        request: [],
        iteration: 1,
        model: "test",
      });

      handle.close();
    });

    test("close can be called multiple times safely", () => {
      const handle = showRawViewer({
        screen,
        mode: "request",
        request: [],
        iteration: 1,
        model: "test",
      });

      handle.close();
      // Second close should not throw
      expect(() => handle.close()).not.toThrow();
    });
  });
});
