/**
 * ConversationManager handles conversation state and message building.
 * Extracted from AgentLoop to follow Single Responsibility Principle.
 */

import type { MessageContent } from "../core/messages.js";
import { extractMessageText, type LLMMessage, LLMMessageBuilder } from "../core/messages.js";
import type { GadgetMediaOutput } from "../gadgets/types.js";
import type { IConversationManager } from "./interfaces.js";

/**
 * Options for ConversationManager constructor.
 */
export interface ConversationManagerOptions {
  /** Custom gadget start marker prefix */
  startPrefix?: string;
  /** Custom gadget end marker prefix */
  endPrefix?: string;
  /** Custom argument prefix for block format */
  argPrefix?: string;
}

/**
 * Default implementation of IConversationManager.
 * Manages conversation history by building on top of base messages (system prompt, gadget instructions).
 */
export class ConversationManager implements IConversationManager {
  private readonly baseMessages: LLMMessage[];
  private readonly initialMessages: LLMMessage[];
  private historyBuilder: LLMMessageBuilder;
  private readonly startPrefix?: string;
  private readonly endPrefix?: string;
  private readonly argPrefix?: string;

  constructor(
    baseMessages: LLMMessage[],
    initialMessages: LLMMessage[],
    options: ConversationManagerOptions = {},
  ) {
    this.baseMessages = baseMessages;
    this.initialMessages = initialMessages;
    this.historyBuilder = new LLMMessageBuilder();

    // Store prefixes for history replacement
    this.startPrefix = options.startPrefix;
    this.endPrefix = options.endPrefix;
    this.argPrefix = options.argPrefix;

    // Apply custom prefixes if provided (must match system prompt markers)
    if (options.startPrefix && options.endPrefix) {
      this.historyBuilder.withPrefixes(options.startPrefix, options.endPrefix, options.argPrefix);
    }
  }

  addUserMessage(content: MessageContent): void {
    this.historyBuilder.addUser(content);
  }

  addAssistantMessage(content: string): void {
    this.historyBuilder.addAssistant(content);
  }

  addGadgetCallResult(
    gadgetName: string,
    parameters: Record<string, unknown>,
    result: string,
    invocationId: string,
    media?: GadgetMediaOutput[],
    mediaIds?: string[],
  ): void {
    this.historyBuilder.addGadgetCallResult(gadgetName, parameters, result, invocationId, media, mediaIds);
  }

  getMessages(): LLMMessage[] {
    return [...this.baseMessages, ...this.initialMessages, ...this.historyBuilder.build()];
  }

  getHistoryMessages(): LLMMessage[] {
    return this.historyBuilder.build();
  }

  getBaseMessages(): LLMMessage[] {
    return [...this.baseMessages, ...this.initialMessages];
  }

  replaceHistory(newHistory: LLMMessage[]): void {
    // Create a new builder with the same prefixes
    this.historyBuilder = new LLMMessageBuilder();
    if (this.startPrefix && this.endPrefix) {
      this.historyBuilder.withPrefixes(this.startPrefix, this.endPrefix, this.argPrefix);
    }

    // Add each message from the new history
    for (const msg of newHistory) {
      if (msg.role === "user") {
        this.historyBuilder.addUser(msg.content);
      } else if (msg.role === "assistant") {
        // Assistant messages are always text, extract if multimodal
        this.historyBuilder.addAssistant(extractMessageText(msg.content));
      }
      // System messages are not added to history (they're in baseMessages)
    }
  }

  getConversationHistory(): LLMMessage[] {
    // Returns full conversation history: initial messages (from previous sessions via withHistory())
    // plus runtime history (from current session). Excludes base messages (system prompt, gadget instructions).
    return [...this.initialMessages, ...this.historyBuilder.build()];
  }
}
