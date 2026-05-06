import { describe, expect, test, vi } from "vitest";
import type { BlockRenderer } from "./block-renderer.js";
import { SessionManager } from "./session-manager.js";
import type { StatusBar } from "./status-bar.js";

function makeMockBlockRenderer(): BlockRenderer {
  return {
    startNewSession: vi.fn(),
    clearPreviousSession: vi.fn(),
    clear: vi.fn(),
  } as unknown as BlockRenderer;
}

function makeMockStatusBar(): StatusBar {
  return {
    clearActivity: vi.fn(),
  } as unknown as StatusBar;
}

describe("SessionManager", () => {
  test("startNewSession delegates to blockRenderer", () => {
    const blockRenderer = makeMockBlockRenderer();
    const statusBar = makeMockStatusBar();
    const manager = new SessionManager(blockRenderer, statusBar);

    manager.startNewSession();

    expect(blockRenderer.startNewSession).toHaveBeenCalledOnce();
  });

  test("clearPreviousSession delegates to blockRenderer", () => {
    const blockRenderer = makeMockBlockRenderer();
    const statusBar = makeMockStatusBar();
    const manager = new SessionManager(blockRenderer, statusBar);

    manager.clearPreviousSession();

    expect(blockRenderer.clearPreviousSession).toHaveBeenCalledOnce();
  });

  test("clearAllBlocks delegates to blockRenderer", () => {
    const blockRenderer = makeMockBlockRenderer();
    const statusBar = makeMockStatusBar();
    const manager = new SessionManager(blockRenderer, statusBar);

    manager.clearAllBlocks();

    expect(blockRenderer.clear).toHaveBeenCalledOnce();
  });

  test("clearStatusBar delegates to statusBar", () => {
    const blockRenderer = makeMockBlockRenderer();
    const statusBar = makeMockStatusBar();
    const manager = new SessionManager(blockRenderer, statusBar);

    manager.clearStatusBar();

    expect(statusBar.clearActivity).toHaveBeenCalledOnce();
  });

  test("resetAll calls both clear methods", () => {
    const blockRenderer = makeMockBlockRenderer();
    const statusBar = makeMockStatusBar();
    const manager = new SessionManager(blockRenderer, statusBar);

    manager.resetAll();

    expect(blockRenderer.clear).toHaveBeenCalledOnce();
    expect(statusBar.clearActivity).toHaveBeenCalledOnce();
  });
});
