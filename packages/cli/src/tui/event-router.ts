import type { StreamEvent } from "llmist";
import type { BlockRenderer } from "./block-renderer.js";

/**
 * Handles routing of StreamEvents to UI components.
 * Separates event parsing and distribution from TUIApp.
 */
export class EventRouter {
  constructor(private blockRenderer: BlockRenderer) {}

  /**
   * Route an agent stream event to the appropriate renderer method.
   *
   * Only handles text/thinking events - gadgets and LLM calls are managed
   * via ExecutionTree subscription in TreeSubscriptionManager.
   */
  handleEvent(event: StreamEvent): void {
    if (event.type === "text") {
      // Text is append-only content not tracked by the tree
      this.blockRenderer.addText(event.content);
    } else if (event.type === "thinking") {
      // Thinking is append-only content from reasoning models
      this.blockRenderer.addThinking(event.content, event.thinkingType);
    }
  }
}
