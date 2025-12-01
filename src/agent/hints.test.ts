import { describe, expect, it } from "bun:test";
import { createLogger } from "../logging/logger.js";
import {
  createHints,
  iterationProgressHint,
  parallelGadgetHint,
  type HintsConfig,
  type IterationHintOptions,
  type ParallelGadgetHintOptions,
} from "./hints.js";
import { HookPresets } from "./hook-presets.js";
import type { LLMMessage } from "../core/messages.js";
import type {
  AfterLLMCallControllerContext,
  LLMCallControllerContext,
} from "./hooks.js";

const logger = createLogger({ name: "test", minLevel: 6 }); // Silent

// Helper to create a beforeLLMCall context
function createBeforeLLMCallContext(
  iteration: number,
  maxIterations: number,
  messages: LLMMessage[] = [],
): LLMCallControllerContext {
  return {
    iteration,
    maxIterations,
    options: {
      model: "test-model",
      messages,
    },
    logger,
  };
}

// Helper to create an afterLLMCall context
function createAfterLLMCallContext(
  iteration: number,
  maxIterations: number,
  gadgetCallCount: number,
): AfterLLMCallControllerContext {
  return {
    iteration,
    maxIterations,
    options: {
      model: "test-model",
      messages: [],
    },
    finishReason: "stop",
    finalMessage: "test message",
    gadgetCallCount,
    logger,
  };
}

