/**
 * Conversation fixture generators for testing.
 * Provides utilities for creating test conversation data.
 */

import type { LLMMessage } from "llmist";

/**
 * Create a conversation with a specified number of turns.
 * Each turn consists of a user message and an assistant response.
 *
 * @param turnCount - Number of conversation turns to generate
 * @param options - Configuration options
 * @returns Array of LLMMessages representing the conversation
 *
 * @example
 * ```typescript
 * const messages = createConversation(5);
 * // Creates 10 messages: 5 user + 5 assistant
 * ```
 */
export function createConversation(
  turnCount: number,
  options?: {
    /** Prefix for user messages (default: "User message") */
    userPrefix?: string;
    /** Prefix for assistant messages (default: "Assistant response") */
    assistantPrefix?: string;
    /** Base content length per message (default: 100 chars) */
    contentLength?: number;
  },
): LLMMessage[] {
  const messages: LLMMessage[] = [];
  const userPrefix = options?.userPrefix ?? "User message";
  const assistantPrefix = options?.assistantPrefix ?? "Assistant response";
  const contentLength = options?.contentLength ?? 100;

  for (let i = 0; i < turnCount; i++) {
    // Generate content to fill approximate length
    const padding = " ".repeat(Math.max(0, contentLength - 30));

    messages.push({
      role: "user",
      content: `${userPrefix} ${i + 1}: This is turn ${i + 1} of the conversation.${padding}`,
    });

    messages.push({
      role: "assistant",
      content: `${assistantPrefix} ${i + 1}: I acknowledge turn ${i + 1}.${padding}`,
    });
  }

  return messages;
}

/**
 * Create a conversation with gadget calls interspersed.
 * Simulates an agent conversation with tool usage.
 *
 * @param turnCount - Number of conversation turns
 * @param gadgetCallsPerTurn - Number of gadget calls per assistant turn
 * @returns Array of LLMMessages including gadget call/result pairs
 *
 * @example
 * ```typescript
 * const messages = createConversationWithGadgets(3, 2);
 * // Creates: user, assistant+gadget, gadget-result, assistant+gadget, gadget-result, assistant (per turn)
 * ```
 */
export function createConversationWithGadgets(
  turnCount: number,
  gadgetCallsPerTurn: number = 1,
  options?: {
    /** Gadget names to cycle through (default: ["search", "calculate", "read"]) */
    gadgetNames?: string[];
    /** Content length for messages */
    contentLength?: number;
  },
): LLMMessage[] {
  const messages: LLMMessage[] = [];
  const gadgetNames = options?.gadgetNames ?? ["search", "calculate", "read"];
  const contentLength = options?.contentLength ?? 50;
  let gadgetIndex = 0;

  for (let turn = 0; turn < turnCount; turn++) {
    // User message
    messages.push({
      role: "user",
      content: `User request ${turn + 1}${"x".repeat(contentLength)}`,
    });

    // Assistant with gadget calls
    for (let g = 0; g < gadgetCallsPerTurn; g++) {
      const gadgetName = gadgetNames[gadgetIndex % gadgetNames.length];
      gadgetIndex++;

      // Gadget call (assistant message)
      messages.push({
        role: "assistant",
        content: `!!!GADGET_START:${gadgetName}\n!!!ARG:query\ntest query ${turn}-${g}\n!!!GADGET_END`,
      });

      // Gadget result (user message)
      messages.push({
        role: "user",
        content: `Result: Gadget ${gadgetName} returned result for query ${turn}-${g}`,
      });
    }

    // Final assistant response for this turn
    messages.push({
      role: "assistant",
      content: `Final response for turn ${turn + 1}${"y".repeat(contentLength)}`,
    });
  }

  return messages;
}

/**
 * Estimate token count for a message array.
 * Uses a simple 4-characters-per-token heuristic.
 *
 * @param messages - Messages to estimate tokens for
 * @returns Estimated token count
 *
 * @example
 * ```typescript
 * const messages = createConversation(10);
 * const tokens = estimateTokens(messages);
 * // Returns approximate token count
 * ```
 */
export function estimateTokens(messages: LLMMessage[]): number {
  return Math.ceil(messages.reduce((sum, msg) => sum + (msg.content?.length ?? 0), 0) / 4);
}

/**
 * Create a single user message.
 */
export function createUserMessage(content: string): LLMMessage {
  return { role: "user", content };
}

/**
 * Create a single assistant message.
 */
export function createAssistantMessage(content: string): LLMMessage {
  return { role: "assistant", content };
}

/**
 * Create a system message.
 */
export function createSystemMessage(content: string): LLMMessage {
  return { role: "system", content };
}

/**
 * Create a minimal conversation for quick tests.
 * Returns a single turn: one user message and one assistant response.
 */
export function createMinimalConversation(): LLMMessage[] {
  return [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi there!" },
  ];
}

/**
 * Create a conversation that exceeds a target token count.
 * Useful for testing compaction triggers.
 *
 * @param targetTokens - Minimum token count to exceed
 * @param options - Configuration options
 * @returns Conversation with at least targetTokens tokens
 */
export function createLargeConversation(
  targetTokens: number,
  options?: {
    /** Average tokens per turn (default: 200) */
    tokensPerTurn?: number;
  },
): LLMMessage[] {
  const tokensPerTurn = options?.tokensPerTurn ?? 200;
  const turnsNeeded = Math.ceil(targetTokens / tokensPerTurn);

  // Each character is ~0.25 tokens, so multiply by 4 for chars
  const charsPerMessage = Math.floor((tokensPerTurn * 4) / 2); // Divide by 2 for user + assistant

  return createConversation(turnsNeeded, {
    contentLength: charsPerMessage,
  });
}
