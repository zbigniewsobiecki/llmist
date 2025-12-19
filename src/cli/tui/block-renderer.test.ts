import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { setRuntime, NodeRuntime, ScrollableBox, Screen } from "@unblessed/node";
import { BlockRenderer } from "./block-renderer.js";
import { ExecutionTree } from "../../core/execution-tree.js";

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

    test("nested LLM calls (with parentGadgetId) ARE deduplicated by parent+iteration", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});

      // First, add a gadget to serve as parent
      const gadgetId = renderer.addGadget("gadget_1", "TestGadget");

      // Add nested LLM calls with same iteration and parent
      const nestedId1 = renderer.addLLMCall(1, "test-model", gadgetId);
      const nestedId2 = renderer.addLLMCall(1, "test-model", gadgetId);

      // Same parent + same iteration should return same block (deduplication)
      expect(nestedId1).toBe(nestedId2);
    });

    test("nested LLM calls with different iterations create separate blocks", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});

      // First, add a gadget to serve as parent
      const gadgetId = renderer.addGadget("gadget_1", "TestGadget");

      // Add nested LLM calls with different iterations
      const nestedId1 = renderer.addLLMCall(1, "test-model", gadgetId);
      const nestedId2 = renderer.addLLMCall(2, "test-model", gadgetId);

      // Different iterations should create different blocks
      expect(nestedId1).not.toBe(nestedId2);
    });

    test("nested LLM calls with different parents create separate blocks", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});

      // Add two gadgets as parents
      const gadgetId1 = renderer.addGadget("gadget_1", "TestGadget1");
      const gadgetId2 = renderer.addGadget("gadget_2", "TestGadget2");

      // Add nested LLM calls with same iteration but different parents
      const nestedId1 = renderer.addLLMCall(1, "test-model", gadgetId1);
      const nestedId2 = renderer.addLLMCall(1, "test-model", gadgetId2);

      // Different parents should create different blocks
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

  describe("ExecutionTree subscription", () => {
    test("subscribeToTree creates blocks from tree events", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});
      const tree = new ExecutionTree();

      // Subscribe to tree
      const unsubscribe = renderer.subscribeToTree(tree);

      // Add LLM call via tree (this emits llm_call_start event)
      const llmNode = tree.addLLMCall({ iteration: 1, model: "sonnet" });

      // Verify block was created
      const blockId = renderer.getBlockIdForTreeNode(llmNode.id);
      expect(blockId).toBeDefined();
      expect(blockId).toStartWith("llm_");

      unsubscribe();
    });

    test("subscribeToTree handles gadget events", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});
      const tree = new ExecutionTree();

      const unsubscribe = renderer.subscribeToTree(tree);

      // Add LLM call first
      const llmNode = tree.addLLMCall({ iteration: 1, model: "sonnet" });

      // Add gadget via tree
      const gadgetNode = tree.addGadget({
        invocationId: "gc_1",
        name: "ReadFile",
        parameters: { path: "/test.txt" },
        parentId: llmNode.id,
      });

      // Verify gadget block was created
      const gadgetBlockId = renderer.getBlockIdForTreeNode(gadgetNode.id);
      expect(gadgetBlockId).toBeDefined();

      // Verify gadget can be found by invocation ID
      const foundGadget = renderer.findGadgetByInvocationId("gc_1");
      expect(foundGadget).toBeDefined();
      expect(foundGadget?.name).toBe("ReadFile");

      unsubscribe();
    });

    test("subscribeToTree handles nested subagent LLM calls", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});
      const tree = new ExecutionTree();

      const unsubscribe = renderer.subscribeToTree(tree);

      // Add root LLM call
      const rootLLM = tree.addLLMCall({ iteration: 1, model: "sonnet" });

      // Add gadget (subagent)
      const gadgetNode = tree.addGadget({
        invocationId: "gc_browse",
        name: "BrowseWeb",
        parameters: { url: "https://example.com" },
        parentId: rootLLM.id,
      });

      // Add nested LLM call under the gadget (subagent behavior)
      const nestedLLM = tree.addLLMCall({
        iteration: 1,
        model: "haiku",
        parentId: gadgetNode.id,
      });

      // Verify all blocks were created
      const rootBlockId = renderer.getBlockIdForTreeNode(rootLLM.id);
      const gadgetBlockId = renderer.getBlockIdForTreeNode(gadgetNode.id);
      const nestedBlockId = renderer.getBlockIdForTreeNode(nestedLLM.id);

      expect(rootBlockId).toBeDefined();
      expect(gadgetBlockId).toBeDefined();
      expect(nestedBlockId).toBeDefined();

      // All should be different blocks
      expect(rootBlockId).not.toBe(gadgetBlockId);
      expect(rootBlockId).not.toBe(nestedBlockId);
      expect(gadgetBlockId).not.toBe(nestedBlockId);

      unsubscribe();
    });

    test("subscribeToTree updates gadget on completion", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});
      const tree = new ExecutionTree();

      const unsubscribe = renderer.subscribeToTree(tree);

      // Add LLM call and gadget
      const llmNode = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      const gadgetNode = tree.addGadget({
        invocationId: "gc_1",
        name: "ReadFile",
        parameters: { path: "/test.txt" },
        parentId: llmNode.id,
      });

      // Start and complete the gadget
      tree.startGadget(gadgetNode.id);
      tree.completeGadget(gadgetNode.id, {
        result: "file contents here",
        executionTimeMs: 42,
        cost: 0.001,
      });

      // Verify gadget is marked complete
      const foundGadget = renderer.findGadgetByInvocationId("gc_1");
      expect(foundGadget?.isComplete).toBe(true);
      expect(foundGadget?.result).toBe("file contents here");
      expect(foundGadget?.executionTimeMs).toBe(42);
      expect(foundGadget?.cost).toBe(0.001);

      unsubscribe();
    });

    test("subscribeToTree handles gadget errors", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});
      const tree = new ExecutionTree();

      const unsubscribe = renderer.subscribeToTree(tree);

      // Add LLM call and gadget
      const llmNode = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      const gadgetNode = tree.addGadget({
        invocationId: "gc_fail",
        name: "ReadFile",
        parameters: { path: "/nonexistent.txt" },
        parentId: llmNode.id,
      });

      // Complete with error
      tree.startGadget(gadgetNode.id);
      tree.completeGadget(gadgetNode.id, {
        error: "File not found",
        executionTimeMs: 5,
      });

      // Verify gadget has error
      const foundGadget = renderer.findGadgetByInvocationId("gc_fail");
      expect(foundGadget?.isComplete).toBe(true);
      expect(foundGadget?.error).toBe("File not found");

      unsubscribe();
    });

    test("subscribeToTree handles skipped gadgets", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});
      const tree = new ExecutionTree();

      const unsubscribe = renderer.subscribeToTree(tree);

      // Add LLM call and gadget
      const llmNode = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      const gadgetNode = tree.addGadget({
        invocationId: "gc_skip",
        name: "WriteFile",
        parameters: { path: "/out.txt" },
        dependencies: ["gc_read"],
        parentId: llmNode.id,
      });

      // Skip due to dependency failure
      tree.skipGadget(gadgetNode.id, "gc_read", "File not found", "dependency_failed");

      // Verify gadget is marked as skipped with error
      const foundGadget = renderer.findGadgetByInvocationId("gc_skip");
      expect(foundGadget?.isComplete).toBe(true);
      expect(foundGadget?.error).toContain("Skipped");

      unsubscribe();
    });

    test("subscribeToTree completes LLM calls with usage info", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});
      const tree = new ExecutionTree();

      const unsubscribe = renderer.subscribeToTree(tree);

      // Add and complete LLM call
      const llmNode = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      tree.completeLLMCall(llmNode.id, {
        response: "Hello, world!",
        usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 10 },
        finishReason: "stop",
        cost: 0.005,
      });

      // Get the block and verify it was completed
      const blockId = renderer.getBlockIdForTreeNode(llmNode.id);
      expect(blockId).toBeDefined();
      // The block should exist (we can't easily check completion state from outside)

      unsubscribe();
    });

    test("unsubscribe stops listening to tree events", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});
      const tree = new ExecutionTree();

      const unsubscribe = renderer.subscribeToTree(tree);

      // Add first LLM call while subscribed
      const llm1 = tree.addLLMCall({ iteration: 1, model: "sonnet" });
      expect(renderer.getBlockIdForTreeNode(llm1.id)).toBeDefined();

      // Unsubscribe
      unsubscribe();

      // Add second LLM call after unsubscribe
      const llm2 = tree.addLLMCall({ iteration: 2, model: "sonnet" });

      // Second block should NOT be created (no subscription)
      expect(renderer.getBlockIdForTreeNode(llm2.id)).toBeUndefined();
    });

    test("multiple subscriptions replace each other", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});
      const tree1 = new ExecutionTree();
      const tree2 = new ExecutionTree();

      // Subscribe to first tree
      renderer.subscribeToTree(tree1);

      // Add to first tree
      const llm1 = tree1.addLLMCall({ iteration: 1, model: "sonnet" });
      expect(renderer.getBlockIdForTreeNode(llm1.id)).toBeDefined();

      // Subscribe to second tree (replaces first subscription)
      renderer.subscribeToTree(tree2);

      // Add to first tree (should NOT create block - unsubscribed)
      const llm1b = tree1.addLLMCall({ iteration: 2, model: "sonnet" });
      expect(renderer.getBlockIdForTreeNode(llm1b.id)).toBeUndefined();

      // Add to second tree (should create block)
      const llm2 = tree2.addLLMCall({ iteration: 1, model: "haiku" });
      expect(renderer.getBlockIdForTreeNode(llm2.id)).toBeDefined();
    });

    test("tree subscription works with deep nesting (subagent with gadgets)", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});
      const tree = new ExecutionTree();

      const unsubscribe = renderer.subscribeToTree(tree);

      // Level 0: Root LLM call
      const rootLLM = tree.addLLMCall({ iteration: 1, model: "opus" });

      // Level 1: Subagent gadget (BrowseWeb)
      const browseGadget = tree.addGadget({
        invocationId: "gc_browse",
        name: "BrowseWeb",
        parameters: { url: "https://example.com" },
        parentId: rootLLM.id,
      });

      // Level 2: Subagent's LLM call
      const subagentLLM = tree.addLLMCall({
        iteration: 1,
        model: "haiku",
        parentId: browseGadget.id,
      });

      // Level 3: Subagent's gadget (TakeScreenshot)
      const screenshotGadget = tree.addGadget({
        invocationId: "gc_screenshot",
        name: "TakeScreenshot",
        parameters: {},
        parentId: subagentLLM.id,
      });

      // Verify all 4 nodes created blocks
      expect(renderer.getBlockIdForTreeNode(rootLLM.id)).toBeDefined();
      expect(renderer.getBlockIdForTreeNode(browseGadget.id)).toBeDefined();
      expect(renderer.getBlockIdForTreeNode(subagentLLM.id)).toBeDefined();
      expect(renderer.getBlockIdForTreeNode(screenshotGadget.id)).toBeDefined();

      // Complete from bottom up
      tree.startGadget(screenshotGadget.id);
      tree.completeGadget(screenshotGadget.id, {
        result: "screenshot.png",
        media: [{ type: "image", data: "base64data", mimeType: "image/png" }],
      });

      tree.completeLLMCall(subagentLLM.id, {
        response: "Screenshot taken",
        usage: { inputTokens: 50, outputTokens: 20 },
      });

      tree.startGadget(browseGadget.id);
      tree.completeGadget(browseGadget.id, {
        result: "Browsed successfully",
        cost: 0.01,
      });

      tree.completeLLMCall(rootLLM.id, {
        response: "Task complete",
        usage: { inputTokens: 200, outputTokens: 100 },
      });

      // Verify all gadgets are complete
      expect(renderer.findGadgetByInvocationId("gc_browse")?.isComplete).toBe(true);
      expect(renderer.findGadgetByInvocationId("gc_screenshot")?.isComplete).toBe(true);

      unsubscribe();
    });

    test("tree subscription coexists with manual block creation (dual-path)", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});
      const tree = new ExecutionTree();

      // Subscribe to tree
      const unsubscribe = renderer.subscribeToTree(tree);

      // Manually create a block (simulates hook-based creation with 1-indexed iteration)
      const manualBlockId = renderer.addLLMCall(1, "sonnet");

      // Tree event for same iteration (tree uses 0-indexed, handler adds +1 for display)
      // So iteration: 0 becomes iteration 1 in addLLMCall, matching the manual block
      const llmNode = tree.addLLMCall({ iteration: 0, model: "sonnet" });
      const treeBlockId = renderer.getBlockIdForTreeNode(llmNode.id);

      // Both paths should refer to the same block
      expect(treeBlockId).toBe(manualBlockId);

      unsubscribe();
    });
  });

  describe("addGadget deduplication", () => {
    test("creates unique block for first gadget with invocationId", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});

      const id1 = renderer.addGadget("gc_1", "ReadFile", { path: "/test.txt" });

      expect(id1).toStartWith("gadget_");
    });

    test("returns existing block ID when same invocationId is added twice", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});

      const id1 = renderer.addGadget("gc_1", "ReadFile", { path: "/test.txt" });
      const id2 = renderer.addGadget("gc_1", "ReadFile", { path: "/test.txt" });

      expect(id1).toBe(id2);
    });

    test("creates separate blocks for different invocationIds", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});

      const id1 = renderer.addGadget("gc_1", "ReadFile", { path: "/a.txt" });
      const id2 = renderer.addGadget("gc_2", "ReadFile", { path: "/b.txt" });

      expect(id1).not.toBe(id2);
    });

    test("clear() resets gadget deduplication map", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});

      const id1 = renderer.addGadget("gc_1", "ReadFile");
      renderer.clear();
      const id2 = renderer.addGadget("gc_1", "ReadFile");

      // After clear, same invocationId creates new block
      expect(id1).not.toBe(id2);
    });

    test("gadget deduplication works with tree subscription (dual-path)", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});
      const tree = new ExecutionTree();

      // Add LLM call first (for proper parenting)
      renderer.addLLMCall(1, "sonnet");

      // Subscribe to tree
      const unsubscribe = renderer.subscribeToTree(tree);

      // Manually create gadget (simulates handleEvent path)
      const manualGadgetId = renderer.addGadget("gc_browse", "BrowseWeb", { url: "https://example.com" });

      // Tree event for same gadget (should reuse existing)
      // Tree uses 0-indexed iteration, handler adds +1 to match display
      const llmNode = tree.addLLMCall({ iteration: 0, model: "sonnet" });
      const gadgetNode = tree.addGadget({
        invocationId: "gc_browse",
        name: "BrowseWeb",
        parameters: { url: "https://example.com" },
        parentId: llmNode.id,
      });
      const treeGadgetId = renderer.getBlockIdForTreeNode(gadgetNode.id);

      // Both paths should refer to the same block
      expect(treeGadgetId).toBe(manualGadgetId);

      // Only one gadget should exist
      const allGadgets = [...new Set([manualGadgetId, treeGadgetId])];
      expect(allGadgets).toHaveLength(1);

      unsubscribe();
    });

    test("nested subagent LLM calls use deduplicated gadget as parent", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});
      const tree = new ExecutionTree();

      // Add root LLM call (1-indexed for display)
      const rootBlockId = renderer.addLLMCall(1, "sonnet");

      // Subscribe to tree
      const unsubscribe = renderer.subscribeToTree(tree);

      // Manually create gadget (simulates handleEvent path)
      const manualGadgetId = renderer.addGadget("gc_browse", "BrowseWeb");

      // Tree creates the same gadget (should deduplicate)
      // Tree uses 0-indexed iteration, handler adds +1 to match display
      const rootLLM = tree.addLLMCall({ iteration: 0, model: "sonnet" });
      const gadgetNode = tree.addGadget({
        invocationId: "gc_browse",
        name: "BrowseWeb",
        parameters: {},
        parentId: rootLLM.id,
      });

      // Tree creates nested LLM call under the gadget
      // Subagent iterations are also 0-indexed in tree
      const nestedLLM = tree.addLLMCall({
        iteration: 0,
        model: "haiku",
        parentId: gadgetNode.id,
      });

      // The nested LLM call should be parented to the SAME gadget block
      const nestedBlockId = renderer.getBlockIdForTreeNode(nestedLLM.id);
      expect(nestedBlockId).toBeDefined();

      // Verify the gadget was deduplicated (both paths use same ID)
      const treeGadgetId = renderer.getBlockIdForTreeNode(gadgetNode.id);
      expect(treeGadgetId).toBe(manualGadgetId);

      unsubscribe();
    });
  });

  describe("addUserMessage", () => {
    test("creates a text node with formatted user message", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});

      const id = renderer.addUserMessage("Test message");

      // ID should start with "user_"
      expect(id).toMatch(/^user_\d+$/);
    });

    test("adds user messages to root level", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});

      const id1 = renderer.addUserMessage("First message");
      const id2 = renderer.addUserMessage("Second message");

      // Both should be created (not deduplicated like LLM calls)
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^user_\d+$/);
      expect(id2).toMatch(/^user_\d+$/);
    });

    test("each user message creates a unique ID", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});

      const ids = new Set<string>();
      for (let i = 0; i < 5; i++) {
        const id = renderer.addUserMessage(`Message ${i}`);
        ids.add(id);
      }

      // All IDs should be unique
      expect(ids.size).toBe(5);
    });

    test("handles empty message", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});

      const id = renderer.addUserMessage("");

      expect(id).toMatch(/^user_\d+$/);
    });

    test("clear() does not affect user message ID counter uniqueness", () => {
      const container = createMockContainer();
      const renderer = new BlockRenderer(container, () => {});

      const id1 = renderer.addUserMessage("Before clear");
      renderer.clear();
      const id2 = renderer.addUserMessage("After clear");

      // IDs should still be unique after clear
      expect(id1).not.toBe(id2);
    });
  });
});
