import { describe, expect, it, vi } from "vitest";
import type { ScrollManagerAccessors } from "./scroll-manager.js";
import { getBlockHeight, ScrollManager } from "./scroll-manager.js";
import type { BlockNode, SelectableBlock } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers / Factories
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a minimal mock ScrollableBox with configurable scroll state.
 */
function createMockContainer(
  opts: { scrollPos?: number; height?: number; hasScrollMethods?: boolean } = {},
) {
  const { scrollPos = 0, height = 20, hasScrollMethods = true } = opts;

  let currentScroll = scrollPos;

  const container: {
    height: number;
    getScroll?: () => number;
    scrollTo?: (pos: number) => void;
    setScrollPerc?: (pct: number) => void;
  } = { height };

  if (hasScrollMethods) {
    container.getScroll = vi.fn(() => currentScroll);
    container.scrollTo = vi.fn((pos: number) => {
      currentScroll = pos;
    });
    container.setScrollPerc = vi.fn();
  }

  return container as typeof container & {
    getScroll?: ReturnType<typeof vi.fn>;
    scrollTo?: ReturnType<typeof vi.fn>;
    setScrollPerc?: ReturnType<typeof vi.fn>;
  };
}

/**
 * Create a minimal mock SelectableBlock.
 */
function createMockBlock(opts: { top?: number; content?: string } = {}): SelectableBlock {
  const { top = 0, content = "line1\nline2\nline3" } = opts;

  return {
    node: {} as BlockNode,
    box: {
      top,
      getContent: vi.fn(() => content),
    } as unknown as SelectableBlock["box"],
    expanded: false,
    selectable: true,
  };
}

/**
 * Create a simple node with optional children IDs.
 */
function createMockNode(id: string, childIds: string[] = []): BlockNode {
  if (childIds.length > 0) {
    return {
      id,
      type: "llm_call",
      depth: 0,
      parentId: null,
      sessionId: 0,
      iteration: 1,
      model: "test-model",
      isComplete: false,
      children: childIds,
    } as BlockNode;
  }
  return {
    id,
    type: "text",
    depth: 0,
    parentId: null,
    sessionId: 0,
    content: "hello",
    children: [],
  } as BlockNode;
}

/**
 * Build a ScrollManagerAccessors object from maps.
 */
