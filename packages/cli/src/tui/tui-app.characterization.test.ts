import { beforeEach, describe, expect, test, vi } from "vitest";
import { BlockRenderer } from "./block-renderer.js";
import { TUIController } from "./controller.js";
import { HintsBar } from "./hints-bar.js";
import { TUIApp } from "./index.js";
import { InputHandler } from "./input-handler.js";
import { KeyboardManager } from "./keymap.js";
import { createBlockLayout } from "./layout.js";
import { ModalManager } from "./modal-manager.js";
import { createScreen } from "./screen.js";
import { StatusBar } from "./status-bar.js";

// Mock internal components
vi.mock("./screen.js", () => ({
  createScreen: vi.fn(() => ({
    screen: {
      on: vi.fn(),
      key: vi.fn(),
      render: vi.fn(),
      destroy: vi.fn(),
    },
    requestRender: vi.fn(),
    renderNow: vi.fn(),
    destroy: vi.fn(),
  })),
}));

vi.mock("./layout.js", () => ({
  createBlockLayout: vi.fn(() => ({
    body: { on: vi.fn(), focus: vi.fn() },
    statusBar: {},
    inputBar: {},
    promptLabel: {},
    hintsBar: {},
  })),
}));

vi.mock("./status-bar.js", () => ({
  StatusBar: vi.fn().mockImplementation(() => ({
    subscribeToTree: vi.fn(() => vi.fn()),
    updateStreaming: vi.fn(),
    clearActivity: vi.fn(),
    addGadgetCost: vi.fn(),
    showThrottling: vi.fn(),
    clearThrottling: vi.fn(),
    showRetry: vi.fn(),
    clearRetry: vi.fn(),
    setProfiles: vi.fn(),
    getCurrentProfile: vi.fn(() => "default"),
    getElapsedSeconds: vi.fn(() => 0),
    getMetrics: vi.fn(() => ({})),
    setFocusMode: vi.fn(),
    setContentFilterMode: vi.fn(),
    cycleProfile: vi.fn(),
  })),
}));

vi.mock("./input-handler.js", () => ({
  InputHandler: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    deactivate: vi.fn(),
    waitForInput: vi.fn(),
    waitForPrompt: vi.fn(),
    startWaitingForPrompt: vi.fn(),
    setMidSessionHandler: vi.fn(),
    cancelPending: vi.fn(),
    setGetFocusMode: vi.fn(),
    setGetContentFilterMode: vi.fn(),
    onCtrlC: vi.fn(),
    onCtrlB: vi.fn(),
    onCtrlK: vi.fn(),
    onCtrlI: vi.fn(),
    onCtrlJ: vi.fn(),
    onCtrlP: vi.fn(),
    onArrowUp: vi.fn(),
    onArrowDown: vi.fn(),
    isWaitingForREPLPrompt: vi.fn(() => false),
    hasPendingInput: vi.fn(() => false),
  })),
}));

vi.mock("./block-renderer.js", () => ({
  BlockRenderer: vi.fn().mockImplementation(() => ({
    subscribeToTree: vi.fn(() => vi.fn()),
    addText: vi.fn(),
    addThinking: vi.fn(),
    addUserMessage: vi.fn(),
    addSystemMessage: vi.fn(() => "block-id"),
    clear: vi.fn(),
    startNewSession: vi.fn(),
    clearPreviousSession: vi.fn(),
    handleUserScroll: vi.fn(),
    handleResize: vi.fn(),
    getSelectedBlock: vi.fn(),
    selectNext: vi.fn(),
    selectPrevious: vi.fn(),
    selectFirst: vi.fn(),
    selectLast: vi.fn(),
    toggleExpand: vi.fn(),
    collapseOrDeselect: vi.fn(),
    enableFollowMode: vi.fn(),
    onHasContentChange: vi.fn(),
    setContentFilterMode: vi.fn(),
    flushText: vi.fn(),
  })),
}));

