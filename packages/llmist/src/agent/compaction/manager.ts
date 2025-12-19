/**
 * CompactionManager - Central orchestrator for context compaction.
 *
 * Monitors token usage and coordinates compaction strategies to keep
 * conversation context within model limits.
 */

import type { LLMist } from "../../core/client.js";
import type { LLMMessage } from "../../core/messages.js";
import type { ModelLimits } from "../../core/model-catalog.js";
import type { IConversationManager } from "../interfaces.js";
import {
  type CompactionConfig,
  type CompactionEvent,
  type CompactionStats,
  type ResolvedCompactionConfig,
  resolveCompactionConfig,
} from "./config.js";
import {
  HybridStrategy,
  SlidingWindowStrategy,
  SummarizationStrategy,
} from "./strategies/index.js";
import type { CompactionStrategy } from "./strategy.js";

/**
 * Pre-computed token counts to avoid redundant counting.
 * Passed from checkAndCompact to compact for efficiency.
 */
interface PrecomputedTokens {
  historyMessages: LLMMessage[];
  baseMessages: LLMMessage[];
  historyTokens: number;
  baseTokens: number;
  currentTokens: number;
}

/**
 * Creates a strategy instance from a strategy name.
 */
function createStrategy(name: string): CompactionStrategy {
  switch (name) {
    case "sliding-window":
      return new SlidingWindowStrategy();
    case "summarization":
      return new SummarizationStrategy();
    case "hybrid":
      return new HybridStrategy();
    default:
      throw new Error(`Unknown compaction strategy: ${name}`);
  }
}

/**
 * CompactionManager orchestrates context compaction for an agent.
 *
 * It:
 * - Monitors token usage before each LLM call
 * - Triggers compaction when threshold is exceeded
 * - Coordinates with ConversationManager to update history
 * - Tracks statistics for observability
 */
export class CompactionManager {
  private readonly client: LLMist;
  private readonly model: string;
  private readonly config: ResolvedCompactionConfig;
  private readonly strategy: CompactionStrategy;
  private modelLimits?: ModelLimits;

  // Statistics
  private totalCompactions = 0;
  private totalTokensSaved = 0;
  private lastTokenCount = 0;

  constructor(client: LLMist, model: string, config: CompactionConfig = {}) {
    this.client = client;
    this.model = model;
    this.config = resolveCompactionConfig(config);

    // Create strategy instance (support both string name and custom instance)
    if (typeof config.strategy === "object" && "compact" in config.strategy) {
      this.strategy = config.strategy as CompactionStrategy;
    } else {
      this.strategy = createStrategy(this.config.strategy);
    }
  }

  /**
   * Check if compaction is needed and perform it if so.
   *
   * @param conversation - The conversation manager to compact
   * @param iteration - Current agent iteration (for event metadata)
   * @returns CompactionEvent if compaction was performed, null otherwise
   */
  async checkAndCompact(
    conversation: IConversationManager,
    iteration: number,
  ): Promise<CompactionEvent | null> {
    if (!this.config.enabled) {
      return null;
    }

    // Get model limits (cached after first call)
    if (!this.modelLimits) {
      this.modelLimits = this.client.modelRegistry.getModelLimits(this.model);
      if (!this.modelLimits) {
        // Model not found in registry, skip compaction silently
        // This is not an error - it just means we can't determine context limits
        return null;
      }
    }

    // Count current tokens (skip if client doesn't support token counting)
    if (!this.client.countTokens) {
      return null;
    }
    const messages = conversation.getMessages();
    const currentTokens = await this.client.countTokens(this.model, messages);
    this.lastTokenCount = currentTokens;

    // Calculate usage percentage
    const usagePercent = (currentTokens / this.modelLimits.contextWindow) * 100;

    // Check if we need to compact
    if (usagePercent < this.config.triggerThresholdPercent) {
      return null;
    }

    // Perform compaction with precomputed token counts to avoid redundant counting
    const historyMessages = conversation.getHistoryMessages();
    const baseMessages = conversation.getBaseMessages();
    const historyTokens = await this.client.countTokens(this.model, historyMessages);
    const baseTokens = await this.client.countTokens(this.model, baseMessages);

    return this.compact(conversation, iteration, {
      historyMessages,
      baseMessages,
      historyTokens,
      baseTokens,
      currentTokens: historyTokens + baseTokens,
    });
  }

