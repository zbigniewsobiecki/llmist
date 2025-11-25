/**
 * Google Gemini Model Specifications
 *
 * Model data for Google Gemini models including 2.5 and 2.0 series
 * with their specifications, pricing, and capabilities.
 */

import type { ModelSpec } from "../core/model-catalog.js";

export const GEMINI_MODELS: ModelSpec[] = [
  {
    provider: "gemini",
    modelId: "gemini-3-pro-preview",
    displayName: "Gemini 3 Pro (Preview)",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    pricing: {
      input: 2.0,
      output: 12.0,
      cachedInput: 0.2,
    },
    knowledgeCutoff: "2025-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      structuredOutputs: true,
    },
    metadata: {
      family: "Gemini 3",
      releaseDate: "2025-11-18",
      notes:
        "Most advanced model. 1501 Elo LMArena, 91.9% GPQA Diamond, 76.2% SWE-bench. Deep Think mode available.",
    },
  },
  {
    provider: "gemini",
    modelId: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    pricing: {
      input: 1.25,
      output: 10.0,
      cachedInput: 0.125,
    },
    knowledgeCutoff: "2025-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      structuredOutputs: true,
    },
    metadata: {
      family: "Gemini 2.5",
      releaseDate: "2025-06",
      notes: "Balanced multimodal model with 1M context. Best for complex agents and reasoning.",
    },
  },
  {
    provider: "gemini",
    modelId: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    pricing: {
      input: 0.3,
      output: 2.5,
      cachedInput: 0.03,
    },
    knowledgeCutoff: "2025-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      reasoning: true,
      structuredOutputs: true,
    },
    metadata: {
      family: "Gemini 2.5",
      releaseDate: "2025-06",
      notes: "Best price-performance ratio with thinking enabled by default",
    },
  },
  {
    provider: "gemini",
    modelId: "gemini-2.5-flash-lite",
    displayName: "Gemini 2.5 Flash-Lite",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    pricing: {
      input: 0.1,
      output: 0.4,
      cachedInput: 0.01,
    },
    knowledgeCutoff: "2025-01",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      structuredOutputs: true,
    },
    metadata: {
      family: "Gemini 2.5",
      releaseDate: "2025-06",
      notes: "Fastest and most cost-efficient model for high-volume, low-latency tasks",
    },
  },
  {
    provider: "gemini",
    modelId: "gemini-2.0-flash",
    displayName: "Gemini 2.0 Flash",
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    pricing: {
      input: 0.1,
      output: 0.4,
      cachedInput: 0.01,
    },
    knowledgeCutoff: "2024-08",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      structuredOutputs: true,
    },
    metadata: {
      family: "Gemini 2.0",
      notes: "Previous generation with 1M context and multimodal capabilities",
    },
  },
  {
    provider: "gemini",
    modelId: "gemini-2.0-flash-lite",
    displayName: "Gemini 2.0 Flash-Lite",
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    pricing: {
      input: 0.075,
      output: 0.3,
      cachedInput: 0.0075,
    },
    knowledgeCutoff: "2024-08",
    features: {
      streaming: true,
      functionCalling: true,
      vision: true,
      structuredOutputs: true,
    },
    metadata: {
      family: "Gemini 2.0",
      notes: "Lightweight previous generation model for cost-sensitive applications",
    },
  },
];