describe("iterationProgressHint", () => {
  describe("timing options", () => {
    it("shows hint on every iteration with timing='always' (default)", async () => {
      const hooks = iterationProgressHint();
      const controller = hooks.controllers?.beforeLLMCall;
      expect(controller).toBeDefined();

      // Early iteration (iteration 0 = 10%)
      const ctx = createBeforeLLMCallContext(0, 10, [
        { role: "user", content: "Hello" },
      ]);
      const action = await controller!(ctx);

      expect(action.action).toBe("proceed");
      expect(action).toHaveProperty("modifiedOptions");
      const messages = (action as { modifiedOptions: { messages: LLMMessage[] } })
        .modifiedOptions.messages;
      expect(messages.some((m) => m.content.includes("[System Hint]"))).toBe(true);
      expect(messages.some((m) => m.content.includes("Iteration 1/10"))).toBe(true);
    });

    it("only shows hint when >= 50% through iterations with timing='late'", async () => {
      const hooks = iterationProgressHint({ timing: "late" });
      const controller = hooks.controllers?.beforeLLMCall;

      // Early (40%) - should NOT show
      const earlyCtx = createBeforeLLMCallContext(3, 10, [
        { role: "user", content: "Hello" },
      ]);
      const earlyAction = await controller!(earlyCtx);
      expect(earlyAction.action).toBe("proceed");
      expect(earlyAction).not.toHaveProperty("modifiedOptions");

      // Late (60%) - should show
      const lateCtx = createBeforeLLMCallContext(5, 10, [
        { role: "user", content: "Hello" },
      ]);
      const lateAction = await controller!(lateCtx);
      expect(lateAction.action).toBe("proceed");
      expect(lateAction).toHaveProperty("modifiedOptions");
    });

    it("only shows hint when >= 80% through iterations with timing='urgent'", async () => {
      const hooks = iterationProgressHint({ timing: "urgent" });
      const controller = hooks.controllers?.beforeLLMCall;

      // Early (70%) - should NOT show
      const earlyCtx = createBeforeLLMCallContext(6, 10, [
        { role: "user", content: "Hello" },
      ]);
      const earlyAction = await controller!(earlyCtx);
      expect(earlyAction).not.toHaveProperty("modifiedOptions");

      // Late (90%) - should show
      const lateCtx = createBeforeLLMCallContext(8, 10, [
        { role: "user", content: "Hello" },
      ]);
      const lateAction = await controller!(lateCtx);
      expect(lateAction).toHaveProperty("modifiedOptions");
    });
  });

  describe("urgency indicator", () => {
    it("adds urgency text when >= 80% through iterations by default", async () => {
      const hooks = iterationProgressHint();
      const controller = hooks.controllers?.beforeLLMCall;

      const ctx = createBeforeLLMCallContext(8, 10, [
        { role: "user", content: "Hello" },
      ]);
      const action = await controller!(ctx);

      const messages = (action as { modifiedOptions: { messages: LLMMessage[] } })
        .modifiedOptions.messages;
      expect(
        messages.some((m) => m.content.includes("Running low on iterations")),
      ).toBe(true);
    });

    it("does not add urgency when showUrgency=false", async () => {
      const hooks = iterationProgressHint({ showUrgency: false });
      const controller = hooks.controllers?.beforeLLMCall;

      const ctx = createBeforeLLMCallContext(8, 10, [
        { role: "user", content: "Hello" },
      ]);
      const action = await controller!(ctx);

      const messages = (action as { modifiedOptions: { messages: LLMMessage[] } })
        .modifiedOptions.messages;
      expect(
        messages.some((m) => m.content.includes("Running low on iterations")),
      ).toBe(false);
    });
  });

  describe("custom templates", () => {
    it("supports custom string template with placeholders", async () => {
      const hooks = iterationProgressHint({
        template: "Turn {iteration} of {maxIterations}. {remaining} left.",
      });
      const controller = hooks.controllers?.beforeLLMCall;

      const ctx = createBeforeLLMCallContext(2, 10, [
        { role: "user", content: "Hello" },
      ]);
      const action = await controller!(ctx);

      const messages = (action as { modifiedOptions: { messages: LLMMessage[] } })
        .modifiedOptions.messages;
      expect(messages.some((m) => m.content.includes("Turn 3 of 10. 7 left."))).toBe(
        true,
      );
    });

    it("supports custom function template", async () => {
      const hooks = iterationProgressHint({
        template: (ctx) => `Step ${ctx.iteration}/${ctx.maxIterations}`,
      });
      const controller = hooks.controllers?.beforeLLMCall;

      const ctx = createBeforeLLMCallContext(4, 10, [
        { role: "user", content: "Hello" },
      ]);
      const action = await controller!(ctx);

      const messages = (action as { modifiedOptions: { messages: LLMMessage[] } })
        .modifiedOptions.messages;
      expect(messages.some((m) => m.content.includes("Step 5/10"))).toBe(true);
    });

    it("provides ctx.remaining in function templates", async () => {
      const hooks = iterationProgressHint({
        template: (ctx) => `${ctx.remaining} iterations left out of ${ctx.maxIterations}`,
      });
      const controller = hooks.controllers?.beforeLLMCall;

      // iteration 2 (0-indexed), maxIterations 10 → remaining = 10 - 3 = 7
      const ctx = createBeforeLLMCallContext(2, 10, [
        { role: "user", content: "Hello" },
      ]);
      const action = await controller!(ctx);

      const messages = (action as { modifiedOptions: { messages: LLMMessage[] } })
        .modifiedOptions.messages;
      expect(messages.some((m) => m.content.includes("7 iterations left out of 10"))).toBe(
        true,
      );
    });
  });

  it("inserts hint after the last user message", async () => {
    const hooks = iterationProgressHint();
    const controller = hooks.controllers?.beforeLLMCall;

    const ctx = createBeforeLLMCallContext(0, 10, [
      { role: "system", content: "System prompt" },
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Second question" },
    ]);
    const action = await controller!(ctx);

    const messages = (action as { modifiedOptions: { messages: LLMMessage[] } })
      .modifiedOptions.messages;

    // Find hint message index
    const hintIndex = messages.findIndex((m) => m.content.includes("[System Hint]"));

    // Find last user message index (compatible with older ES targets)
    let lastUserIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user" && !messages[i].content.includes("[System Hint]")) {
        lastUserIndex = i;
        break;
      }
    }

    // Hint should be right after last user message
    expect(hintIndex).toBe(lastUserIndex + 1);
  });

  it("appends hint at end when no user messages exist", async () => {
    const hooks = iterationProgressHint();
    const controller = hooks.controllers?.beforeLLMCall;

    // Messages with no user role
    const ctx = createBeforeLLMCallContext(0, 10, [
      { role: "system", content: "System prompt" },
      { role: "assistant", content: "Previous response" },
    ]);
    const action = await controller!(ctx);

    expect(action.action).toBe("proceed");
    expect(action).toHaveProperty("modifiedOptions");

    const messages = (action as { modifiedOptions: { messages: LLMMessage[] } })
      .modifiedOptions.messages;

    // Hint should be appended at the end
    expect(messages.length).toBe(3);
    expect(messages[2].content).toContain("[System Hint]");
    expect(messages[2].content).toContain("Iteration 1/10");
  });
});

