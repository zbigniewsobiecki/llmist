/**
 * ConversationUpdater: Encapsulates conversation history updates after LLM responses.
 *
 * Extracted from Agent to isolate conversation history logic — handling text-only
 * vs text-with-gadgets responses, synthetic invocation wrapping, result formatting,
 * and conversation manager calls.
 *
 * @module agent/conversation-updater
 */

import type { ILogObj, Logger } from "tslog";
import type { StreamEvent, TextOnlyHandler } from "../gadgets/types.js";
import type { ConversationManager } from "./conversation-manager.js";

/**
 * Configuration for wrapping text that accompanies gadget calls as a synthetic gadget call.
 */
export interface TextWithGadgetsHandlerConfig {
  /** Name of the gadget to use for wrapping text */
  gadgetName: string;
  /** Maps text content to gadget parameters */
  parameterMapping: (text: string) => Record<string, unknown>;
  /** Maps text content to the result string (optional, defaults to text) */
  resultMapping?: (text: string) => string;
}

/**
 * ConversationUpdater handles updating conversation history after each LLM response.
 *
 * Owns:
 * - Text-only response handling (`textOnlyHandler`)
 * - Text-alongside-gadgets wrapping (`textWithGadgetsHandler`)
 * - Synthetic invocation ID generation (`syntheticInvocationCounter`)
 */
export class ConversationUpdater {
  private readonly conversation: ConversationManager;
  private readonly textOnlyHandler: TextOnlyHandler;
  private readonly textWithGadgetsHandler?: TextWithGadgetsHandlerConfig;
  private readonly logger: Logger<ILogObj>;
  private syntheticInvocationCounter = 0;

  constructor(
    conversation: ConversationManager,
    textOnlyHandler: TextOnlyHandler,
    textWithGadgetsHandler: TextWithGadgetsHandlerConfig | undefined,
    logger: Logger<ILogObj>,
  ) {
    this.conversation = conversation;
    this.textOnlyHandler = textOnlyHandler;
    this.textWithGadgetsHandler = textWithGadgetsHandler;
    this.logger = logger;
  }

  /**
   * Generate a unique synthetic invocation ID for wrapped text content.
   * Used when `textWithGadgetsHandler` is set and text accompanies gadget calls.
   *
   * @returns A unique synthetic invocation ID string
   */
  createSyntheticInvocation(): string {
    return `gc_text_${++this.syntheticInvocationCounter}`;
  }

  /**
   * Process a text-only LLM response (no gadgets were called).
   *
   * Determines whether the agent loop should continue or terminate based
   * on the configured handler.
   *
   * @param _textOutputs - Array of text chunks from the LLM response (reserved for future use)
   * @returns 'terminate' if the agent loop should stop, 'continue' if it should keep going
   */
  handleTextOnly(_textOutputs: string[]): "continue" | "terminate" {
    const handler = this.textOnlyHandler;

    if (typeof handler === "string") {
      switch (handler) {
        case "terminate":
          this.logger.info("No gadgets called, ending loop");
          return "terminate";
        case "acknowledge":
          this.logger.info("No gadgets called, continuing loop");
          return "continue";
        case "wait_for_input":
          this.logger.info("No gadgets called, waiting for input");
          return "terminate";
        default:
          this.logger.warn(`Unknown text-only strategy: ${handler}, defaulting to terminate`);
          return "terminate";
      }
    }

    // For gadget and custom handlers, they would need to be implemented
    // This is simplified for now
    return "terminate";
  }

  /**
   * Update conversation history with LLM response results.
   *
   * When gadgets were executed:
   * - Optionally wraps accompanying text as a synthetic gadget call (if textWithGadgetsHandler is set)
   * - Adds all gadget results to conversation
   *
   * When no gadgets were executed (text-only response):
   * - Adds the final message as an assistant message to conversation
   * - Delegates to handleTextOnly() for continuation decision
   *
   * @param textOutputs - Array of text chunks from the LLM response (used for text wrapping with gadgets)
   * @param gadgetResults - Array of gadget_result stream events from this response
   * @param finalMessage - The final assistant message (possibly modified by afterLLMCall controller)
   * @returns true if the agent loop should break (text-only handler requested termination)
   */
  updateWithResults(
    textOutputs: string[],
    gadgetResults: StreamEvent[],
    finalMessage: string,
  ): boolean {
    const didExecuteGadgets = gadgetResults.some((e) => e.type === "gadget_result");

    if (didExecuteGadgets) {
      // If configured, wrap accompanying text as a synthetic gadget call
      if (this.textWithGadgetsHandler) {
        const textContent = textOutputs.join("");

        if (textContent.trim()) {
          const { gadgetName, parameterMapping, resultMapping } = this.textWithGadgetsHandler;
          const syntheticId = this.createSyntheticInvocation();
          this.conversation.addGadgetCallResult(
            gadgetName,
            parameterMapping(textContent),
            resultMapping ? resultMapping(textContent) : textContent,
            syntheticId,
          );
        }
      }

      // Add all gadget results to conversation
      for (const output of gadgetResults) {
        if (output.type === "gadget_result") {
          const gadgetResult = output.result;
          this.conversation.addGadgetCallResult(
            gadgetResult.gadgetName,
            gadgetResult.parameters,
            gadgetResult.error ?? gadgetResult.result ?? "",
            gadgetResult.invocationId,
            gadgetResult.media,
            gadgetResult.mediaIds,
            gadgetResult.storedMedia,
          );
        }
      }

      return false; // Don't break loop
    }

    // No gadgets executed — add final message as assistant message
    if (finalMessage.trim()) {
      this.conversation.addAssistantMessage(finalMessage);
    }

    // Handle text-only responses
    return this.handleTextOnly(textOutputs) === "terminate";
  }
}
