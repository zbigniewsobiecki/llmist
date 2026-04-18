import { describe, expect, test, vi } from "vitest";
import type { BlockRenderer } from "./block-renderer.js";
import type { StatusBar } from "./status-bar.js";
import { TreeSubscriptionManager } from "./tree-subscription-manager.js";

function makeMockBlockRenderer(unsubFn = vi.fn()): BlockRenderer {
  return {
    subscribeToTree: vi.fn().mockReturnValue(unsubFn),
  } as unknown as BlockRenderer;
}

function makeMockStatusBar(unsubFn = vi.fn()): StatusBar {
  return {
    subscribeToTree: vi.fn().mockReturnValue(unsubFn),
  } as unknown as StatusBar;
}

function makeMockTree() {
  return {} as never;
}

describe("TreeSubscriptionManager", () => {
  test("subscribe subscribes to tree and returns combined unsubscribe", () => {
    const blockUnsub = vi.fn();
    const statusUnsub = vi.fn();
    const blockRenderer = makeMockBlockRenderer(blockUnsub);
    const statusBar = makeMockStatusBar(statusUnsub);
    const manager = new TreeSubscriptionManager(blockRenderer, statusBar);
    const tree = makeMockTree();

    const unsubscribe = manager.subscribe(tree);

    expect(blockRenderer.subscribeToTree).toHaveBeenCalledWith(tree);
    expect(statusBar.subscribeToTree).toHaveBeenCalledWith(tree);

    // Calling the returned unsubscribe invokes both
    unsubscribe();
    expect(blockUnsub).toHaveBeenCalledOnce();
    expect(statusUnsub).toHaveBeenCalledOnce();
  });

  test("subscribe replaces previous subscription", () => {
    const firstBlockUnsub = vi.fn();
    const firstStatusUnsub = vi.fn();
    const blockRenderer = makeMockBlockRenderer(firstBlockUnsub);
    const statusBar = makeMockStatusBar(firstStatusUnsub);
    const manager = new TreeSubscriptionManager(blockRenderer, statusBar);

    // First subscription
    manager.subscribe(makeMockTree());

    // Second subscription — should auto-unsubscribe the first
    manager.subscribe(makeMockTree());

    expect(firstBlockUnsub).toHaveBeenCalledOnce();
    expect(firstStatusUnsub).toHaveBeenCalledOnce();
  });

  test("unsubscribe calls combined unsub and nulls out", () => {
    const blockUnsub = vi.fn();
    const statusUnsub = vi.fn();
    const blockRenderer = makeMockBlockRenderer(blockUnsub);
    const statusBar = makeMockStatusBar(statusUnsub);
    const manager = new TreeSubscriptionManager(blockRenderer, statusBar);

    manager.subscribe(makeMockTree());
    manager.unsubscribe();

    expect(blockUnsub).toHaveBeenCalledOnce();
    expect(statusUnsub).toHaveBeenCalledOnce();

    // Calling again should be a no-op (treeUnsubscribe was nulled out)
    manager.unsubscribe();
    expect(blockUnsub).toHaveBeenCalledOnce();
    expect(statusUnsub).toHaveBeenCalledOnce();
  });

  test("double unsubscribe causes no error", () => {
    const blockRenderer = makeMockBlockRenderer();
    const statusBar = makeMockStatusBar();
    const manager = new TreeSubscriptionManager(blockRenderer, statusBar);

    manager.subscribe(makeMockTree());

    expect(() => {
      manager.unsubscribe();
      manager.unsubscribe();
    }).not.toThrow();
  });
});
