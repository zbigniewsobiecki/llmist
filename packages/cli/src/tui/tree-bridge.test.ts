import { describe, expect, it, vi } from "vitest";
import { TreeBridge, type TreeBridgeCallbacks } from "./tree-bridge.js";

// ─────────────────────────────────────────────────────────────────────────────
// Mock Helpers
// ─────────────────────────────────────────────────────────────────────────────

function createMockCallbacks(overrides: Partial<TreeBridgeCallbacks> = {}): TreeBridgeCallbacks {
  return {
    onResetThinking: vi.fn(),
    onSetCurrentLLMCall: vi.fn(),
    onClearIdempotencyMaps: vi.fn(),
    onAddLLMCall: vi.fn().mockReturnValue("llm_mock_id"),
    onCompleteLLMCall: vi.fn(),
    onSetLLMCallRequest: vi.fn(),
    onSetLLMCallResponse: vi.fn(),
    onCompleteThinking: vi.fn(),
    onAddThinking: vi.fn(),
    onAddGadget: vi.fn().mockReturnValue("gadget_mock_id"),
    onCompleteGadget: vi.fn(),
    onSkipGadget: vi.fn(),
    onGetCurrentLLMCallId: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

/**
 * Create a mock ExecutionTree with a controllable event listener.
 * Returns { tree, emit } — call emit(event) to dispatch events to listeners.
 */
function createMockTree() {
  type Handler = (event: unknown) => void;
  const handlers: Handler[] = [];

  const tree = {
    onAll: vi.fn((handler: Handler) => {
      handlers.push(handler);
      // Return unsubscribe function
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx !== -1) handlers.splice(idx, 1);
      };
    }),
    getNode: vi.fn().mockReturnValue(null),
  };

  const emit = (event: unknown) => {
    for (const handler of handlers) {
      handler(event);
    }
  };

  return { tree, emit };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("TreeBridge", () => {
  describe("isSubscribed", () => {
    it("returns false initially", () => {
      const callbacks = createMockCallbacks();
      const bridge = new TreeBridge(callbacks);
      expect(bridge.isSubscribed()).toBe(false);
    });

    it("returns true after subscribeToTree", () => {
      const callbacks = createMockCallbacks();
      const bridge = new TreeBridge(callbacks);
      const { tree } = createMockTree();
      bridge.subscribeToTree(tree as never);
      expect(bridge.isSubscribed()).toBe(true);
    });

    it("returns false after unsubscribing", () => {
      const callbacks = createMockCallbacks();
      const bridge = new TreeBridge(callbacks);
      const { tree } = createMockTree();
      const unsubscribe = bridge.subscribeToTree(tree as never);
      unsubscribe();
      expect(bridge.isSubscribed()).toBe(false);
    });
  });

  describe("subscribeToTree", () => {
    it("calls onClearIdempotencyMaps when subscribing", () => {
      const callbacks = createMockCallbacks();
      const bridge = new TreeBridge(callbacks);
      const { tree } = createMockTree();
      bridge.subscribeToTree(tree as never);
      expect(callbacks.onClearIdempotencyMaps).toHaveBeenCalledOnce();
    });

    it("unsubscribes from previous tree when subscribing to new one", () => {
      const callbacks = createMockCallbacks();
      const bridge = new TreeBridge(callbacks);

      const { tree: tree1 } = createMockTree();
      const { tree: tree2 } = createMockTree();

      bridge.subscribeToTree(tree1 as never);
      bridge.subscribeToTree(tree2 as never);

      // Only tree2 should be active
      expect(bridge.isSubscribed()).toBe(true);
      // Both trees had onAll called
      expect(tree1.onAll).toHaveBeenCalledOnce();
      expect(tree2.onAll).toHaveBeenCalledOnce();
    });
  });

  describe("llm_call_start event", () => {
    it("calls onResetThinking and onAddLLMCall", () => {
      const callbacks = createMockCallbacks();
      const bridge = new TreeBridge(callbacks);
      const { tree, emit } = createMockTree();
      bridge.subscribeToTree(tree as never);

      emit({
        type: "llm_call_start",
        nodeId: "node_1",
        iteration: 0,
        model: "test-model",
        depth: 0,
        parentId: null,
      });

      expect(callbacks.onResetThinking).toHaveBeenCalledOnce();
      expect(callbacks.onAddLLMCall).toHaveBeenCalledWith(
        1, // iteration + 1
        "test-model",
        undefined, // no parent
        false, // depth === 0
      );
    });

    it("passes isNested=true for depth > 0", () => {
      const callbacks = createMockCallbacks();
      const bridge = new TreeBridge(callbacks);
      const { tree, emit } = createMockTree();
      bridge.subscribeToTree(tree as never);

      emit({
        type: "llm_call_start",
        nodeId: "nested_node",
        iteration: 0,
        model: "sub-model",
        depth: 1,
        parentId: null,
      });

      expect(callbacks.onAddLLMCall).toHaveBeenCalledWith(1, "sub-model", undefined, true);
    });

    it("maps tree nodeId to block ID", () => {
      const callbacks = createMockCallbacks({
        onAddLLMCall: vi.fn().mockReturnValue("llm_created"),
      });
      const bridge = new TreeBridge(callbacks);
      const { tree, emit } = createMockTree();
      bridge.subscribeToTree(tree as never);

      emit({
        type: "llm_call_start",
        nodeId: "tree_node_1",
        iteration: 0,
        model: "model",
        depth: 0,
        parentId: null,
      });

      expect(bridge.getBlockIdForTreeNode("tree_node_1")).toBe("llm_created");
    });

    it("attaches raw request from tree node when available", () => {
      const mockRequest = [{ role: "user" as const, content: "hello" }];
      const callbacks = createMockCallbacks({
        onAddLLMCall: vi.fn().mockReturnValue("llm_1"),
      });
      const bridge = new TreeBridge(callbacks);
      const { tree, emit } = createMockTree();
      tree.getNode.mockReturnValue({
        type: "llm_call",
        request: mockRequest,
      });
      bridge.subscribeToTree(tree as never);

      emit({
        type: "llm_call_start",
        nodeId: "node_with_request",
        iteration: 0,
        model: "model",
        depth: 0,
        parentId: null,
      });

      expect(callbacks.onSetLLMCallRequest).toHaveBeenCalledWith("llm_1", mockRequest);
    });
  });

  describe("llm_call_complete event", () => {
    it("calls onCompleteThinking and onCompleteLLMCall", () => {
      const callbacks = createMockCallbacks({
        onAddLLMCall: vi.fn().mockReturnValue("llm_1"),
      });
      const bridge = new TreeBridge(callbacks);
      const { tree, emit } = createMockTree();
      bridge.subscribeToTree(tree as never);

      // First start the LLM call to register the mapping
      emit({
        type: "llm_call_start",
        nodeId: "node_1",
        iteration: 0,
        model: "model",
        depth: 0,
        parentId: null,
      });

      // Then complete it
      emit({
        type: "llm_call_complete",
        nodeId: "node_1",
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cachedInputTokens: 0,
        },
        cost: 0.01,
        finishReason: "end_turn",
      });

      expect(callbacks.onCompleteThinking).toHaveBeenCalledOnce();
      expect(callbacks.onCompleteLLMCall).toHaveBeenCalledWith("llm_1", {
        inputTokens: 100,
        cachedInputTokens: 0,
        outputTokens: 50,
        reasoningTokens: undefined,
        cost: 0.01,
        finishReason: "end_turn",
      });
    });
  });

  describe("thinking event", () => {
    it("calls onAddThinking with content and type", () => {
      const callbacks = createMockCallbacks();
      const bridge = new TreeBridge(callbacks);
      const { tree, emit } = createMockTree();
      bridge.subscribeToTree(tree as never);

      emit({
        type: "thinking",
        content: "I am thinking...",
        thinkingType: "thinking",
      });

      expect(callbacks.onAddThinking).toHaveBeenCalledWith("I am thinking...", "thinking");
    });
  });

  describe("gadget_call event", () => {
    it("calls onAddGadget with correct parameters", () => {
      const callbacks = createMockCallbacks({
        onAddGadget: vi.fn().mockReturnValue("gadget_1"),
      });
      const bridge = new TreeBridge(callbacks);
      const { tree, emit } = createMockTree();
      bridge.subscribeToTree(tree as never);

      emit({
        type: "gadget_call",
        nodeId: "gadget_node_1",
        parentId: null,
        invocationId: "inv_123",
        name: "Calculator",
        parameters: { a: 1, b: 2 },
      });

      expect(callbacks.onAddGadget).toHaveBeenCalledWith("inv_123", "Calculator", {
        a: 1,
        b: 2,
      });
    });

    it("maps gadget tree nodeId to block ID", () => {
      const callbacks = createMockCallbacks({
        onAddGadget: vi.fn().mockReturnValue("gadget_created"),
      });
      const bridge = new TreeBridge(callbacks);
      const { tree, emit } = createMockTree();
      bridge.subscribeToTree(tree as never);

      emit({
        type: "gadget_call",
        nodeId: "gadget_tree_node",
        parentId: null,
        invocationId: "inv1",
        name: "Calc",
        parameters: {},
      });

      expect(bridge.getBlockIdForTreeNode("gadget_tree_node")).toBe("gadget_created");
    });

    it("restores currentLLMCallId after setting parent block", () => {
      const previousLLMCallId = "previous_llm_call_id";
      const callbacks = createMockCallbacks({
        onGetCurrentLLMCallId: vi.fn().mockReturnValue(previousLLMCallId),
        onAddLLMCall: vi.fn().mockReturnValue("parent_llm"),
        onAddGadget: vi.fn().mockReturnValue("gadget_1"),
      });
      const bridge = new TreeBridge(callbacks);
      const { tree, emit } = createMockTree();

      // Register a parent LLM call
      tree.getNode.mockReturnValue(null);
      bridge.subscribeToTree(tree as never);

      emit({
        type: "llm_call_start",
        nodeId: "llm_node",
        iteration: 0,
        model: "model",
        depth: 0,
        parentId: null,
      });

      // Emit gadget under that LLM
      emit({
        type: "gadget_call",
        nodeId: "gadget_node",
        parentId: "llm_node",
        invocationId: "inv1",
        name: "Calc",
        parameters: {},
      });

      // After gadget creation, currentLLMCall should be restored to the value
      // captured via onGetCurrentLLMCallId before setting the parent
      const lastSetCurrentCall = (callbacks.onSetCurrentLLMCall as ReturnType<typeof vi.fn>).mock
        .calls;
      // The last call should restore the previous ID
      expect(lastSetCurrentCall.at(-1)).toEqual([previousLLMCallId]);
    });
  });

  describe("gadget_complete event", () => {
    it("calls onCompleteGadget with result and timing", () => {
      const callbacks = createMockCallbacks();
      const bridge = new TreeBridge(callbacks);
      const { tree, emit } = createMockTree();
      bridge.subscribeToTree(tree as never);

      emit({
        type: "gadget_complete",
        invocationId: "inv_123",
        result: "42",
        executionTimeMs: 500,
        cost: 0.001,
        storedMedia: undefined,
      });

      expect(callbacks.onCompleteGadget).toHaveBeenCalledWith("inv_123", {
        result: "42",
        executionTimeMs: 500,
        cost: 0.001,
        mediaOutputs: undefined,
      });
    });
  });

  describe("gadget_error event", () => {
    it("calls onCompleteGadget with error", () => {
      const callbacks = createMockCallbacks();
      const bridge = new TreeBridge(callbacks);
      const { tree, emit } = createMockTree();
      bridge.subscribeToTree(tree as never);

      emit({
        type: "gadget_error",
        invocationId: "inv_123",
        error: "Timeout error",
        executionTimeMs: 5000,
      });

      expect(callbacks.onCompleteGadget).toHaveBeenCalledWith("inv_123", {
        error: "Timeout error",
        executionTimeMs: 5000,
      });
    });
  });

  describe("gadget_skipped event", () => {
    it("calls onSkipGadget with the reason", () => {
      const callbacks = createMockCallbacks();
      const bridge = new TreeBridge(callbacks);
      const { tree, emit } = createMockTree();
      bridge.subscribeToTree(tree as never);

      emit({
        type: "gadget_skipped",
        invocationId: "inv_123",
        failedDependencyError: "Dependency failed",
      });

      expect(callbacks.onSkipGadget).toHaveBeenCalledWith("inv_123", "Skipped: Dependency failed");
    });
  });

  describe("getBlockIdForTreeNode", () => {
    it("returns undefined for unknown tree nodes", () => {
      const callbacks = createMockCallbacks();
      const bridge = new TreeBridge(callbacks);
      expect(bridge.getBlockIdForTreeNode("unknown")).toBeUndefined();
    });
  });
});