function createAccessors(opts: {
  rootIds?: string[];
  nodes?: Map<string, BlockNode>;
  blocks?: Map<string, SelectableBlock>;
  selectedBlock?: SelectableBlock | undefined;
}): ScrollManagerAccessors {
  const { rootIds = [], nodes = new Map(), blocks = new Map(), selectedBlock = undefined } = opts;

  return {
    getRootIds: vi.fn(() => rootIds),
    getNode: vi.fn((id: string) => nodes.get(id)),
    getBlock: vi.fn((id: string) => blocks.get(id)),
    getSelectedBlock: vi.fn(() => selectedBlock),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getBlockHeight()
// ─────────────────────────────────────────────────────────────────────────────

describe("getBlockHeight()", () => {
  it("counts lines for single-line content (no newlines)", () => {
    const block = createMockBlock({ content: "hello world" });
    expect(getBlockHeight(block)).toBe(1);
  });

  it("counts lines for multi-line content", () => {
    const block = createMockBlock({ content: "line1\nline2\nline3" });
    expect(getBlockHeight(block)).toBe(3);
  });

  it("counts lines for content with a trailing newline", () => {
    const block = createMockBlock({ content: "line1\nline2\n" });
    // split('\n') on "line1\nline2\n" → ["line1", "line2", ""] → length 3
    expect(getBlockHeight(block)).toBe(3);
  });

  it("returns 1 for empty content", () => {
    const block = createMockBlock({ content: "" });
    // "".split('\n') → [""] → length 1
    expect(getBlockHeight(block)).toBe(1);
  });

  it("counts many newlines correctly", () => {
    const block = createMockBlock({ content: "a\nb\nc\nd\ne" });
    expect(getBlockHeight(block)).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Follow mode
// ─────────────────────────────────────────────────────────────────────────────

describe("ScrollManager – follow mode", () => {
  it("starts in follow mode by default", () => {
    const container = createMockContainer();
    const accessors = createAccessors({ rootIds: [] });
    const sm = new ScrollManager(container as never, accessors);
    expect(sm.isFollowMode()).toBe(true);
  });

  it("setFollowMode(false) disables follow mode", () => {
    const container = createMockContainer();
    const accessors = createAccessors({ rootIds: [] });
    const sm = new ScrollManager(container as never, accessors);
    sm.setFollowMode(false);
    expect(sm.isFollowMode()).toBe(false);
  });

  it("setFollowMode(true) enables follow mode", () => {
    const container = createMockContainer();
    const accessors = createAccessors({ rootIds: [] });
    const sm = new ScrollManager(container as never, accessors);
    sm.setFollowMode(false);
    sm.setFollowMode(true);
    expect(sm.isFollowMode()).toBe(true);
  });

  describe("handleUserScroll()", () => {
    it("disables follow mode when not at bottom", () => {
      // Container height 20, content is 10 lines but scrolled to top
      // maxScroll = 10 - 20 = 0 (clamped to 0), scrollPos = 0 → AT_BOTTOM_THRESHOLD check:
      // We need a scenario where isAtBottom() returns false.
      // content height 30, containerHeight 20 → maxScroll = 10, scrollPos = 0 → not at bottom
      const container = createMockContainer({ scrollPos: 0, height: 20 });
      const block = createMockBlock({ content: "line\n".repeat(30) }); // 30 lines
      const nodes = new Map<string, BlockNode>([["n1", createMockNode("n1")]]);
      const blocks = new Map<string, SelectableBlock>([["n1", block]]);
      const accessors = createAccessors({ rootIds: ["n1"], nodes, blocks });

      const sm = new ScrollManager(container as never, accessors);
      sm.setFollowMode(true);
      sm.handleUserScroll();
      expect(sm.isFollowMode()).toBe(false);
    });

    it("re-enables follow mode when scrolled to bottom", () => {
      // content = 5 lines, container height = 20 → maxScroll = 0 (clamped), always at bottom
      const container = createMockContainer({ scrollPos: 0, height: 20 });
      const block = createMockBlock({ content: "line\n".repeat(5) });
      const nodes = new Map<string, BlockNode>([["n1", createMockNode("n1")]]);
      const blocks = new Map<string, SelectableBlock>([["n1", block]]);
      const accessors = createAccessors({ rootIds: ["n1"], nodes, blocks });

      const sm = new ScrollManager(container as never, accessors);
      sm.setFollowMode(false);
      sm.handleUserScroll();
      expect(sm.isFollowMode()).toBe(true);
    });
  });

  describe("enableFollowMode()", () => {
    it("sets follow mode to true", () => {
      const container = createMockContainer();
      const accessors = createAccessors({ rootIds: [] });
      const sm = new ScrollManager(container as never, accessors);
      sm.setFollowMode(false);
      sm.enableFollowMode();
      expect(sm.isFollowMode()).toBe(true);
    });

    it("calls setScrollPerc(100) to scroll to bottom", () => {
      const container = createMockContainer();
      const accessors = createAccessors({ rootIds: [] });
      const sm = new ScrollManager(container as never, accessors);
      sm.enableFollowMode();
      expect(container.setScrollPerc).toHaveBeenCalledWith(100);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scrollToSelection()
// ─────────────────────────────────────────────────────────────────────────────

describe("ScrollManager – scrollToSelection()", () => {
  it("does nothing when no block is selected", () => {
    const container = createMockContainer({ scrollPos: 0, height: 20 });
    const accessors = createAccessors({ selectedBlock: undefined });
    const sm = new ScrollManager(container as never, accessors);
    sm.scrollToSelection();
    expect(container.scrollTo).not.toHaveBeenCalled();
  });

  it("does nothing when container has no scroll methods", () => {
    const container = createMockContainer({ hasScrollMethods: false });
    const block = createMockBlock({ top: 100 });
    const accessors = createAccessors({ selectedBlock: block });
    const sm = new ScrollManager(container as never, accessors);
    // Should not throw
    expect(() => sm.scrollToSelection()).not.toThrow();
  });

  it("scrolls up when block is above visible area", () => {
    // container: scrollPos=50, height=20 → visible area [50, 70)
    // block.top=10 → above visible area → scrollTo(10)
    const container = createMockContainer({ scrollPos: 50, height: 20 });
    const block = createMockBlock({ top: 10, content: "line1\nline2" }); // height=2
    const accessors = createAccessors({ selectedBlock: block });
    const sm = new ScrollManager(container as never, accessors);
    sm.scrollToSelection();
    expect(container.scrollTo).toHaveBeenCalledWith(10);
  });

  it("disables follow mode when scrolling up to a block above visible area", () => {
    const container = createMockContainer({ scrollPos: 50, height: 20 });
    const block = createMockBlock({ top: 10, content: "line1\nline2" });
    const accessors = createAccessors({ selectedBlock: block });
    const sm = new ScrollManager(container as never, accessors);
    sm.setFollowMode(true);
    sm.scrollToSelection();
    expect(sm.isFollowMode()).toBe(false);
  });

  it("scrolls down when block is below visible area", () => {
    // container: scrollPos=0, height=20 → visible area [0, 20)
    // block: top=18, content=5 lines → bottom = 18+5=23 > 20 → scroll to 18+5-20=3
    const container = createMockContainer({ scrollPos: 0, height: 20 });
    const block = createMockBlock({ top: 18, content: "l\nl\nl\nl\nl" }); // 5 lines
    const accessors = createAccessors({ selectedBlock: block });
    const sm = new ScrollManager(container as never, accessors);
    sm.scrollToSelection();
    expect(container.scrollTo).toHaveBeenCalledWith(3); // 18 + 5 - 20
  });

  it("does not scroll when block is fully visible", () => {
    // container: scrollPos=0, height=20 → visible [0, 20)
    // block: top=5, height=3 → bottom=8 < 20 → no scroll
    const container = createMockContainer({ scrollPos: 0, height: 20 });
    const block = createMockBlock({ top: 5, content: "line1\nline2\nline3" }); // 3 lines
    const accessors = createAccessors({ selectedBlock: block });
    const sm = new ScrollManager(container as never, accessors);
    sm.scrollToSelection();
    expect(container.scrollTo).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyBottomAlignmentAndScroll()
// ─────────────────────────────────────────────────────────────────────────────

describe("ScrollManager – applyBottomAlignmentAndScroll()", () => {
  it("applies positive offset to block boxes when content < viewport", () => {
    // container height=20, content=5 lines → offset=15
    const container = createMockContainer({ scrollPos: 0, height: 20 });
    const block = createMockBlock({ top: 0, content: "l\nl\nl\nl\nl" }); // 5 lines
    const nodes = new Map<string, BlockNode>([["n1", createMockNode("n1")]]);
    const blocks = new Map<string, SelectableBlock>([["n1", block]]);
    const accessors = createAccessors({ rootIds: ["n1"], nodes, blocks });
    const sm = new ScrollManager(container as never, accessors);

    sm.applyBottomAlignmentAndScroll();

    // block.box.top should be shifted by offset = 20 - 5 = 15
    expect(block.box.top).toBe(15);
  });

  it("does not apply offset when content >= viewport height", () => {
    // container height=20, content=25 lines → offset=0
    const container = createMockContainer({ scrollPos: 0, height: 20 });
    const block = createMockBlock({ top: 0, content: "l\n".repeat(25) }); // 26 lines
    const nodes = new Map<string, BlockNode>([["n1", createMockNode("n1")]]);
    const blocks = new Map<string, SelectableBlock>([["n1", block]]);
    const accessors = createAccessors({ rootIds: ["n1"], nodes, blocks });
    const sm = new ScrollManager(container as never, accessors);

    sm.applyBottomAlignmentAndScroll();

    expect(block.box.top).toBe(0); // no change
  });

  it("calls setScrollPerc(100) when follow mode is on", () => {
    const container = createMockContainer({ scrollPos: 0, height: 20 });
    const accessors = createAccessors({ rootIds: [] });
    const sm = new ScrollManager(container as never, accessors);
    sm.setFollowMode(true);

    sm.applyBottomAlignmentAndScroll();

    expect(container.setScrollPerc).toHaveBeenCalledWith(100);
  });

  it("does not call setScrollPerc when follow mode is off", () => {
    const container = createMockContainer({ scrollPos: 0, height: 20 });
    const accessors = createAccessors({ rootIds: [] });
    const sm = new ScrollManager(container as never, accessors);
    sm.setFollowMode(false);

    sm.applyBottomAlignmentAndScroll();

    expect(container.setScrollPerc).not.toHaveBeenCalled();
  });

  it("applies offset to child nodes in the tree", () => {
    // parent node with one child, both have blocks
    const container = createMockContainer({ scrollPos: 0, height: 30 });
    const parentBlock = createMockBlock({ top: 0, content: "l\nl" }); // 2 lines
    const childBlock = createMockBlock({ top: 2, content: "l\nl\nl" }); // 3 lines
    // total content = 5 lines, offset = 30 - 5 = 25

    const parentNode = createMockNode("parent", ["child"]);
    const childNode = createMockNode("child");

    const nodes = new Map<string, BlockNode>([
      ["parent", parentNode],
      ["child", childNode],
    ]);
    const blocks = new Map<string, SelectableBlock>([
      ["parent", parentBlock],
      ["child", childBlock],
    ]);
    const accessors = createAccessors({ rootIds: ["parent"], nodes, blocks });
    const sm = new ScrollManager(container as never, accessors);
    sm.setFollowMode(false);

    sm.applyBottomAlignmentAndScroll();

    expect(parentBlock.box.top).toBe(25); // 0 + 25
    expect(childBlock.box.top).toBe(27); // 2 + 25
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// repositionBlocks()
// ─────────────────────────────────────────────────────────────────────────────

describe("ScrollManager – repositionBlocks()", () => {
  it("calls repositionTree for each rootId in order", () => {
    const container = createMockContainer({ scrollPos: 0, height: 50 });
    const accessors = createAccessors({ rootIds: ["a", "b", "c"] });
    const sm = new ScrollManager(container as never, accessors);

    const repositionTree = vi.fn((_rootId: string, top: number) => top + 10);
    sm.repositionBlocks(repositionTree);

    expect(repositionTree).toHaveBeenCalledTimes(3);
    expect(repositionTree).toHaveBeenNthCalledWith(1, "a", 0);
    expect(repositionTree).toHaveBeenNthCalledWith(2, "b", 10);
    expect(repositionTree).toHaveBeenNthCalledWith(3, "c", 20);
  });

  it("passes accumulated top position from previous call to next", () => {
    const container = createMockContainer({ scrollPos: 0, height: 50 });
    const accessors = createAccessors({ rootIds: ["x", "y"] });
    const sm = new ScrollManager(container as never, accessors);

    // Simulate different heights: x returns top+5, y returns that+8
    const repositionTree = vi
      .fn()
      .mockImplementationOnce((_id: string, top: number) => top + 5)
      .mockImplementationOnce((_id: string, top: number) => top + 8);

    sm.repositionBlocks(repositionTree);

    expect(repositionTree).toHaveBeenNthCalledWith(1, "x", 0);
    expect(repositionTree).toHaveBeenNthCalledWith(2, "y", 5);
  });

  it("does not call repositionTree when there are no rootIds", () => {
    const container = createMockContainer({ scrollPos: 0, height: 50 });
    const accessors = createAccessors({ rootIds: [] });
    const sm = new ScrollManager(container as never, accessors);

    const repositionTree = vi.fn();
    sm.repositionBlocks(repositionTree);

    expect(repositionTree).not.toHaveBeenCalled();
  });

  it("calls applyBottomAlignmentAndScroll after repositioning (follow mode active → setScrollPerc called)", () => {
    const container = createMockContainer({ scrollPos: 0, height: 50 });
    const accessors = createAccessors({ rootIds: [] });
    const sm = new ScrollManager(container as never, accessors);
    sm.setFollowMode(true);

    const repositionTree = vi.fn((_, top: number) => top);
    sm.repositionBlocks(repositionTree);

    // applyBottomAlignmentAndScroll → follow mode → scrollToBottom → setScrollPerc(100)
    expect(container.setScrollPerc).toHaveBeenCalledWith(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("ScrollManager – edge cases", () => {
  it("AT_BOTTOM_THRESHOLD is 5", () => {
    expect(ScrollManager.AT_BOTTOM_THRESHOLD).toBe(5);
  });

  it("isAtBottom() returns true when container has no getScroll method", () => {
    // A container without getScroll → isAtBottom() returns true
    const container = createMockContainer({ hasScrollMethods: false });
    const accessors = createAccessors({ rootIds: [] });
    const sm = new ScrollManager(container as never, accessors);
    // We can observe this through handleUserScroll: when isAtBottom()=true → followMode stays true
    sm.setFollowMode(false);
    sm.handleUserScroll(); // should turn follow mode back on because isAtBottom()=true
    expect(sm.isFollowMode()).toBe(true);
  });

  it("handles getNode returning undefined gracefully in applyBottomAlignmentAndScroll", () => {
    const container = createMockContainer({ scrollPos: 0, height: 20 });
    // rootIds references a node that does not exist in the map
    const accessors = createAccessors({ rootIds: ["ghost"] });
    const sm = new ScrollManager(container as never, accessors);
    sm.setFollowMode(false);
    expect(() => sm.applyBottomAlignmentAndScroll()).not.toThrow();
  });

  it("handles getBlock returning undefined gracefully (node exists but block does not)", () => {
    const container = createMockContainer({ scrollPos: 0, height: 20 });
    const nodes = new Map<string, BlockNode>([["n1", createMockNode("n1")]]);
    // No corresponding block
    const blocks = new Map<string, SelectableBlock>();
    const accessors = createAccessors({ rootIds: ["n1"], nodes, blocks });
    const sm = new ScrollManager(container as never, accessors);
    sm.setFollowMode(false);
    expect(() => sm.applyBottomAlignmentAndScroll()).not.toThrow();
  });

  it("scrollToBottom does nothing when setScrollPerc is undefined", () => {
    const container = createMockContainer({ hasScrollMethods: false });
    const accessors = createAccessors({ rootIds: [] });
    const sm = new ScrollManager(container as never, accessors);
    sm.setFollowMode(true);
    // enableFollowMode tries scrollToBottom → should not throw
    expect(() => sm.enableFollowMode()).not.toThrow();
  });

  it("isAtBottom() uses AT_BOTTOM_THRESHOLD tolerance", () => {
    // content=30 lines, containerHeight=20 → maxScroll=10
    // scrollPos at 6 (= maxScroll - 4) → within threshold of 5 → at bottom
    const container = createMockContainer({ scrollPos: 6, height: 20 });
    const block = createMockBlock({ content: "l\n".repeat(29) }); // 30 lines
    const nodes = new Map<string, BlockNode>([["n1", createMockNode("n1")]]);
    const blocks = new Map<string, SelectableBlock>([["n1", block]]);
    const accessors = createAccessors({ rootIds: ["n1"], nodes, blocks });
    const sm = new ScrollManager(container as never, accessors);

    sm.setFollowMode(false);
    sm.handleUserScroll();
    // scrollPos(6) >= maxScroll(10) - threshold(5) = 5 → at bottom → followMode = true
    expect(sm.isFollowMode()).toBe(true);
  });

  it("isAtBottom() returns false when scroll position is well above bottom", () => {
    // content=30, containerHeight=20 → maxScroll=10, scrollPos=0 → 0 < 10-5=5 → NOT at bottom
    const container = createMockContainer({ scrollPos: 0, height: 20 });
    const block = createMockBlock({ content: "l\n".repeat(29) }); // 30 lines
    const nodes = new Map<string, BlockNode>([["n1", createMockNode("n1")]]);
    const blocks = new Map<string, SelectableBlock>([["n1", block]]);
    const accessors = createAccessors({ rootIds: ["n1"], nodes, blocks });
    const sm = new ScrollManager(container as never, accessors);

    sm.setFollowMode(true);
    sm.handleUserScroll();
    // scrollPos(0) < maxScroll(10) - threshold(5) = 5 → NOT at bottom → followMode = false
    expect(sm.isFollowMode()).toBe(false);
  });
});
