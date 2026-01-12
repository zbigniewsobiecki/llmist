/**
 * OpenRouter Model Specifications
 *
 * Curated list of popular models available through OpenRouter.
 * OpenRouter provides access to 400+ models, but we include only the most
 * commonly used ones here for discoverability.
 *
 * IMPORTANT: Pricing is approximate and may change. OpenRouter pricing is
 * dynamic and can vary based on provider availability. Check openrouter.ai
 * for current pricing.
 *
 * Model IDs use OpenRouter's format: provider/model-name
 */

import type { ModelSpec } from "../core/model-catalog.js";

export const OPENROUTER_MODELS: ModelSpec[] = [
  // ============================================================
  // Anthropic Claude Models (via OpenRouter)
  // ============================================================
  {
    provider: "openrouter",
    modelId: "anthropic/claude-sonnet-4-5",
    displayName: "Claude Sonnet 4.5 (OpenRouter)",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    pricing: {
      input: 3.0,
      output: 15.0,
    },
    knowledgeCutoff: "2025-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
    },
    metadata: {
      family: "Claude 4",
      notes: "Anthropic Claude via OpenRouter. Pricing may vary.",
    },
  },
  {
    provider: "openrouter",
    modelId: "anthropic/claude-opus-4-5",
    displayName: "Claude Opus 4.5 (OpenRouter)",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    pricing: {
      input: 15.0,
      output: 75.0,
    },
    knowledgeCutoff: "2025-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
    },
    metadata: {
      family: "Claude 4",
      notes: "Anthropic Claude Opus via OpenRouter. Most capable Claude model.",
    },
  },
  {
    provider: "openrouter",
    modelId: "anthropic/claude-haiku-4-5",
    displayName: "Claude Haiku 4.5 (OpenRouter)",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    pricing: {
      input: 0.8,
      output: 4.0,
    },
    knowledgeCutoff: "2025-02",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
    },
    metadata: {
      family: "Claude 4",
      notes: "Anthropic Claude Haiku via OpenRouter. Fast and efficient.",
    },
  },

  // ============================================================
  // OpenAI GPT Models (via OpenRouter)
  // ============================================================
  {
    provider: "openrouter",
    modelId: "openai/gpt-4o",
    displayName: "GPT-4o (OpenRouter)",
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    pricing: {
      input: 2.5,
      output: 10.0,
    },
    knowledgeCutoff: "2024-10",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    metadata: {
      family: "GPT-4",
      notes: "OpenAI GPT-4o via OpenRouter.",
    },
  },
  {
    provider: "openrouter",
    modelId: "openai/gpt-4o-mini",
    displayName: "GPT-4o Mini (OpenRouter)",
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    pricing: {
      input: 0.15,
      output: 0.6,
    },
    knowledgeCutoff: "2024-10",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    metadata: {
      family: "GPT-4",
      notes: "OpenAI GPT-4o Mini via OpenRouter. Cost-effective option.",
    },
  },
  {
    provider: "openrouter",
    modelId: "openai/gpt-5.2",
    displayName: "GPT-5.2 (OpenRouter)",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    pricing: {
      input: 5.0,
      output: 20.0,
    },
    knowledgeCutoff: "2025-03",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
    },
    metadata: {
      family: "GPT-5",
      notes: "OpenAI GPT-5.2 via OpenRouter. Latest flagship model.",
    },
  },

  // ============================================================
  // Google Gemini Models (via OpenRouter)
  // ============================================================
  {
    provider: "openrouter",
    modelId: "google/gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash (OpenRouter)",
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    pricing: {
      input: 0.15,
      output: 0.6,
    },
    knowledgeCutoff: "2025-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
    },
    metadata: {
      family: "Gemini 2.5",
      notes: "Google Gemini 2.5 Flash via OpenRouter. Fast and cost-effective.",
    },
  },
  {
    provider: "openrouter",
    modelId: "google/gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro (OpenRouter)",
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    pricing: {
      input: 2.5,
      output: 10.0,
    },
    knowledgeCutoff: "2025-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
    },
    metadata: {
      family: "Gemini 2.5",
      notes: "Google Gemini 2.5 Pro via OpenRouter.",
    },
  },

  // ============================================================
  // Meta Llama Models (via OpenRouter)
  // ============================================================
  {
    provider: "openrouter",
    modelId: "meta-llama/llama-3.3-70b-instruct",
    displayName: "Llama 3.3 70B Instruct (OpenRouter)",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    pricing: {
      input: 0.4,
      output: 0.4,
    },
    knowledgeCutoff: "2024-12",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    metadata: {
      family: "Llama 3.3",
      notes: "Meta Llama 3.3 70B via OpenRouter. Excellent open-source model.",
    },
  },
  {
    provider: "openrouter",
    modelId: "meta-llama/llama-4-maverick",
    displayName: "Llama 4 Maverick (OpenRouter)",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    pricing: {
      input: 0.2,
      output: 0.6,
    },
    knowledgeCutoff: "2025-04",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
    },
    metadata: {
      family: "Llama 4",
      notes: "Meta Llama 4 Maverick via OpenRouter. Latest Llama generation.",
    },
  },

  // ============================================================
  // DeepSeek Models (via OpenRouter)
  // ============================================================
  {
    provider: "openrouter",
    modelId: "deepseek/deepseek-r1",
    displayName: "DeepSeek R1 (OpenRouter)",
    contextWindow: 64_000,
    maxOutputTokens: 8_192,
    pricing: {
      input: 0.55,
      output: 2.19,
    },
    knowledgeCutoff: "2025-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
      reasoning: true,
    },
    metadata: {
      family: "DeepSeek R1",
      notes: "DeepSeek R1 via OpenRouter. Strong reasoning capabilities.",
    },
  },
  {
    provider: "openrouter",
    modelId: "deepseek/deepseek-chat",
    displayName: "DeepSeek Chat (OpenRouter)",
    contextWindow: 64_000,
    maxOutputTokens: 8_192,
    pricing: {
      input: 0.14,
      output: 0.28,
    },
    knowledgeCutoff: "2025-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    metadata: {
      family: "DeepSeek V3",
      notes: "DeepSeek Chat via OpenRouter. Very cost-effective.",
    },
  },

  // ============================================================
  // Mistral Models (via OpenRouter)
  // ============================================================
  {
    provider: "openrouter",
    modelId: "mistralai/mistral-large",
    displayName: "Mistral Large (OpenRouter)",
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    pricing: {
      input: 2.0,
      output: 6.0,
    },
    knowledgeCutoff: "2024-11",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    metadata: {
      family: "Mistral Large",
      notes: "Mistral Large via OpenRouter. Strong multilingual capabilities.",
    },
  },
  {
    provider: "openrouter",
    modelId: "mistralai/mixtral-8x22b-instruct",
    displayName: "Mixtral 8x22B Instruct (OpenRouter)",
    contextWindow: 65_536,
    maxOutputTokens: 8_192,
    pricing: {
      input: 0.9,
      output: 0.9,
    },
    knowledgeCutoff: "2024-04",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    metadata: {
      family: "Mixtral",
      notes: "Mixtral 8x22B via OpenRouter. Sparse MoE architecture.",
    },
  },

  // ============================================================
  // Qwen Models (via OpenRouter)
  // ============================================================
  {
    provider: "openrouter",
    modelId: "qwen/qwen-2.5-72b-instruct",
    displayName: "Qwen 2.5 72B Instruct (OpenRouter)",
    contextWindow: 131_072,
    maxOutputTokens: 8_192,
    pricing: {
      input: 0.35,
      output: 0.4,
    },
    knowledgeCutoff: "2024-09",
    features: {
      streaming: true,
      functionCalling: true,
      vision: false,
    },
    metadata: {
      family: "Qwen 2.5",
      notes: "Qwen 2.5 72B via OpenRouter. Strong coding and math.",
    },
  },
];
