import { Readable, Writable } from "node:stream";
import { NodeRuntime, Screen, setRuntime } from "@unblessed/node";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createBlockLayout } from "./layout.js";

// TUI tests use mock streams - no real TTY needed

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

describe("createBlockLayout", () => {
  describe("with hints enabled (default: showHints = true)", () => {
    test("returns an object with all required layout widgets", () => {
      const layout = createBlockLayout(screen);
      expect(layout.body).toBeDefined();
      expect(layout.promptLabel).toBeDefined();
      expect(layout.inputBar).toBeDefined();
      expect(layout.statusBar).toBeDefined();
      expect(layout.hintsBar).toBeDefined();
    });

    test("hintsBar is not null", () => {
      const layout = createBlockLayout(screen);
      expect(layout.hintsBar).not.toBeNull();
    });

    test("body height is '100%-3' (leaves room for input, status, hints)", () => {
      const layout = createBlockLayout(screen);
      expect((layout.body as unknown as { options: Record<string, unknown> }).options.height).toBe(
        "100%-3",
      );
    });

    test("statusBar bottom is 1 (above hints bar)", () => {
      const layout = createBlockLayout(screen);
      expect(
        (layout.statusBar as unknown as { options: Record<string, unknown> }).options.bottom,
      ).toBe(1);
    });

    test("inputBar is positioned above the status bar (bottom=2)", () => {
      const layout = createBlockLayout(screen);
      expect(
        (layout.inputBar as unknown as { options: Record<string, unknown> }).options.bottom,
      ).toBe(2);
    });

    test("promptLabel is at the same bottom as inputBar (bottom=2)", () => {
      const layout = createBlockLayout(screen);
      expect(
        (layout.promptLabel as unknown as { options: Record<string, unknown> }).options.bottom,
      ).toBe(2);
    });

    test("hintsBar is at bottom=0 (very bottom of the screen)", () => {
      const layout = createBlockLayout(screen);
      expect(
        (layout.hintsBar as unknown as { options: Record<string, unknown> }).options.bottom,
      ).toBe(0);
    });

    test("body is scrollable", () => {
      const layout = createBlockLayout(screen);
      expect(
        (layout.body as unknown as { options: Record<string, unknown> }).options.scrollable,
      ).toBe(true);
    });

    test("body spans full width", () => {
      const layout = createBlockLayout(screen);
      expect((layout.body as unknown as { options: Record<string, unknown> }).options.width).toBe(
        "100%",
      );
    });
  });

  describe("with hints disabled (showHints = false)", () => {
    test("hintsBar is null", () => {
      const layout = createBlockLayout(screen, false);
      expect(layout.hintsBar).toBeNull();
    });

    test("body height is '100%-2' (leaves room for input and status only)", () => {
      const layout = createBlockLayout(screen, false);
      expect((layout.body as unknown as { options: Record<string, unknown> }).options.height).toBe(
        "100%-2",
      );
    });

    test("statusBar bottom is 0 (at very bottom when no hints)", () => {
      const layout = createBlockLayout(screen, false);
      expect(
        (layout.statusBar as unknown as { options: Record<string, unknown> }).options.bottom,
      ).toBe(0);
    });

    test("inputBar bottom is 1 (above status bar)", () => {
      const layout = createBlockLayout(screen, false);
      expect(
        (layout.inputBar as unknown as { options: Record<string, unknown> }).options.bottom,
      ).toBe(1);
    });

    test("promptLabel bottom is 1 (matches inputBar position)", () => {
      const layout = createBlockLayout(screen, false);
      expect(
        (layout.promptLabel as unknown as { options: Record<string, unknown> }).options.bottom,
      ).toBe(1);
    });

    test("still returns body, promptLabel, inputBar and statusBar", () => {
      const layout = createBlockLayout(screen, false);
      expect(layout.body).toBeDefined();
      expect(layout.promptLabel).toBeDefined();
      expect(layout.inputBar).toBeDefined();
      expect(layout.statusBar).toBeDefined();
    });
  });

  describe("widget properties", () => {
    test("promptLabel has content '> '", () => {
      const layout = createBlockLayout(screen);
      expect(layout.promptLabel.getContent()).toBe("> ");
    });

    test("statusBar has tags disabled (uses ANSI codes directly)", () => {
      const layout = createBlockLayout(screen);
      expect(
        (layout.statusBar as unknown as { options: Record<string, unknown> }).options.tags,
      ).toBe(false);
    });

    test("body starts at top=0 left=0", () => {
      const layout = createBlockLayout(screen);
      const opts = (layout.body as unknown as { options: Record<string, unknown> }).options;
      expect(opts.top).toBe(0);
      expect(opts.left).toBe(0);
    });
  });
});
