import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { setRuntime, NodeRuntime, ScrollableBox, Screen } from "@unblessed/node";
import { BlockRenderer } from "./block-renderer.js";

// Initialize unblessed for testing
let screen: Screen;

beforeAll(() => {
  setRuntime(new NodeRuntime());
  // Create a minimal screen for testing (won't actually render)
  screen = new Screen({
    smartCSR: true,
    title: "test",
    fullUnicode: true,
  });
});

afterAll(() => {
  if (screen) {
    screen.destroy();
  }
});

// Create a real ScrollableBox for testing
function createMockContainer() {
  return new ScrollableBox({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: " " },
  });
}

describe("BlockRenderer", () => {
  describe("addLLMCall deduplication", () => {
    test("creates unique block for first call with iteration", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});

      const id1 = renderer.addLLMCall(1, "test-model");

      expect(id1).toStartWith("llm_");
    });

    test("returns existing block ID when same iteration is added twice", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});

      const id1 = renderer.addLLMCall(1, "test-model");
      const id2 = renderer.addLLMCall(1, "test-model");

      expect(id1).toBe(id2);
    });

    test("creates separate blocks for different iterations", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});

      const id1 = renderer.addLLMCall(1, "test-model");
      const id2 = renderer.addLLMCall(2, "test-model");

      expect(id1).not.toBe(id2);
    });

    test("deduplication works for iteration 0", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});

      const id1 = renderer.addLLMCall(0, "test-model");
      const id2 = renderer.addLLMCall(0, "test-model");

      expect(id1).toBe(id2);
    });

    test("nested LLM calls (with parentGadgetId) are NOT deduplicated", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});

      // First, add a gadget to serve as parent
      const gadgetId = renderer.addGadget("gadget_1", "TestGadget");

      // Add nested LLM calls with same iteration but parent
      const nestedId1 = renderer.addLLMCall(0, "test-model", gadgetId);
      const nestedId2 = renderer.addLLMCall(0, "test-model", gadgetId);

      // Nested calls should create separate blocks (different behavior from root-level)
      expect(nestedId1).not.toBe(nestedId2);
    });

    test("root-level deduplication is independent from nested calls", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});

      // Add root-level LLM call with iteration 0
      const rootId = renderer.addLLMCall(0, "test-model");

      // Add a gadget
      const gadgetId = renderer.addGadget("gadget_1", "TestGadget");

      // Add nested LLM call with same iteration 0
      const nestedId = renderer.addLLMCall(0, "test-model", gadgetId);

      // Root and nested should be different (nested has parentGadgetId)
      expect(rootId).not.toBe(nestedId);

      // Adding another root-level 0 should return the existing root ID
      const rootId2 = renderer.addLLMCall(0, "test-model");
      expect(rootId2).toBe(rootId);
    });

    test("clear() resets deduplication map", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});

      const id1 = renderer.addLLMCall(1, "test-model");
      renderer.clear();
      const id2 = renderer.addLLMCall(1, "test-model");

      // After clear, same iteration creates new block
      expect(id1).not.toBe(id2);
    });
  });
});
