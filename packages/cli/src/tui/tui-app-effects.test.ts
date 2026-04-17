import { beforeEach, describe, expect, test, vi } from "vitest";
import { applyContentFilterMode, applyFocusMode } from "./tui-app-effects.js";
import type { ContentFilterMode, FocusMode, TUIBlockLayout, TUIScreenContext } from "./types.js";

// All dependencies are mocked as plain objects — no real screen or widgets needed.

function makeMockLayout(): TUIBlockLayout {
  return {
    body: { focus: vi.fn() } as unknown as TUIBlockLayout["body"],
    promptLabel: {} as TUIBlockLayout["promptLabel"],
    inputBar: {} as TUIBlockLayout["inputBar"],
    statusBar: {} as TUIBlockLayout["statusBar"],
    hintsBar: null,
  };
}

function makeMockStatusBar() {
  return {
    setFocusMode: vi.fn(),
    setContentFilterMode: vi.fn(),
  };
}

function makeMockInputHandler() {
  return {
    activate: vi.fn(),
    deactivate: vi.fn(),
  };
}

function makeMockBlockRenderer() {
  return {
    setContentFilterMode: vi.fn(),
  };
}

function makeMockScreenCtx(): TUIScreenContext {
  return {
    screen: {} as TUIScreenContext["screen"],
    requestRender: vi.fn(),
    renderNow: vi.fn(),
    destroy: vi.fn(),
  };
}

describe("applyFocusMode", () => {
  let layout: TUIBlockLayout;
  let statusBar: ReturnType<typeof makeMockStatusBar>;
  let inputHandler: ReturnType<typeof makeMockInputHandler>;
  let screenCtx: TUIScreenContext;

  beforeEach(() => {
    layout = makeMockLayout();
    statusBar = makeMockStatusBar();
    inputHandler = makeMockInputHandler();
    screenCtx = makeMockScreenCtx();
  });

  test("updates statusBar with the new focus mode", () => {
    applyFocusMode("input", layout, statusBar as never, inputHandler as never, screenCtx);
    expect(statusBar.setFocusMode).toHaveBeenCalledWith("input");
  });

  test("updates statusBar with browse mode", () => {
    applyFocusMode("browse", layout, statusBar as never, inputHandler as never, screenCtx);
    expect(statusBar.setFocusMode).toHaveBeenCalledWith("browse");
  });

  describe("when mode is 'input'", () => {
    test("calls inputHandler.activate()", () => {
      applyFocusMode("input", layout, statusBar as never, inputHandler as never, screenCtx);
      expect(inputHandler.activate).toHaveBeenCalledOnce();
    });

    test("does not call inputHandler.deactivate()", () => {
      applyFocusMode("input", layout, statusBar as never, inputHandler as never, screenCtx);
      expect(inputHandler.deactivate).not.toHaveBeenCalled();
    });

    test("does not call layout.body.focus()", () => {
      applyFocusMode("input", layout, statusBar as never, inputHandler as never, screenCtx);
      expect(layout.body.focus).not.toHaveBeenCalled();
    });
  });

  describe("when mode is 'browse'", () => {
    test("calls inputHandler.deactivate()", () => {
      applyFocusMode("browse", layout, statusBar as never, inputHandler as never, screenCtx);
      expect(inputHandler.deactivate).toHaveBeenCalledOnce();
    });

    test("calls layout.body.focus() to move focus away from textbox", () => {
      applyFocusMode("browse", layout, statusBar as never, inputHandler as never, screenCtx);
      expect(layout.body.focus).toHaveBeenCalledOnce();
    });

    test("does not call inputHandler.activate()", () => {
      applyFocusMode("browse", layout, statusBar as never, inputHandler as never, screenCtx);
      expect(inputHandler.activate).not.toHaveBeenCalled();
    });
  });

  test("calls screenCtx.renderNow() for immediate visual update", () => {
    applyFocusMode("input", layout, statusBar as never, inputHandler as never, screenCtx);
    expect(screenCtx.renderNow).toHaveBeenCalledOnce();
  });

  test("calls renderNow for browse mode too", () => {
    applyFocusMode("browse", layout, statusBar as never, inputHandler as never, screenCtx);
    expect(screenCtx.renderNow).toHaveBeenCalledOnce();
  });

  test("calls statusBar, inputHandler, and renderNow in a single invocation", () => {
    const mode: FocusMode = "input";
    applyFocusMode(mode, layout, statusBar as never, inputHandler as never, screenCtx);

    expect(statusBar.setFocusMode).toHaveBeenCalledWith(mode);
    expect(inputHandler.activate).toHaveBeenCalled();
    expect(screenCtx.renderNow).toHaveBeenCalled();
  });
});

describe("applyContentFilterMode", () => {
  let blockRenderer: ReturnType<typeof makeMockBlockRenderer>;
  let statusBar: ReturnType<typeof makeMockStatusBar>;
  let screenCtx: TUIScreenContext;

  beforeEach(() => {
    blockRenderer = makeMockBlockRenderer();
    statusBar = makeMockStatusBar();
    screenCtx = makeMockScreenCtx();
  });

  test("calls blockRenderer.setContentFilterMode with the provided mode", () => {
    applyContentFilterMode("full", blockRenderer as never, statusBar as never, screenCtx);
    expect(blockRenderer.setContentFilterMode).toHaveBeenCalledWith("full");
  });

  test("calls statusBar.setContentFilterMode with the provided mode", () => {
    applyContentFilterMode("focused", blockRenderer as never, statusBar as never, screenCtx);
    expect(statusBar.setContentFilterMode).toHaveBeenCalledWith("focused");
  });

  test("calls screenCtx.renderNow() for immediate visual update", () => {
    applyContentFilterMode("full", blockRenderer as never, statusBar as never, screenCtx);
    expect(screenCtx.renderNow).toHaveBeenCalledOnce();
  });

  describe("'full' content filter mode", () => {
    test("propagates 'full' mode to blockRenderer", () => {
      applyContentFilterMode("full", blockRenderer as never, statusBar as never, screenCtx);
      expect(blockRenderer.setContentFilterMode).toHaveBeenCalledWith("full");
    });

    test("propagates 'full' mode to statusBar", () => {
      applyContentFilterMode("full", blockRenderer as never, statusBar as never, screenCtx);
      expect(statusBar.setContentFilterMode).toHaveBeenCalledWith("full");
    });
  });

  describe("'focused' content filter mode", () => {
    test("propagates 'focused' mode to blockRenderer", () => {
      applyContentFilterMode("focused", blockRenderer as never, statusBar as never, screenCtx);
      expect(blockRenderer.setContentFilterMode).toHaveBeenCalledWith("focused");
    });

    test("propagates 'focused' mode to statusBar", () => {
      applyContentFilterMode("focused", blockRenderer as never, statusBar as never, screenCtx);
      expect(statusBar.setContentFilterMode).toHaveBeenCalledWith("focused");
    });
  });

  test("updates both blockRenderer and statusBar in a single call", () => {
    const mode: ContentFilterMode = "focused";
    applyContentFilterMode(mode, blockRenderer as never, statusBar as never, screenCtx);

    expect(blockRenderer.setContentFilterMode).toHaveBeenCalledWith(mode);
    expect(statusBar.setContentFilterMode).toHaveBeenCalledWith(mode);
    expect(screenCtx.renderNow).toHaveBeenCalled();
  });
});
