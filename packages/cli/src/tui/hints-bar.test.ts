import type { Box } from "@unblessed/node";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HintsBar } from "./hints-bar.js";

// ANSI color codes used by HintsBar
const GRAY = "\x1b[90m";
const RESET = "\x1b[0m";

function createMockBox(): { setContent: ReturnType<typeof vi.fn>; box: Box } {
  const setContent = vi.fn();
  const box = { setContent } as unknown as Box;
  return { setContent, box };
}

describe("HintsBar", () => {
  let setContent: ReturnType<typeof vi.fn>;
  let renderCallback: ReturnType<typeof vi.fn>;
  let box: Box;

  beforeEach(() => {
    const mock = createMockBox();
    setContent = mock.setContent;
    box = mock.box;
    renderCallback = vi.fn();
  });

  describe("constructor", () => {
    it("calls render on initialization", () => {
      new HintsBar(box, renderCallback);

      expect(setContent).toHaveBeenCalledOnce();
      expect(renderCallback).toHaveBeenCalledOnce();
    });

    it("renders browse mode hints by default", () => {
      new HintsBar(box, renderCallback);

      const content = setContent.mock.calls[0][0] as string;
      expect(content).toContain("j/k nav");
      expect(content).toContain("Enter expand");
      expect(content).toContain("^B input");
      expect(content).toContain("^K focused");
    });
  });

  describe("setFocusMode()", () => {
    it("triggers re-render when mode changes", () => {
      const bar = new HintsBar(box, renderCallback);
      setContent.mockClear();
      renderCallback.mockClear();

      bar.setFocusMode("input");

      expect(setContent).toHaveBeenCalledOnce();
      expect(renderCallback).toHaveBeenCalledOnce();
    });

    it("does NOT re-render when mode is the same", () => {
      const bar = new HintsBar(box, renderCallback);
      // Default focusMode is "browse"
      setContent.mockClear();
      renderCallback.mockClear();

      bar.setFocusMode("browse");

      expect(setContent).not.toHaveBeenCalled();
      expect(renderCallback).not.toHaveBeenCalled();
    });

    it("re-renders when switching back to previous mode", () => {
      const bar = new HintsBar(box, renderCallback);
      bar.setFocusMode("input");
      setContent.mockClear();
      renderCallback.mockClear();

      bar.setFocusMode("browse");

      expect(setContent).toHaveBeenCalledOnce();
      expect(renderCallback).toHaveBeenCalledOnce();
    });
  });

  describe("setContentFilterMode()", () => {
    it("triggers re-render when mode changes", () => {
      const bar = new HintsBar(box, renderCallback);
      setContent.mockClear();
      renderCallback.mockClear();

      bar.setContentFilterMode("focused");

      expect(setContent).toHaveBeenCalledOnce();
      expect(renderCallback).toHaveBeenCalledOnce();
    });

    it("does NOT re-render when mode is the same", () => {
      const bar = new HintsBar(box, renderCallback);
      // Default contentFilterMode is "full"
      setContent.mockClear();
      renderCallback.mockClear();

      bar.setContentFilterMode("full");

      expect(setContent).not.toHaveBeenCalled();
      expect(renderCallback).not.toHaveBeenCalled();
    });

    it("re-renders when switching back to full mode", () => {
      const bar = new HintsBar(box, renderCallback);
      bar.setContentFilterMode("focused");
      setContent.mockClear();
      renderCallback.mockClear();

      bar.setContentFilterMode("full");

      expect(setContent).toHaveBeenCalledOnce();
      expect(renderCallback).toHaveBeenCalledOnce();
    });
  });

  describe("setHasContent()", () => {
    it("triggers re-render when value changes", () => {
      const bar = new HintsBar(box, renderCallback);
      bar.setFocusMode("input");
      setContent.mockClear();
      renderCallback.mockClear();

      bar.setHasContent(true);

      expect(setContent).toHaveBeenCalledOnce();
      expect(renderCallback).toHaveBeenCalledOnce();
    });

    it("does NOT re-render when value is the same", () => {
      const bar = new HintsBar(box, renderCallback);
      // Default hasContent is false
      setContent.mockClear();
      renderCallback.mockClear();

      bar.setHasContent(false);

      expect(setContent).not.toHaveBeenCalled();
      expect(renderCallback).not.toHaveBeenCalled();
    });
  });

  describe("focused content mode hints", () => {
    it("renders 'exit focused mode' hint when contentFilterMode is focused", () => {
      const bar = new HintsBar(box, renderCallback);
      bar.setContentFilterMode("focused");

      const content = setContent.mock.lastCall?.[0] as string;
      expect(content).toContain("^K exit focused mode");
    });

    it("does NOT render browse or input hints in focused content mode", () => {
      const bar = new HintsBar(box, renderCallback);
      bar.setContentFilterMode("focused");

      const content = setContent.mock.lastCall?.[0] as string;
      expect(content).not.toContain("j/k nav");
      expect(content).not.toContain("^S multiline");
      expect(content).not.toContain("^B");
    });

    it("shows focused content mode hint even when focusMode is input", () => {
      const bar = new HintsBar(box, renderCallback);
      bar.setFocusMode("input");
      bar.setContentFilterMode("focused");

      const content = setContent.mock.lastCall?.[0] as string;
      expect(content).toContain("^K exit focused mode");
      expect(content).not.toContain("^S multiline");
    });
  });

  describe("input mode hints", () => {
    it("renders multiline and focused hints in input mode", () => {
      const bar = new HintsBar(box, renderCallback);
      bar.setFocusMode("input");

      const content = setContent.mock.lastCall?.[0] as string;
      expect(content).toContain("^S multiline");
      expect(content).toContain("^K focused");
    });

    it("does NOT show browse hint when hasContent is false", () => {
      const bar = new HintsBar(box, renderCallback);
      bar.setFocusMode("input");
      // hasContent defaults to false

      const content = setContent.mock.lastCall?.[0] as string;
      expect(content).not.toContain("^B browse");
    });

    it("shows browse hint when hasContent is true", () => {
      const bar = new HintsBar(box, renderCallback);
      bar.setFocusMode("input");
      bar.setHasContent(true);

      const content = setContent.mock.lastCall?.[0] as string;
      expect(content).toContain("^B browse");
    });

    it("does NOT render browse navigation hints in input mode", () => {
      const bar = new HintsBar(box, renderCallback);
      bar.setFocusMode("input");

      const content = setContent.mock.lastCall?.[0] as string;
      expect(content).not.toContain("j/k nav");
      expect(content).not.toContain("Enter expand");
    });
  });

  describe("browse mode hints", () => {
    it("renders navigation hints in browse mode", () => {
      new HintsBar(box, renderCallback);
      // Default focusMode is "browse"

      const content = setContent.mock.lastCall?.[0] as string;
      expect(content).toContain("j/k nav");
      expect(content).toContain("Enter expand");
      expect(content).toContain("^B input");
      expect(content).toContain("^K focused");
    });

    it("does NOT show input-specific hints in browse mode", () => {
      new HintsBar(box, renderCallback);

      const content = setContent.mock.lastCall?.[0] as string;
      expect(content).not.toContain("^S multiline");
      expect(content).not.toContain("^B browse");
    });

    it("renders hint content with ANSI gray color wrapping", () => {
      new HintsBar(box, renderCallback);

      const content = setContent.mock.lastCall?.[0] as string;
      expect(content).toMatch(
        new RegExp(`^${GRAY.replace(/\[/g, "\\[")}.*${RESET.replace(/\[/g, "\\[")}$`),
      );
    });
  });

  describe("getFocusMode() / getContentFilterMode()", () => {
    it("returns current focus mode", () => {
      const bar = new HintsBar(box, renderCallback);
      expect(bar.getFocusMode()).toBe("browse");

      bar.setFocusMode("input");
      expect(bar.getFocusMode()).toBe("input");
    });

    it("returns current content filter mode", () => {
      const bar = new HintsBar(box, renderCallback);
      expect(bar.getContentFilterMode()).toBe("full");

      bar.setContentFilterMode("focused");
      expect(bar.getContentFilterMode()).toBe("focused");
    });
  });
});
