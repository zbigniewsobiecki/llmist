/**
 * Mock ConversationManager for testing compaction and agent components.
 * Implements IConversationManager interface with test-friendly features.
 */

import type { LLMMessage } from "../core/messages.js";
import type { IConversationManager } from "../agent/interfaces.js";

/**
 * A mock implementation of IConversationManager for testing.
 * Tracks all operations and allows inspection of state changes.
 *
 * @example
 * ```typescript
 * const mockConvo = new MockConversationManager([
 *   { role: "user", content: "Hello" },
 *   { role: "assistant", content: "Hi!" }
 * ]);
 *
 * // Use in compaction tests
 * compactionManager.checkAndCompact(mockConvo, 1);
 *
 * // Assert on state changes
 * expect(mockConvo.wasReplaceHistoryCalled()).toBe(true);
 * expect(mockConvo.getReplacementHistory()).toHaveLength(2);
 * ```
 */
export class MockConversationManager implements IConversationManager {
  private history: LLMMessage[];
  private readonly baseMessages: LLMMessage[];
  private replacementHistory: LLMMessage[] | undefined;
  private replaceHistoryCallCount = 0;
  private addedMessages: LLMMessage[] = [];

  constructor(
    history: LLMMessage[] = [],
    baseMessages: LLMMessage[] = [],
  ) {
    this.history = [...history];
    this.baseMessages = [...baseMessages];
  }

  addUserMessage(content: string): void {
    const msg: LLMMessage = { role: "user", content };
    this.history.push(msg);
    this.addedMessages.push(msg);
  }

  addAssistantMessage(content: string): void {
    const msg: LLMMessage = { role: "assistant", content };
    this.history.push(msg);
    this.addedMessages.push(msg);
  }

  addGadgetCall(gadgetName: string, parameters: Record<string, unknown>, result: string): void {
    // Simplified gadget call format for testing
    const assistantMsg: LLMMessage = {
      role: "assistant",
      content: `!!!GADGET_START:${gadgetName}\n${JSON.stringify(parameters)}\n!!!GADGET_END`,
    };
    const resultMsg: LLMMessage = {
      role: "user",
      content: `Result: ${result}`,
    };

    this.history.push(assistantMsg);
    this.history.push(resultMsg);
    this.addedMessages.push(assistantMsg);
    this.addedMessages.push(resultMsg);
  }

  getMessages(): LLMMessage[] {
    return [...this.baseMessages, ...this.history];
  }

  getHistoryMessages(): LLMMessage[] {
    return [...this.history];
  }

  getBaseMessages(): LLMMessage[] {
    return [...this.baseMessages];
  }

  replaceHistory(newHistory: LLMMessage[]): void {
    this.replacementHistory = [...newHistory];
    this.history = [...newHistory];
    this.replaceHistoryCallCount++;
  }

  // ============================================
  // Test Helper Methods
  // ============================================

  /**
   * Check if replaceHistory was called.
   */
  wasReplaceHistoryCalled(): boolean {
    return this.replaceHistoryCallCount > 0;
  }

  /**
   * Get the number of times replaceHistory was called.
   */
  getReplaceHistoryCallCount(): number {
    return this.replaceHistoryCallCount;
  }

  /**
   * Get the most recent history passed to replaceHistory.
   * Returns undefined if replaceHistory was never called.
   */
  getReplacementHistory(): LLMMessage[] | undefined {
    return this.replacementHistory;
  }

  /**
   * Get all messages that were added via add* methods.
   */
  getAddedMessages(): LLMMessage[] {
    return [...this.addedMessages];
  }

  /**
   * Reset all tracking state while preserving the conversation.
   */
  resetTracking(): void {
    this.replacementHistory = undefined;
    this.replaceHistoryCallCount = 0;
    this.addedMessages = [];
  }

  /**
   * Completely reset the mock to initial state.
   * Note: baseMessages cannot be changed after construction.
   */
  reset(history: LLMMessage[] = []): void {
    this.history = [...history];
    this.resetTracking();
  }

  /**
   * Set the history directly (for test setup).
   */
  setHistory(messages: LLMMessage[]): void {
    this.history = [...messages];
  }

  /**
   * Get the current history length.
   */
  getHistoryLength(): number {
    return this.history.length;
  }

  /**
   * Get total message count (base + history).
   */
  getTotalMessageCount(): number {
    return this.baseMessages.length + this.history.length;
  }
}

/**
 * Create a mock conversation manager with a pre-populated conversation.
 *
 * @param turnCount - Number of conversation turns
 * @param baseMessages - Optional base messages (system prompts)
 * @returns Configured MockConversationManager
 */
export function createMockConversationManager(
  turnCount: number,
  baseMessages: LLMMessage[] = [],
): MockConversationManager {
  const history: LLMMessage[] = [];

  for (let i = 0; i < turnCount; i++) {
    history.push({
      role: "user",
      content: `User message ${i + 1}: This is turn ${i + 1} of the conversation.`,
    });
    history.push({
      role: "assistant",
      content: `Assistant response ${i + 1}: I acknowledge turn ${i + 1}.`,
    });
  }

  return new MockConversationManager(history, baseMessages);
}
