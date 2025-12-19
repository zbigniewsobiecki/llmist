/**
 * Compaction Strategy Implementations
 *
 * Available strategies:
 * - SlidingWindowStrategy: Fast, drops oldest turns (no LLM call)
 * - SummarizationStrategy: LLM-based compression
 * - HybridStrategy: Summarizes old + keeps recent (recommended)
 */

export { HybridStrategy } from "./hybrid.js";
export { SlidingWindowStrategy } from "./sliding-window.js";
export { SummarizationStrategy } from "./summarization.js";
