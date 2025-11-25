/**
 * OpenAI Model Specifications
 *
 * Model data for OpenAI models including GPT-5, GPT-5-mini, and GPT-5-nano
 * with their specifications, pricing, and capabilities.
 */

import type { ModelSpec } from "../core/model-catalog.js";

export const OPENAI_MODELS: ModelSpec[] = [
  {
    provider: "openai",
    modelId: "gpt-5.1",
    displayName: "GPT-5.1 Instant",
    contextWindow: 128_000,
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
      family: "GPT-5",
      releaseDate: "2025-11-12",
      notes: "Warmer, more intelligent, better instruction following. 2-3x faster than GPT-5.",
      supportsTemperature: false,
    },
  },
  {
    provider: "openai",
    modelId: "gpt-5.1-thinking",
    displayName: "GPT-5.1 Thinking",
    contextWindow: 196_000,
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
      family: "GPT-5",
      releaseDate: "2025-11-12",
      notes:
        "Advanced reasoning with thinking levels: Light, Standard, Extended, Heavy. Best for complex tasks.",
      supportsTemperature: false,
    },
  },
  {
    provider: "openai",
    modelId: "gpt-5",
    displayName: "GPT-5",
    contextWindow: 272_000,
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
      notes:
        "Best model for coding and agentic tasks. Adaptive reasoning with 90% caching discount.",
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
];
