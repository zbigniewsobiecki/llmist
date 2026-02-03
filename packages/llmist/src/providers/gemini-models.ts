/**
 * Google Gemini Model Specifications
 *
 * Model data for Google Gemini models including 3.0, 2.5 and 2.0 series
 * with their specifications, pricing (Standard Paid tier), and capabilities.
 *
 * Pricing source: https://ai.google.dev/gemini-api/docs/pricing
 * Last updated: 2025-12-20
 */

import type { ModelSpec } from "../core/model-catalog.js";

export const GEMINI_MODELS: ModelSpec[] = [
  // Gemini 3 Pro (Preview)
  {
    provider: "gemini",
    modelId: "gemini-3-pro-preview",
    displayName: "Gemini 3 Pro (Preview)",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    pricing: {
      input: 2.0, // $2.00 for prompts <= 200k, $4.00 for > 200k (using lower tier)
      output: 12.0, // $12.00 for prompts <= 200k, $18.00 for > 200k
      cachedInput: 0.2, // $0.20 for prompts <= 200k
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
        "Best model for multimodal understanding, agentic and vibe-coding. Deep Think mode available.",
    },
  },

  // Gemini 3 Flash (Preview)
  {
    provider: "gemini",
    modelId: "gemini-3-flash-preview",
    displayName: "Gemini 3 Flash (Preview)",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    pricing: {
      input: 0.5, // $0.50 for text/image/video
      output: 3.0,
      cachedInput: 0.05,
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
      releaseDate: "2025-12",
      notes: "Fast, cost-effective model with Deep Think mode. Good for agentic tasks.",
    },
  },

  // Gemini 2.5 Pro
  {
    provider: "gemini",
    modelId: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    pricing: {
      input: 1.25, // $1.25 for prompts <= 200k, $2.50 for > 200k
      output: 10.0, // $10.00 for prompts <= 200k, $15.00 for > 200k
      cachedInput: 0.125, // $0.125 for prompts <= 200k
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
      notes: "State-of-the-art multipurpose model. Excels at coding and complex reasoning.",
    },
  },

  // Gemini 2.5 Flash
  {
    provider: "gemini",
    modelId: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    pricing: {
      input: 0.3, // $0.30 for text/image/video, $1.00 for audio
      output: 2.5,
      cachedInput: 0.03, // $0.03 for text/image/video
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
      notes: "First hybrid reasoning model with 1M context and thinking budgets.",
    },
  },

  // Gemini 2.5 Flash-Lite
  {
    provider: "gemini",
    modelId: "gemini-2.5-flash-lite",
    displayName: "Gemini 2.5 Flash-Lite",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    pricing: {
      input: 0.1, // $0.10 for text/image/video, $0.30 for audio
      output: 0.4,
      cachedInput: 0.01, // $0.01 for text/image/video
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
      notes: "Smallest and most cost effective model, built for at scale usage.",
    },
  },

  // Gemini 2.0 Flash
  {
    provider: "gemini",
    modelId: "gemini-2.0-flash",
    displayName: "Gemini 2.0 Flash",
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    pricing: {
      input: 0.1, // $0.10 for text/image/video, $0.70 for audio
      output: 0.4,
      cachedInput: 0.025, // $0.025 for text/image/video
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
      notes: "Balanced multimodal model with 1M context, built for the era of Agents.",
    },
  },

  // Gemini 2.0 Flash-Lite
  {
    provider: "gemini",
    modelId: "gemini-2.0-flash-lite",
    displayName: "Gemini 2.0 Flash-Lite",
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    pricing: {
      input: 0.075,
      output: 0.3,
      // No context caching available for 2.0-flash-lite
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
      notes: "Smallest and most cost effective 2.0 model for at scale usage.",
    },
  },
];
