/**
 * Sliding Window Compaction Strategy
 *
 * A fast, no-LLM-call strategy that simply keeps the most recent N turns
 * and drops older ones. Best for:
 * - Long-running conversations where older context becomes irrelevant
 * - Scenarios requiring minimal latency
 * - As a fallback when summarization is too slow
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
 * Marker message inserted to indicate truncation.
 */
const TRUNCATION_MARKER_TEMPLATE = "[Previous conversation truncated. Removed {count} turn(s) to fit context window.]";

/**
 * Sliding window strategy - keeps recent turns, drops older ones.
 *
 * This strategy:
 * 1. Groups messages into logical turns (user + assistant pairs)
 * 2. Keeps the `preserveRecentTurns` most recent turns
 * 3. Inserts a truncation marker at the beginning
 * 4. Requires no LLM call - very fast
 */
export class SlidingWindowStrategy implements CompactionStrategy {
  readonly name = "sliding-window";

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

    // Keep only the most recent turns
    const turnsToKeep = turns.slice(-preserveCount);
    const turnsRemoved = turns.length - preserveCount;

    // Create truncation marker
    const truncationMarker: LLMMessage = {
      role: "user",
      content: TRUNCATION_MARKER_TEMPLATE.replace("{count}", turnsRemoved.toString()),
    };

    // Build compacted message list
    const compactedMessages: LLMMessage[] = [truncationMarker, ...flattenTurns(turnsToKeep)];

    // Estimate new token count
    const tokensAfter = Math.ceil(
      compactedMessages.reduce((sum, msg) => sum + (msg.content?.length ?? 0), 0) / 4,
    );

    return {
      messages: compactedMessages,
      metadata: {
        originalCount: messages.length,
        compactedCount: compactedMessages.length,
        tokensBefore: context.currentTokens,
        tokensAfter,
      },
    };
  }
}
