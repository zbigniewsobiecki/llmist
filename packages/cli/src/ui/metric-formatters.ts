/**
 * Metric formatting utilities for CLI output.
 *
 * Provides functions for formatting token counts, costs, and model identifiers
 * for display in the llmist CLI.
 */

/**
 * Formats token count with 'k' suffix for thousands.
 *
 * Uses compact notation to save terminal space while maintaining readability.
 * Numbers below 1000 are shown as-is, larger numbers use 'k' suffix with one decimal.
 *
 * @param tokens - Number of tokens
 * @returns Formatted string (e.g., "896" or "11.5k")
 *
 * @example
 * ```typescript
 * formatTokens(896)    // "896"
 * formatTokens(11500)  // "11.5k"
 * formatTokens(1234)   // "1.2k"
 * ```
 */
export function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`;
}

/**
 * Formats token count in long form with uppercase suffix and "tokens" label.
 *
 * Designed for table display and verbose contexts where more detail is needed.
 * Uses uppercase suffix and includes the word "tokens" for clarity.
 *
 * @param tokens - Number of tokens
 * @returns Formatted string (e.g., "896 tokens", "11K tokens", "1.0M tokens")
 *
 * @example
 * ```typescript
 * formatTokensLong(896)      // "896 tokens"
 * formatTokensLong(11500)    // "11K tokens"
 * formatTokensLong(1000000)  // "1.0M tokens"
 * ```
 */
export function formatTokensLong(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
  }
  if (tokens >= 1_000) {
    return `${Math.floor(tokens / 1_000)}K tokens`;
  }
  return `${tokens} tokens`;
}

/**
 * Formats cost with appropriate precision based on magnitude.
 *
 * Uses variable precision to balance readability and accuracy:
 * - Very small costs (<$0.001): 5 decimal places to show meaningful value
 * - Small costs (<$0.01): 4 decimal places for precision
 * - Medium costs (<$1): 3 decimal places for clarity
 * - Larger costs (≥$1): 2 decimal places (standard currency format)
 *
 * @param cost - Cost in USD
 * @returns Formatted cost string without currency symbol (e.g., "0.0123")
 *
 * @example
 * ```typescript
 * formatCost(0.00012)  // "0.00012"
 * formatCost(0.0056)   // "0.0056"
 * formatCost(0.123)    // "0.123"
 * formatCost(1.5)      // "1.50"
 * ```
 */
export function formatCost(cost: number): string {
  if (cost < 0.001) {
    return cost.toFixed(5);
  }
  if (cost < 0.01) {
    return cost.toFixed(4);
  }
  if (cost < 1) {
    return cost.toFixed(3);
  }
  return cost.toFixed(2);
}

/**
 * Strips the provider prefix from a model name.
 *
 * Many model identifiers include a provider prefix separated by a colon
 * (e.g., `"openai:gpt-4"`, `"anthropic:claude-3-5-sonnet-20241022"`).
 * This utility extracts just the model portion for display and registry lookups.
 *
 * @param model - Model name, optionally prefixed with a provider (e.g., `"openai:gpt-4"`)
 * @returns The model name without the provider prefix (e.g., `"gpt-4"`)
 *
 * @example
 * ```typescript
 * stripProviderPrefix("openai:gpt-4")           // "gpt-4"
 * stripProviderPrefix("claude-3-5-sonnet")       // "claude-3-5-sonnet"
 * stripProviderPrefix("")                        // ""
 * ```
 */
export function stripProviderPrefix(model: string): string {
  return model.includes(":") ? model.split(":")[1] : model;
}
