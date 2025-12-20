/**
 * OpenAI Model Specifications
 *
 * Model data for OpenAI models including GPT-5.2, GPT-5.1, GPT-5, GPT-4.1, GPT-4o, and o-series
 * with their specifications, pricing (Standard tier), and capabilities.
 *
 * Pricing source: https://openai.com/api/pricing (Standard tier)
 * Last updated: 2025-12-20
 */

import type { ModelSpec } from "../core/model-catalog.js";

export const OPENAI_MODELS: ModelSpec[] = [
  // GPT-5.2 Family (Latest flagship)
  {
    provider: "openai",
    modelId: "gpt-5.2",
    displayName: "GPT-5.2",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    pricing: {
      input: 1.25,
      output: 10.0,
      cachedInput: 0.125,
    },
    knowledgeCutoff: "2025-03-31",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      structuredOutputs: true,
      fineTuning: true,
    },
    metadata: {
      family: "GPT-5.2",
      releaseDate: "2025-12-01",
      notes: "Latest flagship model with 1M context window and enhanced reasoning.",
      supportsTemperature: false,
    },
  },
  {
    provider: "openai",
    modelId: "gpt-5.2-pro",
    displayName: "GPT-5.2 Pro",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    pricing: {
      input: 15.0,
      output: 120.0,
    },
    knowledgeCutoff: "2025-03-31",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      structuredOutputs: true,
    },
    metadata: {
      family: "GPT-5.2",
      releaseDate: "2025-12-01",
      notes: "Premium tier GPT-5.2 with enhanced reasoning. Does not support prompt caching.",
      supportsTemperature: false,
    },
  },

  // GPT-5.1 Family
  {
    provider: "openai",
    modelId: "gpt-5.1",
    displayName: "GPT-5.1",
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    pricing: {
      input: 1.25,
      output: 10.0,
      cachedInput: 0.125,
    },
    knowledgeCutoff: "2024-09-30",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      structuredOutputs: true,
      fineTuning: true,
    },
    metadata: {
      family: "GPT-5.1",
      releaseDate: "2025-11-12",
      notes: "GPT-5 variant with improved instruction following. 2-3x faster than GPT-5.",
      supportsTemperature: false,
    },
  },
  {
    provider: "openai",
    modelId: "gpt-5.1-codex",
    displayName: "GPT-5.1 Codex",
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    pricing: {
      input: 1.25,
      output: 10.0,
      cachedInput: 0.125,
    },
    knowledgeCutoff: "2024-09-30",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      structuredOutputs: true,
    },
    metadata: {
      family: "GPT-5.1",
      notes: "GPT-5.1 variant optimized for code generation and analysis.",
      supportsTemperature: false,
    },
  },
  {
    provider: "openai",
    modelId: "gpt-5.1-codex-max",
    displayName: "GPT-5.1 Codex Max",
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    pricing: {
      input: 1.25,
      output: 10.0,
      cachedInput: 0.125,
    },
    knowledgeCutoff: "2024-09-30",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      structuredOutputs: true,
    },
    metadata: {
      family: "GPT-5.1",
      notes: "Extended thinking variant of GPT-5.1 Codex for complex code tasks.",
      supportsTemperature: false,
    },
  },

  // GPT-5 Family
  {
    provider: "openai",
    modelId: "gpt-5",
    displayName: "GPT-5",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    pricing: {
      input: 1.25,
      output: 10.0,
      cachedInput: 0.125,
    },
    knowledgeCutoff: "2024-09-30",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      structuredOutputs: true,
      fineTuning: true,
    },
    metadata: {
      family: "GPT-5",
      releaseDate: "2025-08-07",
      notes: "High-capability model for coding and agentic tasks. 90% caching discount.",
      supportsTemperature: false,
    },
  },
  {
    provider: "openai",
    modelId: "gpt-5-codex",
    displayName: "GPT-5 Codex",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    pricing: {
      input: 1.25,
      output: 10.0,
      cachedInput: 0.125,
    },
    knowledgeCutoff: "2024-09-30",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      structuredOutputs: true,
    },
    metadata: {
      family: "GPT-5",
      notes: "GPT-5 variant optimized for code generation and analysis.",
      supportsTemperature: false,
    },
  },
  {
    provider: "openai",
    modelId: "gpt-5-mini",
    displayName: "GPT-5 Mini",
    contextWindow: 272_000,
    maxOutputTokens: 32_768,
    pricing: {
      input: 0.25,
      output: 2.0,
      cachedInput: 0.025,
    },
    knowledgeCutoff: "2024-06-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      structuredOutputs: true,
      fineTuning: true,
    },
    metadata: {
      family: "GPT-5",
      notes: "Fast and cost-efficient with adaptive reasoning",
      supportsTemperature: false,
    },
  },
  {
    provider: "openai",
    modelId: "gpt-5-nano",
    displayName: "GPT-5 Nano",
    contextWindow: 272_000,
    maxOutputTokens: 32_768,
    pricing: {
      input: 0.05,
      output: 0.4,
      cachedInput: 0.005,
    },
    knowledgeCutoff: "2024-05-31",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      structuredOutputs: true,
      fineTuning: true,
    },
    metadata: {
      family: "GPT-5",
      notes: "Fastest, most cost-efficient version for well-defined tasks",
      supportsTemperature: false,
    },
  },
  {
    provider: "openai",
    modelId: "gpt-5-pro",
    displayName: "GPT-5 Pro",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    pricing: {
      input: 15.0,
      output: 120.0,
      // No cached input pricing for gpt-5-pro
    },
    knowledgeCutoff: "2024-09-30",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      structuredOutputs: true,
    },
    metadata: {
      family: "GPT-5",
      notes: "Premium tier with enhanced capabilities. Does not support prompt caching.",
      supportsTemperature: false,
    },
  },

  // GPT-4.1 Family
  {
    provider: "openai",
    modelId: "gpt-4.1",
    displayName: "GPT-4.1",
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
    pricing: {
      input: 2.0,
      output: 8.0,
      cachedInput: 0.5,
    },
    knowledgeCutoff: "2024-04-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      structuredOutputs: true,
      fineTuning: true,
    },
    metadata: {
      family: "GPT-4.1",
      notes: "Improved GPT-4 with better instruction following",
    },
  },
  {
    provider: "openai",
    modelId: "gpt-4.1-mini",
    displayName: "GPT-4.1 Mini",
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
    pricing: {
      input: 0.4,
      output: 1.6,
      cachedInput: 0.1,
    },
    knowledgeCutoff: "2024-04-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      structuredOutputs: true,
      fineTuning: true,
    },
    metadata: {
      family: "GPT-4.1",
      notes: "Cost-efficient GPT-4.1 variant",
    },
  },
  {
    provider: "openai",
    modelId: "gpt-4.1-nano",
    displayName: "GPT-4.1 Nano",
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
    pricing: {
      input: 0.1,
      output: 0.4,
      cachedInput: 0.025,
    },
    knowledgeCutoff: "2024-04-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      structuredOutputs: true,
      fineTuning: true,
    },
    metadata: {
      family: "GPT-4.1",
      notes: "Fastest GPT-4.1 variant for simple tasks",
    },
  },

  // GPT-4o Family
  {
    provider: "openai",
    modelId: "gpt-4o",
    displayName: "GPT-4o",
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    pricing: {
      input: 2.5,
      output: 10.0,
      cachedInput: 1.25,
    },
    knowledgeCutoff: "2024-04-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      structuredOutputs: true,
      fineTuning: true,
    },
    metadata: {
      family: "GPT-4o",
      notes: "Multimodal model optimized for speed",
    },
  },
  {
    provider: "openai",
    modelId: "gpt-4o-mini",
    displayName: "GPT-4o Mini",
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    pricing: {
      input: 0.15,
      output: 0.6,
      cachedInput: 0.075,
    },
    knowledgeCutoff: "2024-04-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      structuredOutputs: true,
      fineTuning: true,
    },
    metadata: {
      family: "GPT-4o",
      notes: "Fast and affordable multimodal model",
    },
  },

  // o-series (Reasoning models)
  {
    provider: "openai",
    modelId: "o1",
    displayName: "o1",
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    pricing: {
      input: 15.0,
      output: 60.0,
      cachedInput: 7.5,
    },
    knowledgeCutoff: "2024-12-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      structuredOutputs: true,
    },
    metadata: {
      family: "o-series",
      notes: "Advanced reasoning model with chain-of-thought",
      supportsTemperature: false,
    },
  },
  {
    provider: "openai",
    modelId: "o1-pro",
    displayName: "o1 Pro",
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    pricing: {
      input: 150.0,
      output: 600.0,
    },
    knowledgeCutoff: "2024-12-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      structuredOutputs: true,
    },
    metadata: {
      family: "o-series",
      notes: "Premium tier o1 with extended reasoning. Does not support prompt caching.",
      supportsTemperature: false,
    },
  },
  {
    provider: "openai",
    modelId: "o3",
    displayName: "o3",
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    pricing: {
      input: 2.0,
      output: 8.0,
      cachedInput: 0.5,
    },
    knowledgeCutoff: "2025-01-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      structuredOutputs: true,
    },
    metadata: {
      family: "o-series",
      notes: "Next-gen reasoning model, more efficient than o1",
      supportsTemperature: false,
    },
  },
  {
    provider: "openai",
    modelId: "o4-mini",
    displayName: "o4 Mini",
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    pricing: {
      input: 1.1,
      output: 4.4,
      cachedInput: 0.275,
    },
    knowledgeCutoff: "2025-04-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      structuredOutputs: true,
      fineTuning: true,
    },
    metadata: {
      family: "o-series",
      notes: "Cost-efficient reasoning model",
      supportsTemperature: false,
    },
  },
  {
    provider: "openai",
    modelId: "o3-mini",
    displayName: "o3 Mini",
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    pricing: {
      input: 1.1,
      output: 4.4,
      cachedInput: 0.55,
    },
    knowledgeCutoff: "2025-01-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      structuredOutputs: true,
    },
    metadata: {
      family: "o-series",
      notes: "Compact reasoning model for cost-sensitive applications",
      supportsTemperature: false,
    },
  },
];