vi.mock("./controller.js", () => ({
  TUIController: vi.fn().mockImplementation(() => ({
    getFocusMode: vi.fn(() => "browse"),
    getContentFilterMode: vi.fn(() => "full"),
    toggleFocusMode: vi.fn(),
    setFocusMode: vi.fn(),
    toggleContentFilterMode: vi.fn(),
    pushInputMode: vi.fn(),
    popInputMode: vi.fn(),
    getAbortSignal: vi.fn(() => new AbortController().signal),
    resetAbort: vi.fn(),
    isAborted: vi.fn(() => false),
    onQuit: vi.fn(),
    onCancel: vi.fn(),
    onMidSessionInput: vi.fn(),
    handleCtrlC: vi.fn(),
    triggerCancel: vi.fn(),
    abort: vi.fn(),
  })),
}));

vi.mock("./modal-manager.js", () => ({
  ModalManager: vi.fn().mockImplementation(() => ({
    showRawViewer: vi.fn(),
    showApproval: vi.fn(),
    closeAll: vi.fn(),
  })),
}));

let capturedOnAction: (action: any) => void;

vi.mock("./keymap.js", () => ({
  KeyboardManager: vi.fn().mockImplementation((config) => {
    capturedOnAction = config.onAction;
    return {
      setup: vi.fn(),
      handleForwardedKey: vi.fn(),
    };
  }),
}));

vi.mock("./hints-bar.js", () => ({
  HintsBar: vi.fn().mockImplementation(() => ({
    setHasContent: vi.fn(),
    setFocusMode: vi.fn(),
    setContentFilterMode: vi.fn(),
  })),
}));

