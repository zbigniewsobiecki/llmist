import { describe, expect, test, vi } from "vitest";
import { KeyActionHandler } from "./key-action-handler.js";

describe("KeyActionHandler", () => {
  const createMocks = () => ({
    controller: {
      handleCtrlC: vi.fn(),
      triggerCancel: vi.fn(),
      abort: vi.fn(),
      toggleFocusMode: vi.fn(),
      toggleContentFilterMode: vi.fn(),
    },
    blockRenderer: {
      addText: vi.fn(),
      handleUserScroll: vi.fn(),
      selectNext: vi.fn(),
      selectPrevious: vi.fn(),
      selectFirst: vi.fn(),
      selectLast: vi.fn(),
      enableFollowMode: vi.fn(),
      toggleExpand: vi.fn(),
      collapseOrDeselect: vi.fn(),
      getSelectedBlock: vi.fn(),
    },
    statusBar: {
      cycleProfile: vi.fn(),
    },
    screenCtx: {
      renderNow: vi.fn(),
      screen: {},
    },
    modalManager: {
      showRawViewer: vi.fn(),
    },
    layout: {
      body: {
        scroll: vi.fn(),
        height: 10,
      },
    },
  });

  test("handles ctrl_c - show hint", () => {
    const mocks = createMocks();
    mocks.controller.handleCtrlC.mockReturnValue("show_hint");
    const handler = new KeyActionHandler(
      mocks.controller as any,
      mocks.blockRenderer as any,
      mocks.statusBar as any,
      mocks.screenCtx as any,
      mocks.modalManager as any,
      mocks.layout as any,
    );

    handler.handleKeyAction({ type: "ctrl_c" });

    expect(mocks.controller.handleCtrlC).toHaveBeenCalled();
    expect(mocks.blockRenderer.addText).toHaveBeenCalledWith(
      expect.stringContaining("Ctrl+C again"),
    );
  });

  test("handles ctrl_c - quit", () => {
    const mocks = createMocks();
    mocks.controller.handleCtrlC.mockReturnValue("quit");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const handler = new KeyActionHandler(
      mocks.controller as any,
      mocks.blockRenderer as any,
      mocks.statusBar as any,
      mocks.screenCtx as any,
      mocks.modalManager as any,
      mocks.layout as any,
    );

    handler.handleKeyAction({ type: "ctrl_c" });

    expect(exitSpy).toHaveBeenCalledWith(130);
    exitSpy.mockRestore();
  });

  test("handles cancel", () => {
    const mocks = createMocks();
    const handler = new KeyActionHandler(
      mocks.controller as any,
      mocks.blockRenderer as any,
      mocks.statusBar as any,
      mocks.screenCtx as any,
      mocks.modalManager as any,
      mocks.layout as any,
    );

    handler.handleKeyAction({ type: "cancel" });

    expect(mocks.controller.triggerCancel).toHaveBeenCalled();
    expect(mocks.controller.abort).toHaveBeenCalled();
  });

  test("handles toggle_focus_mode", () => {
    const mocks = createMocks();
    const handler = new KeyActionHandler(
      mocks.controller as any,
      mocks.blockRenderer as any,
      mocks.statusBar as any,
      mocks.screenCtx as any,
      mocks.modalManager as any,
      mocks.layout as any,
    );

    handler.handleKeyAction({ type: "toggle_focus_mode" });

    expect(mocks.controller.toggleFocusMode).toHaveBeenCalled();
  });

  test("handles toggle_content_filter", () => {
    const mocks = createMocks();
    const handler = new KeyActionHandler(
      mocks.controller as any,
      mocks.blockRenderer as any,
      mocks.statusBar as any,
      mocks.screenCtx as any,
      mocks.modalManager as any,
      mocks.layout as any,
    );

    handler.handleKeyAction({ type: "toggle_content_filter" });

    expect(mocks.controller.toggleContentFilterMode).toHaveBeenCalled();
  });

  test("handles cycle_profile", () => {
    const mocks = createMocks();
    const handler = new KeyActionHandler(
      mocks.controller as any,
      mocks.blockRenderer as any,
      mocks.statusBar as any,
      mocks.screenCtx as any,
      mocks.modalManager as any,
      mocks.layout as any,
    );

    handler.handleKeyAction({ type: "cycle_profile" });

    expect(mocks.statusBar.cycleProfile).toHaveBeenCalled();
  });

  test("handles scroll_page up", () => {
    const mocks = createMocks();
    const handler = new KeyActionHandler(
      mocks.controller as any,
      mocks.blockRenderer as any,
      mocks.statusBar as any,
      mocks.screenCtx as any,
      mocks.modalManager as any,
      mocks.layout as any,
    );

    handler.handleKeyAction({ type: "scroll_page", direction: -1 });

    expect(mocks.layout.body.scroll).toHaveBeenCalledWith(-8); // height 10 - 2
    expect(mocks.blockRenderer.handleUserScroll).toHaveBeenCalled();
    expect(mocks.screenCtx.renderNow).toHaveBeenCalled();
  });

  test("handles scroll_page down", () => {
    const mocks = createMocks();
    const handler = new KeyActionHandler(
      mocks.controller as any,
      mocks.blockRenderer as any,
      mocks.statusBar as any,
      mocks.screenCtx as any,
      mocks.modalManager as any,
      mocks.layout as any,
    );

    handler.handleKeyAction({ type: "scroll_page", direction: 1 });

    expect(mocks.layout.body.scroll).toHaveBeenCalledWith(8); // height 10 - 2
    expect(mocks.blockRenderer.handleUserScroll).toHaveBeenCalled();
    expect(mocks.screenCtx.renderNow).toHaveBeenCalled();
  });

  test("handles scroll_line", () => {
    const mocks = createMocks();
    const handler = new KeyActionHandler(
      mocks.controller as any,
      mocks.blockRenderer as any,
      mocks.statusBar as any,
      mocks.screenCtx as any,
      mocks.modalManager as any,
      mocks.layout as any,
    );

    handler.handleKeyAction({ type: "scroll_line", direction: 1 });

    expect(mocks.layout.body.scroll).toHaveBeenCalledWith(1);
    expect(mocks.blockRenderer.handleUserScroll).toHaveBeenCalled();
    expect(mocks.screenCtx.renderNow).toHaveBeenCalled();
  });

  test("handles navigation - select_next", () => {
    const mocks = createMocks();
    const handler = new KeyActionHandler(
      mocks.controller as any,
      mocks.blockRenderer as any,
      mocks.statusBar as any,
      mocks.screenCtx as any,
      mocks.modalManager as any,
      mocks.layout as any,
    );

    handler.handleKeyAction({ type: "navigation", action: "select_next" });

    expect(mocks.blockRenderer.selectNext).toHaveBeenCalled();
    expect(mocks.screenCtx.renderNow).toHaveBeenCalled();
  });

  test("handles navigation - select_last", () => {
    const mocks = createMocks();
    const handler = new KeyActionHandler(
      mocks.controller as any,
      mocks.blockRenderer as any,
      mocks.statusBar as any,
      mocks.screenCtx as any,
      mocks.modalManager as any,
      mocks.layout as any,
    );

    handler.handleKeyAction({ type: "navigation", action: "select_last" });

    expect(mocks.blockRenderer.selectLast).toHaveBeenCalled();
    expect(mocks.blockRenderer.enableFollowMode).toHaveBeenCalled();
    expect(mocks.screenCtx.renderNow).toHaveBeenCalled();
  });

  test("handles raw_viewer for llm_call", async () => {
    const mocks = createMocks();
    const node = {
      type: "llm_call",
      rawRequest: [],
      rawResponse: "response",
      iteration: 1,
      model: "gpt-4",
    };
    mocks.blockRenderer.getSelectedBlock.mockReturnValue({ node });

    const handler = new KeyActionHandler(
      mocks.controller as any,
      mocks.blockRenderer as any,
      mocks.statusBar as any,
      mocks.screenCtx as any,
      mocks.modalManager as any,
      mocks.layout as any,
    );

    handler.handleKeyAction({ type: "raw_viewer", mode: "request" });

    // Wait for the async IIFE to complete (using a small delay since we can't await it directly)
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.modalManager.showRawViewer).toHaveBeenCalledWith(mocks.screenCtx.screen, {
      mode: "request",
      request: node.rawRequest,
      response: node.rawResponse,
      iteration: node.iteration,
      model: node.model,
    });
  });

  test("handles raw_viewer for gadget", async () => {
    const mocks = createMocks();
    const node = {
      type: "gadget",
      name: "ReadFile",
      parameters: { path: "test.txt" },
      result: "content",
      error: undefined,
    };
    mocks.blockRenderer.getSelectedBlock.mockReturnValue({ node });

    const handler = new KeyActionHandler(
      mocks.controller as any,
      mocks.blockRenderer as any,
      mocks.statusBar as any,
      mocks.screenCtx as any,
      mocks.modalManager as any,
      mocks.layout as any,
    );

    handler.handleKeyAction({ type: "raw_viewer", mode: "response" });

    // Wait for the async IIFE
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.modalManager.showRawViewer).toHaveBeenCalledWith(mocks.screenCtx.screen, {
      mode: "response",
      gadgetName: node.name,
      parameters: node.parameters,
      result: node.result,
      error: node.error,
    });
  });

  test("handles raw_viewer when nothing selected", async () => {
    const mocks = createMocks();
    mocks.blockRenderer.getSelectedBlock.mockReturnValue(null);

    const handler = new KeyActionHandler(
      mocks.controller as any,
      mocks.blockRenderer as any,
      mocks.statusBar as any,
      mocks.screenCtx as any,
      mocks.modalManager as any,
      mocks.layout as any,
    );

    handler.handleKeyAction({ type: "raw_viewer", mode: "request" });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.modalManager.showRawViewer).not.toHaveBeenCalled();
  });
});