describe("parallelGadgetHint", () => {
  it("appends hint when only one gadget was called", async () => {
    const hooks = parallelGadgetHint();
    const controller = hooks.controllers?.afterLLMCall;
    expect(controller).toBeDefined();

    const ctx = createAfterLLMCallContext(0, 10, 1);
    const action = await controller!(ctx);

    expect(action.action).toBe("append_messages");
    expect(action).toHaveProperty("messages");
    const messages = (action as { messages: LLMMessage[] }).messages;
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toContain("multiple gadgets");
  });

  it("does not append hint when multiple gadgets were called", async () => {
    const hooks = parallelGadgetHint();
    const controller = hooks.controllers?.afterLLMCall;

    const ctx = createAfterLLMCallContext(0, 10, 2);
    const action = await controller!(ctx);

    expect(action.action).toBe("continue");
  });

  it("does not append hint when no gadgets were called", async () => {
    const hooks = parallelGadgetHint();
    const controller = hooks.controllers?.afterLLMCall;

    const ctx = createAfterLLMCallContext(0, 10, 0);
    const action = await controller!(ctx);

    expect(action.action).toBe("continue");
  });

  it("respects custom minGadgetsForEfficiency threshold", async () => {
    const hooks = parallelGadgetHint({ minGadgetsForEfficiency: 3 });
    const controller = hooks.controllers?.afterLLMCall;

    // 2 gadgets - should hint (below threshold of 3)
    const ctx2 = createAfterLLMCallContext(0, 10, 2);
    const action2 = await controller!(ctx2);
    expect(action2.action).toBe("append_messages");

    // 3 gadgets - should not hint (at threshold)
    const ctx3 = createAfterLLMCallContext(0, 10, 3);
    const action3 = await controller!(ctx3);
    expect(action3.action).toBe("continue");
  });

  it("uses custom message when provided", async () => {
    const customMessage = "Try calling more gadgets!";
    const hooks = parallelGadgetHint({ message: customMessage });
    const controller = hooks.controllers?.afterLLMCall;

    const ctx = createAfterLLMCallContext(0, 10, 1);
    const action = await controller!(ctx);

    const messages = (action as { messages: LLMMessage[] }).messages;
    expect(messages[0].content).toContain(customMessage);
  });

  it("does nothing when enabled=false", async () => {
    const hooks = parallelGadgetHint({ enabled: false });
    const controller = hooks.controllers?.afterLLMCall;

    const ctx = createAfterLLMCallContext(0, 10, 1);
    const action = await controller!(ctx);

    expect(action.action).toBe("continue");
  });
});

describe("createHints", () => {
  it("creates empty hooks structure when no hints enabled", () => {
    const hooks = createHints({});
    // HookPresets.merge returns a structure with empty categories
    expect(hooks.controllers?.beforeLLMCall).toBeUndefined();
    expect(hooks.controllers?.afterLLMCall).toBeUndefined();
  });

  it("creates iteration progress hint when enabled with true", () => {
    const hooks = createHints({ iterationProgress: true });
    expect(hooks.controllers?.beforeLLMCall).toBeDefined();
  });

  it("creates iteration progress hint with options", () => {
    const hooks = createHints({
      iterationProgress: { timing: "late", showUrgency: false },
    });
    expect(hooks.controllers?.beforeLLMCall).toBeDefined();
  });

  it("creates parallel gadgets hint when enabled with true", () => {
    const hooks = createHints({ parallelGadgets: true });
    expect(hooks.controllers?.afterLLMCall).toBeDefined();
  });

  it("creates parallel gadgets hint with options", () => {
    const hooks = createHints({
      parallelGadgets: { minGadgetsForEfficiency: 3 },
    });
    expect(hooks.controllers?.afterLLMCall).toBeDefined();
  });

  it("merges both hints together", () => {
    const hooks = createHints({
      iterationProgress: true,
      parallelGadgets: true,
    });
    expect(hooks.controllers?.beforeLLMCall).toBeDefined();
    expect(hooks.controllers?.afterLLMCall).toBeDefined();
  });

  it("includes custom hooks in merge", () => {
    const customHooks = {
      observers: {
        onLLMCallStart: async () => {
          /* custom observer */
        },
      },
    };
    const hooks = createHints({
      iterationProgress: true,
      custom: [customHooks],
    });
    expect(hooks.controllers?.beforeLLMCall).toBeDefined();
    expect(hooks.observers?.onLLMCallStart).toBeDefined();
  });
});

describe("integration with HookPresets.merge", () => {
  it("can be merged with other hooks", () => {
    const customHooks = {
      observers: {
        onLLMCallComplete: async () => {
          /* custom */
        },
      },
    };

    const hints = createHints({
      iterationProgress: true,
      parallelGadgets: true,
    });

    const merged = HookPresets.merge(customHooks, hints);

    expect(merged.observers?.onLLMCallComplete).toBeDefined();
    expect(merged.controllers?.beforeLLMCall).toBeDefined();
    expect(merged.controllers?.afterLLMCall).toBeDefined();
  });

  it("individual hints can be merged", () => {
    const merged = HookPresets.merge(
      iterationProgressHint({ timing: "late" }),
      parallelGadgetHint(),
    );

    expect(merged.controllers?.beforeLLMCall).toBeDefined();
    expect(merged.controllers?.afterLLMCall).toBeDefined();
  });
});