describe("TUIApp Characterization", () => {
  let tui: TUIApp;
  let options: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    options = {
      model: "test-model",
      stdin: process.stdin,
      stdout: process.stdout,
    };
    tui = await TUIApp.create(options);
  });

  describe("Initialization", () => {
    test("creates all internal components", () => {
      expect(createScreen).toHaveBeenCalled();
      expect(createBlockLayout).toHaveBeenCalled();
      expect(StatusBar).toHaveBeenCalled();
      expect(InputHandler).toHaveBeenCalled();
      expect(BlockRenderer).toHaveBeenCalled();
      expect(TUIController).toHaveBeenCalled();
      expect(ModalManager).toHaveBeenCalled();
      expect(KeyboardManager).toHaveBeenCalled();
    });
  });

  describe("Tree Subscription Lifecycle", () => {
    test("subscribeToTree connects renderer and status bar", () => {
      const mockTree = { subscribe: vi.fn() } as any;
      const unsubscribe = tui.subscribeToTree(mockTree);

      const blockRenderer = vi.mocked(BlockRenderer).mock.results[0].value;
      const statusBar = vi.mocked(StatusBar).mock.results[0].value;

      expect(blockRenderer.subscribeToTree).toHaveBeenCalledWith(mockTree);
      expect(statusBar.subscribeToTree).toHaveBeenCalledWith(mockTree);
      expect(typeof unsubscribe).toBe("function");
    });

    test("unsubscribe function cleans up both subscriptions", () => {
      const mockTree = { subscribe: vi.fn() } as any;

      const unsubBlock = vi.fn();
      const unsubStatus = vi.fn();

      const blockRenderer = vi.mocked(BlockRenderer).mock.results[0].value;
      const statusBar = vi.mocked(StatusBar).mock.results[0].value;

      blockRenderer.subscribeToTree.mockReturnValue(unsubBlock);
      statusBar.subscribeToTree.mockReturnValue(unsubStatus);

      const unsubscribe = tui.subscribeToTree(mockTree);
      unsubscribe();

      expect(unsubBlock).toHaveBeenCalled();
      expect(unsubStatus).toHaveBeenCalled();
    });
  });

  describe("Event Routing", () => {
    test("routes text events to block renderer", () => {
      const blockRenderer = vi.mocked(BlockRenderer).mock.results[0].value;
      tui.handleEvent({ type: "text", content: "hello" });
      expect(blockRenderer.addText).toHaveBeenCalledWith("hello");
    });

    test("routes thinking events to block renderer", () => {
      const blockRenderer = vi.mocked(BlockRenderer).mock.results[0].value;
      tui.handleEvent({ type: "thinking", content: "thinking...", thinkingType: "internal" });
      expect(blockRenderer.addThinking).toHaveBeenCalledWith("thinking...", "internal");
    });
  });

  describe("Session Management", () => {
    test("startNewSession delegates to block renderer", () => {
      const blockRenderer = vi.mocked(BlockRenderer).mock.results[0].value;
      tui.startNewSession();
      expect(blockRenderer.startNewSession).toHaveBeenCalled();
    });

    test("clearPreviousSession delegates to block renderer", () => {
      const blockRenderer = vi.mocked(BlockRenderer).mock.results[0].value;
      tui.clearPreviousSession();
      expect(blockRenderer.clearPreviousSession).toHaveBeenCalled();
    });

    test("clearStatusBar delegates to status bar", () => {
      const statusBar = vi.mocked(StatusBar).mock.results[0].value;
      tui.clearStatusBar();
      expect(statusBar.clearActivity).toHaveBeenCalled();
    });

    test("clearBlockRenderer delegates to block renderer", () => {
      const blockRenderer = vi.mocked(BlockRenderer).mock.results[0].value;
      tui.clearBlockRenderer();
      expect(blockRenderer.clear).toHaveBeenCalled();
    });

    test("resetAbort delegates to controller", () => {
      const controller = vi.mocked(TUIController).mock.results[0].value;
      tui.resetAbort();
      expect(controller.resetAbort).toHaveBeenCalled();
    });
  });

  describe("Keyboard and Focus Actions", () => {
    test("toggleFocusMode delegates to controller", () => {
      const controller = vi.mocked(TUIController).mock.results[0].value;
      tui.toggleFocusMode();
      expect(controller.toggleFocusMode).toHaveBeenCalled();
    });

    test("setFocusMode delegates to controller", () => {
      const controller = vi.mocked(TUIController).mock.results[0].value;
      tui.setFocusMode("input");
      expect(controller.setFocusMode).toHaveBeenCalledWith("input");
    });

    test("toggleContentFilterMode delegates to controller", () => {
      const controller = vi.mocked(TUIController).mock.results[0].value;
      tui.toggleContentFilterMode();
      expect(controller.toggleContentFilterMode).toHaveBeenCalled();
    });

    test("onQuit delegates to controller", () => {
      const controller = vi.mocked(TUIController).mock.results[0].value;
      const callback = () => {};
      tui.onQuit(callback);
      expect(controller.onQuit).toHaveBeenCalledWith(callback);
    });

    test("onCancel delegates to controller", () => {
      const controller = vi.mocked(TUIController).mock.results[0].value;
      const callback = () => {};
      tui.onCancel(callback);
      expect(controller.onCancel).toHaveBeenCalledWith(callback);
    });

    test("navigation actions call block renderer", () => {
      const blockRenderer = vi.mocked(BlockRenderer).mock.results[0].value;

      capturedOnAction({ type: "navigation", action: "select_next" });
      expect(blockRenderer.selectNext).toHaveBeenCalled();

      capturedOnAction({ type: "navigation", action: "select_previous" });
      expect(blockRenderer.selectPrevious).toHaveBeenCalled();

      capturedOnAction({ type: "navigation", action: "select_first" });
      expect(blockRenderer.selectFirst).toHaveBeenCalled();

      capturedOnAction({ type: "navigation", action: "select_last" });
      expect(blockRenderer.selectLast).toHaveBeenCalled();
      expect(blockRenderer.enableFollowMode).toHaveBeenCalled();

      capturedOnAction({ type: "navigation", action: "toggle_expand" });
      expect(blockRenderer.toggleExpand).toHaveBeenCalled();

      capturedOnAction({ type: "navigation", action: "collapse" });
      expect(blockRenderer.collapseOrDeselect).toHaveBeenCalled();
    });

    test("ctrl_c action calls controller.handleCtrlC", () => {
      const controller = vi.mocked(TUIController).mock.results[0].value;
      capturedOnAction({ type: "ctrl_c" });
      expect(controller.handleCtrlC).toHaveBeenCalled();
    });

    test("cancel action calls controller.triggerCancel and controller.abort", () => {
      const controller = vi.mocked(TUIController).mock.results[0].value;
      capturedOnAction({ type: "cancel" });
      expect(controller.triggerCancel).toHaveBeenCalled();
      expect(controller.abort).toHaveBeenCalled();
    });

    test("showLLMCallStart is a no-op but exists for compatibility", () => {
      // should not throw
      expect(() => tui.showLLMCallStart(1)).not.toThrow();
    });

    test("updateStreamingTokens calls status bar", () => {
      const statusBar = vi.mocked(StatusBar).mock.results[0].value;
      tui.updateStreamingTokens(123);
      expect(statusBar.updateStreaming).toHaveBeenCalledWith(123);
    });

    test("addGadgetCost calls status bar", () => {
      const statusBar = vi.mocked(StatusBar).mock.results[0].value;
      tui.addGadgetCost(0.01);
      expect(statusBar.addGadgetCost).toHaveBeenCalledWith(0.01);
    });

    test("flushText calls status bar clearActivity", () => {
      const statusBar = vi.mocked(StatusBar).mock.results[0].value;
      tui.flushText();
      expect(statusBar.clearActivity).toHaveBeenCalled();
    });

    test("showThrottling and clearThrottling call status bar", () => {
      const statusBar = vi.mocked(StatusBar).mock.results[0].value;
      tui.showThrottling(1000, { rpm: {} } as any);
      expect(statusBar.showThrottling).toHaveBeenCalledWith(1000, { rpm: {} });

      tui.clearThrottling();
      expect(statusBar.clearThrottling).toHaveBeenCalled();
    });

    test("showRetry and clearRetry call status bar", () => {
      const statusBar = vi.mocked(StatusBar).mock.results[0].value;
      tui.showRetry(1, 2);
      expect(statusBar.showRetry).toHaveBeenCalledWith(1, 2);

      tui.clearRetry();
      expect(statusBar.clearRetry).toHaveBeenCalled();
    });

    test("addSystemMessage calls block renderer", () => {
      const blockRenderer = vi.mocked(BlockRenderer).mock.results[0].value;
      tui.addSystemMessage("test", "info");
      expect(blockRenderer.addSystemMessage).toHaveBeenCalledWith("test", "info");
    });

    test("setProfiles calls status bar", () => {
      const statusBar = vi.mocked(StatusBar).mock.results[0].value;
      tui.setProfiles(["p1"], "p1");
      expect(statusBar.setProfiles).toHaveBeenCalledWith(["p1"], "p1");
    });
  });

  describe("Modal Activation", () => {
    test("showRawViewer for LLM call request", async () => {
      const controller = vi.mocked(TUIController).mock.results[0].value;
      const blockRenderer = vi.mocked(BlockRenderer).mock.results[0].value;
      const modalManager = vi.mocked(ModalManager).mock.results[0].value;

      controller.getFocusMode.mockReturnValue("browse");
      blockRenderer.getSelectedBlock.mockReturnValue({
        node: {
          type: "llm_call",
          rawRequest: "request-data",
          rawResponse: "response-data",
          iteration: 1,
          model: "model",
        },
      });

      await tui.showRawViewer("request");
      expect(modalManager.showRawViewer).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          mode: "request",
          request: "request-data",
        }),
      );
    });

    test("showRawViewer for gadget response", async () => {
      const controller = vi.mocked(TUIController).mock.results[0].value;
      const blockRenderer = vi.mocked(BlockRenderer).mock.results[0].value;
      const modalManager = vi.mocked(ModalManager).mock.results[0].value;

      controller.getFocusMode.mockReturnValue("browse");
      blockRenderer.getSelectedBlock.mockReturnValue({
        node: {
          type: "gadget",
          name: "TestGadget",
          parameters: { p: 1 },
          result: "success",
        },
      });

      await tui.showRawViewer("response");
      expect(modalManager.showRawViewer).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          mode: "response",
          gadgetName: "TestGadget",
          result: "success",
        }),
      );
    });

    test("showApproval delegates to modal manager", async () => {
      const modalManager = vi.mocked(ModalManager).mock.results[0].value;
      const context = { gadgetName: "Test", parameters: {} };

      modalManager.showApproval.mockResolvedValue("yes");

      const result = await tui.showApproval(context);
      expect(result).toBe("yes");
      expect(modalManager.showApproval).toHaveBeenCalledWith(expect.anything(), context);
    });
  });

  describe("Lifecycle and Destroy", () => {
    test("destroy cleans up components", () => {
      const screenCtx = vi.mocked(createScreen).mock.results[0].value;
      const modalManager = vi.mocked(ModalManager).mock.results[0].value;
      const inputHandler = vi.mocked(InputHandler).mock.results[0].value;

      tui.destroy();

      expect(modalManager.closeAll).toHaveBeenCalled();
      expect(inputHandler.cancelPending).toHaveBeenCalled();
      expect(screenCtx.destroy).toHaveBeenCalled();
    });
  });
});
