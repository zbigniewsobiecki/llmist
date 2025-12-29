/**
 * Comprehensive tests for subagent hooks, events, and withParentContext.
 * Tests hook propagation, event forwarding, and proper depth tracking.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { z } from "zod";

import { ExecutionTree } from "../core/execution-tree.js";
import type { ExecutionEvent } from "../core/execution-events.js";
import { Gadget } from "../gadgets/typed-gadget.js";
import type { ExecutionContext, SubagentEvent, HostExports } from "../gadgets/types.js";
import { createMockClient, getMockManager } from "../../../testing/src/index.js";
import { AgentBuilder } from "./builder.js";
import { LLMist } from "../core/client.js";
import { createGadget } from "../gadgets/create-gadget.js";
import type {
  ObserveLLMCallContext,
  ObserveLLMCompleteContext,
} from "./hooks.js";

// Mock host exports for testing
const mockHostExports: HostExports = {
  AgentBuilder,
  LLMist,
  ExecutionTree,
  Gadget,
  createGadget,
  z,
};

// Simple echo gadget for testing event forwarding
class EchoGadget extends Gadget({
  name: "EchoGadget",
  description: "Echoes input",
  schema: z.object({ message: z.string() }),
}) {
  execute(params: { message: string }): string {
    return `Echo: ${params.message}`;
  }
}

describe("withParentContext", () => {
  let mockManager: ReturnType<typeof getMockManager>;

  beforeEach(() => {
    mockManager = getMockManager();
  });

  afterEach(() => {
    mockManager.clear();
  });

  describe("signal forwarding", () => {
    it("should forward abort signal from parent", async () => {
      const abortController = new AbortController();

      const ctx: ExecutionContext = {
        reportCost: () => {},
        signal: abortController.signal,
        hostExports: mockHostExports,
      };

      const mockClient = createMockClient();
      const builder = new AgentBuilder(mockClient)
        .withModel("mock:test")
        .withParentContext(ctx);

      // Access signal from internal state
      const builderInternal = builder as unknown as { signal?: AbortSignal };
      expect(builderInternal.signal).toBe(abortController.signal);
    });

    it("should not override existing signal", async () => {
      const parentAbortController = new AbortController();
      const childAbortController = new AbortController();

      const ctx: ExecutionContext = {
        reportCost: () => {},
        signal: parentAbortController.signal,
        hostExports: mockHostExports,
      };

      const mockClient = createMockClient();
      const builder = new AgentBuilder(mockClient)
        .withModel("mock:test")
        .withSignal(childAbortController.signal)
        .withParentContext(ctx);

      const builderInternal = builder as unknown as { signal?: AbortSignal };
      // Child's signal should be preserved, not overwritten by parent's
      expect(builderInternal.signal).toBe(childAbortController.signal);
    });
  });

  describe("subagent event forwarding", () => {
    it("should forward llm_call_start events to parent", async () => {
      const events: SubagentEvent[] = [];
      const invocationId = "test-invocation-123";

      const ctx: ExecutionContext = {
        reportCost: () => {},
        signal: new AbortController().signal,
        invocationId,
        onSubagentEvent: (event) => events.push(event),
        hostExports: mockHostExports,
      };

      const mockClient = createMockClient();
      mockManager.register({
        matcher: () => true,
        response: { text: "Hello" },
      });

      const subagent = new AgentBuilder(mockClient)
        .withModel("mock:test")
        .withParentContext(ctx)
        .ask("test");

      for await (const _event of subagent.run()) {
        // Consume events
      }

      const llmCallStarts = events.filter((e) => e.type === "llm_call_start");
      expect(llmCallStarts.length).toBeGreaterThanOrEqual(1);

      const firstStart = llmCallStarts[0];
      expect(firstStart.gadgetInvocationId).toBe(invocationId);
      expect(firstStart.depth).toBe(1);
      // iteration starts at 0
      expect(firstStart.iteration).toBe(0);
    });

    it("should forward llm_call_end events to parent", async () => {
      const events: SubagentEvent[] = [];
      const invocationId = "test-invocation-456";

      const ctx: ExecutionContext = {
        reportCost: () => {},
        signal: new AbortController().signal,
        invocationId,
        onSubagentEvent: (event) => events.push(event),
        hostExports: mockHostExports,
      };

      const mockClient = createMockClient();
      mockManager.register({
        matcher: () => true,
        response: { text: "Hello" },
      });

      const subagent = new AgentBuilder(mockClient)
        .withModel("mock:test")
        .withParentContext(ctx)
        .ask("test");

      for await (const _event of subagent.run()) {
        // Consume events
      }

      const llmCallEnds = events.filter((e) => e.type === "llm_call_end");
      expect(llmCallEnds.length).toBeGreaterThanOrEqual(1);

      const firstEnd = llmCallEnds[0];
      expect(firstEnd.gadgetInvocationId).toBe(invocationId);
      expect(firstEnd.depth).toBe(1);
    });

    it("should forward gadget_call events to parent", async () => {
      const events: SubagentEvent[] = [];
      const invocationId = "test-invocation-789";

      const ctx: ExecutionContext = {
        reportCost: () => {},
        signal: new AbortController().signal,
        invocationId,
        onSubagentEvent: (event) => events.push(event),
        hostExports: mockHostExports,
      };

      const mockClient = createMockClient();
      mockManager.register({
        matcher: () => true,
        response: {
          text: "!!!GADGET_START:EchoGadget\n!!!ARG:message\nhello world\n!!!GADGET_END",
        },
      });

      const subagent = new AgentBuilder(mockClient)
        .withModel("mock:test")
        .withGadgets(EchoGadget)
        .withMaxIterations(2)
        .withParentContext(ctx)
        .ask("test");

      for await (const _event of subagent.run()) {
        // Consume events
      }

      const gadgetCalls = events.filter((e) => e.type === "gadget_call");
      expect(gadgetCalls.length).toBeGreaterThanOrEqual(1);

      const firstCall = gadgetCalls[0];
      expect(firstCall.gadgetInvocationId).toBe(invocationId);
      expect(firstCall.depth).toBe(1);
    });

    it("should not forward events when onSubagentEvent is not provided", async () => {
      // Context without onSubagentEvent
      const ctx: ExecutionContext = {
        reportCost: () => {},
        signal: new AbortController().signal,
        invocationId: "test-invocation",
        hostExports: mockHostExports,
      };

      const mockClient = createMockClient();
      mockManager.register({
        matcher: () => true,
        response: { text: "Hello" },
      });

      // Should not throw
      const subagent = new AgentBuilder(mockClient)
        .withModel("mock:test")
        .withParentContext(ctx)
        .ask("test");

      let completed = false;
      for await (const _event of subagent.run()) {
        // Consume events
      }
      completed = true;

      expect(completed).toBe(true);
    });
  });

  describe("depth accumulation for nested subagents", () => {
    it("should accumulate depth for recursive subagent events", async () => {
      const events: SubagentEvent[] = [];
      const invocationId = "parent-invocation";

      // Simulate a nested subagent event coming from a deeper level
      const ctx: ExecutionContext = {
        reportCost: () => {},
        signal: new AbortController().signal,
        invocationId,
        onSubagentEvent: (event) => events.push(event),
        hostExports: mockHostExports,
      };

      const mockClient = createMockClient();
      const builder = new AgentBuilder(mockClient)
        .withModel("mock:test")
        .withParentContext(ctx, 2); // Start at depth 2

      // Access the subagentEventCallback
      const builderInternal = builder as unknown as {
        subagentEventCallback?: (event: SubagentEvent) => void;
      };

      // Simulate a nested subagent event
      builderInternal.subagentEventCallback?.({
        type: "llm_call_start",
        gadgetInvocationId: "nested-invocation",
        depth: 1,
        event: { iteration: 0, model: "mock:test" },
      });

      expect(events.length).toBe(1);
      // Depth should be accumulated: parent depth (2) + event depth (1) = 3
      expect(events[0].depth).toBe(3);
      expect(events[0].gadgetInvocationId).toBe(invocationId);
    });

    it("should use specified depth in withParentContext", async () => {
      const events: SubagentEvent[] = [];

      const ctx: ExecutionContext = {
        reportCost: () => {},
        signal: new AbortController().signal,
        invocationId: "test-invocation",
        onSubagentEvent: (event) => events.push(event),
        hostExports: mockHostExports,
      };

      const mockClient = createMockClient();
      mockManager.register({
        matcher: () => true,
        response: { text: "Hello" },
      });

      // Create subagent with custom depth
      const subagent = new AgentBuilder(mockClient)
        .withModel("mock:test")
        .withParentContext(ctx, 3) // Custom depth of 3
        .ask("test");

      for await (const _event of subagent.run()) {
        // Consume events
      }

      const llmCallStarts = events.filter((e) => e.type === "llm_call_start");
      expect(llmCallStarts.length).toBeGreaterThanOrEqual(1);
      expect(llmCallStarts[0].depth).toBe(3);
    });
  });

  describe("tree context capture", () => {
    it("should capture tree context from parent", () => {
      const tree = new ExecutionTree();
      const nodeId = "test-node-id";

      const ctx: ExecutionContext = {
        reportCost: () => {},
        signal: new AbortController().signal,
        tree,
        nodeId,
        depth: 2,
        hostExports: mockHostExports,
      };

      const mockClient = createMockClient();
      const builder = new AgentBuilder(mockClient)
        .withModel("mock:test")
        .withParentContext(ctx);

      // Access the parentContext
      const builderInternal = builder as unknown as {
        parentContext?: { tree: ExecutionTree; nodeId: string; depth: number };
      };

      expect(builderInternal.parentContext).toBeDefined();
      expect(builderInternal.parentContext?.tree).toBe(tree);
      expect(builderInternal.parentContext?.nodeId).toBe(nodeId);
      expect(builderInternal.parentContext?.depth).toBe(1); // default depth param
    });

    it("should not capture tree context when tree is missing", () => {
      const ctx: ExecutionContext = {
        reportCost: () => {},
        signal: new AbortController().signal,
        hostExports: mockHostExports,
      };

      const mockClient = createMockClient();
      const builder = new AgentBuilder(mockClient)
        .withModel("mock:test")
        .withParentContext(ctx);

      const builderInternal = builder as unknown as {
        parentContext?: { tree: ExecutionTree; nodeId: string; depth: number };
      };

      expect(builderInternal.parentContext).toBeUndefined();
    });
  });
});

describe("hook propagation with subagentContext", () => {
  let mockManager: ReturnType<typeof getMockManager>;

  beforeEach(() => {
    mockManager = getMockManager();
  });

  afterEach(() => {
    mockManager.clear();
  });

  it("should not have subagentContext for top-level agent", async () => {
    const observedContexts: {
      llmStart: (ObserveLLMCallContext | undefined)[];
      llmComplete: (ObserveLLMCompleteContext | undefined)[];
    } = {
      llmStart: [],
      llmComplete: [],
    };

    const mockClient = createMockClient();
    mockManager.register({
      matcher: () => true,
      response: { text: "Hello" },
    });

    const agent = new AgentBuilder(mockClient)
      .withModel("mock:test")
      .withHooks({
        observers: {
          onLLMCallStart: (ctx) => {
            observedContexts.llmStart.push(ctx);
          },
          onLLMCallComplete: (ctx) => {
            observedContexts.llmComplete.push(ctx);
          },
        },
      })
      .ask("test");

    for await (const _event of agent.run()) {
      // Consume events
    }

    // Top-level agent should NOT have subagentContext
    expect(observedContexts.llmStart.length).toBeGreaterThanOrEqual(1);
    expect(observedContexts.llmStart[0]?.subagentContext).toBeUndefined();

    expect(observedContexts.llmComplete.length).toBeGreaterThanOrEqual(1);
    expect(observedContexts.llmComplete[0]?.subagentContext).toBeUndefined();
  });

  it("should preserve existing observer hooks when using withParentContext", async () => {
    const existingHookCalls: string[] = [];
    const eventForwardCalls: SubagentEvent[] = [];

    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      invocationId: "test-invocation",
      onSubagentEvent: (event) => eventForwardCalls.push(event),
      hostExports: mockHostExports,
    };

    const mockClient = createMockClient();
    mockManager.register({
      matcher: () => true,
      response: { text: "Hello" },
    });

    const subagent = new AgentBuilder(mockClient)
      .withModel("mock:test")
      .withHooks({
        observers: {
          onLLMCallStart: () => {
            existingHookCalls.push("onLLMCallStart");
          },
          onGadgetExecutionStart: () => {
            existingHookCalls.push("onGadgetExecutionStart");
          },
          onLLMCallComplete: () => {
            existingHookCalls.push("onLLMCallComplete");
          },
        },
      })
      .withParentContext(ctx)
      .ask("test");

    for await (const _event of subagent.run()) {
      // Consume events
    }

    // Both existing hooks and event forwarding should work
    expect(existingHookCalls).toContain("onLLMCallStart");
    expect(existingHookCalls).toContain("onLLMCallComplete");

    expect(eventForwardCalls.length).toBeGreaterThan(0);
    expect(eventForwardCalls.some((e) => e.type === "llm_call_start")).toBe(true);
  });
});

// Note: Integration tests for subagent gadgets are covered by tree-sharing.test.ts
// which tests the full flow of gadgets spawning subagents with withParentContext

describe("edge cases", () => {
  let mockManager: ReturnType<typeof getMockManager>;

  beforeEach(() => {
    mockManager = getMockManager();
  });

  afterEach(() => {
    mockManager.clear();
  });

  it("should handle withParentContext called without tree", async () => {
    const events: SubagentEvent[] = [];

    // Context without tree
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      invocationId: "test-invocation",
      onSubagentEvent: (event) => events.push(event),
      hostExports: mockHostExports,
    };

    const mockClient = createMockClient();
    mockManager.register({
      matcher: () => true,
      response: { text: "Hello" },
    });

    const subagent = new AgentBuilder(mockClient)
      .withModel("mock:test")
      .withParentContext(ctx)
      .ask("test");

    for await (const _event of subagent.run()) {
      // Consume events
    }

    // Events should still be forwarded even without tree
    expect(events.length).toBeGreaterThan(0);
  });

  it("should handle withParentContext called without invocationId", async () => {
    const tree = new ExecutionTree();
    const treeEvents: ExecutionEvent[] = [];

    tree.onAll((event) => {
      treeEvents.push(event);
    });

    // Context without invocationId (no event forwarding)
    const ctx: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      tree,
      nodeId: "test-node",
      depth: 1,
      hostExports: mockHostExports,
    };

    const mockClient = createMockClient();
    mockManager.register({
      matcher: () => true,
      response: { text: "Hello" },
    });

    const subagent = new AgentBuilder(mockClient)
      .withModel("mock:test")
      .withParentContext(ctx)
      .ask("test");

    for await (const _event of subagent.run()) {
      // Consume events
    }

    // Tree events should still be recorded
    expect(treeEvents.length).toBeGreaterThan(0);
  });

  it("should chain hooks when withParentContext is called multiple times", async () => {
    const events1: SubagentEvent[] = [];
    const events2: SubagentEvent[] = [];

    const ctx1: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      invocationId: "ctx1-invocation",
      onSubagentEvent: (event) => events1.push(event),
      hostExports: mockHostExports,
    };

    const ctx2: ExecutionContext = {
      reportCost: () => {},
      signal: new AbortController().signal,
      invocationId: "ctx2-invocation",
      onSubagentEvent: (event) => events2.push(event),
      hostExports: mockHostExports,
    };

    const mockClient = createMockClient();
    mockManager.register({
      matcher: () => true,
      response: { text: "Hello" },
    });

    // Call withParentContext twice - hooks are chained (both get called)
    const subagent = new AgentBuilder(mockClient)
      .withModel("mock:test")
      .withParentContext(ctx1)
      .withParentContext(ctx2)
      .ask("test");

    for await (const _event of subagent.run()) {
      // Consume events
    }

    // Second context should receive events with ctx2 invocation ID
    expect(events2.length).toBeGreaterThan(0);
    expect(events2[0].gadgetInvocationId).toBe("ctx2-invocation");

    // First context also receives events due to hook chaining
    // The hooks wrap each other, so both callbacks are invoked
    expect(events1.length).toBeGreaterThan(0);
    expect(events1[0].gadgetInvocationId).toBe("ctx1-invocation");
  });
});
