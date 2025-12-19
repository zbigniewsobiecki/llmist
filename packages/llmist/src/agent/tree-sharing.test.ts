/**
 * Integration test for tree sharing between parent agent and subagent gadgets.
 * This verifies that subagent events flow through the shared ExecutionTree.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ExecutionTree } from "../core/execution-tree.js";
import type { ExecutionEvent } from "../core/execution-events.js";
import { Gadget } from "../gadgets/typed-gadget.js";
import type { ExecutionContext } from "../gadgets/types.js";
import { createMockClient, getMockManager } from "../testing/index.js";
import { AgentBuilder } from "./builder.js";

// A simple subagent gadget that creates its own agent using withParentContext
class SubagentGadget extends Gadget({
  name: "SubagentGadget",
  description: "A gadget that runs a subagent internally",
  schema: z.object({
    task: z.string(),
  }),
}) {
  async execute(
    params: { task: string },
    ctx: ExecutionContext,
  ): Promise<string> {
    const mockClient = createMockClient();
    const mockManager = getMockManager();

    // Register a mock response for the subagent
    mockManager.register({
      matcher: () => true,
      response: { text: `Subagent completed: ${params.task}` },
    });

    // Create subagent with parent context - THIS IS THE KEY!
    const subagent = new AgentBuilder(mockClient)
      .withModel("mock:test")
      .withParentContext(ctx) // Should share the tree!
      .ask(params.task);

    let result = "";
    for await (const event of subagent.run()) {
      if (event.type === "text") {
        result += event.content;
      }
    }

    mockManager.clear();
    return result;
  }
}

describe("Tree Sharing Integration", () => {
  it("subagent events appear in parent tree when using withParentContext", async () => {
    const mockClient = createMockClient();
    const mockManager = getMockManager();

    // Track all events emitted by the tree
    const events: ExecutionEvent[] = [];

    // Register mock response that calls SubagentGadget
    // Use correct gadget invocation format: !!!GADGET_START:Name + !!!ARG:param + !!!GADGET_END
    mockManager.register({
      matcher: () => true,
      response: {
        text: "!!!GADGET_START:SubagentGadget\n!!!ARG:task\ndo something\n!!!GADGET_END",
      },
    });

    const agent = new AgentBuilder(mockClient)
      .withModel("mock:test")
      .withGadgets(SubagentGadget)
      .withMaxIterations(2)
      .ask("Run subagent");

    // Subscribe to tree events
    const tree = agent.getTree();
    tree.onAll((event) => {
      events.push(event);
    });

    // Run the agent
    for await (const _event of agent.run()) {
      // Consume events
    }

    mockManager.clear();

    // Verify we got events from BOTH the parent and the subagent
    const llmCallStarts = events.filter((e) => e.type === "llm_call_start");
    const gadgetCalls = events.filter((e) => e.type === "gadget_call");

    // Should have at least 2 LLM calls: parent + subagent
    expect(llmCallStarts.length).toBeGreaterThanOrEqual(2);

    // Should have at least 1 gadget call (SubagentGadget)
    expect(gadgetCalls.length).toBeGreaterThanOrEqual(1);

    // Find the subagent's LLM call (depth > 0)
    const subagentLLMCalls = llmCallStarts.filter((e) => e.depth > 0);
    expect(subagentLLMCalls.length).toBeGreaterThanOrEqual(1);

    console.log("Events captured:", {
      total: events.length,
      llmCallStarts: llmCallStarts.length,
      gadgetCalls: gadgetCalls.length,
      subagentLLMCalls: subagentLLMCalls.length,
    });
  });

  it("subagent creates separate tree when NOT using withParentContext", async () => {
    const mockClient = createMockClient();
    const mockManager = getMockManager();

    // Track events from parent tree only
    const parentEvents: ExecutionEvent[] = [];

    // A gadget that does NOT use withParentContext
    class IsolatedSubagentGadget extends Gadget({
      name: "IsolatedSubagentGadget",
      description: "A gadget that runs subagent WITHOUT parent context",
      schema: z.object({ task: z.string() }),
    }) {
      async execute(params: { task: string }): Promise<string> {
        const subMockClient = createMockClient();
        const subMockManager = getMockManager();

        subMockManager.register({
          matcher: () => true,
          response: { text: `Isolated: ${params.task}` },
        });

        // NO withParentContext - subagent has its own tree!
        const subagent = new AgentBuilder(subMockClient)
          .withModel("mock:test")
          .ask(params.task);

        let result = "";
        for await (const event of subagent.run()) {
          if (event.type === "text") {
            result += event.content;
          }
        }

        subMockManager.clear();
        return result;
      }
    }

    mockManager.register({
      matcher: () => true,
      response: {
        text: "!!!GADGET_START:IsolatedSubagentGadget\n!!!ARG:task\nisolated task\n!!!GADGET_END",
      },
    });

    const agent = new AgentBuilder(mockClient)
      .withModel("mock:test")
      .withGadgets(IsolatedSubagentGadget)
      .withMaxIterations(2)
      .ask("Run isolated subagent");

    // Subscribe to parent tree events
    const tree = agent.getTree();
    tree.onAll((event) => {
      parentEvents.push(event);
    });

    for await (const _event of agent.run()) {
      // Consume events
    }

    mockManager.clear();

    // Only parent events should be captured (no subagent LLM calls at depth > 0)
    const subagentLLMCalls = parentEvents.filter(
      (e) => e.type === "llm_call_start" && e.depth > 0,
    );

    // Should have NO subagent LLM calls in parent tree (they're in separate tree)
    expect(subagentLLMCalls.length).toBe(0);

    console.log("Parent-only events:", {
      total: parentEvents.length,
      subagentLLMCalls: subagentLLMCalls.length,
    });
  });
});
