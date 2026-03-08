import type { ModelRegistry, TokenUsage } from "llmist";
import { stripProviderPrefix } from "../ui/formatters.js";

export type ProgressMode = "streaming" | "cumulative";

/**
 * Tracks per-call and cumulative LLM call statistics.
 * Single responsibility: manage all metrics related to LLM call progress.
 *
 * Manages:
 * - Per-call state: mode, model, call start time, token counts, cache tracking
 * - Cumulative state: total tokens, total cost, iteration count
 * - Methods for updating stats during and after each call
 */
export class CallStatsTracker {
  // Current call stats (streaming mode)
  mode: ProgressMode = "cumulative";
  model = "";
  callStartTime = Date.now();
  callInputTokens = 0;
  callInputTokensEstimated = true;
  callOutputTokens = 0;
  callOutputTokensEstimated = true;
  callOutputChars = 0;
  // Cache token tracking for live cost estimation during streaming
  callCachedInputTokens = 0;
  callCacheCreationInputTokens = 0;
  // Reasoning token tracking for live cost estimation during streaming
  callReasoningTokens = 0;

  // Cumulative stats (cumulative mode)
  totalStartTime = Date.now();
  totalTokens = 0;
  totalCost = 0;
  iterations = 0;
  currentIteration = 0;

  constructor(private readonly modelRegistry?: ModelRegistry) {}

  /**
   * Starts a new LLM call. Switches to streaming mode.
   * @param model - Model name being used
   * @param estimatedInputTokens - Initial input token count. Should come from
   *   client.countTokens() for accuracy (provider-specific counting), not
   *   character-based estimation. Will be updated with provider-returned counts
   *   via setInputTokens() during streaming if available.
   */
  startCall(model: string, estimatedInputTokens?: number): void {
    this.mode = "streaming";
    this.model = model;
    this.callStartTime = Date.now();
    this.currentIteration++;
    this.callInputTokens = estimatedInputTokens ?? 0;
    this.callInputTokensEstimated = true;
    this.callOutputTokens = 0;
    this.callOutputTokensEstimated = true;
    this.callOutputChars = 0;
    // Reset cache and reasoning tracking for new call
    this.callCachedInputTokens = 0;
    this.callCacheCreationInputTokens = 0;
    this.callReasoningTokens = 0;
  }

  /**
   * Ends the current LLM call. Updates cumulative stats and switches to cumulative mode.
   * @param usage - Final token usage from the call (including cached tokens if available)
   */
  endCall(usage?: TokenUsage): void {
    this.iterations++;
    if (usage) {
      this.totalTokens += usage.totalTokens;

      // Calculate and accumulate cost if model registry is available
      if (this.modelRegistry && this.model) {
        try {
          // Strip provider prefix if present (e.g., "openai:gpt-5-nano" -> "gpt-5-nano")
          const modelName = stripProviderPrefix(this.model);

          const cost = this.modelRegistry.estimateCost(
            modelName,
            usage.inputTokens,
            usage.outputTokens,
            usage.cachedInputTokens ?? 0,
            usage.cacheCreationInputTokens ?? 0,
            usage.reasoningTokens ?? 0,
          );
          if (cost) {
            this.totalCost += cost.totalCost;
          }
        } catch {
          // Ignore errors (e.g., unknown model) - just don't add to cost
        }
      }
    }
    this.mode = "cumulative";
  }

  /**
   * Adds gadget execution cost to the total.
   * Called when gadgets complete to include their costs (direct + subagent) in the total.
   */
  addGadgetCost(cost: number): void {
    if (cost > 0) {
      this.totalCost += cost;
    }
  }

  /**
   * Sets the input token count for current call (from stream metadata).
   * @param tokens - Token count from provider or client.countTokens()
   * @param estimated - If true, this is a fallback estimate (character-based).
   *   If false, this is an accurate count from the provider API or client.countTokens().
   *   Display shows ~ prefix only when estimated=true.
   */
  setInputTokens(tokens: number, estimated = false): void {
    // Don't overwrite actual count with a new estimate
    if (estimated && !this.callInputTokensEstimated) {
      return;
    }
    this.callInputTokens = tokens;
    this.callInputTokensEstimated = estimated;
  }

  /**
   * Sets the output token count for current call (from stream metadata).
   * @param tokens - Token count from provider streaming response
   * @param estimated - If true, this is a fallback estimate (character-based).
   *   If false, this is an accurate count from the provider's streaming metadata.
   *   Display shows ~ prefix only when estimated=true.
   */
  setOutputTokens(tokens: number, estimated = false): void {
    // Don't overwrite actual count with a new estimate
    if (estimated && !this.callOutputTokensEstimated) {
      return;
    }
    this.callOutputTokens = tokens;
    this.callOutputTokensEstimated = estimated;
  }

  /**
   * Sets cached token counts for the current call (from stream metadata).
   * Used for live cost estimation during streaming.
   * @param cachedInputTokens - Number of tokens read from cache (cheaper)
   * @param cacheCreationInputTokens - Number of tokens written to cache (more expensive)
   */
  setCachedTokens(cachedInputTokens: number, cacheCreationInputTokens: number): void {
    this.callCachedInputTokens = cachedInputTokens;
    this.callCacheCreationInputTokens = cacheCreationInputTokens;
  }

  /**
   * Sets reasoning token count for the current call (from stream metadata).
   * Used for live cost estimation during streaming.
   * @param reasoningTokens - Number of reasoning/thinking tokens (subset of outputTokens)
   */
  setReasoningTokens(reasoningTokens: number): void {
    this.callReasoningTokens = reasoningTokens;
  }

  /**
   * Get total elapsed time in seconds since the first call started.
   * @returns Elapsed time in seconds with 1 decimal place
   */
  getTotalElapsedSeconds(): number {
    if (this.totalStartTime === 0) return 0;
    return Number(((Date.now() - this.totalStartTime) / 1000).toFixed(1));
  }

  /**
   * Get elapsed time in seconds for the current call.
   * @returns Elapsed time in seconds with 1 decimal place
   */
  getCallElapsedSeconds(): number {
    return Number(((Date.now() - this.callStartTime) / 1000).toFixed(1));
  }

  /**
   * Calculates live cost estimate for the current streaming call.
   * Uses current input/output tokens and cached token counts.
   */
  calculateCurrentCallCost(outputTokens: number): number {
    if (!this.modelRegistry || !this.model) return 0;

    try {
      // Strip provider prefix if present (e.g., "anthropic:claude-sonnet-4-5" -> "claude-sonnet-4-5")
      const modelName = stripProviderPrefix(this.model);

      const cost = this.modelRegistry.estimateCost(
        modelName,
        this.callInputTokens,
        outputTokens,
        this.callCachedInputTokens,
        this.callCacheCreationInputTokens,
        this.callReasoningTokens,
      );

      return cost?.totalCost ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Calculates context window usage percentage.
   * Returns null if model is unknown or context window unavailable.
   */
  getContextUsagePercent(): number | null {
    if (!this.modelRegistry || !this.model || this.callInputTokens === 0) {
      return null;
    }

    // Strip provider prefix if present (e.g., "anthropic:claude-sonnet-4-5" -> "claude-sonnet-4-5")
    const modelName = stripProviderPrefix(this.model);

    const limits = this.modelRegistry.getModelLimits(modelName);
    if (!limits?.contextWindow) {
      return null;
    }

    return (this.callInputTokens / limits.contextWindow) * 100;
  }
}
