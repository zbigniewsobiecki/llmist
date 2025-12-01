/**
 * Summarization Compaction Strategy
 *
 * Uses an LLM to summarize older conversation messages into a concise summary.
 * Best for:
 * - Tasks where historical context matters
 * - Complex multi-step reasoning
 * - When accuracy is more important than speed
 */

import type { LLMMessage } from "../../../core/messages.js";
import type { ResolvedCompactionConfig } from "../config.js";
import {
  type CompactionContext,
  type CompactionResult,
  type CompactionStrategy,
  flattenTurns,
  groupIntoTurns,
} from "../strategy.js";

/**
 * Summarization strategy - uses LLM to compress conversation history.
 *
 * This strategy:
 * 1. Groups messages into logical turns
 * 2. Keeps recent turns intact
 * 3. Summarizes older turns using LLM
 * 4. Returns summary + recent turns
 */
export class SummarizationStrategy implements CompactionStrategy {
  readonly name = "summarization";

  async compact(
    messages: LLMMessage[],
    config: ResolvedCompactionConfig,
    context: CompactionContext,
  ): Promise<CompactionResult> {
    const turns = groupIntoTurns(messages);
    const preserveCount = Math.min(config.preserveRecentTurns, turns.length);

    // If we have fewer turns than the preserve count, nothing to compact
    if (turns.length <= preserveCount) {
      return {
        messages,
        metadata: {
          originalCount: messages.length,
          compactedCount: messages.length,
          tokensBefore: context.currentTokens,
          tokensAfter: context.currentTokens,
        },
      };
    }

    // Split into turns to summarize and turns to keep
    const turnsToSummarize = turns.slice(0, -preserveCount);
    const turnsToKeep = turns.slice(-preserveCount);

    // Build conversation text to summarize
    const conversationToSummarize = this.formatTurnsForSummary(flattenTurns(turnsToSummarize));

    // Generate summary using LLM
    const summary = await this.generateSummary(conversationToSummarize, config, context);

    // Create summary message
    const summaryMessage: LLMMessage = {
      role: "user",
      content: `[Previous conversation summary]\n${summary}\n[End of summary - conversation continues below]`,
    };

    // Build compacted message list
    const compactedMessages: LLMMessage[] = [summaryMessage, ...flattenTurns(turnsToKeep)];

    // Estimate new token count
    const tokensAfter = Math.ceil(
      compactedMessages.reduce((sum, msg) => sum + (msg.content?.length ?? 0), 0) / 4,
    );

    return {
      messages: compactedMessages,
      summary,
      metadata: {
        originalCount: messages.length,
        compactedCount: compactedMessages.length,
        tokensBefore: context.currentTokens,
        tokensAfter,
      },
    };
  }

  /**
   * Formats messages into a readable conversation format for summarization.
   */
  private formatTurnsForSummary(messages: LLMMessage[]): string {
    return messages
      .map((msg) => {
        const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
        return `${role}: ${msg.content}`;
      })
      .join("\n\n");
  }

  /**
   * Generates a summary using the configured LLM.
   */
  private async generateSummary(
    conversation: string,
    config: ResolvedCompactionConfig,
    context: CompactionContext,
  ): Promise<string> {
    const model = config.summarizationModel ?? context.model;
    const prompt = `${config.summarizationPrompt}\n\n${conversation}`;

    // Use the LLMist client's complete method for summarization
    const response = await context.client.complete(prompt, {
      model,
      temperature: 0.3, // Low temperature for factual summarization
    });

    return response.trim();
  }
}
