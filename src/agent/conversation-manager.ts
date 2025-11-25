/**
 * ConversationManager handles conversation state and message building.
 * Extracted from AgentLoop to follow Single Responsibility Principle.
 */

import { type LLMMessage, LLMMessageBuilder } from "../core/messages.js";
import type { ParameterFormat } from "../gadgets/parser.js";
import type { IConversationManager } from "./interfaces.js";

/**
 * Default implementation of IConversationManager.
 * Manages conversation history by building on top of base messages (system prompt, gadget instructions).
 */
export class ConversationManager implements IConversationManager {
  private readonly baseMessages: LLMMessage[];
  private readonly initialMessages: LLMMessage[];
  private readonly historyBuilder: LLMMessageBuilder;
  private readonly parameterFormat: ParameterFormat;

  constructor(
    baseMessages: LLMMessage[],
    initialMessages: LLMMessage[],
    parameterFormat: ParameterFormat = "json",
  ) {
    this.baseMessages = baseMessages;
    this.initialMessages = initialMessages;
    this.parameterFormat = parameterFormat;
    this.historyBuilder = new LLMMessageBuilder();
  }

  addUserMessage(content: string): void {
    this.historyBuilder.addUser(content);
  }

  addAssistantMessage(content: string): void {
    this.historyBuilder.addAssistant(content);
  }

  addGadgetCall(gadgetName: string, parameters: Record<string, unknown>, result: string): void {
    this.historyBuilder.addGadgetCall(gadgetName, parameters, result, this.parameterFormat);
  }

  getMessages(): LLMMessage[] {
    return [...this.baseMessages, ...this.initialMessages, ...this.historyBuilder.build()];
  }
}