  /**
   * Force compaction regardless of threshold.
   *
   * @param conversation - The conversation manager to compact
   * @param iteration - Current agent iteration (for event metadata). Use -1 for manual compaction.
   * @param precomputed - Optional pre-computed token counts (passed from checkAndCompact for efficiency)
   * @returns CompactionEvent with compaction details
   */
  async compact(
    conversation: IConversationManager,
    iteration: number,
    precomputed?: PrecomputedTokens,
  ): Promise<CompactionEvent | null> {
    if (!this.modelLimits) {
      this.modelLimits = this.client.modelRegistry.getModelLimits(this.model);
      if (!this.modelLimits) {
        return null;
      }
    }

    // Use precomputed values if available, otherwise compute them
    const historyMessages = precomputed?.historyMessages ?? conversation.getHistoryMessages();
    const baseMessages = precomputed?.baseMessages ?? conversation.getBaseMessages();
    const historyTokens =
      precomputed?.historyTokens ?? (await this.client.countTokens(this.model, historyMessages));
    const baseTokens =
      precomputed?.baseTokens ?? (await this.client.countTokens(this.model, baseMessages));
    const currentTokens = precomputed?.currentTokens ?? historyTokens + baseTokens;

    // Calculate target tokens for history (leaving room for base messages and output)
    const targetTotalTokens = Math.floor(
      (this.modelLimits.contextWindow * this.config.targetPercent) / 100,
    );
    const targetHistoryTokens = Math.max(0, targetTotalTokens - baseTokens);

    // Run the compaction strategy
    const result = await this.strategy.compact(historyMessages, this.config, {
      currentTokens: historyTokens,
      targetTokens: targetHistoryTokens,
      modelLimits: this.modelLimits,
      client: this.client,
      model: this.config.summarizationModel ?? this.model,
    });

    // Replace the conversation history
    conversation.replaceHistory(result.messages);

    // Count tokens after compaction
    const afterTokens = await this.client.countTokens(this.model, conversation.getMessages());
    const tokensSaved = currentTokens - afterTokens;

    // Update statistics
    this.totalCompactions++;
    this.totalTokensSaved += tokensSaved;
    this.lastTokenCount = afterTokens;

    // Create event - use result.strategyName for accurate reporting (e.g., when hybrid falls back to sliding-window)
    const event: CompactionEvent = {
      strategy: result.strategyName,
      tokensBefore: currentTokens,
      tokensAfter: afterTokens,
      messagesBefore: historyMessages.length + baseMessages.length,
      messagesAfter: result.messages.length + baseMessages.length,
      summary: result.summary,
      iteration,
    };

    // Call onCompaction callback if provided
    if (this.config.onCompaction) {
      try {
        this.config.onCompaction(event);
      } catch (err) {
        console.warn("[llmist/compaction] onCompaction callback error:", err);
      }
    }

    return event;
  }

  /**
   * Get compaction statistics.
   */
  getStats(): CompactionStats {
    const contextWindow = this.modelLimits?.contextWindow ?? 0;
    return {
      totalCompactions: this.totalCompactions,
      totalTokensSaved: this.totalTokensSaved,
      currentUsage: {
        tokens: this.lastTokenCount,
        percent: contextWindow > 0 ? (this.lastTokenCount / contextWindow) * 100 : 0,
      },
      contextWindow,
    };
  }

  /**
   * Check if compaction is enabled.
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}
