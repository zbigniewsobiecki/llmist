/**
 * Hybrid Compaction Strategy
 *
 * Combines sliding window and summarization for the best of both worlds:
 * 1. Identifies which turns to compact vs keep (like sliding window)
 * 2. Summarizes the older turns (like summarization)
 * 3. Returns summary + recent turns intact
 *
 * Falls back to sliding window if there are too few turns to summarize.
 */

import type { LLMMessage } from "../../../core/messages.js";
import type { ResolvedCompactionConfig } from "../config.js";
import {
  type CompactionContext,
  type CompactionResult,
  type CompactionStrategy,
  groupIntoTurns,
} from "../strategy.js";
import { SlidingWindowStrategy } from "./sliding-window.js";
import { SummarizationStrategy } from "./summarization.js";

/**
 * Minimum turns needed to make summarization worthwhile.
 * Below this threshold, we fall back to sliding window.
 */
const MIN_TURNS_FOR_SUMMARIZATION = 3;

/**
 * Hybrid strategy - summarizes old turns + keeps recent turns.
 *
 * This is the recommended default strategy as it:
 * - Preserves important historical context via summarization
 * - Keeps recent conversation turns verbatim for continuity
 * - Falls back gracefully to sliding window when appropriate
 */
export class HybridStrategy implements CompactionStrategy {
  readonly name = "hybrid";

  private readonly slidingWindow = new SlidingWindowStrategy();
  private readonly summarization = new SummarizationStrategy();

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
        strategyName: this.name,
        metadata: {
          originalCount: messages.length,
          compactedCount: messages.length,
          tokensBefore: context.currentTokens,
          tokensAfter: context.currentTokens,
        },
      };
    }

    // Calculate how many turns would be summarized
    const turnsToSummarize = turns.length - preserveCount;

    // If there are too few turns to summarize, use sliding window instead
    if (turnsToSummarize < MIN_TURNS_FOR_SUMMARIZATION) {
      // Delegate to sliding window - propagate its strategyName for accurate reporting
      return this.slidingWindow.compact(messages, config, context);
    }

    // Use summarization for older turns - propagate its strategyName
    return this.summarization.compact(messages, config, context);
  }
}
