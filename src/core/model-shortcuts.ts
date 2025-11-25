/**
 * Model shortcuts and aliases for more expressive DX.
 *
 * This module provides convenient aliases for common model names,
 * allowing developers to use short, memorable names instead of
 * verbose provider:model-id formats.
 *
 * @example
 * ```typescript
 * // Instead of:
 * model: "openai:gpt-5-nano"
 *
 * // You can use:
 * model: "gpt5-nano"
 * // or even:
 * model: "gpt-5-nano" // Auto-detects provider
 * ```
 */

/**
 * Map of common model aliases to their full provider:model-id format.
 */
export const MODEL_ALIASES: Record<string, string> = {
  // OpenAI aliases
  gpt4: "openai:gpt-4o",
  gpt4o: "openai:gpt-4o",
  gpt5: "openai:gpt-5",
  "gpt5-mini": "openai:gpt-5-mini",
  "gpt5-nano": "openai:gpt-5-nano",

  // Anthropic aliases
  sonnet: "anthropic:claude-3-5-sonnet-latest",
  "claude-sonnet": "anthropic:claude-3-5-sonnet-latest",
  haiku: "anthropic:claude-3-5-haiku-latest",
  "claude-haiku": "anthropic:claude-3-5-haiku-latest",
  opus: "anthropic:claude-3-opus-latest",
  "claude-opus": "anthropic:claude-3-opus-latest",

  // Gemini aliases
  flash: "gemini:gemini-2.0-flash",
  "gemini-flash": "gemini:gemini-2.0-flash",
  "gemini-pro": "gemini:gemini-2.0-pro",
  pro: "gemini:gemini-2.0-pro",
};

/**
 * Options for resolveModel function.
 */
export interface ResolveModelOptions {
  /**
   * If true, throw an error for unknown model names instead of falling back to OpenAI.
   * This helps catch typos like "gp4" instead of "gpt4".
   * Default: false
   */
  strict?: boolean;

  /**
   * If true, suppress warnings for unknown model names.
   * Default: false
   */
  silent?: boolean;
}

/**
 * Known model name patterns for validation.
 * These patterns help detect typos and unknown models.
 */
const KNOWN_MODEL_PATTERNS = [
  /^gpt-?\d/i, // gpt-4, gpt-3.5, gpt4, etc.
  /^claude-?\d/i, // claude-3, claude-2, etc.
  /^gemini-?(\d|pro|flash)/i, // gemini-2.0, gemini-pro, gemini-flash, etc.
  /^o\d/i, // OpenAI o1, o3, etc.
];

/**
 * Check if a model name matches known patterns.
 *
 * @param model - Model name to check
 * @returns True if the model matches a known pattern
 */
function isKnownModelPattern(model: string): boolean {
  const normalized = model.toLowerCase();

  // Check if it's a known alias
  if (MODEL_ALIASES[normalized]) {
    return true;
  }

  // Check against known patterns
  return KNOWN_MODEL_PATTERNS.some((pattern) => pattern.test(model));
}

/**
 * Resolves a model name to its full provider:model format.
 *
 * Supports:
 * - Direct aliases: 'gpt5', 'sonnet', 'flash'
 * - Auto-detection: 'gpt-5-nano' → 'openai:gpt-5-nano'
 * - Pass-through: 'openai:gpt-5' → 'openai:gpt-5'
 *
 * Warnings:
 * - Logs a warning when an unknown model name falls back to OpenAI
 * - Use { strict: true } to throw an error instead
 * - Use { silent: true } to suppress warnings
 *
 * @param model - Model name or alias
 * @param options - Resolution options
 * @returns Full provider:model-id string
 *
 * @example
 * ```typescript
 * resolveModel('gpt5')              // → 'openai:gpt-5'
 * resolveModel('sonnet')            // → 'anthropic:claude-3-5-sonnet-latest'
 * resolveModel('gpt-5-nano')        // → 'openai:gpt-5-nano'
 * resolveModel('openai:gpt-5')      // → 'openai:gpt-5' (passthrough)
 * resolveModel('claude-3-5-sonnet') // → 'anthropic:claude-3-5-sonnet'
 *
 * // Typo detection
 * resolveModel('gp5')  // ⚠️ Warning: Unknown model 'gp5', falling back to 'openai:gp5'
 *
 * // Strict mode (throws on typos)
 * resolveModel('gp5', { strict: true })  // ❌ Error: Unknown model 'gp5'
 * ```
 */
