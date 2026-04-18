import { describe, expect, test, vi } from "vitest";
import type { BlockRenderer } from "./block-renderer.js";
import { EventRouter } from "./event-router.js";

function makeMockBlockRenderer(): BlockRenderer {
  return {
    addText: vi.fn(),
    addThinking: vi.fn(),
  } as unknown as BlockRenderer;
}

describe("EventRouter", () => {
  test("handleEvent with text event calls blockRenderer.addText()", () => {
    const blockRenderer = makeMockBlockRenderer();
    const router = new EventRouter(blockRenderer);

    router.handleEvent({ type: "text", content: "hello world" } as never);

    expect(blockRenderer.addText).toHaveBeenCalledOnce();
    expect(blockRenderer.addText).toHaveBeenCalledWith("hello world");
    expect(blockRenderer.addThinking).not.toHaveBeenCalled();
  });

  test("handleEvent with thinking event calls blockRenderer.addThinking()", () => {
    const blockRenderer = makeMockBlockRenderer();
    const router = new EventRouter(blockRenderer);

    router.handleEvent({
      type: "thinking",
      content: "reasoning...",
      thinkingType: "thinking",
    } as never);

    expect(blockRenderer.addThinking).toHaveBeenCalledOnce();
    expect(blockRenderer.addThinking).toHaveBeenCalledWith("reasoning...", "thinking");
    expect(blockRenderer.addText).not.toHaveBeenCalled();
  });

  test("handleEvent with other event types is a no-op", () => {
    const blockRenderer = makeMockBlockRenderer();
    const router = new EventRouter(blockRenderer);

    router.handleEvent({ type: "gadget_call" } as never);
    router.handleEvent({ type: "llm_call_start" } as never);
    router.handleEvent({ type: "unknown_type" } as never);

    expect(blockRenderer.addText).not.toHaveBeenCalled();
    expect(blockRenderer.addThinking).not.toHaveBeenCalled();
  });
});
