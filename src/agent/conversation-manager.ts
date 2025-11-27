/**
 * ConversationManager handles conversation state and message building.
 * Extracted from AgentLoop to follow Single Responsibility Principle.
 */

import { type LLMMessage, LLMMessageBuilder } from "../core/messages.js";
import type { ParameterFormat } from "../gadgets/parser.js";
import type { IConversationManager } from "./interfaces.js";

/**
 * Options for ConversationManager constructor.
 */
export interface ConversationManagerOptions {
  parameterFormat?: ParameterFormat;
  /** Custom gadget start marker prefix */
  startPrefix?: string;
  /** Custom gadget end marker prefix */
  endPrefix?: string;
}

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
    options: ConversationManagerOptions = {},
  ) {
    this.baseMessages = baseMessages;
    this.initialMessages = initialMessages;
    this.parameterFormat = options.parameterFormat ?? "json";
    this.historyBuilder = new LLMMessageBuilder();

    // Apply custom prefixes if provided (must match system prompt markers)
    if (options.startPrefix && options.endPrefix) {
      this.historyBuilder.withPrefixes(options.startPrefix, options.endPrefix);
    }
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