export function resolveModel(model: string, options: ResolveModelOptions = {}): string {
  // Already has provider prefix - pass through
  if (model.includes(":")) {
    return model;
  }

  // Check if it's a known alias
  const normalized = model.toLowerCase();
  if (MODEL_ALIASES[normalized]) {
    return MODEL_ALIASES[normalized];
  }

  // Smart detection by model name patterns
  const modelLower = model.toLowerCase();

  // OpenAI models start with 'gpt'
  if (modelLower.startsWith("gpt")) {
    return `openai:${model}`;
  }

  // Anthropic models start with 'claude'
  if (modelLower.startsWith("claude")) {
    return `anthropic:${model}`;
  }

  // Gemini models start with 'gemini'
  if (modelLower.startsWith("gemini")) {
    return `gemini:${model}`;
  }

  // OpenAI o-series models (o1, o3, etc.)
  if (modelLower.match(/^o\d/)) {
    return `openai:${model}`;
  }

  // Unknown model: validate and warn/error
  if (!isKnownModelPattern(model)) {
    if (options.strict) {
      throw new Error(
        `Unknown model '${model}'. Did you mean one of: gpt4, sonnet, haiku, flash? ` +
          `Use explicit provider prefix like 'openai:${model}' to bypass this check.`,
      );
    }

    if (!options.silent) {
      console.warn(
        `⚠️  Unknown model '${model}', falling back to 'openai:${model}'. ` +
          `This might be a typo. Did you mean: gpt4, gpt5, gpt5-nano, sonnet, haiku, flash? ` +
          `Use { strict: true } to error on unknown models, or { silent: true } to suppress this warning.`,
      );
    }
  }

  // Default: assume OpenAI for unknown models
  // This provides a reasonable fallback for most cases
  return `openai:${model}`;
}

/**
 * Check if a model string is already in provider:model format.
 *
 * @param model - Model string to check
 * @returns True if the model has a provider prefix
 *
 * @example
 * ```typescript
 * hasProviderPrefix('openai:gpt-4o')    // → true
 * hasProviderPrefix('gpt4')              // → false
 * hasProviderPrefix('claude-3-5-sonnet') // → false
 * ```
 */
export function hasProviderPrefix(model: string): boolean {
  return model.includes(":");
}

/**
 * Extract the provider from a full model string.
 *
 * @param model - Full model string (provider:model-id)
 * @returns Provider name, or undefined if no prefix
 *
 * @example
 * ```typescript
 * getProvider('openai:gpt-4o')     // → 'openai'
 * getProvider('anthropic:claude')  // → 'anthropic'
 * getProvider('gpt4')              // → undefined
 * ```
 */
export function getProvider(model: string): string | undefined {
  const separatorIndex = model.indexOf(":");
  if (separatorIndex === -1) {
    return undefined;
  }
  return model.slice(0, separatorIndex);
}

/**
 * Extract the model ID from a full model string.
 *
 * @param model - Full model string (provider:model-id)
 * @returns Model ID, or the original string if no prefix
 *
 * @example
 * ```typescript
 * getModelId('openai:gpt-4o')      // → 'gpt-4o'
 * getModelId('anthropic:claude')   // → 'claude'
 * getModelId('gpt4')               // → 'gpt4'
 * ```
 */
export function getModelId(model: string): string {
  const separatorIndex = model.indexOf(":");
  if (separatorIndex === -1) {
    return model;
  }
  return model.slice(separatorIndex + 1);
}
