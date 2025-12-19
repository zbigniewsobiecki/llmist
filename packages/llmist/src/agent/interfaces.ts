/**
 * Core interfaces for the Agent architecture.
 * These interfaces define the contracts for the composable services that make up the agent system.
 */

import type { LLMMessage, MessageContent } from "../core/messages.js";
import type { GadgetMediaOutput } from "../gadgets/types.js";

/**
 * Manages the conversation history and message building.
 * This interface abstracts conversation state management from the orchestration logic.
 */
export interface IConversationManager {
  /**
   * Adds a user message to the conversation.
   * Supports multimodal content (text + images/audio).
   */
  addUserMessage(content: MessageContent): void;

  /**
   * Adds an assistant message to the conversation.
   */
  addAssistantMessage(content: string): void;

  /**
   * Adds a gadget call and its result to the conversation.
   * The invocationId is shown to the LLM so it can reference previous calls when building dependencies.
   * Optionally includes media outputs (images, audio, etc.) for multimodal results.
   */
  addGadgetCallResult(
    gadgetName: string,
    parameters: Record<string, unknown>,
    result: string,
    invocationId: string,
    media?: GadgetMediaOutput[],
    mediaIds?: string[],
  ): void;

  /**
   * Gets the complete conversation history including base messages (system prompts, gadget instructions).
   */
  getMessages(): LLMMessage[];

  /**
   * Gets only the conversation history messages (excludes base messages).
   * Used by compaction to determine what can be compressed.
   */
  getHistoryMessages(): LLMMessage[];

  /**
   * Gets the base messages (system prompts, gadget instructions).
   * These are never compacted and always included at the start.
   */
  getBaseMessages(): LLMMessage[];

  /**
   * Replaces the conversation history with new messages.
   * Used by compaction to update history after compression.
   * @param newHistory - The compacted history messages to replace with
   */
  replaceHistory(newHistory: LLMMessage[]): void;

  /**
   * Gets full conversation history including initial messages and runtime history.
   * Used for REPL session continuation - returns everything except base (system) messages.
   * This combines:
   * - initialMessages: History from previous sessions (set via withHistory())
   * - historyBuilder: Messages from the current session
   */
  getConversationHistory(): LLMMessage[];
}
