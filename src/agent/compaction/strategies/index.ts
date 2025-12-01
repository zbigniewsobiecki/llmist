/**
 * Compaction Strategy Implementations
 *
 * Available strategies:
 * - SlidingWindowStrategy: Fast, drops oldest turns (no LLM call)
 * - SummarizationStrategy: LLM-based compression
 * - HybridStrategy: Summarizes old + keeps recent (recommended)
 */

export { SlidingWindowStrategy } from "./sliding-window.js";
export { SummarizationStrategy } from "./summarization.js";
export { HybridStrategy } from "./hybrid.js";
