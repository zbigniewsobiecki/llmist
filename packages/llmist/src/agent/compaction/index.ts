/**
 * Context Compaction System
 *
 * Automatically manages conversation context to prevent context window overflow
 * in long-running agent conversations.
 *
 * Features:
 * - Automatic threshold monitoring (default: 80% of context window)
 * - Multiple strategies: sliding-window, summarization, hybrid (default)
 * - Full visibility via StreamEvents and hooks
 * - Enabled by default with sensible defaults
 *
 * @example
 * ```typescript
 * // Auto-enabled with defaults
 * const agent = await LLMist.createAgent()
 *   .withModel('sonnet')
 *   .ask('Help me...');
 *
 * // Custom configuration
 * const agent = await LLMist.createAgent()
 *   .withModel('gpt-4')
 *   .withCompaction({
 *     triggerThresholdPercent: 70,
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

// Configuration
export {
  type CompactionConfig,
  type CompactionEvent,
  type CompactionStats,
  DEFAULT_COMPACTION_CONFIG,
  DEFAULT_SUMMARIZATION_PROMPT,
  type ResolvedCompactionConfig,
  resolveCompactionConfig,
} from "./config.js";
// Manager
export { CompactionManager } from "./manager.js";

// Strategy implementations
export {
  HybridStrategy,
  SlidingWindowStrategy,
  SummarizationStrategy,
} from "./strategies/index.js";
// Strategy interface and utilities
export {
  type CompactionContext,
  type CompactionResult,
  type CompactionStrategy,
  flattenTurns,
  groupIntoTurns,
  type MessageTurn,
} from "./strategy.js";
