/**
 * Model Catalog Types
 *
 * Type definitions for LLM model specifications including
 * context windows, pricing, features, and capabilities.
 */

export interface ModelPricing {
  /** Price per 1 million input tokens in USD */
  input: number;
  /** Price per 1 million output tokens in USD */
  output: number;
  /** Price per 1 million cached input tokens in USD (if supported) */
  cachedInput?: number;
}

export interface ModelFeatures {
  /** Supports streaming responses */
  streaming: boolean;
  /** Supports function/tool calling */
  functionCalling: boolean;
  /** Supports vision/image input */
  vision: boolean;
  /** Supports extended thinking/reasoning */
  reasoning?: boolean;
  /** Supports structured outputs */
  structuredOutputs?: boolean;
  /** Supports fine-tuning */
  fineTuning?: boolean;
}

export interface ModelSpec {
  /** Provider identifier (e.g., 'openai', 'anthropic', 'gemini') */
  provider: string;
  /** Full model identifier used in API calls */
  modelId: string;
  /** Human-readable display name */
  displayName: string;
  /** Maximum context window size in tokens */
  contextWindow: number;
  /** Maximum output tokens per request */
  maxOutputTokens: number;
  /** Pricing per 1M tokens */
  pricing: ModelPricing;
  /** Training data knowledge cutoff date (YYYY-MM-DD or description) */
  knowledgeCutoff: string;
  /** Supported features and capabilities */
  features: ModelFeatures;
  /** Additional metadata */
  metadata?: {
    /** Model family/series */
    family?: string;
    /** Release date */
    releaseDate?: string;
    /** Deprecation date if applicable */
    deprecationDate?: string;
    /** Notes or special information */
    notes?: string;
    /** Whether manual temperature configuration is supported (defaults to true) */
    supportsTemperature?: boolean;
  };
}

export interface ModelLimits {
  contextWindow: number;
  maxOutputTokens: number;
}

export interface CostEstimate {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: "USD";
}
