import { describe, expect, it, vi } from "vitest";
import { NodeStore } from "./node-store.js";

describe("NodeStore", () => {
  describe("addLLMCall", () => {
    it("creates a new LLM call node and returns unique ID", () => {
      const store = new NodeStore();
      const id = store.addLLMCall(1, "test-model");
      expect(id).toMatch(/^llm_/);
      expect(store.nodes.has(id)).toBe(true);
    });

    it("is idempotent for same iteration (root call)", () => {
      const store = new NodeStore();
      const id1 = store.addLLMCall(1, "test-model");
      const id2 = store.addLLMCall(1, "test-model");
      expect(id1).toBe(id2);
      expect(store.nodes.size).toBe(1);
    });

    it("creates distinct nodes for different iterations", () => {
      const store = new NodeStore();
      const id1 = store.addLLMCall(1, "test-model");
      const id2 = store.addLLMCall(2, "test-model");
      expect(id1).not.toBe(id2);
      expect(store.nodes.size).toBe(2);
    });

    it("adds top-level LLM calls to rootIds", () => {
      const store = new NodeStore();
      const id = store.addLLMCall(1, "test-model");
      expect(store.rootIds).toContain(id);
    });

    it("sets currentLLMCallId after adding", () => {
      const store = new NodeStore();
      const id = store.addLLMCall(1, "test-model");
      expect(store.currentLLMCallId).toBe(id);
    });

    it("nests LLM call under parent gadget", () => {
      const store = new NodeStore();
      store.addLLMCall(1, "root-model");
      const gadgetId = store.addGadget("inv1", "SubAgent");
      const nestedId = store.addLLMCall(1, "sub-model", gadgetId);

      expect(nestedId).toMatch(/^llm_/);
      expect(nestedId).not.toBe(store.rootIds[0]);

      // Nested node should NOT be in rootIds
      expect(store.rootIds).not.toContain(nestedId);

      // Parent gadget should have the nested LLM as child
      const gadget = store.nodes.get(gadgetId) as { children: string[] };
      expect(gadget.children).toContain(nestedId);
    });

    it("is idempotent for nested LLM call with same parent+iteration", () => {
      const store = new NodeStore();
      store.addLLMCall(1, "root");
      const gadgetId = store.addGadget("inv1", "Sub");
      const id1 = store.addLLMCall(1, "sub", gadgetId);
      const id2 = store.addLLMCall(1, "sub", gadgetId);
      expect(id1).toBe(id2);
    });

    it("treats isNested=true as distinct from root calls", () => {
      const store = new NodeStore();
      const rootId = store.addLLMCall(1, "model");
      const nestedId = store.addLLMCall(1, "model", undefined, true);
      expect(rootId).not.toBe(nestedId);
    });
  });

  describe("completeLLMCall", () => {
    it("marks node as complete with details", () => {
      const store = new NodeStore();
      const id = store.addLLMCall(1, "model");
      store.completeLLMCall(id, { inputTokens: 100, outputTokens: 50 });

      const node = store.nodes.get(id) as { isComplete: boolean; details: unknown };
      expect(node.isComplete).toBe(true);
      expect(node.details).toEqual({ inputTokens: 100, outputTokens: 50 });
    });

    it("attaches raw response when provided", () => {
      const store = new NodeStore();
      const id = store.addLLMCall(1, "model");
      store.completeLLMCall(id, {}, "raw response text");

      const node = store.nodes.get(id) as { rawResponse: string };
      expect(node.rawResponse).toBe("raw response text");
    });

    it("ignores unknown IDs gracefully", () => {
      const store = new NodeStore();
      expect(() => store.completeLLMCall("unknown_id", {})).not.toThrow();
    });
  });

  describe("addGadget", () => {
    it("creates a gadget node under current LLM call", () => {
      const store = new NodeStore();
      const llmId = store.addLLMCall(1, "model");
      const gadgetId = store.addGadget("inv1", "Calculator", { a: 1 });

      expect(gadgetId).toMatch(/^gadget_/);
      expect(store.nodes.has(gadgetId)).toBe(true);

      // Gadget should be a child of the LLM call
      const llmNode = store.nodes.get(llmId) as { children: string[] };
      expect(llmNode.children).toContain(gadgetId);
    });

    it("is idempotent by invocationId", () => {
      const store = new NodeStore();
      store.addLLMCall(1, "model");
      const id1 = store.addGadget("inv1", "Calculator");
      const id2 = store.addGadget("inv1", "Calculator");
      expect(id1).toBe(id2);
    });

    it("goes to rootIds if no current LLM call", () => {
      const store = new NodeStore();
      const gadgetId = store.addGadget("inv1", "Calculator");
      expect(store.rootIds).toContain(gadgetId);
    });
  });

  describe("completeGadget", () => {
    it("marks gadget as complete with result", () => {
      const store = new NodeStore();
      store.addLLMCall(1, "model");
      store.addGadget("inv1", "Calculator");
      store.completeGadget("inv1", { result: "42", executionTimeMs: 100 });

      const node = store.findGadgetByInvocationId("inv1");
      expect(node?.isComplete).toBe(true);
      expect(node?.result).toBe("42");
      expect(node?.executionTimeMs).toBe(100);
    });

    it("estimates resultTokens from result length", () => {
      const store = new NodeStore();
      store.addLLMCall(1, "model");
      store.addGadget("inv1", "Calculator");
      store.completeGadget("inv1", { result: "a".repeat(40) }); // 40 chars ~ 10 tokens

      const node = store.findGadgetByInvocationId("inv1");
      expect(node?.resultTokens).toBe(10); // ceil(40/4)
    });

    it("aggregates subagent stats from child LLM calls", () => {
      const store = new NodeStore();
      store.addLLMCall(1, "parent");
      const gadgetId = store.addGadget("inv1", "SubAgent");

      // Add a nested LLM call
      const childId = store.addLLMCall(1, "sub", gadgetId);
      store.completeLLMCall(childId, { inputTokens: 100, outputTokens: 50, cost: 0.01 });

      store.completeGadget("inv1", {});

      const node = store.findGadgetByInvocationId("inv1");
      expect(node?.subagentStats).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 0,
        cost: 0.01,
        llmCallCount: 1,
      });
    });

    it("ignores unknown invocationIds gracefully", () => {
      const store = new NodeStore();
      expect(() => store.completeGadget("unknown", {})).not.toThrow();
    });
  });

  describe("addText", () => {
    it("creates a text node and adds to rootIds", () => {
      const store = new NodeStore();
      const id = store.addText("Hello world");
      expect(id).toMatch(/^text_/);
      expect(store.rootIds).toContain(id);

      const node = store.nodes.get(id) as { type: string; content: string };
      expect(node.type).toBe("text");
      expect(node.content).toBe("Hello world");
    });
  });

  describe("addSystemMessage", () => {
    it("creates a system message node", () => {
      const store = new NodeStore();
      const id = store.addSystemMessage("Rate limit reached", "throttle");
      expect(id).toMatch(/^system_/);

      const node = store.nodes.get(id) as { type: string; message: string; category: string };
      expect(node.type).toBe("system_message");
      expect(node.message).toBe("Rate limit reached");
      expect(node.category).toBe("throttle");
    });
  });

  describe("addThinking", () => {
    it("creates a new thinking node on first chunk", () => {
      const store = new NodeStore();
      store.addLLMCall(1, "model");
      store.addThinking("I'm thinking...", "thinking");

      expect(store.currentThinkingId).not.toBeNull();
      const thinkingId = store.currentThinkingId ?? "";
      const node = store.nodes.get(thinkingId) as { content: string };
      expect(node.content).toBe("I'm thinking...");
    });

    it("appends to existing thinking block on subsequent chunks", () => {
      const store = new NodeStore();
      store.addLLMCall(1, "model");
      store.addThinking("First", "thinking");
      const firstId = store.currentThinkingId;
      store.addThinking(" Second", "thinking");

      expect(store.currentThinkingId).toBe(firstId);
      const node = store.nodes.get(firstId ?? "") as { content: string };
      expect(node.content).toBe("First Second");
    });
  });

  describe("completeThinking", () => {
    it("marks thinking block as complete and clears currentThinkingId", () => {
      const store = new NodeStore();
      store.addLLMCall(1, "model");
      store.addThinking("thinking...", "thinking");
      const thinkingId = store.currentThinkingId;

      store.completeThinking();

      expect(store.currentThinkingId).toBeNull();
      const node = store.nodes.get(thinkingId ?? "") as { isComplete: boolean };
      expect(node.isComplete).toBe(true);
    });
  });

  describe("addUserMessage", () => {
    it("creates a text node with user_ prefix ID", () => {
      const store = new NodeStore();
      const id = store.addUserMessage("Hello!");
      expect(id).toMatch(/^user_/);

      const node = store.nodes.get(id) as { type: string; content: string };
      expect(node.type).toBe("text");
      expect(node.content).toBe("Hello!");
    });
  });

  describe("findGadgetByInvocationId", () => {
    it("finds gadget by invocation ID", () => {
      const store = new NodeStore();
      store.addLLMCall(1, "model");
      store.addGadget("inv-123", "Calculator");

      const found = store.findGadgetByInvocationId("inv-123");
      expect(found?.name).toBe("Calculator");
    });

    it("returns undefined for unknown invocation ID", () => {
      const store = new NodeStore();
      expect(store.findGadgetByInvocationId("not-found")).toBeUndefined();
    });
  });

  describe("clear", () => {
    it("removes all nodes and resets state", () => {
      const store = new NodeStore();
      store.addLLMCall(1, "model");
      store.addGadget("inv1", "Calc");
      store.addText("hello");

      store.clear();

      expect(store.nodes.size).toBe(0);
      expect(store.rootIds).toEqual([]);
      expect(store.currentLLMCallId).toBeNull();
      expect(store.currentThinkingId).toBeNull();
    });
  });

  describe("session management", () => {
    it("starts at sessionId 0", () => {
      const store = new NodeStore();
      expect(store.getCurrentSessionId()).toBe(0);
    });

    it("increments sessionId on startNewSession", () => {
      const store = new NodeStore();
      store.startNewSession();
      expect(store.getCurrentSessionId()).toBe(1);
    });

    it("tracks previousSessionId", () => {
      const store = new NodeStore();
      store.startNewSession();
      expect(store.getPreviousSessionId()).toBe(0);
    });

    it("assigns current sessionId to new nodes", () => {
      const store = new NodeStore();
      store.startNewSession(); // sessionId = 1
      const id = store.addText("hello");

      const node = store.nodes.get(id) as { sessionId: number };
      expect(node.sessionId).toBe(1);
    });
  });

  describe("change callbacks", () => {
    it("calls onNodeAdded when a new node is added", () => {
      const store = new NodeStore();
      const onNodeAdded = vi.fn();
      store.setCallbacks({ onNodeAdded });

      store.addLLMCall(1, "model");
      expect(onNodeAdded).toHaveBeenCalledOnce();
    });

    it("calls onNodeUpdated when a node is updated", () => {
      const store = new NodeStore();
      const onNodeUpdated = vi.fn();
      store.setCallbacks({ onNodeUpdated });

      const id = store.addLLMCall(1, "model");
      store.completeLLMCall(id, {});

      expect(onNodeUpdated).toHaveBeenCalledWith(id);
    });

    it("calls onNodeAdded for text and gadget nodes", () => {
      const store = new NodeStore();
      const onNodeAdded = vi.fn();
      store.setCallbacks({ onNodeAdded });

      store.addText("hello");
      store.addSystemMessage("info", "info");

      expect(onNodeAdded).toHaveBeenCalledTimes(2);
    });
  });

  describe("setLLMCallRequest / setLLMCallResponse", () => {
    it("stores raw request on an LLM call node", () => {
      const store = new NodeStore();
      const id = store.addLLMCall(1, "model");
      const messages = [{ role: "user" as const, content: "hello" }];
      store.setLLMCallRequest(id, messages as never);

      const node = store.nodes.get(id) as { rawRequest: unknown };
      expect(node.rawRequest).toEqual(messages);
    });

    it("stores raw response on an LLM call node", () => {
      const store = new NodeStore();
      const id = store.addLLMCall(1, "model");
      store.setLLMCallResponse(id, "raw text response");

      const node = store.nodes.get(id) as { rawResponse: string };
      expect(node.rawResponse).toBe("raw text response");
    });
  });

  describe("clearIdempotencyMaps", () => {
    it("clears idempotency maps without removing nodes", () => {
      const store = new NodeStore();
      store.addLLMCall(1, "model");
      store.addGadget("inv1", "Calc");

      store.clearIdempotencyMaps();

      // Nodes still exist
      expect(store.nodes.size).toBe(2);
      // But idempotency is gone - can add same iteration again
      const newId = store.addLLMCall(1, "model");
      // A new node is created (not idempotent)
      expect(store.nodes.size).toBe(3);
      expect(newId).toMatch(/^llm_/);
    });
  });
});
