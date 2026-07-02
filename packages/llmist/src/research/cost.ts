/**
 * Research cost estimation.
 *
 * Separate from `ModelRegistry.estimateCost` because research pricing has
 * dimensions the chat cost model lacks: per-search fees and separately-priced
 * internal reasoning tokens (see {@link ResearchPricing}).
 */

import { RESEARCH_COST_DECIMALS, SEARCHES_PER_THOUSAND, TOKENS_PER_MILLION } from "./constants.js";
import type { ResearchPricing } from "./model-spec.js";
import type { ResearchUsage } from "./types.js";

/**
 * Estimate the USD cost of a research run.
 *
 * Semantics:
 * - `cachedInputTokens` are a subset of `inputTokens` and billed at
 *   `cachedInput` (falling back to `input` when unset).
 * - `reasoningTokens` are a subset of `outputTokens`. When
 *   `internalReasoning` is priced, reasoning tokens are billed at that rate
 *   and excluded from the output rate; otherwise they remain part of output.
 * - `searches` are billed at `perThousandSearches / 1000` each.
 */
export function estimateResearchCost(pricing: ResearchPricing, usage: ResearchUsage): number {
  const cachedTokens = usage.cachedInputTokens ?? 0;
  const freshInputTokens = Math.max(0, usage.inputTokens - cachedTokens);
  const cachedRate = pricing.cachedInput ?? pricing.input;

  let outputTokens = usage.outputTokens;
  let reasoningCost = 0;
  if (pricing.internalReasoning !== undefined && usage.reasoningTokens !== undefined) {
    outputTokens = Math.max(0, outputTokens - usage.reasoningTokens);
    reasoningCost = (usage.reasoningTokens * pricing.internalReasoning) / TOKENS_PER_MILLION;
  }

  const searchCost =
    pricing.perThousandSearches !== undefined && usage.searches !== undefined
      ? (usage.searches * pricing.perThousandSearches) / SEARCHES_PER_THOUSAND
      : 0;

  const total =
    (freshInputTokens * pricing.input) / TOKENS_PER_MILLION +
    (cachedTokens * cachedRate) / TOKENS_PER_MILLION +
    (outputTokens * pricing.output) / TOKENS_PER_MILLION +
    reasoningCost +
    searchCost;

  return Number(total.toFixed(RESEARCH_COST_DECIMALS));
}
