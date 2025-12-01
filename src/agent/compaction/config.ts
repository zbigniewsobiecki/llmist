/**
 * Configuration types for the context compaction system.
 *
 * Context compaction automatically manages conversation history to prevent
 * context window overflow in long-running agent conversations.
 */

/**
 * Event emitted when compaction occurs.
 * This is included in StreamEvent for UI visibility.
 */
export interface CompactionEvent {
  /** The strategy that performed the compaction */
  strategy: string;
  /** Token count before compaction */
  tokensBefore: number;
  /** Token count after compaction */
  tokensAfter: number;
  /** Number of messages before compaction */
  messagesBefore: number;
  /** Number of messages after compaction */
  messagesAfter: number;
  /** Summary text if summarization was used */
  summary?: string;
  /** Agent iteration when compaction occurred */
  iteration: number;
}

/**
 * Statistics about compaction activity.
 */
export interface CompactionStats {
  /** Total number of compactions performed */
  totalCompactions: number;
  /** Total tokens saved across all compactions */
  totalTokensSaved: number;
  /** Current context usage */
  currentUsage: {
    tokens: number;
    percent: number;
  };
  /** Model's context window size */
  contextWindow: number;
}

/**
 * Configuration for the context compaction system.
 *
 * @example
 * ```typescript
 * // Custom configuration
 * const agent = await LLMist.createAgent()
 *   .withModel('sonnet')
 *   .withCompaction({
 *     triggerThresholdPercent: 70,
 *     targetPercent: 40,
 *     preserveRecentTurns: 10,
 *   })
 *   .ask('...');
 *
 * // Disable compaction
 * const agent = await LLMist.createAgent()
 *   .withModel('sonnet')
 *   .withoutCompaction()
 *   .ask('...');
 * ```
 */
export interface CompactionConfig {
  /**
   * Enable or disable compaction.
   * @default true
   */
  enabled?: boolean;

  /**
   * The compaction strategy to use.
   * - 'sliding-window': Fast, drops oldest turns (no LLM call)
   * - 'summarization': LLM-based compression of old messages
   * - 'hybrid': Summarizes old messages + keeps recent turns (recommended)
   * @default 'hybrid'
   */
  strategy?: "sliding-window" | "summarization" | "hybrid";

  /**
   * Context usage percentage that triggers compaction.
   * When token count exceeds this percentage of the context window,
   * compaction is performed before the next LLM call.
   * @default 80
   */
  triggerThresholdPercent?: number;

  /**
   * Target context usage percentage after compaction.
   * The compaction will aim to reduce tokens to this percentage.
   * @default 50
   */
  targetPercent?: number;

  /**
   * Number of recent turns to preserve during compaction.
   * A "turn" is a user message + assistant response pair.
   * Recent turns are kept verbatim while older ones are summarized/dropped.
   * @default 5
   */
  preserveRecentTurns?: number;

  /**
   * Model to use for summarization.
   * If not specified, uses the agent's model.
   * @default undefined (uses agent's model)
   */
  summarizationModel?: string;

  /**
   * Custom system prompt for summarization.
   * If not specified, uses a default prompt optimized for context preservation.
   */
  summarizationPrompt?: string;

  /**
   * Callback invoked when compaction occurs.
   * Useful for logging or analytics.
   */
  onCompaction?: (event: CompactionEvent) => void;
}

/**
 * Default configuration values for compaction.
 * Compaction is enabled by default with the hybrid strategy.
 */
export const DEFAULT_COMPACTION_CONFIG: Required<
  Omit<CompactionConfig, "summarizationModel" | "summarizationPrompt" | "onCompaction">
> = {
  enabled: true,
  strategy: "hybrid",
  triggerThresholdPercent: 80,
  targetPercent: 50,
  preserveRecentTurns: 5,
};

/**
 * Default prompt used for summarization strategy.
 */
export const DEFAULT_SUMMARIZATION_PROMPT = `Summarize this conversation history concisely, preserving:
1. Key decisions made and their rationale
2. Important facts and data discovered
3. Errors encountered and how they were resolved
4. Current task context and goals

Format as a brief narrative paragraph, not bullet points.
Previous conversation:`;

/**
 * Resolved configuration with all defaults applied.
 */
export interface ResolvedCompactionConfig {
  enabled: boolean;
  strategy: "sliding-window" | "summarization" | "hybrid";
  triggerThresholdPercent: number;
  targetPercent: number;
  preserveRecentTurns: number;
  summarizationModel?: string;
  summarizationPrompt: string;
  onCompaction?: (event: CompactionEvent) => void;
}

/**
 * Resolves partial configuration with defaults.
 */
export function resolveCompactionConfig(
  config: CompactionConfig = {},
): ResolvedCompactionConfig {
  return {
    enabled: config.enabled ?? DEFAULT_COMPACTION_CONFIG.enabled,
    strategy: config.strategy ?? DEFAULT_COMPACTION_CONFIG.strategy,
    triggerThresholdPercent:
      config.triggerThresholdPercent ?? DEFAULT_COMPACTION_CONFIG.triggerThresholdPercent,
    targetPercent: config.targetPercent ?? DEFAULT_COMPACTION_CONFIG.targetPercent,
    preserveRecentTurns:
      config.preserveRecentTurns ?? DEFAULT_COMPACTION_CONFIG.preserveRecentTurns,
    summarizationModel: config.summarizationModel,
    summarizationPrompt: config.summarizationPrompt ?? DEFAULT_SUMMARIZATION_PROMPT,
    onCompaction: config.onCompaction,
  };
}
